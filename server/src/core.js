// Serviços partilhados: configurações, textos, emails, auditoria, sessões, permissões, dinheiro.
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { PLANS, defaultSettings, TEXTS, EMAILS } from './defaults.js';
import { hashPassword, randomToken, sha256, uuid, makeCipher } from './security.js';
import { fail } from './http.js';

export function createContext(cfg) {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  fs.mkdirSync(path.join(cfg.dataDir, 'uploads'), { recursive: true, mode: 0o700 });
  const db = openDb(path.join(cfg.dataDir, cfg.test ? 'mixmind-test.db' : 'mixmind.db'));
  const ctx = { cfg, db, cipher: makeCipher(cfg.secretKey), now: () => Date.now(), log: (...a) => { if (!cfg.quiet) console.log(new Date().toISOString(), ...a); } };
  seed(ctx);
  return ctx;
}

function seed(ctx) {
  const { db, cfg } = ctx, now = ctx.now();
  if (!db.get('SELECT 1 FROM products WHERE id = ?', 'mixmind')) db.run('INSERT INTO products VALUES (?, ?, ?)', 'mixmind', 'MIXMIND by Piradex', 1);
  if (!db.get('SELECT 1 FROM versions LIMIT 1')) db.run('INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?)', uuid(), 'mixmind', '1.8.0', 1, 'Loja, contas e licenças; editor de voz; WebAssembly.', cfg.appUrl, null, null, 1, now);
  for (const p of PLANS) if (!db.get('SELECT 1 FROM plans WHERE id = ?', p.id)) db.run('INSERT INTO plans (id, name, kind, interval, price_usd_cents, active, sort) VALUES (?,?,?,?,?,1,?)', p.id, p.name, p.kind, p.interval, p.price_usd_cents, p.sort);
  const ds = defaultSettings(cfg.test);
  for (const [k, v] of Object.entries(ds)) if (!db.get('SELECT 1 FROM settings WHERE key = ?', k)) db.run('INSERT INTO settings VALUES (?,?,?,?)', k, JSON.stringify(v), now, 'sistema');
  for (const [k, t] of Object.entries(TEXTS)) if (!db.get('SELECT 1 FROM texts WHERE key = ?', k)) db.run('INSERT INTO texts (key, title, draft, updated_by, updated_at) VALUES (?,?,?,?,?)', k, t.title, t.body, 'sistema', now);
  for (const [k, t] of Object.entries(EMAILS)) if (!db.get('SELECT 1 FROM texts WHERE key = ?', 'email:' + k)) db.run('INSERT INTO texts (key, title, draft, published, updated_by, updated_at, published_at, published_by) VALUES (?,?,?,?,?,?,?,?)', 'email:' + k, t.title, t.body, t.body, 'sistema', now, now, 'sistema');
  // administrador inicial: só a partir de variáveis de ambiente; guarda-se apenas o hash; troca obrigatória no 1.º acesso
  if (!db.get("SELECT 1 FROM users WHERE role = 'owner'") && cfg.adminEmail && cfg.adminInitialPassword) {
    db.run('INSERT INTO users (id, email, name, role, status, email_verified_at, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
      uuid(), cfg.adminEmail.toLowerCase(), 'Administrador', 'owner', 'active', now, hashPassword(cfg.adminInitialPassword), now, now);
    db.run('INSERT INTO audit_log (at, actor_email, action, target_type, details) VALUES (?,?,?,?,?)', now, 'sistema', 'admin.bootstrap', 'user', 'Administrador inicial criado a partir de ADMIN_EMAIL/ADMIN_INITIAL_PASSWORD (troca obrigatória no primeiro acesso).');
    ctx.log('Administrador inicial criado para', cfg.adminEmail, '— troca de palavra-passe obrigatória no primeiro acesso.');
  }
}

