// Primitivas de segurança: hashes de palavra-passe (scrypt), tokens, cifra de segredos (AES-256-GCM), TOTP.
import crypto from 'node:crypto';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw).normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) { crypto.scryptSync('x', 'y', 32, SCRYPT); return false; } // tempo constante aproximado
  const [, N, r, p, salt, hash] = stored.split('$');
  const h = crypto.scryptSync(String(pw).normalize('NFKC'), Buffer.from(salt, 'base64'), 32, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  const ref = Buffer.from(hash, 'base64');
  return ref.length === h.length && crypto.timingSafeEqual(ref, h);
}
/** Política de palavra-passe: 10+ caracteres, não trivial. */
export function passwordProblem(pw, email) {
  pw = String(pw || '');
  if (pw.length < 10) return 'A palavra-passe tem de ter pelo menos 10 caracteres.';
  if (pw.length > 200) return 'A palavra-passe é demasiado longa.';
  if (email && pw.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length > 3) return 'A palavra-passe não pode conter o teu email.';
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|palavrapasse)/i.test(pw)) return 'Escolhe uma palavra-passe menos previsível.';
  return null;
}
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const uuid = () => crypto.randomUUID();
export const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
export function safeEqual(a, b) { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); }

// Cifra de segredos guardados na base de dados (credenciais dos prestadores, segredo TOTP)
export function makeCipher(secretKey) {
  const key = crypto.createHash('sha256').update('mixmind-secrets:' + secretKey).digest();
  return {
    enc(plain) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]); return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`; },
    dec(s) { if (!s) return ''; const [, iv, tag, ct] = s.split(':'); const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64')); return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8'); },
  };
}

// TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) — compatível com Google Authenticator, 1Password, Authy…
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(v << (5 - bits)) & 31]; return out; }
export function unbase32(s) { const clean = s.replace(/=+$/, '').toUpperCase().replace(/\s/g, ''); let bits = 0, v = 0; const out = []; for (const ch of clean) { const i = B32.indexOf(ch); if (i < 0) continue; v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export function totp(secretB32, t = Date.now(), step = 30) {
  const ctr = Math.floor(t / 1000 / step), b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(ctr));
  const h = crypto.createHmac('sha1', unbase32(secretB32)).update(b).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
export function verifyTotp(secretB32, code, t = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totp(secretB32, t + w * 30000), code));
}
