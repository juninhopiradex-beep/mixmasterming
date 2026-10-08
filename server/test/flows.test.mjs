// Fluxos críticos da loja e do licenciamento (os 12 obrigatórios + segurança). `node --no-warnings test/flows.test.mjs`
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { test, ok, summary } from '../../tests/load.mjs';
import { startAll, client, stripeSig } from './harness.mjs';
import { verifyToken } from '../src/licensing.js';
import { runJobs } from '../src/jobs.js';
import { totp } from '../src/security.js';
import { ROOT } from '../src/config.js';

const S = await startAll();
const { ctx, base } = S, db = ctx.db;
const eq = (a, b, what) => ok(a === b, `${what}: ${JSON.stringify(a)} (esperado ${JSON.stringify(b)})`);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('comprovativo de teste\n%%EOF')]);
const licCount = (uid) => db.get('SELECT COUNT(*) n FROM licenses WHERE user_id = ?', uid).n;
const uidOf = (email) => db.get('SELECT id FROM users WHERE email = ?', email).id;
async function buyer(email, plan, method, country = 'PT') {
  const c = client(base);
  const r = await c.post('/api/checkout', { plan, method, country, name: 'Cliente ' + email.split('@')[0], email, password: 'Palavra-passe-segura-1', acceptTerms: true, acceptPrivacy: true });
  return { c, r, ref: r.body && r.body.ref };
}
const orderByRef = (ref) => db.get('SELECT * FROM orders WHERE ref = ?', ref);
const verifyAll = () => db.run("UPDATE users SET email_verified_at = ?, status = CASE WHEN status = 'pending' THEN 'active' ELSE status END WHERE role = 'customer'", Date.now());

// equipa: administrador inicial (troca obrigatória) + financeiro + suporte
const admin = client(base);
let adminPw = 'Gestor-Loja-Forte-2026!';
async function setupStaff() {
  let r = await admin.post('/api/auth/login', { email: 'admin@loja.test', password: S.adminPw });
  eq(r.status, 200, 'login admin'); ok(r.body.mustChangePassword, 'troca obrigatória');
  r = await admin.get('/api/admin/dashboard'); eq(r.body.code, 'TROCA_PALAVRA_PASSE', 'admin bloqueado até trocar');
  r = await admin.post('/api/auth/change-password', { current: S.adminPw, password: adminPw }); eq(r.status, 200, 'troca');
  r = await admin.get('/api/admin/dashboard'); eq(r.status, 200, 'dashboard depois da troca');
}

console.log('Loja e licenças · fluxos obrigatórios');
await test('0. administrador inicial: troca obrigatória da palavra-passe no primeiro acesso', setupStaff);

await test('1. uma compra confirmada emite exatamente uma licença', async () => {
  const { c, ref } = await buyer('ana@ex.test', 'perpetual', 'test');
  ok(ref, 'encomenda criada');
  let r = await c.post('/api/test/simulate', { ref, outcome: 'paid' }); eq(r.status, 200, 'simulação');
  eq(orderByRef(ref).status, 'confirmed', 'estado');
  eq(licCount(uidOf('ana@ex.test')), 1, 'licenças');
  r = await c.post('/api/test/simulate', { ref, outcome: 'paid' }); // novo evento para o mesmo pagamento
  eq(licCount(uidOf('ana@ex.test')), 1, 'licenças depois de novo evento');
  // cartão (Stripe): checkout alojado + webhook assinado
  const s = await buyer('bia@ex.test', 'perpetual', 'card'); ok(/checkout\.stripe/.test(s.r.body.redirect), 'redireciona para o Stripe');
  const o = orderByRef(s.ref), ev = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', amount_total: o.amount_cents, currency: 'usd', metadata: { order_id: o.id } } } });
  r = await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Stripe-Signature': stripeSig('whsec_test', ev), 'Content-Type': 'application/json' }, body: ev });
  eq(r.status, 200, 'webhook');
  eq(licCount(uidOf('bia@ex.test')), 1, 'licença Stripe');
});

