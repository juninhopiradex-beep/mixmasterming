// Backend para clientes contra um Supabase FALSO (tests/mock-supabase.py): portal → pendente → admin aprova →
// análise local → medidas publicadas → áudio apagado → outro utilizador recebe a biblioteca. `node tests/cloud.test.mjs`
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { test, ok, summary } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const MPORT = 18000 + Math.floor(Math.random() * 2000), MOCK = `http://127.0.0.1:${MPORT}`;
const mock = spawn('python3', [path.join(ROOT, 'tests/mock-supabase.py'), String(MPORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const state = async () => (await fetch(MOCK + '/__state', { headers: { apikey: 'anon-key', Authorization: 'Bearer anon-key' } })).json();

// WAV de teste: 12 s estéreo (acordes + ruído rosado aproximado), 44,1 kHz 16-bit
const wav = (() => {
  const sr = 44100, n = sr * 12, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  let s = 3, pk = 0; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) { pk = 0.97 * pk + 0.03 * rnd(); const t = i / sr, beat = (t * 2) % 1 < 0.08 ? Math.sin(2 * Math.PI * 55 * t) * 0.6 : 0; const v = 0.25 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) / 3 + beat + 0.4 * pk; const l = Math.max(-1, Math.min(1, v)), r = Math.max(-1, Math.min(1, v * 0.9 + 0.05 * rnd())); b.writeInt16LE(Math.round(l * 30000), 44 + i * 4); b.writeInt16LE(Math.round(r * 30000), 46 + i * 4); }
  const f = path.join(os.tmpdir(), 'Cliente Kizomba Teste.wav'); fs.writeFileSync(f, b); return f;
})();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const cfg = JSON.stringify({ SUPABASE_URL: MOCK, SUPABASE_ANON_KEY: 'anon-key', BUCKET: 'submissions' });
const ctxA = await browser.newContext(); await ctxA.addInitScript((c) => localStorage.setItem('mixmind-cloud', c), cfg);
const page = await ctxA.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));

console.log('Backend para clientes (Supabase falso)');
await test('portal: cliente envia um master com consentimento → fica pendente; o anon não consegue ler', async () => {
  await page.goto(base + '/portal.html');
  await page.waitForSelector('#f', { state: 'visible' });
  await page.fill('#nm', 'Cliente Teste'); await page.fill('#em', 'cliente@exemplo.com');
  await page.selectOption('#sty', 'Kizomba');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pick')]); await fc.setFiles(wav);
  await page.check('#rights'); await page.click('#go');
  await page.waitForFunction(() => /Recebido/.test(document.querySelector('#msg').textContent), null, { timeout: 30000 });
  const s = await state();
  ok(s.db.submissions.length === 1 && s.db.submissions[0].status === 'pending', 'submissão pendente');
  ok(s.files.length === 1 && s.files[0].startsWith('incoming/'), 'áudio em incoming/');
  const anon = await (await fetch(MOCK + '/rest/v1/submissions?select=*', { headers: { apikey: 'anon-key', Authorization: 'Bearer anon-key' } })).json();
  ok(Array.isArray(anon) && anon.length === 0, 'anon não lê submissões');
});
await test('admin: entra, aprova → análise local, medidas publicadas, áudio apagado, estado aprovado', async () => {
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.MM && MM.styles && MM.styles.loaded, null, { timeout: 60000 });
  const r = await page.evaluate(async () => {
    const C = MM.cloud; await C.login('admin@piradex.test', 'pw');
    const subs = await C.listSubmissions('pending');
    await MM.app.ensureAudio();
    const out = await C.approve(subs[0], MM.styles.byName('Kizomba').id, MM.app.engine.ctx);
    return { n: subs.length, pub: out.length, lufs: out[0].features && out[0].features.lufs };
  });
  ok(r.n === 1 && r.pub === 1 && isFinite(r.lufs), 'aprovado e medido: ' + JSON.stringify(r));
  const s = await state();
  ok(s.db.library_tracks.length === 1 && s.db.library_tracks[0].style === 'Kizomba' && s.db.library_tracks[0].features, 'medidas publicadas');
  ok(s.files.length === 0, 'áudio apagado do servidor');
  ok(s.db.submissions[0].status === 'approved', 'estado aprovado');
});
await test('outro utilizador (browser limpo) recebe a biblioteca partilhada ao abrir a app', async () => {
  const ctxB = await browser.newContext(); await ctxB.addInitScript((c) => localStorage.setItem('mixmind-cloud', c), cfg);
  const p2 = await ctxB.newPage();
  await p2.goto(base + '/index.html');
  await p2.waitForFunction(() => MM.cloud.libraryRows === 1, null, { timeout: 60000 });
  const r = await p2.evaluate(() => { const st = MM.styles.byName('Kizomba'); const t = MM.styles.tracksOf(st.id); return { n: t.length, shipped: t.every((x) => x.shipped), prof: !!MM.styles.profile('Kizomba') }; });
  ok(r.n === 1 && r.shipped && r.prof, JSON.stringify(r));
  await ctxB.close();
});
await test('sem chaves: a app funciona só local e o portal diz que não está configurado', async () => {
  const ctxC = await browser.newContext(); const p3 = await ctxC.newPage();
  await p3.goto(base + '/portal.html'); await p3.waitForSelector('#off', { state: 'visible' });
  await p3.goto(base + '/index.html'); await p3.waitForFunction(() => MM.styles && MM.styles.loaded, null, { timeout: 60000 });
  ok(!(await p3.evaluate(() => MM.cloud.on())), 'nuvem desligada');
  await ctxC.close();
  ok(!errors.length, errors.join(' | '));
});
summary();
await browser.close(); server.close(); mock.kill();
