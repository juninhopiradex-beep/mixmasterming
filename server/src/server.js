// Servidor HTTP: loja pública, área do cliente, painel de administração e API de licenças.
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { ROOT } from './config.js';
import { router, readBody, parseCookies, send, serveStatic, HttpError, fail } from './http.js';
import { sha256 } from './security.js';
import { runJobs } from './jobs.js';
import { getSetting } from './core.js';
import registerAuth from './routes/auth.js';
import registerPublic from './routes/public.js';
import registerAccount from './routes/account.js';
import registerAdmin from './routes/admin.js';
import registerLicense from './routes/license.js';

export function createServer(ctx) {
  const r = router();
  // credenciais dos prestadores guardadas (cifradas) no painel; as variáveis de ambiente têm prioridade
  ctx.creds = (p) => { const c = getSetting(ctx, 'credentials') || {}, x = c[p] || {}; const out = {}; for (const [k, v] of Object.entries(x)) { try { out[k] = ctx.cipher.dec(v); } catch { out[k] = ''; } } return out; };
  registerAuth(r, ctx); registerPublic(r, ctx); registerAccount(r, ctx); registerAdmin(r, ctx); registerLicense(r, ctx);
  const publicDir = path.join(ROOT, 'public');
  const licOrigins = () => new Set([...ctx.cfg.corsOrigins, (() => { try { return new URL(ctx.cfg.appUrl).origin; } catch { return null; } })()].filter(Boolean));
  const rate = new Map(); // limite simples por IP para a API de licenças (60 pedidos / min)

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    req.ip = (ctx.cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    req.query = Object.fromEntries(url.searchParams);
    req.ctx = ctx;
    const isApi = url.pathname.startsWith('/api/');
    try {
      // CORS apenas para a API de licenças (chamada pela app noutro domínio, sem cookies)
      if (url.pathname.startsWith('/api/v1/')) {
        const o = req.headers.origin;
        if (o && licOrigins().has(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); }
        if (req.method === 'OPTIONS') return send(res, 204, '');
        const k = req.ip + ':' + Math.floor(Date.now() / 60000), n = (rate.get(k) || 0) + 1; rate.set(k, n);
        if (rate.size > 5000) rate.clear();
        if (n > 60) fail(429, 'Demasiados pedidos. Tenta dentro de um minuto.', 'LIMITE');
      }
      if (!isApi) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Método não permitido.');
        if (url.pathname === '/teste-pagamento' && !ctx.cfg.test) fail(404, 'Não encontrado.');
        if (serveStatic(publicDir, url.pathname, res)) return;
        return serveStatic(publicDir, '/404', res, 404) || send(res, 404, 'Não encontrado');
      }
      const m = r.match(req.method, url.pathname);
      if (!m) fail(404, 'Endpoint inexistente.', 'NAO_EXISTE');
      req.params = m.params;
      // sessão (cookie HttpOnly; o token só é guardado em hash)
      const tok = parseCookies(req.headers.cookie).mm_s;
      if (tok) {
        const s = ctx.db.get('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?', sha256(tok), Date.now());
        if (s) {
          const u = ctx.db.get('SELECT * FROM users WHERE id = ?', s.user_id);
          if (u && u.status !== 'blocked' && u.status !== 'suspended') { req.session = s; req.user = { ...u, ip: req.ip }; if (Date.now() - s.last_seen_at > 60000) ctx.db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', Date.now(), s.id); }
        }
      }
      // proteção CSRF: pedidos que alteram estado com cookie exigem cabeçalho próprio + mesma origem
      const webhook = url.pathname.startsWith('/api/webhooks/') || url.pathname.startsWith('/api/v1/');
      if (!['GET', 'HEAD'].includes(req.method) && !webhook) {
        if (req.headers['x-mm'] !== '1') fail(403, 'Pedido recusado (CSRF).', 'CSRF');
        const o = req.headers.origin; if (o && o !== ctx.cfg.publicUrl && !ctx.cfg.test) fail(403, 'Origem não permitida.', 'CSRF');
      }
      // corpo
      const raw = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req, url.pathname.includes('/proofs') ? 11 * 1024 * 1024 : 1024 * 1024) : Buffer.alloc(0);
      req.raw = raw;
      if (raw.length && String(req.headers['content-type'] || '').includes('application/json')) { try { req.body = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'JSON inválido.', 'JSON'); } }
      else req.body = {};
      let out;
      for (const h of m.handlers) { out = await h(req, res, ctx); if (res.headersSent) return; }
      if (out && out.__redirect) return send(res, 302, '', { Location: out.__redirect });
      return send(res, 200, out === undefined ? { ok: true } : out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, isApi ? { error: e.message, code: e.code, ...(e.extra || {}) } : e.message);
      ctx.log('ERRO', req.method, url.pathname, e.stack || e.message);
      return send(res, 500, isApi ? { error: 'Erro interno. Tenta novamente.', code: 'INTERNO' } : 'Erro interno');
    }
  });
  // tarefas periódicas (a cada 15 min) e no arranque
  const tick = () => { try { const r2 = runJobs(ctx); if (r2.expired || r2.reminders || r2.ordersExpired) ctx.log('Tarefas:', JSON.stringify(r2)); } catch (e) { ctx.log('Tarefas falharam', e.message); } };
  tick();
  const timer = setInterval(tick, 15 * 60e3); timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}
