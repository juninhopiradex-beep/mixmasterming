// Testes de DSP e formatos — correm em Node (sem browser): `node tests/dsp.test.mjs`
import { loadMM, test, near, ok, summary } from './load.mjs';

const MM = loadMM(['js/core/wasm-bin.js', 'js/core/wasm.js', 'js/core/dsp.js', 'js/core/worklets.js', 'js/audio/analysis.js', 'js/audio/ai.js', 'js/audio/export.js', 'js/audio/delivery.js', 'js/audio/album.js', 'js/core/sections.js', 'js/core/project.js', 'js/audio/insight.js', 'js/audio/engineer.js']);
const D = MM.dsp, X = MM.exporter;
const SR = 48000;
const sine = (f, amp, sec, ph = 0, sr = SR) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / sr + ph));

console.log('DSP · medição');
await test('LUFS: seno 997 Hz a −23 dBFS em estéreo = −23,0 LUFS (EBU Tech 3341)', () => {
  const a = sine(997, Math.pow(10, -23 / 20), 20);
  near(D.loudness([a, a], SR).integrated, -23, 0.1, 'LUFS-I');
});
await test('LUFS: −20 dBFS = −20,0 LUFS (linearidade)', () => {
  const a = sine(997, Math.pow(10, -20 / 20), 10);
  near(D.loudness([a, a], SR).integrated, -20, 0.1, 'LUFS-I');
});
await test('True peak: seno a fs/4 com fase 45° → 0 dBTP (pico de amostra −3 dB)', () => {
  const a = sine(SR / 4, 1, 1, Math.PI / 4);
  near(D.lin2db(D.samplePeak([a])), -3.01, 0.05, 'sample peak');
  near(D.lin2db(D.truePeak([a])), 0, 0.25, 'true peak');
});
await test('True peak exato a 44,1 kHz: seno de 19 kHz com fase arbitrária (o 4× subestimaria)', () => {
  for (const ph of [0.3, 1.1, 2.2]) { const a = sine(19000, 0.9, 1, ph, 44100); near(D.lin2db(D.truePeak([a])), D.lin2db(0.9), 0.06, 'fase ' + ph); }
});
await test('Gating: silêncio não conta para o loudness integrado', () => {
  const a = sine(997, Math.pow(10, -23 / 20), 10), z = new Float32Array(SR * 10), x = new Float32Array(a.length + z.length); x.set(a); x.set(z, a.length);
  near(D.loudness([x, x], SR).integrated, -23, 0.15, 'LUFS-I com silêncio');
});

console.log('DSP · filtros');
await test('Crossover Linkwitz-Riley 4: graves + agudos somam plano (±0,1 dB a 50 Hz–10 kHz)', () => {
  const fc = 120, q = 0.7071;
  const imp = new Float32Array(16384); imp[0] = 1;
  const lp = D.filter(D.filter(imp, D.biquad('lowpass', fc, q, 0, SR)), D.biquad('lowpass', fc, q, 0, SR));
  const hp = D.filter(D.filter(imp, D.biquad('highpass', fc, q, 0, SR)), D.biquad('highpass', fc, q, 0, SR));
  // LR4: a soma é um all-pass (|H| = 1)
  const sum = lp.map((v, i) => v + hp[i]);
  for (const f of [50, 120, 1000, 10000]) {
    let re = 0, im = 0; for (let i = 0; i < sum.length; i++) { re += sum[i] * Math.cos(2 * Math.PI * f * i / SR); im -= sum[i] * Math.sin(2 * Math.PI * f * i / SR); }
    near(10 * Math.log10(re * re + im * im), 0, 0.1, `|H| a ${f} Hz`);
  }
});

