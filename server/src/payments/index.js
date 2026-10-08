// Ponto de entrada dos pagamentos: métodos disponíveis, início do checkout, webhooks, transferências e comprovativos.
import fs from 'node:fs';
import path from 'node:path';
import { fail } from '../http.js';
import { getSetting, mail, audit, fmtMoney } from '../core.js';
import { uuid, hmac, safeEqual, randomToken } from '../security.js';
import { createOrder, confirmOrder, providerRenewal, failOrder, reverseOrder, recordEvent, eventDone, METHOD_LABEL } from './orders.js';
import * as stripe from './stripe.js';
import * as paypal from './paypal.js';

const bankReady = (b) => !!(b && b.holder && b.bank && b.iban);
/** Métodos disponíveis para um país (ativos, configurados e com câmbio, quando aplicável). */
export function methodsFor(ctx, country) {
  const M = getSetting(ctx, 'methods'), rates = getSetting(ctx, 'currencies').rates || {};
  const okCountry = (m) => !m.countries || m.countries === '*' || String(m.countries).split(',').map((s) => s.trim().toUpperCase()).includes(String(country || '').toUpperCase());
  const out = [];
  const add = (id, configured, why, extra) => { const m = M[id] || {}; if (m.enabled && okCountry(m)) out.push({ id, label: METHOD_LABEL[id], available: configured, why: configured ? null : why, ...extra }); };
  add('card', stripe.stripeConfigured(ctx), 'Stripe por configurar');
  add('paypal', paypal.paypalConfigured(ctx), 'PayPal por configurar');
  for (const k of ['bank_pt', 'bank_ao']) {
    const b = getSetting(ctx, k), cur = b.currency, rateOk = cur === 'USD' || (rates[cur] && rates[cur].rate > 0);
    add(k, bankReady(b) && rateOk, !bankReady(b) ? 'Dados bancários por preencher' : 'Câmbio USD→' + cur + ' por configurar', { currency: cur, example: !!b.example });
  }
  if (ctx.cfg.test) add('test', true, null, { test: true });
  return out;
}

export async function startCheckout(ctx, user, planId, method, country, billing) {
  const m = methodsFor(ctx, country).find((x) => x.id === method);
  if (!m) fail(400, 'Método de pagamento indisponível para o teu país.', 'METODO_INDISPONIVEL');
  if (!m.available) fail(503, 'Este método de pagamento ainda não está configurado: ' + m.why + '.', 'METODO_INDISPONIVEL');
  const { order, plan } = createOrder(ctx, user, planId, method, country, billing);
  if (method === 'card') return { order, redirect: await stripe.createCheckout(ctx, order, plan, user) };
  if (method === 'paypal') return { order, redirect: await paypal.createCheckout(ctx, order, plan, user) };
  if (method === 'test') return { order, redirect: `${ctx.cfg.publicUrl}/teste-pagamento?ref=${order.ref}` };
  // transferência: instruções + painel de comprovativos
  const b = getSetting(ctx, method);
  mail(ctx, user.email, 'transfer_instructions', { name: user.name, ref: order.ref, amount: fmtMoney(order.amount_cents, order.currency), bank: bankText(b), due: new Date(order.due_at).toLocaleDateString('pt-PT'), link: `${ctx.cfg.publicUrl}/conta#encomenda/${order.ref}` });
  return { order, redirect: `${ctx.cfg.publicUrl}/conta#encomenda/${order.ref}` };
}
export const bankText = (b) => [`Titular: ${b.holder}`, `Banco: ${b.bank}`, `IBAN / conta: ${b.iban}`, b.swift ? `SWIFT/BIC: ${b.swift}` : null, `Moeda: ${b.currency}`, b.example ? '(EXEMPLO DE TESTES — NÃO TRANSFERIR)' : null].filter(Boolean).join('\n');

