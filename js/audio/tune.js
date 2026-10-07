/* MIXMIND — Editor de voz nota a nota (afinação, tempo, formantes, vibrato, ganho, harmonia).
 *
 * Análise (uma vez por stem, guardada no projeto):
 *   1) decimação para ~16 kHz e YIN (função de diferença direta, WebAssembly SIMD quando disponível), trama de 5 ms
 *   2) limpeza: erros de oitava, blips isolados, gate de energia
 *   3) notas: corridas com pitch, divididas onde o centro (média de ~180 ms, que apaga o vibrato) muda de forma
 *      estável, ou onde a energia cai e volta a subir (nova sílaba na mesma nota); eventos sem pitch = sibilantes/respirações
 *   4) marcas de pitch (épocas) para o PSOLA: propagação pelo período + alinhamento por correlação com o ciclo anterior
 * Render (TD-PSOLA):
 *   Δ(t) por nota = deslocamento do centro + correção de centro/drift + escala do vibrato original + vibrato acrescentado,
 *   com transições suavizadas entre notas (anti-artefactos, link/glide). Mapa de tempo por âncoras (mover/esticar).
 *   Formantes por reamostragem do grão. Só as zonas editadas passam pelo PSOLA; o resto é o áudio original, bit a bit.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const T = (MM.tune = {});
  const { floor, ceil, round, max, min, abs, pow } = Math; // aliases locais: laços internos rápidos também em contextos isolados
  const ANA_V = 6;

  // ---------- escalas ----------
  T.NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  T.SCALES = {
    chromatic: ['Cromática', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
    major: ['Maior', [0, 2, 4, 5, 7, 9, 11]],
    minor: ['Menor natural', [0, 2, 3, 5, 7, 8, 10]],
    harmonic: ['Menor harmónica', [0, 2, 3, 5, 7, 8, 11]],
    melodic: ['Menor melódica', [0, 2, 3, 5, 7, 9, 11]],
    dorian: ['Dórico', [0, 2, 3, 5, 7, 9, 10]],
    phrygian: ['Frígio', [0, 1, 3, 5, 7, 8, 10]],
    lydian: ['Lídio', [0, 2, 4, 6, 7, 9, 11]],
    mixolydian: ['Mixolídio', [0, 2, 4, 5, 7, 9, 10]],
    locrian: ['Lócrio', [0, 1, 3, 5, 6, 8, 10]],
    pentaMajor: ['Pentatónica maior', [0, 2, 4, 7, 9]],
    pentaMinor: ['Pentatónica menor', [0, 3, 5, 7, 10]],
    blues: ['Blues', [0, 3, 5, 6, 7, 10]],
  };
  T.keyLabel = (k) => (k ? `${T.NOTE_NAMES[k.tonic]} ${T.SCALES[k.scale] ? T.SCALES[k.scale][0].toLowerCase() : k.scale}` : '—');
  /** "F♯ menor", "Bb major"… → { tonic, scale } */
  T.parseKey = function (str) {
    if (!str) return null;
    const m = /^\s*([A-Ga-g])\s*([#♯b♭]?)/.exec(str);
    if (!m) return null;
    let pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    if (m[2] === '#' || m[2] === '♯') pc++; else if (m[2] === 'b' || m[2] === '♭') pc--;
    return { tonic: (pc + 12) % 12, scale: /men|min|\bm\b|m$/i.test(str.slice(m[0].length)) ? 'minor' : 'major' };
  };
  const pcsOf = (key) => { const sc = T.SCALES[key && key.scale] || T.SCALES.chromatic; return sc[1].map((v) => (v + (key ? key.tonic : 0)) % 12); };
  /** Nota da escala mais próxima (cents MIDI ×100). */
  T.snap = function (c, key) {
    const pcs = pcsOf(key);
    const base = round(c / 100);
    let best = base * 100, bd = 1e9;
    for (let k = base - 2; k <= base + 2; k++) { if (!pcs.includes(((k % 12) + 12) % 12)) continue; const dd = abs(k * 100 - c); if (dd < bd) { bd = dd; best = k * 100; } }
    return best;
  };
  /** Desloca uma nota por graus da escala (harmonia diatónica). */
  T.scaleStep = function (c, steps, key) {
    const pcs = pcsOf(key).slice().sort((a, b) => a - b);
    let k = round(T.snap(c, key) / 100);
    const dir = Math.sign(steps);
    for (let i = 0; i < abs(steps); i++) { do { k += dir; } while (!pcs.includes(((k % 12) + 12) % 12)); }
    return k * 100;
  };
  /** Tonalidade a partir das notas da voz (perfis de Krumhansl, ponderados pela duração). */
  T.detectKey = function (notes) {
    const h = new Array(12).fill(0);
    notes.forEach((n) => { if (n.kind === 'v') h[((round(n.c / 100) % 12) + 12) % 12] += n.t1 - n.t0; });
    const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const corr = (p, t) => { const hm = D.mean(h), pm = D.mean(p); let a = 0, b = 0, c = 0; for (let i = 0; i < 12; i++) { const x = h[(i + t) % 12] - hm, y = p[i] - pm; a += x * y; b += x * x; c += y * y; } return a / Math.sqrt(b * c + 1e-12); };
    let best = { tonic: 0, scale: 'major', r: -2 };
    for (let t = 0; t < 12; t++) { const a = corr(MAJ, t), b = corr(MIN, t); if (a > best.r) best = { tonic: t, scale: 'major', r: a }; if (b > best.r) best = { tonic: t, scale: 'minor', r: b }; }
    return { tonic: best.tonic, scale: best.scale, conf: +max(0, best.r).toFixed(2) };
  };

  // ---------- deteção de pitch ----------
  function decimate(x, q) {
    if (q <= 1) return new Float32Array(x);
    const N = 63, c = 31, fc = 0.45 / q, h = new Float64Array(N);
    let s = 0;
    for (let i = 0; i < N; i++) { const m = i - c, sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m), w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1)); h[i] = sinc * w; s += h[i]; }
    for (let i = 0; i < N; i++) h[i] /= s;
    const n = floor(x.length / q), y = new Float32Array(n);
    const xl = x.length;
    for (let k = 0; k < n; k++) {
      const o = k * q - c; let acc = 0;
      if (o >= 0 && o + N <= xl) { for (let i = 0; i < N; i++) acc += h[i] * x[o + i]; }
      else for (let i = 0; i < N; i++) { const j = o + i; if (j >= 0 && j < xl) acc += h[i] * x[j]; }
      y[k] = acc;
    }
    return y;
  }
  function yinJS(x, hop, W, tmin, tmax, thr, gate, per, conf, rms) {
    const frames = max(0, floor((x.length - W - tmax - 2) / hop) + 1), d = new Float32Array(tmax + 2);
    for (let f = 0; f < frames; f++) {
      const a = f * hop;
      let e = 0; for (let i = 0; i < W; i++) e += x[a + i] * x[a + i];
      const r = Math.sqrt(e / W); rms[f] = r;
      if (r < gate) { per[f] = 0; conf[f] = 0; continue; }
      d[0] = 1; let run = 0;
      for (let t = 1; t <= tmax + 1; t++) { let s = 0; for (let i = 0; i < W; i++) { const df = x[a + i] - x[a + i + t]; s += df * df; } run += s; d[t] = run > 0 ? (s * t) / run : 1; }
      let best = -1;
      for (let t = tmin; t <= tmax; t++) if (d[t] < thr) { while (t + 1 <= tmax && d[t + 1] < d[t]) t++; best = t; break; }
      if (best < 0) { let m = 1e9; for (let t = tmin; t <= tmax; t++) if (d[t] < m) { m = d[t]; best = t; } }
      let p = best;
      if (best > 1 && best < tmax + 1) { const y0 = d[best - 1], y1 = d[best], y2 = d[best + 1], den = y0 - 2 * y1 + y2; if (abs(den) > 1e-9) { const o = (0.5 * (y0 - y2)) / den; if (o > -1 && o < 1) p += o; } }
      per[f] = p; conf[f] = 1 - d[best];
    }
    return frames;
  }
  /** Trilho de pitch: { hop, off, cents (NaN = sem pitch), conf, db } em tramas de 5 ms. */
  T.track = async function (x, sr, onProgress) {
    const q = max(1, round(sr / 16000)), fsd = sr / q;
    const xd = decimate(x, q);
    const hop = max(1, round(0.005 * fsd)), W = round((0.025 * fsd) / 4) * 4;
    const tmin = floor(fsd / 1100), tmax = ceil(fsd / 65);
    let pk = 0; for (let i = 0; i < xd.length; i += 4) { const v = abs(xd[i]); if (v > pk) pk = v; }
    const gate = pk * pow(10, -48 / 20) * 0.5;
    const nF = max(0, floor((xd.length - W - tmax - 2) / hop) + 1);
    const per = new Float32Array(nF), conf = new Float32Array(nF), rms = new Float32Array(nF);
    const w = D.wasmOn() && MM.wasm.x.yin ? MM.wasm : null;
    if (w) {
      // em blocos (para a interface respirar e a memória do wasm ficar pequena)
      const CH = 4000;
      for (let f0 = 0; f0 < nF; f0 += CH) {
        const f1 = min(nF, f0 + CH), a0 = f0 * hop, seg = xd.subarray(a0, min(xd.length, f1 * hop + W + tmax + 3));
        const xa = w.put(seg), pa = w.alloc((f1 - f0) * 4), ca = w.alloc((f1 - f0) * 4), ra = w.alloc((f1 - f0) * 4), da = w.alloc((tmax + 4) * 4);
        const got = w.x.yin(xa.ptr, seg.length, hop, W, tmin, tmax, 0.15, gate, pa.ptr, ca.ptr, ra.ptr, da.ptr);
        per.set(w.f32(pa.ptr, got), f0); conf.set(w.f32(ca.ptr, got), f0); rms.set(w.f32(ra.ptr, got), f0);
        [xa, pa, ca, ra, da].forEach(w.free);
        if (onProgress) onProgress(f1 / nF);
        await D.yieldUI();
      }
    } else {
      const CH = 1500;
      for (let f0 = 0; f0 < nF; f0 += CH) {
        const f1 = min(nF, f0 + CH), seg = xd.subarray(f0 * hop, min(xd.length, f1 * hop + W + tmax + 3));
        const p2 = new Float32Array(f1 - f0), c2 = new Float32Array(f1 - f0), r2 = new Float32Array(f1 - f0);
        const got = yinJS(seg, hop, W, tmin, tmax, 0.15, gate, p2, c2, r2);
        per.set(p2.subarray(0, got), f0); conf.set(c2.subarray(0, got), f0); rms.set(r2.subarray(0, got), f0);
        if (onProgress) onProgress(f1 / nF);
        await D.yieldUI();
      }
    }
    const cents = new Float32Array(nF), db = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      db[f] = 20 * Math.log10(rms[f] + 1e-9);
      const ok = per[f] > 0 && conf[f] > 0.55;
      cents[f] = ok ? 1200 * Math.log2(fsd / per[f] / 440) + 6900 : NaN;
    }
    clean(cents, db);
    return { hop: hop / fsd, off: W / 2 / fsd, cents, conf, db };
  };
  /** Erros de oitava, blips isolados (< 30 ms) e buracos curtos (≤ 15 ms). */
  function clean(c, db) {
    const n = c.length, med = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = []; for (let k = max(0, i - 6); k <= min(n - 1, i + 6); k++) if (!isNaN(c[k])) v.push(c[k]);
      med[i] = v.length ? D.median(v) : NaN;
    }
    for (let i = 0; i < n; i++) {
      if (isNaN(c[i]) || isNaN(med[i])) continue;
      const d = c[i] - med[i];
      if (abs(abs(d) - 1200) < 150) c[i] -= Math.sign(d) * 1200;
      else if (abs(abs(d) - 1902) < 150) c[i] -= Math.sign(d) * 1902; // quinta acima da oitava (subharmónico)
    }
    // blips
    let i = 0;
    while (i < n) {
      if (isNaN(c[i])) { i++; continue; }
      let j = i; while (j < n && !isNaN(c[j])) j++;
      if (j - i < 6) for (let k = i; k < j; k++) c[k] = NaN;
      i = j;
    }
    // buracos curtos dentro de uma frase
    for (let k = 1; k < n - 1; k++) {
      if (!isNaN(c[k])) continue;
      let j = k; while (j < n && isNaN(c[j])) j++;
      if (j < n && k > 0 && !isNaN(c[k - 1]) && j - k <= 3 && abs(c[j] - c[k - 1]) < 250) for (let m = k; m < j; m++) c[m] = c[k - 1] + ((c[j] - c[k - 1]) * (m - k + 1)) / (j - k + 1);
      k = j;
    }
  }

  // ---------- notas ----------
  const ma = (arr, i0, i1, half) => { // média móvel (ignora NaN) dentro de [i0, i1)
    const out = new Float32Array(i1 - i0);
    for (let i = i0; i < i1; i++) { let s = 0, n = 0; for (let k = max(i0, i - half); k <= min(i1 - 1, i + half); k++) if (!isNaN(arr[k])) { s += arr[k]; n++; } out[i - i0] = n ? s / n : NaN; }
    return out;
  };
  /** Segmenta o trilho em notas (com pitch) e eventos sem pitch (sibilantes, respirações). */
  T.segment = function (tr) {
    const { cents: c, db, hop, off } = tr, n = c.length;
    const tOf = (f) => off + f * hop;
    let pk = -120; for (let f = 0; f < n; f++) if (db[f] > pk) pk = db[f];
    const dbFloor = pk - 45;
    const notes = [];
    const push = (i0, i1, kind) => {
      if (i1 - i0 < 2) return;
      let c0 = NaN, v = 0, rate = 0;
      if (kind === 'v') {
        const core = []; const a = i0 + floor((i1 - i0) * 0.15), b = i1 - floor((i1 - i0) * 0.15);
        for (let f = a; f < max(a + 1, b); f++) if (!isNaN(c[f])) core.push(c[f]);
        if (!core.length) return;
        c0 = D.median(core);
        // vibrato: desvio face à média de 180 ms e cruzamentos por zero
        const lp = ma(c, i0, i1, 18); let ss = 0, cnt = 0, zc = 0, prev = 0;
        const va = i0 + floor((i1 - i0) * 0.2), vb = i1 - floor((i1 - i0) * 0.2); // sem os ataques e as transições
        for (let f = va; f < vb; f++) { if (isNaN(c[f]) || isNaN(lp[f - i0])) continue; const d = max(-300, min(300, c[f] - lp[f - i0])); ss += d * d; cnt++; if (prev && Math.sign(d) !== Math.sign(prev)) zc++; prev = d; }
        v = cnt ? Math.sqrt(ss / cnt) * 1.414 : 0; rate = cnt > 10 ? zc / 2 / (cnt * hop) : 0;
      }
      let e = 0, en = 0; for (let f = i0; f < i1; f++) { e += pow(10, db[f] / 10); en++; }
      const t0 = tOf(i0) - hop / 2, t1 = tOf(i1 - 1) + hop / 2;
      notes.push({ id: 'n' + round(t0 * 1000), kind, t0: +t0.toFixed(4), t1: +t1.toFixed(4), i0, i1, c: isNaN(c0) ? null : +c0.toFixed(1), v: +v.toFixed(1), r: +rate.toFixed(2), db: +(10 * Math.log10(e / max(1, en) + 1e-12)).toFixed(1) });
    };
    let f = 0;
    while (f < n) {
      if (!isNaN(c[f])) {
        let g = f; while (g < n && !isNaN(c[g])) g++;
        // dentro da corrida com pitch: fronteiras onde o centro muda (média de 180 ms) e onde a energia faz um vale
        const lp = ma(c, f, g, 18), cuts = [f];
        let ref = lp[0], since = -1;
        for (let k = f + 1; k < g; k++) {
          const d = lp[k - f] - ref;
          if (abs(d) > 55) { if (since < 0) since = k; if (k - since >= 6) { // nova nota estável: corta no cruzamento do ponto médio
            const mid = ref + d / 2; let cut = since; for (let m = max(cuts[cuts.length - 1] + 4, since - 30); m <= k; m++) { if (Math.sign(c[m] - mid) === Math.sign(d)) { cut = m; break; } }
            if (cut - cuts[cuts.length - 1] >= 8) cuts.push(cut);
            ref = lp[k - f]; since = -1;
          } } else { since = -1; ref = ref * 0.97 + lp[k - f] * 0.03; }
        }
        // vales de energia ≥ 6 dB (nova sílaba na mesma nota)
        for (let k = f + 10; k < g - 10; k++) {
          let l = -1e9, r = -1e9; for (let m = k - 16; m < k; m++) if (m >= f) l = max(l, db[m]); for (let m = k + 1; m <= k + 16; m++) if (m < g) r = max(r, db[m]);
          if (db[k] <= db[k - 1] && db[k] <= db[k + 1] && db[k] < l - 6 && db[k] < r - 6 && cuts.every((x) => abs(x - k) >= 12)) cuts.push(k);
        }
        cuts.sort((a, b) => a - b); cuts.push(g);
        for (let k = 0; k < cuts.length - 1; k++) push(cuts[k], cuts[k + 1], 'v');
        f = g;
      } else if (db[f] > dbFloor) {
        let g = f; while (g < n && isNaN(c[g]) && db[g] > dbFloor) g++;
        if (g - f >= 6) push(f, g, 'u');
        f = g;
      } else f++;
    }
    return notes;
  };

  /** Notas fora do contexto melódico: erro de oitava (YIN apanha o sub-harmónico) → corrige ±1200/±1902 cents;
   *  notas curtas muito longe da frase que não se explicam assim → evento sem pitch (não são processadas). */
  T.fixOutliers = function (tr, notes) {
    const v = notes.filter((n) => n.kind === 'v');
    v.forEach((n, i) => {
      const ctx = []; for (let k = Math.max(0, i - 6); k <= Math.min(v.length - 1, i + 6); k++) if (k !== i) ctx.push(v[k].c);
      if (ctx.length < 3) return;
      const loc = D.median(ctx), d = n.c - loc;
      if (abs(d) < 950) return;
      const fix = [1200, -1200, 1902, -1902, 2400, -2400].find((o) => abs(n.c + o - loc) < 450);
      if (fix !== undefined) {
        for (let f = n.i0; f < n.i1; f++) if (!isNaN(tr.cents[f])) tr.cents[f] += fix;
        n.c = +(n.c + fix).toFixed(1); n.fixed = fix;
      } else if (n.t1 - n.t0 < 0.15) { n.kind = 'u'; n.c = null; for (let f = n.i0; f < n.i1; f++) tr.cents[f] = NaN; }
    });
    // tramas dentro de uma nota muito longe do centro (consoantes, ruído): sem pitch
    notes.forEach((n) => { if (n.kind !== 'v') return; for (let f = n.i0; f < n.i1; f++) if (!isNaN(tr.cents[f]) && abs(tr.cents[f] - n.c) > 700) tr.cents[f] = NaN; });
    return notes;
  };

  // ---------- marcas de pitch (épocas) ----------
  T.marks = function (x, sr, tr) {
    const { cents: c, hop, off } = tr, n = x.length, U = round(0.005 * sr);
    const f0At = (s) => { const fi = (s / sr - off) / hop, i = floor(fi); if (i < 0 || i + 1 >= c.length) return NaN; const a = c[i], b = c[i + 1]; if (isNaN(a) || isNaN(b)) return isNaN(a) ? (isNaN(b) ? NaN : b) : a; return a + (b - a) * (fi - i); };
    const hz = (ct) => 440 * pow(2, (ct - 6900) / 1200);
    const marks = [], per = [], vo = [];
    let m = 0, frac = 0; // marca = m + frac (sub-amostra, por interpolação parabólica da correlação)
    const cc = new Float64Array(2048);
    while (m < n) {
      const ct = f0At(m);
      if (isNaN(ct)) { marks.push(m); per.push(U); vo.push(0); m += U; frac = 0; continue; }
      // primeira marca de uma zona com pitch: pico de |x| no primeiro período
      let P = sr / hz(ct);
      if (!vo.length || !vo[vo.length - 1]) { let bi = m, bv = -1; for (let k = m; k < min(n, m + P); k++) { const v = abs(x[k]); if (v > bv) { bv = v; bi = k; } } m = bi; frac = 0; }
      marks.push(m + frac); per.push(P); vo.push(1);
      // seguinte: m + P, ajustada por correlação com o ciclo atual (±P/4)
      const est = m + P, half = round(P / 2), R = min(1000, round(P / 4)), e0 = round(est);
      let best = e0, bc = -1e9, bi = R;
      if (est + R + half + 1 < n && m - half >= 0) {
        for (let dlt = -R; dlt <= R; dlt += 1) {
          const q = e0 + dlt; let s2 = 0;
          for (let k = -half; k < half; k += 2) s2 += x[m + k] * x[q + k];
          cc[dlt + R] = s2;
          if (s2 > bc) { bc = s2; best = q; bi = dlt + R; }
        }
      }
      const P2 = best - m;
      if (P2 < P * 0.6 || P2 > P * 1.5) { m = e0; frac = 0; continue; }
      frac = 0;
      if (bi > 0 && bi < 2 * R) { const y0 = cc[bi - 1], y1 = cc[bi], y2 = cc[bi + 1], den = y0 - 2 * y1 + y2; if (den < -1e-12) { const o = (0.5 * (y0 - y2)) / den; if (o > -0.5 && o < 0.5) frac = o; } }
      m = best;
    }
    // períodos a partir das próprias marcas (vozeadas)
    const out = { pos: Float64Array.from(marks), per: Float32Array.from(per), voiced: Uint8Array.from(vo) };
    for (let k = 1; k < marks.length - 1; k++) if (vo[k]) { const a = marks[k] - marks[k - 1], b = marks[k + 1] - marks[k]; out.per[k] = vo[k - 1] && vo[k + 1] ? (a + b) / 2 : vo[k + 1] ? b : a; }
    return out;
  };

  // ---------- análise do stem ----------
  /** Analisa um stem de voz (guarda em s.features.pitch, que vai no projeto). */
  T.analyze = async function (s, sr, onProgress) {
    if (MM.wasm && MM.wasm.whenReady) await MM.wasm.whenReady;
    const x = D.mono(s.chs);
    const tr = await T.track(x, sr, (p) => onProgress && onProgress(p * 0.8));
    const notes = T.fixOutliers(tr, T.segment(tr));
    const mk = T.marks(x, sr, tr);
    if (onProgress) onProgress(1);
    s.features.pitch = { v: ANA_V, sr, hop: tr.hop, off: tr.off, cents: tr.cents, db: tr.db, notes, marks: mk.pos, mper: mk.per, mvo: mk.voiced, key: T.detectKey(notes) };
    s._tuneNotes = null;
    return s.features.pitch;
  };
  T.analyzed = (s) => !!(s.features && s.features.pitch && s.features.pitch.v === ANA_V);
  T.defaults = () => ({ on: true, key: null, anti: 0.4, sib: 0, match: 0, edits: {}, splits: [] });
  T.state = (s) => (s.p.tune = s.p.tune || T.defaults());
  T.keyOf = (st, s) => (s.p.tune && s.p.tune.key) || T.parseKey(st.music && st.music.key) || (s.features.pitch && s.features.pitch.key) || null;

  /** Notas atuais (análise + divisões do utilizador), em cache. */
  T.notes = function (s) {
    const A = s.features.pitch; if (!A) return [];
    const t = s.p.tune || {}, key = JSON.stringify(t.splits || []);
    if (s._tuneNotes && s._tuneNotes.key === key && s._tuneNotes.ana === A) return s._tuneNotes.list;
    let list = A.notes.map((n) => Object.assign({}, n));
    (t.splits || []).slice().sort((a, b) => a - b).forEach((ts) => {
      const i = list.findIndex((n) => ts > n.t0 + 0.03 && ts < n.t1 - 0.03);
      if (i < 0) return;
      const n = list[i], fi = round((ts - A.off) / A.hop);
      const mk = (i0, i1, t0, t1) => { const core = []; for (let f = i0; f < i1; f++) if (!isNaN(A.cents[f])) core.push(A.cents[f]); return Object.assign({}, n, { id: 'n' + round(t0 * 1000), t0, t1, i0, i1, c: n.kind === 'v' && core.length ? +D.median(core).toFixed(1) : n.c }); };
      list.splice(i, 1, mk(n.i0, fi, n.t0, ts), mk(fi, n.i1, ts, n.t1));
    });
    s._tuneNotes = { key, ana: A, list };
    return list;
  };
  T.edit = (s, id) => { const t = T.state(s); return (t.edits[id] = t.edits[id] || {}); };
  T.editOf = (s, id) => (s.p.tune && s.p.tune.edits && s.p.tune.edits[id]) || {};
  const isEdited = (e) => e && Object.keys(e).some((k) => { const v = e[k]; return k === 'link' ? !!v : k === 'avib' ? v && v.d > 0 : k === 'stretch' || k === 'vib' ? v !== undefined && abs(v - 1) > 1e-4 : typeof v === 'number' && abs(v) > 1e-4; });
  T.hasEdits = function (s) {
    const t = s.p.tune; if (!t || !t.on || !T.analyzed(s)) return false;
    return abs(t.sib || 0) > 0.05 || (t.match || 0) > 0.005 || Object.values(t.edits || {}).some(isEdited) || (t.extraShift || 0) !== 0;
  };

  /** Centro alvo de uma nota (cents) depois do deslocamento e da correção de centro. */
  T.target = function (n, e, key) {
    if (n.c === null) return null;
    let c = n.c + (e.shift || 0);
    if (e.centre) c += (T.snap(c, key) - c) * e.centre;
    return c;
  };

  // ---------- plano de render (curvas por trama, no tempo de ENTRADA) ----------
  function plan(s, key, extra) {
    const A = s.features.pitch, t = s.p.tune || T.defaults(), notes = T.notes(s), nF = A.cents.length;
    const delta = new Float32Array(nF), form = new Float32Array(nF), gain = new Float32Array(nF).fill(1), glideF = new Float32Array(nF);
    const owner = new Int32Array(nF).fill(-1);
    const anti = D.clamp(t.anti === undefined ? 0.4 : t.anti, 0, 1);
    // ganhos: match energy e sibilantes
    const vdb = notes.filter((n) => n.kind === 'v').map((n) => n.db), mdb = vdb.length ? D.median(vdb) : 0;
    notes.forEach((n, ni) => {
      const e = Object.assign({}, T.editOf(s, n.id));
      if (extra && extra.shiftOf && n.kind === 'v') e.shift = (e.shift || 0) + extra.shiftOf(n, T.target(n, e, key));
      const i0 = max(0, n.i0), i1 = min(nF, n.i1);
      for (let f = i0; f < i1; f++) owner[f] = ni;
      let g = (e.gain || 0);
      if (n.kind === 'v' && t.match) g += D.clamp((mdb - n.db) * t.match, -9, 9);
      if (n.kind === 'u') g += t.sib || 0;
      const gl = e.gain !== undefined && e.gain <= -59 ? 0 : pow(10, g / 20);
      for (let f = i0; f < i1; f++) gain[f] = gl;
      if (n.kind !== 'v' || n.c === null) return;
      const tc = T.target(n, e, key), dC = tc - n.c;
      const vib = e.vib === undefined ? 1 : e.vib, dr = e.drift || 0, av = e.avib, fm = e.formant || 0;
      const needCurve = vib !== 1 || dr || (av && av.d > 0);
      const lp = needCurve ? ma(A.cents, i0, i1, 18) : null;
      for (let f = i0; f < i1; f++) {
        let d = dC;
        if (needCurve) {
          const o = A.cents[f], l = lp[f - i0];
          if (!isNaN(o) && !isNaN(l)) { d += -dr * (l - n.c) + (vib - 1) * D.clamp(o - l, -300, 300); }
          if (av && av.d > 0) { const tt = (f - i0) * A.hop, fade = min(1, tt / 0.15); d += av.d * fade * Math.sin(2 * Math.PI * (av.r || 5.5) * tt); }
        }
        delta[f] = d; form[f] = fm;
      }
      glideF[i0] = e.link ? max(0.03, (e.glide || 80) / 1000) : 0;
    });
    // transições entre notas: crossfade cosseno do Δ (anti-artefactos alarga; link = glide pedido)
    const baseG = 0.012 + anti * 0.07;
    const sm = new Float32Array(delta), smf = new Float32Array(form);
    for (let ni = 1; ni < notes.length; ni++) {
      const a = notes[ni - 1], b = notes[ni];
      if (a.kind !== 'v' || b.kind !== 'v' || b.i0 - a.i1 > 4) continue;
      const g = max(baseG, glideF[b.i0] || 0), half = max(1, round(g / A.hop / 2));
      const da = delta[max(a.i0, a.i1 - 1)], db = delta[b.i0], fa = form[max(a.i0, a.i1 - 1)], fb = form[b.i0];
      for (let k = -half; k < half; k++) { const f = b.i0 + k; if (f < a.i0 || f >= b.i1) continue; const w = 0.5 - 0.5 * Math.cos((Math.PI * (k + half)) / (2 * half)); sm[f] = da + (db - da) * w; smf[f] = fa + (fb - fa) * w; }
    }
    // entradas/saídas de notas isoladas: rampa curta desde 0 (nunca um salto de pitch)
    const ramp = max(1, round((0.01 + anti * 0.03) / A.hop));
    notes.forEach((n, ni) => {
      if (n.kind !== 'v') return;
      const prev = notes[ni - 1], next = notes[ni + 1];
      const joinedL = prev && prev.kind === 'v' && n.i0 - prev.i1 <= 4, joinedR = next && next.kind === 'v' && next.i0 - n.i1 <= 4;
      if (!joinedL) for (let k = 0; k < ramp && n.i0 + k < n.i1; k++) { const w = (k + 1) / (ramp + 1); sm[n.i0 + k] *= w; smf[n.i0 + k] *= w; }
      if (!joinedR) for (let k = 0; k < ramp && n.i1 - 1 - k >= n.i0; k++) { const w = (k + 1) / (ramp + 1); sm[n.i1 - 1 - k] *= w; smf[n.i1 - 1 - k] *= w; }
    });
    // anti-artefactos: alisa o Δ (tira o "warble" de correções fortes)
    const lpHalf = round(anti * 3);
    const dOut = lpHalf ? (() => { const o = new Float32Array(nF); for (let f = 0; f < nF; f++) { let s2 = 0, c2 = 0; for (let k = -lpHalf; k <= lpHalf; k++) { const q = f + k; if (q >= 0 && q < nF && owner[q] === owner[f]) { s2 += sm[q]; c2++; } } o[f] = c2 ? s2 / c2 : sm[f]; } return o; })() : sm;
    // ganho alisado (10 ms)
    const gs = new Float32Array(nF); for (let f = 0; f < nF; f++) { let s2 = 0, c2 = 0; for (let k = -2; k <= 2; k++) { const q = f + k; if (q >= 0 && q < nF) { s2 += gain[q]; c2++; } } gs[f] = s2 / c2; }
    // mapa de tempo (âncoras entrada → saída) por mover/esticar
    const anchors = [];
    notes.forEach((n) => {
      const e = T.editOf(s, n.id), mv = e.move || 0, st = e.stretch || 1;
      if (abs(mv) < 1e-4 && abs(st - 1) < 1e-4) return;
      anchors.push([n.t0, n.t0 + mv], [n.t1, n.t0 + mv + (n.t1 - n.t0) * st]);
    });
    let map = null;
    if (anchors.length) {
      // âncoras das notas vizinhas não editadas ficam no lugar (o tempo entre elas absorve o movimento)
      notes.forEach((n) => { const e = T.editOf(s, n.id); if (!(abs(e.move || 0) > 1e-4 || abs((e.stretch || 1) - 1) > 1e-4)) anchors.push([n.t0, n.t0], [n.t1, n.t1]); });
      anchors.push([0, 0]);
      anchors.sort((a, b) => a[0] - b[0]);
      const inA = [], outA = [];
      anchors.forEach(([i, o]) => { if (inA.length && i - inA[inA.length - 1] < 1e-4) return; const minO = outA.length ? outA[outA.length - 1] + (i - inA[inA.length - 1]) * 0.1 : 0; inA.push(i); outA.push(max(o, minO)); });
      map = { inA, outA };
    }
    return { delta: dOut, form: smf, gain: gs, map, A };
  }

  T.plan = plan;
  // mapa de tempo saída → entrada (segundos)
  const inv = (map, to) => {
    if (!map) return to;
    const { inA, outA } = map, n = inA.length;
    if (to <= outA[0]) return inA[0] + (to - outA[0]);
    if (to >= outA[n - 1]) return inA[n - 1] + (to - outA[n - 1]);
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (outA[m] <= to) lo = m; else hi = m; }
    const span = outA[hi] - outA[lo];
    return span > 1e-9 ? inA[lo] + ((to - outA[lo]) / span) * (inA[hi] - inA[lo]) : inA[lo];
  };

  T.inv = (map, to) => inv(map, to);
  // ---------- render ----------
  const HANN = (() => { const h = new Float32Array(2049); for (let i = 0; i <= 2048; i++) h[i] = 0.5 + 0.5 * Math.cos((Math.PI * (i - 1024)) / 1024); return h; })();
  /** Voz editada (array por canal). extra: { shiftOf(n, alvo) } para harmonias. */
  T.render = function (s, key, extra) {
    const A = s.features.pitch, sr = A.sr, P = plan(s, key, extra), chs = s.chs, n = chs[0].length;
    const nF = P.delta.length, hopS = A.hop * sr, offS = A.off * sr;
    const frameAt = (si) => (si - offS) / hopS;
    const at = (arr, si) => { const fi = frameAt(si), i = floor(fi); if (i < 0) return arr[0]; if (i + 1 >= nF) return arr[nF - 1]; const a = arr[i]; return a + (arr[i + 1] - a) * (fi - i); };
    const mapS = P.map ? { inA: P.map.inA.map((v) => v * sr), outA: P.map.outA.map((v) => v * sr) } : null;
    // zonas que precisam de PSOLA (no tempo de saída)
    const act = new Uint8Array(ceil(n / 256) + 1);
    for (let f = 0; f < nF; f++) if (abs(P.delta[f]) > 0.5 || abs(P.form[f]) > 0.5) { const a = floor((offS + f * hopS - hopS) / 256), b = ceil((offS + f * hopS + hopS) / 256); for (let k = max(0, a); k <= min(act.length - 1, b); k++) act[k] = 1; }
    if (mapS) {
      // onde o mapa não é a identidade (incl. a vizinhança)
      for (let b = 0; b < act.length; b++) { const o = b * 256; if (abs(inv(mapS, o) - o) > 0.5 || abs(inv(mapS, o + 256) - (o + 256)) > 0.5) act[b] = 1; }
      // pitch editado numa nota movida: a atividade segue a nota para o tempo de saída
      const act2 = new Uint8Array(act.length);
      for (let b = 0; b < act.length; b++) { const ti = inv(mapS, b * 256); const f = round(frameAt(ti)); if (f >= 0 && f < nF && (abs(P.delta[f]) > 0.5 || abs(P.form[f]) > 0.5)) act2[b] = 1; }
      for (let b = 0; b < act.length; b++) act[b] |= act2[b];
    }
    // alarga 30 ms e cria rampas de 10 ms
    const pad = ceil((0.03 * sr) / 256);
    const actW = new Uint8Array(act.length); for (let b = 0; b < act.length; b++) if (act[b]) for (let k = max(0, b - pad); k <= min(act.length - 1, b + pad); k++) actW[k] = 1;
    const out = chs.map((c) => new Float32Array(c));
    const pos = A.marks, per = A.mper, vo = A.mvo, M = pos.length;
    const near = (ti) => { let lo = 0, hi = M - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pos[m] <= ti) lo = m; else hi = m; } return ti - pos[lo] < pos[hi] - ti ? lo : hi; };
    const ramp = round(0.01 * sr);
    let b = 0, spans = 0;
    while (b < actW.length) {
      if (!actW[b]) { b++; continue; }
      let e = b; while (e < actW.length && actW[e]) e++;
      const S0 = b * 256, S1 = min(n, e * 256); spans++;
      const L = S1 - S0, acc = chs.map(() => new Float32Array(L)), ws = new Float32Array(L), nc = chs.length;
      // primeira marca de síntese alinhada com uma marca de análise (fase contínua com o original nas pontas)
      let ts = pos[near(S0 - round(0.02 * sr))];
      while (ts < S1 + round(0.02 * sr)) {
        const ti = inv(mapS, ts);
        // grão interpolado entre as duas marcas vizinhas (sem grãos repetidos/saltados de forma brusca)
        let lo = near(ti); if (pos[lo] > ti && lo > 0) lo--;
        const hi = min(M - 1, lo + 1), span = pos[hi] - pos[lo];
        const both = vo[lo] && vo[hi] && span > 0;
        const al = both ? D.clamp((ti - pos[lo]) / span, 0, 1) : 0, k = both ? lo : near(ti), voiced = vo[k];
        const Pin = max(16, both ? per[lo] * (1 - al) + per[hi] * al : per[k]);
        const dl = voiced ? at(P.delta, ti) : 0, ratio = pow(2, dl / 1200);
        const phi = pow(2, (voiced ? at(P.form, ti) : 0) / 1200);
        const Lo = Pin / phi, Pout = voiced ? Pin / ratio : Pin;
        const a0 = ceil(ts - Lo), a1 = floor(ts + Lo), pa = pos[k], pb = pos[hi], wa = 1 - al, wb = al;
        for (let m = max(S0, a0); m <= min(S1 - 1, a1); m++) {
          const u = m - ts, w = HANN[round((u / Lo) * 1024) + 1024], du = u * phi;
          let sa = pa + du, i = floor(sa), fr = sa - i;
          if (i < 0 || i + 1 >= n) continue;
          let sb = pb + du, j = floor(sb), fj = sb - j;
          if (!both || j < 0 || j + 1 >= n) { j = i; fj = fr; }
          for (let c = 0; c < nc; c++) { const x = chs[c]; acc[c][m - S0] += ((x[i] + (x[i + 1] - x[i]) * fr) * (both ? wa : 1) + (both ? (x[j] + (x[j + 1] - x[j]) * fj) * wb : 0)) * w; }
          ws[m - S0] += w;
        }
        ts += max(8, Pout);
      }
      // normalização pela soma das janelas + crossfade com o original nas pontas da zona
      for (let m = 0; m < L; m++) {
        const nw = ws[m] > 0.35 ? 1 / ws[m] : ws[m] > 1e-6 ? 1 / 0.35 : 0;
        const fin = S0 === 0 ? 1 : min(1, m / ramp), fout = S1 >= n ? 1 : min(1, (L - 1 - m) / ramp), fade = min(fin, fout);
        for (let c = 0; c < chs.length; c++) out[c][S0 + m] = chs[c][S0 + m] * (1 - fade) + acc[c][m] * nw * fade;
      }
      b = e;
    }
    // ganho por nota (no tempo de entrada, levado para a saída)
    let anyGain = false; for (let f = 0; f < nF; f++) if (abs(P.gain[f] - 1) > 1e-4) { anyGain = true; break; }
    if (anyGain) for (let m = 0; m < n; m++) { const g = at(P.gain, mapS ? inv(mapS, m) : m); if (g !== 1) for (let c = 0; c < chs.length; c++) out[c][m] *= g; }
    T.lastRender = { spans };
    return out;
  };
  /** Assinatura das edições (o render só se refaz quando muda). */
  T.sig = (s, key) => JSON.stringify([s.p.tune, key, (s.features.pitch || {}).v, s.length]);
  /** Garante que cada stem com edições tem a voz editada pronta (s.tuneBuf). Devolve true se algo mudou. */
  T.ensure = async function (st) {
    let changed = false;
    for (const s of st.stems) {
      if (s.removed) continue;
      const want = T.hasEdits(s);
      if (!want) { if (s.tuneBuf) { s.tuneBuf = null; s.tuneSig = null; changed = true; } continue; }
      const key = T.keyOf(st, s), sig = T.sig(s, key);
      if (s.tuneSig === sig && s.tuneBuf) continue;
      await D.yieldUI();
      const chs = T.render(s, key);
      s.tuneBuf = MM.toAudioBuffer(chs, s.features.pitch.sr); s.tuneSig = sig; s.tunePeaks = MM.peaks(chs, 240);
      changed = true;
    }
    return changed;
  };

  // ---------- IA: proposta de afinação ----------
  /** Proposta conservadora: centra as notas desafinadas sem tocar no vibrato nem nos ornamentos. */
  T.suggest = function (st, s, strength) {
    const key = T.keyOf(st, s), k = D.clamp(strength === undefined ? 0.7 : strength, 0, 1), notes = T.notes(s);
    let n = 0, sum = 0;
    notes.forEach((x) => {
      if (x.kind !== 'v' || x.c === null || x.t1 - x.t0 < 0.09) return;
      const e = T.editOf(s, x.id);
      if (e.manual) return;
      const dev = x.c + (e.shift || 0) - T.snap(x.c + (e.shift || 0), key);
      if (abs(dev) < 12) return;
      const ed = T.edit(s, x.id); ed.centre = +k.toFixed(2); ed.drift = +(k * 0.35).toFixed(2); ed.ai = true;
      n++; sum += abs(dev);
    });
    return { n, avg: n ? sum / n : 0, key };
  };

  // ---------- harmonia ----------
  T.INTERVALS = [['3ª acima', 2], ['3ª abaixo', -2], ['4ª acima', 3], ['5ª acima', 4], ['5ª abaixo', -4], ['6ª acima', 5], ['Oitava acima', 7], ['Oitava abaixo', -7]];
  /** Voz harmónica (diatónica na escala ativa) a partir da voz já editada. only = ids das notas (null = todas). */
  T.harmony = function (st, s, steps, only) {
    const key = T.keyOf(st, s);
    const chs = T.render(s, key, { shiftOf: (n, tgt) => (only && !only.includes(n.id) ? 0 : T.scaleStep(tgt, steps, key) - tgt) });
    // notas fora da seleção: silenciadas (ganho 0 nas zonas desligadas)
    if (only) {
      const A = s.features.pitch, sr = A.sr, notes = T.notes(s), keep = new Uint8Array(chs[0].length);
      notes.forEach((n) => { if (only.includes(n.id)) { const a = max(0, floor((n.t0 - 0.02) * sr)), b = min(keep.length, ceil((n.t1 + 0.02) * sr)); keep.fill(1, a, b); } });
      chs.forEach((c) => { for (let i = 0; i < c.length; i++) if (!keep[i]) c[i] = 0; });
    }
    return chs;
  };
})();
