// Utilitários das rotas: guardas de acesso, validação de campos, projeções seguras (nunca expõem hashes nem segredos).
import { fail } from '../http.js';
import { can, need, getSetting } from '../core.js';

export function requireUser(req) { if (!req.user) fail(401, 'Inicia sessão para continuar.', 'SEM_SESSAO'); return req.user; }
export function requireStaff(req, perm) {
  const u = requireUser(req);
  if (u.role === 'customer') fail(403, 'Acesso reservado à equipa.', 'SEM_PERMISSAO');
  if (!req.session.mfa_ok) fail(401, 'Falta o código de dois fatores.', 'MFA_PENDENTE');
  if (u.must_change_password) fail(403, 'Tens de alterar a palavra-passe inicial antes de continuar.', 'TROCA_PALAVRA_PASSE');
  if (!u.totp_enabled && req.ctx && getSetting(req.ctx, 'security').require2faForStaff) fail(403, 'Ativa a autenticação de dois fatores para continuar.', 'MFA_OBRIGATORIA');
  if (perm) need(u, perm);
  return u;
}
export const str = (v, max = 200) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
export const emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e || '');
export const countryOk = (c) => /^[A-Z]{2}$/.test(c || '');
/** Utilizador sem campos sensíveis. */
export const safeUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, country: u.country, role: u.role, status: u.status, status_reason: u.status_reason, email_verified: !!u.email_verified_at, must_change_password: !!u.must_change_password, totp_enabled: !!u.totp_enabled, billing_name: u.billing_name, billing_address: u.billing_address, tax_id: u.tax_id, created_at: u.created_at, last_login_at: u.last_login_at, invited: !u.password_hash });
export { can };
