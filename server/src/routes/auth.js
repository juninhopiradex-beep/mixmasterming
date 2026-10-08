// Contas: registo, confirmação de email, login (com limite de tentativas e 2FA), recuperação, sessões.
import crypto from 'node:crypto';
import { fail } from '../http.js';
import { hashPassword, verifyPassword, passwordProblem, randomToken, sha256, uuid, base32, verifyTotp } from '../security.js';
import { createSession, sessionCookie, getSetting, mail, audit, permsOf, ROLES } from '../core.js';
import { requireUser, str, emailOk, countryOk, safeUser } from './util.js';

export function makeToken(ctx, userId, kind, ttlMs) {
  const t = randomToken(32), now = ctx.now();
  ctx.db.run('INSERT INTO tokens (id, user_id, kind, created_at, expires_at) VALUES (?,?,?,?,?)', sha256(t), userId, kind, now, now + ttlMs);
  return t;
}
export function useToken(ctx, token, kinds) {
  const row = ctx.db.get('SELECT * FROM tokens WHERE id = ?', sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < ctx.now() || !kinds.includes(row.kind)) fail(400, 'Ligação inválida ou expirada. Pede uma nova.', 'TOKEN_INVALIDO');
  ctx.db.run('UPDATE tokens SET used_at = ? WHERE id = ?', ctx.now(), row.id);
  return row;
}
export function sendVerification(ctx, u) { mail(ctx, u.email, 'account_confirm', { name: u.name, link: `${ctx.cfg.publicUrl}/verificar?token=${makeToken(ctx, u.id, 'verify', 48 * 3600e3)}` }); }
export function sendReset(ctx, u, kind = 'reset') {
  const ttl = kind === 'invite' ? 7 * 864e5 : 3600e3;
  mail(ctx, u.email, kind === 'invite' ? 'invite' : 'password_reset', { name: u.name, link: `${ctx.cfg.publicUrl}/redefinir?token=${makeToken(ctx, u.id, kind, ttl)}${kind === 'invite' ? '&convite=1' : ''}` });
}
/** Cria uma conta de cliente (pendente até confirmar o email). */
export function createCustomer(ctx, { name, email, password, country }) {
  name = str(name, 100); email = str(email, 254).toLowerCase(); country = str(country, 2).toUpperCase();
  if (name.length < 2) fail(400, 'Indica o teu nome.', 'NOME');
  if (!emailOk(email)) fail(400, 'Email inválido.', 'EMAIL');
  if (country && !countryOk(country)) fail(400, 'País inválido.', 'PAIS');
  if (ctx.db.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Já existe uma conta com este email. Entra na tua conta para continuar.', 'EMAIL_EXISTE');
  if (password !== undefined) { const p = passwordProblem(password, email); if (p) fail(400, p, 'PALAVRA_PASSE_FRACA'); }
  const id = uuid(), now = ctx.now();
  ctx.db.run('INSERT INTO users (id, email, name, country, password_hash, role, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', id, email, name, country || null, password !== undefined ? hashPassword(password) : null, 'customer', 'pending', now, now);
  return ctx.db.get('SELECT * FROM users WHERE id = ?', id);
}
const meOf = (ctx, req) => req.user ? { user: safeUser(req.user), mfaPending: !req.session.mfa_ok, perms: req.user.role === 'customer' ? [] : permsOf(req.user.role), roleLabel: ROLES[req.user.role] || 'Cliente', require2fa: req.user.role !== 'customer' && getSetting(ctx, 'security').require2faForStaff && !req.user.totp_enabled } : { user: null };

export default function register(r, ctx) {
  r.get('/api/auth/me', (req) => meOf(ctx, req));

  r.post('/api/auth/register', (req, res) => {
    const b = req.body;
    if (!b.acceptTerms) fail(400, 'Tens de aceitar os termos e a política de privacidade.', 'TERMOS');
    const u = createCustomer(ctx, b);
    sendVerification(ctx, u);
    res.setHeader('Set-Cookie', sessionCookie(ctx, createSession(ctx, u, req, true)));
    return { user: safeUser(u) };
  });

  r.post('/api/auth/login', (req, res) => {
    const email = str(req.body.email, 254).toLowerCase(), S = getSetting(ctx, 'security'), now = ctx.now();
    const since = now - S.lockMinutes * 60e3;
    const fails = (k) => ctx.db.get('SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ? AND ok = 0', k, since).n;
    if (fails('e:' + email) >= S.loginMaxAttempts || fails('i:' + req.ip) >= S.loginMaxAttempts * 4) fail(429, `Demasiadas tentativas. Tenta novamente dentro de ${S.lockMinutes} minutos ou recupera a palavra-passe.`, 'BLOQUEIO_TEMPORARIO');
    const u = ctx.db.get('SELECT * FROM users WHERE email = ?', email);
    const ok = u && u.password_hash && verifyPassword(String(req.body.password || ''), u.password_hash);
    const note = (good) => { ctx.db.run('INSERT INTO login_attempts VALUES (?,?,?)', 'e:' + email, now, good ? 1 : 0); ctx.db.run('INSERT INTO login_attempts VALUES (?,?,?)', 'i:' + req.ip, now, good ? 1 : 0); };
    if (!ok) { if (!u) verifyPassword('x', null); note(false); fail(401, 'Email ou palavra-passe incorretos.', 'CREDENCIAIS'); }
    if (u.status === 'blocked') { note(false); fail(403, 'Esta conta está bloqueada. Contacta o suporte.', 'CONTA_BLOQUEADA'); }
    if (u.status === 'suspended') { note(false); fail(403, 'O acesso a esta conta está suspenso. Contacta o suporte.', 'CONTA_SUSPENSA'); }
    note(true);
    const needMfa = u.role !== 'customer' && !!u.totp_enabled;
    ctx.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now, u.id);
    res.setHeader('Set-Cookie', sessionCookie(ctx, createSession(ctx, u, req, !needMfa)));
    if (u.role !== 'customer') audit(ctx, { ...u, ip: req.ip }, 'staff.login', ['user', u.id], needMfa ? 'aguarda 2FA' : null);
    return { user: safeUser(u), mfaPending: needMfa, mustChangePassword: !!u.must_change_password };
  });

  r.post('/api/auth/mfa', (req) => {
    const u = requireUser(req);
    if (!u.totp_enabled) fail(400, '2FA não está ativo.', 'MFA');
    const S = getSetting(ctx, 'security'), now = ctx.now();
    if (ctx.db.get('SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ? AND ok = 0', 'm:' + u.id, now - S.lockMinutes * 60e3).n >= S.loginMaxAttempts) fail(429, 'Demasiadas tentativas de código.', 'BLOQUEIO_TEMPORARIO');
    const ok = verifyTotp(ctx.cipher.dec(u.totp_secret), req.body.code, now);
    ctx.db.run('INSERT INTO login_attempts VALUES (?,?,?)', 'm:' + u.id, now, ok ? 1 : 0);
    if (!ok) fail(401, 'Código inválido.', 'MFA_CODIGO');
    ctx.db.run('UPDATE sessions SET mfa_ok = 1 WHERE id = ?', req.session.id);
    audit(ctx, u, 'staff.mfa_ok', ['user', u.id]);
    return { ok: true };
  });

  r.post('/api/auth/logout', (req, res) => { if (req.session) ctx.db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', ctx.now(), req.session.id); res.setHeader('Set-Cookie', sessionCookie(ctx, '', 0)); return { ok: true }; });

  r.post('/api/auth/verify', (req) => {
    const t = useToken(ctx, req.body.token, ['verify']);
    ctx.db.run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", ctx.now(), ctx.now(), t.user_id);
    return { ok: true };
  });
  r.post('/api/auth/resend-verification', (req) => { const u = requireUser(req); if (!u.email_verified_at) sendVerification(ctx, u); return { ok: true }; });

  // recuperação: a resposta é sempre igual (não revela se o email existe)
  r.post('/api/auth/forgot', (req) => {
    const email = str(req.body.email, 254).toLowerCase(), now = ctx.now();
    const recent = ctx.db.get('SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ?', 'r:' + email, now - 3600e3).n;
    ctx.db.run('INSERT INTO login_attempts VALUES (?,?,?)', 'r:' + email, now, 1);
    const u = ctx.db.get('SELECT * FROM users WHERE email = ?', email);
    if (u && u.status !== 'blocked' && recent < 5) sendReset(ctx, u, u.password_hash ? 'reset' : 'invite');
    return { ok: true, message: 'Se existir uma conta com esse email, vais receber uma ligação para definir uma nova palavra-passe.' };
  });
  r.post('/api/auth/reset', (req) => {
    const t = useToken(ctx, req.body.token, ['reset', 'invite']);
    const u = ctx.db.get('SELECT * FROM users WHERE id = ?', t.user_id);
    const p = passwordProblem(req.body.password, u.email); if (p) fail(400, p, 'PALAVRA_PASSE_FRACA');
    const now = ctx.now();
    ctx.db.run("UPDATE users SET password_hash = ?, must_change_password = 0, email_verified_at = COALESCE(email_verified_at, ?), status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", hashPassword(req.body.password), now, now, u.id);
    ctx.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, u.id); // termina todas as sessões
    audit(ctx, u, 'user.password_reset', ['user', u.id], t.kind);
    return { ok: true };
  });
  r.post('/api/auth/change-password', (req) => {
    const u = requireUser(req);
    if (!verifyPassword(String(req.body.current || ''), u.password_hash)) fail(400, 'A palavra-passe atual não está correta.', 'CREDENCIAIS');
    const p = passwordProblem(req.body.password, u.email); if (p) fail(400, p, 'PALAVRA_PASSE_FRACA');
    if (req.body.password === req.body.current) fail(400, 'A nova palavra-passe tem de ser diferente.', 'IGUAL');
    const now = ctx.now();
    ctx.db.run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', hashPassword(req.body.password), now, u.id);
    ctx.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL', now, u.id, req.session.id);
    audit(ctx, u, 'user.password_change', ['user', u.id]);
    return { ok: true };
  });

  r.get('/api/auth/sessions', (req) => {
    const u = requireUser(req);
    return ctx.db.all('SELECT id, created_at, last_seen_at, ip, ua FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC', u.id, ctx.now()).map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === req.session.id }));
  });
  r.post('/api/auth/sessions/:id/revoke', (req) => {
    const u = requireUser(req);
    ctx.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND substr(id, 1, 16) = ?', ctx.now(), u.id, req.params.id);
    return { ok: true };
  });

  // 2FA (TOTP) — para a equipa (e disponível para clientes)
  r.post('/api/auth/mfa/setup', (req) => {
    const u = requireUser(req);
    if (u.totp_enabled) fail(400, '2FA já está ativo.', 'MFA');
    const secret = base32(crypto.randomBytes(20));
    ctx.db.run('UPDATE users SET totp_secret = ? WHERE id = ?', ctx.cipher.enc(secret), u.id);
    return { secret, uri: `otpauth://totp/${encodeURIComponent('MIXMIND:' + u.email)}?secret=${secret}&issuer=MIXMIND&algorithm=SHA1&digits=6&period=30` };
  });
  r.post('/api/auth/mfa/enable', (req) => {
    const u = requireUser(req);
    if (!u.totp_secret || !verifyTotp(ctx.cipher.dec(u.totp_secret), req.body.code, ctx.now())) fail(400, 'Código inválido. Confirma a hora do telemóvel e tenta de novo.', 'MFA_CODIGO');
    ctx.db.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', u.id);
    ctx.db.run('UPDATE sessions SET mfa_ok = 1 WHERE id = ?', req.session.id);
    audit(ctx, u, 'user.mfa_enable', ['user', u.id]);
    return { ok: true };
  });
  r.post('/api/auth/mfa/disable', (req) => {
    const u = requireUser(req);
    if (!verifyPassword(String(req.body.password || ''), u.password_hash) || !verifyTotp(ctx.cipher.dec(u.totp_secret), req.body.code, ctx.now())) fail(400, 'Palavra-passe ou código inválidos.', 'MFA_CODIGO');
    if (u.role !== 'customer' && getSetting(ctx, 'security').require2faForStaff) fail(403, 'A 2FA é obrigatória para a equipa.', 'MFA_OBRIGATORIA');
    ctx.db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', u.id);
    audit(ctx, u, 'user.mfa_disable', ['user', u.id]);
    return { ok: true };
  });
}
