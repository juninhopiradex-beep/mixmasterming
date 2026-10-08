// Licença na aplicação (Chromium + loja real): demonstração, ativação, verificação ECDSA no navegador,
// vínculo ao computador, adulteração, revogação remota e corte do export na demonstração.
// `node tests/license.test.mjs`
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { test, ok, summary } from './load.mjs';
import { startAll } from '../server/test/harness.mjs';
import { issueLicense, signingKeys, setLicenseStatus } from '../server/src/licensing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const app = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const appOrigin = `http://localhost:${app.address().port}`;
const S = await startAll({ CORS_ORIGINS: appOrigin });
const spki = signingKeys(S.ctx).spki;
const lic1 = issueLicense(S.ctx, { type: 'perpetual', major: 1, actor: 'teste' }).license;
const lic2 = issueLicense(S.ctx, { type: 'gift', major: 1, actor: 'teste' }).license;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
async function newPage(storage, offline) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  if (offline) await ctx.route(S.base + '/**', (r) => r.abort());
  await ctx.route('**/config.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.MIXMIND_CONFIG = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', BUCKET: 'submissions', LICENSE_API: ${JSON.stringify(S.base)}, LICENSE_PUBLIC_KEY: ${JSON.stringify(spki)} };` }));
  if (storage) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(appOrigin + '/index.html');
  await page.waitForFunction(() => window.MM && MM.license && MM.license.status.mode !== 'checking');
  page.errors = errors;
  return page;
}
const J = (p, fn, arg) => p.evaluate(fn, arg);

console.log('Licença na aplicação');
const page = await newPage();
await test('sem licença: modo de demonstração, pílula DEMO e formatos sem perdas bloqueados', async () => {
  const r = await J(page, () => ({ demo: MM.license.isDemo(), wav: MM.license.formatAllowed('wav'), mp3: MM.license.formatAllowed('mp3'), pill: !!document.querySelector('.lic-pill.demo') }));
  ok(r.demo && !r.wav && r.mp3 && r.pill, JSON.stringify(r));
});
await test('demonstração: export WAV recusado e MP3 cortado a 60 s com fade', async () => {
  const r = await J(page, async () => {
    const sr = 8000, n = sr * 90, ch = new Float32Array(n).fill(0.5);
    const buf = MM.toAudioBuffer([ch, ch], sr);
    let wavErr = null; try { await MM.exporter.encode(buf, 'wav', 24); } catch (e) { wavErr = e.message; }
    const t = MM.license.trim(buf);
    return { wavErr, len: t.length / sr, last: t.getChannelData(0)[t.length - 1], mid: t.getChannelData(0)[sr * 30] };
  });
  ok(/Demonstração/.test(r.wavErr || ''), 'wav ' + r.wavErr); ok(Math.abs(r.len - 60) < 0.01, 'dur ' + r.len); ok(r.last < 0.01 && r.mid === 0.5, 'fade');
});
await test('ativação: comprovativo verificado no navegador (ECDSA P-256), ligado a este computador', async () => {
  const r = await J(page, async (key) => { const s = await MM.license.activate(key.toLowerCase().replace(/-/g, ' ')); return { mode: s.mode, typ: s.payload.typ, mb: !!s.payload.mb, demo: MM.license.isDemo(), wav: MM.license.formatAllowed('wav'), pill: !!document.querySelector('.lic-pill.demo') }; }, lic1.key);
  ok(r.mode === 'licensed' && r.typ === 'perpetual' && r.mb && !r.demo && r.wav && !r.pill, JSON.stringify(r));
});
const stored = await J(page, () => ({ lic: localStorage.getItem('mm.license.v1'), mid: localStorage.getItem('mm.machine.v1') }));
await test('perpétua continua ativa depois de recarregar, mesmo sem servidor (offline)', async () => {
  const p = await newPage({ 'mm.license.v1': stored.lic, 'mm.machine.v1': stored.mid }, true);
  const r = await J(p, async () => { await MM.license.check(true); return MM.license.status.mode; });
  ok(r === 'licensed', r); await p.context().close();
});
await test('comprovativo copiado para outro computador é recusado', async () => {
  const p = await newPage({ 'mm.license.v1': stored.lic, 'mm.machine.v1': JSON.stringify('web-outro-computador-0000000000') }, true);
  const r = await J(p, () => MM.license.status); ok(r.mode === 'invalid' && r.why === 'outro computador', JSON.stringify(r)); await p.context().close();
});
await test('comprovativo adulterado (payload alterado) é recusado', async () => {
  const s = JSON.parse(stored.lic), [a, b, c] = s.token.split('.');
  const pl = JSON.parse(Buffer.from(b, 'base64url').toString()); pl.typ = 'perpetual'; pl.exp = null; pl.maj = 9;
  s.token = [a, Buffer.from(JSON.stringify(pl)).toString('base64url'), c].join('.');
  const p = await newPage({ 'mm.license.v1': JSON.stringify(s), 'mm.machine.v1': stored.mid }, true);
  const r = await J(p, () => MM.license.status); ok(r.mode === 'invalid' && /assinatura/.test(r.why), JSON.stringify(r)); await p.context().close();
});
await test('segundo computador: ativação recusada (uma máquina ativa por licença)', async () => {
  const p = await newPage({ 'mm.machine.v1': JSON.stringify('web-segundo-computador-000000000') });
  const r = await J(p, async (key) => { try { await MM.license.activate(key); return 'ativou'; } catch (e) { return e.code + ' ' + e.message; } }, lic1.key);
  ok(/OUTRA_MAQUINA/.test(r), r); await p.context().close();
});
await test('desativar na app liberta a licença para outro computador', async () => {
  await J(page, () => MM.license.deactivate());
  const p = await newPage({ 'mm.machine.v1': JSON.stringify('web-segundo-computador-000000000') });
  const r = await J(p, async (key) => (await MM.license.activate(key)).mode, lic1.key);
  ok(r === 'licensed' && (await J(page, () => MM.license.isDemo())), r); await p.context().close();
});
await test('revogação no servidor: a app volta à demonstração na verificação seguinte', async () => {
  const r0 = await J(page, async (key) => (await MM.license.activate(key)).mode, lic2.key);
  setLicenseStatus(S.ctx, S.ctx.db.get('SELECT * FROM licenses WHERE id = ?', lic2.id), 'revoked', { email: 'teste@loja.test' }, 'teste de revogação');
  const r = await J(page, async () => { await MM.license.check(true); return { mode: MM.license.status.mode, code: MM.license.status.blocked && MM.license.status.blocked.code }; });
  ok(r0 === 'licensed' && r.mode === 'demo' && r.code === 'REVOGADA', JSON.stringify(r));
});
await test('Definições → Licença mostra o formulário de ativação e as regras da demonstração', async () => {
  await J(page, () => { MM.app.setSec = 'license'; MM.app.go('settings'); });
  const t = await J(page, () => document.querySelector('.workspace').innerText);
  ok(/Ativa a tua licença/.test(t) && /60 s em MP3/.test(t) && /revogada/i.test(t), t.slice(0, 300));
});
await test('sem erros de JavaScript', async () => ok(!page.errors.length, page.errors.join('\n')));
await browser.close(); app.close(); S.close();
summary();
