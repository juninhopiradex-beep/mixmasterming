// MIXMIND — verificação OFFLINE do comprovativo de licença numa app desktop em C++ (Windows / macOS / Linux).
// Header-only. Depende só do OpenSSL (libcrypto 1.1+ ou 3.x). Para os pedidos HTTP (ativar/validar/desativar)
// usa a biblioteca da tua app (JUCE: ver MixmindLicense.h; ou libcurl, WinHTTP, NSURLSession…).
//
// Formato do comprovativo:  MMX1.<payload base64url>.<assinatura ECDSA P-256 / SHA-256, r||s (IEEE-P1363) base64url>
// Payload (JSON): v, lic, key4, typ (perpetual|subscription|demo|gift), prod, maj, mid, mb, iat, chk, exp (null = sem fim), until, kid
//   mb  = primeiros 32 hex de sha256("mmx-bind:" + machineId)  → o comprovativo só serve neste computador
//   exp = fim do período pago + tolerância (subscrições); null nas perpétuas (funcionam offline)
//   chk = quando a app deve revalidar online (se houver rede)
#pragma once
#include <openssl/bn.h>
#include <openssl/ecdsa.h>
#include <openssl/evp.h>
#include <openssl/x509.h>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>
#if defined(_WIN32)
  #include <windows.h>
#elif defined(__APPLE__)
  #include <CoreFoundation/CoreFoundation.h>
  #include <IOKit/IOKitLib.h>
  #if !defined(MAC_OS_VERSION_12_0)
    #define kIOMainPortDefault kIOMasterPortDefault
  #endif
#endif

namespace mmx {

inline std::vector<unsigned char> b64decode(std::string s, bool url) {
  if (url) for (auto& c : s) { if (c == '-') c = '+'; else if (c == '_') c = '/'; }
  while (s.size() % 4) s += '=';
  static const std::string A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::vector<unsigned char> out; uint32_t buf = 0; int bits = 0;
  for (char c : s) {
    if (c == '=') break;
    auto p = A.find(c); if (p == std::string::npos) continue;
    buf = (buf << 6) | (uint32_t)p; bits += 6;
    if (bits >= 8) { bits -= 8; out.push_back((unsigned char)((buf >> bits) & 0xFF)); }
  }
  return out;
}

inline std::string sha256hex(const std::string& s) {
  unsigned char md[32]; unsigned int n = 0;
  EVP_Digest(s.data(), s.size(), md, &n, EVP_sha256(), nullptr);
  static const char* H = "0123456789abcdef"; std::string o;
  for (unsigned i = 0; i < n; i++) { o += H[md[i] >> 4]; o += H[md[i] & 15]; }
  return o;
}

// leitura mínima de campos do JSON do payload (gerado pelo servidor, formato estável)
inline std::string jsonStr(const std::string& j, const std::string& k) {
  auto p = j.find("\"" + k + "\":\""); if (p == std::string::npos) return "";
  p += k.size() + 4; auto e = j.find('"', p); return j.substr(p, e - p);
}
inline long long jsonNum(const std::string& j, const std::string& k, long long def = -1) {
  auto p = j.find("\"" + k + "\":"); if (p == std::string::npos) return def;
  p += k.size() + 3; if (j.compare(p, 4, "null") == 0) return def;
  return std::stoll(j.substr(p));
}

/** Identificador estável do computador. */
inline std::string machineId() {
#if defined(_WIN32)
  wchar_t buf[128]; DWORD sz = sizeof(buf);
  if (RegGetValueW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography", L"MachineGuid", RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY, nullptr, buf, &sz) == ERROR_SUCCESS) {
    std::string s; for (wchar_t* c = buf; *c; ++c) s += (char)towlower(*c); return "win-" + s;
  }
#elif defined(__APPLE__)
  io_service_t svc = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"));
  if (svc) {
    CFStringRef uuid = (CFStringRef)IORegistryEntryCreateCFProperty(svc, CFSTR(kIOPlatformUUIDKey), kCFAllocatorDefault, 0);
    IOObjectRelease(svc);
    if (uuid) { char b[128]; CFStringGetCString(uuid, b, sizeof(b), kCFStringEncodingUTF8); CFRelease(uuid); std::string s(b); for (auto& c : s) c = (char)tolower(c); return "mac-" + s; }
  }
#else
  for (const char* f : { "/etc/machine-id", "/var/lib/dbus/machine-id" }) { std::ifstream in(f); std::string s; if (in && std::getline(in, s) && !s.empty()) return "linux-" + s; }
#endif
  return "";
}

struct Result { bool ok = false; std::string why, type; int major = 0; long long exp = -1, until = -1, chk = 0; bool needsCheck = false; };

/** Verifica o comprovativo: assinatura (chave pública SPKI em base64), computador, validade. nowMs = hora atual em ms. */
inline Result verify(const std::string& token, const std::string& spkiB64, const std::string& mid, long long nowMs) {
  Result r;
  auto d1 = token.find('.'), d2 = token.find('.', d1 + 1);
  if (d1 == std::string::npos || d2 == std::string::npos || token.substr(0, d1) != "MMX1") { r.why = "formato"; return r; }
  std::string signedPart = token.substr(0, d2);
  auto sig = b64decode(token.substr(d2 + 1), true), der = b64decode(spkiB64, false);
  if (sig.size() != 64) { r.why = "assinatura"; return r; }
  const unsigned char* p = der.data();
  EVP_PKEY* key = d2i_PUBKEY(nullptr, &p, (long)der.size());
  if (!key) { r.why = "chave pública"; return r; }
  // r||s (64 bytes) → DER (o OpenSSL verifica assinaturas ECDSA em DER)
  ECDSA_SIG* es = ECDSA_SIG_new();
  ECDSA_SIG_set0(es, BN_bin2bn(sig.data(), 32, nullptr), BN_bin2bn(sig.data() + 32, 32, nullptr));
  unsigned char* sder = nullptr; int slen = i2d_ECDSA_SIG(es, &sder); ECDSA_SIG_free(es);
  EVP_MD_CTX* ctx = EVP_MD_CTX_new();
  bool good = slen > 0 && EVP_DigestVerifyInit(ctx, nullptr, EVP_sha256(), nullptr, key) == 1 &&
              EVP_DigestVerify(ctx, sder, (size_t)slen, (const unsigned char*)signedPart.data(), signedPart.size()) == 1;
  EVP_MD_CTX_free(ctx); OPENSSL_free(sder); EVP_PKEY_free(key);
  if (!good) { r.why = "assinatura"; return r; }
  auto pl = b64decode(token.substr(d1 + 1, d2 - d1 - 1), true);
  std::string json(pl.begin(), pl.end());
  r.type = jsonStr(json, "typ"); r.major = (int)jsonNum(json, "maj", 0); r.exp = jsonNum(json, "exp"); r.until = jsonNum(json, "until"); r.chk = jsonNum(json, "chk", 0);
  std::string mb = jsonStr(json, "mb");
  if (!mb.empty() && mb != sha256hex("mmx-bind:" + mid).substr(0, 32)) { r.why = "outro computador"; return r; }
  if (r.exp >= 0 && nowMs > r.exp) { r.why = "expirado"; return r; }
  r.ok = true; r.needsCheck = nowMs > r.chk;
  return r;
}

} // namespace mmx
