/* MIXMIND — núcleo DSP (offline, em JavaScript puro)
 * FFT, filtros biquad (RBJ), ponderação K (ITU-R BS.1770-4), loudness (LUFS-I/S/M, LRA),
 * true peak (sobreamostragem 4x), correlação, largura estéreo e utilitários.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  MM.VERSION = '1.6';
  const D = (MM.dsp = {});

  // ---------- utilitários ----------
  D.db2lin = (db) => Math.pow(10, db / 20);
  D.lin2db = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);
  D.pow2db = (p) => (p > 1e-24 ? 10 * Math.log10(p) : -240);
  D.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  D.lerp = (a, b, t) => a + (b - a) * t;
  D.yieldUI = () => new Promise((r) => setTimeout(r, 0));
  /** Núcleos WebAssembly (js/core/wasm.js), quando disponíveis; null → versão JavaScript. */
  const WA = () => (MM.wasm && MM.wasm.ready && !MM.WASM_OFF ? MM.wasm : null);
  D.wasmOn = () => !!WA();
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
    const w = WA();
    if (w && size >= 64 && x.length > size) {
      // WebAssembly: FFT real (n/2 complexa), canal copiado uma vez para a memória do módulo
      const T = w.fftTables(size, fftTables(size).win);
      const xa = w.put(x), wk = w.alloc(size * 8), oa = w.alloc((size / 2 + 1) * 8);
      try {
        let last = performance.now();
        for (let f = 0; f < frames; f++) {
          w.x.pspec(xa.ptr, x.length, f * hop, size, T.win.ptr, T.tw.ptr, T.rev.ptr, wk.ptr, oa.ptr);
          onFrame(w.f64(oa.ptr, size / 2 + 1), f, (f * hop + size / 2) / sr);
          if (performance.now() - last > 30) {
            if (onProgress) onProgress(f / frames);
            await D.yieldUI();
            last = performance.now();
          }
        }
      } finally { w.free(xa); w.free(wk); w.free(oa); }
      return frames;
    }
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
  /**
   * Biquad "matched" (Vicanek, 2016): polos por invariância ao impulso e zeros escolhidos para que a magnitude digital
   * coincida com a analógica em 0 Hz, em Nyquist e na frequência central. Ao contrário da transformação bilinear (RBJ),
   * não "aperta" as curvas perto de Nyquist — um shelf de agudos a 12–16 kHz soa como o pedido também a 44,1 kHz.
   * Tipos: peaking, lowshelf, highshelf (shelves com S = 1, como no Web Audio).
   */
  D.analogMag = function (type, f0, q, gainDb, f) {
    const A = Math.pow(10, (gainDb || 0) / 40), W = f / f0, sq = Math.sqrt(A);
    const ev = (n2, n1, n0, d2, d1, d0) => { const nr = n0 - n2 * W * W, ni = n1 * W, dr = d0 - d2 * W * W, di = d1 * W; return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)); };
    if (type === 'peaking') return ev(1, A / q, 1, 1, 1 / (A * q), 1);
    if (type === 'lowshelf') return A * ev(1, sq / q, A, A, sq / q, 1);
    if (type === 'highshelf') return A * ev(A, sq / q, 1, 1, sq / q, A);
    return 1;
  };
  D.matched = function (type, f0, q, gainDb, fs) {
    if (!['peaking', 'lowshelf', 'highshelf'].includes(type) || Math.abs(gainDb || 0) < 1e-4) return D.biquad(type, f0, q, gainDb, fs);
    if (type !== 'peaking') q = 0.7071;
    const A = Math.pow(10, gainDb / 40), sq = Math.sqrt(A), T = 1 / fs, w0 = 2 * Math.PI * f0;
    let wp, z;
    if (type === 'peaking') { wp = w0; z = 1 / (2 * A * q); } else if (type === 'lowshelf') { wp = w0 / sq; z = 1 / (2 * q); } else { wp = w0 * sq; z = 1 / (2 * q); }
    const e = Math.exp(-z * wp * T);
    const a1 = z < 1 ? -2 * e * Math.cos(wp * T * Math.sqrt(1 - z * z)) : -2 * e * Math.cosh(wp * T * Math.sqrt(z * z - 1));
    const a2 = e * e;
    const A0 = (1 + a1 + a2) ** 2, A1 = (1 - a1 + a2) ** 2, A2 = -4 * a2;
    const phi = (w) => { const p1 = Math.sin(w / 2) ** 2, p0 = 1 - p1; return [p0, p1, 4 * p0 * p1]; };
    const G = (w) => D.analogMag(type, f0, q, gainDb, (w * fs) / (2 * Math.PI));
    const wc = Math.min((w0 * T), 0.9 * Math.PI);
    const B0 = G(0) ** 2 * A0, B1 = G(Math.PI) ** 2 * A1;
    const [c0, c1, c2] = phi(wc);
    const B2 = (G(wc) ** 2 * (A0 * c0 + A1 * c1 + A2 * c2) - B0 * c0 - B1 * c1) / c2;
    const s0 = Math.sqrt(B0), s1 = Math.sqrt(B1), Wm = (s0 + s1) / 2;
    const b0 = (Wm + Math.sqrt(Math.max(0, Wm * Wm + B2))) / 2, b1 = (s0 - s1) / 2, b2 = -B2 / (4 * b0);
    return { b0, b1, b2, a1, a2 };
  };
  /** Magnitude (linear) de um biquad digital à frequência f. */
  D.biquadMag = function (c, f, fs) {
    const w = (2 * Math.PI * f) / fs, cr = Math.cos(w), ci = -Math.sin(w), c2r = Math.cos(2 * w), c2i = -Math.sin(2 * w);
    const nr = c.b0 + c.b1 * cr + c.b2 * c2r, ni = c.b1 * ci + c.b2 * c2i, dr = 1 + c.a1 * cr + c.a2 * c2r, di = c.a1 * ci + c.a2 * c2i;
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  };
  /**
   * FIR de fase linear (N taps, latência N/2) com a magnitude dada por mag(f) (linear): amostragem em frequência,
   * fase zero, IFFT, centragem e janela de Kaiser. Sem distorção de fase; o custo é o pré-eco e a latência.
   */
  D.linearPhaseFIR = function (mag, N, fs, beta) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let k = 0; k <= N / 2; k++) { const v = mag((k * fs) / N); re[k] = v; if (k > 0 && k < N / 2) re[N - k] = v; }
    // IFFT = conj(FFT(conj(x)))/N; espectro real e simétrico → resultado real
    D.fft(re, im);
    const h = new Float32Array(N), i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
    const B = beta || 7, I0b = i0(B);
    for (let n = 0; n < N; n++) {
      const src = (n + N / 2) % N; // centrar (atraso de N/2)
      const r = (2 * n) / (N - 1) - 1;
      h[n] = (re[src] / N) * (i0(B * Math.sqrt(Math.max(0, 1 - r * r))) / I0b);
    }
    return h;
  };
  /** Filtra (devolve novo array). */
  D.filter = function (x, c) {
    const w = x.length > 8192 ? WA() : null;
    if (w) {
      const xa = w.put(x), ya = w.alloc(x.length * 4);
      w.x.biquad(xa.ptr, ya.ptr, x.length, c.b0, c.b1, c.b2, c.a1, c.a2);
      const y = new Float32Array(w.f32(ya.ptr, x.length));
      w.free(xa); w.free(ya);
      return y;
    }
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
    // (o filtro recursivo do K-weighting não ganha com wasm: a cópia custa mais do que poupa → só com MM.WASM_LOUD)
    const w = nBlocks > 4 && MM.WASM_LOUD ? WA() : null;
    for (let c = 0; c < nCh; c++) {
      const x = chs[c];
      if (w) {
        const xa = w.put(x.length === nBlocks * blk ? x : x.subarray(0, nBlocks * blk)), ma = w.alloc(nBlocks * 8);
        w.f64(ma.ptr, nBlocks).fill(0);
        w.x.kblocks(xa.ptr, blk, nBlocks, ma.ptr, s1.b0, s1.b1, s1.b2, s1.a1, s1.a2, s2.a1, s2.a2);
        const r = w.f64(ma.ptr, nBlocks); for (let b = 0; b < nBlocks; b++) ms[b] += r[b];
        w.free(xa); w.free(ma);
        continue;
      }
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

  /** True peak (linear) com sobreamostragem 4x. Só interpola perto dos picos (tendo em conta o atraso do filtro). */
  // núcleos sinc com janela de Kaiser: grosseiro (±16 amostras, 8 posições) e fino (±64 amostras, 32 posições)
  const kaiserSinc = (H, NF, beta) => {
    const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
    const I0b = i0(beta), tab = [];
    for (let f = 0; f < NF; f++) {
      const fr = f / NF, w = new Float64Array(2 * H);
      for (let k = 0; k < 2 * H; k++) { const d = fr - (k - H + 1); const sinc = Math.abs(d) < 1e-12 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d); const r = d / H; w[k] = Math.abs(r) >= 1 ? 0 : sinc * (i0(beta * Math.sqrt(1 - r * r)) / I0b); }
      tab.push(w);
    }
    return { H, NF, tab };
  };
  const TPC = kaiserSinc(16, 8, 7), TPR = kaiserSinc(64, 32, 10);
  const interpMax = (x, base, K) => { // máximo |x(t)| para t em [base, base+1), K = núcleo
    const { H, NF, tab } = K;
    if (base - H + 1 < 0 || base + H >= x.length) return 0;
    let m = 0;
    for (let f = 1; f < NF; f++) { const w = tab[f]; let s = 0; for (let k = 0, o = base - H + 1; k < 2 * H; k++) s += w[k] * x[o + k]; const v = s < 0 ? -s : s; if (v > m) m = v; }
    return m;
  };
  /**
   * True peak (linear) — o pico que um DAC ou codec reconstrói entre amostras.
   * 1) candidatos: máximos locais de |x| até 3 dB abaixo do pico de amostra (um pico inter-amostra nasce junto a eles);
   * 2) estimativa grosseira (8× sinc curto) em cada candidato; 3) os 4000 mais altos (até 1 dB abaixo) são refinados
   *    com sinc longo a 32×. Mais exato que o 4× do BS.1770, que pode subestimar até ~0,7 dB a 44,1 kHz.
   */
  const tpTab = (w, K, key) => w.table(key, () => { const flat = new Float64Array(K.NF * 2 * K.H); K.tab.forEach((r, f) => flat.set(r, f * 2 * K.H)); return w.putF64(flat); });
  function truePeakWasm(w, chs, sp) {
    const thr = sp / 1.413, tc = tpTab(w, TPC, 'tpc'), tr = tpTab(w, TPR, 'tpr');
    const co = w.alloc(8); w.f64(co.ptr, 1)[0] = sp;
    const per = [];
    for (let ci = 0; ci < chs.length; ci++) {
      const x = chs[ci], xa = w.put(x), cap = 200000, ca = w.alloc(cap * 16);
      const cnt = w.x.tpScan(xa.ptr, x.length, thr, TPC.H, TPC.NF, tc.ptr, ca.ptr, cap, co.ptr);
      per.push({ xa, ca, cnt, n: x.length });
    }
    const coarse = w.f64(co.ptr, 1)[0], lim = coarse / 1.122;
    let idx = [];
    per.forEach((p, ci) => { const c = w.f64(p.ca.ptr, p.cnt * 2); for (let j = 0; j < p.cnt; j++) if (c[2 * j] >= lim) idx.push([c[2 * j], ci, c[2 * j + 1]]); });
    if (idx.length > 4000) { idx.sort((a, b) => b[0] - a[0]); idx = idx.slice(0, 4000); }
    let tp = sp;
    for (const [, ci, c] of idx) { const v = w.x.tpRefine(per[ci].xa.ptr, per[ci].n, c, TPR.H, TPR.NF, tr.ptr); if (v > tp) tp = v; }
    per.forEach((p) => { w.free(p.xa); w.free(p.ca); }); w.free(co);
    return Math.max(tp, sp);
  }
  D.truePeak = function (chs) {
    const sp = D.samplePeak(chs);
    if (sp < 1e-9) return 0;
    const w = WA();
    if (w && chs[0].length > 64) return truePeakWasm(w, chs, sp);
    const thr = sp / 1.413;
    let coarse = sp;
    const cand = [];
    for (let ci = 0; ci < chs.length; ci++) {
      const x = chs[ci], n = x.length;
      for (let c = 1; c < n - 1; c++) {
        const a = x[c] < 0 ? -x[c] : x[c];
        if (a < thr) continue;
        const l = x[c - 1] < 0 ? -x[c - 1] : x[c - 1], r = x[c + 1] < 0 ? -x[c + 1] : x[c + 1];
        if (a < l || a < r) continue;
        const m = Math.max(a, interpMax(x, c - 1, TPC), interpMax(x, c, TPC));
        if (m > coarse) coarse = m;
        if (m >= coarse / 1.122) cand.push(m, ci, c);
      }
    }
    const lim = coarse / 1.122;
    let idx = [];
    for (let j = 0; j < cand.length; j += 3) if (cand[j] >= lim) idx.push(j);
    if (idx.length > 4000) { idx.sort((a, b) => cand[b] - cand[a]); idx = idx.slice(0, 4000); }
    let tp = Math.max(sp, coarse * 0 + sp);
    for (const j of idx) {
      const x = chs[cand[j + 1]], c = cand[j + 2];
      const v = Math.max(interpMax(x, c - 1, TPR), interpMax(x, c, TPR), Math.abs(x[c]));
      if (v > tp) tp = v;
    }
    return Math.max(tp, sp);
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
