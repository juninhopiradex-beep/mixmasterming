/* MIXMIND — Análise avançada (v1.3)
 * · espectro por stem DEPOIS do processamento (medido num render offline, por blocos, com as mesmas bandas da análise inicial)
 * · masking no tempo (por secção), antes e depois da correção
 * · fase/polaridade entre stems relacionados (kick×baixo, camadas, pares L/R, DI+amp)
 * · tonalidade do master vs perfil do estilo aprendido e vs referência
 * · compatibilidade mono por stem
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const QUAL = { fast: { n: 4096, hop: 4096 }, balanced: { n: 2048, hop: 2048 }, max: { n: 2048, hop: 1024 } };
  const I = (MM.insight = {});

  const stemsOf = (st) => st.stems.filter((s) => !s.removed && s.role !== 'Reference Track' && s.features);
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

  /** Assinatura de tudo o que muda o som dos stems (para saber se a medição está desatualizada). */
  I.signature = function (st) {
    const secs = (st.music && st.music.sections || []).map((s) => [s.start.toFixed(3), s.end.toFixed(3), s.name, (s.mutes || []).join('|')]);
    const auto = (st.automation || []).map((l) => [l.id, l.enabled, l.manual]);
    return hash(JSON.stringify([stemsOf(st).map((s) => [s.id, s.p, s.mute]), secs, auto, st.rider, st.settings.quality]));
  };

  /** Assinatura de UM stem (parâmetros, lanes, mutes por secção, fontes de sidechain): cache por stem da medição. */
  I.stemSig = function (st, s, o) {
    o = o || {};
    const lanes = (st.automation || []).filter((l) => l.target && (l.target.id === s.id || (l.also || []).some((a) => a.id === s.id)));
    const secs = (st.music && st.music.sections || []).filter((x) => (x.mutes || []).includes(s.id)).map((x) => [x.start.toFixed(3), x.end.toFixed(3)]);
    const srcs = (s.p.dyn || []).map((d) => d.src).concat(s.p.duck && s.p.duck.on ? [s.p.duck.src] : []).filter(Boolean).map((id) => { const o = st.stems.find((x) => x.id === id); return o ? [id, o.p.trim, o.p.fader, o.mute, (st.automation || []).filter((l) => l.target && l.target.id === id && l.target.param === 'ride').map((l) => hash(JSON.stringify(l)))] : id; });
    return hash(JSON.stringify([s.p, o.noMute ? 0 : s.mute, lanes.map((l) => hash(JSON.stringify(l))), secs, srcs, s.role === 'Lead Vocal' || lanes.some((l) => l.target.param === 'ride') ? st.rider : 0, st.settings.quality, st.sampleRate]));
  };
  /** Energia por bloco (~100 ms) e por banda de 1/3 de oitava — exatamente como na análise inicial (MM.analyzeStem). */
  function accumBands(x, xOffset, f0, f1, n, hop, fpb, bins, out, nBlk) {
    const tmp = new Float64Array(31), w = D.wasmOn() ? MM.wasm : null;
    if (w && x.length > n) {
      // WebAssembly: o bloco renderizado é copiado uma vez; FFT real por janela (~3× mais rápido)
      const T = w.fftTables(n, D.hann(n)), xa = w.put(x), wk = w.alloc(n * 8), oa = w.alloc((n / 2 + 1) * 8);
      try {
        for (let f = f0; f < f1; f++) {
          const bi = Math.floor(f / fpb);
          if (bi >= nBlk) break;
          w.x.pspec(xa.ptr, x.length, f * hop - xOffset, n, T.win.ptr, T.tw.ptr, T.rev.ptr, wk.ptr, oa.ptr);
          D.sumBands(w.f64(oa.ptr, n / 2 + 1), bins, tmp);
          for (let b = 0; b < 31; b++) out[bi * 31 + b] += tmp[b] / fpb;
        }
      } finally { w.free(xa); w.free(wk); w.free(oa); }
      return;
    }
    const p = new Float64Array(n / 2 + 1);
    for (let f = f0; f < f1; f++) {
      const bi = Math.floor(f / fpb);
      if (bi >= nBlk) break;
      D.powerSpectrum(x, f * hop - xOffset, n, p);
      D.sumBands(p, bins, tmp);
      for (let b = 0; b < 31; b++) out[bi * 31 + b] += tmp[b] / fpb;
    }
  }
  I.bandSeries = async function (x, sr, quality, nBlkMax) {
    const q = QUAL[quality] || QUAL.balanced, n = q.n, hop = q.hop;
    const fpb = Math.max(1, Math.round((0.1 * sr) / hop));
    const nFrames = Math.max(1, Math.floor((x.length - n) / hop) + 1);
    const nBlk = Math.min(nBlkMax || Infinity, Math.ceil(nFrames / fpb));
    const out = new Float32Array(nBlk * 31), bins = D.bandBins(n, sr, D.thirdOctEdges);
    for (let f = 0; f < nFrames; f += 400) { accumBands(x, 0, f, Math.min(nFrames, f + 400), n, hop, fpb, bins, out, nBlk); await D.yieldUI(); }
    return { L: out, nb: nBlk, blockSec: (fpb * hop) / sr };
  };

  /**
   * Mede cada stem processado (pós-fader, antes do pan) num render offline por blocos de ~12 s
   * com 1 s de pré-roll (compressores e envolventes estabilizados). Até 32 stems por render.
   */
  I.measurePost = async function (st, onProgress, opts) {
    opts = opts || {};
    if (MM.tune) await MM.tune.ensure(st);
    const all = stemsOf(st), sr = st.sampleRate;
    // cache por stem: só se renderizam os stems cuja assinatura mudou desde a última medição
    const sigs = Object.fromEntries(all.map((s) => [s.id, I.stemSig(st, s)]));
    const prev = !opts.full && st.post && st.post.stemSig ? st.post : null;
    const stems = all.filter((s) => !prev || prev.stemSig[s.id] !== sigs[s.id] || !prev.bands[s.id]);
    const q = QUAL[st.settings.quality] || QUAL.balanced, n = q.n, hop = q.hop;
    const fpb = Math.max(1, Math.round((0.1 * sr) / hop)), blockSamp = fpb * hop;
    const bins = D.bandBins(n, sr, D.thirdOctEdges);
    const len = stems.length ? Math.max(...stems.map((s) => s.length)) : 0;
    const pre = Math.round(sr * 1.0);
    // tamanho do bloco de render limitado pela memória: canais × segundos ≈ 300
    const chunkFor = (nch) => blockSamp * Math.max(1, Math.round((D.clamp(300 / nch, 8, 30) * sr) / blockSamp));
    const out = {};
    all.forEach((s) => { if (!stems.includes(s)) out[s.id] = prev.bands[s.id]; });
    stems.forEach((s) => (out[s.id] = new Float32Array(s.features.bandFrames * 31)));
    const groups = [];
    for (let i = 0; i < stems.length; i += 32) groups.push(stems.slice(i, i + 32));
    const totalSteps = groups.reduce((t, g) => t + Math.ceil(len / chunkFor(g.length)), 0);
    let done = 0;
    for (const grp of groups) {
      const ids = new Set(grp.map((s) => s.id));
      const chunk = chunkFor(grp.length);
      for (let c0 = 0; c0 < len; c0 += chunk) {
        const rs = Math.max(0, c0 - pre), re = Math.min(len, c0 + chunk) + n;
        const ctx = new OfflineAudioContext(grp.length, re - rs, sr);
        await MM.loadWorklets(ctx);
        const g = new MM.Graph(ctx, st, { offline: true, tap: true, filter: (s) => ids.has(s.id) });
        const mg = ctx.createChannelMerger(grp.length);
        try { ctx.destination.channelCount = grp.length; ctx.destination.channelCountMode = 'explicit'; ctx.destination.channelInterpretation = 'discrete'; } catch (e) { /* */ }
        grp.forEach((s, i) => { const nd = g.stems[s.id]; if (nd) nd.fader.connect(mg, 0, i); });
        mg.connect(ctx.destination);
        g.start(0, rs / sr);
        g.scheduleAutomation(0, rs / sr, re / sr);
        const buf = await ctx.startRendering();
        grp.forEach((s, i) => {
          const nFr = Math.max(1, Math.floor((s.length - n) / hop) + 1);
          const f0 = Math.ceil(c0 / hop), f1 = Math.min(nFr, Math.ceil(Math.min(len, c0 + chunk) / hop));
          accumBands(buf.getChannelData(i), rs, f0, f1, n, hop, fpb, bins, out[s.id], s.features.bandFrames);
        });
        done++;
        if (onProgress) onProgress(done / totalSteps);
        await D.yieldUI();
      }
    }
    // soma real (premaster: inclui bus, reverbs e delays)
    let sum = null;
    if (st.premasterBuf) {
      const nbMax = Math.max(...all.map((s) => s.features.bandFrames));
      sum = await I.bandSeries(D.mono(D.channelsOf(st.premasterBuf)), sr, st.settings.quality, nbMax);
    }
    I.lastMeasure = { rendered: stems.length, cached: all.length - stems.length };
    st.post = { sig: I.signature(st), stemSig: sigs, at: Date.now(), bands: out, sum: sum ? sum.L : null, sumNb: sum ? sum.nb : 0, blockSec: blockSamp / sr };
    return st.post;
  };
  I.postFresh = (st) => !!(st.post && st.post.sig === I.signature(st));

  /** Níveis em dB por bloco/banda: 'pre' (como chegou, com trim+fader, igual ao detetor de masking) ou 'post' (medido). */
  I.levels = function (st, s, mode) {
    const key = mode + ':' + s.id;
    st._lvCache = st._lvCache || {};
    const c = st._lvCache[key];
    const sig = mode === 'post' ? (st.post && st.post.at) : s.p.trim + s.p.fader;
    if (c && c.sig === sig) return c.L;
    const f = s.features, nb = f.bandFrames, L = new Float32Array(nb * 31);
    if (mode === 'post') { const P = st.post && st.post.bands[s.id]; if (!P) return null; for (let i = 0; i < nb * 31; i++) L[i] = 10 * Math.log10(P[i] + 1e-14); }
    else if (mode === 'raw') { for (let i = 0; i < nb * 31; i++) L[i] = 10 * Math.log10(f.bandTL[i] + 1e-14); }
    else { const o = s.p.trim + s.p.fader; for (let i = 0; i < nb * 31; i++) L[i] = 10 * Math.log10(f.bandTL[i] + 1e-14) + o; }
    st._lvCache[key] = { sig, L };
    return L;
  };
  I.blockSec = (st) => { const s = stemsOf(st)[0]; return s ? s.features.bandBlockSec : 0.1; };
  /** Blocos de uma secção (ou todos). */
  I.blockRange = function (st, secIdx, nb) {
    if (secIdx === null || secIdx === undefined || secIdx < 0) return [0, nb];
    const s = st.music.sections[secIdx]; if (!s) return [0, nb];
    const bs = I.blockSec(st);
    return [Math.max(0, Math.floor(s.start / bs)), Math.min(nb, Math.ceil(s.end / bs))];
  };
  /** Média de energia por banda num intervalo de blocos, em dB. */
  I.meanBands = function (L, nb, b0, b1) {
    const m = new Float64Array(31); let k = 0;
    for (let t = b0; t < Math.min(b1, nb); t++, k++) for (let b = 0; b < 31; b++) m[b] += Math.pow(10, L[t * 31 + b] / 10);
    return Array.from(m, (v) => 10 * Math.log10(v / Math.max(1, k) + 1e-14));
  };

  // ---------- masking no tempo ----------
  const hpfBand = (s) => (s.p.hpf.on ? D.THIRD_OCT.findIndex((f) => f > s.p.hpf.freq * 1.2) : 0);
  /**
   * Repete o detetor de masking (MM.analyzeMasking) para um par, devolvendo a sobreposição global,
   * por secção e uma série por bloco (1 = conflito nesse bloco, na região do conflito).
   */
  I.maskDetail = function (st, c, mode, LBover) {
    const A = st.stems.find((x) => x.id === c.a), B = st.stems.find((x) => x.id === c.b);
    if (!A || !B || !A.features || !B.features) return null;
    const LA = I.levels(st, A, mode), LB = LBover || I.levels(st, B, mode);
    if (!LA || !LB) return null;
    const nb = Math.min(A.features.bandFrames, B.features.bandFrames);
    const mean = new Float64Array(31);
    for (let t = 0; t < A.features.bandFrames; t++) for (let k = 0; k < 31; k++) mean[k] += Math.pow(10, LA[t * 31 + k] / 10);
    const mdb = Array.from(mean, (v) => 10 * Math.log10(v / A.features.bandFrames + 1e-14));
    const mmax = Math.max(...mdb);
    const hA = mode === 'post' ? 0 : hpfBand(A), hB = mode === 'post' ? 0 : hpfBand(B);
    const imp = mdb.map((v, k) => v > mmax - 12 && k >= hA);
    const actThr = mmax - 20;
    const k0 = Math.max(1, c.band - 1), k1 = Math.min(29, c.band + 1);
    const act = new Uint8Array(nb), hit = new Float32Array(nb);
    for (let t = 0; t < nb; t++) {
      let aOn = false;
      for (let k = 0; k < 31; k++) if (imp[k] && LA[t * 31 + k] > actThr) { aOn = true; break; }
      if (!aOn) continue;
      act[t] = 1;
      let v = 0;
      for (let k = Math.max(k0 - 1, hB); k <= Math.min(30, k1 + 1); k++) {
        if (!imp[k]) continue;
        const a = LA[t * 31 + k], b = LB[t * 31 + k];
        if (a > actThr && b > a - 4) v += k === c.band ? 1.5 : Math.abs(k - c.band) === 1 ? 1 : 0;
      }
      hit[t] = v / 3.5;
    }
    const frac = (b0, b1) => { let a = 0, h = 0; for (let t = b0; t < Math.min(b1, nb); t++) if (act[t]) { a++; h += hit[t]; } return { active: a, frac: a ? h / a : 0 }; };
    const all = frac(0, nb);
    const perSec = (st.music.sections || []).map((s, i) => { const [b0, b1] = I.blockRange(st, i, nb); const r = frac(b0, b1); return { i, name: MM.sections ? MM.sections.label(st, i) : s.name, start: s.start, end: s.end, frac: r.frac, active: r.active }; });
    return { overlap: all.frac, active: all.active, perSec, hit, act, nb };
  };

  /** Variação do stem B na banda do conflito enquanto A toca: medida (EQ estático + dinâmico + dinâmica), sem o trim/fader. */
  I.bandCut = function (st, c) {
    const A = st.stems.find((x) => x.id === c.a), B = st.stems.find((x) => x.id === c.b);
    if (!A || !B || !st.post || !st.post.bands[B.id]) return null;
    const LA = I.levels(st, A, 'raw'), RB = I.levels(st, B, 'raw'), PB = I.levels(st, B, 'post');
    const nb = Math.min(A.features.bandFrames, B.features.bandFrames), k = c.band;
    let mxA = -200; for (let t = 0; t < nb; t++) mxA = Math.max(mxA, LA[t * 31 + k]);
    let sp = 0, sr = 0, n = 0;
    for (let t = 0; t < nb; t++) {
      if (LA[t * 31 + k] < mxA - 20 || RB[t * 31 + k] < -80) continue;
      sp += Math.pow(10, PB[t * 31 + k] / 10); sr += Math.pow(10, RB[t * 31 + k] / 10); n++;
    }
    return n >= 5 ? 10 * Math.log10(sp / sr) - (B.p.trim + B.p.fader) : null;
  };

  /**
   * Prevê a sobreposição depois de uma correção (sem render): aplica aos níveis do stem B o corte do EQ dinâmico
   * (ou do sidechain de graves) com a mesma lei do processador — proporcional ao nível do protagonista na banda.
   */
  I.simulateMask = function (st, c, amount) {
    const A = st.stems.find((x) => x.id === c.a), B = st.stems.find((x) => x.id === c.b);
    if (!A || !B) return null;
    const LA = I.levels(st, A, 'pre'), LB0 = I.levels(st, B, 'pre');
    const nb = Math.min(A.features.bandFrames, B.features.bandFrames), LB = Float32Array.from(LB0);
    const duck = c.kind === 'duck';
    const kc = duck ? D.THIRD_OCT.findIndex((f) => f >= 63) : c.band;
    const ks = duck ? D.THIRD_OCT.map((f, k) => (f <= 160 ? k : -1)).filter((k) => k >= 0) : [c.band - 2, c.band - 1, c.band, c.band + 1, c.band + 2].filter((k) => k >= 0 && k < 31);
    const w = (k) => (duck ? (D.THIRD_OCT[k] <= 100 ? 1 : D.THIRD_OCT[k] <= 125 ? 0.7 : 0.3) : [1, 0.7, 0.3][Math.abs(k - c.band)]);
    const lvA = []; for (let t = 0; t < nb; t++) lvA.push(LA[t * 31 + kc]);
    const mx = D.percentile(lvA, 0.97);
    for (let t = 0; t < nb; t++) {
      const act = D.clamp((lvA[t] - (mx - 22)) / 10, 0, 1);
      if (act <= 0) continue;
      for (const k of ks) LB[t * 31 + k] -= amount * act * w(k);
    }
    const r = I.maskDetail(st, c, 'pre', LB);
    return r ? r.overlap : null;
  };

  // ---------- fase entre stems ----------
  const FAM = (s) => (MM.ROLES[s.role] || {}).fam;
  /** Pares em que a fase importa: kick×baixo (graves), camadas da mesma família, pares L/R, DI+amp. */
  I.phasePairs = function (st) {
    const S = stemsOf(st), out = [];
    const seen = new Set();
    const add = (a, b, band, why) => { const k = [a.id, b.id].sort().join(':'); if (seen.has(k)) return; seen.add(k); out.push({ a, b, band, why }); };
    S.forEach((a) => S.forEach((b) => {
      if (a === b) return;
      if (FAM(a) === 'kick' && FAM(b) === 'bass') add(a, b, 'low', 'kick × baixo');
      if (a.pair && a.pair === b.id && a.pairSide === 'L') add(a, b, 'wide', 'par L/R');
      if (a.id < b.id && FAM(a) === FAM(b) && ['kick', 'snare', 'bass', 'guitar', 'loop'].includes(FAM(a)) && !(a.pair && a.pair === b.id)) add(a, b, FAM(a) === 'bass' || FAM(a) === 'kick' ? 'low' : 'wide', 'camadas ' + (FAM(a) === 'guitar' ? 'de guitarra' : FAM(a) === 'bass' ? 'de baixo' : 'de ' + (MM.ROLES[a.role].pt || a.role)));
    }));
    return out.slice(0, 10);
  };
  const filt = (x, sr, band) => {
    let y = x;
    const lp = (f) => { const c = D.biquad('lowpass', f, 0.7071, 0, sr); y = D.filter(D.filter(y, c), c); };
    const hp = (f) => { const c = D.biquad('highpass', f, 0.7071, 0, sr); y = D.filter(D.filter(y, c), c); };
    if (band === 'low') lp(150); else { hp(60); lp(4000); }
    return y;
  };
  /**
   * Correlação normalizada r(L) entre A e B (B avançado L amostras), só nos trechos em que ambos tocam
   * na banda relevante (escolhidos pelas energias por bloco da análise inicial — até ~22 s).
   */
  I.phaseRaw = function (st, pr) {
    st._phase = st._phase || {};
    const key = pr.a.id + ':' + pr.b.id + ':' + pr.band;
    if (st._phase[key] !== undefined) return st._phase[key];
    const sr = st.sampleRate, A = pr.a, B = pr.b;
    const ks = D.THIRD_OCT.map((f, k) => ((pr.band === 'low' ? f >= 30 && f <= 150 : f >= 80 && f <= 4000) ? k : -1)).filter((k) => k >= 0);
    const nb = Math.min(A.features.bandFrames, B.features.bandFrames), bs = A.features.bandBlockSec;
    const en = (s) => { const e = new Float64Array(nb); for (let t = 0; t < nb; t++) for (const k of ks) e[t] += s.features.bandTL[t * 31 + k]; return e; };
    const ea = en(A), eb = en(B);
    const ma = Math.max(...ea) || 1e-12, mb = Math.max(...eb) || 1e-12;
    const both = [];
    for (let t = 1; t < nb - 1; t++) { const r = Math.min(ea[t] / ma, eb[t] / mb); if (r > 0.003) both.push([r, t]); }
    both.sort((x, y) => y[0] - x[0]);
    const pick = both.slice(0, Math.round(22 / bs)).map((x) => x[1]).sort((x, y) => x - y);
    if (pick.length < 6) return (st._phase[key] = null);
    const segs = [];
    pick.forEach((t) => { const l = segs[segs.length - 1]; if (l && l[1] >= t) l[1] = t + 1; else segs.push([t, t + 1]); });
    const dec = pr.band === 'low' ? Math.max(1, Math.round(sr / 6000)) : Math.max(1, Math.round(sr / 12000));
    const fs = sr / dec, M = Math.ceil(0.008 * fs), pre = Math.round(sr * 0.06);
    const mA = D.mono(A.chs), mB = D.mono(B.chs);
    const r = new Float64Array(2 * M + 1);
    let saa = 0, sbb = 0;
    segs.forEach(([t0, t1]) => {
      const i0 = Math.max(0, Math.floor(t0 * bs * sr) - pre), i1 = Math.min(mA.length, mB.length, Math.ceil(t1 * bs * sr));
      if (i1 - i0 < pre * 2) return;
      const fa = filt(mA.subarray(i0, i1), sr, pr.band), fb = filt(mB.subarray(i0, i1), sr, pr.band);
      const da = [], db = [];
      for (let i = pre; i < fa.length; i += dec) { da.push(fa[i]); db.push(fb[i]); }
      const n = da.length;
      if (n < 2 * M + 10) return;
      for (let i = M; i < n - M; i++) { saa += da[i] * da[i]; sbb += db[i] * db[i]; }
      for (let L = -M; L <= M; L++) { let sm = 0; for (let i = M; i < n - M; i++) sm += da[i] * db[i + L]; r[L + M] += sm; }
    });
    const nrm = Math.sqrt(saa * sbb);
    if (!(nrm > 1e-12)) return (st._phase[key] = null);
    for (let k = 0; k < r.length; k++) r[k] /= nrm;
    return (st._phase[key] = { r, M, fs, seconds: pick.length * bs });
  };
  /** Resultado com a polaridade/alinhamento atuais aplicados. */
  I.phaseEval = function (st, pr) {
    const raw = I.phaseRaw(st, pr);
    if (!raw) return null;
    const { r, M, fs } = raw;
    const sgn = (pr.a.p.polarity ? -1 : 1) * (pr.b.p.polarity ? -1 : 1);
    const shift = Math.round((((+pr.a.p.align || 0) - (+pr.b.p.align || 0)) / 1000) * fs);
    const at = (L) => { const k = L + shift + M; return k >= 0 && k < r.length ? sgn * r[k] : 0; };
    const Mv = Math.ceil(0.005 * fs);
    let best = -Infinity, bl = 0, worst = Infinity;
    for (let L = -Mv; L <= Mv; L++) { const v = at(L); if (v > best) { best = v; bl = L; } if (v < worst) worst = v; }
    // interpolação parabólica do pico
    const y0 = at(bl - 1), y1 = at(bl), y2 = at(bl + 1), den = y0 - 2 * y1 + y2;
    const frac = Math.abs(den) > 1e-9 ? D.clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
    const lagMs = ((bl + frac) / fs) * 1000;
    const r0 = at(0);
    let verdict = 'ok', fix = null;
    if (r0 < -0.2 && worst <= r0 + 0.05) { verdict = 'polarity'; fix = { type: 'polarity', stem: pr.b.id }; }
    else if (best > 0.25 && Math.abs(lagMs) >= 0.1 && best - r0 > 0.08) {
      verdict = 'align';
      const rawLag = lagMs + (((+pr.a.p.align || 0) - (+pr.b.p.align || 0)));
      fix = rawLag >= 0 ? { type: 'align', a: +rawLag.toFixed(2), b: 0 } : { type: 'align', a: 0, b: +(-rawLag).toFixed(2) };
    }
    // ganho/perda na soma por causa da relação de fase (aprox. para dois sinais de nível igual)
    const sumDb = 10 * Math.log10(Math.max(1e-3, 1 + r0));
    return { r0, best, lagMs, worst, verdict, fix, sumDb, seconds: raw.seconds };
  };

  /** Compatibilidade mono de um stem estéreo: perda de nível na soma (L+R)/2 face à média de L e R. */
  I.monoLoss = function (s) {
    if (s._mono !== undefined) return s._mono;
    if (s.chs.length < 2) return (s._mono = 0);
    const L = s.chs[0], R = s.chs[1];
    let sm = 0, sp = 0;
    for (let i = 0; i < L.length; i += 3) { const m = (L[i] + R[i]) * 0.5; sm += m * m; sp += (L[i] * L[i] + R[i] * R[i]) * 0.5; }
    return (s._mono = sp > 1e-12 ? 10 * Math.log10(Math.max(1e-6, sm / sp)) : 0);
  };

  // ---------- tonalidade vs estilo / referência ----------
  const THIRD = D.THIRD_OCT.filter((f) => f >= 25 && f <= 16000);
  I.THIRD = THIRD;
  /** Curva em 1/3 de oitava normalizada à média 100 Hz–4 kHz (mesmo método do treino de estilos). */
  I.curveOf = function (spec) {
    if (!spec || !spec.freqs) return null;
    const pts = spec.freqs.map((f, i) => [Math.log2(f), spec.db[i]]);
    const c = THIRD.map((f) => D.curveAt(pts, Math.log2(f)));
    const ref = D.mean(c.filter((_, i) => THIRD[i] >= 100 && THIRD[i] <= 4000));
    return c.map((v) => v - ref);
  };
  const regionName = (f0, f1) => `${D.fmtHz(f0)}–${D.fmtHz(f1)}`;
  /** Zonas contíguas onde a curva se afasta do alvo mais do que a tolerância (sd do estilo ou 1 dB). */
  I.deviations = function (mine, target, sd) {
    const out = [];
    let cur = null;
    for (let i = 0; i < THIRD.length; i++) {
      const d = mine[i] - target[i], tol = Math.max(1, sd ? sd[i] * 1.0 : 1.2);
      const sign = Math.abs(d) > tol ? Math.sign(d) : 0;
      if (sign && cur && cur.sign === sign) { cur.i1 = i; cur.sum += d; cur.n++; }
      else { if (cur) out.push(cur); cur = sign ? { sign, i0: i, i1: i, sum: d, n: 1 } : null; }
    }
    if (cur) out.push(cur);
    return out.map((r) => ({ f0: THIRD[r.i0] / Math.pow(2, 1 / 6), f1: THIRD[r.i1] * Math.pow(2, 1 / 6), db: r.sum / r.n, n: r.n, label: regionName(THIRD[r.i0] / Math.pow(2, 1 / 6), THIRD[r.i1] * Math.pow(2, 1 / 6)) }))
      .sort((a, b) => Math.abs(b.db) * Math.sqrt(b.n) - Math.abs(a.db) * Math.sqrt(a.n));
  };
  I.tone = function (st, which) {
    const m = which === 'mix' ? st.metrics.mix : st.metrics.master || st.metrics.mix;
    const mine = m ? I.curveOf(m.spectrum) : null;
    if (!mine) return null;
    const prof = MM.styles && MM.styles.profile ? MM.styles.profile(st.music && st.music.genre) : null;
    const style = prof && prof.curve31 && prof.n >= 1 ? { name: st.music.genre, curve: prof.curve31, sd: prof.curve31sd, n: prof.n } : null;
    const r = st.refs.find((x) => x.id === st.activeRef) || st.refs[0];
    const ref = r && r.metrics && r.metrics.spectrum ? { name: r.name, curve: I.curveOf(r.metrics.spectrum) } : null;
    return { freqs: THIRD, mine, style, ref, devStyle: style ? I.deviations(mine, style.curve, style.sd) : [], devRef: ref ? I.deviations(mine, ref.curve, null) : [] };
  };
})();