// ---------- configurações ----------
export const getSetting = (ctx, k) => { const r = ctx.db.get('SELECT value FROM settings WHERE key = ?', k); return r ? JSON.parse(r.value) : null; };
export const setSetting = (ctx, k, v, by) => ctx.db.run('INSERT INTO settings VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', k, JSON.stringify(v), ctx.now(), by || null);

// ---------- textos ----------
export function getText(ctx, key) { return ctx.db.get('SELECT * FROM texts WHERE key = ?', key); }
/** Texto para mostrar ao público: o publicado; sem publicação → rascunho marcado como provisório (só em testes). */
export function publicText(ctx, key) {
  const t = getText(ctx, key); if (!t) return null;
  if (t.published) return { title: t.title, body: t.published, provisional: false, published_at: t.published_at };
  return ctx.cfg.test ? { title: t.title, body: t.draft, provisional: true } : { title: t.title, body: null, provisional: true };
}
export const legalReady = (ctx) => ['terms', 'privacy', 'refund'].every((k) => { const t = getText(ctx, k); return t && t.published; });

// ---------- emails ----------
const fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (v[k] === undefined || v[k] === null ? '' : String(v[k])));
export async function sendEmail(ctx, to, template, vars) {
  const t = getText(ctx, 'email:' + template);
  if (!t) throw new Error('Template inexistente: ' + template);
  const v = { product: 'MIXMIND by Piradex', ...vars };
  const text = fill(t.published || t.draft, v);
  const m = /^Assunto:\s*(.*)\n+/.exec(text);
  const subject = m ? m[1].trim() : t.title, body = m ? text.slice(m[0].length) : text;
  const now = ctx.now(), E = ctx.cfg.email;
  const id = ctx.db.run('INSERT INTO emails (to_addr, template, subject, body, status, created_at) VALUES (?,?,?,?,?,?)', to, template, subject, body, E.provider === 'outbox' ? 'test' : 'queued', now).lastInsertRowid;
  if (E.provider === 'outbox') return { id, subject, body };
  try {
    let r;
    if (E.provider === 'resend') r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + E.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: E.from, to: [to], subject, text: body }) });
    else if (E.provider === 'postmark') r = await fetch('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'X-Postmark-Server-Token': E.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ From: E.from, To: to, Subject: subject, TextBody: body, MessageStream: 'outbound' }) });
    else throw new Error('EMAIL_PROVIDER desconhecido: ' + E.provider);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    ctx.db.run("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ?", ctx.now(), id);
  } catch (e) { ctx.db.run("UPDATE emails SET status = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 500), id); ctx.log('Email falhou', template, to, e.message); }
  return { id, subject, body };
}
/** Envia sem bloquear o pedido (erros ficam registados no outbox). */
export const mail = (ctx, to, template, vars) => { sendEmail(ctx, to, template, vars).catch((e) => ctx.log('Email', e.message)); };

// ---------- auditoria ----------
export function audit(ctx, actor, action, target, details, reason) {
  ctx.db.run('INSERT INTO audit_log (at, actor_id, actor_email, action, target_type, target_id, reason, details, ip) VALUES (?,?,?,?,?,?,?,?,?)',
    ctx.now(), actor && actor.id || null, actor && actor.email || (typeof actor === 'string' ? actor : null), action, target && target[0] || null, target && target[1] || null, reason || null, details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null, actor && actor.ip || null);
}

// ---------- permissões (aplicadas no servidor) ----------
export const ROLES = { owner: 'Administrador principal', finance: 'Financeiro', support: 'Suporte' };
const P = {
  'dashboard.view': ['owner', 'finance', 'support'],
  'customers.view': ['owner', 'finance', 'support'],
  'customers.edit': ['owner', 'support'],
  'customers.suspend': ['owner', 'support'],
  'customers.block': ['owner'],
  'orders.view': ['owner', 'finance', 'support'],
  'payments.validate': ['owner', 'finance'],
  'payments.refund': ['owner', 'finance'],
  'payments.events': ['owner', 'finance'],
  'licenses.view': ['owner', 'finance', 'support'],
  'licenses.manage': ['owner', 'support'],          // suspender/reativar, desativar computador, mudança de computador
  'licenses.revoke': ['owner'],
  'licenses.issue': ['owner'],                      // ofertas, lotes, demonstrações
  'subscriptions.manage': ['owner', 'finance'],     // prolongar, aprovar renovações, cancelar renovação
  'settings.view': ['owner', 'finance'],
  'settings.edit': ['owner'],
  'texts.edit': ['owner'],
  'texts.publish': ['owner'],
  'staff.manage': ['owner'],
  'audit.view': ['owner'],
  'emails.view': ['owner', 'support'],
};
export const can = (user, perm) => !!user && (P[perm] || []).includes(user.role);
export const permsOf = (role) => Object.keys(P).filter((k) => P[k].includes(role));
export function need(user, perm) { if (!can(user, perm)) fail(403, 'Não tens permissão para esta operação.', 'SEM_PERMISSAO'); }

// ---------- sessões ----------
export function createSession(ctx, user, req, mfaOk) {
  const token = randomToken(32), now = ctx.now();
  ctx.db.run('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, ua, mfa_ok) VALUES (?,?,?,?,?,?,?,?)', sha256(token), user.id, now, now + ctx.cfg.sessionDays * 864e5, now, req.ip, String(req.headers['user-agent'] || '').slice(0, 200), mfaOk ? 1 : 0);
  return token;
}
export function sessionCookie(ctx, token, maxAgeS) {
  return `mm_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS === undefined ? ctx.cfg.sessionDays * 86400 : maxAgeS}${ctx.cfg.test ? '' : '; Secure'}`;
}

// ---------- dinheiro ----------
export const fmtMoney = (cents, cur) => { const v = cents / 100; const s = v.toLocaleString('pt-PT', { minimumFractionDigits: cur === 'AOA' ? 0 : 2, maximumFractionDigits: cur === 'AOA' ? 0 : 2 }); return cur === 'USD' ? `US$${s}` : cur === 'EUR' ? `${s} €` : `${s} Kz`; };
/** Poupança do plano anual face a 12 mensalidades (recalculada sempre que os preços mudam). */
export function annualSaving(ctx) {
  const m = ctx.db.get("SELECT price_usd_cents p FROM plans WHERE id = 'monthly'"), a = ctx.db.get("SELECT price_usd_cents p FROM plans WHERE id = 'annual'");
  if (!m || !a) return null;
  return Math.round((1 - a.p / (12 * m.p)) * 1000) / 10;
}
/** Preço para um método/país: moeda de cobrança, câmbio aplicado e imposto. */
export function quote(ctx, plan, method, country) {
  const cur = method === 'bank_pt' ? (getSetting(ctx, 'bank_pt').currency || 'EUR') : method === 'bank_ao' ? (getSetting(ctx, 'bank_ao').currency || 'AOA') : 'USD';
  const rates = getSetting(ctx, 'currencies').rates || {};
  let fx = 1;
  if (cur !== 'USD') { fx = rates[cur] && rates[cur].rate; if (!fx || fx <= 0) fail(400, `Câmbio USD→${cur} ainda não configurado. Escolhe outro método de pagamento.`, 'CAMBIO_EM_FALTA'); }
  const round = cur === 'AOA' ? 100 : 1; // kwanzas sem cêntimos
  const base = Math.round((plan.price_usd_cents * fx) / round) * round;
  const tx = getSetting(ctx, 'taxes'), rule = (tx.rules || []).find((r) => r.country === country);
  const rate = rule ? +rule.rate : 0;
  const tax = tx.mode === 'included' ? 0 : Math.round((base * rate) / 100 / round) * round;
  return { currency: cur, fx, net_cents: base, tax_cents: tax, tax_rate: rate, tax_label: rule ? rule.label : null, tax_mode: tx.mode, total_cents: base + tax, usd_cents: plan.price_usd_cents };
}
