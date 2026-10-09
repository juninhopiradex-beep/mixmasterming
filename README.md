# MIXMIND by Piradex — v1.8 (versão compacta)

**AI proposes. Engineer decides.** Mistura e masterização a partir de stems, no navegador, com loja, contas e licenças.

Esta é a **versão compacta**: o mesmo código da versão completa, agrupado em poucos ficheiros para publicar facilmente no GitHub. Os testes automáticos, os exemplos desktop e o código-fonte legível ficam na versão completa (`npm run build:compacto` gera esta pasta).

## Ficheiros

| Ficheiro | O quê |
|---|---|
| `index.html`, `mixmind.js`, `mixmind.css` | a aplicação (GitHub Pages) |
| `config.js` | configuração editável: Supabase (opcional) e licenças (`LICENSE_API`, `LICENSE_PUBLIC_KEY`) |
| `sw.js`, `manifest.webmanifest`, `assets/` | app instalável e offline, ícones |
| `portal.html`, `portal.js`, `supabase/schema.sql` | portal de envio para clientes (opcional) |
| `js/vendor/lame.min.js`, `styles/library.json` | codificador MP3 e biblioteca de estilos |
| `server/bin/loja.mjs` | loja, área de cliente, administração e API de licenças (Node 22.13+, sem dependências) |
| `server/public/` | páginas da loja |
| `server/migrations/`, `server/.env.example` | base de dados e configuração (sem segredos) |
| `server/bin/backup.mjs`, `server/bin/seed-demo.mjs` | cópias de segurança e dados de demonstração |
| `docs/` | instalação, segurança, pagamentos, API de licenças e **lista do que falta configurar** |

## Publicar
- **App:** GitHub Pages (o workflow `.github/workflows/pages.yml` publica tudo exceto `server/`). Sem `LICENSE_API` no `config.js`, funciona como antes, sem licenças.
- **Loja:** precisa de um servidor Node com HTTPS (VPS, Render…). `npm run loja` com as variáveis de `server/.env.example`. A palavra-passe inicial do administrador define-se **só** no ambiente do servidor (`ADMIN_INITIAL_PASSWORD`), troca-se no 1.º acesso e depois apaga-se. Ver `docs/LICENCIAMENTO.md`.

© MIXMIND by Piradex · BeatFreak Studio
