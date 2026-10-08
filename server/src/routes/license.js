// API de licenças para a aplicação (desktop / app instalada): ativar, validar, desativar, chave pública.
import { activate, validate, deactivate, signingKeys, normKey, licenseUsable } from '../licensing.js';
import { getSetting } from '../core.js';
import { fail } from '../http.js';
import { str } from './util.js';

export default function register(r, ctx) {
  r.get('/api/v1/licenses/public-key', () => { const K = signingKeys(ctx); return { alg: 'ES256', curve: 'P-256', format: 'MMX1.<payload base64url>.<assinatura IEEE-P1363 base64url>', kid: K.kid, spki: K.spki, jwk: K.jwk }; });
  r.get('/api/v1/app/config', () => {
    const v = ctx.db.get('SELECT version, url_web, url_windows, url_macos FROM versions WHERE is_current = 1');
    return { demo: getSetting(ctx, 'demo'), latest: v, store: ctx.cfg.publicUrl, checkDays: getSetting(ctx, 'licensing').checkDays };
  });
  r.post('/api/v1/licenses/activate', (req) => {
    const b = req.body;
    return activate(ctx, { key: str(b.key, 40), machineId: str(b.machineId, 200), name: str(b.machineName, 80), platform: str(b.platform, 40), appVersion: str(b.appVersion, 20) }, req.ip);
  });
  r.post('/api/v1/licenses/validate', (req) => validate(ctx, { key: str(req.body.key, 40), machineId: str(req.body.machineId, 200), appVersion: str(req.body.appVersion, 20) }));
  r.post('/api/v1/licenses/deactivate', (req) => {
    const lic = ctx.db.get('SELECT * FROM licenses WHERE key = ?', normKey(str(req.body.key, 40)));
    if (!lic) fail(404, 'Chave de licença inválida.', 'NAO_EXISTE');
    void licenseUsable;
    return deactivate(ctx, lic, 'app', 'Desativado na aplicação', str(req.body.machineId, 200));
  });
}
