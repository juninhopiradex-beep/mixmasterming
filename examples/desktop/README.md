# Integração das licenças MIXMIND numa app desktop

| Ficheiro | O quê |
|---|---|
| `node/mixmind-license.mjs` | CLI/ módulo Node 18+ sem dependências: id do computador (Windows/macOS/Linux), ativar, verificar offline, validar, desativar |
| `cpp/mmx_license.hpp` | C++17 + OpenSSL: verificação offline do comprovativo (ECDSA P-256) e id do computador |
| `cpp/verify_cli.cpp` | teste: `g++ -std=c++17 verify_cli.cpp -lcrypto -o verify_cli && ./verify_cli <token> <spki>` |
| `cpp/MixmindLicense.h` | classe JUCE 7+ (pedidos HTTP com `juce::URL`, armazenamento com `PropertiesFile`) |

Todos são testados contra o servidor real em `npm run test:exemplos`. Formato e regras: [`docs/API-LICENCAS.md`](../../docs/API-LICENCAS.md).

Notas:
- Embute a **chave pública** (Administração → Configurações → Licenciamento) na app; a privada nunca sai do servidor.
- Guarda o comprovativo num ficheiro do utilizador; sem rede, a app continua a funcionar dentro das regras (perpétuas sempre; subscrições até `exp`).
- Assina o binário (Authenticode no Windows, notarização no macOS). Numa app nativa, ofusca a verificação para dificultar remendos — nenhuma proteção local é inviolável.
