# MIXMIND v1.8 — loja, contas, pagamentos e licenças

Este documento descreve o sistema de vendas, autenticação, administração e licenciamento acrescentado na v1.8. Tudo está na pasta `server/`: Node 22 sem dependências externas e SQLite embutido.

> **Estado:** está implementado e testado contra simuladores dos prestadores. **Ainda não está pronto para vender.** Faltam credenciais reais, dados bancários, câmbios, validação jurídica dos textos e o alojamento. A lista completa está em [Configurações de produção pendentes](#configurações-de-produção-pendentes).

---

## 1. Arquitetura

```
 Navegador do cliente                      Servidor da loja (Node 22, server/)                      Prestadores
┌──────────────────────┐   https, cookie   ┌───────────────────────────────────────────┐   REST    ┌──────────────┐
│ Loja  /  /comprar    │ ────────────────▶ │ páginas (server/public)  +  /api/*         │ ────────▶ │ Stripe       │
│ Área de cliente /conta│   HttpOnly        │  · contas, sessões, 2FA, permissões       │ ◀──────── │ (Checkout)   │
│ Administração /admin │                   │  · encomendas, pagamentos, comprovativos  │  webhooks │ PayPal       │
└──────────────────────┘                   │  · licenças (assina com ECDSA P-256)      │  assinados│ (Orders/Subs)│
┌──────────────────────┐   https, CORS     │  · emails (Resend/Postmark)  · auditoria  │           └──────────────┘
│ App MIXMIND (Pages/PWA)│ ──── /api/v1 ──▶ │ SQLite (WAL) · comprovativos · chave privada│
│ verifica o comprovativo│  sem cookies     └───────────────────────────────────────────┘
│ offline (chave pública)│
└──────────────────────┘
```

**Decisões principais**

- **O GitHub Pages não executa servidores.** A aplicação continua no Pages e a loja precisa de um alojamento Node, por exemplo uma VPS, o Render ou o Railway. O workflow do Pages publica só a aplicação, nunca a pasta `server/`.
- **A loja, a área de cliente e a administração são servidas pelo próprio servidor** (mesma origem). Assim as sessões ficam em cookies `HttpOnly`, `SameSite=Lax` e `Secure`, sem tokens no `localStorage`.
- **A aplicação só fala com `/api/v1`** (CORS limitado a `APP_URL` e `CORS_ORIGINS`, sem cookies).
- **O cartão é pago no Stripe Checkout alojado.** O número do cartão e o CVV nunca passam pelo nosso servidor.
- **A licença só é emitida pelo servidor**, depois de um webhook com assinatura verificada, de uma captura PayPal feita no servidor, ou de uma aprovação administrativa da transferência. A página de "sucesso" do navegador não emite nada.
- **Valores em unidades mínimas** (cêntimos). A moeda base é o USD. EUR e AOA usam o câmbio configurado, que é mostrado ao cliente; os kwanzas não têm cêntimos. O painel nunca soma moedas diferentes.
- **Sem dependências npm no servidor** (`node:sqlite`, `node:crypto`, `fetch`). Menos superfície de ataque e menos manutenção.

## 2. O que já existia, o que entrou agora e o que falta

| Pedido | Estado |
|---|---|
| Mistura e master completos a partir de stems | Já existia |
| Notas do Motor (faixa, ajuste, motivo) | **Novo:** vista consolidada com filtros e exportação CSV/TXT. Antes só havia a explicação por stem. |
| Faders a seguir o motor, com controlo manual | Já existia |
| Referências, perfis por estilo, linguagem natural | Já existia |
| Alvos de loudness: streaming, clubes, CD | Já existia |
| Alvos de radiodifusão (EBU R128 −23 LUFS / −1 dBTP; ATSC A/85 −24 / −2) | **Novo** |
| A/B com volume igualado | Já existia |
| WAV/AIFF/FLAC 24 bits, MP3, WAV 32-bit float | Já existia |
| Processamento offline | Já existia (local). **Novo:** app instalável que abre sem internet (PWA + service worker) e fontes locais. |
| Motor de IA opcional com a chave API do utilizador | **Não implementado** — aparece como “Em breve” na página de vendas |
| Ativação num só computador, Windows ou macOS | **Novo:** na app web, “computador” = este navegador neste computador. Para apps nativas há exemplos (C++/JUCE e Node). |
| Página de vendas, planos, poupança automática, impostos, reembolsos | **Novo** |
| Registo, login, confirmação de email, recuperação, sessões, limite de tentativas | **Novo** |
| Estados de conta, convites, suspender ≠ bloquear ≠ revogar | **Novo** |
| 2FA da equipa, perfis (Administrador principal, Financeiro, Suporte) | **Novo** |
| PayPal, cartões, transferência PT e AO, comprovativos, validação | **Novo.** Testado contra simuladores; faltam as credenciais reais. |
| Licenças: chaves, tipos, 1 máquina, mudanças, histórico, comprovativos offline | **Novo** |
| Área de cliente, administração, emails editáveis, auditoria | **Novo** |
| Instaladores nativos Windows/macOS | **Não existem.** A app é web/PWA. A área de cliente mostra ligações de download só se a administração as configurar. |

## 3. Modelo de dados (SQLite, `server/migrations/`)

| Tabela | Conteúdo |
|---|---|
| `users` | clientes e equipa; `role` (customer, owner, finance, support), `status` (pending, active, suspended, blocked), hash scrypt da palavra-passe, segredo TOTP cifrado, faturação |
| `sessions` | sessões (guardado só o sha256 do token), IP, navegador, 2FA concluída |
| `tokens` | ligações de confirmação, recuperação e convite (sha256, validade, uso único) |
| `login_attempts` | tentativas por email, IP, código 2FA e recuperação |
| `settings` | configurações editáveis (JSON): métodos, câmbios, impostos, bancos, licenciamento, demo, segurança, loja, credenciais cifradas |
| `texts` | textos legais e templates de email: rascunho → validado → publicado |
| `products`, `versions`, `plans` | produto, versões publicadas (com ligações), planos e preços em USD |
| `orders` | encomendas: referência `MMX-AAMM-XXXXXX`, método, moeda, câmbio, imposto, estado, prazo |
| `payments` | pagamentos por prestador — `UNIQUE(provider, provider_payment_id)` |
| `payment_events` | webhooks recebidos — `UNIQUE(provider, event_id)` (idempotência) |
| `proofs` | comprovativos de transferência (ficheiro privado fora da pasta pública) |
| `subscriptions` | período atual, renovação automática/manual, cancelamento no fim do período |
| `licenses` | chave, tipo, estado, validade, versão principal — `order_id` e `subscription_id` únicos |
| `devices` | computadores; **índice único parcial: um computador ativo por licença** |
| `license_events` | histórico de cada licença |
| `audit_log` | quem, quando, o quê, motivo (nunca credenciais nem palavras-passe) |
| `emails` | caixa de saída (testes) e registo de envios |

Migrações numeradas (`001_init.sql`, `002_transfer_reset.sql`) aplicadas no arranque e registadas em `schema_migrations`. **Testes e produção usam bases separadas** (`mixmind-test.db` e `mixmind.db`), e a pasta de dados é configurável.

## 4. Estados

- **Conta:** `pending` (email por confirmar) → `active`. A equipa pode pôr `suspended` (sem login; as licenças **continuam** a funcionar) ou `blocked` (sem login e as licenças **não ativam nem validam**, mas não são revogadas). Só o administrador principal desbloqueia.
- **Encomenda:** `pending` → `awaiting_validation` (comprovativo enviado) → `confirmed`, ou `failed` / `expired` / `cancelled` / `refunded` / `disputed`.
- **Comprovativo:** `submitted` → `accepted` / `needs_info` / `rejected` / `superseded`.
- **Subscrição:** `active` → `past_due` (cobrança falhada) → `expired`. O cancelamento marca `cancel_at_period_end` e o acesso mantém-se até ao fim do período pago.
- **Licença:** `active`, `suspended` (contestação ou decisão do suporte), `revoked` (reembolso ou decisão do administrador principal), `expired`.

## 5. Pagamentos

| Método | Como confirma | Renovação |
|---|---|---|
| Cartão (Stripe Checkout) | webhook `checkout.session.completed` / `invoice.paid` com assinatura HMAC verificada (tolerância 5 min) | automática |
| PayPal | captura **no servidor** no regresso do cliente (confere valor e moeda) + webhooks verificados pela API `verify-webhook-signature` | automática (Subscriptions, exige `paypal_plan_id`) |
| Transferência PT / AO | comprovativo → **aprovação administrativa** depois de verificar o banco (caixa de confirmação obrigatória) | manual: o cliente cria a encomenda de renovação |
| Simulado (só testes) | evento assinado com HMAC, pelo mesmo caminho dos webhooks | automática |

- **Idempotência:** o evento repetido é ignorado (`payment_events`), o pagamento repetido também (`payments`), e as licenças são únicas por encomenda e por subscrição. Tudo corre numa transação `BEGIN IMMEDIATE`.
- **Reembolso** revoga a licença. **Contestação** (chargeback) suspende-a.
- **Trabalhos periódicos** (a cada 15 minutos):
  - expirar subscrições e licenças depois do período pago mais a tolerância;
  - lembrete de renovação 7 dias antes;
  - expirar encomendas pendentes: transferências sem comprovativo depois do prazo, cartão e PayPal depois de 48 h;
  - limpar sessões e ligações antigas.

### Configurar a Stripe
1. Em developers → API keys, copia a **Secret key**. Para STRIPE_SECRET_KEY, prefere uma *restricted key* com permissões de Checkout Sessions, Customers, Subscriptions, Invoices, Refunds e PaymentIntents.
2. Em developers → Webhooks → Add endpoint, usa `https://A-TUA-LOJA/api/webhooks/stripe` com os eventos:
   - `checkout.session.completed`, `checkout.session.expired`
   - `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   - `invoice.paid`, `invoice.payment_failed`
   - `customer.subscription.updated`, `customer.subscription.deleted`
   - `charge.refunded`, `charge.dispute.created`
3. Copia o **Signing secret** (`whsec_…`) para STRIPE_WEBHOOK_SECRET.
4. Ativa os métodos de pagamento e a moeda USD na conta. Os preços vão em cada checkout (`price_data`), por isso não é obrigatório criar produtos.

### Configurar o PayPal
1. Em developer.paypal.com → Apps & Credentials, cria uma app **Live**. Copia o Client ID e o Secret.
2. Na mesma app, em Webhooks, usa `https://A-TUA-LOJA/api/webhooks/paypal` com os eventos:
   - `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`
   - `CUSTOMER.DISPUTE.CREATED`
   - `BILLING.SUBSCRIPTION.ACTIVATED`, `CANCELLED`, `SUSPENDED`, `EXPIRED`, `PAYMENT.FAILED`
   - `PAYMENT.SALE.COMPLETED`
3. Copia o **Webhook ID** para PAYPAL_WEBHOOK_ID.
4. Para as subscrições, cria em Billing → Plans um plano mensal (US$19,99) e um anual (US$59). Cola os `P-…` em Administração → Configurações → Planos.

## 6. Licenças

- **Chave:** `MMX1-XXXXX-XXXXX-XXXXX-XXXXX` — 100 bits aleatórios em base32 de Crockford, sem I, L, O nem U. A palavra-passe dá acesso à conta; a chave ativa a app.
- **Tipos:** perpétua (versão 1.x), subscrição, demonstração e oferta. As demonstrações e ofertas são emitidas pela administração, individualmente ou em lote até 500, sempre com motivo.
- **Um computador ativo por licença**, garantido por um índice único na base de dados.
  - Reativar no mesmo computador não gasta ativação.
  - Um segundo computador recebe `409 OUTRA_MAQUINA`.
  - Para mudar, desativa-se na app ou na área de cliente.
  - Limite de mudanças configurável (por omissão 3 em 30 dias; acima disso, `429 LIMITE_MUDANCAS`).
  - O suporte pode libertar o computador (avaria ou perda) e repor o limite. Fica auditado.
- **Comprovativo offline** `MMX1.<payload>.<assinatura>`, assinado com ECDSA P-256 / SHA-256 (IEEE-P1363).
  - A chave privada fica só no servidor (`DATA_DIR/keys/license-private.pem`, modo 0600, ou `LICENSE_PRIVATE_KEY_FILE`).
  - A chave pública vai na app.
  - O payload inclui `mb`, os primeiros 32 hex de `sha256("mmx-bind:" + id do computador)`. Um comprovativo copiado para outro computador não serve.
  - **Perpétuas:** `exp = null`, funcionam offline sem limite.
  - **Subscrições:** `exp` = fim do período pago + tolerância (por omissão 7 dias).
  - **Revalidação:** com internet, a app revalida a cada `checkDays` (por omissão 7). Aí aplicam-se revogações, suspensões e desativações remotas.
- **Na app web** (`js/core/license.js`):
  - Só fica ativa quando `config.js` define `LICENSE_API`. Sem isso, nada muda para quem já usa a app.
  - Verifica a assinatura no navegador com WebCrypto.
  - O identificador do computador é aleatório e guardado localmente; não é uma impressão digital.
  - Sem licença, entra em modo de demonstração: exportação limitada (por omissão 60 s em MP3), DDP e WAV+CUE bloqueados. As regras vêm da administração.
- **Limitação honesta:** numa aplicação que corre no navegador, todo o código está nas mãos do utilizador. Isto **dissuade, mas não é DRM**. Numa app nativa assinada, a mesma verificação é mais robusta.

Documentação da API e exemplos: [API-LICENCAS.md](API-LICENCAS.md) e `examples/desktop/` (Node, C++/OpenSSL e JUCE, todos testados contra o servidor).

## 7. Segurança

- **Palavras-passe e tokens:**
  - Palavras-passe em scrypt (N=2¹⁵), com mínimo de 10 caracteres e sem conter o email.
  - Tokens de sessão e de email guardados só como sha256.
- **Sessões e pedidos:**
  - Cookie `mm_s` `HttpOnly; SameSite=Lax; Secure` (em produção).
  - CSRF: cabeçalho `X-MM` mais verificação de `Origin` em todos os pedidos que alteram dados.
  - CSP `script-src 'self'`, sem scripts inline e sem recursos de terceiros (fontes alojadas na loja), mais `X-Frame-Options DENY` e `nosniff`.
- **Login e recuperação:**
  - Limite de 5 tentativas por email e 20 por IP em 15 minutos.
  - As mensagens não revelam se a conta existe; a recuperação responde sempre o mesmo.
- **Equipa:**
  - 2FA (TOTP), que pode ser obrigatória para toda a equipa.
  - As permissões são verificadas **no servidor** (mapa em `src/core.js`). O menu só esconde o que o perfil não pode usar.
  - Ações sensíveis exigem motivo e ficam auditadas: validar, rejeitar, reembolsar, suspender, bloquear, revogar, libertar computador, alterar configurações e credenciais, e ver comprovativos.
- **Credenciais e comprovativos:**
  - As credenciais de prestadores guardadas no painel ficam cifradas (AES-256-GCM com `SECRET_KEY`) e só aparecem mascaradas (`••••1234`).
  - Comprovativos: PDF, JPG ou PNG verificados pelos bytes iniciais, até 10 MB, guardados fora da pasta pública com nome aleatório.
  - Só o dono e a equipa os veem. São servidos com `CSP sandbox`.
- **Administrador inicial:**
  - Criado **só** a partir de `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD` (variáveis de ambiente) e só se ainda não houver nenhum.
  - Guarda-se apenas o hash, e é **obrigatório alterá-la no primeiro acesso**.
  - A palavra-passe nunca está no repositório, no frontend, nos logs nem nas respostas da API (teste 12).
  - Não serve para entrar nas contas dos clientes; não existe palavra-passe universal.

## 8. Instalação (produção)

Requisitos: Node **22.13+** (`node:sqlite`), HTTPS e um disco persistente para `DATA_DIR`.

```bash
# 1. no servidor (VPS) ou num serviço tipo Render com disco persistente
git clone … && cd Mixmastermysong
cp server/.env.example server/.env      # ou variáveis de ambiente no painel do alojamento
# 2. edita: APP_MODE=production, PUBLIC_URL=https://loja…, SECRET_KEY (48+ caracteres aleatórios),
#    ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD (temporária), EMAIL_PROVIDER/EMAIL_API_KEY/EMAIL_FROM, TRUST_PROXY=1 atrás de proxy
npm run loja                              # arranca em PORT (8790); põe atrás de Nginx/Caddy com HTTPS
# 3. entra em https://loja…/entrar, troca a palavra-passe, ativa a 2FA, apaga ADMIN_INITIAL_PASSWORD do ambiente
# 4. Administração → Configurações: Stripe/PayPal, dados bancários, câmbios, impostos, suporte, versões
# 5. Administração → Textos: revê, valida e publica Termos, Privacidade e Reembolsos (a loja só vende depois disto)
# 6. Na app: config.js → LICENSE_API e LICENSE_PUBLIC_KEY (Configurações → Licenciamento → Chave pública)
```

- **Cópias de segurança:** `npm run loja:backup`.
  - Usa `VACUUM INTO` (consistente com o servidor a correr) e inclui os comprovativos e a chave privada.
  - Guarda-as cifradas e fora do servidor. **Sem a chave privada, os comprovativos já emitidos deixam de poder ser renovados com a mesma chave pública.**
- **Dados de demonstração** (só no modo de testes): `npm run loja:demo -- http://localhost:8790`, com `ADMIN_EMAIL` e `ADMIN_PASSWORD` definidas.
- **Modo de testes** (`APP_MODE=test`):
  - Faixa amarela em todas as páginas.
  - Pagamento simulado e dados bancários de **exemplo** claramente marcados.
  - Emails retidos na caixa de saída do painel.
  - Textos em rascunho visíveis como provisórios.

## 9. Configurações de produção pendentes

- [ ] Alojamento Node com HTTPS e disco persistente; domínio (ex.: `loja.mixmind…`).
- [ ] `SECRET_KEY` aleatória (≥ 32 caracteres) — **nunca a mudes depois**: cifra credenciais e o vínculo aos computadores.
- [ ] `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD` definidos **no ambiente do servidor** (fora do repositório); trocar no 1.º acesso; ativar 2FA; remover a variável.
- [ ] Stripe: chave secreta live, webhook e segredo, métodos ativos.
- [ ] PayPal: app live (Client ID/Secret), webhook ID, planos de subscrição (`P-…`) nos planos mensal e anual.
- [ ] Dados bancários reais **Portugal** (titular, banco, IBAN, SWIFT, prazo) e **Angola** (idem, moeda AOA).
- [ ] Câmbios USD→EUR e USD→AOA (e política de atualização).
- [ ] Impostos: regras por país validadas por contabilista (IVA PT, OSS UE, Angola…), modo acrescentado/incluído, e emissão de faturas (não incluída — usar programa certificado).
- [ ] Textos legais (termos, privacidade, reembolsos) revistos por jurista, com os campos “[a preencher]” (responsável, morada, contactos, lei aplicável); validar e publicar.
- [ ] Email transacional: Resend ou Postmark, domínio verificado (SPF/DKIM), `EMAIL_FROM`.
- [ ] Contactos de suporte (email/URL) em Configurações.
- [ ] `config.js` da app com `LICENSE_API` e `LICENSE_PUBLIC_KEY`; `CORS_ORIGINS` se a app tiver outro domínio além de `APP_URL`.
- [ ] Versão publicada em Configurações → Versões (com a ligação da app; instaladores só se existirem).
- [ ] Cópias de segurança automáticas (cron com `npm run loja:backup` + envio cifrado para fora).

## 10. Testes

`npm run test:loja` (também no GitHub Actions):

| # | Validação obrigatória | Teste |
|---|---|---|
| 1 | Compra confirmada emite exatamente uma licença | `server/test/flows.test.mjs` · 1 |
| 2 | Pagamento pendente não concede licença | · 2 |
| 3 | Borderô enviado não ativa a licença | · 3 (+ interface em `pages.test.mjs`) |
| 4 | Transferência só ativa depois da aprovação (sem duplicar) | · 4 (+ interface) |
| 5 | Segunda máquina recusada enquanto a primeira está ativa | · 5 (+ app em `tests/license.test.mjs`) |
| 6 | Mudança de computador, limite e recuperação administrativa | · 6 |
| 7 | Cancelar subscrição mantém o acesso até ao fim do período | · 7 |
| 8 | Perpétua não expira com o fim de uma subscrição | · 8 |
| 9 | Eventos repetidos não duplicam pagamentos nem licenças | · 9 |
| 10 | Um cliente não vê dados nem comprovativos de outro | · 10 |
| 11 | Licença funciona offline dentro das regras | · 11 (+ navegador e C++/Node em `examples.test.mjs`) |
| 12 | Palavra-passe inicial do administrador não fica exposta | · 12 (repositório, frontend, API, logs, base de dados) |

**Testes extra:**

- permissões por perfil;
- limite de tentativas;
- conta suspensa versus licença;
- 2FA e CSRF;
- reembolso e contestação;
- painel por moeda;
- textos legais (validar e publicar);
- interface completa da loja no Chromium;
- licença na app: ativação, adulteração, outro computador, revogação e corte do export na demonstração;
- exemplos de integração desktop.
