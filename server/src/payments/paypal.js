// PayPal: ordens (pagamento único) e subscrições (planos criados no PayPal), confirmação no servidor + webhooks verificados.
import { fail } from '../http.js';
import { confirmOrder, providerRenewal, failOrder, reverseOrder } from './orders.js';
import { subFailed } from './stripe.js';

function cred(ctx) {
  const s = ctx.creds ? ctx.creds('paypal') : {};
  return { clientId: ctx.cfg.paypal.clientId || s.clientId || '', clientSecret: ctx.cfg.paypal.clientSecret || s.clientSecret || '', webhookId: ctx.cfg.paypal.webhookId || s.webhookId || '', apiBase: ctx.cfg.paypal.apiBase };
}
export const paypalConfigured = (ctx) => { const c = cred(ctx); return !!(c.clientId && c.clientSecret && c.webhookId); };
let tok = null;
async function token(ctx) {
  const c = cred(ctx);
  if (!c.clientId || !c.clientSecret) fail(503, 'PayPal ainda não configurado.', 'PRESTADOR_NAO_CONFIGURADO');
  if (tok && tok.base === c.apiBase && tok.exp > Date.now() + 60000) return tok.v;
  const r = await fetch(c.apiBase + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(c.clientId + ':' + c.clientSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, 'PayPal: autenticação falhou.', 'PRESTADOR_ERRO');
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1000, base: c.apiBase };
  return tok.v;
}
async function api(ctx, method, path, body) {
  const r = await fetch(cred(ctx).apiBase + path, { method, headers: { Authorization: 'Bearer ' + (await token(ctx)), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, 'PayPal: ' + (j.message || j.name || r.status), 'PRESTADOR_ERRO');
  return j;
}
const money = (cents) => (cents / 100).toFixed(2);
const approveLink = (j) => (j.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');

export async function createCheckout(ctx, order, plan) {
  const base = ctx.cfg.publicUrl;
  if (plan.kind === 'subscription') {
    if (!plan.paypal_plan_id) fail(503, 'Subscrição PayPal ainda não configurada para este plano (falta o ID do plano PayPal).', 'PRESTADOR_NAO_CONFIGURADO');
    const s = await api(ctx, 'POST', '/v1/billing/subscriptions', { plan_id: plan.paypal_plan_id, custom_id: order.id, application_context: { brand_name: 'MIXMIND by Piradex', user_action: 'SUBSCRIBE_NOW', return_url: `${base}/api/pay/paypal/sub-return?o=${order.id}`, cancel_url: `${base}/comprar?plano=${plan.id}&cancelado=1` } });
    ctx.db.run('UPDATE orders SET provider_ref = ? WHERE id = ?', s.id, order.id);
    const l = approveLink(s); if (!l) fail(502, 'PayPal não devolveu a ligação de aprovação.', 'PRESTADOR_ERRO');
    return l.href;
  }
  const o = await api(ctx, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.ref, description: `MIXMIND by Piradex — ${plan.name}`, amount: { currency_code: order.currency, value: money(order.amount_cents) } }],
    payment_source: { paypal: { experience_context: { brand_name: 'MIXMIND by Piradex', user_action: 'PAY_NOW', return_url: `${base}/api/pay/paypal/return?o=${order.id}`, cancel_url: `${base}/comprar?plano=${plan.id}&cancelado=1` } } },
  });
  ctx.db.run('UPDATE orders SET provider_ref = ? WHERE id = ?', o.id, order.id);
  const l = approveLink(o); if (!l) fail(502, 'PayPal não devolveu a ligação de aprovação.', 'PRESTADOR_ERRO');
  return l.href;
}
/** Regresso do PayPal: a captura é feita pelo servidor (resposta autenticada do PayPal) — nunca se confia só no browser. */
export async function captureReturn(ctx, orderId) {
  const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order || !order.provider_ref) fail(404, 'Encomenda desconhecida.', 'NAO_EXISTE');
  if (order.status === 'confirmed') return order;
  const c = await api(ctx, 'POST', `/v2/checkout/orders/${encodeURIComponent(order.provider_ref)}/capture`, {});
  const cap = c.purchase_units && c.purchase_units[0] && c.purchase_units[0].payments && c.purchase_units[0].payments.captures && c.purchase_units[0].payments.captures[0];
  if (c.status === 'COMPLETED' && cap && cap.status === 'COMPLETED' && cap.amount.currency_code === order.currency && Math.round(+cap.amount.value * 100) === order.amount_cents)
    confirmOrder(ctx, order.id, { provider: 'paypal', paymentId: cap.id, amountCents: order.amount_cents, currency: order.currency });
  return ctx.db.get('SELECT * FROM orders WHERE id = ?', order.id);
}
export async function subReturn(ctx, orderId) {
  const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order || !order.provider_ref) fail(404, 'Encomenda desconhecida.', 'NAO_EXISTE');
  if (order.status === 'confirmed') return order;
  const s = await api(ctx, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(order.provider_ref));
  if (s.status === 'ACTIVE' && s.custom_id === order.id) confirmOrder(ctx, order.id, { provider: 'paypal', paymentId: 'activation:' + s.id, periodEnd: s.billing_info && s.billing_info.next_billing_time ? Date.parse(s.billing_info.next_billing_time) : null, providerSubId: s.id });
  return ctx.db.get('SELECT * FROM orders WHERE id = ?', order.id);
}

