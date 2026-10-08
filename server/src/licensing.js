// Serviço de licenciamento: chaves, emissão, ativação (uma máquina por licença), comprovativos assinados (ECDSA P-256).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { uuid, sha256 } from './security.js';
import { getSetting, mail, audit } from './core.js';
import { fail } from './http.js';

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // sem I, L, O, U (evita confusões ao ditar a chave)
/** Chave imprevisível: 100 bits aleatórios → MMX1-XXXXX-XXXXX-XXXXX-XXXXX */
export function newKey() {
  const b = crypto.randomBytes(13); let v = 0n, out = '';
  for (const x of b) v = (v << 8n) | BigInt(x);
  for (let i = 0; i < 20; i++) out += CROCK[Number((v >> BigInt(5 * i)) & 31n)];
  return 'MMX1-' + out.match(/.{5}/g).join('-');
}
export const normKey = (k) => String(k || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/^MMX1/, 'MMX1').replace(/^(MMX1)(.{5})(.{5})(.{5})(.{5})$/, '$1-$2-$3-$4-$5');

// ---------- chaves de assinatura ----------
export function signingKeys(ctx) {
  if (ctx._keys) return ctx._keys;
  const file = ctx.cfg.licenseKeyFile || path.join(ctx.cfg.dataDir, 'keys', 'license-private.pem');
  let pem;
  if (fs.existsSync(file)) pem = fs.readFileSync(file, 'utf8');
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(file, pem, { mode: 0o600 });
    ctx.log('Par de chaves de licenças criado em', file, '(guarda uma cópia de segurança; nunca a publiques)');
  }
  const priv = crypto.createPrivateKey(pem), pub = crypto.createPublicKey(priv);
  const spki = pub.export({ type: 'spki', format: 'der' }).toString('base64');
  ctx._keys = { priv, pub, spki, jwk: pub.export({ format: 'jwk' }), kid: sha256(spki).slice(0, 16) };
  return ctx._keys;
}
const b64u = (b) => Buffer.from(b).toString('base64url');
export function signToken(ctx, payload) {
  const K = signingKeys(ctx), body = 'MMX1.' + b64u(JSON.stringify({ ...payload, kid: K.kid }));
  const sig = crypto.sign('sha256', Buffer.from(body), { key: K.priv, dsaEncoding: 'ieee-p1363' });
  return body + '.' + b64u(sig);
}
/** Verificação (a mesma lógica que a app faz com a chave pública). */
export function verifyToken(token, publicKey, now = Date.now()) {
  const p = String(token || '').split('.');
  if (p.length !== 3 || p[0] !== 'MMX1') return { ok: false, why: 'formato' };
  const ok = crypto.verify('sha256', Buffer.from(p[0] + '.' + p[1]), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(p[2], 'base64url'));
  if (!ok) return { ok: false, why: 'assinatura' };
  const pl = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8'));
  if (pl.exp && now > pl.exp) return { ok: false, why: 'expirado', payload: pl };
  return { ok: true, payload: pl };
}

// ---------- histórico ----------
export const licEvent = (ctx, licId, actor, action, details) => ctx.db.run('INSERT INTO license_events (license_id, at, actor, action, details) VALUES (?,?,?,?,?)', licId, ctx.now(), typeof actor === 'string' ? actor : (actor && actor.email) || 'sistema', action, details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null);

