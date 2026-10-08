// Loja pública: planos, preços, textos legais, checkout, regressos dos prestadores, webhooks e pagamento simulado.
import { fail } from '../http.js';
import { getSetting, publicText, legalReady, annualSaving, quote, createSession, sessionCookie, fmtMoney } from '../core.js';
import { methodsFor, startCheckout, webhook, simulate, paypal } from '../payments/index.js';
import { createCustomer, sendVerification } from './auth.js';
import { str, countryOk, safeUser } from './util.js';

export default function register(r, ctx) {
  r.get('/api/public/store', () => {
    const plans = ctx.db.all('SELECT id, name, kind, interval, price_usd_cents FROM plans WHERE active = 1 ORDER BY sort');
    const st = getSetting(ctx, 'store'), demo = getSetting(ctx, 'demo'), v = ctx.db.get('SELECT * FROM versions WHERE is_current = 1');
    return {
      mode: ctx.cfg.mode, plans: plans.map((p) => ({ ...p, price: fmtMoney(p.price_usd_cents, 'USD') })), annualSaving: annualSaving(ctx),
      taxNotice: st.taxNotice, refundDays: st.refundDaysPerpetual, demo, appUrl: ctx.cfg.appUrl, version: v && v.version,
      legalReady: legalReady(ctx), support: getSetting(ctx, 'support'),
      methods: methodsFor(ctx, '').map((m) => ({ id: m.id, label: m.label, available: m.available })),
    };
  });
  r.get('/api/public/text/:key', (req) => {
    if (!['terms', 'privacy', 'refund'].includes(req.params.key)) fail(404, 'Texto inexistente.', 'NAO_EXISTE');
    return publicText(ctx, req.params.key);
  });
  r.get('/api/public/methods', (req) => methodsFor(ctx, str(req.query.country, 2).toUpperCase()));
  r.get('/api/public/quote', (req) => {
    const plan = ctx.db.get('SELECT * FROM plans WHERE id = ? AND active = 1', req.query.plan || '');
    if (!plan) fail(400, 'Plano indisponível.', 'PLANO_INVALIDO');
    const q = quote(ctx, plan, req.query.method || 'card', str(req.query.country, 2).toUpperCase());
    return { ...q, plan: { id: plan.id, name: plan.name, kind: plan.kind, interval: plan.interval }, total: fmtMoney(q.total_cents, q.currency), net: fmtMoney(q.net_cents, q.currency), tax: fmtMoney(q.tax_cents, q.currency), usd: fmtMoney(q.usd_cents, 'USD') };
  });

  // checkout: cria (ou usa) a conta, cria a encomenda e devolve o destino (prestador ou instruções de transferência)
  r.post('/api/checkout', async (req, res) => {
    const b = req.body;
    if (!ctx.cfg.test && !legalReady(ctx)) fail(503, 'A loja abre depois da publicação dos termos, da política de privacidade e da política de reembolsos.', 'LOJA_FECHADA');
    if (!b.acceptTerms || !b.acceptPrivacy) fail(400, 'Tens de aceitar os termos e a política de privacidade.', 'TERMOS');
    const country = str(b.country, 2).toUpperCase();
    if (!countryOk(country)) fail(400, 'Escolhe o país.', 'PAIS');
    let user = req.user;
    if (user && user.role !== 'customer') fail(400, 'Contas da equipa não fazem compras. Usa uma conta de cliente.', 'EQUIPA');
    if (!user) {
      user = createCustomer(ctx, { name: b.name, email: b.email, password: b.password, country });
      sendVerification(ctx, user);
      res.setHeader('Set-Cookie', sessionCookie(ctx, createSession(ctx, user, req, true)));
    }
    const billing = { name: str(b.billingName || user.name, 120), address: str(b.billingAddress, 300), taxId: str(b.taxId, 40) };
    ctx.db.run('UPDATE users SET country = COALESCE(country, ?), billing_name = COALESCE(?, billing_name), billing_address = COALESCE(?, billing_address), tax_id = COALESCE(?, tax_id), updated_at = ? WHERE id = ?', country, billing.name || null, billing.address || null, billing.taxId || null, ctx.now(), user.id);
    const out = await startCheckout(ctx, user, str(b.plan, 20), str(b.method, 20), country, billing);
    return { ref: out.order.ref, redirect: out.redirect, user: safeUser(ctx.db.get('SELECT * FROM users WHERE id = ?', user.id)) };
  });

  // regresso do PayPal → captura no servidor → área de cliente
  r.get('/api/pay/paypal/return', async (req) => { const o = await paypal.captureReturn(ctx, str(req.query.o, 60)); return { __redirect: `${ctx.cfg.publicUrl}/conta#encomenda/${o.ref}` }; });
  r.get('/api/pay/paypal/sub-return', async (req) => { const o = await paypal.subReturn(ctx, str(req.query.o, 60)); return { __redirect: `${ctx.cfg.publicUrl}/conta#encomenda/${o.ref}` }; });

  // webhooks (corpo bruto; assinatura verificada antes de qualquer efeito)
  r.post('/api/webhooks/:provider', async (req) => webhook(ctx, req.params.provider, req.raw, req.headers));

  // prestador simulado (modo de testes): só o dono da encomenda (ou a equipa) pode simular
  r.get('/api/test/order/:ref', (req) => {
    if (!ctx.cfg.test) fail(404, 'Não encontrado.', 'NAO_EXISTE');
    const o = ctx.db.get('SELECT o.*, p.name plan_name, p.kind plan_kind FROM orders o JOIN plans p ON p.id = o.plan_id WHERE ref = ?', str(req.params.ref, 40));
    if (!o || !req.user || (o.user_id !== req.user.id && req.user.role === 'customer')) fail(404, 'Encomenda não encontrada.', 'NAO_EXISTE');
    const sub = o.subscription_id && ctx.db.get('SELECT * FROM subscriptions WHERE id = ?', o.subscription_id);
    const pay = ctx.db.get("SELECT provider_payment_id FROM payments WHERE order_id = ? AND provider = 'test' ORDER BY created_at DESC", o.id);
    return { ref: o.ref, status: o.status, plan: o.plan_name, kind: o.plan_kind, method: o.method, amount: fmtMoney(o.amount_cents, o.currency), subscription: sub ? { id: sub.id, status: sub.status, until: sub.current_period_end } : null, paymentId: pay && pay.provider_payment_id };
  });
  r.post('/api/test/simulate', async (req) => {
    if (!ctx.cfg.test) fail(404, 'Não encontrado.', 'NAO_EXISTE');
    const o = ctx.db.get('SELECT * FROM orders WHERE ref = ?', str(req.body.ref, 40));
    if (!o || !req.user || (o.user_id !== req.user.id && req.user.role === 'customer')) fail(404, 'Encomenda não encontrada.', 'NAO_EXISTE');
    if (o.method !== 'test') fail(400, 'Só para encomendas com pagamento simulado.', 'METODO_INVALIDO');
    const pay = ctx.db.get("SELECT provider_payment_id FROM payments WHERE order_id = ? AND provider = 'test' ORDER BY created_at DESC", o.id);
    const pid = pay ? pay.provider_payment_id : 'pay_test_' + o.id.slice(0, 8);
    const map = { paid: 'payment.succeeded', failed: 'payment.failed', refund: 'payment.refunded', dispute: 'payment.disputed', renew: 'subscription.renewed', renew_failed: 'subscription.payment_failed' };
    const type = map[req.body.outcome]; if (!type) fail(400, 'Resultado desconhecido.', 'PEDIDO');
    const data = { order_id: o.id, payment_id: type === 'subscription.renewed' ? 'pay_test_renew_' + Date.now() : pid, subscription_id: o.subscription_id };
    return simulate(ctx, type, data, req.body.eventId);
  });
}
