# API de licenças MIXMIND (`/api/v1`)

API pública chamada pela aplicação, seja a app web/PWA ou uma app nativa Windows/macOS.

- Corpo em JSON, sem cookies.
- CORS só para `APP_URL` e `CORS_ORIGINS`.
- Limite de 60 pedidos por minuto por IP.
- Erros no formato `{ "error": "mensagem em português", "code": "CODIGO" }`.

Base: `https://A-TUA-LOJA` (ex.: `https://loja.mixmind.example`).

## Identificador do computador

A app envia um `machineId` estável, com 8 a 200 caracteres. **O servidor guarda só um hash com segredo**, nunca o valor em claro.

| Plataforma | Origem sugerida |
|---|---|
| Windows | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` → `win-<guid>` |
| macOS | `IOPlatformUUID` (IOKit) → `mac-<uuid>` |
| Linux | `/etc/machine-id` → `linux-<id>` |
| App web | identificador aleatório guardado no navegador → `web-<uuid>` |

## Endpoints

### `GET /api/v1/licenses/public-key`
```json
{ "alg": "ES256", "curve": "P-256", "format": "MMX1.<payload base64url>.<assinatura IEEE-P1363 base64url>",
  "kid": "3f2a…", "spki": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…", "jwk": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" } }
```
Embute `spki` na app. A chave pública não é secreta. Obtê-la só no primeiro arranque também funciona, mas é mais fraco.

### `GET /api/v1/app/config`
```json
{ "demo": { "exportSeconds": 60, "formats": ["mp3"], "text": "…" },
  "latest": { "version": "1.8.0", "url_web": "https://…", "url_windows": null, "url_macos": null },
  "store": "https://loja…", "checkDays": 7 }
```

### `POST /api/v1/licenses/activate`
Pedido:
```json
{ "key": "MMX1-7K2QD-…", "machineId": "win-0b5e…", "machineName": "ESTUDIO-PC", "platform": "Windows 11", "appVersion": "1.8.0" }
```
Resposta `200`:
```json
{ "token": "MMX1.eyJ2IjoxLCJsaWMiOi….MEUCIQ…", "license": { "type": "perpetual", "status": "active", "major": 1, "expires_at": null, "key4": "9XQ2" },
  "device": { "name": "ESTUDIO-PC", "platform": "Windows 11" }, "reused": false }