/** Emite uma licença. Idempotente por encomenda/subscrição (índices únicos na base de dados). */
export function issueLicense(ctx, o) {
  const db = ctx.db;
  if (o.orderId) { const ex = db.get('SELECT * FROM licenses WHERE order_id = ?', o.orderId); if (ex) return { license: ex, created: false }; }
  if (o.subscriptionId) { const ex = db.get('SELECT * FROM licenses WHERE subscription_id = ?', o.subscriptionId); if (ex) return { license: ex, created: false }; }
  const id = uuid(), now = ctx.now();
  let key; do { key = newKey(); } while (db.get('SELECT 1 FROM licenses WHERE key = ?', key));
  db.run('INSERT INTO licenses (id, key, user_id, product_id, type, order_id, subscription_id, major, issued_at, expires_at, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, key, o.userId || null, 'mixmind', o.type, o.orderId || null, o.subscriptionId || null, o.major || 1, now, o.expiresAt || null, 'active', o.note || null, o.actor || 'sistema');
  licEvent(ctx, id, o.actor || 'sistema', 'issued', { type: o.type, order: o.orderId || null, expires: o.expiresAt || null, note: o.note || null });
  return { license: db.get('SELECT * FROM licenses WHERE id = ?', id), created: true };
}

/** A licença dá direito a usar a app agora? (estado + validade + tolerância) */
export function licenseUsable(ctx, lic, now = ctx.now()) {
  if (!lic) return { ok: false, code: 'NAO_EXISTE', msg: 'Chave de licença inválida.' };
  if (lic.status === 'revoked') return { ok: false, code: 'REVOGADA', msg: 'Esta licença foi revogada.' };
  if (lic.status === 'suspended') return { ok: false, code: 'SUSPENSA', msg: 'Esta licença está suspensa. Contacta o suporte.' };
  if (lic.user_id) { const u = ctx.db.get('SELECT status FROM users WHERE id = ?', lic.user_id); if (u && u.status === 'blocked') return { ok: false, code: 'CONTA_BLOQUEADA', msg: 'A conta associada a esta licença está bloqueada.' }; }
  const grace = (getSetting(ctx, 'licensing').graceDays || 0) * 864e5;
  if (lic.expires_at && now > lic.expires_at + grace) return { ok: false, code: 'EXPIRADA', msg: 'O período desta licença terminou. Renova a subscrição para continuares.' };
  if (lic.status === 'expired' && !(lic.expires_at && now <= lic.expires_at + grace)) return { ok: false, code: 'EXPIRADA', msg: 'O período desta licença terminou.' };
  return { ok: true };
}
const machineHash = (ctx, mid) => sha256('machine:' + ctx.cfg.secretKey + ':' + String(mid));
function tokenFor(ctx, lic, dev, machineId) {
  const L = getSetting(ctx, 'licensing'), now = ctx.now();
  return signToken(ctx, {
    v: 1, lic: lic.id, key4: lic.key.slice(-4), typ: lic.type, prod: lic.product_id, maj: lic.major, mid: dev.machine_hash.slice(0, 32),
    // vínculo verificável pela app sem segredos: sha256('mmx-bind:' + identificador do computador)
    mb: machineId ? sha256('mmx-bind:' + String(machineId)).slice(0, 32) : undefined,
    iat: now, chk: now + (L.checkDays || 7) * 864e5,
    // perpétuas: sem expiração (funcionam offline); subscrições/demonstrações: até ao fim do período pago + tolerância
    exp: lic.expires_at ? lic.expires_at + (L.graceDays || 0) * 864e5 : null,
    until: lic.expires_at || null,
  });
}

/** Ativação a partir da app. Uma máquina ativa por licença; reinstalar no mesmo computador não gasta ativação. */
export function activate(ctx, { key, machineId, name, platform, appVersion }, ip) {
  if (!machineId || String(machineId).length < 8 || String(machineId).length > 200) fail(400, 'Identificador do computador inválido.', 'MAQUINA_INVALIDA');
  const db = ctx.db, k = normKey(key);
  return db.tx(() => {
    const lic = db.get('SELECT * FROM licenses WHERE key = ?', k);
    const u = licenseUsable(ctx, lic);
    if (!u.ok) fail(lic ? 403 : 404, u.msg, u.code);
    const mh = machineHash(ctx, machineId), now = ctx.now();
    const active = db.get('SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL', lic.id);
    if (active && active.machine_hash === mh) {
      db.run('UPDATE devices SET last_seen_at = ?, app_version = ?, name = COALESCE(?, name), platform = COALESCE(?, platform) WHERE id = ?', now, appVersion || active.app_version, name || null, platform || null, active.id);
      licEvent(ctx, lic.id, 'app', 'reactivated_same_machine', { device: active.name, ip });
      return { token: tokenFor(ctx, lic, active, machineId), license: publicLicense(lic), device: { name: active.name, platform: active.platform }, reused: true };
    }
    if (active) fail(409, `Esta licença já está ativa noutro computador (${active.name || 'sem nome'}). Desativa-o na app ou na área de cliente para mudares de computador.`, 'OUTRA_MAQUINA', { device: active.name, since: active.activated_at });
    // limite de mudanças de computador (prevenção de abuso)
    const L = getSetting(ctx, 'licensing');
    const recent = db.get('SELECT COUNT(*) n FROM devices WHERE license_id = ? AND activated_at > ?', lic.id, Math.max(now - (L.transferWindowDays || 30) * 864e5, lic.transfer_reset_at || 0)).n;
    const used = db.get('SELECT COUNT(*) n FROM devices WHERE license_id = ?', lic.id).n;
    if (used > 0 && recent >= (L.transferLimit || 3)) fail(429, `Atingiste o limite de ${L.transferLimit} mudanças de computador em ${L.transferWindowDays} dias. Contacta o suporte para uma recuperação administrativa.`, 'LIMITE_MUDANCAS');
    const dev = { id: uuid(), license_id: lic.id, machine_hash: mh, name: String(name || 'Computador').slice(0, 80), platform: String(platform || '').slice(0, 40), app_version: String(appVersion || '').slice(0, 20) };
    db.run('INSERT INTO devices (id, license_id, machine_hash, name, platform, app_version, activated_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?)', dev.id, lic.id, mh, dev.name, dev.platform, dev.app_version, now, now);
    licEvent(ctx, lic.id, 'app', 'activated', { device: dev.name, platform: dev.platform, ip });
    if (lic.user_id) { const usr = db.get('SELECT * FROM users WHERE id = ?', lic.user_id); if (usr) mail(ctx, usr.email, 'device_changed', { name: usr.name, key4: lic.key.slice(-4), what: 'ativada num computador', device: dev.name, date: new Date(now).toLocaleString('pt-PT') }); }
    return { token: tokenFor(ctx, lic, dev, machineId), license: publicLicense(lic), device: { name: dev.name, platform: dev.platform }, reused: false };
  });
}
/** Validação periódica (quando há internet): devolve um comprovativo novo ou o motivo para parar. */
export function validate(ctx, { key, machineId, appVersion }) {
  const db = ctx.db, lic = db.get('SELECT * FROM licenses WHERE key = ?', normKey(key));
  const u = licenseUsable(ctx, lic);
  if (!u.ok) return { ok: false, code: u.code, message: u.msg };
  const dev = db.get('SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL AND machine_hash = ?', lic.id, machineHash(ctx, machineId));
  if (!dev) return { ok: false, code: 'DESATIVADA', message: 'Este computador já não está autorizado para esta licença.' };
  db.run('UPDATE devices SET last_seen_at = ?, app_version = COALESCE(?, app_version) WHERE id = ?', ctx.now(), appVersion || null, dev.id);
  return { ok: true, token: tokenFor(ctx, lic, dev, machineId), license: publicLicense(lic) };
}
/** Desativação: pela app (chave + máquina), pelo cliente ou pelo suporte. */
export function deactivate(ctx, lic, by, reason, onlyMachine) {
  const db = ctx.db, dev = db.get('SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL', lic.id);
  if (!dev) return { ok: true, already: true };
  if (onlyMachine && dev.machine_hash !== machineHash(ctx, onlyMachine)) fail(403, 'Este computador não é o que está ativo nesta licença.', 'OUTRA_MAQUINA');
  db.run('UPDATE devices SET deactivated_at = ?, deactivated_by = ?, deactivation_reason = ? WHERE id = ?', ctx.now(), typeof by === 'string' ? by : by.email, reason || null, dev.id);
  licEvent(ctx, lic.id, by, 'deactivated', { device: dev.name, reason: reason || null });
  if (lic.user_id) { const usr = db.get('SELECT * FROM users WHERE id = ?', lic.user_id); if (usr) mail(ctx, usr.email, 'device_changed', { name: usr.name, key4: lic.key.slice(-4), what: 'desativada no computador', device: dev.name, date: new Date().toLocaleString('pt-PT') }); }
  return { ok: true, device: dev.name };
}
export const publicLicense = (l) => ({ type: l.type, status: l.status, major: l.major, expires_at: l.expires_at, key4: l.key.slice(-4) });

/** Mudança de estado administrativa (suspender / revogar / reativar), com motivo obrigatório. */
export function setLicenseStatus(ctx, lic, status, actor, reason) {
  if (!reason || String(reason).trim().length < 3) fail(400, 'Indica o motivo.', 'MOTIVO_OBRIGATORIO');
  if (lic.status === 'revoked' && status !== 'revoked' && actor.role !== 'owner') fail(403, 'Só o administrador principal reativa licenças revogadas.', 'SEM_PERMISSAO');
  ctx.db.run('UPDATE licenses SET status = ?, status_reason = ? WHERE id = ?', status, reason, lic.id);
  licEvent(ctx, lic.id, actor, 'status_' + status, reason);
  audit(ctx, actor, 'license.' + status, ['license', lic.id], { key4: lic.key.slice(-4) }, reason);
}