await test('2. um pagamento pendente não concede licença paga', async () => {
  const { ref } = await buyer('caio@ex.test', 'perpetual', 'card');
  eq(orderByRef(ref).status, 'pending', 'pendente');
  eq(licCount(uidOf('caio@ex.test')), 0, 'sem licença');
  // o browser a chegar à página de sucesso não muda nada
  const c2 = client(base); await c2.get('/conta'); eq(orderByRef(ref).status, 'pending', 'continua pendente');
});

let bank; // reutilizado no teste 4
await test('3. um borderô enviado não ativa automaticamente a licença', async () => {
  bank = await buyer('dora@ex.test', 'annual', 'bank_pt');
  ok(bank.r.body.redirect.includes('#encomenda/'), 'vai para as instruções');
  const o = orderByRef(bank.ref); eq(o.currency, 'EUR', 'cobrança em EUR'); ok(o.fx_rate > 0, 'câmbio aplicado');
  let r = await bank.c.raw('POST', `/api/account/orders/${bank.ref}/proofs?filename=borderô.pdf&amount=72,57&date=2026-10-07&ref=${bank.ref}`, PDF, { 'Content-Type': 'application/pdf' });
  eq(r.status, 200, 'upload'); eq(r.body.message, 'Comprovativo recebido. O pagamento encontra-se a aguardar validação.', 'mensagem');
  eq(orderByRef(bank.ref).status, 'awaiting_validation', 'aguarda validação');
  eq(licCount(uidOf('dora@ex.test')), 0, 'sem licença');
  // ficheiros inválidos
  r = await bank.c.raw('POST', `/api/account/orders/${bank.ref}/proofs?filename=x.exe`, Buffer.from('MZ\x90\x00binário'), { 'Content-Type': 'application/octet-stream' }); eq(r.status, 415, 'formato recusado');
});

