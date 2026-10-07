// Editor de voz: precisão da deteção e do render (voz sintética com pitch e formantes conhecidos). `node tests/tune.test.mjs`
import { loadMM, test, near, ok, summary } from './load.mjs';

const MM = loadMM(['js/core/wasm-bin.js', 'js/core/wasm.js', 'js/core/dsp.js', 'js/audio/tune.js']);
const D = MM.dsp, T = MM.tune, SR = 44100;
const midi = (c) => 440 * Math.pow(2, (c - 6900) / 1200);
const FORM = [[700, 110, 1], [1220, 120, 0.5], [2600, 160, 0.25]]; // vogal "a"
const env = (f, sh = 1) => FORM.reduce((a, [F, B, g]) => a + g / (1 + Math.pow((f - F * sh) / B, 2)), 0.02);
/** Voz sintética: notas [{t0, t1, c, vib}] com harmónicos sob envelope de formantes; ruído "s" opcional. */
function voice(notes, dur, opts = {}) {
  const n = Math.round(dur * SR), x = new Float32Array(n);
  let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (const nt of notes) {
    let ph = 0;
    const a = Math.round(nt.t0 * SR), b = Math.round(nt.t1 * SR);
    for (let i = a; i < b; i++) {
      const t = (i - a) / SR, att = Math.min(1, t / 0.02, (b - i) / SR / 0.03);
      const c = nt.c + (nt.vib ? nt.vib * Math.sin(2 * Math.PI * 5.5 * t) : 0) + (nt.glide ? nt.glide * Math.min(1, t / 0.12) : 0);
      const f = midi(c); ph += (2 * Math.PI * f) / SR;
      let v = 0; for (let h = 1; h * f < 8000; h++) v += (env(h * f, opts.fs) / h) * Math.sin(h * ph);
      x[i] += 0.25 * v * att * (nt.amp || 1);
    }
  }
  for (const [t0, t1] of opts.noise || []) { let y = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { const r = rnd(); x[i] += 0.08 * (r - y); y = r; } }
  return x;
}
const stem = (x) => ({ id: 'v', chs: [x], length: x.length, features: {}, p: {} });
const NOTES = [{ t0: 0.3, t1: 0.9, c: 5730 }, { t0: 0.95, t1: 1.55, c: 6000 }, { t0: 1.6, t1: 2.4, c: 6400, vib: 60 }];
const KEY = { tonic: 9, scale: 'minor' }; // Lá menor
const X = voice(NOTES, 3.2, { noise: [[2.6, 2.8]] });
const S = stem(X);
await T.analyze(S, SR);
const notesV = () => T.notes(S).filter((n) => n.kind === 'v');
const centreOf = async (x, t0, t1) => { const tr = await T.track(x, SR); const v = []; for (let f = 0; f < tr.cents.length; f++) { const t = tr.off + f * tr.hop; if (t > t0 + 0.08 && t < t1 - 0.08 && !isNaN(tr.cents[f])) v.push(tr.cents[f]); } return D.median(v); };
const rmsDb = (x, t0, t1) => { let s = 0, n = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) { s += x[i] * x[i]; n++; } return 10 * Math.log10(s / n + 1e-20); };
const peakHz = (x, t0, t1, lo, hi) => { // pico do envelope espectral (média de espectros) entre lo e hi
  const N = 4096, acc = new Float64Array(N / 2 + 1); let k = 0;
  for (let o = Math.round(t0 * SR); o + N < t1 * SR; o += 1024) { const p = D.powerSpectrum(x, o, N); for (let i = 0; i < p.length; i++) acc[i] += p[i]; k++; }
  // envelope: máximo por janela de 150 Hz (une os harmónicos)
  const bw = Math.round((150 * N) / SR); let best = 0, bf = 0;
  for (let i = Math.round((lo * N) / SR); i < (hi * N) / SR; i++) { let m = 0, c = 0; for (let j = i - bw; j <= i + bw; j++) { m += acc[j] || 0; c++; } if (m / c > best) { best = m / c; bf = (i * SR) / N; } }
  return bf;
};