```
Reativar no **mesmo** computador devolve `reused: true` e não gasta ativação.

| Código | HTTP | Significado |
|---|---|---|
| `NAO_EXISTE` | 404 | chave inválida |
| `OUTRA_MAQUINA` | 409 | ativa noutro computador (a mensagem indica qual); desativar primeiro |
| `LIMITE_MUDANCAS` | 429 | limite de mudanças de computador atingido (contactar o suporte) |
| `REVOGADA` / `SUSPENSA` / `EXPIRADA` / `CONTA_BLOQUEADA` | 403 | licença não utilizável |
| `MAQUINA_INVALIDA` | 400 | `machineId` em falta ou com tamanho inválido |
| `LIMITE` | 429 | demasiados pedidos |

### `POST /api/v1/licenses/validate`
Pedido: `{ "key": "…", "machineId": "…", "appVersion": "1.8.0" }`

- `{ "ok": true, "token": "MMX1.…", "license": {…} }`: substitui o comprovativo guardado.
- `{ "ok": false, "code": "REVOGADA" | "SUSPENSA" | "EXPIRADA" | "CONTA_BLOQUEADA" | "DESATIVADA" | "NAO_EXISTE", "message": "…" }`: apaga o comprovativo e passa a modo de demonstração.
- **Sem rede ou erro 5xx:** mantém o comprovativo atual. Uma perpétua continua a funcionar; uma subscrição continua até `exp`.

### `POST /api/v1/licenses/deactivate`
Pedido: `{ "key": "…", "machineId": "…" }`. Resposta: `{ "ok": true }`, ou `{ "ok": true, "already": true }` se não havia computador ativo. Só o computador ativo se pode desativar a si próprio (`403 OUTRA_MAQUINA`). O cliente também pode desativar na área de cliente e o suporte na administração.

### Acesso à aplicação (login antes de tudo)
`POST /api/v1/app/login`
```json
{ "email": "…", "password": "…", "code": "123456 (só com 2FA)", "machineId": "web-…", "machineName": "Windows · Chrome", "platform": "Windows", "appVersion": "1.8" }
```
Resposta: `{ "token": "…", "user": { "name", "email", "role", "staff" }, "access": { "mode": "staff" | "licensed" | "other_machine" | "demo", … }, "store", "demo", "checkDays" }`.
Com `licensed`, `access` traz `key` e o comprovativo `token` (a licença já foi ativada neste computador). Com `other_machine`, traz a lista `devices`.
Erros: `CREDENCIAIS` 401 · `BLOQUEIO_TEMPORARIO` 429 · `CONTA_SUSPENSA`/`CONTA_BLOQUEADA` 403 · `EMAIL_POR_CONFIRMAR` 403 · `TROCA_PALAVRA_PASSE` 403 · `MFA_OBRIGATORIA` 403 · `MFA_NECESSARIO`/`MFA_CODIGO` 401.

`POST /api/v1/app/session` (cabeçalho `Authorization: Bearer <token>`, corpo com `machineId`) → `{ user, access, … }` atualizados. `401 SEM_SESSAO` = entrar de novo.
`POST /api/v1/app/logout` (Bearer) → revoga a sessão.

## Comprovativo (`token`)

`MMX1.<payload>.<assinatura>`. A assinatura é ECDSA P-256 / SHA-256 sobre os bytes ASCII de `"MMX1." + payload`, no formato r‖s com 64 bytes (IEEE-P1363), em base64url.

| Campo | Significado |
|---|---|
| `v` | versão do formato (1) |
| `lic`, `key4` | id da licença e últimos 4 caracteres da chave |
| `typ` | `perpetual`, `subscription`, `demo`, `gift` |
| `maj` | versão principal coberta (1 = série 1.x) |
| `mb` | `sha256("mmx-bind:" + machineId)` em hex, primeiros 32 caracteres — **confirma que o comprovativo é deste computador** |
| `iat` | emitido em (ms) |
| `chk` | revalidar online a partir de (ms), se houver rede |
| `exp` | deixa de valer a partir de (ms); `null` nas perpétuas |
| `until` | fim do período pago (subscrições); `exp` = `until` + tolerância |
| `kid` | identificador da chave de assinatura |

### Regras na app
1. Verificar a assinatura com a chave pública embutida. Se falhar → inválido.
2. Verificar que `mb` corresponde a este computador. Se não → inválido.
3. Verificar que `maj` é ≥ à versão principal da app. Se não → a licença não cobre esta versão.
4. Se `exp` não é `null` e já passou → expirado: modo de demonstração e convite a renovar.
5. Se `chk` já passou e há rede → chamar `validate`.

## Exemplos de integração (testados contra o servidor)

- `examples/desktop/node/mixmind-license.mjs`: CLI em Node com ativar, estado, validar, desativar e id. Ver `MIXMIND_API`, `MIXMIND_PUBLIC_KEY` e `MIXMIND_LICENSE_FILE`.
- `examples/desktop/cpp/mmx_license.hpp`: verificação offline em C++17 + OpenSSL, e identificador do computador em Windows, macOS e Linux. `verify_cli.cpp` é um teste de linha de comandos.
- `examples/desktop/cpp/MixmindLicense.h`: classe para JUCE 7+ com ativar, validar, desativar e estado (pedidos HTTP com `juce::URL`).
- App web: `js/core/license.js` usa WebCrypto, com o mesmo formato e as mesmas regras.
