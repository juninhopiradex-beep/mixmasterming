// MIXMIND — licença numa app JUCE (Windows / macOS). Exemplo de referência: ativar, validar, desativar e verificar offline.
// Requer JUCE 7+ (juce_core) e OpenSSL (libcrypto) para a verificação ECDSA (mmx_license.hpp).
//
//   MixmindLicense lic ("https://loja.exemplo", "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…");
//   if (! lic.isLicensed()) showDemoRestrictions();
//   auto err = lic.activate ("MMX1-XXXXX-XXXXX-XXXXX-XXXXX");   // vazio = sucesso, senão mensagem em português
//   lic.validateIfDue();                                         // no arranque e uma vez por dia (ignora falta de rede)
#pragma once
#include <juce_core/juce_core.h>
#include "mmx_license.hpp"

class MixmindLicense
{
public:
    MixmindLicense (juce::String apiBase, juce::String publicKeySpkiB64)
        : api (apiBase.trimCharactersAtEnd ("/")), pub (publicKeySpkiB64)
    {
        juce::PropertiesFile::Options o;
        o.applicationName = "MIXMIND"; o.filenameSuffix = ".license"; o.folderName = "Piradex/MIXMIND";
        o.osxLibrarySubFolder = "Application Support";
        store = std::make_unique<juce::PropertiesFile> (o);
        mid = mmx::machineId();
        if (mid.empty()) mid = "juce-" + juce::SystemStats::getUniqueDeviceID().toStdString(); // alternativa
    }

    mmx::Result status() const
    {
        auto token = store->getValue ("token");
        if (token.isEmpty()) { mmx::Result r; r.why = "sem licença"; return r; }
        return mmx::verify (token.toStdString(), pub.toStdString(), mid, juce::Time::currentTimeMillis());
    }
    bool isLicensed() const { return status().ok; }

    /** Devolve "" em caso de sucesso, ou a mensagem do servidor (ex.: licença ativa noutro computador). */
    juce::String activate (const juce::String& key)
    {
        juce::DynamicObject::Ptr b = new juce::DynamicObject();
        b->setProperty ("key", key); b->setProperty ("machineId", juce::String (mid));
        b->setProperty ("machineName", juce::SystemStats::getComputerName());
        b->setProperty ("platform", juce::SystemStats::getOperatingSystemName());
        b->setProperty ("appVersion", juce::JUCEApplicationBase::getInstance() ? juce::JUCEApplicationBase::getInstance()->getApplicationVersion() : "1.8.0");
        int status = 0; auto res = post ("/api/v1/licenses/activate", juce::var (b.get()), status);
        if (status != 200) return res.getProperty ("error", "Sem ligação ao servidor de licenças.").toString();
        auto token = res.getProperty ("token", {}).toString();
        auto v = mmx::verify (token.toStdString(), pub.toStdString(), mid, juce::Time::currentTimeMillis());
        if (! v.ok) return "Comprovativo inválido (" + juce::String (v.why) + ").";
        store->setValue ("key", key); store->setValue ("token", token); store->saveIfNeeded();
        return {};
    }

    /** Revalida quando o comprovativo pede (chk) — revogações e desativações remotas aplicam-se aqui. Sem rede: não muda nada. */
    void validateIfDue (bool force = false)
    {
        auto s = status();
        if (! force && s.ok && ! s.needsCheck) return;
        juce::DynamicObject::Ptr b = new juce::DynamicObject();
        b->setProperty ("key", store->getValue ("key")); b->setProperty ("machineId", juce::String (mid));
        int status = 0; auto res = post ("/api/v1/licenses/validate", juce::var (b.get()), status);
        if (status != 200) return; // offline ou erro temporário
        if ((bool) res.getProperty ("ok", false)) store->setValue ("token", res.getProperty ("token", {}).toString());
        else { store->removeValue ("token"); store->setValue ("blocked", res.getProperty ("message", {}).toString()); }
        store->saveIfNeeded();
    }

    /** Liberta a licença para outro computador. */
    juce::String deactivate()
    {
        juce::DynamicObject::Ptr b = new juce::DynamicObject();
        b->setProperty ("key", store->getValue ("key")); b->setProperty ("machineId", juce::String (mid));
        int status = 0; auto res = post ("/api/v1/licenses/deactivate", juce::var (b.get()), status);
        if (status != 200) return res.getProperty ("error", "Sem ligação ao servidor de licenças.").toString();
        store->removeValue ("token"); store->saveIfNeeded(); return {};
    }

private:
    juce::var post (const juce::String& path, const juce::var& body, int& status)
    {
        auto url = juce::URL (api + path).withPOSTData (juce::JSON::toString (body));
        auto in = url.createInputStream (juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inPostData)
                                            .withExtraHeaders ("Content-Type: application/json")
                                            .withConnectionTimeoutMs (10000).withStatusCode (&status));
        return in ? juce::JSON::parse (in->readEntireStreamAsString()) : juce::var();
    }
    juce::String api, pub; std::string mid;
    std::unique_ptr<juce::PropertiesFile> store;
};
