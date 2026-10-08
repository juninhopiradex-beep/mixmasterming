// Encomendas, confirmação de pagamentos (idempotente), subscrições, reembolsos e contestações.
import { uuid } from '../security.js';
import { getSetting, mail, audit, fmtMoney, quote } from '../core.js';
import { issueLicense, licEvent } from '../licensing.js';
import { fail } from '../http.js';

const REF = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRef(ctx) {
  const d = new Date(ctx.now()), yymm = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0');
  let r; do { r = 'MMX-' + yymm + '-' + Array.from({ length: 6 }, () => REF[Math.floor(Math.random() * 32)]).join(''); } while (ctx.db.get('SELECT 1 FROM orders WHERE ref = ?', r));
  return r;
}
export const METHOD_LABEL = { card: 'Cartão (Visa, Mastercard…)', paypal: 'PayPal', bank_pt: 'Transferência bancária — Portugal', bank_ao: 'Transferência bancária — Angola', test: 'Pagamento simulado (modo de testes)', gift: 'Oferta' };
const addInterval = (t, interval) => { const d = new Date(t); if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1); return d.getTime(); };
export { addInterval };

/** Cria uma encomenda pendente (o preço é calculado no servidor — nunca vem do browser). */
export function createOrder(ctx, user, planId, method, country, billing, opts = {}) {
  const plan = ctx.db.get('SELECT * FROM plans WHERE id = ? AND active = 1', planId);
  if (!plan) fail(400, 'Plano indisponível.', 'PLANO_INVALIDO');
  const q = quote(ctx, plan, method, country);
  const id = uuid(), ref = newRef(ctx), now = ctx.now();
  const bank = method === 'bank_pt' || method === 'bank_ao' ? getSetting(ctx, method) : null;
  const due = bank ? now + (bank.deadlineDays || 5) * 864e5 : now + 864e5;
  ctx.db.run(`INSERT INTO orders (id, ref, user_id, plan_id, kind, subscription_id, method, currency, amount_cents, tax_cents, tax_rate, usd_cents, fx_rate, country, billing, status, created_at, due_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ref, user.id, plan.id, opts.kind || 'purchase', opts.subscriptionId || null, method, q.currency, q.total_cents, q.tax_cents, q.tax_rate, q.usd_cents, q.fx, country || null, JSON.stringify(billing || {}), 'pending', now, due, now);
  const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', id);
  mail(ctx, user.email, 'order_created', { name: user.name, ref, plan: plan.name, amount: fmtMoney(order.amount_cents, order.currency), method: METHOD_LABEL[method], link: ctx.cfg.publicUrl + '/conta#encomendas' });
  return { order, plan, quote: q };
}

/**
 * Confirma um pagamento e entrega o produto. Idempotente: chamar duas vezes com o mesmo pagamento não duplica nada.
 * p = { provider, paymentId, amountCents, currency, actor, periodEnd (subscrições de prestador), providerSubId }
 */
export function confirmOrder(ctx, orderId, p) {
  const db = ctx.db;
  const res = db.tx(() => {
    const order = db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) fail(404, 'Encomenda inexistente.', 'NAO_EXISTE');
    const dup = db.get('SELECT * FROM payments WHERE provider = ? AND provider_payment_id = ?', p.provider, p.paymentId);
    if (dup && dup.status === 'confirmed') return { order, duplicate: true };
    if (order.status === 'confirmed') return { order, duplicate: true };
    if (['refunded', 'disputed'].includes(order.status)) fail(409, 'Encomenda reembolsada ou contestada.', 'ESTADO_INVALIDO');
    const now = ctx.now();
    if (dup) db.run("UPDATE payments SET status = 'confirmed', confirmed_by = ?, updated_at = ? WHERE id = ?", p.actor || null, now, dup.id);
    else db.run('INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_cents, currency, confirmed_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', uuid(), order.id, p.provider, p.paymentId, 'confirmed', p.amountCents ?? order.amount_cents, p.currency || order.currency, p.actor || null, now, now);
    db.run("UPDATE orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?", now, now, order.id);
    const plan = db.get('SELECT * FROM plans WHERE id = ?', order.plan_id);
    const prod = db.get("SELECT major FROM products WHERE id = 'mixmind'");
    let license = null, created = false, sub = null, renewed = false;
    if (order.kind === 'renewal') {
      sub = db.get('SELECT * FROM subscriptions WHERE id = ?', order.subscription_id);
      const end = p.periodEnd || addInterval(Math.max(now, sub.current_period_end || now), plan.interval);
      db.run("UPDATE subscriptions SET status = 'active', current_period_end = ?, cancel_at_period_end = 0, updated_at = ? WHERE id = ?", end, now, sub.id);
      license = db.get('SELECT * FROM licenses WHERE subscription_id = ?', sub.id);
      if (license) { db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", end, license.id); licEvent(ctx, license.id, p.actor || p.provider, 'renewed', { until: end, order: order.ref }); }
      renewed = true; sub.current_period_end = end;
    } else if (plan.kind === 'perpetual') {
      ({ license, created } = issueLicense(ctx, { userId: order.user_id, type: 'perpetual', orderId: order.id, major: prod.major, actor: p.actor || p.provider }));
    } else {
      const end = p.periodEnd || addInterval(now, plan.interval), sid = uuid();
      const auto = ['card', 'paypal', 'test'].includes(order.method) ? 1 : 0; // transferências: renovação manual
      db.run('INSERT INTO subscriptions (id, user_id, plan_id, method, provider, provider_sub_id, status, auto_renew, current_period_start, current_period_end, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        sid, order.user_id, plan.id, order.method, p.providerSubId ? p.provider : null, p.providerSubId || null, 'active', auto, now, end, now, now);
      db.run('UPDATE orders SET subscription_id = ? WHERE id = ?', sid, order.id);
      sub = db.get('SELECT * FROM subscriptions WHERE id = ?', sid);
      ({ license, created } = issueLicense(ctx, { userId: order.user_id, type: 'subscription', orderId: order.id, subscriptionId: sid, major: prod.major, expiresAt: end, actor: p.actor || p.provider }));
    }
    return { order: db.get('SELECT * FROM orders WHERE id = ?', order.id), plan, license, created, sub, renewed };
  });
  if (!res.duplicate) {
    const u = ctx.db.get('SELECT * FROM users WHERE id = ?', res.order.user_id);
    mail(ctx, u.email, 'payment_approved', { name: u.name, ref: res.order.ref });
    if (res.created) mail(ctx, u.email, 'license_issued', { name: u.name, plan: res.plan.name, key: res.license.key, link: ctx.cfg.publicUrl + '/conta#licencas' });
    if (res.renewed) mail(ctx, u.email, 'renewed', { name: u.name, plan: res.plan.name, date: new Date(res.sub.current_period_end).toLocaleDateString('pt-PT') });
  }
  return res;
}

/** Renovação de subscrição gerida pelo prestador (cartão / PayPal): idempotente pelo id do pagamento. */
export function providerRenewal(ctx, sub, p) {
  const db = ctx.db;
  const out = db.tx(() => {
    if (db.get("SELECT 1 FROM payments WHERE provider = ? AND provider_payment_id = ? AND status = 'confirmed'", p.provider, p.paymentId)) return { duplicate: true };
    const plan = db.get('SELECT * FROM plans WHERE id = ?', sub.plan_id), now = ctx.now();
    const id = uuid(), ref = newRef(ctx);
    db.run(`INSERT INTO orders (id, ref, user_id, plan_id, kind, subscription_id, method, currency, amount_cents, usd_cents, fx_rate, status, created_at, confirmed_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,'confirmed',?,?,?)`,
      id, ref, sub.user_id, plan.id, 'renewal', sub.id, sub.method, p.currency || 'USD', p.amountCents ?? plan.price_usd_cents, plan.price_usd_cents, now, now, now);
    db.run('INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', uuid(), id, p.provider, p.paymentId, 'confirmed', p.amountCents ?? plan.price_usd_cents, p.currency || 'USD', now, now);
    const end = p.periodEnd || addInterval(Math.max(now, sub.current_period_end || now), plan.interval);
    db.run("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = ? WHERE id = ?", end, now, sub.id);
    const lic = db.get('SELECT * FROM licenses WHERE subscription_id = ?', sub.id);
    if (lic) { db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", end, lic.id); licEvent(ctx, lic.id, p.provider, 'renewed', { until: end, order: ref }); }
    return { end, plan };
  });
  if (!out.duplicate) { const u = db.get('SELECT * FROM users WHERE id = ?', sub.user_id); mail(ctx, u.email, 'renewed', { name: u.name, plan: out.plan.name, date: new Date(out.end).toLocaleDateString('pt-PT') }); }
  return out;
}

/** Pagamento falhado / expirado (não emite nada). */
export function failOrder(ctx, orderId, status, provider, paymentId, reason) {
  const db = ctx.db, o = db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o || o.status === 'confirmed') return o;
  db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', status, ctx.now(), o.id);
  if (provider && paymentId && !db.get('SELECT 1 FROM payments WHERE provider = ? AND provider_payment_id = ?', provider, paymentId))
    db.run('INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', uuid(), o.id, provider, paymentId, status === 'expired' ? 'expired' : 'failed', o.amount_cents, o.currency, ctx.now(), ctx.now());
  void reason;
  return db.get('SELECT * FROM orders WHERE id = ?', o.id);
}

/** Reembolso ou contestação: a encomenda muda de estado e a licença é revogada / suspensa. */
export function reverseOrder(ctx, orderId, kind, actor, reason) {
  const db = ctx.db;
  return db.tx(() => {
    const o = db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) return null;
    if (o.status === kind) return { order: o, duplicate: true };
    const now = ctx.now();
    db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', kind, now, o.id);
    db.run('UPDATE payments SET status = ?, updated_at = ? WHERE order_id = ? AND status = ?', kind, now, o.id, 'confirmed');
    const lic = db.get('SELECT * FROM licenses WHERE order_id = ?', o.id) || (o.subscription_id && db.get('SELECT * FROM licenses WHERE subscription_id = ?', o.subscription_id));
    if (lic && lic.status !== 'revoked') {
      const st = kind === 'refunded' ? 'revoked' : 'suspended';
      db.run('UPDATE licenses SET status = ?, status_reason = ? WHERE id = ?', st, kind === 'refunded' ? 'Pagamento reembolsado' : 'Pagamento contestado', lic.id);
      licEvent(ctx, lic.id, actor || 'prestador', 'status_' + st, reason || kind);
    }
    if (o.subscription_id && kind === 'refunded') db.run("UPDATE subscriptions SET status = 'cancelled', auto_renew = 0, cancelled_at = ?, updated_at = ? WHERE id = ?", now, now, o.subscription_id);
    audit(ctx, actor || 'prestador', 'order.' + kind, ['order', o.id], { ref: o.ref }, reason);
    return { order: db.get('SELECT * FROM orders WHERE id = ?', o.id) };
  });
}

/** Regista um evento de prestador uma única vez. Devolve false se já tinha sido recebido (idempotência). */
export function recordEvent(ctx, provider, eventId, type, payload) {
  try { ctx.db.run('INSERT INTO payment_events (provider, event_id, type, received_at, payload) VALUES (?,?,?,?,?)', provider, eventId, type, ctx.now(), typeof payload === 'string' ? payload : JSON.stringify(payload)); return true; }
  catch (e) {
    if (!/UNIQUE/.test(e.message)) throw e;
    // já recebido: só volta a processar se a tentativa anterior não terminou (o processamento em si é idempotente)
    const r = ctx.db.get('SELECT processed_at FROM payment_events WHERE provider = ? AND event_id = ?', provider, eventId);
    return !(r && r.processed_at);
  }
}
export const eventDone = (ctx, provider, eventId, result) => ctx.db.run('UPDATE payment_events SET processed_at = ?, result = ? WHERE provider = ? AND event_id = ?', ctx.now(), String(result).slice(0, 300), provider, eventId);
