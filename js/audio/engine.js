/* MIXMIND — motor de mistura (Web Audio)
 * O mesmo grafo é construído em tempo real (AudioContext) e para render (OfflineAudioContext),
 * garantindo que o que ouves é exatamente o que exportas.
 *
 * stem: trim → HPF 24 dB/oit → EQ ×6 → EQ dinâmico ×2 → de-esser → LPF → LPF automatizado →
 *       comp → comp série → transientes → saturação (dry/wet) → sidechain multibanda →
 *       rider → fader → pan → mute/solo → bus de grupo  (+ sends pós-fader para reverb/delay)
 * buses: drums (c/ paralelo) · bass · vocals · music · fx → mix bus (EQ, glue, saturação) → premaster
 * master: cadeia adaptativa (EQ · EQ dinâmico · multibanda · glue · saturação · M/S · clipper · limiter TP)
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const BW4 = [0.5412, 1.3066]; // Butterworth de 4.ª ordem em duas secções

  // ---------- respostas a impulso sintéticas ----------
  MM.makeIR = function (ctx, type, decay, damp) {
    const sr = ctx.sampleRate, n = Math.max(1, Math.round(sr * Math.min(5, decay * 1.02 + 0.05)));
    const b = ctx.createBuffer(2, n, sr);
    let seed = type === 'plate' ? 11 : type === 'room' ? 23 : 37;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const env = Math.exp((-6.9 * t) / decay);
        const build = type === 'hall' ? Math.min(1, t / 0.08) : type === 'room' ? 1 : Math.min(1, t / 0.006);
        const cutoff = D.clamp(damp * Math.exp(-t / (decay * 0.6)), 400, 18000);
        const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
        lp += a * (rnd() - lp);
        d[i] = lp * env * build;
      }
      if (type === 'room') for (let r = 0; r < 12; r++) { const i = Math.round(sr * (0.004 + r * 0.0071 + c * 0.0013)); if (i < n) d[i] += (r % 2 ? -1 : 1) * 0.5 * Math.exp(-r / 5); }
    }
    let e = 0;
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) e += d[i] * d[i]; }
    const g = 1 / Math.sqrt(e / 2 + 1e-9) * 0.5;
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] *= g; }
    return b;
  };

  /** EQ dinâmico em tempo real ligado (sidechain amostra a amostra). false = automação pré-calculada por blocos (v1.5). */
  MM.RT_DYN = true;
  /** Nível típico (p97, dB) de um stem numa banda, medido como o detetor do processador mm-scdyn (cache por stem). */
  MM.scRef = function (s, freq, q) {
    s._scref = s._scref || {};
    const key = Math.round(freq) + ':' + q;
    if (s._scref[key] !== undefined) return s._scref[key];
    const sr = s.buffer ? s.buffer.sampleRate : 48000, x = D.mono(s.chs);
    const c = D.biquad('bandpass', freq, q, 0, sr);
    const ka = Math.exp(-1 / (0.005 * sr)), kr = Math.exp(-1 / (0.08 * sr)), step = Math.round(sr * 0.01);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, env = 0;
    const lv = [];
    for (let i = 0; i < x.length; i++) {
      const xi = x[i], y = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y;
      const a = y * y; env = a > env ? ka * env + (1 - ka) * a : kr * env + (1 - kr) * a;
      if (i % step === 0 && env > 1e-12) lv.push(10 * Math.log10(env));
    }
    const v = lv.length ? D.percentile(lv, 0.97) : -60;
    s._scref[key] = v;
    return v;
  };
  MM.toAudioBuffer = function (chs, sr) {
    const b = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: sr });
    chs.forEach((c, i) => b.copyToChannel(c, i));
    return b;
  };

  // =====================================================================
  //   Grafo — só cria os módulos ativos; religa a cadeia quando a topologia muda
  // =====================================================================
  class Graph {
    constructor(ctx, state, opts) {
      this.ctx = ctx; this.state = state; this.opts = opts || {};
      this.offline = !!this.opts.offline;
      this.nyq = Math.min(22000, ctx.sampleRate / 2 - 200);
      this.stems = {}; this.gr = {}; this.fx = {};
      if (!this.opts.masterOnly) this.buildBuses();
      this.buildMaster();
      // só constrói os stems que vão soar (renders de stems individuais / instrumental ficam muito mais leves)
      if (!this.opts.masterOnly) state.stems.forEach((s) => { if (!s.removed && s.role !== 'Reference Track' && (!this.opts.filter || this.opts.filter(s))) this.buildStem(s); });
      // EQ dinâmico em tempo real: o stem protagonista (sidechain) tem de existir no grafo, mesmo que não soe neste render
      if (!this.opts.masterOnly && MM.RT_DYN) state.stems.forEach((s) => { if (!this.stems[s.id] || this.stems[s.id].frozen) return; (s.p.dyn || []).forEach((d) => { const a = state.stems.find((x) => x.id === d.src); if (a && !a.removed && !this.stems[a.id]) this.buildStem(a, true); }); });
      this.applyAll();
    }
    /** Atenção: no Web Audio o Q de lowpass/highpass é em dB (ressonância); convertemos de Q linear. */
    biq(type, f, q) {
      const b = this.ctx.createBiquadFilter(); b.type = type; if (f) b.frequency.value = f;
      if (type === 'lowpass' || type === 'highpass') b.Q.value = 20 * Math.log10(q || 0.7071);
      else if (q) b.Q.value = q;
      return b;
    }
    gain(v) { const g = this.ctx.createGain(); g.gain.value = v === undefined ? 1 : v; return g; }
    wnode(name, ch, key, init) {
      const n = new AudioWorkletNode(this.ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [ch], channelCount: ch, channelCountMode: 'explicit', processorOptions: { quiet: this.offline, init: init || null } });
      if (key && !this.offline) n.port.onmessage = (e) => { this.gr[key] = e.data.gr; };
      return n;
    }
    chain(nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes; }
    kr(param) { try { param.automationRate = 'k-rate'; } catch (e) { /* */ } }
    /** Liga in → módulos (pela ordem das chaves) → out, reaproveitando os módulos já criados. */
    rewire(holder, keys, inNode, outNode, make) {
      const sig = keys.join(',');
      if (holder.sig === sig) return false;
      try { inNode.disconnect(); } catch (e) { /* */ }
      Object.values(holder.mods).forEach((m) => { try { m.out.disconnect(); } catch (e) { /* */ } });
      let prev = inNode;
      keys.forEach((k) => { const m = holder.mods[k] || (holder.mods[k] = make(k)); prev.connect(m.in); prev = m.out; });
      prev.connect(outNode);
      holder.sig = sig;
      return true;
    }
    /** Saturação/clipper em AudioWorklet: oversampling 2× interno, dry e wet alinhados (latência fixa MM.SAT_LAT). */
    satMod(ch, init) { const w = this.wnode('mm-sat', ch || 2, null, init); return { in: w, out: w, node: w }; }

    // ---------- parâmetros dos processadores (usados na criação E nas atualizações) ----------
    pBusGlue() { const b = this.state.bus; return { thr: -18 + 9 - b.glue.gr / (1 - 1 / Math.max(1.01, b.glue.ratio)), ratio: b.glue.ratio, atk: b.glue.atk, rel: b.glue.rel, knee: 6, makeup: b.glue.gr * 0.5, mix: 1, bypass: false }; }
    pBusSat() { const b = this.state.bus; return { model: b.sat.model, drive: b.sat.drive, mix: b.sat.mix }; }
    pDrumPar() { return { thr: -32, ratio: 6, atk: 3, rel: 80, knee: 4, makeup: 10, mix: 1 }; }
    pMDyn() { const ch = this.state.master.chain; return { bands: [{ freq: 320, q: 1.2, cut: -Math.min(0, ch.dyn.mud || 0), on: true, thr: 1 }, { freq: 3200, q: 1.3, cut: -Math.min(0, ch.dyn.harsh || 0), on: true, thr: 1 }] }; }
    pMMb(i) { return Object.assign({ knee: 6, makeup: 0, mix: 1 }, this.state.master.chain.mb.bands[i], { bypass: false }); }
    pMGlue() { const g = this.state.master.chain.glue; return { thr: g.thr, ratio: g.ratio, atk: g.atk, rel: g.rel, knee: 6, makeup: 0, mix: 1, bypass: false }; }
    pMSat() { const c = this.state.master.chain.sat; return { model: c.model, drive: Math.max(0.001, c.drive), mix: c.mix }; }
    pMClip() { const M = this.state.master; return { model: 'clip', thr: Math.min(1.9, D.db2lin(M.ceiling + (M.ceilAdj || 0) + 2 - 2.5 * (M.chain.clip.amount || 0))), mix: 1, drive: 0 }; }
    pMLim() { const M = this.state.master, l = M.chain.lim; return { ceiling: M.ceiling + (M.ceilAdj || 0), lookahead: l.lookahead, release: l.release, releaseSlow: l.releaseSlow || l.release * 2.5, susTime: l.susTime || 1.5, inGain: 0, bypass: false }; }
    pComp(s, k) { return Object.assign({}, s.p[k], { bypass: false }); }
    /** Parâmetros do EQ dinâmico com sidechain: referência = nível típico (p97) do protagonista nessa banda, já com o seu ganho. */
    pScDyn(s, i) {
      const d = (s.p.dyn || [])[i];
      if (!d) return { cut: 0 };
      const a = this.state.stems.find((x) => x.id === d.src);
      const ref = a ? MM.scRef(a, d.freq, d.q || 1.4) + a.p.trim + a.p.fader : -30;
      return { freq: d.freq, q: d.q || 1.4, cut: d.cut || 0, ref, below: 22, range: 10, atk: 0.01, rel: 0.15, bypass: !!(this.bypass && this.bypass.has('dyn' + i + ':' + s.id)) };
    }
    pTrans(s) { return { attack: s.p.trans.attack, sustain: s.p.trans.sustain, bypass: false }; }
    pSat(s) { return { model: s.p.sat.model, drive: s.p.sat.drive, mix: s.p.sat.mix }; }

    // ---------- buses ----------
    buildBuses() {
      this.origBus = this.gain(1);
      this.groups = {};
      this.mixBus = this.gain(1);
      this.mixOut = this.gain(1);
      ['drums', 'bass', 'vocals', 'music', 'fx', 'ref'].forEach((g) => { this.groups[g] = this.gain(1); this.groups[g].connect(this.mixBus); });
      this.busH = { mods: {}, sig: null };
    }
    applyBus() {
      if (!this.mixBus) return;
      const b = this.state.bus;
      const keys = [];
      if (Math.abs(b.eq.low || 0) > 0.05) keys.push('low');
      if (Math.abs(b.eq.high || 0) > 0.05) keys.push('high');
      if (b.glue.on) keys.push('glue');
      if (b.sat.on && b.sat.drive > 0) keys.push('sat');
      this.rewire(this.busH, keys, this.mixBus, this.mixOut, (k) => {
        if (k === 'low') { const f = this.biq('lowshelf', 100); return { in: f, out: f, node: f }; }
        if (k === 'high') { const f = this.biq('highshelf', 10000); return { in: f, out: f, node: f }; }
        if (k === 'glue') { const w = this.wnode('mm-comp', 2, 'busGlue', this.pBusGlue()); return { in: w, out: w, node: w }; }
        return this.satMod(2, this.pBusSat());
      });
      const M = this.busH.mods;
      if (M.low) M.low.node.gain.value = b.eq.low;
      if (M.high) M.high.node.gain.value = b.eq.high;
      this.mixBus.gain.value = D.db2lin(b.trim || 0);
      if (M.glue) M.glue.node.port.postMessage(this.pBusGlue());
      if (M.sat) M.sat.node.port.postMessage(this.pBusSat());
      // compressão paralela da bateria
      const parOn = b.drumPar.on;
      if (parOn && !this.drumPar) {
        this.drumPar = this.wnode('mm-comp', 2, 'drumPar', this.pDrumPar()); this.drumWet = this.gain(0);
        this.drumPar.connect(this.drumWet).connect(this.mixBus);
      }
      if (this.drumPar) {
        if (parOn && !this.drumParOn) { this.groups.drums.connect(this.drumPar); this.drumParOn = true; }
        if (!parOn && this.drumParOn) { this.groups.drums.disconnect(this.drumPar); this.drumParOn = false; }
        this.drumWet.gain.value = parOn ? b.drumPar.mix * 0.6 : 0;
      }
    }
    ensureFx(t) {
      if (this.fx[t]) return this.fx[t];
      if (t === 'delay') {
        const d = { input: this.gain(1), hpf: this.biq('highpass', 300), lpf: this.biq('lowpass', 5500), dl: this.ctx.createDelay(4), dr: this.ctx.createDelay(4), fbl: this.gain(0.3), fbr: this.gain(0.3), merge: this.ctx.createChannelMerger(2), duck: this.gain(1), ret: this.gain(0.9) };
        d.input.channelCount = 1; d.input.channelCountMode = 'explicit';
        this.chain([d.input, d.hpf, d.lpf, d.dl]);
        d.dl.connect(d.fbl).connect(d.dr); d.dr.connect(d.fbr).connect(d.dl);
        d.dl.connect(d.merge, 0, 0); d.dr.connect(d.merge, 0, 1);
        this.chain([d.merge, d.duck, d.ret, this.mixBus]);
        this.fx.delay = d;
      } else {
        const r = { input: this.gain(1), pre: this.ctx.createDelay(1), conv: this.ctx.createConvolver(), hpf: this.biq('highpass', 250), lpf: this.biq('lowpass', 9000), duck: this.gain(1), ret: this.gain(1) };
        r.conv.normalize = false;
        this.chain([r.input, r.pre, r.conv, r.hpf, r.lpf, r.duck, r.ret, this.mixBus]);
        this.fx[t] = r;
      }
      this.applyFx();
      return this.fx[t];
    }
    applyFx() {
      const fx = this.state.fx;
      this.irKey = this.irKey || {};
      ['plate', 'room', 'hall'].forEach((t) => {
        const r = this.fx[t];
        if (!r) return;
        const cfg = fx[t];
        const key = cfg.decay.toFixed(2) + ':' + cfg.lpf;
        if (this.irKey[t] !== key) { r.conv.buffer = MM.makeIR(this.ctx, t, cfg.decay, Math.min(16000, cfg.lpf * 1.5)); this.irKey[t] = key; if (r.convS) r.morphKey = null; }
        // tamanho automatizável: três respostas (curta ½×, normal, longa 2×) em crossfade de potência constante
        if (this.fxLane(t, 'size')) {
          if (!r.convS) {
            r.convS = this.ctx.createConvolver(); r.convL = this.ctx.createConvolver(); r.convS.normalize = r.convL.normalize = false;
            r.gM = this.gain(1); r.gS = this.gain(0); r.gL = this.gain(0);
            try { r.conv.disconnect(); } catch (e) { /* */ }
            r.conv.connect(r.gM).connect(r.hpf);
            r.pre.connect(r.convS); r.convS.connect(r.gS).connect(r.hpf);
            r.pre.connect(r.convL); r.convL.connect(r.gL).connect(r.hpf);
          }
          if (r.morphKey !== key) { r.convS.buffer = MM.makeIR(this.ctx, t, Math.max(0.25, cfg.decay * 0.5), Math.min(16000, cfg.lpf * 1.6)); r.convL.buffer = MM.makeIR(this.ctx, t, Math.min(4.8, cfg.decay * 2), Math.min(16000, cfg.lpf * 1.3)); r.morphKey = key; }
        } else if (r.convS) { [r.gM, r.gS, r.gL].forEach((g, j) => { g.gain.cancelScheduledValues(0); g.gain.value = j ? 0 : 1; }); }
        r.pre.delayTime.value = (cfg.predelay || 0) / 1000;
        r.hpf.frequency.value = cfg.hpf || 250;
        r.lpf.frequency.value = Math.min(this.nyq, cfg.lpf || 9000);
        r.ret.gain.value = D.db2lin(cfg.ret || 0);
      });
      const d = this.fx.delay;
      if (d) {
        const c = fx.delay;
        d.dl.delayTime.value = c.time; d.dr.delayTime.value = c.time;
        if (!this.fxLane('delay', 'feedback')) { [d.fbl, d.fbr].forEach((g) => { g.gain.cancelScheduledValues(0); g.gain.value = c.feedback; }); }
        d.lpf.frequency.value = c.lpf || 5500;
        d.ret.gain.value = D.db2lin(c.ret || 0);
      }
    }

    // ---------- master ----------
    buildMaster() {
      const m = (this.m = { mods: {}, sig: null });
      m.input = this.gain(1);
      m.output = this.gain(1);
      this.eqH = { mods: {}, sig: null };
    }
    masterKeys() {
      const ch = this.state.master.chain;
      const keys = this.state.master.order.filter((k) => {
        const c = ch[k];
        if (!c || !c.on) return false;
        if (k === 'eq') return this.masterEQBands().length > 0;
        if (k === 'dyn') return (c.mud || 0) < -0.05 || (c.harsh || 0) < -0.05;
        if (k === 'sat') return c.drive > 0;
        if (k === 'clip') return c.amount > 0;
        return true;
      });
      // o ganho de entrada (drive) entra só antes do clipper/limiter, como numa cadeia de mastering real
      let i = keys.findIndex((k) => k === 'clip' || k === 'lim');
      if (i < 0) i = keys.length;
      keys.splice(i, 0, 'drive');
      return keys;
    }
    eqKeys() {
      const e = this.state.master.chain.eq, k = [];
      [['low', e.low], ['mud', e.mud], ['pres', e.pres], ['air', e.air]].forEach(([n, g]) => { if (Math.abs(g || 0) > 0.05) k.push(n); });
      (e.ref || []).forEach((g, i) => { if (Math.abs(g || 0) > 0.05) k.push('r' + i); });
      return k;
    }
    makeMasterMod(k) {
      const c = this.ctx;
      if (k === 'eq') { const i = this.gain(1), o = this.gain(1); return { in: i, out: o }; }
      if (k === 'drive') { const g = this.gain(1); return { in: g, out: g, node: g }; }
      if (k === 'dyn') { const w = this.wnode('mm-dyneq', 2, 'mDyn', this.pMDyn()); return { in: w, out: w, node: w }; }
      if (k === 'glue') { const w = this.wnode('mm-comp', 2, 'mGlue', this.pMGlue()); return { in: w, out: w, node: w }; }
      if (k === 'lim') { const w = this.wnode('mm-limiter', 2, 'mLim', this.pMLim()); return { in: w, out: w, node: w }; }
      if (k === 'sat') return this.satMod(2, this.pMSat());
      if (k === 'mb') {
        const mbIn = this.gain(1), mbOut = this.gain(1);
        const lr = (type, f) => { const a = this.biq(type, f, 0.7071), b = this.biq(type, f, 0.7071); a.connect(b); return [a, b]; };
        const x1 = [lr('lowpass', 120), lr('highpass', 120)], x2 = [lr('lowpass', 2500), lr('highpass', 2500)];
        const comps = [0, 1, 2].map((i) => this.wnode('mm-comp', 2, 'mb' + i, this.pMMb(i)));
        // a banda grave passa pelo all-pass equivalente ao cruzamento alto (LR4 = all-pass 2.ª ordem, Q 0,707): soma plana
        const ap = this.biq('allpass', 2500, 0.7071);
        mbIn.connect(x1[0][0]); x1[0][1].connect(ap).connect(comps[0]).connect(mbOut);
        mbIn.connect(x1[1][0]);
        x1[1][1].connect(x2[0][0]); x2[0][1].connect(comps[1]).connect(mbOut);
        x1[1][1].connect(x2[1][0]); x2[1][1].connect(comps[2]).connect(mbOut);
        return { in: mbIn, out: mbOut, x1, x2, comps, ap };
      }
      if (k === 'ms') {
        const msIn = this.gain(1), split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
        msIn.channelCount = 2; msIn.channelCountMode = 'explicit';
        const mid = this.gain(1), side = this.gain(1);
        [mid, side].forEach((g) => { g.channelCount = 1; g.channelCountMode = 'explicit'; });
        msIn.connect(split);
        split.connect(this.gain(0.5), 0).connect(mid); split.connect(this.gain(0.5), 1).connect(mid);
        split.connect(this.gain(0.5), 0).connect(side); split.connect(this.gain(-0.5), 1).connect(side);
        // "bass mono" correto: lateral passa por um HP Linkwitz-Riley (LR4) e o centro por um all-pass igual
        // (LR4 LP+HP = all-pass 2.ª ordem) → acima do corte, centro e lateral mantêm a mesma fase (imagem intacta).
        const hp = [this.biq('highpass', 120, 0.7071), this.biq('highpass', 120, 0.7071)];
        const ap = this.biq('allpass', 120, 0.7071);
        const width = this.gain(1), widthAuto = this.gain(1), neg = this.gain(-1);
        this.chain([side, hp[0], hp[1], width, widthAuto]);
        ap.channelCount = 1; ap.channelCountMode = 'explicit';
        mid.connect(ap); ap.connect(merge, 0, 0); ap.connect(merge, 0, 1);
        widthAuto.connect(merge, 0, 0); widthAuto.connect(neg).connect(merge, 0, 1);
        return { in: msIn, out: merge, hp, ap, width, widthAuto };
      }
      if (k === 'clip') return this.satMod(2, this.pMClip());
    }
    /** Bandas do EQ tonal do master (tipo, frequência, Q, ganho). */
    masterEQBands() {
      const e = this.state.master.chain.eq;
      const map = { low: ['lowshelf', 80, 0.7071], mud: ['peaking', 300, 1], pres: ['peaking', 3000, 0.9], air: ['highshelf', 9000, 0.7071] };
      const RF = [['lowshelf', 40, 0.7071], ['peaking', 110, 0.8], ['peaking', 320, 0.8], ['peaking', 1000, 0.8], ['peaking', 3200, 0.8], ['peaking', 7000, 0.8], ['highshelf', 14000, 0.7071]];
      const out = [];
      [['low', e.low], ['mud', e.mud], ['pres', e.pres], ['air', e.air]].forEach(([k, g]) => { if (Math.abs(g || 0) > 0.05) out.push(map[k].concat([g])); });
      (e.ref || []).forEach((g, i) => { if (Math.abs(g || 0) > 0.05) out.push(RF[i].concat([g])); });
      return out;
    }
    /**
     * EQ do master com biquads "matched" (sem o aperto da bilinear perto de Nyquist) em IIRFilterNode,
     * ou em fase linear (FIR por convolução, latência N/2 compensada nos monitores e nos renders).
     */
    buildMasterEQ(mod) {
      const e = this.state.master.chain.eq, sr = this.ctx.sampleRate;
      const bands = this.masterEQBands(), linear = e.phase === 'linear';
      const sig = JSON.stringify([bands, linear, sr]);
      if (this.eqSig === sig) return;
      this.eqSig = sig;
      try { mod.in.disconnect(); } catch (er) { /* */ }
      (this.eqNodes || []).forEach((n) => { try { n.disconnect(); } catch (er) { /* */ } });
      this.eqNodes = [];
      const coefs = bands.map(([t, f, q, g]) => D.matched(t, f, q, g, sr));
      if (!coefs.length) { mod.in.connect(mod.out); this.eqLatency = 0; return; }
      if (linear) {
        const N = sr > 50000 ? 16384 : 8192;
        const h = D.linearPhaseFIR((f) => coefs.reduce((a, c) => a * D.biquadMag(c, Math.max(1, f), sr), 1), N, sr);
        const conv = this.ctx.createConvolver(); conv.normalize = false;
        const b = this.ctx.createBuffer(2, N, sr); b.copyToChannel(h, 0); b.copyToChannel(h, 1); conv.buffer = b;
        mod.in.connect(conv).connect(mod.out); this.eqNodes = [conv];
        this.eqLatency = N / 2;
      } else {
        let prev = mod.in;
        coefs.forEach((c) => { const n = this.ctx.createIIRFilter([c.b0, c.b1, c.b2], [1, c.a1, c.a2]); prev.connect(n); prev = n; this.eqNodes.push(n); });
        prev.connect(mod.out);
        this.eqLatency = 0;
      }
    }
    setLatency(n) { if ((this.masterLatency || 0) !== n) { this.masterLatency = n; if (this.onLatency) this.onLatency(n); } }
    connectMaster() {
      return this.rewire(this.m, this.masterKeys(), this.m.input, this.m.output, (k) => this.makeMasterMod(k));
    }
    applyMaster() {
      const M = this.state.master, ch = M.chain, m = this.m;
      this.connectMaster();
      const mods = m.mods;
      m.input.gain.value = 1;
      if (mods.drive) mods.drive.node.gain.value = D.db2lin(M.inGain || 0);
      const keys = m.sig.split(',');
      if (mods.eq && keys.includes('eq')) this.buildMasterEQ(mods.eq);
      // latência total do master: FIR de fase linear (N/2) + look-ahead do limiter (L+3) + oversampling da saturação/clipper — compensada nos renders e na monitorização
      const sr = this.ctx.sampleRate, limLat = mods.lim && keys.includes('lim') ? Math.max(8, Math.min(Math.ceil(sr * 0.02), Math.round((ch.lim.lookahead || 4) * 0.001 * sr))) + 3 : 0;
      const satLat = 23 * keys.filter((k) => k === 'sat' || k === 'clip').length; // saturação/clipper 2× oversampling: 23 amostras cada
      this.setLatency((mods.eq && keys.includes('eq') ? this.eqLatency || 0 : 0) + limLat + satLat);
      if (mods.dyn) mods.dyn.node.port.postMessage(this.pMDyn());
      if (mods.mb) {
        mods.mb.x1.forEach((x) => x.forEach((b) => (b.frequency.value = ch.mb.xLow)));
        mods.mb.x2.forEach((x) => x.forEach((b) => (b.frequency.value = ch.mb.xHigh)));
        mods.mb.ap.frequency.value = ch.mb.xHigh;
        ch.mb.bands.forEach((b, i) => mods.mb.comps[i].port.postMessage(this.pMMb(i)));
      }
      if (mods.glue) mods.glue.node.port.postMessage(this.pMGlue());
      if (mods.sat) mods.sat.node.port.postMessage(this.pMSat());
      if (mods.ms) { mods.ms.width.gain.value = (M.width || 100) / 100; mods.ms.hp.forEach((b) => (b.frequency.value = ch.ms.monoBelow || 120)); mods.ms.ap.frequency.value = ch.ms.monoBelow || 120; }
      if (mods.clip) mods.clip.node.port.postMessage(this.pMClip());
      if (mods.lim) mods.lim.node.port.postMessage(this.pMLim());
    }

    // ---------- stem ----------
    buildStem(s, scOnly) {
      const c = this.ctx, n = { mods: {}, sig: null, scOnly: !!scOnly };
      if (scOnly) {
        // só alimenta o sidechain de outro stem: processa até ao fader e não vai para o bus
        n.trim = this.gain(1); n.ride = this.gain(1); n.fader = this.gain(1); n.pan = c.createStereoPanner(); n.ms = this.gain(1);
        n.pdc = c.createDelay(0.05); n.lat = 0; n.sm = this.gain(1); n.panAuto = c.createStereoPanner();
        this.chain([n.pdc, n.sm, n.ride, n.fader]);
        this.stems[s.id] = n;
        return;
      }
      const fz = this.opts.frozen && this.opts.frozen[s.id];
      if (fz) {
        // stem "congelado" (cache por stem): o áudio já processado até ao fader entra direto no pan.
        // trim/ride/fader/sm existem só para a automação não falhar — não estão ligados.
        n.frozen = fz; n.trim = this.gain(1); n.ride = this.gain(1); n.fader = this.gain(1); n.sm = this.gain(1);
        n.pdc = c.createDelay(0.05); n.lat = fz.lat; n.out = this.gain(1); n.scTap = n.out;
        n.pan = c.createStereoPanner(); n.panAuto = c.createStereoPanner(); n.ms = this.gain(1);
        this.chain([n.out, n.pan, n.panAuto, n.ms, this.groups[s.group] || this.groups.music]);
        this.stems[s.id] = n;
        return;
      }
      if (!this.offline || this.opts.needOrig) { n.raw = this.gain(1); n.raw.connect(this.origBus); }
      n.trim = this.gain(1); n.ride = this.gain(1); n.fader = this.gain(1); n.pan = c.createStereoPanner(); n.ms = this.gain(1);
      // compensação de latência (PDC): todos os stems chegam ao bus alinhados à amostra
      n.pdc = c.createDelay(0.05); n.lat = 0;
      // n.sm: mute por secção (antes do rider: os retornos de reverb/delay acabam naturalmente)
      n.sm = this.gain(1);
      // n.panAuto: movimento de pan automatizado, somado ao pan fixo (em 0 é transparente)
      n.panAuto = c.createStereoPanner();
      this.chain([n.pdc, n.sm, n.ride, n.fader, n.pan, n.panAuto, n.ms, this.groups[s.group] || this.groups.music]);
      if (!this.offline) { n.meter = c.createAnalyser(); n.meter.fftSize = 512; n.ms.connect(n.meter); }
      this.stems[s.id] = n;
    }
    hasLane(s, param) { return (this.state.automation || []).some((l) => l.target.type === 'stem' && l.target.id === s.id && l.target.param === param); }
    /** Índices das bandas de EQ com ganho automatizado (a lane guarda a frequência; a banda é encontrada por ela). */
    eqBandOf(s, t) {
      const eq = s.p.eq || [];
      let best = -1, bd = 0.35;
      eq.forEach((e, i) => { if (e && e.on && i < 8) { const d = Math.abs(Math.log2(e.freq / (t.freq || 1000))); if (d < bd) { bd = d; best = i; } } });
      return best;
    }
    eqLaneIdx(s) { return (this.state.automation || []).filter((l) => l.target.type === 'stem' && l.target.id === s.id && l.target.param === 'eqg').map((l) => this.eqBandOf(s, l.target)).filter((i) => i >= 0); }
    fxLane(t, param) { return (this.state.automation || []).some((l) => l.target.type === 'fx' && l.target.id === t && l.target.param === param); }
    /** Lane de envio em valor absoluto (criada pelo utilizador): o envio fixo passa a 0 dB e a lane manda. */
    absLane(s, param) { return (this.state.automation || []).some((l) => l.abs && l.target.type === 'stem' && l.target.id === s.id && l.target.param === param); }
    stemKeys(s) {
      const p = s.p, k = [];
      if (p.hpf.on) k.push('hp0', 'hp1');
      if (this.hasLane(s, 'hpf')) k.push('ahpf');
      p.eq.forEach((e, i) => { if (e && e.on && i < 8) k.push('eq' + i); });
      (p.dyn || []).forEach((d, i) => { if (i < 2) k.push('dyn' + i); });
      if (p.deess.on) k.push('deess');
      if (p.lpf.on) k.push('lpf');
      if (this.hasLane(s, 'lpf')) k.push('alpf');
      if (p.comp.on) k.push('comp');
      if (p.comp2.on) k.push('comp2');
      if (p.trans.on) k.push('trans');
      if (p.sat.on && p.sat.drive > 0) k.push('sat');
      if (p.duck && p.duck.on) k.push('duck');
      return k;
    }
    makeStemMod(s, k) {
      const ch = s.chs.length;
      if (k === 'hp0' || k === 'hp1') { const f = this.biq('highpass', 80, BW4[k === 'hp0' ? 0 : 1]); return { in: f, out: f, node: f }; }
      if (k.startsWith('eq') || k === 'lpf') { const f = this.biq(k === 'lpf' ? 'lowpass' : 'peaking', 1000, 0.7071); return { in: f, out: f, node: f }; }
      if (k.startsWith('dyn') && MM.RT_DYN) {
        const w = new AudioWorkletNode(this.ctx, 'mm-scdyn', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [ch], channelCount: ch, channelCountMode: 'explicit', processorOptions: { quiet: this.offline, init: this.pScDyn(s, +k.slice(3)) } });
        if (!this.offline) w.port.onmessage = (e) => { this.gr['dyn' + k.slice(3) + ':' + s.id] = e.data.gr; };
        return { in: w, out: w, node: w, rt: true, sc: null };
      }
      if (k.startsWith('dyn') || k === 'deess') { const f = this.biq('peaking', 1000, 1.4); this.kr(f.gain); return { in: f, out: f, node: f }; }
      if (k === 'alpf') { const f = this.biq('lowpass', this.nyq, 0.7071); this.kr(f.frequency); return { in: f, out: f, node: f }; }
      if (k === 'ahpf') { const f = this.biq('highpass', 20, 0.7071); this.kr(f.frequency); return { in: f, out: f, node: f }; }
      if (k === 'comp' || k === 'comp2') {
        const w = this.wnode('mm-comp', ch, (k === 'comp' ? 'c:' : 'c2:') + s.id, this.pComp(s, k));
        if (k === 'comp2') return { in: w, out: w, node: w };
        // threshold automatizável: −v dB à entrada e +v dB à saída equivale a subir o threshold v dB
        const pre = this.gain(1), post = this.gain(1); pre.connect(w).connect(post);
        return { in: pre, out: post, node: w, pre, post };
      }
      if (k === 'trans') { const w = this.wnode('mm-trans', ch, null, this.pTrans(s)); return { in: w, out: w, node: w }; }
      if (k === 'sat') return this.satMod(ch, this.pSat(s));
      if (k === 'duck') {
        const i = this.gain(1), o = this.gain(1), g = this.gain(1);
        const lo = [this.biq('lowpass', 120, 0.7071), this.biq('lowpass', 120, 0.7071)], hi = [this.biq('highpass', 120, 0.7071), this.biq('highpass', 120, 0.7071)];
        this.chain([i, lo[0], lo[1], g, o]); this.chain([i, hi[0], hi[1], o]);
        return { in: i, out: o, node: g, lo, hi };
      }
    }
    applyStem(s) {
      const n = this.stems[s.id];
      if (!n) return;
      const p = s.p, t = this.ctx.currentTime;
      const setp = (param, v) => { if (this.offline) param.value = v; else param.setTargetAtTime(v, t, 0.015); };
      if (!n.frozen) this.rewire(n, this.stemKeys(s), n.trim, n.pdc, (k) => this.makeStemMod(s, k));
      const M = n.mods;
      n.lat = n.frozen ? n.frozen.lat : (n.sig || '').split(',').includes('sat') ? MM.SAT_LAT : 0;
      if (!this._bulk) this.updatePDC();
      setp(n.trim.gain, D.db2lin(p.trim) * (p.polarity ? -1 : 1));
      const al = D.clamp(+p.align || 0, 0, 20);
      if (al !== (n.align || 0)) { n.align = al; if (this._bulk) this._pdcDirty = true; else this.updatePDC(); }
      if (M.hp0) { M.hp0.node.frequency.value = p.hpf.freq; M.hp1.node.frequency.value = p.hpf.freq; }
      p.eq.forEach((e, i) => {
        const m = M['eq' + i];
        if (!m || !e) return;
        m.node.type = e.type; m.node.frequency.value = D.clamp(e.freq, 20, this.nyq); m.node.Q.value = e.q || 1;
        // ganho automatizado: o valor fixo entra pela automação (reagendada), nunca por cima da curva
        if (this.eqLaneIdx(s).includes(i)) { if (this.offline) m.node.gain.value = e.gain; else this._needResched = true; }
        else setp(m.node.gain, e.gain);
      });
      if (M.comp && M.comp.pre && !this.hasLane(s, 'cthr')) [M.comp.pre, M.comp.post].forEach((g) => { g.gain.cancelScheduledValues(0); g.gain.value = 1; });
      (p.dyn || []).forEach((d, i) => {
        const m = M['dyn' + i];
        if (!m) return;
        if (m.rt) {
          m.node.port.postMessage(this.pScDyn(s, i));
          // liga o sidechain (pós-fader do protagonista) uma vez; muda se a fonte mudar
          const src = this.stems[d.src];
          if (src && m.sc !== d.src) { try { if (m.scNode) m.scNode.disconnect(m.node); } catch (e) { /* */ } (src.scTap || src.fader).connect(m.node, 0, 1); m.sc = d.src; m.scNode = src.scTap || src.fader; }
        } else { m.node.frequency.value = d.freq; m.node.Q.value = d.q || 1.4; }
      });
      if (M.deess) { M.deess.node.frequency.value = p.deess.freq || 6500; M.deess.node.Q.value = 2.5; }
      if (M.lpf) M.lpf.node.frequency.value = Math.min(p.lpf.freq, this.nyq);
      if (M.comp) M.comp.node.port.postMessage(this.pComp(s, 'comp'));
      if (M.comp2) M.comp2.node.port.postMessage(this.pComp(s, 'comp2'));
      if (M.trans) M.trans.node.port.postMessage(this.pTrans(s));
      if (M.sat) M.sat.node.port.postMessage(this.pSat(s));
      if (M.duck) { M.duck.lo.concat(M.duck.hi).forEach((b) => (b.frequency.value = p.duck.freq || 120)); }
      setp(n.fader.gain, D.db2lin(p.fader));
      setp(n.pan.pan, D.clamp(p.pan, -1, 1));
      // solo é só de escuta: os renders (premaster, master, export) ignoram-no; o mute é respeitado
      const anySolo = !this.offline && this.state.stems.some((x) => x.solo && !x.removed);
      const on = s.mute ? 0 : anySolo && !s.solo ? 0 : 1;
      setp(n.ms.gain, on); if (n.raw) setp(n.raw.gain, on);
      if (this.opts.tap) return; // medição por stem: sem envios para efeitos
      // sends (criados só quando usados)
      const revOn = p.sendRev > -59 || this.hasLane(s, 'sendRev');
      if (revOn && !n.sendRev) { n.sendRev = this.gain(0); n.revAuto = this.gain(1); n.ms.connect(n.sendRev).connect(n.revAuto); }
      if (n.sendRev) {
        setp(n.sendRev.gain, this.absLane(s, 'sendRev') ? 1 : p.sendRev <= -59 ? 0 : D.db2lin(p.sendRev));
        const type = p.revType || 'plate';
        if (n.revType !== type) { if (n.revType) n.revAuto.disconnect(); n.revAuto.connect(this.ensureFx(type).input); n.revType = type; }
      }
      const dlyOn = p.sendDly > -59 || this.hasLane(s, 'sendDly');
      if (dlyOn && !n.sendDly) { n.sendDly = this.gain(0); n.dlyAuto = this.gain(1); n.ms.connect(n.sendDly).connect(n.dlyAuto).connect(this.ensureFx('delay').input); }
      if (n.sendDly) setp(n.sendDly.gain, this.absLane(s, 'sendDly') ? 1 : p.sendDly <= -59 ? 0 : D.db2lin(p.sendDly));
    }
    updatePDC() {
      const all = Object.values(this.stems);
      const mx = all.reduce((a, n) => Math.max(a, n.lat || 0), 0);
      all.forEach((n) => { const d = (mx - (n.lat || 0)) / this.ctx.sampleRate + (n.align || 0) / 1000; if (Math.abs(n.pdc.delayTime.value - d) > 1e-9) n.pdc.delayTime.value = d; });
      this.stemLatency = mx;
    }
    applyAll() {
      if (!this.opts.masterOnly) {
        this._bulk = true;
        this.state.stems.forEach((s) => this.stems[s.id] && this.applyStem(s));
        this._bulk = false; this._pdcDirty = false; this.updatePDC();
        this.applyBus(); this.applyFx();
      }
      this.applyMaster();
    }

    // ---------- automação ----------
    laneParam(l) {
      const t = l.target;
      const sendConv = l.abs ? (v) => (v <= -59 ? 0 : D.db2lin(v)) : D.db2lin;
      if (t.type === 'master') {
        if (t.param === 'fade') return this.opts.noFade ? null : { p: this.m.output.gain, conv: (v) => (v <= -59 ? 0 : D.db2lin(v)) };
        return t.param === 'width' && this.m.mods.ms && (this.m.sig || '').split(',').includes('ms') ? { p: this.m.mods.ms.widthAuto.gain, conv: (v) => v / 100 } : null;
      }
      if (t.type === 'fx') {
        const f = this.fx[t.id];
        if (!f) return null;
        if (t.param === 'size') {
          if (!f.convS) return null;
          const w = (v) => { const x = D.clamp(v, 0, 100); return x <= 50 ? [Math.cos((x / 50) * Math.PI / 2), Math.sin((x / 50) * Math.PI / 2), 0] : [0, Math.cos(((x - 50) / 50) * Math.PI / 2), Math.sin(((x - 50) / 50) * Math.PI / 2)]; };
          return { p: f.gM.gain, conv: (v) => w(v)[1], also: [{ p: f.gS.gain, conv: (v) => w(v)[0] }, { p: f.gL.gain, conv: (v) => w(v)[2] }] };
        }
        if (t.param === 'feedback') return f.fbl ? { p: f.fbl.gain, conv: (v) => D.clamp(v, 0, 95) / 100, also: [{ p: f.fbr.gain, conv: (v) => D.clamp(v, 0, 95) / 100 }] } : null;
        return { p: f.duck.gain, conv: D.db2lin };
      }
      const n = this.stems[t.id];
      if (!n) return null;
      const M = n.mods, act = (n.sig || '').split(',');
      const mod = (k) => (M[k] && act.includes(k) ? M[k] : null);
      switch (t.param) {
        case 'ride': return { p: n.ride.gain, conv: D.db2lin };
        case 'sendRev': return n.revAuto ? { p: n.revAuto.gain, conv: sendConv } : null;
        case 'sendDly': return n.dlyAuto ? { p: n.dlyAuto.gain, conv: sendConv } : null;
        case 'pan': return { p: n.panAuto.pan, conv: (v) => D.clamp(v / 100, -1, 1) };
        case 'hpf': return mod('ahpf') ? { p: M.ahpf.node.frequency, conv: (v) => D.clamp(v, 10, this.nyq) } : null;
        case 'lpf': return mod('alpf') ? { p: M.alpf.node.frequency, conv: (v) => Math.min(this.nyq, v) } : null;
        case 'duck': return mod('duck') ? { p: M.duck.node.gain, conv: D.db2lin } : null;
        case 'dyn0': return mod('dyn0') && !M.dyn0.rt ? { p: M.dyn0.node.gain, conv: (v) => v } : null;
        case 'dyn1': return mod('dyn1') && !M.dyn1.rt ? { p: M.dyn1.node.gain, conv: (v) => v } : null;
        case 'deess': return mod('deess') ? { p: M.deess.node.gain, conv: (v) => v } : null;
        case 'cthr': return mod('comp') && M.comp.pre ? { p: M.comp.pre.gain, conv: (v) => D.db2lin(-v), also: [{ p: M.comp.post.gain, conv: (v) => D.db2lin(v) }] } : null;
        case 'eqg': {
          const s = this.state.stems.find((x) => x.id === t.id), i = s ? this.eqBandOf(s, t) : -1;
          if (i < 0 || !mod('eq' + i)) return null;
          const e = s.p.eq[i];
          return { p: M['eq' + i].node.gain, conv: (v) => D.clamp((e.gain || 0) + v, -24, 24) };
        }
      }
      return null;
    }
    /** A/B de uma correção: lanes em bypass ficam no valor neutro (sem corte). */
    isBypassed(l) { return !!(this.bypass && this.bypass.has(l.id)); }
    scheduleSectionMutes(when, offset) {
      const S = MM.sections;
      if (!S || !this.state.music) return;
      const fd = 0.012;
      this.state.stems.forEach((s) => {
        const n = this.stems[s.id];
        if (!n || !n.sm) return;
        const p = n.sm.gain, R = S.muteRanges(this.state, s.id);
        p.cancelScheduledValues(0);
        const inside = R.some(([a, b]) => offset >= a && offset < b);
        p.setValueAtTime(inside ? 0 : 1, when);
        R.forEach(([a, b]) => {
          if (b <= offset) return;
          const A = when + (a - offset), B = when + (b - offset);
          if (a > offset) { p.setValueAtTime(1, Math.max(when, A - fd)); p.linearRampToValueAtTime(0, A); }
          if (b < this.state.music.duration - 0.01) { p.setValueAtTime(0, Math.max(when, B - fd)); p.linearRampToValueAtTime(1, B); }
        });
      });
    }
    /** A/B das correções em tempo real (EQ dinâmico com sidechain): bypass por mensagem ao processador. */
    applyBypass() {
      this.state.stems.forEach((s) => { const n = this.stems[s.id]; if (!n) return; Object.keys(n.mods).forEach((k) => { const m = n.mods[k]; if (m && m.rt && k.startsWith('dyn')) m.node.port.postMessage({ bypass: !!(this.bypass && this.bypass.has(k + ':' + s.id)) }); }); });
    }
    scheduleAutomation(when, offset, dur) {
      this.applyBypass();
      this.scheduleSectionMutes(when, offset);
      (this.state.automation || []).forEach((l) => {
        const lp = this.laneParam(l);
        if (!lp) return;
        const tgts = [lp].concat(lp.also || []);
        if (this.isBypassed(l)) { tgts.forEach((q) => { q.p.cancelScheduledValues(0); q.p.setValueAtTime(q.conv(l.def), when); }); return; }
        const rate = l.ai && l.ai.rate ? Math.min(100, l.ai.rate) : 40;
        const n = Math.max(2, Math.ceil((dur - offset) * rate) + 1);
        const raw = new Float32Array(n);
        for (let i = 0; i < n; i++) raw[i] = MM.laneValue(l, offset + i / rate);
        tgts.forEach((q) => {
          const vals = raw.map((v) => q.conv(v));
          try {
            q.p.cancelScheduledValues(0);
            q.p.setValueAtTime(vals[0], when);
            q.p.setValueCurveAtTime(vals, when + 0.001, (n - 1) / rate);
          } catch (e) { console.warn('automação', l.id, e); }
        });
      });
    }
    cancelAutomation(pos) {
      if (MM.sections && this.state.music) this.state.stems.forEach((s) => {
        const n = this.stems[s.id];
        if (!n || !n.sm) return;
        n.sm.gain.cancelScheduledValues(0);
        n.sm.gain.value = MM.sections.muteRanges(this.state, s.id).some(([a, b]) => (pos || 0) >= a && (pos || 0) < b) ? 0 : 1;
      });
      (this.state.automation || []).forEach((l) => {
        const lp = this.laneParam(l);
        if (!lp) return;
        const v = this.isBypassed(l) ? l.def : MM.laneValue(l, pos || 0);
        [lp].concat(lp.also || []).forEach((q) => { q.p.cancelScheduledValues(0); q.p.value = q.conv(v); });
      });
    }
    start(when, offset) {
      this.sources = [];
      if (this.opts.masterOnly) {
        const src = this.ctx.createBufferSource(); src.buffer = this.opts.masterOnly;
        src.connect(this.m.input);
        if (this.opts.tapMix) src.connect(this.opts.tapMix);
        src.start(when, offset); this.sources.push(src);
        return;
      }
      this.state.stems.forEach((s) => {
        const n = this.stems[s.id];
        if (!n) return;
        if (this.opts.filter && !this.opts.filter(s) && !n.scOnly) return;
        if (n.frozen) {
          // alinhamento: a cache foi gravada com a latência máxima de então; compensa a diferença para a atual
          const sh = ((this.stemLatency || 0) - n.frozen.mx) / this.ctx.sampleRate;
          const src = this.ctx.createBufferSource(); src.buffer = n.frozen.buffer; src.connect(n.out);
          if (offset - sh < src.buffer.duration) { src.start(when + Math.max(0, sh - offset), Math.max(0, offset - sh)); this.sources.push(src); }
          return;
        }
        // voz editada no editor de voz (afinação/tempo/formantes) entra ANTES da cadeia do stem; o "Original" continua cru
        const tuned = s.tuneBuf && s.p.tune && s.p.tune.on ? s.tuneBuf : null;
        const src = this.ctx.createBufferSource();
        src.buffer = tuned || s.buffer;
        src.connect(n.trim); if (n.raw && !tuned) src.connect(n.raw);
        if (offset < s.buffer.duration) { src.start(when, offset); this.sources.push(src); }
        if (tuned && n.raw && offset < s.buffer.duration) { const r = this.ctx.createBufferSource(); r.buffer = s.buffer; r.connect(n.raw); r.start(when, offset); this.sources.push(r); }
      });
    }
    stop() { (this.sources || []).forEach((s) => { try { s.stop(); } catch (e) { /* */ } }); this.sources = []; }
  }
  MM.Graph = Graph;

  // =====================================================================
  //   Engine em tempo real
  // =====================================================================
  class Engine {
    constructor() {
      this.ctx = null; this.graph = null; this.playing = false; this.pos = 0; this.monitor = 'mix';
      this.lm = true; this.lmGains = { orig: 0, mix: 0, master: 0, ref: 0, codec: 0 }; this.loop = null; this.listeners = [];
      this.meter = { M: -70, S: -70, I: -70, tp: -70, tpMax: -70, corr: 1, pkL: 0, pkR: 0 };
    }
    async init(sr) {
      if (this.ctx) return this.ctx;
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: sr || undefined });
      await MM.loadWorklets(this.ctx);
      const c = this.ctx;
      this.out = c.createGain();
      this.mon = { orig: c.createGain(), mix: c.createGain(), master: c.createGain(), ref: c.createGain(), codec: c.createGain() };
      Object.values(this.mon).forEach((g) => { g.gain.value = 0; g.connect(this.out); });
      this.mon.mix.gain.value = 1;
      // atraso dos monitores Original/Mix para coincidirem com o master quando há EQ de fase linear
      this.dly = { orig: c.createDelay(1), mix: c.createDelay(1) };
      this.dly.orig.connect(this.mon.orig); this.dly.mix.connect(this.mon.mix);
      this.anL = c.createAnalyser(); this.anR = c.createAnalyser(); this.anL.fftSize = this.anR.fftSize = 4096;
      this.anL.smoothingTimeConstant = this.anR.smoothingTimeConstant = 0.75;
      const sp = c.createChannelSplitter(2);
      this.out.connect(sp); sp.connect(this.anL, 0); sp.connect(this.anR, 1);
      this.meterNode = new AudioWorkletNode(c, 'mm-meter', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      this.meterNode.port.onmessage = (e) => (this.meter = e.data);
      this.out.connect(this.meterNode);
      this.out.connect(c.destination);
      return c;
    }
    get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }
    latencySec() { return this.graph && this.graph.masterLatency ? this.graph.masterLatency / this.ctx.sampleRate : 0; }
    syncLatency() { if (!this.dly) return; const d = this.latencySec(); this.dly.orig.delayTime.value = d; this.dly.mix.delayTime.value = d; }
    rebuild(state) {
      const was = this.playing, pos = this.position();
      if (was) this.pause();
      if (this.graph) {
        try { this.graph.origBus && this.graph.origBus.disconnect(); this.graph.mixOut && this.graph.mixOut.disconnect(); this.graph.m.output.disconnect(); } catch (e) { /* */ }
      }
      this.state = state;
      const opts = {};
      if (state.mode === 'master' && state.premaster) {
        opts.masterOnly = state.premaster;
        opts.tapMix = this.ctx.createGain();
        opts.tapMix.connect(this.dly.mix); opts.tapMix.connect(this.dly.orig);
      }
      this.graph = new Graph(this.ctx, state, opts);
      this.graph.onLatency = () => this.syncLatency();
      this.syncLatency();
      if (!opts.masterOnly) {
        this.graph.origBus.connect(this.dly.orig);
        this.graph.mixOut.connect(this.dly.mix);
        this.graph.mixOut.connect(this.graph.m.input);
      }
      this.graph.m.output.connect(this.mon.master);
      this.graph.cancelAutomation(pos);
      if (was) this.play(pos); else this.idle();
    }
    duration() {
      const st = this.state;
      if (!st) return 0;
      if (st.mode === 'master' && st.premaster) return st.premaster.duration;
      return st.music ? st.music.duration : 0;
    }
    position() { return this.playing ? this.startPos + (this.ctx.currentTime - this.startAt) : this.pos; }
    async play(from) {
      if (!this.graph) return;
      clearTimeout(this.suspendT);
      if (this.ctx.state !== 'running') await this.ctx.resume();
      if (this.playing) this.pause();
      let pos = from !== undefined ? from : this.pos;
      const dur = this.duration();
      if (pos >= dur - 0.05) pos = 0;
      if (this.loop && (pos < this.loop[0] || pos >= this.loop[1])) pos = this.loop[0];
      const when = this.ctx.currentTime + 0.06;
      this.graph.start(when, pos);
      this.graph.scheduleAutomation(when, pos, dur);
      if (this.state.refBuffer) {
        this.refSrc = this.ctx.createBufferSource(); this.refSrc.buffer = this.state.refBuffer; this.refSrc.loop = true;
        this.refSrc.connect(this.mon.ref);
        this.refSrc.start(when, pos % this.state.refBuffer.duration);
      }
      // pré-escuta de codec: o master codificado/descodificado, sincronizado com os outros monitores
      if (this.state.codecBuf && pos < this.state.codecBuf.duration) {
        this.codecSrc = this.ctx.createBufferSource(); this.codecSrc.buffer = this.state.codecBuf;
        this.codecSrc.connect(this.mon.codec); this.codecSrc.start(when + this.latencySec(), pos);
      }
      this.startAt = when; this.startPos = pos; this.playing = true;
      clearInterval(this.tick);
      this.tick = setInterval(() => {
        const p = this.position();
        if (this.loop && p >= this.loop[1]) { this.play(this.loop[0]); return; }
        if (p >= dur) { this.stop(); this.emit('end'); }
      }, 50);
      this.emit('play');
    }
    pause() {
      if (!this.playing) return;
      this.pos = this.position();
      this.graph.stop();
      if (this.refSrc) { try { this.refSrc.stop(); } catch (e) { /* */ } this.refSrc = null; }
      if (this.codecSrc) { try { this.codecSrc.stop(); } catch (e) { /* */ } this.codecSrc = null; }
      this.playing = false; clearInterval(this.tick);
      this.graph.cancelAutomation(this.pos);
      this.idle();
      this.emit('pause');
    }
    /** Suspende o áudio em tempo real quando parado: liberta o CPU para análise e renders. */
    idle() { clearTimeout(this.suspendT); this.suspendT = setTimeout(() => { if (!this.playing && this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }, 400); }
    stop() { this.pause(); this.pos = 0; this.graph && this.graph.cancelAutomation(0); this.emit('stop'); }
    seek(t) { const was = this.playing; if (was) this.pause(); this.pos = D.clamp(t, 0, this.duration()); if (was) this.play(this.pos); else { this.graph && this.graph.cancelAutomation(this.pos); this.emit('seek'); } }
    resetIdle() { this.idle(); }
    reschedule() { if (this.playing) { const p = this.position(); this.pause(); this.play(p); } else this.graph && this.graph.cancelAutomation(this.pos); }
    setMonitor(which) {
      this.monitor = which;
      const t = this.ctx ? this.ctx.currentTime : 0;
      Object.entries(this.mon || {}).forEach(([k, g]) => g.gain.setTargetAtTime(k === which ? D.db2lin(this.lm ? this.lmGains[k] || 0 : 0) : 0, t, 0.012));
      this.emit('monitor');
    }
    setLM(on) { this.lm = on; this.setMonitor(this.monitor); }
    /** Compensação de loudness: todas as versões ao nível da mais baixa. */
    setLoudness(lufs) {
      const vals = Object.values(lufs).filter((v) => v > -60);
      const ref = vals.length ? Math.min(...vals) : -16;
      Object.keys(this.lmGains).forEach((k) => (this.lmGains[k] = lufs[k] > -60 ? ref - lufs[k] : 0));
      this.setMonitor(this.monitor);
    }
    resetMeter() { this.meterNode && this.meterNode.port.postMessage('reset'); }
    on(fn) { this.listeners.push(fn); }
    emit(ev) { this.listeners.forEach((f) => f(ev)); }
  }
  MM.Engine = Engine;

  // =====================================================================
  //   Render offline
  // =====================================================================
  /**
   * @param {object} state
   * @param {object} o  { out: 'premaster'|'master'|'orig', sr, filter(s)→bool, premaster(AudioBuffer), onProgress, tail }
   */
  MM.render = async function (state, o) {
    o = o || {};
    if (MM.tune && !o.premaster) await MM.tune.ensure(state); // voz editada pronta antes do render
    const sr = o.sr || state.sampleRate;
    const linEQ = state.master && state.master.chain && state.master.chain.eq && state.master.chain.eq.phase === 'linear' && state.master.chain.eq.on;
    const dur = (o.premaster ? o.premaster.duration : state.music.duration) + (o.tail === undefined ? 1.5 : o.tail) + (linEQ ? (sr > 50000 ? 16384 : 8192) / 2 / sr : 0) + 0.021; // + folga para o look-ahead do limiter (recortado no fim)
    const len = Math.ceil(dur * sr);
    // cache por stem: stems inalterados entram já processados; o primeiro render completo da pré-master grava-os
    const SC = MM.stemCache && MM.insight && MM.stemCache.enabled() && !o.premaster && o.out !== 'orig' && !o.timeOffset && !o.noCache ? MM.stemCache : null;
    const plan = SC ? SC.plan(state, sr, Math.ceil(state.music.duration * sr), o.out === 'premaster' && !o.filter) : null;
    const cap = plan ? plan.capture : [];
    const nCh = 2 + cap.reduce((a, x) => a + x.ch, 0);
    const ctx = new OfflineAudioContext(nCh, len, sr);
    await MM.loadWorklets(ctx);
    const g = new Graph(ctx, state, { offline: true, filter: o.filter, masterOnly: o.premaster || null, needOrig: o.out === 'orig', noFade: !!o.noFade, frozen: plan ? plan.frozen : null });
    let dest = ctx.destination;
    if (cap.length) {
      try { ctx.destination.channelCount = nCh; ctx.destination.channelCountMode = 'explicit'; ctx.destination.channelInterpretation = 'discrete'; } catch (e) { /* */ }
      const mg = ctx.createChannelMerger(nCh), sp = ctx.createChannelSplitter(2);
      dest = ctx.createGain(); dest.channelCount = 2; dest.channelCountMode = 'explicit';
      dest.connect(sp); sp.connect(mg, 0, 0); sp.connect(mg, 1, 1);
      let ci = 2;
      cap.forEach((x) => { const nd = g.stems[x.s.id]; if (!nd) { ci += x.ch; return; } const s2 = ctx.createChannelSplitter(x.ch); nd.fader.connect(s2); for (let c = 0; c < x.ch; c++) s2.connect(mg, c, ci + c); ci += x.ch; });
      mg.connect(ctx.destination);
    }
    if (o.premaster) g.m.output.connect(dest);
    else if (o.out === 'orig') g.origBus.connect(dest);
    else if (o.out === 'premaster') g.mixOut.connect(dest);
    else { g.mixOut.connect(g.m.input); g.m.output.connect(dest); }
    if (o.out === 'premaster' && !o.keepMasterAuto) { /* automação de master irrelevante */ }
    g.start(0, 0);
    // timeOffset: o buffer começa neste instante da música (excertos) — a automação tem de bater certo
    const to = o.timeOffset || 0;
    g.scheduleAutomation(0, to, to + dur);
    if (o.onProgress) {
      const step = Math.max(2, dur / 20);
      for (let t = step; t < dur; t += step) ctx.suspend(t).then(() => { o.onProgress(t / dur); ctx.resume(); });
    }
    let buf = await ctx.startRendering();
    if (o.onProgress) o.onProgress(1);
    if (plan) MM.stemCache.last = { frozen: Object.keys(plan.frozen).length, captured: cap.length, out: o.out || 'master' };
    if (cap.length) {
      SC.store(state, g, buf, cap, sr);
      const b2 = new AudioBuffer({ length: buf.length, numberOfChannels: 2, sampleRate: sr });
      b2.copyToChannel(buf.getChannelData(0), 0); b2.copyToChannel(buf.getChannelData(1), 1);
      buf = b2;
    }
    // latência do master (FIR de fase linear N/2 + look-ahead do limiter) → recorta para ficar alinhado com a pré-master/mistura
    const lat = (o.premaster || !['premaster', 'orig'].includes(o.out)) ? g.masterLatency || 0 : 0;
    const want = o.tail === 0 ? Math.ceil((o.premaster ? o.premaster.duration : state.music.duration) * sr) : buf.length - lat;
    if (lat || want < buf.length) {
      const n = Math.min(buf.length - lat, want), out = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
      for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(lat), c);
      buf = out;
    }
    return buf;
  };

  /** Fade/volume do master (lane 'fade:master') aplicado a um buffer já masterizado. */
  MM.applyMasterFade = function (state, buf, timeOffset) {
    const l = (state.automation || []).find((x) => x.target.type === 'master' && x.target.param === 'fade');
    if (!l || !((l.manual && l.manual.length && l.enabled.manual) || (l.ai && l.enabled.ai))) return false;
    const sr = buf.sampleRate, chs = D.channelsOf(buf), n = chs[0].length, B = 128, to = timeOffset || 0;
    const g = (t) => { const v = MM.laneValue(l, t); return v <= -59 ? 0 : D.db2lin(v); };
    let g0 = g(to);
    for (let i = 0; i < n; i += B) {
      const g1 = g(to + Math.min(n, i + B) / sr), e = Math.min(n, i + B);
      if (g0 === 1 && g1 === 1) { g0 = g1; continue; }
      for (const c of chs) for (let k = i; k < e; k++) c[k] *= g0 + ((g1 - g0) * (k - i)) / B;
      g0 = g1;
    }
    return true;
  };

  /** Reamostragem de alta qualidade (motor do browser). */
  MM.resample = async function (buf, sr) {
    const ctx = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * sr), sr);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(0);
    return ctx.startRendering();
  };

  /** Métricas completas de um buffer renderizado. */
  MM.measure = async function (buf, opts) {
    opts = opts || {};
    const chs = D.channelsOf(buf), sr = buf.sampleRate;
    const L = chs[0], R = chs[1] || chs[0];
    const loud = D.loudness(chs, sr);
    const peak = D.samplePeak(chs), tp = D.truePeak(chs);
    const corrS = D.correlationSeries(L, R, sr, 1);
    const corr = D.correlation(L, R);
    const lpL = D.filter(D.filter(L, D.biquad('lowpass', 120, 0.7, 0, sr)), D.biquad('lowpass', 120, 0.7, 0, sr));
    const lpR = D.filter(D.filter(R, D.biquad('lowpass', 120, 0.7, 0, sr)), D.biquad('lowpass', 120, 0.7, 0, sr));
    let mm = 0, ss = 0;
    for (let i = 0; i < lpL.length; i += 2) { const a = lpL[i] + lpR[i], b = lpL[i] - lpR[i]; mm += a * a; ss += b * b; }
    const monoLow = 100 * (1 - ss / Math.max(1e-12, mm + ss));
    let clips = 0, run = 0;
    for (const x of chs) for (let i = 0; i < x.length; i++) { if (Math.abs(x[i]) >= 0.9999) { if (++run === 2) clips++; } else run = 0; }
    // cliques: pico isolado da 2.ª diferença (muito acima da vizinhança antes E depois)
    let clicks = 0;
    for (const x of chs) {
      const n = x.length, W = 48;
      const d2 = new Float32Array(n);
      for (let i = 2; i < n; i++) d2[i] = Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]);
      const cs = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + d2[i] * d2[i];
      for (let i = W + 4; i < n - W - 4; i++) {
        const v = d2[i];
        if (v < 0.2) continue;
        const before = Math.sqrt((cs[i - 3] - cs[i - 3 - W]) / W), after = Math.sqrt((cs[i + 4 + W] - cs[i + 4]) / W);
        if (v > 12 * before && v > 12 * after) { clicks++; i += Math.round(sr * 0.02); }
      }
    }
    const th = D.db2lin(-60);
    let head = 0; while (head < L.length && Math.abs(L[head]) < th && Math.abs(R[head]) < th) head++;
    let tail = L.length - 1; while (tail > 0 && Math.abs(L[tail]) < th && Math.abs(R[tail]) < th) tail--;
    const spec = await D.avgSpectrum(D.mono(chs), sr, 128, { size: 4096, hop: 8192 });
    // bandas de 7 (energia relativa, normalizada ao loudness)
    const b7 = D.BANDS7.map((b) => {
      const pts = spec.freqs.map((f, i) => (f >= b.lo && f < b.hi ? Math.pow(10, spec.db[i] / 10) : 0));
      return 10 * Math.log10(pts.reduce((a, v) => a + v, 0) + 1e-14);
    });
    const norm = b7.reduce((a, v) => a + Math.pow(10, v / 10), 0);
    const bands7 = b7.map((v) => v - 10 * Math.log10(norm + 1e-14));
    const sections = (opts.sections || []).map((s) => ({ name: s.name, lufs: D.loudnessRange(loud.blockMs, s.start, s.end) }));
    return {
      lufs: loud.integrated, lra: loud.lra, stMax: loud.shortTermMax, mMax: loud.momentaryMax,
      peak: D.lin2db(peak), tp: D.lin2db(tp), plr: D.lin2db(peak) - loud.integrated, crest: D.lin2db(peak) - D.lin2db(D.rms(chs)),
      corr, corrMin: corrS.length ? D.percentile(corrS, 0.02) : corr, width: D.width(L, R), monoLow, dc: D.lin2db(D.dcOffset(chs) + 1e-12),
      clips, clicks, head: head / sr, tail: (L.length - 1 - tail) / sr, spectrum: spec, bands7, sections, short: loud.short, duration: L.length / sr,
    };
  };
})();
