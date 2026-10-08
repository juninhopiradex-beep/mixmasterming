// Área do cliente: resumo, encomendas e comprovativos, licenças e computador, subscrições, perfil.
import fs from 'node:fs';
import { fail, send } from '../http.js';
import { getSetting, mail, fmtMoney, audit } from '../core.js';
import { uploadProof, proofPath, bankText, METHOD_LABEL, stripe, paypal } from '../payments/index.js';
import { createOrder } from '../payments/orders.js';
import { deactivate } from '../licensing.js';
import { requireUser, str, countryOk, safeUser } from './util.js';

const own = (ctx, u, table, id) => { const row = ctx.db.get(`SELECT * FROM ${table} WHERE id = ?`, id); if (!row || row.user_id !== u.id) fail(404, 'Não encontrado.', 'NAO_EXISTE'); return row; };
const orderView = (ctx, o) => {
  const plan = ctx.db.get('SELECT name, kind, interval FROM plans WHERE id = ?', o.plan_id);
  const bank = ['bank_pt', 'bank_ao'].includes(o.method) ? getSetting(ctx, o.method) : null;
  return {
    ref: o.ref, plan: plan.name, planKind: plan.kind, kind: o.kind, method: o.method, methodLabel: METHOD_LABEL[o.method], status: o.status,
    amount: fmtMoney(o.amount_cents, o.currency), currency: o.currency, tax: o.tax_cents ? fmtMoney(o.tax_cents, o.currency) : null, usd: fmtMoney(o.usd_cents, 'USD'), fx: o.fx_rate,
    created_at: o.created_at, due_at: o.due_at, confirmed_at: o.confirmed_at,
    bank: bank && ['pending', 'awaiting_validation'].includes(o.status) ? { text: bankText(bank), holder: bank.holder, bank: bank.bank, iban: bank.iban, swift: bank.swift, currency: bank.currency, instructions: bank.instructions, example: !!bank.example } : null,
    proofs: ctx.db.all('SELECT id, filename, mime, size, declared_cents, declared_currency, transfer_date, transfer_ref, status, reason, created_at FROM proofs WHERE order_id = ? ORDER BY created_at DESC', o.id)
      .map((p) => ({ ...p, declared: p.declared_cents !== null ? fmtMoney(p.declared_cents, p.declared_currency) : null })),
  };
};

