# Pôr a loja e o login online

A app no GitHub Pages é estática: **o login, as contas e as licenças precisam do servidor da loja a correr** num sítio com HTTPS e disco persistente (a base de dados SQLite e a chave das licenças ficam em `DATA_DIR`). Escolhe uma das opções.

## Opção A — Render (mais simples, ~US$7/mês + disco)
1. Em render.com → New → **Blueprint** → liga o repositório do GitHub. O ficheiro `render.yaml` cria o serviço com disco persistente em `/data`.
2. Quando pedir os valores:
   - `PUBLIC_URL` = o endereço que o Render der (ex.: `https://mixmind-loja.onrender.com`) ou o teu domínio;
   - `ADMIN_EMAIL` = o teu email;
   - `ADMIN_INITIAL_PASSWORD` = a palavra-passe inicial (só aqui, nunca no repositório);
   - `EMAIL_PROVIDER` / `EMAIL_API_KEY` / `EMAIL_FROM` = Resend ou Postmark (sem isto os clientes não recebem a confirmação de email — enquanto isso, vês as ligações em Administração → Emails enviados).
   - `SECRET_KEY` é gerada automaticamente — **não a mudes depois**.
3. Abre `PUBLIC_URL/entrar`, entra com o email e a palavra-passe inicial, **troca-a**, ativa a 2FA e apaga `ADMIN_INITIAL_PASSWORD` nas variáveis do Render.

## Opção B — VPS (Ubuntu 22.04/24.04)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs caddy
sudo useradd -r -m -d /opt/mixmind mixmind && sudo -u mixmind git clone https://github.com/<utilizador>/<repositório> /opt/mixmind/app
sudo -u mixmind cp /opt/mixmind/app/server/.env.example /opt/mixmind/app/server/.env   # edita: APP_MODE=production, PUBLIC_URL, SECRET_KEY, ADMIN_*, EMAIL_*, TRUST_PROXY=1, DATA_DIR=/opt/mixmind/dados
```
Serviço (`/etc/systemd/system/mixmind.service`):
```ini
[Service]
User=mixmind
WorkingDirectory=/opt/mixmind/app
ExecStart=/usr/bin/npm run loja
Restart=always
[Install]
WantedBy=multi-user.target
```
HTTPS automático com Caddy (`/etc/caddy/Caddyfile`): `loja.o-teu-dominio.com { reverse_proxy 127.0.0.1:8790 }`.
`sudo systemctl enable --now mixmind caddy`. Cópias de segurança: `npm run loja:backup` num cron diário (guarda-as cifradas fora do servidor).

## Depois — ligar a app (GitHub)
No `config.js` do repositório:
```js
EXIGIR_LOGIN: true,
LICENSE_API: 'https://o-endereco-da-loja',          // sem barra no fim
LICENSE_PUBLIC_KEY: 'MFkw…',                         // Administração → Configurações → Licenciamento → Chave pública
```
Se a app não estiver em `https://<utilizador>.github.io`, junta o domínio dela em `CORS_ORIGINS` no servidor.

## Verificar
1. Abre a app → aparece o ecrã **Entrar**.
2. Entra com a conta de administrador → acesso completo (conta da equipa).
3. Cria um cliente (loja → Registar, ou Administração → Clientes → Novo cliente), emite-lhe uma licença de oferta (Licenças → Emitir) e entra na app com ele → “licença ativa neste computador”.