// ---------- webhooks ----------
export async function webhook(ctx, provider, raw, headers) {
  let ev, id, type;
  if (provider === 'stripe') { ev = stripe.verifyStripe(ctx, raw, headers['stripe-signature']); id = ev.id; type = ev.type; }
  else if (provider === 'paypal') { ev = await paypal.verifyPaypal(ctx, raw, headers); id = ev.id; type = ev.event_type; }
  else if (provider === 'test') {
    if (!ctx.cfg.test) fail(404, 'Não encontrado.', 'NAO_EXISTE');
    if (!safeEqual(headers['x-test-signature'] || '', hmac(ctx.cfg.testWebhookSecret, raw))) fail(400, 'Assinatura inválida.', 'ASSINATURA');
    ev = JSON.parse(raw.toString('utf8')); id = ev.id; type = ev.type;
  } else fail(404, 'Prestador desconhecido.', 'NAO_EXISTE');
  if (!id) fail(400, 'Evento sem id.', 'EVENTO_INVALIDO');
  if (!recordEvent(ctx, provider, id, type, raw.toString('utf8'))) return { duplicate: true };
  try {
    const result = provider === 'stripe' ? await stripe.handleStripe(ctx, ev) : provider === 'paypal' ? await paypal.handlePaypal(ctx, ev) : handleTest(ctx, ev);
    eventDone(ctx, provider, id, result);
    return { ok: true, result };
  } catch (e) { ctx.db.run('UPDATE payment_events SET result = ? WHERE provider = ? AND event_id = ?', 'erro: ' + e.message, provider, id); throw e; }
}

// prestador simulado (só no modo de testes): passa pelo mesmo caminho dos webhooks reais, com assinatura
function handleTest(ctx, ev) {
  const o = ev.data || {};
  const order = o.order_id ? ctx.db.get('SELECT * FROM orders WHERE id = ?', o.order_id) : null;
  switch (ev.type) {
    case 'payment.succeeded': if (!order) return 'encomenda desconhecida'; confirmOrder(ctx, order.id, { provider: 'test', paymentId: o.payment_id, amountCents: order.amount_cents, currency: order.currency }); return 'confirmada';
    case 'payment.failed': if (order) failOrder(ctx, order.id, 'failed', 'test', o.payment_id); return 'falhada';
    case 'payment.refunded': { const p = ctx.db.get("SELECT * FROM payments WHERE provider = 'test' AND provider_payment_id = ?", o.payment_id || ''); if (p) reverseOrder(ctx, p.order_id, 'refunded', 'test', 'Reembolso (simulado)'); return 'reembolsada'; }
    case 'payment.disputed': { const p = ctx.db.get("SELECT * FROM payments WHERE provider = 'test' AND provider_payment_id = ?", o.payment_id || ''); if (p) reverseOrder(ctx, p.order_id, 'disputed', 'test', 'Contestação (simulada)'); return 'contestada'; }
    case 'subscription.renewed': { const s = ctx.db.get('SELECT * FROM subscriptions WHERE id = ?', o.subscription_id || ''); if (!s) return 'subscrição desconhecida'; providerRenewal(ctx, s, { provider: 'test', paymentId: o.payment_id }); return 'renovada'; }
    case 'subscription.payment_failed': { const s = ctx.db.get('SELECT * FROM subscriptions WHERE id = ?', o.subscription_id || ''); if (s) stripe.subFailed(ctx, s, 'simulado'); return 'falha de cobrança'; }
    default: return 'ignorado';
  }
}
/** Simulação a partir da página de testes: gera e assina o evento como faria um prestador. */
export async function simulate(ctx, type, data, eventId) {
  if (!ctx.cfg.test) fail(404, 'Não encontrado.', 'NAO_EXISTE');
  const raw = Buffer.from(JSON.stringify({ id: eventId || 'evt_test_' + randomToken(9), type, data }));
  return webhook(ctx, 'test', raw, { 'x-test-signature': hmac(ctx.cfg.testWebhookSecret, raw) });
}

