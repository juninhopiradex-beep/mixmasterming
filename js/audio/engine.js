/* MixMind — motor de mistura (Web Audio)
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

  // ---------- curvas ----------
  const curveCache = {};
  MM.satCurve = function (model, drive) {
    const key = model + ':' + drive.toFixed(3);
    if (curveCache[key]) return curveCache[key];
    const N = 2048, c = new Float32Array(N);
    const k = 1 + drive * 7;
    const f = {
      tube: (x) => Math.tanh(k * (x + 0.15)) - Math.tanh(k * 0.15),
      tape: (x) => Math.tanh(k * x),
      transformer: (x) => Math.atan(k * x * 1.2),
      console: (x) => { const y = D.clamp(k * x * 0.7, -1.5, 1.5); return y - (y * y * y) / 6.75; },
      soft: (x) => { const y = k * x; return Math.abs(y) < 0.7 ? y : Math.sign(y) * (0.7 + 0.3 * Math.tanh((Math.abs(y) - 0.7) / 0.3)); },
      exciter: (x) => Math.tanh(k * x) + 0.08 * drive * (k * x) * (k * x),
    }[model] || ((x) => Math.tanh(k * x));
    const eps = 1e-4, d0 = (f(eps) - f(-eps)) / (2 * eps) || 1;
    // entrada da curva: −2..+2 (pré-escala 0.5 aplicada antes do shaper)
    for (let i = 0; i < N; i++) { const x = ((i / (N - 1)) * 2 - 1) * 2; c[i] = (f(x) - f(0)) / d0 / 2; }
    return (curveCache[key] = c);
  };
  MM.clipCurve = function (T) {
    const N = 4096, c = new Float32Array(N), knee = T * 0.25;
    for (let i = 0; i < N; i++) {
      const x = ((i / (N - 1)) * 2 - 1) * 2, a = Math.abs(x);
      let y;
      if (a <= T - knee) y = a;
      else if (a >= T + knee) y = T;
      else { const t = (a - (T - knee)) / (2 * knee); y = T - knee + 2 * knee * (t - (t * t) / 2); }
      c[i] = (Math.sign(x) * y) / 2;
    }
    return c;
  };

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
    wnode(name, ch, key) {
      const n = new AudioWorkletNode(this.ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [ch], channelCount: ch, channelCountMode: 'explicit', processorOptions: { quiet: this.offline } });
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
    shaper(over) {
      const sIn = this.gain(1), out = this.gain(1), dry = this.gain(1), wet = this.gain(0), sh = this.ctx.createWaveShaper();
      sh.oversample = over;
      const dc = this.biq('highpass', 7, 0.7071);
      sIn.connect(dry).connect(dc);
      this.chain([sIn, this.gain(0.5), sh, this.gain(2), wet, dc]);
      dc.connect(out);
      return { in: sIn, out, dry, wet, sh };
    }

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
        if (k === 'glue') { const w = this.wnode('mm-comp', 2, 'busGlue'); return { in: w, out: w, node: w }; }
        return this.shaper('4x');
      });
      const M = this.busH.mods;
      if (M.low) M.low.node.gain.value = b.eq.low;
      if (M.high) M.high.node.gain.value = b.eq.high;
      this.mixBus.gain.value = D.db2lin(b.trim || 0);
      if (M.glue) {
        const thr = -18 + 9 - b.glue.gr / (1 - 1 / Math.max(1.01, b.glue.ratio));
        M.glue.node.port.postMessage({ thr, ratio: b.glue.ratio, atk: b.glue.atk, rel: b.glue.rel, knee: 6, makeup: b.glue.gr * 0.5, mix: 1, bypass: false });
      }
      if (M.sat) { M.sat.sh.curve = MM.satCurve(b.sat.model, b.sat.drive); M.sat.wet.gain.value = b.sat.mix; M.sat.dry.gain.value = 1 - b.sat.mix; }
      // compressão paralela da bateria
      const parOn = b.drumPar.on;
      if (parOn && !this.drumPar) {
        this.drumPar = this.wnode('mm-comp', 2, 'drumPar'); this.drumWet = this.gain(0);
        this.drumPar.connect(this.drumWet).connect(this.mixBus);
        this.drumPar.port.postMessage({ thr: -32, ratio: 6, atk: 3, rel: 80, knee: 4, makeup: 10, mix: 1 });
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
        if (this.irKey[t] !== key) { r.conv.buffer = MM.makeIR(this.ctx, t, cfg.decay, Math.min(16000, cfg.lpf * 1.5)); this.irKey[t] = key; }
        r.pre.delayTime.value = (cfg.predelay || 0) / 1000;
        r.hpf.frequency.value = cfg.hpf || 250;
        r.lpf.frequency.value = Math.min(this.nyq, cfg.lpf || 9000);
        r.ret.gain.value = D.db2lin(cfg.ret || 0);
      });
      const d = this.fx.delay;
      if (d) {
        const c = fx.delay;
        d.dl.delayTime.value = c.time; d.dr.delayTime.value = c.time;
        d.fbl.gain.value = c.feedback; d.fbr.gain.value = c.feedback;
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
        if (k === 'eq') return this.eqKeys().length > 0;
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
      if (k === 'dyn') { const w = this.wnode('mm-dyneq', 2, 'mDyn'); return { in: w, out: w, node: w }; }
      if (k === 'glue') { const w = this.wnode('mm-comp', 2, 'mGlue'); return { in: w, out: w, node: w }; }
      if (k === 'lim') { const w = this.wnode('mm-limiter', 2, 'mLim'); return { in: w, out: w, node: w }; }
      if (k === 'sat') return this.shaper('2x');
      if (k === 'mb') {
        const mbIn = this.gain(1), mbOut = this.gain(1);
        const lr = (type, f) => { const a = this.biq(type, f, 0.7071), b = this.biq(type, f, 0.7071); a.connect(b); return [a, b]; };
        const x1 = [lr('lowpass', 120), lr('highpass', 120)], x2 = [lr('lowpass', 2500), lr('highpass', 2500)];
        const comps = [this.wnode('mm-comp', 2, 'mb0'), this.wnode('mm-comp', 2, 'mb1'), this.wnode('mm-comp', 2, 'mb2')];
        mbIn.connect(x1[0][0]); x1[0][1].connect(comps[0]).connect(mbOut);
        mbIn.connect(x1[1][0]);
        x1[1][1].connect(x2[0][0]); x2[0][1].connect(comps[1]).connect(mbOut);
        x1[1][1].connect(x2[1][0]); x2[1][1].connect(comps[2]).connect(mbOut);
        return { in: mbIn, out: mbOut, x1, x2, comps };
      }
      if (k === 'ms') {
        const msIn = this.gain(1), split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
        msIn.channelCount = 2; msIn.channelCountMode = 'explicit';
        const mid = this.gain(1), side = this.gain(1);
        [mid, side].forEach((g) => { g.channelCount = 1; g.channelCountMode = 'explicit'; });
        msIn.connect(split);
        split.connect(this.gain(0.5), 0).connect(mid); split.connect(this.gain(0.5), 1).connect(mid);
        split.connect(this.gain(0.5), 0).connect(side); split.connect(this.gain(-0.5), 1).connect(side);
        const hp = [this.biq('highpass', 120, BW4[0]), this.biq('highpass', 120, BW4[1])];
        const width = this.gain(1), widthAuto = this.gain(1), neg = this.gain(-1);
        this.chain([side, hp[0], hp[1], width, widthAuto]);
        mid.connect(merge, 0, 0); mid.connect(merge, 0, 1);
        widthAuto.connect(merge, 0, 0); widthAuto.connect(neg).connect(merge, 0, 1);
        return { in: msIn, out: merge, hp, width, widthAuto };
      }
      if (k === 'clip') {
        const i = this.gain(1), pre = this.gain(0.5), sh = c.createWaveShaper(), post = this.gain(2);
        sh.oversample = '4x';
        this.chain([i, pre, sh, post]);
        return { in: i, out: post, sh };
      }
    }
    connectMaster() {
      return this.rewire(this.m, this.masterKeys(), this.m.input, this.m.output, (k) => this.makeMasterMod(k));
    }
    applyMaster() {
      const M = this.state.master, ch = M.chain, m = this.m;
      this.connectMaster();
      const mods = m.mods;
      m.input.gain.value = 1;
      if (mods.drive) mods.drive.node.gain.value = D.db2lin(M.inGain || 0);
      if (mods.eq && m.sig.split(',').includes('eq')) {
        const e = ch.eq;
        const make = (k) => {
          const map = { low: ['lowshelf', 80, 0.7], mud: ['peaking', 300, 1], pres: ['peaking', 3000, 0.9], air: ['highshelf', 9000, 0.7] };
          const RF = [['lowshelf', 40], ['peaking', 110], ['peaking', 320], ['peaking', 1000], ['peaking', 3200], ['peaking', 7000], ['highshelf', 14000]];
          const d = map[k] || RF[+k.slice(1)].concat([0.8]);
          const f = this.biq(d[0], d[1], d[2]);
          return { in: f, out: f, node: f };
        };
        this.rewire(this.eqH, this.eqKeys(), mods.eq.in, mods.eq.out, make);
        const set = (k, g) => { const x = this.eqH.mods[k]; if (x) x.node.gain.value = g || 0; };
        set('low', e.low); set('mud', e.mud); set('pres', e.pres); set('air', e.air);
        (e.ref || []).forEach((g, i) => set('r' + i, g));
      }
      if (mods.dyn) mods.dyn.node.port.postMessage({ bands: [
        { freq: 320, q: 1.2, cut: -Math.min(0, ch.dyn.mud || 0), on: true, thr: 1 },
        { freq: 3200, q: 1.3, cut: -Math.min(0, ch.dyn.harsh || 0), on: true, thr: 1 },
      ] });
      if (mods.mb) {
        mods.mb.x1.forEach((x) => x.forEach((b) => (b.frequency.value = ch.mb.xLow)));
        mods.mb.x2.forEach((x) => x.forEach((b) => (b.frequency.value = ch.mb.xHigh)));
        ch.mb.bands.forEach((b, i) => mods.mb.comps[i].port.postMessage(Object.assign({ knee: 6, makeup: 0, mix: 1 }, b, { bypass: false })));
      }
      if (mods.glue) mods.glue.node.port.postMessage({ thr: ch.glue.thr, ratio: ch.glue.ratio, atk: ch.glue.atk, rel: ch.glue.rel, knee: 6, makeup: 0, mix: 1, bypass: false });
      if (mods.sat) { mods.sat.sh.curve = MM.satCurve(ch.sat.model, Math.max(0.001, ch.sat.drive)); mods.sat.wet.gain.value = ch.sat.mix; mods.sat.dry.gain.value = 1 - ch.sat.mix; }
      if (mods.ms) { mods.ms.width.gain.value = (M.width || 100) / 100; mods.ms.hp.forEach((b) => (b.frequency.value = ch.ms.monoBelow || 120)); }
      if (mods.clip) { const T = D.db2lin(M.ceiling + (M.ceilAdj || 0) + 2 - 2.5 * (ch.clip.amount || 0)); mods.clip.sh.curve = MM.clipCurve(Math.min(1.9, T)); }
      if (mods.lim) mods.lim.node.port.postMessage({ ceiling: M.ceiling + (M.ceilAdj || 0), lookahead: ch.lim.lookahead, release: ch.lim.release, inGain: 0, bypass: false });
    }

    // ---------- stem ----------
    buildStem(s) {
      const c = this.ctx, n = { mods: {}, sig: null };
      if (!this.offline || this.opts.needOrig) { n.raw = this.gain(1); n.raw.connect(this.origBus); }
      n.trim = this.gain(1); n.ride = this.gain(1); n.fader = this.gain(1); n.pan = c.createStereoPanner(); n.ms = this.gain(1);
      this.chain([n.ride, n.fader, n.pan, n.ms, this.groups[s.group] || this.groups.music]);
      if (!this.offline) { n.meter = c.createAnalyser(); n.meter.fftSize = 512; n.ms.connect(n.meter); }
      this.stems[s.id] = n;
    }
    hasLane(s, param) { return (this.state.automation || []).some((l) => l.target.type === 'stem' && l.target.id === s.id && l.target.param === param); }
    stemKeys(s) {
      const p = s.p, k = [];
      if (p.hpf.on) k.push('hp0', 'hp1');
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
      if (k.startsWith('dyn') || k === 'deess') { const f = this.biq('peaking', 1000, 1.4); this.kr(f.gain); return { in: f, out: f, node: f }; }
      if (k === 'alpf') { const f = this.biq('lowpass', this.nyq, 0.7071); this.kr(f.frequency); return { in: f, out: f, node: f }; }
      if (k === 'comp' || k === 'comp2') { const w = this.wnode('mm-comp', ch, (k === 'comp' ? 'c:' : 'c2:') + s.id); return { in: w, out: w, node: w }; }
      if (k === 'trans') { const w = this.wnode('mm-trans', ch); return { in: w, out: w, node: w }; }
      if (k === 'sat') return this.shaper('2x');
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
      this.rewire(n, this.stemKeys(s), n.trim, n.ride, (k) => this.makeStemMod(s, k));
      const M = n.mods;
      setp(n.trim.gain, D.db2lin(p.trim));
      if (M.hp0) { M.hp0.node.frequency.value = p.hpf.freq; M.hp1.node.frequency.value = p.hpf.freq; }
      p.eq.forEach((e, i) => {
        const m = M['eq' + i];
        if (!m || !e) return;
        m.node.type = e.type; m.node.frequency.value = D.clamp(e.freq, 20, this.nyq); m.node.Q.value = e.q || 1; setp(m.node.gain, e.gain);
      });
      (p.dyn || []).forEach((d, i) => { const m = M['dyn' + i]; if (m) { m.node.frequency.value = d.freq; m.node.Q.value = d.q || 1.4; } });
      if (M.deess) { M.deess.node.frequency.value = p.deess.freq || 6500; M.deess.node.Q.value = 2.5; }
      if (M.lpf) M.lpf.node.frequency.value = Math.min(p.lpf.freq, this.nyq);
      if (M.comp) M.comp.node.port.postMessage(Object.assign({}, p.comp, { bypass: false }));
      if (M.comp2) M.comp2.node.port.postMessage(Object.assign({}, p.comp2, { bypass: false }));
      if (M.trans) M.trans.node.port.postMessage({ attack: p.trans.attack, sustain: p.trans.sustain, bypass: false });
      if (M.sat) { M.sat.sh.curve = MM.satCurve(p.sat.model, p.sat.drive); setp(M.sat.wet.gain, p.sat.mix); setp(M.sat.dry.gain, 1 - p.sat.mix); }
      if (M.duck) { M.duck.lo.concat(M.duck.hi).forEach((b) => (b.frequency.value = p.duck.freq || 120)); }
      setp(n.fader.gain, D.db2lin(p.fader));
      setp(n.pan.pan, D.clamp(p.pan, -1, 1));
      const anySolo = this.state.stems.some((x) => x.solo && !x.removed);
      const on = s.mute ? 0 : anySolo && !s.solo ? 0 : 1;
      setp(n.ms.gain, on); if (n.raw) setp(n.raw.gain, on);
      // sends (criados só quando usados)
      const revOn = p.sendRev > -59 || this.hasLane(s, 'sendRev');
      if (revOn && !n.sendRev) { n.sendRev = this.gain(0); n.revAuto = this.gain(1); n.ms.connect(n.sendRev).connect(n.revAuto); }
      if (n.sendRev) {
        setp(n.sendRev.gain, p.sendRev <= -59 ? 0 : D.db2lin(p.sendRev));
        const type = p.revType || 'plate';
        if (n.revType !== type) { if (n.revType) n.revAuto.disconnect(); n.revAuto.connect(this.ensureFx(type).input); n.revType = type; }
      }
      const dlyOn = p.sendDly > -59 || this.hasLane(s, 'sendDly');
      if (dlyOn && !n.sendDly) { n.sendDly = this.gain(0); n.dlyAuto = this.gain(1); n.ms.connect(n.sendDly).connect(n.dlyAuto).connect(this.ensureFx('delay').input); }
      if (n.sendDly) setp(n.sendDly.gain, p.sendDly <= -59 ? 0 : D.db2lin(p.sendDly));
    }
    applyAll() {
      if (!this.opts.masterOnly) {
        this.state.stems.forEach((s) => this.stems[s.id] && this.applyStem(s));
        this.applyBus(); this.applyFx();
      }
      this.applyMaster();
    }

    // ---------- automação ----------
    laneParam(l) {
      const t = l.target;
      if (t.type === 'master') return t.param === 'width' && this.m.mods.ms && this.m.sig.split(',').includes('ms') ? { p: this.m.mods.ms.widthAuto.gain, conv: (v) => v / 100 } : null;
      if (t.type === 'fx') { const f = this.fx[t.id]; return f ? { p: f.duck.gain, conv: D.db2lin } : null; }
      const n = this.stems[t.id];
      if (!n) return null;
      const M = n.mods, act = (n.sig || '').split(',');
      const mod = (k) => (M[k] && act.includes(k) ? M[k] : null);
      switch (t.param) {
        case 'ride': return { p: n.ride.gain, conv: D.db2lin };
        case 'sendRev': return n.revAuto ? { p: n.revAuto.gain, conv: D.db2lin } : null;
        case 'sendDly': return n.dlyAuto ? { p: n.dlyAuto.gain, conv: D.db2lin } : null;
        case 'lpf': return mod('alpf') ? { p: M.alpf.node.frequency, conv: (v) => Math.min(this.nyq, v) } : null;
        case 'duck': return mod('duck') ? { p: M.duck.node.gain, conv: D.db2lin } : null;
        case 'dyn0': return mod('dyn0') ? { p: M.dyn0.node.gain, conv: (v) => v } : null;
        case 'dyn1': return mod('dyn1') ? { p: M.dyn1.node.gain, conv: (v) => v } : null;
        case 'deess': return mod('deess') ? { p: M.deess.node.gain, conv: (v) => v } : null;
      }
      return null;
    }
    scheduleAutomation(when, offset, dur) {
      (this.state.automation || []).forEach((l) => {
        const lp = this.laneParam(l);
        if (!lp) return;
        const rate = l.ai && l.ai.rate ? Math.min(100, l.ai.rate) : 40;
        const n = Math.max(2, Math.ceil((dur - offset) * rate) + 1);
        const vals = new Float32Array(n);
        for (let i = 0; i < n; i++) vals[i] = lp.conv(MM.laneValue(l, offset + i / rate));
        try {
          lp.p.cancelScheduledValues(0);
          lp.p.setValueAtTime(vals[0], when);
          lp.p.setValueCurveAtTime(vals, when + 0.001, (n - 1) / rate);
        } catch (e) { console.warn('automação', l.id, e); }
      });
    }
    cancelAutomation(pos) {
      (this.state.automation || []).forEach((l) => {
        const lp = this.laneParam(l);
        if (!lp) return;
        lp.p.cancelScheduledValues(0);
        lp.p.value = lp.conv(MM.laneValue(l, pos || 0));
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
        if (this.opts.filter && !this.opts.filter(s)) return;
        const src = this.ctx.createBufferSource();
        src.buffer = s.buffer;
        src.connect(n.trim); if (n.raw) src.connect(n.raw);
        if (offset < s.buffer.duration) { src.start(when, offset); this.sources.push(src); }
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
      this.lm = true; this.lmGains = { orig: 0, mix: 0, master: 0, ref: 0 }; this.loop = null; this.listeners = [];
      this.meter = { M: -70, S: -70, I: -70, tp: -70, tpMax: -70, corr: 1, pkL: 0, pkR: 0 };
    }
    async init(sr) {
      if (this.ctx) return this.ctx;
      this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: sr || undefined });
      await MM.loadWorklets(this.ctx);
      const c = this.ctx;
      this.out = c.createGain();
      this.mon = { orig: c.createGain(), mix: c.createGain(), master: c.createGain(), ref: c.createGain() };
      Object.values(this.mon).forEach((g) => { g.gain.value = 0; g.connect(this.out); });
      this.mon.mix.gain.value = 1;
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
        opts.tapMix.connect(this.mon.mix); opts.tapMix.connect(this.mon.orig);
      }
      this.graph = new Graph(this.ctx, state, opts);
      if (!opts.masterOnly) {
        this.graph.origBus.connect(this.mon.orig);
        this.graph.mixOut.connect(this.mon.mix);
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
    const sr = o.sr || state.sampleRate;
    const dur = (o.premaster ? o.premaster.duration : state.music.duration) + (o.tail === undefined ? 1.5 : o.tail);
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    await MM.loadWorklets(ctx);
    const g = new Graph(ctx, state, { offline: true, filter: o.filter, masterOnly: o.premaster || null, needOrig: o.out === 'orig' });
    if (o.premaster) g.m.output.connect(ctx.destination);
    else if (o.out === 'orig') g.origBus.connect(ctx.destination);
    else if (o.out === 'premaster') g.mixOut.connect(ctx.destination);
    else { g.mixOut.connect(g.m.input); g.m.output.connect(ctx.destination); }
    if (o.out === 'premaster' && !o.keepMasterAuto) { /* automação de master irrelevante */ }
    g.start(0, 0);
    g.scheduleAutomation(0, 0, dur);
    if (o.onProgress) {
      const step = Math.max(2, dur / 20);
      for (let t = step; t < dur; t += step) ctx.suspend(t).then(() => { o.onProgress(t / dur); ctx.resume(); });
    }
    const buf = await ctx.startRendering();
    if (o.onProgress) o.onProgress(1);
    return buf;
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
