# Pôr a loja e o login online

O servidor da loja serve **tudo no mesmo domínio**: a loja na raiz (`www.oteudominio.com`) e a aplicação em `/app/` (`www.oteudominio.com/app`). Precisa de HTTPS e de disco persistente (a base de dados SQLite e a chave das licenças ficam em `DATA_DIR`). O GitHub serve só para guardar o código. Escolhe uma das opções.

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

## Domínio próprio (www.oteudominio.com)
1. Render → mixmind-loja → **Settings → Custom Domains → + Add Custom Domain** → `www.oteudominio.com`
   (o Render junta também `oteudominio.com`, que redireciona para o `www`).
2. No painel DNS do registador:
   - `www` → **CNAME** → `mixmind-loja.onrender.com`
   - `@` (domínio sem www) → **ALIAS/ANAME** → `mixmind-loja.onrender.com`; se não existir esse tipo, **A** → `216.24.57.1`
   - apaga registos **AAAA** nesses nomes. Depois **Verify** no Render (o certificado HTTPS é automático).
3. Render → **Environment**: `PUBLIC_URL` = `https://www.oteudominio.com` (sem barra no fim) e `APP_URL` = `/app/`. Save → reinicia.
4. Pronto: loja em `https://www.oteudominio.com`, app em `https://www.oteudominio.com/app`. Não é preciso mexer no `config.js`:
   o servidor completa-o com o próprio endereço e a chave pública.

**Deixar de usar o GitHub Pages:** GitHub → repositório → **Settings → Pages** → *Unpublish site* (ou *Source: None*).
O fluxo `.github/workflows/pages.yml` já só corre manualmente. O repositório pode passar a **privado**
(Settings → General → Change visibility); o Render continua a publicar a partir dele.

**App noutro sítio (opcional):** se um dia a app estiver noutro domínio, `APP_URL` = endereço completo dela e,
no `config.js` dela, `LICENSE_API` = endereço da loja e `LICENSE_PUBLIC_KEY` = Administração → Configurações → Licenciamento.

## Administrador e beta testers (Render → mixmind-loja → Environment)

**Ver a palavra-passe inicial:** `ADMIN_INITIAL_PASSWORD` → ícone do olho. Só serve até ao primeiro acesso — depois vale a que escolheste.
Mudar `ADMIN_INITIAL_PASSWORD` mais tarde **não** altera um administrador que já existe.

**Repor o acesso do administrador** (palavra-passe esquecida, ou mudar o email de entrada):
1. `ADMIN_EMAIL` = o email com que queres entrar; `ADMIN_RESET_PASSWORD` = uma palavra-passe temporária (12+ caracteres).
   Se também perdeste o telemóvel da verificação em dois passos, junta `ADMIN_RESET_2FA` = `1`.
2. **Save Changes** → o serviço reinicia. Entra em `/entrar` com esse email e a temporária; o site obriga a escolher uma nova.
3. Apaga `ADMIN_RESET_PASSWORD` (e `ADMIN_RESET_2FA`). Aplica-se uma vez por valor: reiniciar não volta a repor.

**Beta testers** — `BETA_ACESSOS`, entradas `utilizador:hash[:AAAA-MM-DD]` separadas por um espaço:
- gera cada entrada com `node server/scripts/beta-hash.mjs beta01 [AAAA-MM-DD]` (compacta: `server/bin/beta-hash.mjs`):
  mostra a palavra-passe **uma vez** (entrega-a ao beta tester) e a linha para colar — o Render só guarda o hash;
- o beta tester entra na app com `beta01` (sem email) e recebe uma licença de oferta presa a **um** computador
  (para mudar de computador: Admin → Licenças → libertar o computador);
- retirar a entrada suspende a conta no arranque seguinte; voltar a pôr reativa; uma data passada → modo de demonstração.

## Verificar
1. Abre a app → aparece o ecrã **Entrar**.
2. Entra com a conta de administrador → acesso completo (conta da equipa).
3. Cria um cliente (loja → Registar, ou Administração → Clientes → Novo cliente), emite-lhe uma licença de oferta (Licenças → Emitir) e entra na app com ele → “licença ativa neste computador”.