export default function register(r, ctx) {
  r.get('/api/account/overview', (req) => {
    const u = requireUser(req), db = ctx.db, verified = !!u.email_verified_at;
    const orders = db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', u.id).map((o) => orderView(ctx, o));
    const subs = db.all('SELECT s.*, p.name plan_name, p.interval FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? ORDER BY s.created_at DESC', u.id).map((s) => ({
      id: s.id, plan: s.plan_name, interval: s.interval, method: s.method, methodLabel: METHOD_LABEL[s.method], status: s.status, autoRenew: !!s.auto_renew, cancelAtPeriodEnd: !!s.cancel_at_period_end,
      periodEnd: s.current_period_end, nextRenewal: s.auto_renew && !s.cancel_at_period_end && s.status === 'active' ? s.current_period_end : null, manual: !s.provider_sub_id && ['bank_pt', 'bank_ao'].includes(s.method),
      pendingRenewal: !!db.get("SELECT 1 FROM orders WHERE subscription_id = ? AND kind = 'renewal' AND status IN ('pending','awaiting_validation')", s.id),
    }));
    const licenses = db.all('SELECT * FROM licenses WHERE user_id = ? ORDER BY issued_at DESC', u.id).map((l) => {
      const d = db.get('SELECT name, platform, app_version, activated_at, last_seen_at FROM devices WHERE license_id = ? AND deactivated_at IS NULL', l.id);
      return { id: l.id, key: verified ? l.key : null, key4: l.key.slice(-4), type: l.type, status: l.status, statusReason: l.status_reason, major: l.major, issued_at: l.issued_at, expires_at: l.expires_at, device: d || null,
        transfers: db.get('SELECT COUNT(*) n FROM devices WHERE license_id = ?', l.id).n };
    });
    const versions = db.all('SELECT version, notes, url_web, url_windows, url_macos, published_at FROM versions ORDER BY published_at DESC LIMIT 5');
    return { user: safeUser(u), verified, orders, subscriptions: subs, licenses, versions, appUrl: ctx.cfg.appUrl, support: getSetting(ctx, 'support'), licensing: getSetting(ctx, 'licensing'), mode: ctx.cfg.mode };
  });

  r.patch('/api/account/profile', (req) => {
    const u = requireUser(req), b = req.body;
    const country = b.country !== undefined ? str(b.country, 2).toUpperCase() : u.country;
    if (country && !countryOk(country)) fail(400, 'País inválido.', 'PAIS');
    const name = b.name !== undefined ? str(b.name, 100) : u.name; if (name.length < 2) fail(400, 'Nome inválido.', 'NOME');
    ctx.db.run('UPDATE users SET name = ?, country = ?, billing_name = ?, billing_address = ?, tax_id = ?, updated_at = ? WHERE id = ?', name, country || null, str(b.billing_name ?? u.billing_name, 120) || null, str(b.billing_address ?? u.billing_address, 300) || null, str(b.tax_id ?? u.tax_id, 40) || null, ctx.now(), u.id);
    return { user: safeUser(ctx.db.get('SELECT * FROM users WHERE id = ?', u.id)) };
  });

  r.get('/api/account/orders/:ref', (req) => {
    const u = requireUser(req), o = ctx.db.get('SELECT * FROM orders WHERE ref = ?', str(req.params.ref, 40));
    if (!o || o.user_id !== u.id) fail(404, 'Encomenda não encontrada.', 'NAO_EXISTE');
    return orderView(ctx, o);
  });
  // envio do borderô: corpo bruto (PDF/JPG/PNG), metadados na query
  r.post('/api/account/orders/:ref/proofs', (req) => {
    const u = requireUser(req), o = ctx.db.get('SELECT * FROM orders WHERE ref = ?', str(req.params.ref, 40));
    if (!o || o.user_id !== u.id) fail(404, 'Encomenda não encontrada.', 'NAO_EXISTE');
    const p = uploadProof(ctx, u, o, req.raw, { filename: req.query.filename, amount: req.query.amount, date: req.query.date, ref: req.query.ref, complement: req.query.complement === '1' });
    return { ok: true, proof: { id: p.id, status: p.status }, message: 'Comprovativo recebido. O pagamento encontra-se a aguardar validação.' };
  });
  r.get('/api/account/proofs/:id/file', (req, res) => {
    const u = requireUser(req), p = own(ctx, u, 'proofs', req.params.id);
    send(res, 200, fs.readFileSync(proofPath(ctx, p)), { 'Content-Type': p.mime, 'Content-Disposition': `inline; filename="${encodeURIComponent(p.filename)}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", 'Cache-Control': 'private, no-store' });
  });
  r.post('/api/account/orders/:ref/cancel', (req) => {
    const u = requireUser(req), o = ctx.db.get('SELECT * FROM orders WHERE ref = ?', str(req.params.ref, 40));
    if (!o || o.user_id !== u.id) fail(404, 'Encomenda não encontrada.', 'NAO_EXISTE');
    if (o.status !== 'pending') fail(409, 'Só encomendas pendentes podem ser canceladas.', 'ESTADO_INVALIDO');
    ctx.db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", ctx.now(), o.id);
    return { ok: true };
  });

  // licenças: desativar o computador (para mudar de computador)
  r.post('/api/account/licenses/:id/deactivate', (req) => {
    const u = requireUser(req), l = own(ctx, u, 'licenses', req.params.id);
    if (!u.email_verified_at) fail(403, 'Confirma primeiro o teu email.', 'EMAIL_POR_CONFIRMAR');
    return deactivate(ctx, l, u, 'Desativado pelo cliente na área de cliente');
  });
  r.get('/api/account/licenses/:id/history', (req) => {
    const u = requireUser(req), l = own(ctx, u, 'licenses', req.params.id);
    return {
      events: ctx.db.all('SELECT at, actor, action, details FROM license_events WHERE license_id = ? ORDER BY at DESC LIMIT 100', l.id).map((e) => ({ ...e, actor: e.actor.includes('@') && e.actor !== u.email ? 'suporte' : e.actor })),
      devices: ctx.db.all('SELECT name, platform, app_version, activated_at, last_seen_at, deactivated_at FROM devices WHERE license_id = ? ORDER BY activated_at DESC', l.id),
    };
  });

  // subscrições: cancelar a renovação (o acesso mantém-se até ao fim do período pago)
  r.post('/api/account/subscriptions/:id/cancel', async (req) => {
    const u = requireUser(req), s = own(ctx, u, 'subscriptions', req.params.id);
    if (!['active', 'past_due'].includes(s.status) || s.cancel_at_period_end) fail(409, 'Esta subscrição já não renova.', 'ESTADO_INVALIDO');
    if (s.provider === 'stripe' && s.provider_sub_id) await stripe.stripeCancel(ctx, s);
    if (s.provider === 'paypal' && s.provider_sub_id) await paypal.paypalCancel(ctx, s);
    const now = ctx.now();
    ctx.db.run('UPDATE subscriptions SET cancel_at_period_end = 1, auto_renew = 0, cancelled_at = ?, updated_at = ? WHERE id = ?', now, now, s.id);
    const plan = ctx.db.get('SELECT name FROM plans WHERE id = ?', s.plan_id);
    mail(ctx, u.email, 'subscription_cancelled', { name: u.name, plan: plan.name, date: new Date(s.current_period_end).toLocaleDateString('pt-PT') });
    audit(ctx, u, 'subscription.cancel_renewal', ['subscription', s.id]);
    return { ok: true, accessUntil: s.current_period_end };
  });
  // renovação manual (subscrições pagas por transferência)
  r.post('/api/account/subscriptions/:id/renew', (req) => {
    const u = requireUser(req), s = own(ctx, u, 'subscriptions', req.params.id);
    if (s.provider_sub_id) fail(400, 'Esta subscrição renova automaticamente pelo prestador.', 'RENOVACAO_AUTOMATICA');
    const method = ['bank_pt', 'bank_ao'].includes(req.body.method) ? req.body.method : s.method;
    if (!['bank_pt', 'bank_ao', 'test'].includes(method)) fail(400, 'Método inválido para renovação manual.', 'METODO_INVALIDO');
    const pend = ctx.db.get("SELECT ref FROM orders WHERE subscription_id = ? AND kind = 'renewal' AND status IN ('pending','awaiting_validation')", s.id);
    if (pend) return { ref: pend.ref, redirect: `${ctx.cfg.publicUrl}/conta#encomenda/${pend.ref}` };
    const { order } = createOrder(ctx, u, s.plan_id, method, u.country, { name: u.billing_name || u.name, address: u.billing_address, taxId: u.tax_id }, { kind: 'renewal', subscriptionId: s.id });
    return { ref: order.ref, redirect: `${ctx.cfg.publicUrl}/conta#encomenda/${order.ref}` };
  });
}