// ---------- transferências: comprovativos ----------
const MAGIC = [['application/pdf', [0x25, 0x50, 0x44, 0x46]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/png', [0x89, 0x50, 0x4e, 0x47]]];
export const PROOF_MAX = 10 * 1024 * 1024;
export function uploadProof(ctx, user, order, buf, meta) {
  if (!['bank_pt', 'bank_ao'].includes(order.method)) fail(400, 'Esta encomenda não é por transferência.', 'METODO_INVALIDO');
  if (!['pending', 'awaiting_validation'].includes(order.status)) fail(409, 'Esta encomenda já não aceita comprovativos.', 'ESTADO_INVALIDO');
  if (!buf.length) fail(400, 'Ficheiro vazio.', 'FICHEIRO_INVALIDO');
  if (buf.length > PROOF_MAX) fail(413, 'O comprovativo não pode passar de 10 MB.', 'DEMASIADO_GRANDE');
  const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind) fail(415, 'Formato não aceite. Envia PDF, JPG ou PNG.', 'FORMATO_INVALIDO');
  const name = String(meta.filename || 'comprovativo').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 100);
  const storage = uuid();
  fs.writeFileSync(path.join(ctx.cfg.dataDir, 'uploads', storage), buf, { mode: 0o600 });
  const id = uuid(), now = ctx.now();
  const declared = meta.amount ? Math.round(parseFloat(String(meta.amount).replace(/\s/g, '').replace(',', '.')) * 100) : null;
  ctx.db.tx(() => {
    if (!meta.complement) ctx.db.run("UPDATE proofs SET status = 'superseded' WHERE order_id = ? AND status IN ('submitted','needs_info')", order.id);
    ctx.db.run('INSERT INTO proofs (id, order_id, user_id, filename, mime, size, storage_name, declared_cents, declared_currency, transfer_date, transfer_ref, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, order.id, user.id, name, kind[0], buf.length, storage, Number.isFinite(declared) ? declared : null, order.currency, String(meta.date || '').slice(0, 20) || null, String(meta.ref || '').slice(0, 80) || null, 'submitted', now);
    ctx.db.run("UPDATE orders SET status = 'awaiting_validation', updated_at = ? WHERE id = ?", now, order.id);
  });
  mail(ctx, user.email, 'proof_received', { name: user.name, ref: order.ref });
  return ctx.db.get('SELECT * FROM proofs WHERE id = ?', id);
}
export const proofPath = (ctx, p) => path.join(ctx.cfg.dataDir, 'uploads', p.storage_name);

/** Validação administrativa: só depois de verificar a entrada efetiva do dinheiro. Nunca duplica licenças. */
export function approveTransfer(ctx, admin, order, note) {
  if (!['bank_pt', 'bank_ao'].includes(order.method)) fail(400, 'Não é uma transferência.', 'METODO_INVALIDO');
  if (order.status === 'confirmed') return { duplicate: true, order };
  if (!['pending', 'awaiting_validation'].includes(order.status)) fail(409, 'Estado não permite aprovação: ' + order.status, 'ESTADO_INVALIDO');
  const r = confirmOrder(ctx, order.id, { provider: order.method, paymentId: 'transfer:' + order.id, actor: admin.email, amountCents: order.amount_cents, currency: order.currency });
  ctx.db.run("UPDATE proofs SET status = 'accepted', reviewed_by = ?, reviewed_at = ? WHERE order_id = ? AND status IN ('submitted','needs_info')", admin.email, ctx.now(), order.id);
  audit(ctx, admin, 'transfer.approve', ['order', order.id], { ref: order.ref, amount: fmtMoney(order.amount_cents, order.currency) }, note || 'Entrada do valor verificada');
  return r;
}
export function proofDecision(ctx, admin, order, decision, reason) {
  if (!reason || String(reason).trim().length < 3) fail(400, 'O motivo é obrigatório.', 'MOTIVO_OBRIGATORIO');
  const p = ctx.db.get("SELECT * FROM proofs WHERE order_id = ? AND status IN ('submitted','needs_info') ORDER BY created_at DESC", order.id);
  if (!p && decision === 'reject') fail(409, 'Não há comprovativo por analisar.', 'SEM_COMPROVATIVO');
  const now = ctx.now(), u = ctx.db.get('SELECT * FROM users WHERE id = ?', order.user_id);
  if (decision === 'needs_info') {
    if (p) ctx.db.run("UPDATE proofs SET status = 'needs_info', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", reason, admin.email, now, p.id);
    ctx.db.run("UPDATE orders SET status = 'pending', updated_at = ? WHERE id = ?", now, order.id);
    mail(ctx, u.email, 'proof_needs_info', { name: u.name, ref: order.ref, reason, link: `${ctx.cfg.publicUrl}/conta#encomenda/${order.ref}` });
  } else {
    ctx.db.run("UPDATE proofs SET status = 'rejected', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", reason, admin.email, now, p.id);
    ctx.db.run("UPDATE orders SET status = 'pending', updated_at = ? WHERE id = ?", now, order.id);
    mail(ctx, u.email, 'payment_rejected', { name: u.name, ref: order.ref, reason });
  }
  audit(ctx, admin, 'transfer.' + decision, ['order', order.id], { ref: order.ref }, reason);
}

export { stripe, paypal, METHOD_LABEL };
