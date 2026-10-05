/* MixMind — núcleo DSP (offline, em JavaScript puro)
 * FFT, filtros biquad (RBJ), ponderação K (ITU-R BS.1770-4), loudness (LUFS-I/S/M, LRA),
 * true peak (sobreamostragem 4x), correlação, largura estéreo e utilitários.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  MM.VERSION = '1.2';
  const D = (MM.dsp = {});

  // ---------- utilitários ----------
  D.db2lin = (db) => Math.pow(10, db / 20);
  D.lin2db = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);
  D.pow2db = (p) => (p > 1e-24 ? 10 * Math.log10(p) : -240);
  D.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  D.lerp = (a, b, t) => a + (b - a) * t;
  D.yieldUI = () => new Promise((r) => setTimeout(r, 0));
  D.median = (arr) => {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  D.percentile = (arr, p) => {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b);
    const i = D.clamp((s.length - 1) * p, 0, s.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  D.mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // canais de um AudioBuffer (ou objeto {channels, sampleRate})
  D.channelsOf = (buf) => {
    if (buf.channels) return buf.channels;
    const out = [];
    for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c));
    return out;
  };
  D.mono = (chs) => {
    if (chs.length === 1) return chs[0];
    const n = chs[0].length, out = new Float32Array(n), k = 1 / chs.length;
    for (let c = 0; c < chs.length; c++) {
      const x = chs[c];
      for (let i = 0; i < n; i++) out[i] += x[i] * k;
    }
    return out;
  };

  // ---------- FFT (radix-2, complexa, in-place) ----------
  const fftCache = {};
  function fftTables(n) {
    if (fftCache[n]) return fftCache[n];
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    const win = new Float64Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return (fftCache[n] = { rev, cos, sin, win });
  }
  D.fft = function (re, im) {
    const n = re.length, t = fftTables(n);
    for (let i = 0; i < n; i++) {
      const j = t.rev[i];
      if (j > i) {
        let x = re[i]; re[i] = re[j]; re[j] = x;
        x = im[i]; im[i] = im[j]; im[j] = x;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * t.cos[k] - im[b] * t.sin[k];
          const ti = re[b] * t.sin[k] + im[b] * t.cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };
  D.hann = (n) => fftTables(n).win;

  // espectro de potência de uma janela (retorna Float64Array n/2+1)
  D.powerSpectrum = function (x, start, n, out) {
    const t = fftTables(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = start + i;
      re[i] = (s >= 0 && s < x.length ? x[s] : 0) * t.win[i];
    }
    D.fft(re, im);
    const m = out || new Float64Array(n / 2 + 1);
    const norm = 4 / (n * n);
    for (let i = 0; i <= n / 2; i++) m[i] = (re[i] * re[i] + im[i] * im[i]) * norm;
    return m;
  };

  /** STFT assíncrona: chama onFrame(power, frameIdx, timeSec) para cada janela. */
  D.stft = async function (x, sr, size, hop, onFrame, onProgress) {
    const frames = Math.max(1, Math.floor((x.length - size) / hop) + 1);
    const buf = new Float64Array(size / 2 + 1);
    let last = performance.now();
    for (let f = 0; f < frames; f++) {
      D.powerSpectrum(x, f * hop, size, buf);
      onFrame(buf, f, (f * hop + size / 2) / sr);
      if (performance.now() - last > 30) {
        if (onProgress) onProgress(f / frames);
        await D.yieldUI();
        last = performance.now();
      }
    }
    return frames;
  };

  // ---------- bandas ----------
  // 31 bandas de terço de oitava (20 Hz – 20 kHz)
  D.THIRD_OCT = (() => {
    const c = [];
    for (let i = -17; i <= 13; i++) c.push(1000 * Math.pow(2, i / 3));
    return c;
  })();
  D.BANDS7 = [
    { id: 'sub', name: 'Sub', lo: 20, hi: 60 },
    { id: 'low', name: 'Graves', lo: 60, hi: 200 },
    { id: 'lowmid', name: 'Médios-graves', lo: 200, hi: 500 },
    { id: 'mid', name: 'Médios', lo: 500, hi: 2000 },
    { id: 'pres', name: 'Presença', lo: 2000, hi: 5000 },
    { id: 'bright', name: 'Brilho', lo: 5000, hi: 10000 },
    { id: 'air', name: 'Ar', lo: 10000, hi: 20000 },
  ];
  /** Índices de bins para cada banda (cache por n/sr). */
  const bandIdxCache = {};
  D.bandBins = function (n, sr, edges) {
    const key = n + ':' + sr + ':' + edges.length + ':' + edges[0];
    if (bandIdxCache[key]) return bandIdxCache[key];
    const binHz = sr / n;
    const out = edges.map(([lo, hi]) => [Math.max(1, Math.round(lo / binHz)), Math.min(n / 2, Math.max(Math.round(lo / binHz) + 1, Math.round(hi / binHz)))]);
    return (bandIdxCache[key] = out);
  };
  D.thirdOctEdges = D.THIRD_OCT.map((f) => [f / Math.pow(2, 1 / 6), f * Math.pow(2, 1 / 6)]);
  D.bands7Edges = D.BANDS7.map((b) => [b.lo, b.hi]);
  D.sumBands = function (pow, bins, out) {
    for (let b = 0; b < bins.length; b++) {
      let s = 0;
      for (let k = bins[b][0]; k < bins[b][1]; k++) s += pow[k];
      out[b] = s;
    }
    return out;
  };

  // ---------- biquad (RBJ) ----------
  D.biquad = function (type, f, q, gainDb, fs) {
    const A = Math.pow(10, (gainDb || 0) / 40);
    const w0 = (2 * Math.PI * D.clamp(f, 5, fs * 0.49)) / fs;
    const cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * (q || 0.7071));
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; }
    else if (type === 'peaking') { b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; }
    else if (type === 'lowshelf') {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
    } else if (type === 'highshelf') {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
    } else { b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0; }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  };
  /** Filtra (devolve novo array). */
  D.filter = function (x, c) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
    }
    return y;
  };
  /** Resposta em magnitude (dB) de um biquad numa frequência. */
  D.biquadMagDb = function (c, f, fs) {
    const w = (2 * Math.PI * f) / fs;
    const cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
    const nr = c.b0 + c.b1 * cr + c.b2 * c2r, ni = c.b1 * ci + c.b2 * c2i;
    const dr = 1 + c.a1 * cr + c.a2 * c2r, di = c.a1 * ci + c.a2 * c2i;
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-30);
  };

  // ---------- ponderação K (BS.1770) ----------
  D.kWeightCoefs = function (fs) {
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan((Math.PI * f0) / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const s1 = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan((Math.PI * f0) / fs);
    a0 = 1 + K / Q + K * K;
    const s2 = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [s1, s2];
  };

  /**
   * Loudness completo de um sinal (LUFS-I, máx. momentary/short-term, LRA, séries).
   */
  D.loudness = function (chs, sr) {
    const [s1, s2] = D.kWeightCoefs(sr);
    const blk = Math.round(sr * 0.1);
    const nBlocks = Math.floor(chs[0].length / blk);
    const ms = new Float64Array(nBlocks);
    const nCh = Math.min(chs.length, 2);
    for (let c = 0; c < nCh; c++) {
      const x = chs[c];
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
      for (let b = 0; b < nBlocks; b++) {
        let acc = 0;
        const end = (b + 1) * blk;
        for (let i = b * blk; i < end; i++) {
          const xi = x[i];
          const y = s1.b0 * xi + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
          x2 = x1; x1 = xi;
          const z = y - 2 * y1 + y2 - s2.a1 * z1 - s2.a2 * z2;
          y2 = y1; y1 = y; z2 = z1; z1 = z;
          acc += z * z;
        }
        ms[b] += acc / blk;
      }
    }
    // mono: BS.1770 trata mono como um canal; somamos 3 dB? Não — mono reproduzido em dois altifalantes
    // costuma ser medido como canal duplicado. Para coerência com stems mono, duplicamos.
    if (nCh === 1) for (let b = 0; b < nBlocks; b++) ms[b] *= 2;
    const L = (p) => -0.691 + 10 * Math.log10(p + 1e-20);
    // janelas de 400 ms (momentary), passo 100 ms
    const mom = [];
    for (let b = 3; b < nBlocks; b++) mom.push((ms[b] + ms[b - 1] + ms[b - 2] + ms[b - 3]) / 4);
    // integrado com gating
    let gated = mom.filter((p) => L(p) > -70);
    let integrated = -70;
    if (gated.length) {
      const absMean = D.mean(gated);
      const rel = L(absMean) - 10;
      const g2 = gated.filter((p) => L(p) > rel);
      if (g2.length) integrated = L(D.mean(g2));
    }
    // short-term 3 s, passo 100 ms
    const st = [];
    let acc = 0;
    for (let b = 0; b < nBlocks; b++) {
      acc += ms[b];
      if (b >= 30) acc -= ms[b - 30];
      if (b >= 29) st.push(acc / 30);
    }
    const stL = st.map(L);
    let lra = 0;
    const stg = st.filter((p) => L(p) > -70);
    if (stg.length > 2) {
      const rel = L(D.mean(stg)) - 20;
      const vals = stg.map(L).filter((v) => v > rel);
      if (vals.length > 2) lra = D.percentile(vals, 0.95) - D.percentile(vals, 0.1);
    }
    const momL = mom.map(L);
    return {
      integrated,
      momentaryMax: momL.length ? Math.max(...momL) : -70,
      shortTermMax: stL.length ? Math.max(...stL) : -70,
      lra,
      short: stL.filter((_, i) => i % 10 === 0), // por segundo
      mom: momL,
      blockMs: Array.from(ms),
    };
  };

  /** Loudness por intervalo (s) a partir dos blocos de 100 ms. */
  D.loudnessRange = function (blockMs, t0, t1) {
    const a = Math.max(0, Math.floor(t0 * 10)), b = Math.min(blockMs.length, Math.ceil(t1 * 10));
    const v = [];
    for (let i = a; i < b; i++) if (blockMs[i] > 1e-9) v.push(blockMs[i]);
    if (!v.length) return -70;
    return -0.691 + 10 * Math.log10(D.mean(v));
  };

  // ---------- picos ----------
  D.samplePeak = function (chs) {
    let p = 0;
    for (const x of chs) for (let i = 0; i < x.length; i++) { const a = x[i] < 0 ? -x[i] : x[i]; if (a > p) p = a; }
    return p;
  };
  // filtro de interpolação 4x (sinc com janela de Kaiser β=8, 96 taps, 4 fases) — validado contra o ebur128 do ffmpeg
  const TP = (() => {
    const L = 4, taps = 96, h = new Float64Array(taps);
    const beta = 8, I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
    for (let i = 0; i < taps; i++) {
      const n = i - (taps - 1) / 2;
      const sinc = n === 0 ? 1 : Math.sin((Math.PI * n) / L) / ((Math.PI * n) / L);
      const w = I0(beta * Math.sqrt(Math.max(0, 1 - ((2 * i) / (taps - 1) - 1) ** 2))) / I0(beta);
      h[i] = sinc * w;
    }
    const phases = [];
    for (let p = 0; p < L; p++) {
      const ph = [];
      for (let k = p; k < taps; k += L) ph.push(h[k]);
      phases.push(Float64Array.from(ph));
    }
    return { phases, len: taps / L };
  })();
  /** True peak (linear) com sobreamostragem 4x. Só interpola perto dos picos (tendo em conta o atraso do filtro). */
  D.truePeak = function (chs) {
    const sp = D.samplePeak(chs);
    if (sp < 1e-9) return 0;
    let tp = sp, thr = sp / 1.5; // um pico inter-amostra não excede ~3,5 dB acima das amostras vizinhas
    const { phases, len } = TP, half = len >> 1;
    for (const x of chs) {
      for (let i = len; i < x.length; i++) {
        const c = i - half;
        const a = Math.max(Math.abs(x[c]), Math.abs(x[c - 1]), Math.abs(x[c + 1]));
        if (a < thr) continue;
        thr = tp / 1.5;
        for (let p = 0; p < 4; p++) {
          const ph = phases[p];
          let s = 0;
          for (let k = 0; k < len; k++) s += ph[k] * x[i - k];
          const v = s < 0 ? -s : s;
          if (v > tp) tp = v;
        }
      }
    }
    return tp;
  };
  D.rms = function (chs) {
    let s = 0, n = 0;
    for (const x of chs) { for (let i = 0; i < x.length; i++) s += x[i] * x[i]; n += x.length; }
    return Math.sqrt(s / Math.max(1, n));
  };
  D.dcOffset = function (chs) {
    let m = 0;
    for (const x of chs) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; m = Math.max(m, Math.abs(s / x.length)); }
    return m;
  };
  D.correlation = function (L, R, from, to) {
    from = from || 0; to = to || L.length;
    let lr = 0, ll = 0, rr = 0;
    for (let i = from; i < to; i++) { lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i]; }
    return ll * rr > 1e-20 ? lr / Math.sqrt(ll * rr) : 1;
  };
  /** Correlação mínima (janelas de 'win' segundos) — útil para detetar colapsos em mono. */
  D.correlationSeries = function (L, R, sr, win) {
    const n = Math.round(sr * (win || 1)), out = [];
    for (let i = 0; i + n <= L.length; i += n) {
      let ll = 0, rr = 0;
      for (let k = i; k < i + n; k++) { ll += L[k] * L[k]; rr += R[k] * R[k]; }
      if (ll + rr < 1e-6 * n) continue;
      out.push(D.correlation(L, R, i, i + n));
    }
    return out;
  };
  /** Largura estéreo: energia lateral / energia média (0 = mono). */
  D.width = function (L, R) {
    let m = 0, s = 0;
    for (let i = 0; i < L.length; i++) { const a = (L[i] + R[i]) / 2, b = (L[i] - R[i]) / 2; m += a * a; s += b * b; }
    return m > 1e-20 ? Math.sqrt(s / m) : 0;
  };

  /** Espectro médio (potência) com N pontos log entre 20 Hz e 20 kHz, em dB, normalizado ao loudness. */
  D.avgSpectrum = async function (x, sr, points, opts) {
    opts = opts || {};
    const n = opts.size || 4096, hop = opts.hop || 4096;
    const acc = new Float64Array(n / 2 + 1);
    let frames = 0;
    await D.stft(x, sr, n, hop, (p) => {
      let e = 0;
      for (let k = 0; k < p.length; k++) e += p[k];
      if (e < 1e-10) return;
      for (let k = 0; k < p.length; k++) acc[k] += p[k];
      frames++;
    });
    points = points || 96;
    const out = new Float64Array(points), freqs = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      const f = 20 * Math.pow(1000, i / (points - 1));
      freqs[i] = f;
      const lo = f / Math.pow(2, 1 / 12), hi = f * Math.pow(2, 1 / 12);
      const a = Math.max(1, Math.floor((lo * n) / sr)), b = Math.max(a + 1, Math.ceil((hi * n) / sr));
      let s = 0;
      for (let k = a; k < Math.min(b, acc.length); k++) s += acc[k];
      out[i] = D.pow2db(s / Math.max(1, frames));
    }
    return { db: Array.from(out), freqs: Array.from(freqs) };
  };

  /** Interpolação linear de uma curva [[t,v],...] num tempo t. */
  D.curveAt = function (pts, t) {
    if (!pts.length) return 0;
    if (t <= pts[0][0]) return pts[0][1];
    if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m; else hi = m; }
    const [t0, v0] = pts[lo], [t1, v1] = pts[hi];
    return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-9, t1 - t0);
  };

  /** Seguidor de envolvente simples (abs, ataque/release em ms) reamostrado a 'rate' Hz. */
  D.envelope = function (x, sr, atkMs, relMs, rate) {
    const a = Math.exp(-1 / ((atkMs / 1000) * sr)), r = Math.exp(-1 / ((relMs / 1000) * sr));
    const step = Math.round(sr / rate), out = new Float32Array(Math.ceil(x.length / step));
    let e = 0, mx = 0, j = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] < 0 ? -x[i] : x[i];
      e = v > e ? a * e + (1 - a) * v : r * e + (1 - r) * v;
      if (e > mx) mx = e;
      if ((i + 1) % step === 0) { out[j++] = mx; mx = 0; }
    }
    return out;
  };
  D.fmtDb = (v, d = 1) => (v <= -99 ? '−∞' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d)).replace('.', ',');
  D.fmtNum = (v, d = 1) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ',');
  D.fmtTime = (s) => {
    s = Math.max(0, s);
    const m = Math.floor(s / 60), r = s - m * 60;
    return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0');
  };
  D.fmtHz = (f) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace('.', ',') + ' kHz' : Math.round(f) + ' Hz');
})();