await test('EQ "matched": high shelf +4 dB a 14 kHz segue a curva analógica perto de Nyquist (melhor que RBJ)', () => {
  const fs = 44100, err = (c) => Math.max(...[2000, 8000, 12000, 16000, 19000].map((f) => Math.abs(20 * Math.log10(D.biquadMag(c, f, fs)) - 20 * Math.log10(D.analogMag('highshelf', 14000, 0.7071, 4, f)))));
  const em = err(D.matched('highshelf', 14000, 0.7071, 4, fs)), er = err(D.biquad('highshelf', 14000, 0.7071, 4, fs));
  ok(em < 0.35, 'erro matched ' + em.toFixed(2) + ' dB'); ok(em < er, 'matched ' + em.toFixed(2) + ' < RBJ ' + er.toFixed(2));
});
await test('EQ de fase linear: FIR simétrico centrado em N/2 com a magnitude pedida (±0,2 dB)', () => {
  const fs = 48000, N = 8192, c = D.matched('peaking', 3000, 1, 5, fs);
  const h = D.linearPhaseFIR((f) => D.biquadMag(c, Math.max(1, f), fs), N, fs);
  let pk = 0; for (let i = 1; i < N; i++) if (Math.abs(h[i]) > Math.abs(h[pk])) pk = i;
  ok(pk === N / 2, 'pico em ' + pk);
  for (let k = 1; k < 200; k++) near(h[N / 2 - k], h[N / 2 + k], 1e-6, 'simetria ' + k);
  for (const f of [100, 1000, 3000, 8000]) {
    let re = 0, im = 0; for (let i = 0; i < N; i++) { re += h[i] * Math.cos(2 * Math.PI * f * i / fs); im -= h[i] * Math.sin(2 * Math.PI * f * i / fs); }
    near(20 * Math.log10(Math.hypot(re, im)), 20 * Math.log10(D.biquadMag(c, f, fs)), 0.2, f + ' Hz');
  }
});

console.log('WebAssembly');
await test('núcleos wasm carregados e iguais ao JavaScript (espectro, loudness, true peak, filtro)', () => {
  ok(MM.wasm.ready, 'wasm pronto');
  const sr = 44100, n = sr * 12, x = new Float32Array(n), y = new Float32Array(n);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) { x[i] = 0.5 * Math.sin(2 * Math.PI * 997 * i / sr) + 0.3 * rnd() * (i % 22050 < 3000 ? 1 : 0.1); y[i] = 0.6 * Math.sin(2 * Math.PI * 19000 * i / sr + 0.7) + 0.1 * rnd(); }
  const run = async () => {
    const sp = []; await D.stft(x, sr, 4096, 2048, (p, f) => { if (f % 37 === 0) sp.push(Array.from(p.slice(0, 2049))); });
    return { sp, lu: D.loudness([x, y], sr).integrated, tp: D.truePeak([x, y]), f: D.filter(x, D.biquad('peaking', 3000, 1, 6, sr)) };
  };
  return (async () => {
    MM.WASM_OFF = true; const a = await run(); MM.WASM_OFF = false; const b = await run();
    near(b.lu, a.lu, 1e-6, 'LUFS'); near(b.tp, a.tp, 1e-6, 'true peak');
    let e = 0; for (let i = 0; i < a.f.length; i += 97) e = Math.max(e, Math.abs(a.f[i] - b.f[i])); ok(e < 1e-6, 'filtro ' + e);
    let es = 0; a.sp.forEach((r, j) => r.forEach((v, k) => { const d = Math.abs(10 * Math.log10(v + 1e-20) - 10 * Math.log10(b.sp[j][k] + 1e-20)); if (v > 1e-12 && d > es) es = d; })); ok(es < 1e-6, 'espectro ' + es + ' dB');
  })();
});