console.log('Editor de voz · deteção');
await test('WebAssembly e JavaScript dão o mesmo trilho de pitch', async () => {
  MM.WASM_OFF = true; const a = await T.track(X, SR); MM.WASM_OFF = false; const b = await T.track(X, SR);
  ok(MM.wasm.ready, 'wasm'); let m = 0, nb = 0; for (let i = 0; i < a.cents.length; i++) { if (isNaN(a.cents[i]) !== isNaN(b.cents[i])) nb++; else if (!isNaN(a.cents[i])) m = Math.max(m, Math.abs(a.cents[i] - b.cents[i])); }
  ok(m < 1 && nb <= 2, `diferença máx. ${m.toFixed(3)} cents, ${nb} tramas com decisão diferente`);
});
await test('notas detetadas com o centro certo (±8 cents) e a sibilante como evento sem pitch', () => {
  const v = notesV(), u = T.notes(S).filter((n) => n.kind === 'u');
  ok(v.length === 3, 'notas com pitch: ' + v.length + ' ' + JSON.stringify(v.map((n) => [n.t0, n.t1, n.c])));
  v.forEach((n, i) => near(n.c, NOTES[i].c, 8, 'nota ' + (i + 1)));
  ok(u.some((n) => n.t0 > 2.5 && n.t1 < 2.9), 'sibilante ' + JSON.stringify(u.map((n) => [n.t0, n.t1])));
  ok(v[2].v > 40, 'vibrato medido ' + v[2].v);
});
await test('tonalidade detetada a partir de uma melodia em Lá menor', () => {
  const mel = [5700, 5900, 6000, 6200, 6400, 6500, 6700, 6900, 6400, 6000, 5700, 5700].map((c, i) => ({ kind: 'v', c, t0: i, t1: i + (c % 1200 === 900 ? 1.6 : 0.8) }));
  const k = T.detectKey(mel); ok(k.tonic === 9 && k.scale === 'minor', JSON.stringify(k));
});

