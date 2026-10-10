# MIXMIND by Piradex — v1.8 (versão compacta)

**AI proposes. Engineer decides.** Mistura e masterização a partir de stems, no navegador, com loja, contas e licenças.

Esta é a **versão compacta**: o mesmo código da versão completa, agrupado em poucos ficheiros para publicar facilmente no GitHub. Os testes automáticos, os exemplos desktop e o código-fonte legível ficam na versão completa (`npm run build:compacto` gera esta pasta).

## Ficheiros

| Ficheiro | O quê |
|---|---|
| `index.html`, `mixmind.js`, `mixmind.css` | a aplicação — servida pela loja em `/app/` (ex.: www.oteudominio.com/app) |
| `acessos.json`, `acessos.html` | **quem pode entrar na app** sem servidor (modo GitHub): gera os acessos em acessos.html e cola em acessos.json |
| `config.js` | configuração editável: Supabase (opcional) e licenças (`LICENSE_API`, `LICENSE_PUBLIC_KEY`) |
| `sw.js`, `manifest.webmanifest`, `assets/` | app instalável e offline, ícones |
| `portal.html`, `portal.js`, `supabase/schema.sql` | portal de envio para clientes (opcional) |
| `js/vendor/lame.min.js`, `styles/library.json` | codificador MP3 e biblioteca de estilos |
| `server/bin/loja.mjs` | loja, área de cliente, administração e API de licenças (Node 22.13+, sem dependências) |
| `server/public/` | páginas da loja |
| `server/migrations/`, `server/.env.example` | base de dados e configuração (sem segredos) |
| `server/bin/backup.mjs`, `server/bin/seed-demo.mjs`, `server/bin/beta-hash.mjs` | cópias de segurança, dados de demonstração e acessos de beta testers |
| `docs/` | **PUBLICAR-SERVIDOR.md** (pôr o login online), instalação, segurança, pagamentos, API de licenças e lista do que falta configurar |
| `Dockerfile`, `render.yaml` | publicar o servidor (Render ou qualquer serviço com Docker) |

## Publicar
- **Tudo no mesmo servidor (Render):** a loja fica na raiz (`www.oteudominio.com`) e a app em `/app/` (`www.oteudominio.com/app`). O `config.js` da app é completado pelo servidor (login, licenças e chave pública do próprio servidor) — mudar de domínio só exige mudar `PUBLIC_URL`. A app só abre depois de entrar com uma conta. O GitHub serve apenas para guardar o código (o GitHub Pages já não é usado).
- **Login, contas e licenças:** passo a passo em `docs/PUBLICAR-SERVIDOR.md`.
- **Loja:** precisa de um servidor Node com HTTPS (VPS, Render…). `npm run loja` com as variáveis de `server/.env.example`. A palavra-passe inicial do administrador define-se **só** no ambiente do servidor (`ADMIN_INITIAL_PASSWORD`), troca-se no 1.º acesso e depois apaga-se. Ver `docs/LICENCIAMENTO.md`.

© MIXMIND by Piradex · BeatFreak Studio