console.log('Modelo do engenheiro');
await test('emparelha stems brutos ↔ misturados pelos nomes e agrupa o arquivo por sessão', () => {
  const E = MM.engineer, f = (p) => ({ name: p.split('/').pop(), webkitRelativePath: p });
  const files = ['Arquivo/Musica A/RAW/01_Kick.wav', 'Arquivo/Musica A/RAW/02_Lead Vox.wav', 'Arquivo/Musica A/RAW/03_Bass DI.wav', 'Arquivo/Musica A/Mix/Kick_PF.wav', 'Arquivo/Musica A/Mix/Lead Vox print.wav', 'Arquivo/Musica A/Mix/Bass DI_mix.wav',
    'Arquivo/Musica B/raw/Piano.wav', 'Arquivo/Musica B/bounces/Piano_bounce.wav', 'Arquivo/Musica B/notas.txt'].map(f);
  const S = E.parseArchive(files);
  ok(S.length === 2, 'sessões ' + S.length);
  const A = S.find((x) => x.name === 'Musica A'), P = E.pair(A.raw, A.mix);
  ok(P.pairs.length === 3, 'pares ' + P.pairs.length);
  ok(P.pairs.every((p) => E.similarity(p.raw.name, p.mix.name) > 0.55), 'semelhança');
  ok(P.pairs.find((p) => p.raw.name.includes('Kick')).mix.name === 'Kick_PF.wav', 'kick certo');
});
await test('aprende decisões consistentes e só pesa quando bate as regras (validação por sessão)', () => {
  const E = MM.engineer, BAL = MM.BAL_TABLE;
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const roles = ['Kick', 'Snare', 'Bass', 'Piano', 'Backing Vocal', 'Pad', 'Electric Guitar', 'Hi-Hat'];
  const mk = (sess, role) => { const fam = MM.ROLES[role].fam, b = [0.1, 0.2, 0.2, 0.2, 0.15, 0.1, 0.05].map((v) => v * (1 + 0.3 * rnd())), sum = b.reduce((a, x) => a + x, 0);
    // o "engenheiro": teclas/pads 3 dB acima da regra, voz de apoio 2 dB abaixo; corta 2 dB em médios-graves em tudo
    const off = ['keys', 'pad'].includes(fam) ? 3 : role === 'Backing Vocal' ? -2 : 0;
    return { id: sess + role, sessionId: sess, role, fam, xf: E.inputOf({ bands: b.map((v) => v / sum), crest: 14 + 3 * rnd(), centroid: 1500 * (1 + 0.5 * rnd()), onsetRate: 3, width: 0.2 }, -6 + 4 * rnd()), y: { bal: BAL[role] + off + 0.7 * rnd(), d7: [0, 0, -2 + 0.4 * rnd(), 0, 0.3, 0, 0], dCrest: -4 + rnd() } }; };
  E.samples = []; for (let k = 0; k < 8; k++) roles.forEach((r) => E.samples.push(mk('s' + k, r)));
  const M = E.train();
  ok(M && M.outs.bal, 'modelo treinado');
  ok(M.outs.bal.gain > 0.3, 'balanço bate a regra: ganho ' + M.outs.bal.gain.toFixed(2));
  ok(M.outs.d2.gain > 0.3, 'EQ médios-graves aprendido: ganho ' + M.outs.d2.gain.toFixed(2));
  const st = { stems: [{ id: 'v', role: 'Lead Vocal', features: { lufs: -18, bands: [0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.05], crest: 15, centroid: 2000, onsetRate: 4, width: 0 } }, { id: 'p', role: 'Piano', features: { lufs: -22, bands: [0.05, 0.15, 0.25, 0.25, 0.15, 0.1, 0.05], crest: 14, centroid: 1500, onsetRate: 3, width: 0.2 } }] };
  const pr = E.predict(st.stems[1], st);
  near(pr.bal, BAL.Piano + 3, 1.2, 'piano previsto');
  ok(pr.wBal > 0.2, 'peso ' + pr.wBal.toFixed(2));
  near(pr.dCrest, -4, 1, 'compressão prevista');
  // ruído puro (sem padrão): o modelo não pode ganhar peso
  E.samples = E.samples.map((s) => Object.assign({}, s, { y: Object.assign({}, s.y, { bal: BAL[s.role] + 4 * rnd() }) }));
  const M2 = E.train();
  ok(!M2.outs.bal || M2.outs.bal.gain < 0.15, 'sem padrão → sem peso (' + (M2.outs.bal ? M2.outs.bal.gain.toFixed(2) : '—') + ')');
  E.samples = []; E.train();
});

