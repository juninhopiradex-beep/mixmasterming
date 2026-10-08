// Painel de administração. Todas as operações verificam permissões NO SERVIDOR e as sensíveis ficam auditadas.
import fs from 'node:fs';
import { fail, send } from '../http.js';
import { getSetting, setSetting, getText, audit, fmtMoney, annualSaving, ROLES, permsOf, mail } from '../core.js';
import { proofPath, approveTransfer, proofDecision, METHOD_LABEL, stripe, paypal } from '../payments/index.js';
import { reverseOrder } from '../payments/orders.js';
import { issueLicense, setLicenseStatus, deactivate, licEvent, signingKeys } from '../licensing.js';
import { createCustomer, sendReset } from './auth.js';
import { requireStaff, str, emailOk, safeUser } from './util.js';
import { uuid } from '../security.js';

const reasonOf = (b) => { const r = str(b.reason, 500); if (r.length < 3) fail(400, 'O motivo é obrigatório.', 'MOTIVO_OBRIGATORIO'); return r; };
const like = (q) => '%' + String(q || '').replace(/[%_]/g, '') + '%';

export default function register(r, ctx) {
  const db = ctx.db;

  // ---------- dashboard ----------
  r.get('/api/admin/dashboard', (req) => {
    requireStaff(req, 'dashboard.view');
    const now = ctx.now(), from = +req.query.from || now - 30 * 864e5, to = +req.query.to || now;
    // receita por moeda: nunca se somam moedas diferentes
    const revenue = db.all(`SELECT p.currency, SUM(CASE WHEN p.status = 'confirmed' THEN p.amount_cents ELSE 0 END) gross, SUM(CASE WHEN p.status = 'refunded' THEN p.amount_cents ELSE 0 END) refunded, COUNT(*) n
      FROM payments p WHERE p.created_at BETWEEN ? AND ? AND p.status IN ('confirmed','refunded','disputed') GROUP BY p.currency`, from, to).map((x) => ({ ...x, grossFmt: fmtMoney(x.gross, x.currency), refundedFmt: fmtMoney(x.refunded, x.currency) }));
    const c = (sql, ...a) => db.get(sql, ...a).n;
    const daily = db.all(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') d, currency, SUM(amount_cents) v FROM payments WHERE status = 'confirmed' AND created_at BETWEEN ? AND ? GROUP BY d, currency ORDER BY d`, from, to);
    return {
      from, to, revenue, daily,
      subs: { active: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'active'"), past_due: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'past_due'"), cancelled: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'cancelled' OR cancel_at_period_end = 1"), expired: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'expired'"), expiring: c("SELECT COUNT(*) n FROM subscriptions WHERE status IN ('active','past_due') AND current_period_end BETWEEN ? AND ?", now, now + 7 * 864e5) },
      perpetual: c("SELECT COUNT(*) n FROM licenses WHERE type = 'perpetual'"),
      customers: c("SELECT COUNT(*) n FROM users WHERE role = 'customer'"), activeDevices: c('SELECT COUNT(*) n FROM devices WHERE deactivated_at IS NULL'),
      transfersPending: c("SELECT COUNT(*) n FROM orders WHERE method IN ('bank_pt','bank_ao') AND status = 'pending'"), proofsToReview: c("SELECT COUNT(*) n FROM orders WHERE status = 'awaiting_validation'"),
      failed: c("SELECT COUNT(*) n FROM orders WHERE status = 'failed' AND updated_at BETWEEN ? AND ?", from, to), refunds: c("SELECT COUNT(*) n FROM orders WHERE status = 'refunded'"), disputes: c("SELECT COUNT(*) n FROM orders WHERE status = 'disputed'"),
      warnings: warnings(),
    };
  });
  function warnings() {
    const w = [];
    for (const k of ['terms', 'privacy', 'refund']) { const t = getText(ctx, k); if (!t.published) w.push(`Texto legal por validar e publicar: ${t.title}`); }
    for (const k of ['bank_pt', 'bank_ao']) { const b = getSetting(ctx, k); if (b.example) w.push(`Dados bancários ${k === 'bank_pt' ? 'PT' : 'AO'} são de EXEMPLO (modo de testes)`); else if (!b.iban) w.push(`Dados bancários ${k === 'bank_pt' ? 'PT' : 'AO'} por preencher`); }
    if (!stripe.stripeConfigured(ctx)) w.push('Stripe (cartões) por configurar');
    if (!paypal.paypalConfigured(ctx)) w.push('PayPal por configurar');
    const rates = getSetting(ctx, 'currencies').rates; for (const [k, v] of Object.entries(rates)) { if (!v.rate) w.push(`Câmbio USD→${k} por configurar`); else if (v.note) w.push(`Câmbio USD→${k}: ${v.note}`); }
    if (ctx.cfg.email.provider === 'outbox') w.push('Emails em modo de testes (ficam na caixa de saída, não são enviados)');
    if (ctx.cfg.mode === 'test') w.push('MODO DE TESTES ativo — pagamentos simulados disponíveis');
    return w;
  }

  // ---------- clientes ----------
  r.get('/api/admin/customers', (req) => {
    requireStaff(req, 'customers.view');
    const q = str(req.query.q, 100), st = str(req.query.status, 20);
    return db.all(`SELECT u.*, (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id) licenses, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'confirmed') purchases
      FROM users u WHERE u.role = 'customer' AND (u.email LIKE ? OR u.name LIKE ?) AND (? = '' OR u.status = ?) ORDER BY u.created_at DESC LIMIT 200`, like(q), like(q), st, st)
      .map((u) => ({ ...safeUser(u), licenses: u.licenses, purchases: u.purchases }));
  });
  r.post('/api/admin/customers', (req) => {
    const a = requireStaff(req, 'customers.edit'), b = req.body;
    const u = createCustomer(ctx, { name: b.name, email: b.email, country: b.country });
    if (b.sendInvite !== false) sendReset(ctx, u, 'invite');
    audit(ctx, a, 'customer.create', ['user', u.id], { email: u.email, invite: b.sendInvite !== false });
    return safeUser(u);
  });
  r.get('/api/admin/customers/:id', (req) => {
    requireStaff(req, 'customers.view');
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id); if (!u) fail(404, 'Cliente inexistente.', 'NAO_EXISTE');
    return {
      user: safeUser(u),
      orders: db.all('SELECT o.*, p.name plan_name FROM orders o JOIN plans p ON p.id = o.plan_id WHERE user_id = ? ORDER BY created_at DESC', u.id).map((o) => ({ id: o.id, ref: o.ref, plan: o.plan_name, kind: o.kind, method: METHOD_LABEL[o.method], status: o.status, amount: fmtMoney(o.amount_cents, o.currency), created_at: o.created_at })),
      payments: db.all('SELECT p.*, o.ref FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.user_id = ? ORDER BY p.created_at DESC', u.id).map((p) => ({ ref: p.ref, provider: p.provider, status: p.status, amount: fmtMoney(p.amount_cents, p.currency), created_at: p.created_at, confirmed_by: p.confirmed_by })),
      subscriptions: db.all('SELECT s.*, p.name plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE user_id = ?', u.id),
      licenses: db.all('SELECT l.id, l.key, l.type, l.status, l.expires_at, l.issued_at, (SELECT name FROM devices d WHERE d.license_id = l.id AND d.deactivated_at IS NULL) device FROM licenses l WHERE user_id = ?', u.id),
      sessions: db.get('SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?', u.id, ctx.now()).n,
      audit: db.all("SELECT at, actor_email, action, reason FROM audit_log WHERE target_type = 'user' AND target_id = ? ORDER BY at DESC LIMIT 30", u.id),
    };
  });
  r.patch('/api/admin/customers/:id', (req) => {
    const a = requireStaff(req, 'customers.edit'), b = req.body;
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id); if (!u) fail(404, 'Cliente inexistente.', 'NAO_EXISTE');
    const email = b.email !== undefined ? str(b.email, 254).toLowerCase() : u.email;
    if (!emailOk(email)) fail(400, 'Email inválido.', 'EMAIL');
    if (email !== u.email && db.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Email já usado por outra conta.', 'EMAIL_EXISTE');
    db.run('UPDATE users SET name = ?, email = ?, country = ?, billing_name = ?, billing_address = ?, tax_id = ?, email_verified_at = CASE WHEN ? != email THEN NULL ELSE email_verified_at END, updated_at = ? WHERE id = ?',
      str(b.name ?? u.name, 100), email, str(b.country ?? u.country, 2).toUpperCase() || null, str(b.billing_name ?? u.billing_name, 120) || null, str(b.billing_address ?? u.billing_address, 300) || null, str(b.tax_id ?? u.tax_id, 40) || null, email, ctx.now(), u.id);
    audit(ctx, a, 'customer.edit', ['user', u.id], { email: email !== u.email ? `${u.email} → ${email}` : undefined });
    return safeUser(db.get('SELECT * FROM users WHERE id = ?', u.id));
  });
  // estado da conta (login) — distinto do estado das licenças
  r.post('/api/admin/customers/:id/status', (req) => {
    const b = req.body, status = str(b.status, 20);
    const a = requireStaff(req, status === 'blocked' ? 'customers.block' : 'customers.suspend');
    if (!['active', 'suspended', 'blocked'].includes(status)) fail(400, 'Estado inválido.', 'ESTADO_INVALIDO');
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id); if (!u) fail(404, 'Cliente inexistente.', 'NAO_EXISTE');
    if (u.status === 'blocked' && status !== 'blocked' && a.role !== 'owner') fail(403, 'Só o administrador principal desbloqueia contas.', 'SEM_PERMISSAO');
    const reason = reasonOf(b);
    db.run('UPDATE users SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?', status === 'active' && !u.email_verified_at ? 'pending' : status, status === 'active' ? null : reason, ctx.now(), u.id);
    if (status !== 'active') db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', ctx.now(), u.id);
    audit(ctx, a, 'customer.status_' + status, ['user', u.id], { email: u.email }, reason);
    return { ok: true, consequence: status === 'suspended' ? 'Login suspenso; as licenças continuam a funcionar.' : status === 'blocked' ? 'Login bloqueado e licenças da conta impedidas de ativar/validar (não foram revogadas).' : 'Acesso reposto.' };
  });
  r.post('/api/admin/customers/:id/reset-link', (req) => {
    const a = requireStaff(req, 'customers.edit');
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id); if (!u) fail(404, 'Cliente inexistente.', 'NAO_EXISTE');
    sendReset(ctx, u, u.password_hash ? 'reset' : 'invite');
    audit(ctx, a, 'customer.reset_link', ['user', u.id], { email: u.email });
    return { ok: true };
  });

  // ---------- encomendas, transferências e comprovativos ----------
  const orderRow = (o) => {
    const u = db.get('SELECT name, email FROM users WHERE id = ?', o.user_id), plan = db.get('SELECT name FROM plans WHERE id = ?', o.plan_id);
    const proofs = db.all('SELECT id, filename, mime, size, declared_cents, declared_currency, transfer_date, transfer_ref, status, reason, reviewed_by, reviewed_at, created_at FROM proofs WHERE order_id = ? ORDER BY created_at DESC', o.id).map((p) => ({ ...p, declared: p.declared_cents !== null ? fmtMoney(p.declared_cents, p.declared_currency) : null }));
    const lic = db.get('SELECT id, key, status FROM licenses WHERE order_id = ?', o.id);
    return { id: o.id, ref: o.ref, customer: u, user_id: o.user_id, plan: plan.name, kind: o.kind, method: o.method, methodLabel: METHOD_LABEL[o.method], destination: o.method === 'bank_pt' ? 'Portugal' : o.method === 'bank_ao' ? 'Angola' : null,
      status: o.status, amount: fmtMoney(o.amount_cents, o.currency), currency: o.currency, amount_cents: o.amount_cents, tax: fmtMoney(o.tax_cents, o.currency), usd: fmtMoney(o.usd_cents, 'USD'), fx: o.fx_rate, country: o.country, billing: JSON.parse(o.billing || '{}'),
      created_at: o.created_at, due_at: o.due_at, confirmed_at: o.confirmed_at, proofs, license: lic ? { id: lic.id, key4: lic.key.slice(-4), status: lic.status } : null,
      history: db.all("SELECT at, actor_email, action, reason FROM audit_log WHERE target_type = 'order' AND target_id = ? ORDER BY at DESC", o.id) };
  };
  r.get('/api/admin/orders', (req) => {
    requireStaff(req, 'orders.view');
    const st = str(req.query.status, 30), m = str(req.query.method, 20), q = str(req.query.q, 80);
    return db.all(`SELECT o.* FROM orders o JOIN users u ON u.id = o.user_id WHERE (? = '' OR o.status = ?) AND (? = '' OR o.method = ?) AND (o.ref LIKE ? OR u.email LIKE ?) ORDER BY o.created_at DESC LIMIT 300`, st, st, m, m, like(q), like(q)).map(orderRow);
  });
  r.get('/api/admin/transfers', (req) => {
    requireStaff(req, 'orders.view');
    return db.all("SELECT * FROM orders WHERE method IN ('bank_pt','bank_ao') AND status IN ('pending','awaiting_validation') ORDER BY CASE status WHEN 'awaiting_validation' THEN 0 ELSE 1 END, created_at").map(orderRow);
  });
  r.get('/api/admin/orders/:id', (req) => { requireStaff(req, 'orders.view'); const o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id); if (!o) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE'); return orderRow(o); });
  r.get('/api/admin/proofs/:id/file', (req, res) => {
    const a = requireStaff(req, 'orders.view'), p = db.get('SELECT * FROM proofs WHERE id = ?', req.params.id); if (!p) fail(404, 'Comprovativo inexistente.', 'NAO_EXISTE');
    audit(ctx, a, 'proof.view', ['order', p.order_id], { proof: p.id });
    send(res, 200, fs.readFileSync(proofPath(ctx, p)), { 'Content-Type': p.mime, 'Content-Disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(p.filename)}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'private, no-store' });
  });
  r.post('/api/admin/orders/:id/approve', (req) => {
    const a = requireStaff(req, 'payments.validate'), o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id); if (!o) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE');
    if (!req.body.confirmReceived) fail(400, 'Confirma que verificaste a entrada efetiva do dinheiro na conta.', 'CONFIRMACAO');
    const res = approveTransfer(ctx, a, o, str(req.body.note, 300));
    return { ok: true, duplicate: !!res.duplicate, order: orderRow(db.get('SELECT * FROM orders WHERE id = ?', o.id)) };
  });
  r.post('/api/admin/orders/:id/request-info', (req) => { const a = requireStaff(req, 'payments.validate'), o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id); if (!o) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE'); proofDecision(ctx, a, o, 'needs_info', str(req.body.reason, 500)); return { ok: true }; });
  r.post('/api/admin/orders/:id/reject', (req) => { const a = requireStaff(req, 'payments.validate'), o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id); if (!o) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE'); proofDecision(ctx, a, o, 'reject', str(req.body.reason, 500)); return { ok: true }; });
  r.post('/api/admin/orders/:id/cancel', (req) => {
    const a = requireStaff(req, 'payments.validate'), o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id); if (!o) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE');
    if (!['pending', 'awaiting_validation'].includes(o.status)) fail(409, 'Só encomendas pendentes podem ser canceladas.', 'ESTADO_INVALIDO');
    const reason = reasonOf(req.body);
    db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", ctx.now(), o.id);
    audit(ctx, a, 'order.cancel', ['order', o.id], { ref: o.ref }, reason);
    return { ok: true };
  });
  r.post('/api/admin/orders/:id/refund', async (req) => {
    const a = requireStaff(req, 'payments.refund'), o = db.get('SELECT * FROM orders WHERE id = ?', req.params.id); if (!o) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE');
    if (o.status !== 'confirmed') fail(409, 'Só pagamentos confirmados podem ser reembolsados.', 'ESTADO_INVALIDO');
    const reason = reasonOf(req.body), pay = db.get("SELECT * FROM payments WHERE order_id = ? AND status = 'confirmed'", o.id);
    if (pay && pay.provider === 'stripe') await stripe.stripeRefund(ctx, pay);
    else if (pay && pay.provider === 'paypal') { if (pay.provider_payment_id.startsWith('activation:')) fail(400, 'Reembolsos de subscrições PayPal fazem-se no painel do PayPal.', 'MANUAL'); await paypal.paypalRefund(ctx, pay); }
    else if (!req.body.manualDone) fail(400, 'Transferências: faz a devolução pelo banco e confirma com "reembolso manual efetuado".', 'MANUAL');
    reverseOrder(ctx, o.id, 'refunded', a, reason);
    return { ok: true };
  });
  r.get('/api/admin/events', (req) => {
    requireStaff(req, 'payments.events');
    return db.all('SELECT id, provider, event_id, type, received_at, processed_at, result FROM payment_events WHERE (? = \'\' OR provider = ?) ORDER BY received_at DESC LIMIT 200', str(req.query.provider, 20), str(req.query.provider, 20));
  });

  // ---------- licenças ----------
  const licRow = (l) => {
    const u = l.user_id ? db.get('SELECT name, email FROM users WHERE id = ?', l.user_id) : null, d = db.get('SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL', l.id);
    const o = l.order_id ? db.get('SELECT ref FROM orders WHERE id = ?', l.order_id) : null;
    return { id: l.id, key: l.key, type: l.type, status: l.status, statusReason: l.status_reason, major: l.major, issued_at: l.issued_at, expires_at: l.expires_at, note: l.note, customer: u, user_id: l.user_id, order: o && o.ref, subscription_id: l.subscription_id, device: d ? { name: d.name, platform: d.platform, app_version: d.app_version, activated_at: d.activated_at, last_seen_at: d.last_seen_at } : null };
  };
  r.get('/api/admin/licenses', (req) => {
    requireStaff(req, 'licenses.view');
    const q = str(req.query.q, 80), t = str(req.query.type, 20), st = str(req.query.status, 20);
    return db.all(`SELECT l.* FROM licenses l LEFT JOIN users u ON u.id = l.user_id WHERE (l.key LIKE ? OR IFNULL(u.email,'') LIKE ? OR IFNULL(l.note,'') LIKE ?) AND (? = '' OR l.type = ?) AND (? = '' OR l.status = ?) ORDER BY l.issued_at DESC LIMIT 300`, like(q.toUpperCase()), like(q), like(q), t, t, st, st).map(licRow);
  });
  r.get('/api/admin/licenses/:id', (req) => {
    requireStaff(req, 'licenses.view');
    const l = db.get('SELECT * FROM licenses WHERE id = ?', req.params.id); if (!l) fail(404, 'Licença inexistente.', 'NAO_EXISTE');
    return { ...licRow(l), devices: db.all('SELECT name, platform, app_version, activated_at, last_seen_at, deactivated_at, deactivated_by, deactivation_reason FROM devices WHERE license_id = ? ORDER BY activated_at DESC', l.id), events: db.all('SELECT at, actor, action, details FROM license_events WHERE license_id = ? ORDER BY at DESC LIMIT 200', l.id) };
  });
  // emissão manual: ofertas, demonstrações e perpétuas (individual ou em lote)
  r.post('/api/admin/licenses', (req) => {
    const a = requireStaff(req, 'licenses.issue'), b = req.body;
    const type = ['gift', 'demo', 'perpetual'].includes(b.type) ? b.type : 'gift', n = Math.min(500, Math.max(1, +b.count || 1));
    const reason = reasonOf(b);
    const user = b.email ? db.get("SELECT * FROM users WHERE email = ? AND role = 'customer'", str(b.email, 254).toLowerCase()) : null;
    if (b.email && !user) fail(404, 'Cliente com esse email não existe. Cria-o primeiro em Clientes.', 'NAO_EXISTE');
    if (user && n > 1) fail(400, 'Lotes não são associados a um cliente.', 'PEDIDO');
    const days = +b.days || 0, expiresAt = type === 'demo' ? ctx.now() + (days || 14) * 864e5 : days ? ctx.now() + days * 864e5 : null;
    const major = +b.major || db.get("SELECT major FROM products WHERE id = 'mixmind'").major;
    const keys = db.tx(() => Array.from({ length: n }, () => issueLicense(ctx, { userId: user && user.id, type, major, expiresAt, actor: a.email, note: reason }).license));
    audit(ctx, a, 'license.issue', ['license', keys.length === 1 ? keys[0].id : 'lote'], { type, count: n, email: user && user.email, days }, reason);
    if (user) mail(ctx, user.email, 'license_issued', { name: user.name, plan: type === 'gift' ? 'Oferta' : type === 'demo' ? 'Demonstração' : 'Licença perpétua', key: keys[0].key, link: ctx.cfg.publicUrl + '/conta#licencas' });
    return { keys: keys.map((k) => ({ id: k.id, key: k.key })) };
  });
  r.post('/api/admin/licenses/:id/status', (req) => {
    const status = str(req.body.status, 20); if (!['active', 'suspended', 'revoked'].includes(status)) fail(400, 'Estado inválido.', 'ESTADO_INVALIDO');
    const a = requireStaff(req, status === 'revoked' ? 'licenses.revoke' : 'licenses.manage');
    const l = db.get('SELECT * FROM licenses WHERE id = ?', req.params.id); if (!l) fail(404, 'Licença inexistente.', 'NAO_EXISTE');
    setLicenseStatus(ctx, l, status, a, reasonOf(req.body));
    return { ok: true, consequence: status === 'revoked' ? 'Revogada: deixa de ativar e de validar. Computadores offline só sabem quando voltarem a contactar o servidor (ou quando o comprovativo expirar).' : status === 'suspended' ? 'Suspensa: não ativa nem valida até ser reativada. O login do cliente não muda.' : 'Reativada.' };
  });
  // recuperação administrativa (avaria, perda, substituição): liberta o computador sem contar para o limite do cliente
  r.post('/api/admin/licenses/:id/release-device', (req) => {
    const a = requireStaff(req, 'licenses.manage'), l = db.get('SELECT * FROM licenses WHERE id = ?', req.params.id); if (!l) fail(404, 'Licença inexistente.', 'NAO_EXISTE');
    const reason = reasonOf(req.body), out = deactivate(ctx, l, a, 'Recuperação administrativa: ' + reason);
    if (req.body.resetLimit) { db.run('UPDATE licenses SET transfer_reset_at = ? WHERE id = ?', ctx.now(), l.id); licEvent(ctx, l.id, a, 'transfer_limit_reset', reason); }
    audit(ctx, a, 'license.release_device', ['license', l.id], out, reason);
    return out;
  });
  r.post('/api/admin/licenses/:id/extend', (req) => {
    const a = requireStaff(req, 'subscriptions.manage'), l = db.get('SELECT * FROM licenses WHERE id = ?', req.params.id); if (!l) fail(404, 'Licença inexistente.', 'NAO_EXISTE');
    const days = Math.round(+req.body.days); if (!(days > 0 && days <= 3650)) fail(400, 'Dias inválidos.', 'PEDIDO');
    if (!l.expires_at) fail(400, 'Licenças perpétuas não expiram.', 'PERPETUA');
    const reason = reasonOf(req.body), base = Math.max(ctx.now(), l.expires_at), end = base + days * 864e5;
    db.tx(() => {
      db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", end, l.id);
      if (l.subscription_id) db.run("UPDATE subscriptions SET current_period_end = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", end, ctx.now(), l.subscription_id);
      licEvent(ctx, l.id, a, 'extended', { days, until: end, reason });
    });
    audit(ctx, a, 'license.extend', ['license', l.id], { days, until: end }, reason);
    return { ok: true, until: end };
  });
  r.post('/api/admin/licenses/:id/assign', (req) => {
    const a = requireStaff(req, 'licenses.issue'), l = db.get('SELECT * FROM licenses WHERE id = ?', req.params.id); if (!l) fail(404, 'Licença inexistente.', 'NAO_EXISTE');
    const u = db.get("SELECT * FROM users WHERE email = ? AND role = 'customer'", str(req.body.email, 254).toLowerCase()); if (!u) fail(404, 'Cliente inexistente.', 'NAO_EXISTE');
    const reason = reasonOf(req.body);
    db.run('UPDATE licenses SET user_id = ? WHERE id = ?', u.id, l.id); licEvent(ctx, l.id, a, 'assigned', { email: u.email, reason });
    audit(ctx, a, 'license.assign', ['license', l.id], { email: u.email }, reason);
    return { ok: true };
  });

  // ---------- subscrições ----------
  r.get('/api/admin/subscriptions', (req) => {
    requireStaff(req, 'licenses.view');
    const f = str(req.query.filter, 20), now = ctx.now();
    const where = f === 'expiring' ? `s.status IN ('active','past_due') AND s.current_period_end BETWEEN ${now} AND ${now + 7 * 864e5}` : f === 'past_due' ? "s.status = 'past_due'" : f === 'manual' ? "s.provider_sub_id IS NULL AND s.method IN ('bank_pt','bank_ao')" : f ? `s.status = '${['active', 'cancelled', 'expired'].includes(f) ? f : 'active'}'` : '1=1';
    return db.all(`SELECT s.*, p.name plan_name, u.email, u.name, (SELECT id FROM licenses l WHERE l.subscription_id = s.id) license_id,
      (SELECT ref FROM orders o WHERE o.subscription_id = s.id AND o.kind = 'renewal' AND o.status IN ('pending','awaiting_validation')) pending_renewal FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN users u ON u.id = s.user_id WHERE ${where} ORDER BY s.current_period_end LIMIT 300`)
      .map((s) => ({ id: s.id, plan: s.plan_name, customer: { email: s.email, name: s.name }, method: METHOD_LABEL[s.method], provider: s.provider, status: s.status, autoRenew: !!s.auto_renew, cancelAtPeriodEnd: !!s.cancel_at_period_end, periodEnd: s.current_period_end, licenseId: s.license_id, pendingRenewal: s.pending_renewal }));
  });
  r.post('/api/admin/subscriptions/:id/cancel-renewal', async (req) => {
    const a = requireStaff(req, 'subscriptions.manage'), s = db.get('SELECT * FROM subscriptions WHERE id = ?', req.params.id); if (!s) fail(404, 'Subscrição inexistente.', 'NAO_EXISTE');
    const reason = reasonOf(req.body);
    if (s.provider === 'stripe' && s.provider_sub_id) await stripe.stripeCancel(ctx, s);
    if (s.provider === 'paypal' && s.provider_sub_id) await paypal.paypalCancel(ctx, s);
    db.run('UPDATE subscriptions SET cancel_at_period_end = 1, auto_renew = 0, cancelled_at = ?, updated_at = ? WHERE id = ?', ctx.now(), ctx.now(), s.id);
    audit(ctx, a, 'subscription.cancel_renewal', ['subscription', s.id], null, reason);
    return { ok: true, accessUntil: s.current_period_end };
  });

  // ---------- configurações ----------
  const EDITABLE = ['currencies', 'taxes', 'methods', 'bank_pt', 'bank_ao', 'licensing', 'demo', 'security', 'support', 'store'];
  r.get('/api/admin/settings', (req) => {
    requireStaff(req, 'settings.view');
    const out = {}; for (const k of EDITABLE) out[k] = getSetting(ctx, k);
    const cr = getSetting(ctx, 'credentials') || {};
    const mask = (p, keys) => Object.fromEntries(keys.map((k) => { const envV = ctx.cfg[p][k]; const dbV = cr[p] && cr[p][k] ? ctx.cipher.dec(cr[p][k]) : ''; const v = envV || dbV; return [k, { set: !!v, source: envV ? 'variável de ambiente' : dbV ? 'painel (cifrado)' : null, hint: v ? '••••' + v.slice(-4) : '' }]; }));
    out.credentials = { stripe: mask('stripe', ['secretKey', 'webhookSecret']), paypal: mask('paypal', ['clientId', 'clientSecret', 'webhookId']), webhooks: { stripe: ctx.cfg.publicUrl + '/api/webhooks/stripe', paypal: ctx.cfg.publicUrl + '/api/webhooks/paypal' } };
    out.plans = db.all('SELECT * FROM plans ORDER BY sort'); out.annualSaving = annualSaving(ctx);
    out.versions = db.all('SELECT * FROM versions ORDER BY published_at DESC');
    out.licensePublicKey = signingKeys(ctx).spki; out.mode = ctx.cfg.mode; out.emailProvider = ctx.cfg.email.provider;
    return out;
  });
  r.put('/api/admin/settings/:key', (req) => {
    const a = requireStaff(req, 'settings.edit'), k = req.params.key;
    if (!EDITABLE.includes(k)) fail(404, 'Configuração inexistente.', 'NAO_EXISTE');
    const v = req.body.value; if (!v || typeof v !== 'object') fail(400, 'Valor inválido.', 'PEDIDO');
    if (k === 'methods' && v.test && v.test.enabled && !ctx.cfg.test) v.test.enabled = false;
    if ((k === 'bank_pt' || k === 'bank_ao') && v.example) delete v.example; // ao gravar, deixam de ser exemplo
    if (k === 'currencies') for (const r2 of Object.values(v.rates || {})) { if (r2.rate !== null && !(+r2.rate > 0)) fail(400, 'Câmbio inválido.', 'PEDIDO'); if (r2.rate) { r2.rate = +r2.rate; delete r2.note; } }
    setSetting(ctx, k, v, a.email);
    audit(ctx, a, 'settings.' + k, ['settings', k], k.startsWith('bank') ? { iban: v.iban ? '…' + String(v.iban).slice(-4) : '' } : v, str(req.body.reason, 300) || null);
    return { ok: true };
  });
  r.put('/api/admin/credentials/:provider', (req) => {
    const a = requireStaff(req, 'settings.edit'), p = req.params.provider;
    const allowed = { stripe: ['secretKey', 'webhookSecret'], paypal: ['clientId', 'clientSecret', 'webhookId'] }[p]; if (!allowed) fail(404, 'Prestador inexistente.', 'NAO_EXISTE');
    const cr = getSetting(ctx, 'credentials') || {}; cr[p] = cr[p] || {};
    for (const k of allowed) { const v = req.body[k]; if (v === '') delete cr[p][k]; else if (typeof v === 'string' && v.length) cr[p][k] = ctx.cipher.enc(v.trim()); }
    setSetting(ctx, 'credentials', cr, a.email);
    audit(ctx, a, 'credentials.' + p, ['settings', 'credentials'], { fields: Object.keys(req.body).filter((k) => allowed.includes(k)) }); // nunca regista os valores
    return { ok: true };
  });
  r.put('/api/admin/plans/:id', (req) => {
    const a = requireStaff(req, 'settings.edit'), pl = db.get('SELECT * FROM plans WHERE id = ?', req.params.id); if (!pl) fail(404, 'Plano inexistente.', 'NAO_EXISTE');
    const b = req.body, price = Math.round(+b.price_usd * 100);
    if (!(price >= 100 && price <= 10000000)) fail(400, 'Preço inválido.', 'PEDIDO');
    db.run('UPDATE plans SET name = ?, price_usd_cents = ?, active = ?, stripe_price_id = ?, paypal_plan_id = ? WHERE id = ?', str(b.name ?? pl.name, 60), price, b.active === false ? 0 : 1, str(b.stripe_price_id, 80) || null, str(b.paypal_plan_id, 80) || null, pl.id);
    audit(ctx, a, 'plan.edit', ['plan', pl.id], { price: price / 100, before: pl.price_usd_cents / 100 }, str(b.reason, 300) || null);
    return { ok: true, annualSaving: annualSaving(ctx) };
  });
  r.post('/api/admin/versions', (req) => {
    const a = requireStaff(req, 'settings.edit'), b = req.body, ver = str(b.version, 20);
    if (!/^\d+\.\d+(\.\d+)?$/.test(ver)) fail(400, 'Versão inválida (ex.: 1.8.1).', 'PEDIDO');
    const url = (u) => { u = str(u, 400); if (u && !/^https:\/\//.test(u)) fail(400, 'As ligações têm de ser https://', 'PEDIDO'); return u || null; };
    db.tx(() => { if (b.current) db.run('UPDATE versions SET is_current = 0'); db.run('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?)', uuid(), 'mixmind', ver, +ver.split('.')[0], str(b.notes, 2000), url(b.url_web), url(b.url_windows), url(b.url_macos), b.current ? 1 : 0, ctx.now()); });
    audit(ctx, a, 'version.add', ['version', ver], b);
    return { ok: true };
  });

  // ---------- textos legais e templates de email ----------
  r.get('/api/admin/texts', (req) => { requireStaff(req, 'settings.view'); return db.all('SELECT * FROM texts ORDER BY key'); });
  r.put('/api/admin/texts/:key', (req) => {
    const a = requireStaff(req, 'texts.edit'), t = getText(ctx, req.params.key); if (!t) fail(404, 'Texto inexistente.', 'NAO_EXISTE');
    const draft = String(req.body.draft || ''); if (draft.length < 10 || draft.length > 50000) fail(400, 'Texto inválido.', 'PEDIDO');
    const isEmail = t.key.startsWith('email:');
    // templates de email entram em vigor ao gravar; textos legais ficam em rascunho até validação + publicação
    db.run(`UPDATE texts SET draft = ?, ${isEmail ? 'published = ?, published_at = ?, published_by = ?,' : ''} validated_by = NULL, validated_at = NULL, updated_by = ?, updated_at = ? WHERE key = ?`, ...(isEmail ? [draft, draft, ctx.now(), a.email] : [draft]), a.email, ctx.now(), t.key);
    audit(ctx, a, 'text.edit', ['text', t.key]);
    return { ok: true };
  });
  r.post('/api/admin/texts/:key/validate', (req) => {
    const a = requireStaff(req, 'texts.publish'), t = getText(ctx, req.params.key); if (!t) fail(404, 'Texto inexistente.', 'NAO_EXISTE');
    if (!req.body.confirm) fail(400, 'Confirma que o texto foi revisto e validado (jurídico/comercial).', 'CONFIRMACAO');
    db.run('UPDATE texts SET validated_by = ?, validated_at = ? WHERE key = ?', a.email + (req.body.reviewer ? ' (revisto por ' + str(req.body.reviewer, 80) + ')' : ''), ctx.now(), t.key);
    audit(ctx, a, 'text.validate', ['text', t.key], { reviewer: str(req.body.reviewer, 80) });
    return { ok: true };
  });
  r.post('/api/admin/texts/:key/publish', (req) => {
    const a = requireStaff(req, 'texts.publish'), t = getText(ctx, req.params.key); if (!t) fail(404, 'Texto inexistente.', 'NAO_EXISTE');
    if (!t.validated_at) fail(409, 'Valida o texto antes de o publicar.', 'POR_VALIDAR');
    db.run('UPDATE texts SET published = draft, published_by = ?, published_at = ? WHERE key = ?', a.email, ctx.now(), t.key);
    audit(ctx, a, 'text.publish', ['text', t.key]);
    return { ok: true };
  });

  // ---------- equipa, auditoria, emails ----------
  r.get('/api/admin/staff', (req) => { requireStaff(req, 'staff.manage'); return { roles: Object.entries(ROLES).map(([id, label]) => ({ id, label, perms: permsOf(id) })), staff: db.all("SELECT * FROM users WHERE role != 'customer' ORDER BY created_at").map(safeUser) }; });
  r.post('/api/admin/staff', (req) => {
    const a = requireStaff(req, 'staff.manage'), b = req.body, role = str(b.role, 20);
    if (!['owner', 'finance', 'support'].includes(role)) fail(400, 'Perfil inválido.', 'PEDIDO');
    const email = str(b.email, 254).toLowerCase(); if (!emailOk(email)) fail(400, 'Email inválido.', 'EMAIL');
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Já existe uma conta com este email.', 'EMAIL_EXISTE');
    const id = uuid(), now = ctx.now();
    db.run('INSERT INTO users (id, email, name, role, status, email_verified_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', id, email, str(b.name, 100) || email, role, 'active', now, now, now);
    sendReset(ctx, db.get('SELECT * FROM users WHERE id = ?', id), 'invite');
    audit(ctx, a, 'staff.invite', ['user', id], { email, role });
    return { ok: true };
  });
  r.patch('/api/admin/staff/:id', (req) => {
    const a = requireStaff(req, 'staff.manage'), u = db.get("SELECT * FROM users WHERE id = ? AND role != 'customer'", req.params.id); if (!u) fail(404, 'Membro inexistente.', 'NAO_EXISTE');
    const role = str(req.body.role, 20), status = str(req.body.status, 20);
    if (u.id === a.id) fail(400, 'Não podes alterar o teu próprio perfil ou estado.', 'PEDIDO');
    if (role === 'owner' || u.role === 'owner') { const owners = db.get("SELECT COUNT(*) n FROM users WHERE role = 'owner' AND status = 'active'").n; if (u.role === 'owner' && owners <= 1 && (role !== 'owner' || status === 'blocked')) fail(400, 'Tem de existir pelo menos um administrador principal ativo.', 'PEDIDO'); }
    if (role && ['owner', 'finance', 'support'].includes(role)) db.run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
    if (status && ['active', 'blocked'].includes(status)) { db.run('UPDATE users SET status = ? WHERE id = ?', status, u.id); if (status === 'blocked') db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ?', ctx.now(), u.id); }
    audit(ctx, a, 'staff.edit', ['user', u.id], { role, status }, str(req.body.reason, 300) || null);
    return { ok: true };
  });
  r.get('/api/admin/audit', (req) => { requireStaff(req, 'audit.view'); return db.all('SELECT * FROM audit_log WHERE (? = \'\' OR action LIKE ?) ORDER BY at DESC LIMIT 300', str(req.query.q, 60), like(req.query.q)); });
  r.get('/api/admin/emails', (req) => { requireStaff(req, 'emails.view'); return db.all('SELECT * FROM emails ORDER BY id DESC LIMIT 200'); });
}
