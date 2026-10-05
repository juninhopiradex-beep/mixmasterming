/* MixMind — sessão: estado do projeto, importação, pipeline de IA, undo/redo, versões e persistência local. */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;

  const SHORT = { 'Lead Vocal': 'Lead Vocal', 'Backing Vocal': 'BV', 'Electric Guitar': 'Guitar', 'Acoustic Guitar': 'Ac. Guitar', 'Electric Bass': 'Bass', 'Sub Bass': 'Sub', Risers: 'FX Riser', Impacts: 'Impact', 'Drum Loop': 'Drums', 'Reference Track': 'Ref' };
  MM.newState = function () {
    return {
      v: 1, mode: 'stems', project: { name: 'Sem título', id: 'p' + Date.now().toString(36) },
      stage: 'empty', sampleRate: 48000, stems: [], music: null,
      direction: Object.fromEntries(MM.DIR.map(([k]) => [k, 50])), directionAI: null, directionReasons: [], aesthetics: [],
      fx: {
        plate: { decay: 1.4, predelay: 40, lpf: 9000, hpf: 250, ret: 0, duck: 3 },
        room: { decay: 0.8, predelay: 8, lpf: 8000, hpf: 250, ret: 0, duck: 0 },
        hall: { decay: 2.4, predelay: 30, lpf: 8000, hpf: 250, ret: 0, duck: 0 },
        delay: { division: '1/4', time: 0.64, feedback: 0.28, lpf: 5500, ret: -2, duck: 4 }, manual: false,
      },
      bus: { trim: 0, eq: { low: 0, high: 0 }, glue: { on: true, thr: -14, ratio: 2, atk: 30, rel: 200, knee: 6, mix: 1, gr: 1.2 }, sat: { on: false, model: 'tape', drive: 0.1, mix: 0.5 }, drumPar: { on: false, mix: 0.3 }, manual: false },
      master: MM.defaultMaster(), automation: [], rider: { max: 3, target: 1.5, smooth: 70, breaths: -4, adlibs: -2 },
      refs: [], activeRef: null, refInfluence: 0.6, refApply: { mix: false, master: true },
      metrics: {}, score: null, explain: [], masterExplain: [], conflicts: [], confidence: {}, issues: [],
      versions: [], currentVersion: null, currentVersionName: null, dirty: { mix: false, master: false },
      settings: { quality: 'balanced', guard: 'normal', processing: 'local', gpu: 'auto', exportSR: 48000, bits: 24, format: 'wav' },
    };
  };

  // ---------- importação ----------
  let idc = 0;
  MM.decodeFile = async function (ctx, file) {
    const ab = await file.arrayBuffer();
    const header = MM.parseHeader(ab);
    const buf = await ctx.decodeAudioData(ab.slice(0));
    return { ab, header, buf };
  };
  MM.makeStem = function (name, chs, sr, header, raw, decoded) {
    // mono falso → mono
    if (chs.length === 2) {
      let md = 0, pk = 0; const a = chs[0], b = chs[1];
      for (let i = 0; i < a.length; i += 5) { const d = Math.abs(a[i] - b[i]); if (d > md) md = d; const p = Math.abs(a[i]); if (p > pk) pk = p; }
      if (md < pk * 1e-3 + 1e-7) chs = [a];
    }
    if (chs.length > 2) chs = chs.slice(0, 2);
    // reaproveita o AudioBuffer descodificado quando possível (evita duplicar a memória)
    const buffer = decoded && decoded.numberOfChannels === chs.length && decoded.sampleRate === sr ? decoded : MM.toAudioBuffer(chs, sr);
    chs = D.channelsOf(buffer);
    return {
      id: 's' + (++idc) + Math.random().toString(36).slice(2, 6), name, label: name.replace(/\.[a-z0-9]+$/i, ''), short: '', chs, length: chs[0].length,
      origChannels: header && header.channels ? header.channels : chs.length,
      header: header || {}, raw: raw || null, role: 'FX', conf: 0.5, hier: 'B', group: 'fx', notes: [], alts: [],
      locked: false, mute: false, solo: false, removed: false, p: MM.defaultParams(), manual: {}, ai: null,
      buffer, peaks: MM.peaks(chs, 240),
    };
  };
  MM.peaks = function (chs, n) {
    const x = chs[0], y = chs[1] || chs[0], len = x.length, out = new Float32Array(n);
    const step = Math.max(1, Math.floor(len / n));
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = i * step; k < Math.min(len, (i + 1) * step); k += 4) { const v = Math.max(Math.abs(x[k]), Math.abs(y[k])); if (v > m) m = v; }
      out[i] = m;
    }
    return out;
  };
  MM.assignLabels = function (state) {
    const count = {};
    const stems = state.stems.filter((s) => !s.removed);
    stems.forEach((s) => (count[s.role] = (count[s.role] || 0) + 1));
    const idx = {};
    stems.forEach((s) => {
      const base = SHORT[s.role] || s.role;
      if (s.pair && s.pairSide) { s.label = (s.role === 'Backing Vocal' ? 'Backing Vocal' : base) + ' ' + s.pairSide; s.short = (s.role === 'Backing Vocal' ? 'BV' : base) + ' ' + s.pairSide; return; }
      if (count[s.role] > 1) { idx[s.role] = (idx[s.role] || 0) + 1; s.label = (s.role === 'Backing Vocal' ? 'Backing Vocal' : base) + ' ' + idx[s.role]; s.short = base + ' ' + idx[s.role]; }
      else { s.label = s.role === 'Backing Vocal' ? 'Backing Vocal' : base === 'BV' ? 'Backing Vocal' : s.role === 'Electric Guitar' ? 'Guitar' : base; s.short = base; }
    });
  };
  MM.setRole = function (state, s, role) {
    s.role = role;
    const r = MM.ROLES[role];
    s.group = r.group;
    if (!s.manual.hier) s.hier = r.hier;
    MM.assignLabels(state);
  };

  // ---------- análise ----------
  MM.analyzeSession = async function (state, step) {
    const stems = state.stems.filter((s) => !s.removed);
    const sr = state.sampleRate;
    step('import', 1, `${stems.length} stems`);
    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      step('identify', i / stems.length, `${i + 1} / ${stems.length}`);
      s.features = await MM.analyzeStem(s.chs, sr, state.settings.quality, (p) => step('identify', (i + p) / stems.length, `${i + 1} / ${stems.length}`));
      const c = MM.classify(s.name, s.features);
      s.conf = c.conf; s.alts = c.alts; s.notes = c.notes.slice(); s.nameRole = c.nameRole;
      MM.setRole(state, s, c.role);
    }
    step('identify', 1, `${stems.length} / ${stems.length}`);
    // faixas de referência entregues como stem
    stems.filter((s) => s.role === 'Reference Track').forEach((s) => { s.removed = true; state.pendingRefs = (state.pendingRefs || []).concat([s]); });
    state.issues = MM.detectImportIssues(stems.filter((s) => !s.removed), sr);
    MM.assignLabels(state);
    step('music', 0, 'em curso…');
    state.music = await MM.analyzeMusic(stems.filter((s) => !s.removed), sr, (p) => step('music', p, 'em curso…'));
    step('music', 1, `${state.music.bpm} BPM · ${state.music.key}`);
    const pd = MM.proposeDirection(state);
    state.directionAI = Object.assign({}, pd.dir); state.direction = Object.assign({}, pd.dir); state.directionReasons = pd.reasons;
    const g = MM.GENRES[state.music.genre];
    if (g) { state.master.target = g.target; state.master.targetBase = g.target; state.master.style = ({ punchy: 'Punchy', warm: 'Warm', loud: 'Aggressive', wide: 'Wide', transparent: 'Transparent' })[g.style] || 'Punchy'; }
    state.stage = 'review';
  };

  MM.predictBusTrim = function (state) {
    let p = 0;
    state.stems.forEach((s) => { if (s.removed || s.mute || !s.features) return; p += (1 - s.features.silence * 0.7) * Math.pow(10, (-20 + s.p.fader) / 10); });
    const L = 10 * Math.log10(p + 1e-9);
    return +(-18 - L + (state.bus.calib || 0)).toFixed(1);
  };

  /** Pipeline completo: decisões → premaster → master → métricas → score → versão. */
  MM.runAI = async function (state, engine, step, opts) {
    opts = opts || {};
    const stems = state.stems.filter((s) => !s.removed);
    if (!opts.keepMix) {
      step('plan', 0.1, 'decisões de mistura');
      await D.yieldUI();
      MM.runMix(state);
      stems.forEach((s) => (s.ai = JSON.parse(JSON.stringify(s.p))));
      if (state.refApply.mix && state.activeRef) MM.applyRefToMix(state);
      state.bus.trim = MM.predictBusTrim(state);
    }
    engine.rebuild(state);
    step('plan', 1, 'plano pronto');
    await MM.renderVersions(state, engine, step, opts);
  };

  MM.applyRefToMix = function (state) {
    const ref = state.refs.find((r) => r.id === state.activeRef);
    if (!ref || !state.metrics.mix) return;
    const d = state.metrics.mix.bands7.map((v, i) => v - ref.metrics.bands7[i]);
    const k = state.refInfluence * 0.5;
    state.bus.eq.low = +D.clamp(state.bus.eq.low - (d[0] + d[1]) * 0.5 * k, -3, 3).toFixed(1);
    state.bus.eq.high = +D.clamp(state.bus.eq.high - (d[5] + d[6]) * 0.5 * k, -3, 3).toFixed(1);
  };

  MM.renderVersions = async function (state, engine, step, opts) {
    opts = opts || {};
    const sr = state.sampleRate;
    if (state.mode !== 'master' && !(opts.reuseMix && state.premasterBuf)) {
      step('render', 0, 'premaster');
      const pre = await MM.render(state, { out: 'premaster', sr, onProgress: (p) => step('render', p * 0.45, 'premaster') });
      state.premasterBuf = pre;
      let pm = await MM.measure(pre, { sections: state.music.sections });
      // calibração do nível do bus: o premaster deve chegar ao master perto de −18 LUFS
      const delta = -18 - pm.lufs;
      if (Math.abs(delta) > 1 && pm.lufs > -60) {
        state.bus.trim = +(state.bus.trim + delta).toFixed(1);
        state.bus.calib = +((state.bus.calib || 0) + delta).toFixed(1);
        const g = D.db2lin(delta);
        D.channelsOf(pre).forEach((c) => { for (let i = 0; i < c.length; i++) c[i] *= g; });
        pm = await MM.measure(pre, { sections: state.music.sections });
        if (engine.graph && engine.graph.applyBus) engine.graph.applyBus();
      }
      state.metrics.mix = pm;
      state.master.premasterLufs = pm.lufs;
      // original: soma simples dos stems
      if (!state.metrics.orig || opts.orig) {
        const len = Math.max(...state.stems.filter((s) => !s.removed).map((s) => s.length));
        const L = new Float32Array(len), R = new Float32Array(len);
        state.stems.forEach((s) => { if (s.removed) return; const a = s.chs[0], b = s.chs[1] || s.chs[0], k = s.chs.length === 1 ? 0.7071 : 1; for (let i = 0; i < a.length; i++) { L[i] += a[i] * k; R[i] += b[i] * k; } });
        state.origBuf = { channels: [L, R], sampleRate: sr };
        state.metrics.orig = await MM.measure({ getChannelData: (c) => [L, R][c], numberOfChannels: 2, sampleRate: sr, channels: [L, R] }, { sections: state.music.sections });
        state.origPeaks = MM.peaks([L, R], 900);
      }
    } else if (state.mode === 'master') {
      state.premasterBuf = state.premaster;
      if (!state.metrics.mix) { const pm = await MM.measure(state.premaster); state.metrics.mix = pm; state.metrics.orig = pm; state.master.premasterLufs = pm.lufs; }
    }
    step('render', 0.5, 'master');
    const ref = state.refs.find((r) => r.id === state.activeRef);
    if (!opts.keepMaster) MM.runMaster(state, state.metrics.mix, ref ? ref.metrics : null);
    const res = await MM.masterize(state, state.premasterBuf, { onProgress: (p) => step('render', 0.5 + p * 0.5, 'master') });
    state.masterBuf = res.buffer;
    state.metrics.master = res.metrics;
    state.masterPeaks = MM.peaks(D.channelsOf(res.buffer), 900);
    state.mixPeaks = MM.peaks(D.channelsOf(state.premasterBuf), 900);
    state.masterGR = state.master.chain.glue.gr + Math.max(0, res.metrics.plr < 9 ? 2 : 1);
    state.score = MM.computeScore(state, Object.assign({ gr: state.masterGR }, res.metrics));
    state.mixScore = state.mode === 'master' ? null : MM.computeScore(state, Object.assign({}, state.metrics.mix, { lufs: state.master.target, tp: -3 }));
    state.qc = MM.exporter.qc(res.metrics, state);
    if (state.metrics.orig && state.mode !== 'master') state.scoreOrig = MM.computeScore(state, state.metrics.orig, { raw: true }).overall;
    engine.setLoudness({ orig: state.metrics.orig ? state.metrics.orig.lufs : -60, mix: state.metrics.mix.lufs, master: res.metrics.lufs, ref: ref ? ref.metrics.lufs : -60 });
    state.dirty = { mix: false, master: false };
    step('render', 1, 'pronto');
    state.stage = 'ready';
    if (!opts.noVersion) MM.saveVersion(state, opts.versionName);
  };

  // ---------- snapshots / undo / versões ----------
  const SNAP_STEM = ['id', 'name', 'label', 'short', 'role', 'conf', 'hier', 'group', 'locked', 'mute', 'solo', 'removed', 'p', 'manual', 'ai', 'notes', 'alts', 'pair', 'pairSide', 'header', 'nameRole'];
  MM.snapshot = function (state) {
    return structuredClone({
      stems: state.stems.map((s) => Object.fromEntries(SNAP_STEM.map((k) => [k, s[k]]))),
      direction: state.direction, aesthetics: state.aesthetics, fx: state.fx, bus: state.bus, master: state.master,
      automation: state.automation, rider: state.rider, refInfluence: state.refInfluence, refApply: state.refApply, activeRef: state.activeRef,
      explain: state.explain, masterExplain: state.masterExplain, conflicts: state.conflicts, confidence: state.confidence,
    });
  };
  MM.restore = function (state, snap) {
    snap = structuredClone(snap);
    snap.stems.forEach((ss) => { const s = state.stems.find((x) => x.id === ss.id); if (s) Object.assign(s, ss); });
    ['direction', 'aesthetics', 'fx', 'bus', 'master', 'automation', 'rider', 'refInfluence', 'refApply', 'activeRef', 'explain', 'masterExplain', 'conflicts', 'confidence'].forEach((k) => { if (snap[k] !== undefined) state[k] = snap[k]; });
  };
  const hist = { undo: [], redo: [] };
  MM.history = hist;
  MM.commit = function (state, label) {
    hist.undo.push({ label, snap: MM.snapshot(state) });
    if (hist.undo.length > 300) hist.undo.shift();
    hist.redo.length = 0;
    state.dirty.mix = true; state.dirty.master = true;
  };
  MM.undo = function (state) { const h = hist.undo.pop(); if (!h) return null; hist.redo.push({ label: h.label, snap: MM.snapshot(state) }); MM.restore(state, h.snap); return h.label; };
  MM.redo = function (state) { const h = hist.redo.pop(); if (!h) return null; hist.undo.push({ label: h.label, snap: MM.snapshot(state) }); MM.restore(state, h.snap); return h.label; };

  MM.saveVersion = function (state, name) {
    const kindMix = state.mode !== 'master';
    const n = state.versions.filter((v) => v.kind === (kindMix ? 'mix' : 'master')).length + 1;
    const v = {
      id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || (kindMix ? 'Mix V' : 'Master V') + n, kind: kindMix ? 'mix' : 'master',
      created: Date.now(), snap: MM.snapshot(state), lufs: state.metrics.master ? state.metrics.master.lufs : null, score: state.score ? state.score.overall : null,
      masterBuf: state.masterBuf, premasterBuf: state.premasterBuf, metrics: structuredClone({ mix: state.metrics.mix, master: state.metrics.master }),
    };
    state.versions.push(v);
    if (state.versions.length > 12) { const old = state.versions.find((x) => x.masterBuf && x.id !== v.id); if (old) { old.masterBuf = null; old.premasterBuf = null; } }
    state.currentVersion = v.id; state.currentVersionName = v.name;
    return v;
  };
  MM.loadVersion = function (state, id) {
    const v = state.versions.find((x) => x.id === id);
    if (!v) return null;
    MM.restore(state, v.snap);
    state.currentVersion = v.id; state.currentVersionName = v.name;
    if (v.masterBuf) {
      state.masterBuf = v.masterBuf; state.premasterBuf = v.premasterBuf;
      state.metrics.mix = v.metrics.mix; state.metrics.master = v.metrics.master;
      state.masterPeaks = MM.peaks(D.channelsOf(v.masterBuf), 900); state.mixPeaks = MM.peaks(D.channelsOf(v.premasterBuf), 900);
      state.dirty = { mix: false, master: false };
    } else state.dirty = { mix: true, master: true };
    return v;
  };

  // ---------- persistência (IndexedDB) ----------
  const DB = 'mixmind', STORE = 'projects';
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  MM.saveProject = async function (state) {
    try {
      const db = await idb();
      const rec = {
        id: state.project.id, name: state.project.name, updated: Date.now(), demo: !!state.project.demo, mode: state.mode,
        sampleRate: state.sampleRate, music: state.music, snap: MM.snapshot(state), settings: state.settings, issues: state.issues,
        stems: state.stems.map((s) => ({ id: s.id, name: s.name, features: s.features, raw: state.project.demo ? null : s.raw })),
        refs: state.refs.map((r) => ({ id: r.id, name: r.name, raw: r.raw, metrics: r.metrics })),
        premasterRaw: state.mode === 'master' ? state.premasterRaw : null,
      };
      await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      return true;
    } catch (e) { console.warn('Não foi possível guardar o projeto', e); return false; }
  };
  MM.listProjects = async function () {
    try {
      const db = await idb();
      return await new Promise((res) => { const out = []; const tx = db.transaction(STORE); tx.objectStore(STORE).openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push({ id: c.value.id, name: c.value.name, updated: c.value.updated, demo: c.value.demo, mode: c.value.mode, n: c.value.stems.length }); c.continue(); } else res(out.sort((a, b) => b.updated - a.updated)); }; });
    } catch (e) { return []; }
  };
  MM.getProject = async function (id) {
    const db = await idb();
    return new Promise((res) => { const r = db.transaction(STORE).objectStore(STORE).get(id); r.onsuccess = () => res(r.result); });
  };
  MM.deleteProject = async function (id) {
    const db = await idb();
    return new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; });
  };
})();
