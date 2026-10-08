// Stripe: Checkout alojado (cartões; os dados do cartão nunca passam pelo nosso servidor) + webhooks assinados.
import crypto from 'node:crypto';
import { fail } from '../http.js';
import { confirmOrder, providerRenewal, failOrder, reverseOrder } from './orders.js';
import { mail } from '../core.js';
import { safeEqual } from '../security.js';

export const stripeConfigured = (ctx) => !!(cred(ctx).secretKey && cred(ctx).webhookSecret);
function cred(ctx) {
  const s = ctx.creds ? ctx.creds('stripe') : {};
  return { secretKey: ctx.cfg.stripe.secretKey || s.secretKey || '', webhookSecret: ctx.cfg.stripe.webhookSecret || s.webhookSecret || '', apiBase: ctx.cfg.stripe.apiBase };
}
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
}
async function api(ctx, method, path, body) {
  const c = cred(ctx);
  if (!c.secretKey) fail(503, 'Pagamentos por cartão ainda não configurados.', 'PRESTADOR_NAO_CONFIGURADO');
  const r = await fetch(c.apiBase + path, { method, headers: { Authorization: 'Bearer ' + c.secretKey, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }, body: body ? form(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, 'Stripe: ' + ((j.error && j.error.message) || r.status), 'PRESTADOR_ERRO');
  return j;
}

export async function createCheckout(ctx, order, plan, user) {
  const base = ctx.cfg.publicUrl, sub = plan.kind === 'subscription';
  const line = plan.stripe_price_id && !order.tax_cents ? { price: plan.stripe_price_id, quantity: 1 }
    : { quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.amount_cents, product_data: { name: `MIXMIND by Piradex — ${plan.name}` }, ...(sub ? { recurring: { interval: plan.interval } } : {}) } };
  const s = await api(ctx, 'POST', '/v1/checkout/sessions', {
    mode: sub ? 'subscription' : 'payment', customer_email: user.email, client_reference_id: order.id,
    success_url: `${base}/conta#encomenda/${order.ref}`, cancel_url: `${base}/comprar?plano=${plan.id}&cancelado=1`,
    line_items: { 0: line }, metadata: { order_id: order.id, ref: order.ref },
    ...(sub ? { subscription_data: { metadata: { order_id: order.id, ref: order.ref } } } : { payment_intent_data: { metadata: { order_id: order.id, ref: order.ref } } }),
  });
  ctx.db.run('UPDATE orders SET provider_ref = ? WHERE id = ?', s.id, order.id);
  return s.url;
}

/** Verificação da assinatura Stripe-Signature (HMAC-SHA256 de "t.corpo", tolerância de 5 min). */
export function verifyStripe(ctx, raw, header) {
  const secret = cred(ctx).webhookSecret;
  if (!secret) fail(503, 'Webhook Stripe sem segredo configurado.', 'PRESTADOR_NAO_CONFIGURADO');
  const parts = Object.fromEntries(String(header || '').split(',').map((x) => x.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = String(header || '').split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  const t = +parts.t;
  if (!t || !sigs.length) fail(400, 'Assinatura em falta.', 'ASSINATURA');
  if (Math.abs(ctx.now() / 1000 - t) > 300) fail(400, 'Evento fora de tempo.', 'ASSINATURA');
  const exp = crypto.createHmac('sha256', secret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
  if (!sigs.some((s) => safeEqual(s, exp))) fail(400, 'Assinatura inválida.', 'ASSINATURA');
  return JSON.parse(raw.toString('utf8'));
}

const orderFrom = (ctx, id) => (id ? ctx.db.get('SELECT * FROM orders WHERE id = ?', id) : null);
const subIdOf = (inv) => inv.subscription || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) || null;
const subMetaOf = (inv) => (inv.subscription_details && inv.subscription_details.metadata) || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata) || {};

export async function handleStripe(ctx, ev) {
  const o = ev.data && ev.data.object || {};
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const order = orderFrom(ctx, o.metadata && o.metadata.order_id);
      if (!order) return 'encomenda desconhecida';
      if (o.mode === 'subscription') { ctx.db.run('UPDATE orders SET provider_ref = ? WHERE id = ?', o.subscription || o.id, order.id); return 'subscrição: aguarda invoice.paid'; }
      if (o.payment_status !== 'paid') return 'ainda não pago (' + o.payment_status + ')';
      confirmOrder(ctx, order.id, { provider: 'stripe', paymentId: o.payment_intent || o.id, amountCents: o.amount_total, currency: String(o.currency || 'usd').toUpperCase() });
      return 'confirmada';
    }
    case 'checkout.session.async_payment_failed': { const order = orderFrom(ctx, o.metadata && o.metadata.order_id); if (order) failOrder(ctx, order.id, 'failed', 'stripe', o.payment_intent || o.id); return 'falhada'; }
    case 'checkout.session.expired': { const order = orderFrom(ctx, o.metadata && o.metadata.order_id); if (order && order.status === 'pending') failOrder(ctx, order.id, 'expired'); return 'expirada'; }
    case 'invoice.paid': {
      const sid = subIdOf(o); if (!sid) return 'sem subscrição';
      const line = o.lines && o.lines.data && o.lines.data[0], periodEnd = line && line.period && line.period.end ? line.period.end * 1000 : null;
      const existing = ctx.db.get("SELECT * FROM subscriptions WHERE provider = 'stripe' AND provider_sub_id = ?", sid);
      if (o.billing_reason === 'subscription_create' || !existing) {
        const order = orderFrom(ctx, subMetaOf(o).order_id) || ctx.db.get('SELECT * FROM orders WHERE provider_ref = ?', sid);
        if (!order) return 'encomenda desconhecida';
        confirmOrder(ctx, order.id, { provider: 'stripe', paymentId: o.id, amountCents: o.amount_paid, currency: String(o.currency || 'usd').toUpperCase(), periodEnd, providerSubId: sid });
        return 'subscrição iniciada';
      }
      providerRenewal(ctx, existing, { provider: 'stripe', paymentId: o.id, amountCents: o.amount_paid, currency: String(o.currency || 'usd').toUpperCase(), periodEnd });
      return 'renovada';
    }
    case 'invoice.payment_failed': {
      const sub = ctx.db.get("SELECT * FROM subscriptions WHERE provider = 'stripe' AND provider_sub_id = ?", subIdOf(o));
      if (!sub) return 'subscrição desconhecida';
      subFailed(ctx, sub, 'Stripe');
      return 'falha de cobrança';
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = ctx.db.get("SELECT * FROM subscriptions WHERE provider = 'stripe' AND provider_sub_id = ?", o.id);
      if (!sub) return 'subscrição desconhecida';
      if (ev.type === 'customer.subscription.deleted' || o.status === 'canceled') ctx.db.run("UPDATE subscriptions SET status = 'cancelled', auto_renew = 0, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE id = ?", ctx.now(), ctx.now(), sub.id);
      else ctx.db.run('UPDATE subscriptions SET cancel_at_period_end = ?, auto_renew = ?, updated_at = ? WHERE id = ?', o.cancel_at_period_end ? 1 : 0, o.cancel_at_period_end ? 0 : 1, ctx.now(), sub.id);
      return 'atualizada';
    }
    case 'charge.refunded': {
      if (!o.refunded) return 'reembolso parcial (sem alteração automática)';
      const pay = ctx.db.get("SELECT * FROM payments WHERE provider = 'stripe' AND provider_payment_id IN (?, ?)", o.payment_intent || '', o.invoice || '');
      if (!pay) return 'pagamento desconhecido';
      reverseOrder(ctx, pay.order_id, 'refunded', 'stripe', 'Reembolso Stripe');
      return 'reembolsada';
    }
    case 'charge.dispute.created': {
      const pay = ctx.db.get("SELECT * FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?", o.payment_intent || '');
      if (!pay) return 'pagamento desconhecido';
      reverseOrder(ctx, pay.order_id, 'disputed', 'stripe', 'Contestação de pagamento (Stripe)');
      return 'contestada';
    }
    default: return 'ignorado';
  }
}
export function subFailed(ctx, sub, providerName) {
  ctx.db.run("UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE id = ?", ctx.now(), sub.id);
  const u = ctx.db.get('SELECT * FROM users WHERE id = ?', sub.user_id), plan = ctx.db.get('SELECT * FROM plans WHERE id = ?', sub.plan_id);
  mail(ctx, u.email, 'payment_failed', { name: u.name, plan: plan.name, provider: providerName, date: new Date(sub.current_period_end).toLocaleDateString('pt-PT'), link: ctx.cfg.publicUrl + '/conta#subscricoes' });
}
export const stripeCancel = (ctx, sub) => api(ctx, 'POST', '/v1/subscriptions/' + encodeURIComponent(sub.provider_sub_id), { cancel_at_period_end: 'true' });
export async function stripeRefund(ctx, pay) {
  let pi = pay.provider_payment_id;
  if (pi.startsWith('in_')) { const inv = await api(ctx, 'GET', '/v1/invoices/' + encodeURIComponent(pi)); pi = inv.payment_intent || (inv.payments && inv.payments.data && inv.payments.data[0] && inv.payments.data[0].payment && inv.payments.data[0].payment.payment_intent); if (!pi) fail(409, 'Fatura sem pagamento associado.', 'SEM_PAGAMENTO'); }
  return api(ctx, 'POST', '/v1/refunds', { payment_intent: pi });
}