console.log('Formatos');
await test('WAV 24-bit: cabeçalho RIFF/fmt/data correto', () => {
  const w = X.wav([sine(1000, 0.5, 0.1), sine(1000, 0.5, 0.1)], SR, 24);
  const v = new DataView(w.buffer);
  const s = (o, n) => String.fromCharCode(...w.subarray(o, o + n));
  ok(s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE', 'RIFF/WAVE');
  ok(v.getUint16(22, true) === 2 && v.getUint32(24, true) === SR && v.getUint16(34, true) === 24, 'fmt');
});
await test('WAV 16-bit com dither: valores dentro de ±1 LSB do original', () => {
  const a = sine(440, 0.25, 0.05), w = X.wav([a], SR, 16), v = new DataView(w.buffer);
  let maxErr = 0; for (let i = 0; i < a.length; i++) maxErr = Math.max(maxErr, Math.abs(v.getInt16(44 + i * 2, true) / 32767 - a[i]) * 32767);
  ok(maxErr <= 2.01, 'erro máximo ' + maxErr.toFixed(2) + ' LSB');
});
await test('ZIP: escrever e ler devolve os mesmos bytes', async () => {
  const data = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
  const z = X.zip([{ name: 'a.txt', data: 'olá Luanda' }, { name: 'pasta/b.bin', data }]);
  const e = await X.unzip(z);
  ok(e.length === 2 && new TextDecoder().decode(e[0].data) === 'olá Luanda', 'texto');
  ok(e[1].name === 'pasta/b.bin' && e[1].data.every((v, i) => v === data[i]), 'binário');
});
await test('Projeto: JSON com arrays tipados faz ida e volta', () => {
  const o = { f: Float32Array.from([1.5, -2.25, 3]), d: Float64Array.from([Math.PI]), n: [1, 2] };
  const r = JSON.parse(JSON.stringify(o, MM.project.replacer), MM.project.reviver);
  ok(r.f.constructor.name === 'Float32Array' && r.f[1] === -2.25 && r.d[0] === Math.PI && r.n[1] === 2, 'conteúdo');
});

console.log('Entrega');
await test('MD5 (RFC 1321): vetores de teste', () => {
  const e = new TextEncoder();
  ok(MM.album.md5(e.encode('')) === 'd41d8cd98f00b204e9800998ecf8427e', 'vazio');
  ok(MM.album.md5(e.encode('abc')) === '900150983cd24fb0d6963f7d28e17f72', 'abc');
  ok(MM.album.md5(e.encode('The quick brown fox jumps over the lazy dog')) === '9e107d9d372bb6826bd81d3542a419d6', 'fox');
  ok(MM.album.md5(new Uint8Array(1000).fill(97)) === MM.album.md5(e.encode('a'.repeat(1000))), 'blocos múltiplos');
});
await test('ISRC e UPC/EAN: validação', () => {
  const Dl = MM.delivery;
  ok(Dl.validISRC('AO-A1B-26-00001') && Dl.validISRC('usrc17607839') && !Dl.validISRC('AO-A1B-26-0001') && !Dl.validISRC('12-ABC-26-00001'), 'ISRC');
  ok(Dl.validEAN('4006381333931') && Dl.validEAN('036000291452') && !Dl.validEAN('4006381333932'), 'EAN/UPC');
});
await test('WAV com metadados: bext v2 com loudness, LIST/INFO, aXML com ISRC, ID3, data intacta', () => {
  const a = sine(1000, 0.5, 0.2), w0 = X.wav([a, a], SR, 24);
  const w = MM.delivery.wavWithMeta(w0, { title: 'Noite de Luanda', artist: 'Piradex', isrc: 'AO-A1B-26-00001', year: '2026' }, { lufs: -9.6, lra: 3.1, tp: -1.0, mMax: -7, stMax: -8 });
  const v = new DataView(w.buffer), s4 = (o) => String.fromCharCode(...w.subarray(o, o + 4));
  ok(v.getUint32(4, true) === w.length - 8, 'tamanho RIFF');
  const ch = {}; for (let o = 12; o + 8 <= w.length;) { const id = s4(o), n = v.getUint32(o + 4, true); ch[id] = [o + 8, n]; o += 8 + n + (n & 1); }
  ok(ch['fmt '] && ch.bext && ch.LIST && ch.axml && ch.data && ch['id3 '], 'chunks ' + Object.keys(ch).join(','));
  const [bo] = ch.bext; ok(v.getUint16(bo + 346, true) === 2 && v.getInt16(bo + 412, true) === -960 && v.getInt16(bo + 416, true) === -100, 'bext v2 + loudness');
  ok(new TextDecoder().decode(w.subarray(ch.axml[0], ch.axml[0] + ch.axml[1])).includes('ISRC:AOA1B2600001'), 'aXML ISRC');
  ok(ch.data[1] === w0.length - 44 && w.subarray(ch.data[0], ch.data[0] + 30).every((x, i) => x === w0[44 + i]), 'áudio intacto');
});
await test('FLAC com Vorbis comments: bloco 4 depois do STREAMINFO', () => {
  const a = sine(1000, 0.5, 0.2), f = MM.delivery.flacWithMeta(X.flac([a, a], SR, 16), { title: 'Teste', isrc: 'AOA1B2600001' });
  ok(String.fromCharCode(...f.subarray(0, 4)) === 'fLaC' && (f[4] & 0x80) === 0 && f[42] === (0x80 | 4), 'cabeçalhos de bloco');
  ok(new TextDecoder().decode(f.subarray(46, 200)).includes('ISRC=AOA1B2600001'), 'ISRC na tag');
});
await test('DDP 2.0: estrutura, PQ e verificação independente', () => {
  const al = { name: 'EP Teste', artist: 'Piradex', upc: '4006381333931', ceiling: -1, tracks: [] };
  const mk = (sec, isrc) => ({ title: 'F', isrc, gain: 0, metrics: { tp: -1, lufs: -9 }, chs: [sine(220, 0.3, sec, 0, 44100), sine(220, 0.3, sec, 0, 44100)] });
  al.tracks = [mk(5.3, 'AOA1B2600001'), mk(6.1, 'AOA1B2600002')];
  // render CD sem resample (já a 44,1 kHz)
  const marks = []; let tot = 0; const parts = [];
  al.tracks.forEach((t, i) => { const len = Math.ceil((t.chs[0].length + (i ? 0 : 2 * 44100)) / 588) * 588; marks.push({ track: i + 1, start: tot, audio: t.chs[0].length, length: len }); tot += len; });
  const L = new Float32Array(tot), R = new Float32Array(tot);
  const r = { chs: [L, R], sr: 44100, marks, total: tot };
  const res = MM.album.ddp(al, r), chk = MM.album.readDDP(res.files);
  ok(!chk.problems.length, chk.problems.join('; '));
  ok(chk.level === 'DDP 2.00' && chk.upc === '4006381333931' && chk.type === 'CD', 'DDPID');
  const t2 = chk.pq.find((e) => e.track === '02');
  ok(t2.sector === 150 + marks[1].start / 588 && t2.isrc === 'AOA1B2600002', 'faixa 2');
  ok(res.files.find((f) => f.name === 'IMAGE.DAT').data.length === (150 + tot / 588) * 2352, 'IMAGE.DAT');
  ok(res.files.find((f) => f.name === 'CHECKSUM.MD5').data.split('\r\n').filter(Boolean).length === 5, 'CHECKSUM.MD5');
});

console.log('Estrutura e automação');
await test('Secções: dividir, juntar e calar por secção', () => {
  const st = { mode: 'stems', stems: [{ id: 'a', removed: false }], dirty: {}, music: { duration: 40, downbeat: 0, barSec: 2, sections: [{ name: 'Verso', start: 0, end: 20 }, { name: 'Refrão', start: 20, end: 40 }] } };
  ok(MM.sections.split(st, 10.3, false) === 1, 'split no compasso');
  ok(st.music.sections[1].start === 10, 'encaixe no compasso');
  MM.sections.toggleMute(st, 2, 'a');
  ok(JSON.stringify(MM.sections.muteRanges(st, 'a')) === '[[20,40]]', 'mute range');
  MM.sections.mergeNext(st, 0);
  ok(st.music.sections.length === 2 && st.music.sections[0].end === 20, 'merge');
});
await test('Automação: valor manual prevalece sobre a IA e interpola', () => {
  const l = { def: 0, enabled: { ai: true, manual: true }, ai: { points: [[0, 5], [10, 5]] }, manual: [[[2, 0], [4, -4]]] };
  near(MM.laneValue(l, 3), -2, 1e-9, 'manual'); near(MM.laneValue(l, 8), 5, 1e-9, 'IA');
});

console.log('Análise');
await test('Fase: polaridade invertida entre kick e baixo é detetada', async () => {
  const n = SR * 8, base = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = (i % (SR / 2)) / SR; base[i] = Math.exp(-t * 12) * Math.sin(2 * Math.PI * 55 * t); }
  const mk = async (id, role, x) => ({ id, role, label: id, chs: [x], length: x.length, removed: false, p: MM.defaultParams(), features: await MM.analyzeStem([x], SR, 'balanced') });
  const A = await mk('K', 'Kick', base), B = await mk('B', 'Bass', base.map((v) => -0.8 * v));
  const ev = MM.insight.phaseEval({ sampleRate: SR, stems: [A, B], music: { sections: [] }, refs: [], settings: {} }, { a: A, b: B, band: 'low' });
  ok(ev.verdict === 'polarity', 'veredicto ' + ev.verdict); near(ev.r0, -1, 0.05, 'r0');
});

summary();
