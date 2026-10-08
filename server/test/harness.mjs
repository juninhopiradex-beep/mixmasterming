// Arnês de testes: servidor real numa pasta temporária, cliente HTTP com cookies, Stripe e PayPal falsos.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/core.js';
import { createServer } from '../src/server.js';

export async function startAll(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-'));
  const mocks = await startMocks();
  const adminPw = 'Ini-' + crypto.randomBytes(12).toString('base64url');
  const cfg = loadConfig({ noDotEnv: true, APP_MODE: 'test', PORT: '0', DATA_DIR: dir, ADMIN_EMAIL: 'admin@loja.test', ADMIN_INITIAL_PASSWORD: adminPw,
    STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_API_BASE: mocks.stripe, PAYPAL_CLIENT_ID: 'cid', PAYPAL_CLIENT_SECRET: 'csec', PAYPAL_WEBHOOK_ID: 'WH-1', PAYPAL_API_BASE: mocks.paypal, ...extra });
  cfg.quiet = true;
  const logs = []; const ctx = createContext(cfg); ctx.log = (...a) => logs.push(a.join(' '));
  const server = createServer(ctx);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  ctx.cfg.publicUrl = base;
  return { ctx, base, dir, adminPw, logs, mocks, close: () => { server.close(); mocks.close(); } };
}

export function client(base) {
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const h = { 'X-MM': '1', ...headers };
    if (cookie) h.Cookie = cookie;
    let b = body;
    if (body !== undefined && !Buffer.isBuffer(body)) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const r = await fetch(base + p, { method, headers: h, body: b, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = /mm_s=([^;]*)/.exec(sc); if (m) cookie = m[1] ? 'mm_s=' + m[1] : ''; }
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { /* */ }
    return { status: r.status, body: j, text: txt, headers: r.headers };
  };
  return { get: (p, h) => req('GET', p, undefined, h), post: (p, b, h) => req('POST', p, b === undefined ? {} : b, h), put: (p, b) => req('PUT', p, b), patch: (p, b) => req('PATCH', p, b), raw: req, get cookie() { return cookie; } };
}

export function stripeSig(secret, raw, t = Math.floor(Date.now() / 1000)) { return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; }

/** Prestadores falsos com o mesmo formato de resposta dos reais (o suficiente para os fluxos). */
async function startMocks() {
  const ppOrders = new Map(), ppSubs = new Map();
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const body = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });
  const stripe = http.createServer(async (req, res) => {
    const b = await body(req), f = Object.fromEntries(new URLSearchParams(b));
    if (req.url === '/v1/checkout/sessions') return json(res, 200, { id: 'cs_test_' + crypto.randomBytes(4).toString('hex'), url: 'https://checkout.stripe.test/pay', _form: f });
    if (req.url.startsWith('/v1/subscriptions/')) return json(res, 200, { id: req.url.split('/').pop(), cancel_at_period_end: true });
    if (req.url === '/v1/refunds') return json(res, 200, { id: 're_1', payment_intent: f.payment_intent });
    if (req.url.startsWith('/v1/invoices/')) return json(res, 200, { id: req.url.split('/').pop(), payment_intent: 'pi_from_invoice' });
    json(res, 404, { error: { message: 'mock: ' + req.url } });
  });
  const paypal = http.createServer(async (req, res) => {
    const raw = await body(req), u = req.url; let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch { b = {}; }
    if (u === '/v1/oauth2/token') return json(res, 200, { access_token: 'A21', expires_in: 3600 });
    if (u === '/v2/checkout/orders') { const id = 'PPO' + crypto.randomBytes(3).toString('hex'); ppOrders.set(id, b); return json(res, 201, { id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=' + id }] }); }
    let m = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(u);
    if (m) { const o = ppOrders.get(m[1]); const pu = o.purchase_units[0]; return json(res, 201, { id: m[1], status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP' + m[1], status: 'COMPLETED', custom_id: pu.custom_id, amount: pu.amount }] } }] }); }
    if (u === '/v1/billing/subscriptions') { const id = 'I-' + crypto.randomBytes(3).toString('hex').toUpperCase(); ppSubs.set(id, { ...b, id, status: 'ACTIVE', billing_info: { next_billing_time: new Date(Date.now() + 30 * 864e5).toISOString() } }); return json(res, 201, { id, status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=' + id }] }); }
    m = /^\/v1\/billing\/subscriptions\/([^/]+)(\/cancel)?$/.exec(u);
    if (m) { const s = ppSubs.get(m[1]) || { id: m[1], status: 'ACTIVE', billing_info: { next_billing_time: new Date(Date.now() + 60 * 864e5).toISOString() } }; if (m[2]) { s.status = 'CANCELLED'; res.writeHead(204); return res.end(); } return json(res, 200, s); }
    if (u === '/v1/notifications/verify-webhook-signature') return json(res, 200, { verification_status: b.transmission_sig === 'ok' ? 'SUCCESS' : 'FAILURE' });
    m = /^\/v2\/payments\/captures\/([^/]+)\/refund$/.exec(u); if (m) return json(res, 201, { id: 'REF1', status: 'COMPLETED' });
    json(res, 404, { message: 'mock: ' + u });
  });
  await Promise.all([new Promise((r) => stripe.listen(0, r)), new Promise((r) => paypal.listen(0, r))]);
  return { stripe: `http://127.0.0.1:${stripe.address().port}`, paypal: `http://127.0.0.1:${paypal.address().port}`, ppSubs, close: () => { stripe.close(); paypal.close(); } };
}
