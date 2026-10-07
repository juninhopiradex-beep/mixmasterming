/* MIXMIND — sessão de demonstração.
 * Sintetiza 15 stems de uma Kizomba (94 BPM, F♯ menor) diretamente em JavaScript,
 * com nomes propositadamente errados/genéricos para demonstrar a identificação por áudio.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;

  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  MM.demo = {
    BPM: 94,
    // estrutura em compassos
    SECTIONS: [
      ['Intro', 4], ['Verso 1', 8], ['Pré', 4], ['Refrão', 8], ['Verso 2', 8], ['Refrão', 8], ['Bridge', 4], ['Refrão final', 8], ['Outro', 4],
    ],
    async generate(sr, onProgress) {
      sr = sr || 44100;
      const bpm = this.BPM, beat = 60 / bpm, bar = beat * 4;
      const bars = this.SECTIONS.reduce((a, s) => a + s[1], 0);
      const len = Math.ceil((bars * bar + 1.5) * sr);
      const secAt = []; // secção por compasso
      this.SECTIONS.forEach(([n, b]) => { for (let i = 0; i < b; i++) secAt.push(n); });
      const isChorus = (b) => /Refrão/.test(secAt[b] || '');
      const energy = (b) => ({ Intro: 0.5, 'Verso 1': 0.7, 'Pré': 0.8, Refrão: 1, 'Verso 2': 0.72, Bridge: 0.55, 'Refrão final': 1.05, Outro: 0.45 })[secAt[b]] || 0.6;
      // progressão i–VI–III–VII
      const roots = [42, 38, 45, 40];
      const chordOf = (b) => {
        const r = roots[b % 4];
        const minor = b % 4 === 0;
        return [r, r + (minor ? 3 : 4), r + 7];
      };
      const R = rng(7);
      const mk = () => new Float32Array(len);
      const add = (buf, start, arr, gain) => {
        const s0 = Math.round(start * sr);
        for (let i = 0; i < arr.length && s0 + i < buf.length; i++) if (s0 + i >= 0) buf[s0 + i] += arr[i] * gain;
      };
      const noise = (n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = R() * 2 - 1; return a; };
      const env = (n, atk, dec) => { const a = new Float32Array(n); const na = Math.max(1, Math.round(atk * sr)); for (let i = 0; i < n; i++) a[i] = i < na ? i / na : Math.exp(-(i - na) / (dec * sr)); return a; };
      const step = async (p) => { if (onProgress) onProgress(p); await D.yieldUI(); };

      // ---------- bateria ----------
      const kickHit = (() => {
        const n = Math.round(0.45 * sr), a = new Float32Array(n); let ph = 0;
        for (let i = 0; i < n; i++) { const t = i / sr; const f = 48 + 110 * Math.exp(-t / 0.035); ph += (2 * Math.PI * f) / sr; a[i] = Math.sin(ph) * Math.exp(-t / 0.22) + (i < 200 ? (R() * 2 - 1) * 0.25 * (1 - i / 200) : 0); }
        return a;
      })();
      const snareHit = (() => {
        const n = Math.round(0.25 * sr); let nz = D.filter(noise(n), D.biquad('bandpass', 2600, 0.7, 0, sr));
        nz = D.filter(nz, D.biquad('highpass', 400, 0.7, 0, sr));
        const a = new Float32Array(n);
        for (let i = 0; i < n; i++) { const t = i / sr; a[i] = nz[i] * 1.6 * Math.exp(-t / 0.09) + Math.sin(2 * Math.PI * 190 * t) * 0.6 * Math.exp(-t / 0.05); }
        return a;
      })();
      const hatHit = (dec, hp) => { const n = Math.round(dec * 6 * sr); const nz = D.filter(D.filter(noise(n), D.biquad('highpass', hp, 0.7, 0, sr)), D.biquad('highpass', hp, 0.7, 0, sr)); const e = env(n, 0.001, dec); for (let i = 0; i < n; i++) nz[i] *= e[i]; return nz; };
      const hh = hatHit(0.035, 7500), shk = hatHit(0.05, 5200);
      const conga = (f) => { const n = Math.round(0.3 * sr), a = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; a[i] = Math.sin(2 * Math.PI * f * (1 + 0.15 * Math.exp(-t / 0.01)) * t) * Math.exp(-t / 0.08); } return a; };
      const cLo = conga(210), cHi = conga(330);

      const kick = mk(), snare = mk(), hat = mk(), shaker = mk(), perc = mk();
      for (let b = 0; b < bars; b++) {
        const t0 = b * bar, e = energy(b), sec = secAt[b];
        const drums = sec !== 'Intro' || b >= 2;
        if (drums && sec !== 'Bridge') {
          [0, 1.5, 2].forEach((x) => add(kick, t0 + x * beat, kickHit, 0.8));
          if (sec !== 'Outro' || b < bars - 1) [1, 3].forEach((x) => add(snare, t0 + x * beat, snareHit, 0.38));
        }
        if (sec === 'Bridge') add(kick, t0, kickHit, 0.8);
        for (let k = 0; k < 8; k++) if (drums) add(hat, t0 + k * beat / 2 + (k % 2 ? 0.012 : 0), hh, (k % 2 ? 0.16 : 0.28) * e);
        if (isChorus(b) || sec === 'Pré') for (let k = 0; k < 16; k++) add(shaker, t0 + (k * beat) / 4, shk, (k % 4 === 2 ? 0.22 : 0.12));
        if (sec !== 'Intro' && sec !== 'Outro') [[0.5, cLo], [1.75, cHi], [2.5, cLo], [3.25, cHi], [3.5, cHi]].forEach(([x, h]) => add(perc, t0 + x * beat, h, 0.05 * e));
      }
      await step(0.25);

      // ---------- baixo ----------
      const bass = mk();
      const bassNote = (f, dur, g) => {
        const n = Math.round(dur * sr), a = new Float32Array(n); let ph = 0;
        for (let i = 0; i < n; i++) {
          ph += f / sr; const t = i / sr;
          let s = 0; for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * h * ph) / (h * h * 0.8 + 0.2);
          a[i] = s * Math.min(1, t / 0.006) * Math.min(1, (dur - t) / 0.03) * (0.75 + 0.25 * Math.exp(-t / 0.15));
        }
        return a;
      };
      for (let b = 0; b < bars; b++) {
        if (secAt[b] === 'Intro' && b < 2) continue;
        const r = roots[b % 4] - 12, t0 = b * bar;
        [[0, 1.4, 0], [1.5, 0.45, 0], [2, 1.0, 0], [3.25, 0.6, 7]].forEach(([x, d, iv]) => add(bass, t0 + x * beat, bassNote(mtof(r + iv), d * beat, 1), 0.32));
      }
      await step(0.4);

      // ---------- piano, pad, guitarras ----------
      const piano = mk(), padL = mk(), gtrL = mk(), gtrR = mk();
      const pianoNote = (f, dur) => { const n = Math.round(dur * sr), a = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; let s = 0; for (let h = 1; h <= 7; h++) s += Math.sin(2 * Math.PI * f * h * t * (1 + 0.0004 * h * h)) * Math.exp(-t * (1.2 + h * 0.9)) / h; a[i] = s * Math.min(1, t / 0.003) * Math.min(1, (dur - t) / 0.02); } return a; };
      const ks = (f, dur, bright) => { const n = Math.round(dur * sr), P = Math.max(2, Math.round(sr / f)); const buf = noise(P); const a = new Float32Array(n); let idx = 0; for (let i = 0; i < n; i++) { const j = (idx + 1) % P; const v = buf[idx]; buf[idx] = bright * (v + buf[j]) * 0.5 + (1 - bright) * buf[idx] * 0.996; a[i] = v * Math.min(1, (dur - i / sr) / 0.02); idx = j; } return a; };
      for (let b = 0; b < bars; b++) {
        const ch = chordOf(b), t0 = b * bar, sec = secAt[b];
        if (sec !== 'Bridge') [0.5, 1.5, 2.5, 3.5].forEach((x) => ch.forEach((m) => add(piano, t0 + x * beat, pianoNote(mtof(m + 24), beat * 0.8), 0.07)));
        if (sec !== 'Intro' && sec !== 'Outro') {
          const arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 24];
          for (let k = 0; k < 8; k++) add(gtrL, t0 + (k * beat) / 2, ks(mtof(arp[k % 4] + 12), beat * 0.9, 0.98), 0.22);
          for (let k = 0; k < 4; k++) add(gtrR, t0 + k * beat + beat / 4, ks(mtof(arp[(k + 2) % 4] + 12), beat * 0.9, 0.97), 0.2);
        }
      }
      // pad (mono falso): serra desafinada em filtro passa-baixo
      const padRaw = mk();
      for (let b = 0; b < bars; b++) {
        const ch = chordOf(b), t0 = Math.round(b * bar * sr), n = Math.round(bar * sr);
        const lvl = secAt[b] === 'Bridge' ? 0.12 : 0.07;
        for (const m of ch) for (const det of [-0.08, 0.08]) {
          const f = mtof(m + 12 + det); let ph = R();
          for (let i = 0; i < n && t0 + i < len; i++) { ph += f / sr; if (ph >= 1) ph -= 1; padRaw[t0 + i] += (2 * ph - 1) * lvl * Math.min(1, i / (0.25 * sr)) * Math.min(1, (n - i) / (0.25 * sr)); }
        }
      }
      const pad = D.filter(D.filter(padRaw, D.biquad('lowpass', 1800, 0.7, 0, sr)), D.biquad('peaking', 300, 1, 4, sr));
      await step(0.6);

      // ---------- voz (síntese por formantes) ----------
      const VOW = { a: [[800, 1], [1150, 0.5], [2900, 0.25]], e: [[400, 1], [1700, 0.45], [2600, 0.3]], o: [[450, 1], [800, 0.6], [2830, 0.2]], i: [[300, 1], [2100, 0.4], [3000, 0.3]], u: [[325, 1], [700, 0.4], [2530, 0.15]] };
      const vowels = Object.keys(VOW);
      const voiceNote = (f, dur, vowel, breathy, sib) => {
        const n = Math.round(dur * sr), src = new Float32Array(n); let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr, vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5.4 * t) * Math.min(1, t / 0.25);
          ph += (f * vib) / sr; if (ph >= 1) ph -= 1;
          src[i] = (2 * ph - 1) * 0.6 + (R() * 2 - 1) * breathy;
        }
        const out = new Float32Array(n);
        for (const [fr, g] of VOW[vowel]) { const y = D.filter(src, D.biquad('bandpass', fr, 6, 0, sr)); for (let i = 0; i < n; i++) out[i] += y[i] * g; }
        for (let i = 0; i < n; i++) { const t = i / sr; out[i] *= Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.06); }
        if (sib) { const sn = Math.round(0.09 * sr), s = D.filter(noise(sn), D.biquad('highpass', 5500, 0.7, 0, sr)); for (let i = 0; i < sn && i < n; i++) out[i] += s[i] * 0.55 * Math.sin((Math.PI * i) / sn); }
        return out;
      };
      const breath = () => { const n = Math.round(0.35 * sr); const s = D.filter(noise(n), D.biquad('bandpass', 1800, 0.8, 0, sr)); for (let i = 0; i < n; i++) s[i] *= 0.18 * Math.sin((Math.PI * i) / n); return s; };
      const vox = mk(), bvL = mk(), bvR = mk(), adl = mk();
      const scale = [0, 2, 3, 5, 7, 8, 10]; // F♯ menor natural (relativo a F♯)
      const deg = (d) => 66 + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
      for (let b = 0; b < bars; b++) {
        const sec = secAt[b], t0 = b * bar;
        if (sec === 'Intro' || sec === 'Outro' || sec === 'Bridge') continue;
        const chorus = isChorus(b);
        const base = chorus ? 4 : 0;
        const rhythm = b % 2 ? [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 0.9]] : [[0, 0.5], [0.5, 0.5], [1, 1.5], [2.5, 0.5], [3, 0.6]];
        if (b % 4 === 3) rhythm.length = 3; // fim de frase
        if (b % 4 === 0) add(vox, t0 - 0.38, breath(), 1);
        rhythm.forEach(([x, d], k) => {
          const dg = base + ((b * 3 + k * 2 + (k % 2 ? 1 : 0)) % 5) - (k === rhythm.length - 1 ? 2 : 0);
          const f = mtof(deg(dg) - 12);
          const v = vowels[(b + k) % 5];
          add(vox, t0 + x * beat, voiceNote(f, d * beat, v, 0.06, k === 0 && b % 2 === 0), chorus ? 0.5 : 0.42);
          if (chorus) {
            add(bvL, t0 + x * beat + 0.01, voiceNote(mtof(deg(dg + 2) - 12), d * beat, v, 0.08, false), 0.16);
            add(bvR, t0 + x * beat + 0.018, voiceNote(mtof(deg(dg - 3) - 12) * 1.002, d * beat, v, 0.08, false), 0.15);
          }
        });
        if (chorus && b % 2 === 1) add(adl, t0 + 3.5 * beat, voiceNote(mtof(deg(base + 7) - 12), beat * 0.45, 'e', 0.1, false), 0.32);
        if (chorus && b % 4 === 1) add(adl, t0 + 3.75 * beat, voiceNote(mtof(deg(base + 9) - 12), beat * 0.3, 'o', 0.1, false), 0.25);
      }
      await step(0.85);

      // ---------- FX riser ----------
      const fx = mk();
      let bAcc = 0;
      this.SECTIONS.forEach(([n, nb]) => { if (/Refrão/.test(n)) { const t0 = (bAcc - 1) * bar, nr = Math.round(bar * sr); const nz = noise(nr); let y = 0; for (let i = 0; i < nr; i++) { const fc = 300 + 7000 * (i / nr) ** 2; const a = Math.min(0.99, (2 * Math.PI * fc) / sr); y += a * (nz[i] - y); nz[i] = y * 0.35 * (i / nr); } add(fx, t0, nz, 1); } bAcc += nb; });

      // guitarra R ligeiramente mais curta (desalinhamento de 20 ms para demonstrar o aviso)
      const gR = gtrR.slice(0, len - Math.round(0.02 * sr));

      const st = (L, Rr) => [L, Rr || L];
      const stems = [
        { name: 'Lead_Vox_Final.wav', ch: [vox] },
        { name: 'BV_L.wav', ch: [bvL] },
        { name: 'BV_R.wav', ch: [bvR] },
        { name: 'Adlibs.wav', ch: [adl] },
        { name: 'Kick.wav', ch: [kick] },
        { name: 'Snare_01.wav', ch: [snare] },
        { name: 'Bass.wav', ch: [shaker] }, // nome errado de propósito: é um shaker/hi-hat
        { name: 'HH.wav', ch: [hat] },
        { name: 'Audio 12.wav', ch: [perc] }, // nome genérico
        { name: 'Bass_DI.wav', ch: [bass] },
        { name: 'Gtr_L.wav', ch: [gtrL] },
        { name: 'Gtr_R.wav', ch: [gR] },
        { name: 'Piano.wav', ch: [piano] },
        { name: 'Pad_Warm.wav', ch: st(pad, pad.slice()) }, // estéreo com L = R (mono falso)
        { name: 'FX_Riser.wav', ch: [fx] },
      ];
      // níveis de entrada desiguais (para o gain staging ter trabalho)
      const trims = { 'Kick.wav': 0.95, 'HH.wav': 1.6, 'Piano.wav': 0.6, 'Bass_DI.wav': 1.4, 'Lead_Vox_Final.wav': 0.9 };
      stems.forEach((s) => { const g = trims[s.name] || 1; s.ch.forEach((c) => { for (let i = 0; i < c.length; i++) c[i] *= g; }); });
      await step(1);
      return { sampleRate: sr, stems, bars, bpm };
    },

    /** Faixa de referência: soma brilhante e comprimida das mesmas ideias (para demonstrar Referências). */
    makeReference(stemsChs, sr) {
      const n = Math.max(...stemsChs.map((c) => c[0].length));
      const L = new Float32Array(n), Rr = new Float32Array(n);
      const g = [0.9, 0.35, 0.35, 0.4, 1, 0.6, 0.3, 0.25, 0.4, 0.8, 0.3, 0.3, 0.35, 0.4, 0.3];
      const pans = [0, -0.6, 0.6, 0.3, 0, 0, 0.3, -0.25, -0.4, 0, -0.8, 0.8, 0.2, 0, 0];
      stemsChs.forEach((chs, k) => {
        const gl = g[k] * Math.cos(((pans[k] + 1) * Math.PI) / 4) * 1.41, gr = g[k] * Math.sin(((pans[k] + 1) * Math.PI) / 4) * 1.41;
        const a = chs[0], b = chs[1] || chs[0];
        for (let i = 0; i < a.length; i++) { L[i] += a[i] * gl; Rr[i] += b[i] * gr; }
      });
      let outL = D.filter(L, D.biquad('highshelf', 6000, 0.7, 3.5, sr)), outR = D.filter(Rr, D.biquad('highshelf', 6000, 0.7, 3.5, sr));
      outL = D.filter(outL, D.biquad('peaking', 3000, 0.8, 2, sr)); outR = D.filter(outR, D.biquad('peaking', 3000, 0.8, 2, sr));
      const lu = D.loudness([outL, outR], sr).integrated;
      const gain = D.db2lin(-7.5 - lu);
      for (let i = 0; i < n; i++) { outL[i] = Math.tanh(outL[i] * gain) * 0.89; outR[i] = Math.tanh(outR[i] * gain) * 0.89; }
      return [outL, outR];
    },
  };
})();
