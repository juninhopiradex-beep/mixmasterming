/* MixMind — processadores AudioWorklet (carregados via Blob URL, funcionam também em file://)
 *  mm-comp     compressor feed-forward com knee, mix paralelo e relatório de GR
 *  mm-limiter  limiter com look-ahead, deteção de true peak (Hermite 4x) e ceiling
 *  mm-trans    transient shaper (attack/sustain)
 *  mm-meter    medidor BS.1770: LUFS M/S/I, true peak, picos, correlação
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const SRC = String.raw`
const dbToLin = (d) => Math.pow(10, d / 20);
const linToDb = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

class Comp extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.quiet = !!(o && o.processorOptions && o.processorOptions.quiet);
    this.p = { thr: -18, ratio: 3, atk: 10, rel: 120, knee: 6, makeup: 0, mix: 1, bypass: false };
    this.env = 0; this.gr = 0; this.grMax = 0; this.count = 0;
    this.port.onmessage = (e) => { Object.assign(this.p, e.data); };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length, p = this.p;
    if (p.bypass || p.ratio <= 1.001) {
      for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]);
      this.report(0); return true;
    }
    const SB = 8;
    const aA = Math.exp(-SB / (p.atk * 0.001 * sampleRate)), aR = Math.exp(-SB / (p.rel * 0.001 * sampleRate));
    const slope = 1 - 1 / p.ratio, knee = Math.max(0.01, p.knee), mk = dbToLin(p.makeup), mix = p.mix;
    if (this.g === undefined) this.g = 1;
    for (let i0 = 0; i0 < n; i0 += SB) {
      const i1 = Math.min(n, i0 + SB);
      let pk = 0;
      for (let c = 0; c < inp.length; c++) { const x = inp[c]; for (let i = i0; i < i1; i++) { const v = x[i] < 0 ? -x[i] : x[i]; if (v > pk) pk = v; } }
      const over = linToDb(pk) - p.thr;
      let gr;
      if (over <= -knee / 2) gr = 0;
      else if (over >= knee / 2) gr = over * slope;
      else gr = (slope * (over + knee / 2) * (over + knee / 2)) / (2 * knee);
      this.env = gr > this.env ? aA * this.env + (1 - aA) * gr : aR * this.env + (1 - aR) * gr;
      const gT = dbToLin(-this.env) * mk, g0 = this.g, step = (gT - g0) / (i1 - i0);
      for (let c = 0; c < out.length; c++) {
        const x = inp[Math.min(c, inp.length - 1)], o = out[c];
        let g = g0;
        for (let i = i0; i < i1; i++) { g += step; o[i] = x[i] * (mix * g + (1 - mix)); }
      }
      this.g = gT;
      if (this.env > this.grMax) this.grMax = this.env;
    }
    this.report(this.grMax);
    return true;
  }
  report(v) {
    if (++this.count >= 32) { if (!this.quiet) this.port.postMessage({ gr: v }); this.count = 0; this.grMax = 0; }
  }
}
registerProcessor('mm-comp', Comp);

function hermite(y0, y1, y2, y3, t) {
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * t + c2) * t + c1) * t + y1;
}

class Limiter extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.quiet = !!(o && o.processorOptions && o.processorOptions.quiet);
    this.p = { ceiling: -1, lookahead: 4, release: 80, inGain: 0, bypass: false };
    this.port.onmessage = (e) => { Object.assign(this.p, e.data); this.setup(); };
    // interpolador 4x (FIR polifásico, 32 taps, Kaiser β=6) para deteção de true peak
    const taps = 32, h = new Float64Array(taps), I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / 2 / k) ** 2; s += t; } return s; };
    for (let i = 0; i < taps; i++) { const n = i - (taps - 1) / 2; const sn = n === 0 ? 1 : Math.sin(Math.PI * n / 4) / (Math.PI * n / 4); h[i] = sn * I0(6 * Math.sqrt(Math.max(0, 1 - ((2 * i) / (taps - 1) - 1) ** 2))) / I0(6); }
    this.ph = [1, 2, 3].map((p) => { const a = []; for (let k = p; k < taps; k += 4) a.push(h[k]); return Float64Array.from(a); });
    this.fl = 8; // taps por fase
    this.hist = [new Float64Array(8), new Float64Array(8)]; this.hi = 0;
    this.maxLA = Math.ceil(sampleRate * 0.02);
    this.delay = [new Float32Array(this.maxLA + 16), new Float32Array(this.maxLA + 16)];
    this.w = 0; this.env = 1; this.grMax = 0; this.count = 0;
    this.setup();
  }
  setup() {
    this.L = Math.max(8, Math.min(this.maxLA, Math.round(this.p.lookahead * 0.001 * sampleRate)));
    this.H = this.L + 2; // retenção ligeiramente maior que o look-ahead (latência do detetor)
    this.dqV = new Float64Array(this.L + 12); this.dqI = new Float64Array(this.L + 12); this.dqH = 0; this.dqT = 0; this.t = 0;
    this.boxBuf = new Float32Array(this.L).fill(1); this.bi = 0; this.boxSum = this.L;
    this.relC = Math.exp(-1 / (this.p.release * 0.001 * sampleRate));
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length, p = this.p, ceil = dbToLin(p.ceiling), ig = dbToLin(p.inGain);
    const nc = Math.min(2, out.length), L = this.L, D = this.delay[0].length, fl = this.fl, ph = this.ph;
    for (let i = 0; i < n; i++) {
      let pk = 0;
      const hi = this.hi;
      for (let c = 0; c < nc; c++) {
        const s = inp[Math.min(c, inp.length - 1)][i] * ig;
        const h = this.hist[c];
        h[hi] = s;
        // amostra "central" do interpolador (atraso de fl/2 amostras)
        let m = Math.abs(h[(hi - 4 + 8) & 7]);
        for (let q = 0; q < 3; q++) {
          const f = ph[q]; let acc = 0;
          for (let k = 0; k < fl; k++) acc += f[k] * h[(hi - k + 8) & 7];
          const v = acc < 0 ? -acc : acc; if (v > m) m = v;
        }
        if (m > pk) pk = m;
        this.delay[c][(this.w + L + 3) % D] = s;
      }
      this.hi = (hi + 1) & 7;
      const need = pk > ceil ? ceil / pk : 1;
      const cap = this.dqV.length, t = this.t++;
      while (this.dqT !== this.dqH && this.dqV[(this.dqT - 1 + cap) % cap] >= need) this.dqT = (this.dqT - 1 + cap) % cap;
      this.dqV[this.dqT] = need; this.dqI[this.dqT] = t; this.dqT = (this.dqT + 1) % cap;
      while (this.dqI[this.dqH] <= t - this.H) this.dqH = (this.dqH + 1) % cap;
      const mn = this.dqV[this.dqH];
      this.env = mn < this.env ? mn : this.relC * this.env + (1 - this.relC) * mn;
      this.boxSum += this.env - this.boxBuf[this.bi]; this.boxBuf[this.bi] = this.env; this.bi = (this.bi + 1) % L;
      const g = p.bypass ? 1 : Math.min(this.env, this.boxSum / L);
      const gr = -20 * Math.log10(Math.max(g, 1e-6));
      if (gr > this.grMax) this.grMax = gr;
      for (let c = 0; c < out.length; c++) {
        const d = this.delay[Math.min(c, nc - 1)][this.w % D];
        let y = d * g;
        if (!p.bypass) { if (y > ceil) y = ceil; else if (y < -ceil) y = -ceil; }
        out[c][i] = y;
      }
      this.w = (this.w + 1) % D;
    }
    if (++this.count >= 32) { if (!this.quiet) this.port.postMessage({ gr: this.grMax }); this.count = 0; this.grMax = 0; }
    return true;
  }
}
registerProcessor('mm-limiter', Limiter);

class Trans extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = { attack: 0, sustain: 0, bypass: true };
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
    this.f = 0; this.s = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length, p = this.p;
    if (p.bypass || (Math.abs(p.attack) < 0.01 && Math.abs(p.sustain) < 0.01)) {
      for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]); return true;
    }
    const fa = Math.exp(-1 / (0.0008 * sampleRate)), fr = Math.exp(-1 / (0.03 * sampleRate));
    const sa = Math.exp(-1 / (0.025 * sampleRate)), sr = Math.exp(-1 / (0.25 * sampleRate));
    const SB = 8;
    if (this.g === undefined) this.g = 1;
    for (let i0 = 0; i0 < n; i0 += SB) {
      const i1 = Math.min(n, i0 + SB);
      for (let i = i0; i < i1; i++) {
        let v = 0;
        for (let c = 0; c < inp.length; c++) { const a = inp[c][i] < 0 ? -inp[c][i] : inp[c][i]; if (a > v) v = a; }
        this.f = v > this.f ? fa * this.f + (1 - fa) * v : fr * this.f + (1 - fr) * v;
        this.s = v > this.s ? sa * this.s + (1 - sa) * v : sr * this.s + (1 - sr) * v;
      }
      const d = linToDb(this.f) - linToDb(this.s);
      let gdb = d > 0 ? p.attack * Math.min(d, 12) : p.sustain * Math.min(-d, 12);
      gdb = Math.max(-12, Math.min(12, gdb));
      const gT = dbToLin(gdb), g0 = this.g, step = (gT - g0) / (i1 - i0);
      for (let c = 0; c < out.length; c++) { const x = inp[Math.min(c, inp.length - 1)], o = out[c]; let g = g0; for (let i = i0; i < i1; i++) { g += step; o[i] = x[i] * g; } }
      this.g = gT;
    }
    return true;
  }
}
registerProcessor('mm-trans', Trans);

// EQ dinâmico: cada banda só corta quando a energia relativa da banda excede a sua média de longo prazo
class DynEq extends AudioWorkletProcessor {
  constructor(o) {
    super();
    this.quiet = !!(o && o.processorOptions && o.processorOptions.quiet);
    this.bands = [];
    this.port.onmessage = (e) => { this.setBands(e.data.bands || []); };
    this.count = 0;
  }
  setBands(list) {
    const old = this.bands;
    this.bands = list.map((b, i) => {
      const o = old[i] && old[i].freq === b.freq ? old[i] : { env: 0, full: 0, base: 0, gr: 0, z: [new Float64Array(4), new Float64Array(4)], dz: new Float64Array(4) };
      Object.assign(o, b);
      const w0 = 2 * Math.PI * b.freq / sampleRate, al = Math.sin(w0) / (2 * (b.q || 1.4)), cw = Math.cos(w0);
      const a0 = 1 + al;
      o.det = [al / a0, 0, -al / a0, -2 * cw / a0, (1 - al) / a0]; // passa-banda (deteção)
      return o;
    });
  }
  peak(f, q, g) {
    const A = Math.pow(10, g / 40), w0 = 2 * Math.PI * f / sampleRate, cw = Math.cos(w0), al = Math.sin(w0) / (2 * q);
    const a0 = 1 + al / A;
    return [(1 + al * A) / a0, -2 * cw / a0, (1 - al * A) / a0, -2 * cw / a0, (1 - al / A) / a0];
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length;
    for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]);
    const ka = Math.exp(-1 / (0.01 * sampleRate)), kr = Math.exp(-1 / (0.12 * sampleRate)), kb = Math.exp(-1 / (6 * sampleRate / n));
    for (const b of this.bands) {
      if (!b.on || !(b.cut > 0)) { b.gr = 0; continue; }
      const d = b.det, z = b.dz;
      let eb = b.env, ef = b.full;
      for (let i = 0; i < n; i++) {
        const x = (inp[0][i] + (inp[1] ? inp[1][i] : inp[0][i])) * 0.5;
        const y = d[0] * x + d[1] * z[0] + d[2] * z[1] - d[3] * z[2] - d[4] * z[3];
        z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = y;
        const a = y * y, f = x * x;
        eb = a > eb ? ka * eb + (1 - ka) * a : kr * eb + (1 - kr) * a;
        ef = f > ef ? ka * ef + (1 - ka) * f : kr * ef + (1 - kr) * f;
      }
      b.env = eb; b.full = ef;
      if (ef < 1e-9) continue;
      const r = 10 * Math.log10((eb + 1e-12) / (ef + 1e-12));
      b.base = b.base === 0 ? r : kb * b.base + (1 - kb) * r;
      const exc = r - b.base - (b.thr || 1);
      const want = Math.max(0, Math.min(b.cut, exc * 1.5));
      b.gr = want > b.gr ? b.gr * 0.6 + want * 0.4 : b.gr * 0.95 + want * 0.05;
      const k = this.peak(b.freq, b.q || 1.4, -b.gr);
      for (let c = 0; c < out.length; c++) {
        const zz = b.z[Math.min(c, 1)], o = out[c];
        for (let i = 0; i < n; i++) {
          const x = o[i];
          const y = k[0] * x + k[1] * zz[0] + k[2] * zz[1] - k[3] * zz[2] - k[4] * zz[3];
          zz[1] = zz[0]; zz[0] = x; zz[3] = zz[2]; zz[2] = y; o[i] = y;
        }
      }
    }
    if (++this.count >= 32) { if (!this.quiet) this.port.postMessage({ gr: this.bands.map((b) => b.gr) }); this.count = 0; }
    return true;
  }
}
registerProcessor('mm-dyneq', DynEq);

class Meter extends AudioWorkletProcessor {
  constructor() {
    super();
    const fs = sampleRate;
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    this.s1 = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / fs); a0 = 1 + K / Q + K * K;
    this.s2 = [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    this.z = [new Float64Array(6), new Float64Array(6)];
    this.blk = Math.round(fs * 0.1); this.bc = 0; this.acc = 0;
    this.blocks = new Float64Array(30); this.bi = 0; this.nb = 0;
    this.hist = new Float64Array(751); // histograma 0.1 LU de -70 a +5
    this.peak = [0, 0]; this.tp = 0; this.tpHold = 0;
    this.lr = 0; this.ll = 0; this.rr = 0;
    this.h = [new Float32Array(4), new Float32Array(4)];
    this.port.onmessage = (e) => { if (e.data === 'reset') { this.hist.fill(0); this.tpHold = 0; } };
  }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length, s1 = this.s1, s2 = this.s2;
    const L = inp[0], R = inp[1] || inp[0];
    for (let i = 0; i < n; i++) {
      let ms = 0;
      for (let c = 0; c < 2; c++) {
        const x = c ? R[i] : L[i], z = this.z[c];
        const y = s1[0] * x + s1[1] * z[0] + s1[2] * z[1] - s1[3] * z[2] - s1[4] * z[3];
        z[1] = z[0]; z[0] = x;
        const w = y - 2 * z[2] + z[3] - s2[0] * z[4] - s2[1] * z[5];
        z[3] = z[2]; z[2] = y; z[5] = z[4]; z[4] = w;
        ms += w * w;
        const a = Math.abs(x); if (a > this.peak[c]) this.peak[c] = a;
        const h = this.h[c]; h[0] = h[1]; h[1] = h[2]; h[2] = h[3]; h[3] = x;
        if (a > this.tp * 0.6) {
          for (let t = 0.25; t < 1; t += 0.25) {
            const c1 = 0.5 * (h[2] - h[0]), c2 = h[0] - 2.5 * h[1] + 2 * h[2] - 0.5 * h[3], c3 = 0.5 * (h[3] - h[0]) + 1.5 * (h[1] - h[2]);
            const v = Math.abs(((c3 * t + c2) * t + c1) * t + h[1]);
            if (v > this.tp) this.tp = v;
          }
        }
      }
      this.acc += ms;
      this.lr += L[i] * R[i]; this.ll += L[i] * L[i]; this.rr += R[i] * R[i];
      if (++this.bc >= this.blk) {
        this.blocks[this.bi] = this.acc / this.blk; this.bi = (this.bi + 1) % 30; this.nb++;
        this.acc = 0; this.bc = 0;
        this.emit();
      }
    }
    return true;
  }
  emit() {
    const Lk = (p) => -0.691 + 10 * Math.log10(p + 1e-20);
    let m = 0, s = 0;
    for (let k = 0; k < 4; k++) m += this.blocks[(this.bi - 1 - k + 30) % 30];
    for (let k = 0; k < 30; k++) s += this.blocks[k];
    const M = Lk(m / 4), S = Lk(s / Math.min(30, Math.max(1, this.nb)));
    if (M > -70) { const idx = Math.max(0, Math.min(750, Math.round((M + 70) * 10))); this.hist[idx]++; }
    // integrado com gating relativo
    let tot = 0, cnt = 0;
    for (let k = 0; k < 751; k++) if (this.hist[k]) { tot += this.hist[k] * Math.pow(10, ((k / 10 - 70) + 0.691) / 10); cnt += this.hist[k]; }
    let I = -70;
    if (cnt) {
      const rel = Lk(tot / cnt) - 10; let t2 = 0, c2 = 0;
      for (let k = 0; k < 751; k++) { const l = k / 10 - 70; if (this.hist[k] && l > rel) { t2 += this.hist[k] * Math.pow(10, (l + 0.691) / 10); c2 += this.hist[k]; } }
      if (c2) I = Lk(t2 / c2);
    }
    if (this.tp > this.tpHold) this.tpHold = this.tp;
    const corr = this.ll * this.rr > 1e-12 ? this.lr / Math.sqrt(this.ll * this.rr) : 1;
    this.port.postMessage({ M, S, I, tp: 20 * Math.log10(this.tp + 1e-9), tpMax: 20 * Math.log10(this.tpHold + 1e-9),
      pkL: this.peak[0], pkR: this.peak[1], corr });
    this.peak[0] = this.peak[1] = 0; this.tp = 0;
    this.lr *= 0.5; this.ll *= 0.5; this.rr *= 0.5;
  }
}
registerProcessor('mm-meter', Meter);
`;
  let url = null;
  const loaded = new WeakMap();
  MM.loadWorklets = function (ctx) {
    if (!url) url = URL.createObjectURL(new Blob([SRC], { type: 'application/javascript' }));
    if (!loaded.has(ctx)) loaded.set(ctx, ctx.audioWorklet.addModule(url));
    return loaded.get(ctx);
  };
})();