await test('4. a transferência só ativa a compra depois da aprovação administrativa (sem duplicar)', async () => {
  const o = orderByRef(bank.ref);
  let r = await admin.post(`/api/admin/orders/${o.id}/approve`, {}); eq(r.body.code, 'CONFIRMACAO', 'exige confirmação da entrada do dinheiro');
  r = await admin.post(`/api/admin/orders/${o.id}/approve`, { confirmReceived: true, note: 'Extrato 07/10 verificado' }); eq(r.status, 200, 'aprovada');
  eq(licCount(uidOf('dora@ex.test')), 1, 'licença emitida');
  r = await admin.post(`/api/admin/orders/${o.id}/approve`, { confirmReceived: true }); eq(r.body.duplicate, true, 'segunda aprovação idempotente');
  eq(licCount(uidOf('dora@ex.test')), 1, 'continua uma licença');
  const sub = db.get('SELECT * FROM subscriptions WHERE user_id = ?', uidOf('dora@ex.test')); eq(sub.auto_renew, 0, 'transferência = renovação manual');
  ok(db.get("SELECT 1 FROM audit_log WHERE action = 'transfer.approve' AND actor_email = 'admin@loja.test'"), 'auditoria');
  // rejeição exige motivo
  const b2 = await buyer('edu@ex.test', 'perpetual', 'bank_ao', 'AO');
  eq(orderByRef(b2.ref).currency, 'AOA', 'Angola em kwanzas');
  await b2.c.raw('POST', `/api/account/orders/${b2.ref}/proofs?filename=b.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]), { 'Content-Type': 'image/png' });
  r = await admin.post(`/api/admin/orders/${orderByRef(b2.ref).id}/reject`, {}); eq(r.status, 400, 'motivo obrigatório');
  r = await admin.post(`/api/admin/orders/${orderByRef(b2.ref).id}/reject`, { reason: 'Valor recebido não corresponde' }); eq(r.status, 200, 'rejeitado');
  eq(licCount(uidOf('edu@ex.test')), 0, 'sem licença');
});

verifyAll();
const keyOf = (email) => db.get('SELECT key FROM licenses WHERE user_id = ? ORDER BY issued_at LIMIT 1', uidOf(email)).key;
const app = client(base);
const act = (key, mid, name) => app.post('/api/v1/licenses/activate', { key, machineId: mid, machineName: name || mid, platform: 'macOS', appVersion: '1.8.0' });
let tokPerp;
await test('5. uma segunda máquina é recusada enquanto a primeira estiver ativa', async () => {
  const key = keyOf('ana@ex.test');
  let r = await act(key, 'machine-A-0001', 'Mac do estúdio'); eq(r.status, 200, 'ativa A'); tokPerp = r.body.token;
  r = await act(key, 'machine-B-0002', 'Portátil'); eq(r.status, 409, 'B recusada'); eq(r.body.code, 'OUTRA_MAQUINA', 'código');
  r = await act(key.toLowerCase().replace(/-/g, ''), 'machine-A-0001'); eq(r.status, 200, 'A reinstalada (mesma máquina)'); eq(r.body.reused, true, 'sem gastar ativação');
  eq(db.get('SELECT COUNT(*) n FROM devices WHERE license_id = (SELECT id FROM licenses WHERE key = ?)', key).n, 1, 'um só registo de máquina');
  // uma conta com duas licenças autoriza dois computadores (uma máquina por licença)
  const b = await buyer('ana2@ex.test', 'perpetual', 'test'); await b.c.post('/api/test/simulate', { ref: b.ref, outcome: 'paid' });
  const b2 = await b.c.post('/api/checkout', { plan: 'monthly', method: 'test', country: 'PT', acceptTerms: true, acceptPrivacy: true });
  await b.c.post('/api/test/simulate', { ref: b2.body.ref, outcome: 'paid' });
  const keys = db.all('SELECT key FROM licenses WHERE user_id = ?', uidOf('ana2@ex.test')).map((x) => x.key); eq(keys.length, 2, 'duas licenças');
  eq((await act(keys[0], 'pc-1-xxxxxxxx')).status, 200, 'pc 1'); eq((await act(keys[1], 'pc-2-xxxxxxxx')).status, 200, 'pc 2');
});

await test('6. mudança de computador: desativar → ativar o novo; limite de trocas; recuperação administrativa', async () => {
  const key = keyOf('ana@ex.test'), lic = db.get('SELECT * FROM licenses WHERE key = ?', key);
  const ana = client(base); await ana.post('/api/auth/login', { email: 'ana@ex.test', password: 'Palavra-passe-segura-1' });
  let r = await ana.post(`/api/account/licenses/${lic.id}/deactivate`); eq(r.status, 200, 'desativada na área de cliente');
  r = await act(key, 'machine-B-0002', 'Portátil'); eq(r.status, 200, 'B ativa');
  // a app também desativa (só a própria máquina)
  r = await app.post('/api/v1/licenses/deactivate', { key, machineId: 'machine-X' }); eq(r.status, 403, 'outra máquina não desativa');
  r = await app.post('/api/v1/licenses/deactivate', { key, machineId: 'machine-B-0002' }); eq(r.status, 200, 'desativa na app');
  r = await act(key, 'machine-C-0003'); eq(r.status, 200, 'C (3.ª ativação em 30 dias)');
  await app.post('/api/v1/licenses/deactivate', { key, machineId: 'machine-C-0003' });
  r = await act(key, 'machine-D-0004'); eq(r.status, 429, 'limite de trocas atingido'); eq(r.body.code, 'LIMITE_MUDANCAS', 'código');
  r = await admin.post(`/api/admin/licenses/${lic.id}/release-device`, { reason: 'Avaria do computador — confirmado por email', resetLimit: true }); eq(r.status, 200, 'recuperação administrativa');
  r = await act(key, 'machine-D-0004'); eq(r.status, 200, 'D ativa depois da recuperação');
  ok(db.all('SELECT action FROM license_events WHERE license_id = ?', lic.id).length >= 8, 'histórico completo');
});

await test('7. cancelar uma subscrição mantém o acesso até ao fim do período pago', async () => {
  const u = uidOf('ana2@ex.test'), sub = db.get('SELECT * FROM subscriptions WHERE user_id = ?', u), lic = db.get('SELECT * FROM licenses WHERE subscription_id = ?', sub.id);
  const c = client(base); await c.post('/api/auth/login', { email: 'ana2@ex.test', password: 'Palavra-passe-segura-1' });
  let r = await c.post(`/api/account/subscriptions/${sub.id}/cancel`); eq(r.status, 200, 'cancelada'); eq(r.body.accessUntil, sub.current_period_end, 'acesso até ao fim do período');
  eq(db.get('SELECT status FROM licenses WHERE id = ?', lic.id).status, 'active', 'licença continua ativa');
  r = await app.post('/api/v1/licenses/validate', { key: lic.key, machineId: 'pc-2-xxxxxxxx' }); eq(r.body.ok, true, 'valida agora');
  const real = ctx.now; ctx.now = () => sub.current_period_end - 864e5; runJobs(ctx);
  r = await app.post('/api/v1/licenses/validate', { key: lic.key, machineId: 'pc-2-xxxxxxxx' }); eq(r.body.ok, true, 'véspera do fim: válida');
  const grace = 7 * 864e5; ctx.now = () => sub.current_period_end + grace + 3600e3; runJobs(ctx);
  r = await app.post('/api/v1/licenses/validate', { key: lic.key, machineId: 'pc-2-xxxxxxxx' }); eq(r.body.ok, false, 'depois do período + tolerância: termina'); eq(r.body.code, 'EXPIRADA', 'código');
  eq(db.get('SELECT status FROM subscriptions WHERE id = ?', sub.id).status, 'expired', 'subscrição expirada');
  ctx.now = real;
});

await test('8. uma licença perpétua não expira com o fim de uma subscrição', async () => {
  const u = uidOf('ana2@ex.test'), per = db.get("SELECT * FROM licenses WHERE user_id = ? AND type = 'perpetual'", u);
  const real = ctx.now; ctx.now = () => Date.now() + 5 * 365 * 864e5; runJobs(ctx);
  const r = await app.post('/api/v1/licenses/validate', { key: per.key, machineId: 'pc-1-xxxxxxxx' }); eq(r.body.ok, true, 'perpétua válida daqui a 5 anos');
  eq(db.get('SELECT status FROM licenses WHERE id = ?', per.id).status, 'active', 'continua ativa');
  ctx.now = real;
});

// os testes 7 e 8 avançaram o relógio e as tarefas limparam as sessões "expiradas": voltar a entrar
await admin.post('/api/auth/login', { email: 'admin@loja.test', password: adminPw });
await bank.c.post('/api/auth/login', { email: 'dora@ex.test', password: 'Palavra-passe-segura-1' });

await test('9. eventos repetidos não duplicam pagamentos nem licenças (Stripe, PayPal, simulado)', async () => {
  const s = await buyer('fabio@ex.test', 'monthly', 'card'), o = orderByRef(s.ref);
  const inv = (id, reason, end) => JSON.stringify({ id, type: 'invoice.paid', data: { object: { id: 'in_' + id, billing_reason: reason, subscription: 'sub_F1', amount_paid: o.amount_cents, currency: 'usd', subscription_details: { metadata: { order_id: o.id } }, lines: { data: [{ period: { end: Math.floor(end / 1000) } }] } } } });
  const send = (raw) => fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Stripe-Signature': stripeSig('whsec_test', raw) }, body: raw }).then((r) => r.json());
  const e1 = inv('evt_s1', 'subscription_create', Date.now() + 30 * 864e5);
  await send(e1); const again = await send(e1); eq(again.duplicate, true, 'mesmo evento → ignorado');
  await send(inv('evt_s1b', 'subscription_create', Date.now() + 30 * 864e5)); // outro evento com o mesmo pagamento
  const u = uidOf('fabio@ex.test');
  eq(licCount(u), 1, 'uma licença'); eq(db.get("SELECT COUNT(*) n FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.user_id = ?", u).n, 1, 'um pagamento');
  // renovação: dois envios do mesmo evento estendem uma vez
  const e2 = inv('evt_s2', 'subscription_cycle', Date.now() + 61 * 864e5); await send(e2); await send(e2);
  const sub = db.get("SELECT * FROM subscriptions WHERE provider_sub_id = 'sub_F1'");
  ok(Math.abs(sub.current_period_end - (Date.now() + 61 * 864e5)) < 5000, 'período estendido');
  eq(db.get("SELECT COUNT(*) n FROM orders WHERE subscription_id = ? AND kind = 'renewal'", sub.id).n, 1, 'uma renovação');
  // assinatura errada → recusado
  const bad = await fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'Stripe-Signature': stripeSig('outro', e1) }, body: e1 }); eq(bad.status, 400, 'assinatura inválida recusada');
  // PayPal: regresso + webhook da mesma captura
  const p = await buyer('gil@ex.test', 'perpetual', 'paypal'); ok(/paypal/.test(p.r.body.redirect), 'redireciona para o PayPal');
  const po = orderByRef(p.ref);
  let r = await fetch(`${base}/api/pay/paypal/return?o=${po.id}`, { redirect: 'manual' }); eq(r.status, 302, 'regresso');
  const cap = { id: 'WH-PP-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP' + po.provider_ref, custom_id: po.id, amount: { currency_code: 'USD', value: '99.00' } } };
  r = await fetch(base + '/api/webhooks/paypal', { method: 'POST', headers: { 'paypal-transmission-sig': 'ok', 'Content-Type': 'application/json' }, body: JSON.stringify(cap) }); eq(r.status, 200, 'webhook PayPal');
  eq(licCount(uidOf('gil@ex.test')), 1, 'uma licença PayPal');
  r = await fetch(base + '/api/webhooks/paypal', { method: 'POST', headers: { 'paypal-transmission-sig': 'mau' }, body: JSON.stringify({ ...cap, id: 'WH-PP-2' }) }); eq(r.status, 400, 'assinatura PayPal falsa recusada');
});

await test('10. um cliente não consegue consultar dados ou comprovativos de outro', async () => {
  const intruso = client(base); await intruso.post('/api/auth/login', { email: 'ana@ex.test', password: 'Palavra-passe-segura-1' });
  const proof = db.get('SELECT * FROM proofs WHERE user_id = ?', uidOf('dora@ex.test'));
  let r = await intruso.get(`/api/account/proofs/${proof.id}/file`); eq(r.status, 404, 'comprovativo alheio');
  r = await intruso.get(`/api/account/orders/${bank.ref}`); eq(r.status, 404, 'encomenda alheia');
  const lic = db.get('SELECT id FROM licenses WHERE user_id = ?', uidOf('dora@ex.test'));
  r = await intruso.post(`/api/account/licenses/${lic.id}/deactivate`); eq(r.status, 404, 'licença alheia');
  r = await intruso.get('/api/admin/customers'); eq(r.status, 403, 'painel de administração');
  r = await intruso.get('/api/account/overview'); ok(!JSON.stringify(r.body).includes('dora@ex.test'), 'resumo só com os próprios dados');
  r = await bank.c.get(`/api/account/proofs/${proof.id}/file`); eq(r.status, 200, 'o dono vê o seu comprovativo');
  r = await admin.get(`/api/admin/proofs/${proof.id}/file`); eq(r.status, 200, 'a equipa autorizada vê');
});

await test('11. a licença funciona offline dentro das regras (comprovativo assinado, chave pública)', async () => {
  const pk = await (await fetch(base + '/api/v1/licenses/public-key')).json();
  const pub = crypto.createPublicKey({ key: Buffer.from(pk.spki, 'base64'), format: 'der', type: 'spki' });
  const v = verifyToken(tokPerp, pub, Date.now() + 10 * 365 * 864e5); eq(v.ok, true, 'perpétua válida offline daqui a 10 anos'); eq(v.payload.exp, null, 'sem expiração');
  const sub = db.get("SELECT l.key FROM licenses l JOIN subscriptions s ON s.id = l.subscription_id WHERE s.provider_sub_id = 'sub_F1'");
  const r = await act(sub.key, 'mac-sub-0001'); const t = r.body.token, p = verifyToken(t, pub).payload;
  ok(verifyToken(t, pub, p.until).ok, 'subscrição válida no fim do período pago');
  ok(verifyToken(t, pub, p.until + 6 * 864e5).ok, 'válida dentro da tolerância (7 dias)');
  eq(verifyToken(t, pub, p.until + 8 * 864e5).why, 'expirado', 'expira depois da tolerância');
  const parts = t.split('.'), forged = JSON.parse(Buffer.from(parts[1], 'base64url')); forged.exp = null;
  eq(verifyToken(parts[0] + '.' + Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + parts[2], pub).why, 'assinatura', 'comprovativo alterado é recusado');
  ok(!JSON.stringify(pk).includes('PRIVATE'), 'a chave privada nunca sai do servidor');
});

await test('12. a palavra-passe inicial do administrador não fica exposta (código, frontend, API, logs, base de dados)', async () => {
  const pw = S.adminPw, hits = [];
  const scan = (dir) => { for (const f of fs.readdirSync(dir)) { if (['node_modules', '.git', 'data'].includes(f)) continue; const p = path.join(dir, f), st = fs.statSync(p); if (st.isDirectory()) scan(p); else if (st.size < 5e6 && fs.readFileSync(p).includes(pw)) hits.push(p); } };
  scan(path.resolve(ROOT, '..'));
  eq(hits.length, 0, 'repositório e frontend ' + hits.join(','));
  const dbFile = fs.readdirSync(S.dir).filter((f) => f.endsWith('.db') || f.endsWith('-wal')).map((f) => fs.readFileSync(path.join(S.dir, f)));
  ok(!dbFile.some((b) => b.includes(pw)), 'base de dados guarda só o hash');
  ok(db.get("SELECT password_hash h FROM users WHERE email = 'admin@loja.test'").h.startsWith('scrypt$'), 'hash scrypt');
  ok(!S.logs.join('\n').includes(pw), 'logs');
  for (const p of ['/api/auth/me', '/api/admin/staff', '/api/admin/settings', '/api/admin/audit', '/api/admin/emails']) { const r = await admin.get(p); ok(!r.text.includes(pw) && !r.text.includes('scrypt$'), 'resposta ' + p); }
  // a palavra-passe inicial deixa de funcionar depois da troca
  const r = await client(base).post('/api/auth/login', { email: 'admin@loja.test', password: pw }); eq(r.status, 401, 'palavra-passe inicial já não entra');
});

console.log('Segurança e administração');
await test('permissões no servidor: suporte não valida pagamentos; financeiro não revoga licenças', async () => {
  await admin.post('/api/admin/staff', { email: 'fin@loja.test', name: 'Finanças', role: 'finance' });
  await admin.post('/api/admin/staff', { email: 'sup@loja.test', name: 'Suporte', role: 'support' });
  const setPw = async (email) => { const u = db.get('SELECT id FROM users WHERE email = ?', email); const t = crypto.randomBytes(16).toString('base64url'); db.run("INSERT INTO tokens VALUES (?,?,'invite',?,?,NULL)", crypto.createHash('sha256').update(t).digest('hex'), u.id, Date.now(), Date.now() + 864e5); const c = client(base); await c.post('/api/auth/reset', { token: t, password: 'Equipa-palavra-passe-1' }); await c.post('/api/auth/login', { email, password: 'Equipa-palavra-passe-1' }); return c; };
  const fin = await setPw('fin@loja.test'), sup = await setPw('sup@loja.test');
  const ivo = await buyer('ivo@ex.test', 'perpetual', 'bank_ao', 'AO'), o = orderByRef(ivo.ref);
  eq((await sup.post(`/api/admin/orders/${o.id}/approve`, { confirmReceived: true })).status, 403, 'suporte não aprova');
  const lic = db.get("SELECT id FROM licenses WHERE type = 'perpetual' LIMIT 1");
  eq((await fin.post(`/api/admin/licenses/${lic.id}/status`, { status: 'revoked', reason: 'teste' })).status, 403, 'financeiro não revoga');
  eq((await sup.post(`/api/admin/licenses/${lic.id}/status`, { status: 'suspended', reason: 'Verificação de fraude' })).status, 200, 'suporte suspende');
  eq((await sup.post(`/api/admin/licenses/${lic.id}/status`, { status: 'active', reason: 'Verificado' })).status, 200, 'suporte reativa');
  eq((await fin.put('/api/admin/settings/bank_pt', { value: {} })).status, 403, 'financeiro não altera configurações');
});
await test('login: limite de tentativas, mensagens genéricas e conta suspensa ≠ licença revogada', async () => {
  const c = client(base);
  for (let i = 0; i < 5; i++) { const r = await c.post('/api/auth/login', { email: 'caio@ex.test', password: 'errada' + i }); eq(r.status, 401, 'tentativa ' + i); }
  let r = await c.post('/api/auth/login', { email: 'caio@ex.test', password: 'Palavra-passe-segura-1' }); eq(r.status, 429, 'bloqueio temporário');
  r = await c.post('/api/auth/login', { email: 'ninguem@ex.test', password: 'x' }); eq(r.body.error, 'Email ou palavra-passe incorretos.', 'não revela se o email existe');
  // suspender o login não revoga a licença
  const u = uidOf('dora@ex.test');
  r = await admin.post(`/api/admin/customers/${u}/status`, { status: 'suspended', reason: 'Pedido do cliente' }); ok(/licenças continuam/.test(r.body.consequence), 'consequência explicada');
  r = await client(base).post('/api/auth/login', { email: 'dora@ex.test', password: 'Palavra-passe-segura-1' }); eq(r.status, 403, 'login suspenso');
  const key = db.get('SELECT key FROM licenses WHERE user_id = ?', u).key;
  r = await act(key, 'dora-pc-000001'); eq(r.status, 200, 'licença continua a ativar');
  await admin.post(`/api/admin/customers/${u}/status`, { status: 'active', reason: 'Reposto' });
});
await test('2FA (TOTP) da equipa e proteção CSRF', async () => {
  let r = await admin.post('/api/auth/mfa/setup'); const secret = r.body.secret; ok(/^[A-Z2-7]{32}$/.test(secret), 'segredo base32');
  r = await admin.post('/api/auth/mfa/enable', { code: totp(secret) }); eq(r.status, 200, '2FA ativa');
  const c = client(base); r = await c.post('/api/auth/login', { email: 'admin@loja.test', password: adminPw }); eq(r.body.mfaPending, true, 'pede código');
  r = await c.get('/api/admin/dashboard'); eq(r.body.code, 'MFA_PENDENTE', 'sem código não entra');
  r = await c.post('/api/auth/mfa', { code: '000000' }); eq(r.status, 401, 'código errado');
  r = await c.post('/api/auth/mfa', { code: totp(secret) }); eq(r.status, 200, 'código certo');
  r = await c.get('/api/admin/dashboard'); eq(r.status, 200, 'entra');
  r = await c.raw('POST', '/api/admin/customers', JSON.stringify({ name: 'X', email: 'x@ex.test' }), { 'X-MM': '', 'Content-Type': 'application/json' }); eq(r.body.code, 'CSRF', 'sem cabeçalho anti-CSRF é recusado');
});
await test('reembolso revoga a licença; contestação suspende; dashboard separa moedas', async () => {
  const s = await buyer('hugo@ex.test', 'perpetual', 'test'); await s.c.post('/api/test/simulate', { ref: s.ref, outcome: 'paid' });
  await s.c.post('/api/test/simulate', { ref: s.ref, outcome: 'refund' });
  eq(db.get('SELECT status FROM licenses WHERE user_id = ?', uidOf('hugo@ex.test')).status, 'revoked', 'revogada');
  const d = await admin.get('/api/admin/dashboard');
  const curs = d.body.revenue.map((x) => x.currency); ok(curs.includes('USD') && curs.includes('EUR'), 'receita por moeda: ' + curs.join(','));
  ok(new Set(curs).size === curs.length, 'uma linha por moeda (sem somar moedas)');
});
await test('textos legais: só se publicam depois de validados; emails ficam na caixa de saída (testes)', async () => {
  let r = await admin.post('/api/admin/texts/terms/publish'); eq(r.body.code, 'POR_VALIDAR', 'publicar sem validar');
  r = await admin.post('/api/admin/texts/terms/validate', { confirm: true, reviewer: 'Advogado X' }); eq(r.status, 200, 'validado');
  r = await admin.post('/api/admin/texts/terms/publish'); eq(r.status, 200, 'publicado');
  r = await client(base).get('/api/public/text/terms'); eq(r.body.provisional, false, 'público vê a versão publicada');
  const tpl = db.all('SELECT DISTINCT template FROM emails').map((x) => x.template);
  for (const t of ['account_confirm', 'order_created', 'transfer_instructions', 'proof_received', 'payment_approved', 'payment_rejected', 'license_issued', 'device_changed', 'subscription_cancelled', 'renewed', 'invite']) ok(tpl.includes(t), 'email ' + t);
  ok(!db.all('SELECT body FROM emails').some((e) => e.body.includes('scrypt$') || e.body.includes(S.adminPw)), 'emails sem segredos');
});

S.close();
summary();