/** Verificação do webhook pela API do PayPal (verify-webhook-signature). */
export async function verifyPaypal(ctx, raw, h) {
  const c = cred(ctx);
  if (!c.webhookId) fail(503, 'Webhook PayPal sem ID configurado.', 'PRESTADOR_NAO_CONFIGURADO');
  const ev = JSON.parse(raw.toString('utf8'));
  const v = await api(ctx, 'POST', '/v1/notifications/verify-webhook-signature', { auth_algo: h['paypal-auth-algo'], cert_url: h['paypal-cert-url'], transmission_id: h['paypal-transmission-id'], transmission_sig: h['paypal-transmission-sig'], transmission_time: h['paypal-transmission-time'], webhook_id: c.webhookId, webhook_event: ev });
  if (v.verification_status !== 'SUCCESS') fail(400, 'Assinatura PayPal inválida.', 'ASSINATURA');
  return ev;
}
const byCapture = (ctx, capId) => ctx.db.get("SELECT * FROM payments WHERE provider = 'paypal' AND provider_payment_id = ?", capId || '');
export async function handlePaypal(ctx, ev) {
  const r = ev.resource || {};
  switch (ev.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', r.custom_id || '');
      if (!order) return 'encomenda desconhecida';
      if (r.amount && (r.amount.currency_code !== order.currency || Math.round(+r.amount.value * 100) !== order.amount_cents)) return 'valor diferente do esperado — verificação manual';
      confirmOrder(ctx, order.id, { provider: 'paypal', paymentId: r.id, amountCents: order.amount_cents, currency: order.currency });
      return 'confirmada';
    }
    case 'PAYMENT.CAPTURE.DENIED': { const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', r.custom_id || ''); if (order) failOrder(ctx, order.id, 'failed', 'paypal', r.id); return 'falhada'; }
    case 'PAYMENT.CAPTURE.REFUNDED': {
      const up = (r.links || []).find((l) => l.rel === 'up'), capId = up ? up.href.split('/').pop() : null;
      const pay = byCapture(ctx, capId) || (r.custom_id && ctx.db.get("SELECT * FROM payments WHERE provider = 'paypal' AND order_id = ?", r.custom_id));
      if (!pay) return 'pagamento desconhecido';
      reverseOrder(ctx, pay.order_id, 'refunded', 'paypal', 'Reembolso PayPal');
      return 'reembolsada';
    }
    case 'CUSTOMER.DISPUTE.CREATED': {
      const tx = r.disputed_transactions && r.disputed_transactions[0], pay = tx && byCapture(ctx, tx.seller_transaction_id);
      if (!pay) return 'pagamento desconhecido';
      reverseOrder(ctx, pay.order_id, 'disputed', 'paypal', 'Contestação de pagamento (PayPal)');
      return 'contestada';
    }
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const order = ctx.db.get('SELECT * FROM orders WHERE id = ?', r.custom_id || '');
      if (!order) return 'encomenda desconhecida';
      confirmOrder(ctx, order.id, { provider: 'paypal', paymentId: 'activation:' + r.id, periodEnd: r.billing_info && r.billing_info.next_billing_time ? Date.parse(r.billing_info.next_billing_time) : null, providerSubId: r.id });
      return 'subscrição iniciada';
    }
    case 'PAYMENT.SALE.COMPLETED': {
      const sub = ctx.db.get("SELECT * FROM subscriptions WHERE provider = 'paypal' AND provider_sub_id = ?", r.billing_agreement_id || '');
      if (!sub) return 'subscrição desconhecida (ou primeira cobrança antes da ativação)';
      const s = await api(ctx, 'GET', '/v1/billing/subscriptions/' + encodeURIComponent(sub.provider_sub_id));
      const next = s.billing_info && s.billing_info.next_billing_time ? Date.parse(s.billing_info.next_billing_time) : null;
      if (!next || next <= (sub.current_period_end || 0) + 3600e3) return 'primeira cobrança (já contada na ativação)';
      providerRenewal(ctx, sub, { provider: 'paypal', paymentId: r.id, amountCents: r.amount ? Math.round(+r.amount.total * 100) : undefined, currency: r.amount ? r.amount.currency : 'USD', periodEnd: next });
      return 'renovada';
    }
    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': { const sub = ctx.db.get("SELECT * FROM subscriptions WHERE provider = 'paypal' AND provider_sub_id = ?", r.id || ''); if (sub) subFailed(ctx, sub, 'PayPal'); return 'falha de cobrança'; }
    case 'BILLING.SUBSCRIPTION.CANCELLED':
    case 'BILLING.SUBSCRIPTION.EXPIRED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      const sub = ctx.db.get("SELECT * FROM subscriptions WHERE provider = 'paypal' AND provider_sub_id = ?", r.id || '');
      if (!sub) return 'subscrição desconhecida';
      ctx.db.run("UPDATE subscriptions SET status = CASE WHEN ? = 'BILLING.SUBSCRIPTION.SUSPENDED' THEN 'past_due' ELSE 'cancelled' END, auto_renew = 0, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE id = ?", ev.event_type, ctx.now(), ctx.now(), sub.id);
      return 'atualizada';
    }
    default: return 'ignorado';
  }
}
export const paypalCancel = (ctx, sub) => api(ctx, 'POST', `/v1/billing/subscriptions/${encodeURIComponent(sub.provider_sub_id)}/cancel`, { reason: 'Cancelado pelo cliente na área de cliente' });
export const paypalRefund = (ctx, pay) => api(ctx, 'POST', `/v2/payments/captures/${encodeURIComponent(pay.provider_payment_id)}/refund`, {});
