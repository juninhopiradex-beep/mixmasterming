// Teste de ponta a ponta no Chromium (Playwright): sessão demo → AI Mix & Master → verificações de áudio e de interface.
// `npm test` (ou `node tests/e2e.test.mjs`). No GitHub Actions corre a cada push.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { test, near, ok, summary } from './load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
}).listen(0);
const url = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'], executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const J = (fn, arg) => page.evaluate(fn, arg);

console.log('E2E · sessão demo');
await page.goto(url);
await test('a app arranca com o nome e a versão', async () => {
  const brand = await J(() => document.querySelector('.brand').innerText);
  ok(/MIXMIND/.test(brand) && /by Piradex/.test(brand), brand);
});
await page.click('#demo');
await page.waitForFunction(() => MM.app.state.stage === 'review', null, { timeout: 300000 });
await test('análise: 15 stems classificados, BPM e secções detetados', async () => {
  const r = await J(() => ({ n: MM.app.state.stems.length, bpm: MM.app.state.music.bpm, secs: MM.app.state.music.sections.length, roles: new Set(MM.app.state.stems.map((s) => s.role)).size }));
  ok(r.n === 15, 'stems ' + r.n); near(r.bpm, 94, 2, 'BPM'); ok(r.secs >= 6, 'secções ' + r.secs); ok(r.roles >= 10, 'papéis ' + r.roles);
});
await page.click('.topbar [data-act=ai]');
await page.waitForFunction(() => MM.app.state.stage === 'ready' && !MM.app.busy, null, { timeout: 900000 });
await test('master: loudness no alvo (±0,5 LU) e true peak ≤ ceiling', async () => {
  const m = await J(() => ({ lufs: MM.app.state.metrics.master.lufs, tp: MM.app.state.metrics.master.tp, target: MM.app.state.master.target, ceil: MM.app.state.master.ceiling }));
  near(m.lufs, m.target, 0.5, 'LUFS'); ok(m.tp <= m.ceil + 0.1, `TP ${m.tp.toFixed(2)} > ${m.ceil}`);
});
await test('master: sem filtro em pente (som "de tubo") — resposta original→master sem vales periódicos', async () => {
  const r = await J(async () => {
    const st = MM.app.state, D = MM.dsp, sr = st.sampleRate;
    const a = D.mono(st.origBuf.channels), b = D.mono(D.channelsOf(st.masterBuf));
    const n = 8192, A = new Float64Array(n / 2 + 1), B = new Float64Array(n / 2 + 1), pa = new Float64Array(n / 2 + 1), pb = new Float64Array(n / 2 + 1);
    for (let o = sr * 20; o + n < Math.min(a.length, b.length) - sr * 10; o += n) { D.powerSpectrum(a, o, n, pa); D.powerSpectrum(b, o, n, pb); for (let k = 0; k < pa.length; k++) { A[k] += pa[k]; B[k] += pb[k]; } }
    const k0 = Math.round(200 * n / sr), k1 = Math.round(4000 * n / sr);
    const tf = []; for (let k = k0; k < k1; k++) tf.push(10 * Math.log10((B[k] + 1e-20) / (A[k] + 1e-20)));
    const sm = tf.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 25); j < Math.min(tf.length, i + 25); j++) { s += tf[j]; c++; } return s / c; });
    const rip = tf.map((v, i) => v - sm[i]); const m = rip.reduce((x, y) => x + y, 0) / rip.length;
    let best = 0; for (let L = 4; L < 200; L++) { let s = 0, s0 = 0; for (let i = 0; i + L < rip.length; i++) { s += (rip[i] - m) * (rip[i + L] - m); s0 += (rip[i] - m) ** 2; } best = Math.max(best, s / s0); }
    return best;
  });
  ok(r < 0.5, 'autocorrelação do ripple ' + r.toFixed(2));
});
await test('QC sem falhas críticas', async () => {
  const bad = await J(() => (MM.app.state.qc || []).filter((q) => q.status === 'bad').map((q) => q.title));
  ok(!bad.length, bad.join(', '));
});
await test('score ancorado: cada critério indica a âncora externa (estilo, referência ou norma)', async () => {
  const r = await J(() => { const s = MM.app.state.score; return { keys: Object.keys(s.anchor || {}), tone: s.tone, ov: s.overall, orig: MM.app.state.scoreOrig }; });
  for (const k of ['balance', 'clarity', 'dynamics', 'stereo', 'lowEnd', 'vocal', 'loudness', 'phase']) ok(r.keys.includes(k), 'âncora de ' + k);
  ok(typeof r.tone === 'number', 'critério de tonalidade');
  ok(r.ov > r.orig, `mistura (${r.ov}) acima do original (${r.orig})`);
});
await test('master: latência (limiter/saturação/fase linear) compensada — impulso sai alinhado', async () => {
  const r = await J(async () => {
    const st = MM.app.state, sr = st.sampleRate, n = sr * 3, c = new Float32Array(n); c[sr] = 0.05; c[2 * sr] = 0.05;
    const pm = MM.toAudioBuffer([c, c.slice()], sr), out = [];
    const ph0 = st.master.chain.eq.phase;
    for (const ph of ['min', 'linear']) {
      st.master.chain.eq.phase = ph;
      const b = await MM.render(st, { premaster: pm, sr, tail: 0, noFade: true }), d = b.getChannelData(0);
      let bi = 0, bv = 0; for (let i = sr - 3000; i < sr + 3000; i++) if (Math.abs(d[i]) > bv) { bv = Math.abs(d[i]); bi = i; }
      out.push({ ph, lag: bi - sr, len: b.length === n });
    }
    st.master.chain.eq.phase = ph0;
    return out;
  });
  r.forEach((x) => { ok(Math.abs(x.lag) <= 2, x.ph + ': atraso ' + x.lag + ' amostras'); ok(x.len, x.ph + ': comprimento igual'); });
});
await test('velocidade: WebAssembly ativo e cache por stem reutiliza stems inalterados (resultado igual a −80 dB)', async () => {
  const r = await J(async () => {
    const st = MM.app.state, sr = st.sampleRate;
    MM.STEM_CACHE_OFF = true; const a = await MM.render(st, { out: 'premaster', sr }); MM.STEM_CACHE_OFF = false;
    await MM.render(st, { out: 'premaster', sr }); // garante a gravação
    const t0 = performance.now(); const b = await MM.render(st, { out: 'premaster', sr }); const last = MM.stemCache.last;
    let m = 0, pk = 0; for (let c = 0; c < 2; c++) { const X = a.getChannelData(c), Y = b.getChannelData(c); for (let i = 0; i < X.length; i += 3) { m = Math.max(m, Math.abs(X[i] - Y[i])); pk = Math.max(pk, Math.abs(X[i])); } }
    return { wasm: MM.wasm.ready, frozen: last.frozen, diff: 20 * Math.log10(m / pk + 1e-30), ms: performance.now() - t0 };
  });
  ok(r.wasm, 'wasm'); ok(r.frozen > 0, 'stems congelados: ' + r.frozen); ok(r.diff < -80, 'diferença ' + r.diff.toFixed(1) + ' dB');
});
await test('editor de voz: analisa a voz, a nota editada entra no render antes do mixer, Ctrl+Z repõe', async () => {
  await J(() => MM.app.go('tune'));
  await page.waitForFunction(() => document.querySelector('#tnCv'), null, { timeout: 120000 });
  const r = await J(async () => {
    const st = MM.app.state, s = st.stems.find((x) => x.id === MM.app.tn.stem), sr = st.sampleRate, T = MM.tune;
    const n = T.notes(s).filter((x) => x.kind === 'v' && x.t1 - x.t0 > 0.25)[3];
    const a = await MM.render(st, { out: 'premaster', sr, filter: (x) => x.id === s.id });
    MM.commit(st, 'teste'); T.edit(s, n.id).shift = 200; await MM.app.syncTune();
    const b = await MM.render(st, { out: 'premaster', sr, filter: (x) => x.id === s.id });
    const A = a.getChannelData(0), B = b.getChannelData(0), seg = (x, t0, t1) => { let m = 0; for (let i = Math.round(t0 * sr); i < Math.round(t1 * sr); i++) m = Math.max(m, Math.abs(x[i])); return m; };
    let d = 0; for (let i = Math.round((n.t0 + 0.05) * sr); i < Math.round((n.t1 - 0.05) * sr); i++) d = Math.max(d, Math.abs(A[i] - B[i]));
    MM.app.undo(); await MM.app.syncTune();
    return { notes: T.notes(s).length, key: T.keyLabel(T.keyOf(st, s)), changed: d / (seg(A, n.t0, n.t1) + 1e-9), tuned: !!s.tuneBuf };
  });
  ok(r.notes > 50, 'notas ' + r.notes);
  ok(r.changed > 0.1, 'a nota editada mudou no render (' + r.changed.toFixed(2) + ')');
  ok(!r.tuned, 'Ctrl+Z repõe a voz original');
});
await test('todas as vistas abrem sem erros', async () => {
  for (const v of ['mixer', 'arrange', 'tune', 'analysis', 'automation', 'master', 'compare', 'refs', 'export', 'settings', 'plugin', 'styles', 'album']) { await J((x) => MM.app.go(x), v); await page.waitForTimeout(400); }
  ok(!errors.length, errors.join(' | '));
});
await test('projeto completo (.mixmind): exportar e reabrir mantém versões, mutes e automação', async () => {
  const r = await J(async () => {
    const st = MM.app.state, v = st.stems.find((s) => s.role === 'Lead Vocal');
    MM.sections.toggleMute(st, 1, v.id); st.automation[0].manual = [[[10, 2], [20, -2]]]; MM.saveVersion(st, 'Teste V2');
    const z = await MM.project.export(st); const rec = await MM.project.read(z);
    return { versions: rec.versions.map((x) => x.name), stems: rec.stems.length, manual: rec.snap.automation[0].manual.length, mutes: rec.snap.sections[1].mutes.length };
  });
  ok(r.versions.includes('Teste V2') && r.stems === 15 && r.manual === 1 && r.mutes === 1, JSON.stringify(r));
});

await browser.close(); server.close();
summary();