console.log('Editor de voz · render');
await test('sem edições não há render; editar uma nota não toca no resto (bit a bit)', () => {
  S.p.tune = T.defaults();
  ok(!T.hasEdits(S), 'sem edições');
  const n2 = notesV()[1]; T.edit(S, n2.id).shift = 100;
  const y = T.render(S, KEY)[0];
  let diff = 0; for (let i = 0; i < Math.round(0.85 * SR); i++) diff = Math.max(diff, Math.abs(y[i] - X[i])); for (let i = Math.round(1.7 * SR); i < X.length; i++) diff = Math.max(diff, Math.abs(y[i] - X[i]));
  ok(diff === 0, 'fora da nota editada: diferença ' + diff);
});
await test('subir uma nota 1 meio-tom: medido +100 cents (±8), nível igual (±1 dB)', async () => {
  S.p.tune = T.defaults(); const n2 = notesV()[1]; T.edit(S, n2.id).shift = 100;
  const y = T.render(S, KEY)[0];
  near(await centreOf(y, n2.t0, n2.t1), NOTES[1].c + 100, 8, 'centro');
  near(rmsDb(y, n2.t0 + 0.1, n2.t1 - 0.1), rmsDb(X, n2.t0 + 0.1, n2.t1 - 0.1), 1, 'nível');
});
await test('descer uma nota 3 meios-tons: medido −300 cents (±8), nível ±1,5 dB', async () => {
  S.p.tune = T.defaults(); const n1 = notesV()[0]; T.edit(S, n1.id).shift = -300;
  const y = T.render(S, KEY)[0];
  near(await centreOf(y, n1.t0, n1.t1), NOTES[0].c - 300, 8, 'centro');
  near(rmsDb(y, n1.t0 + 0.1, n1.t1 - 0.1), rmsDb(X, n1.t0 + 0.1, n1.t1 - 0.1), 1.5, 'nível');
});
await test('Pitch Centre 100 %: nota desafinada +30 cents vai ao Lá exato (±6)', async () => {
  S.p.tune = T.defaults(); const n1 = notesV()[0]; T.edit(S, n1.id).centre = 1;
  const y = T.render(S, KEY)[0];
  near(await centreOf(y, n1.t0, n1.t1), 5700, 6, 'centro');
});
await test('formantes preservados ao mudar o pitch e deslocados com a ferramenta de formantes', () => {
  // amplitudes dos harmónicos medidas vs o envelope de formantes conhecido (preservado) ou deslocado
  const harm = (x, t0, t1, f) => { const N = 8192, acc = new Float64Array(N / 2 + 1); for (let o = Math.round(t0 * SR); o + N < t1 * SR; o += 2048) { const p = D.powerSpectrum(x, o, N); for (let i = 0; i < p.length; i++) acc[i] += p[i]; } const out = []; for (let h = 1; h * f < 3500; h++) { const k = Math.round((h * f * N) / SR); let m = 0; for (let j = k - 3; j <= k + 3; j++) m = Math.max(m, acc[j]); out.push([h * f, 10 * Math.log10(m + 1e-20)]); } return out; };
  const err = (meas, sh) => { const d = meas.map(([f, a]) => a - 20 * Math.log10(env(f, sh) / (f / 100))); const m = D.mean(d); return D.mean(d.map((v) => Math.abs(v - m))); };
  S.p.tune = T.defaults(); const n2 = notesV()[1]; const e = T.edit(S, n2.id); e.shift = 400;
  const fN = midi(NOTES[1].c + 400), r = Math.pow(2, 400 / 1200);
  const m1 = harm(T.render(S, KEY)[0], n2.t0 + 0.1, n2.t1 - 0.1, fN);
  const keep = err(m1, 1), moved = err(m1, r);
  console.log(`      +4 meios-tons: ${keep.toFixed(2)} dB vs ${moved.toFixed(2)} dB`); ok(keep < moved * 0.6 && keep < 3, `+4 meios-tons: erro face ao envelope original ${keep.toFixed(2)} dB vs deslocado ${moved.toFixed(2)} dB`);
  e.shift = 0; e.formant = 300;
  const m2 = harm(T.render(S, KEY)[0], n2.t0 + 0.1, n2.t1 - 0.1, midi(NOTES[1].c));
  const up = err(m2, Math.pow(2, 300 / 1200)), orig = err(m2, 1);
  console.log(`      formantes +300 c: ${up.toFixed(2)} dB vs ${orig.toFixed(2)} dB`); ok(up < orig * 0.7, `formantes +300 cents: erro face ao envelope ×1,19 ${up.toFixed(2)} dB vs original ${orig.toFixed(2)} dB`);
});
await test('vibrato original a 0 %: o vibrato de ±60 cents desaparece', async () => {
  S.p.tune = T.defaults(); const n3 = notesV()[2]; T.edit(S, n3.id).vib = 0;
  const y = T.render(S, KEY)[0], tr = await T.track(y, SR);
  const v = []; for (let f = 0; f < tr.cents.length; f++) { const t = tr.off + f * tr.hop; if (t > n3.t0 + 0.12 && t < n3.t1 - 0.12 && !isNaN(tr.cents[f])) v.push(tr.cents[f]); }
  const sd = Math.sqrt(D.mean(v.map((c) => (c - D.mean(v)) ** 2)));
  ok(sd < 12, 'desvio que sobra ' + sd.toFixed(1) + ' cents (antes ~42)');
});
await test('mover uma nota +100 ms: o ataque sai 100 ms depois (±12 ms) e o fim do ficheiro não muda', () => {
  S.p.tune = T.defaults(); const n2 = notesV()[1]; T.edit(S, n2.id).move = 0.1;
  const y = T.render(S, KEY)[0];
  const onset = (x) => { const thr = Math.pow(10, -30 / 20) * 0.25; for (let i = Math.round(0.905 * SR); i < 1.6 * SR; i += 32) { let m = 0; for (let k = 0; k < 256; k++) m = Math.max(m, Math.abs(x[i + k])); if (m > thr) return i / SR; } return NaN; };
  ok(y.length === X.length, 'comprimento');
  // (a nota 2 começa 50 ms depois da 1 acabar; com o movimento o intervalo cresce)
  near(onset(y) - onset(X), 0.1, 0.012, 'ataque');
});
await test('ganho −6 dB numa nota e sibilantes −6 dB', () => {
  S.p.tune = T.defaults(); const n1 = notesV()[0]; T.edit(S, n1.id).gain = -6; S.p.tune.sib = -6;
  const y = T.render(S, KEY)[0];
  near(rmsDb(y, n1.t0 + 0.1, n1.t1 - 0.1) - rmsDb(X, n1.t0 + 0.1, n1.t1 - 0.1), -6, 0.3, 'nota');
  near(rmsDb(y, 2.63, 2.77) - rmsDb(X, 2.63, 2.77), -6, 0.5, 'sibilante');
});
await test('dividir uma nota: as duas metades ficam editáveis à parte', () => {
  S.p.tune = T.defaults(); const n3 = notesV()[2]; S.p.tune.splits = [2.0];
  const v = notesV(); ok(v.length === 4, 'notas ' + v.length);
  ok(Math.abs(v[2].t1 - 2.0) < 1e-6 && Math.abs(v[3].t0 - 2.0) < 1e-6, 'fronteira em 2,0 s'); void n3;
});
await test('harmonia 3ª acima em Lá menor: Lá → Dó, Dó → Mi', async () => {
  S.p.tune = T.defaults(); const [n1, n2] = notesV(); T.edit(S, n1.id).centre = 1;
  const y = T.harmony({ music: {} }, Object.assign(S, { p: S.p }), 2)[0];
  // nota 1 corrigida para Lá (5700) → 3ª acima na escala = Dó (6000); nota 2 Dó → Mi (6400)
  near(await centreOf(y, n1.t0, n1.t1), 6000, 10, 'nota 1'); near(await centreOf(y, n2.t0, n2.t1), 6400, 10, 'nota 2');
});
await test('stem estéreo: os dois canais editados com as mesmas marcas; fora da nota, bit a bit', async () => {
  const R = X.map((v, i) => v * 0.8 + (i > 3 ? X[i - 3] * 0.1 : 0)), s2 = { id: 'st', chs: [X, R], length: X.length, features: {}, p: {} };
  await T.analyze(s2, SR); s2.p.tune = T.defaults();
  const n2 = T.notes(s2).filter((n) => n.kind === 'v')[1]; T.edit(s2, n2.id).shift = 100;
  const [l, r] = T.render(s2, KEY);
  near(await centreOf(r, n2.t0, n2.t1), NOTES[1].c + 100, 10, 'canal direito');
  let d = 0; for (let i = 0; i < Math.round(0.8 * SR); i++) d = Math.max(d, Math.abs(r[i] - R[i]), Math.abs(l[i] - X[i]));
  ok(d === 0, 'antes da nota: ' + d);
});
await test('velocidade: análise + render de 60 s de voz', async () => {
  const notes = []; for (let t = 0.2; t < 59.5; t += 0.5) notes.push({ t0: t, t1: t + 0.42, c: 5700 + (Math.round(t * 2) % 5) * 200, vib: (Math.round(t * 2) % 3) * 30 });
  const x = voice(notes, 60), s2 = stem(x);
  let t0 = performance.now(); await T.analyze(s2, SR); const ta = performance.now() - t0;
  s2.p.tune = T.defaults(); T.notes(s2).forEach((n) => { if (n.kind === 'v') T.edit(s2, n.id).centre = 1; });
  t0 = performance.now(); T.render(s2, KEY); const tr = performance.now() - t0;
  console.log(`      análise ${(ta / 1000).toFixed(2)} s · render com todas as notas editadas ${(tr / 1000).toFixed(2)} s`);
  ok(ta < 20000 && tr < 20000, 'tempo');
});
summary();
