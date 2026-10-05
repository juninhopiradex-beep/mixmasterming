/* MixMind — biblioteca e treino de estilos
 *
 * Fluxo: carregar músicas (masters finais) ou stems pós-fader por estilo → ficam PENDENTES (só o ficheiro é guardado) →
 * ao APROVAR: análise → características guardadas, áudio apagado → perfil do estilo recalculado → classificador re-treinado.
 *
 * O perfil aprendido é usado quando o estilo é escolhido (ou reconhecido) numa sessão:
 *  · master: curva tonal-alvo, alvo de loudness, densidade (PLR → glue/clipper), largura e graves em mono
 *  · mistura: balanço por instrumento (dos stems pós-fader), direção (brilho, punch, largura, loudness)
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const S = (MM.styles = {});
  const fmt = (v, d = 1) => D.fmtNum(v, d);

  // ---------- persistência (IndexedDB próprio, independente dos projetos) ----------
  const DB = 'mixmind-styles';
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('styles', { keyPath: 'id' });
      const t = db.createObjectStore('tracks', { keyPath: 'id' });
      t.createIndex('styleId', 'styleId');
      db.createObjectStore('blobs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), st = t.objectStore(store);
      let out;
      Promise.resolve(fn(st)).then((v) => (out = v));
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
    });
  };
  const getAll = (store) => tx(store, 'readonly', (st) => new Promise((r) => { const q = st.getAll(); q.onsuccess = () => r(q.result); }));
  const put = (store, v) => tx(store, 'readwrite', (st) => { st.put(v); });
  const del = (store, id) => tx(store, 'readwrite', (st) => { st.delete(id); });
  const get = (store, id) => tx(store, 'readonly', (st) => new Promise((r) => { const q = st.get(id); q.onsuccess = () => r(q.result); }));

  S.list = [];      // estilos
  S.tracks = [];    // exemplos de treino (sem áudio)
  S.settings = { autoApprove: false };
  S.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  S.load = async function () {
    try {
      S.list = await getAll('styles');
      S.tracks = await getAll('tracks');
      try { S.settings = Object.assign(S.settings, JSON.parse(localStorage.getItem('mm-styles-settings') || '{}')); } catch (e) { /* */ }
    } catch (e) { console.warn('Biblioteca de estilos indisponível', e); }
    // estilos de base sempre presentes
    for (const g of MM.BUILTIN_GENRES) if (!S.list.some((s) => s.name === g)) S.list.push({ id: 'g:' + g, name: g, base: g, builtin: true, created: 0 });
    // biblioteca publicada com a app (styles/library.json), se existir
    try {
      const r = await fetch('styles/library.json', { cache: 'no-cache' });
      if (r.ok) { const lib = await r.json(); await S.importLibrary(lib, { shipped: true, silent: true }); }
    } catch (e) { /* offline / file:// */ }
    S.list.filter((s) => !s.builtin).forEach((s) => S.registerGenre(s));
    S.recompute();
  };
  S.saveSettings = () => { try { localStorage.setItem('mm-styles-settings', JSON.stringify(S.settings)); } catch (e) { /* */ } };

  S.registerGenre = function (st) {
    if (MM.GENRES[st.name] && !MM.GENRES[st.name].custom) return;
    const base = MM.GENRES[st.base] || MM.GENRES.Pop;
    MM.GENRES[st.name] = Object.assign(JSON.parse(JSON.stringify(base)), { custom: true, base: st.base });
  };
  S.createStyle = async function (name, base) {
    name = name.trim();
    if (!name) throw new Error('Dá um nome ao estilo');
    if (S.list.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error('Esse estilo já existe');
    const st = { id: 's' + S.uid(), name, base: MM.GENRES[base] ? base : 'Pop', builtin: false, created: Date.now() };
    S.list.push(st); S.registerGenre(st);
    await put('styles', st);
    return st;
  };
  S.deleteStyle = async function (id) {
    const st = S.byId(id);
    if (!st || st.builtin) return;
    for (const t of S.tracks.filter((x) => x.styleId === id)) await S.removeTrack(t.id);
    S.list = S.list.filter((s) => s.id !== id);
    delete MM.GENRES[st.name];
    await del('styles', id);
    S.recompute();
  };
  S.byId = (id) => S.list.find((s) => s.id === id);
  S.byName = (n) => S.list.find((s) => s.name === n);
  S.tracksOf = (id) => S.tracks.filter((t) => t.styleId === id);
  const ensureStored = async (st) => { if (st.builtin && !st.stored) { st.stored = true; await put('styles', { id: st.id, name: st.name, base: st.base, builtin: true, created: 0, stored: true }); } };

  // ---------- adicionar exemplos (pendentes) ----------
  /** Adiciona um master (um ficheiro) ou um conjunto de stems (vários ficheiros) ao estilo. */
  S.addItem = async function (styleId, files, kind) {
    const st = S.byId(styleId);
    await ensureStored(st);
    files = Array.from(files);
    const items = [];
    if (kind === 'stems') {
      const name = (files[0].webkitRelativePath && files[0].webkitRelativePath.split('/')[0]) || `Stems (${files.length} ficheiros)`;
      const t = { id: 't' + S.uid(), styleId, kind: 'stems', name, files: files.map((f) => f.name), size: files.reduce((a, f) => a + f.size, 0), status: 'pending', added: Date.now() };
      await put('blobs', { id: t.id, files: files.map((f) => ({ name: f.name, blob: f })) });
      items.push(t);
    } else {
      for (const f of files) {
        const t = { id: 't' + S.uid(), styleId, kind: 'master', name: f.name.replace(/\.[a-z0-9]+$/i, ''), files: [f.name], size: f.size, status: 'pending', added: Date.now() };
        await put('blobs', { id: t.id, files: [{ name: f.name, blob: f }] });
        items.push(t);
      }
    }
    for (const t of items) { S.tracks.push(t); await put('tracks', t); }
    return items;
  };
  /** Exemplo a partir do master atual da sessão (decisão já tomada pelo engenheiro → aprovado). */
  S.addFromSession = async function (styleId, state) {
    const st = S.byId(styleId);
    await ensureStored(st);
    const t = { id: 't' + S.uid(), styleId, kind: 'master', name: state.project.name + ' · ' + (state.currentVersionName || 'master'), files: [], size: 0, status: 'approved', added: Date.now(), source: 'session' };
    t.features = await S.masterFeatures(state.masterBuf);
    if (state.mode !== 'master') t.balance = S.sessionBalance(state);
    S.tracks.push(t); await put('tracks', t);
    S.recompute();
    return t;
  };
  S.reject = async function (id) { const t = S.tracks.find((x) => x.id === id); if (!t) return; t.status = 'rejected'; await put('tracks', t); await del('blobs', id); S.recompute(); };
  S.removeTrack = async function (id) { S.tracks = S.tracks.filter((x) => x.id !== id); await del('tracks', id); await del('blobs', id); S.recompute(); };

  /** Aprovar = analisar e aprender. O áudio é apagado depois da análise (ficam só as medidas). */
  S.approve = async function (id, ctx, onProgress) {
    const t = S.tracks.find((x) => x.id === id);
    if (!t) return;
    const b = await get('blobs', id);
    if (!b) { t.status = 'rejected'; t.error = 'Áudio não encontrado'; await put('tracks', t); return; }
    t.status = 'analyzing';
    try {
      if (t.kind === 'master') {
        const buf = await ctx.decodeAudioData(await b.files[0].blob.arrayBuffer());
        t.features = await S.masterFeatures(buf, onProgress);
        t.duration = buf.duration;
      } else {
        t.balance = await S.stemsBalance(b.files, ctx, onProgress);
        // a soma dos stems também dá um exemplo de tonalidade/tempo
        t.features = t.balance._mixFeatures; delete t.balance._mixFeatures;
      }
      t.status = 'approved'; t.approved = Date.now(); delete t.error;
      await put('tracks', t);
      await del('blobs', id);
    } catch (e) {
      console.error(e);
      t.status = 'pending'; t.error = 'Falhou a análise: ' + e.message;
      await put('tracks', t);
    }
    S.recompute();
  };

  // ---------- características ----------
  const THIRD = D.THIRD_OCT.filter((f) => f >= 25 && f <= 16000);
  /** Características de uma música final (master). */
  S.masterFeatures = async function (buf, onProgress, opt) {
    opt = opt || {};
    let chs = D.channelsOf(buf);
    if (chs.length === 1) chs = [chs[0], chs[0]];
    const sr = buf.sampleRate;
    const m = await MM.measure({ getChannelData: (c) => chs[c], numberOfChannels: 2, sampleRate: sr, channels: chs });
    if (onProgress) onProgress(0.35);
    // curva tonal em 1/3 de oitava, normalizada à média 100 Hz – 4 kHz
    const sp = m.spectrum, pts = sp.freqs.map((f, i) => [Math.log2(f), sp.db[i]]);
    const curve = THIRD.map((f) => D.curveAt(pts, Math.log2(f)));
    const ref = D.mean(curve.filter((_, i) => THIRD[i] >= 100 && THIRD[i] <= 4000));
    const curve31 = curve.map((v) => +(v - ref).toFixed(2));
    // largura por região e punch dos graves
    const band = (lo, hi) => { let L = chs[0], R = chs[1]; if (lo) { const c = D.biquad('highpass', lo, 0.7071, 0, sr); L = D.filter(D.filter(L, c), c); R = D.filter(D.filter(R, c), c); } if (hi) { const c = D.biquad('lowpass', hi, 0.7071, 0, sr); L = D.filter(D.filter(L, c), c); R = D.filter(D.filter(R, c), c); } return [L, R]; };
    const [lL, lR] = band(0, 150), [mL, mR] = band(150, 2500), [hL, hR] = band(2500, 0);
    const wLow = D.width(lL, lR), wMid = D.width(mL, mR), wHigh = D.width(hL, hR);
    if (onProgress) onProgress(0.55);
    // punch: crest médio do grave em janelas de 100 ms (diferença pico − RMS) nas partes ativas
    const lm = D.mono([lL, lR]), win = Math.round(sr * 0.1), cr = [];
    for (let i = 0; i + win < lm.length; i += win) {
      let pk = 0, s2 = 0;
      for (let k = i; k < i + win; k++) { const v = Math.abs(lm[k]); if (v > pk) pk = v; s2 += lm[k] * lm[k]; }
      const rms = Math.sqrt(s2 / win);
      if (rms > 1e-3) cr.push(D.lin2db(pk) - D.lin2db(rms));
    }
    const punch = cr.length ? D.median(cr) : 0;
    // tempo e densidade rítmica (reutiliza o motor de análise musical)
    const mono = D.mono(chs);
    const sf = await MM.analyzeStem([mono], sr, 'fast');
    if (onProgress) onProgress(0.85);
    let bpm = opt.bpm || 0;
    if (!bpm) try { const mu = await MM.analyzeMusic([{ role: 'Drum Loop', chs: [mono], features: sf, length: mono.length }], sr); bpm = mu.bpm; } catch (e) { /* */ }
    // macro-dinâmica: desvio do short-term loudness nas partes ativas
    const stl = m.short.filter((v) => v > m.lufs - 20);
    const mean = D.mean(stl), macro = stl.length ? Math.sqrt(D.mean(stl.map((v) => (v - mean) ** 2))) : 0;
    if (onProgress) onProgress(1);
    return {
      v: 1, lufs: +m.lufs.toFixed(2), lra: +m.lra.toFixed(2), plr: +m.plr.toFixed(2), crest: +m.crest.toFixed(2), tp: +m.tp.toFixed(2),
      width: +m.width.toFixed(3), wLow: +wLow.toFixed(3), wMid: +wMid.toFixed(3), wHigh: +wHigh.toFixed(3), corr: +m.corr.toFixed(3), monoLow: +m.monoLow.toFixed(1),
      bands7: m.bands7.map((v) => +v.toFixed(2)), curve31, punch: +punch.toFixed(2), bpm, onsetRate: +sf.onsetRate.toFixed(2), centroid: Math.round(sf.centroid), macro: +macro.toFixed(2),
      duration: +(chs[0].length / sr).toFixed(1),
    };
  };

  /** Balanço por papel a partir de stems pós-fader (bounce da mistura final): LU relativos à voz principal. */
  S.stemsBalance = async function (files, ctx, onProgress) {
    const sr = ctx.sampleRate, stems = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!/\.(wav|wave|aif|aiff|flac|mp3|m4a|ogg)$/i.test(f.name)) continue;
      const buf = await ctx.decodeAudioData(await f.blob.arrayBuffer());
      const chs = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
      const feat = await MM.analyzeStem(chs, sr, 'fast');
      const cl = MM.classify(f.name, feat);
      stems.push({ name: f.name, role: cl.role, lufs: feat.lufs, silence: feat.silence, chs, centroid: feat.centroid });
      if (onProgress) onProgress(((i + 1) / files.length) * 0.8);
    }
    if (!stems.length) throw new Error('Nenhum stem de áudio na pasta');
    const lead = stems.filter((s) => s.role === 'Lead Vocal').sort((a, b) => b.lufs - a.lufs)[0];
    const refL = lead ? lead.lufs : Math.max(...stems.map((s) => s.lufs));
    const bal = {};
    stems.forEach((s) => {
      if (s.role === 'Reference Track' || s.lufs < -60) return;
      (bal[s.role] = bal[s.role] || []).push(s.lufs - refL);
    });
    const out = {};
    // valor por stem individual (mediana se houver vários do mesmo papel, ex. BV L/R)
    Object.entries(bal).forEach(([r, arr]) => { out[r] = +D.median(arr).toFixed(2); });
    out._ref = lead ? 'Lead Vocal' : 'stem mais alto';
    // soma (para tonalidade/tempo do estilo)
    const len = Math.max(...stems.map((s) => s.chs[0].length));
    const L = new Float32Array(len), R = new Float32Array(len);
    stems.forEach((s) => { const a = s.chs[0], b = s.chs[1] || s.chs[0], k = s.chs.length === 1 ? 0.7071 : 1; for (let i = 0; i < a.length; i++) { L[i] += a[i] * k; R[i] += b[i] * k; } });
    const mixBuf = MM.toAudioBuffer([L, R], sr);
    out._mixFeatures = await S.masterFeatures(mixBuf, (p) => onProgress && onProgress(0.8 + p * 0.2));
    out._mixFeatures.fromStems = true;
    return out;
  };

  /** Balanço da sessão atual (decisões aceites pelo engenheiro): fader relativo à voz, igual à métrica da IA. */
  S.sessionBalance = function (state) {
    const stems = state.stems.filter((s) => !s.removed);
    const v = stems.find((s) => s.role === 'Lead Vocal');
    if (!v) return null;
    const out = { _ref: 'Lead Vocal' };
    const by = {};
    stems.forEach((s) => { if (s === v) return; (by[s.role] = by[s.role] || []).push(s.p.fader - v.p.fader); });
    Object.entries(by).forEach(([r, a]) => (out[r] = +D.median(a).toFixed(2)));
    return out;
  };

  // ---------- perfis ----------
  const SCAL = ['lufs', 'lra', 'plr', 'crest', 'width', 'wLow', 'wMid', 'wHigh', 'corr', 'monoLow', 'punch', 'bpm', 'onsetRate', 'centroid', 'macro'];
  S.profiles = {};
  S.recompute = function () {
    S.profiles = {};
    S.list.forEach((st) => {
      const tr = S.tracksOf(st.id).filter((t) => t.status === 'approved' && t.features);
      const masters = tr.filter((t) => !t.features.fromStems);
      const all = tr;
      const bal = S.tracksOf(st.id).filter((t) => t.status === 'approved' && t.balance);
      if (!all.length && !bal.length) return;
      const p = { n: all.length, nMasters: masters.length, nStems: bal.length, stat: {} };
      const src = masters.length ? masters : all; // loudness/dinâmica só de masters reais
      SCAL.forEach((k) => {
        const arr = (['lufs', 'lra', 'plr', 'crest', 'macro'].includes(k) ? src : all).map((t) => t.features[k]).filter((v) => isFinite(v) && v !== 0);
        if (arr.length) p.stat[k] = { med: D.median(arr), p25: D.percentile(arr, 0.25), p75: D.percentile(arr, 0.75), min: Math.min(...arr), max: Math.max(...arr), n: arr.length };
      });
      if (all.length) {
        p.bands7 = [0, 1, 2, 3, 4, 5, 6].map((i) => D.mean(all.map((t) => t.features.bands7[i])));
        p.bands7sd = [0, 1, 2, 3, 4, 5, 6].map((i) => { const a = all.map((t) => t.features.bands7[i]), m = D.mean(a); return Math.sqrt(D.mean(a.map((v) => (v - m) ** 2))); });
        p.curve31 = THIRD.map((_, i) => D.mean(all.map((t) => t.features.curve31[i])));
        p.curve31sd = THIRD.map((_, i) => { const a = all.map((t) => t.features.curve31[i]), m = D.mean(a); return Math.sqrt(D.mean(a.map((v) => (v - m) ** 2))); });
      }
      if (bal.length) {
        const roles = {};
        bal.forEach((t) => Object.entries(t.balance).forEach(([r, v]) => { if (r[0] !== '_') (roles[r] = roles[r] || []).push(v); }));
        p.balance = {};
        Object.entries(roles).forEach(([r, a]) => (p.balance[r] = { med: +D.median(a).toFixed(2), n: a.length, spread: a.length > 1 ? +(D.percentile(a, 0.75) - D.percentile(a, 0.25)).toFixed(1) : null }));
      }
      p.conf = 1 - Math.exp(-p.n / 4); // 4 músicas ≈ 63 %, 10 ≈ 92 %
      p.balConf = 1 - Math.exp(-p.nStems / 2);
      S.profiles[st.name] = p;
    });
    S.train();
  };
  S.profile = (name) => S.profiles[name] || null;
  S.THIRD = THIRD;

  // ---------- classificador (gaussiano diagonal sobre características normalizadas) ----------
  const VEC = (f, sessionMode) => {
    const b = f.bands7;
    const tilt = (b[5] + b[6]) / 2 - (b[0] + b[1]) / 2;
    const v = [
      f.bpm ? Math.log2(D.clamp(f.bpm, 50, 200) / 100) * 4 : 0,
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], tilt,
      Math.log10(Math.max(1, f.onsetRate)) * 4, Math.log2(Math.max(200, f.centroid) / 1500) * 2,
      f.width * 5, f.wLow * 10, f.punch * 0.4,
    ];
    if (!sessionMode) v.push(f.plr * 0.5, f.macro * 0.6);
    return v;
  };
  S.model = null;
  S.train = function () {
    const data = [];
    S.list.forEach((st) => S.tracksOf(st.id).forEach((t) => { if (t.status === 'approved' && t.features) data.push({ y: st.name, f: t.features }); }));
    const styles = [...new Set(data.map((d) => d.y))];
    if (styles.length < 2) { S.model = null; S.validation = null; return; }
    const fit = (rows, sessionMode) => {
      const X = rows.map((r) => VEC(r.f, sessionMode)), dim = X[0].length;
      const mu = Array.from({ length: dim }, (_, j) => D.mean(X.map((x) => x[j])));
      const sd = Array.from({ length: dim }, (_, j) => Math.max(0.15, Math.sqrt(D.mean(X.map((x) => (x[j] - mu[j]) ** 2)))));
      const cls = {};
      [...new Set(rows.map((r) => r.y))].forEach((y) => {
        const Z = rows.filter((r) => r.y === y).map((r) => VEC(r.f, sessionMode).map((v, j) => (v - mu[j]) / sd[j]));
        const m = Array.from({ length: dim }, (_, j) => D.mean(Z.map((z) => z[j])));
        const v = Array.from({ length: dim }, (_, j) => Math.max(0.35, D.mean(Z.map((z) => (z[j] - m[j]) ** 2)) + 0.1));
        cls[y] = { m, v, n: Z.length };
      });
      return { mu, sd, cls, sessionMode };
    };
    S.fit = fit;
    S.model = { full: fit(data, false), session: fit(data, true) };
    // validação cruzada leave-one-out
    let ok = 0, tot = 0;
    const conf = {};
    data.forEach((d, i) => {
      const rest = data.filter((_, k) => k !== i);
      if (!rest.some((r) => r.y === d.y) || new Set(rest.map((r) => r.y)).size < 2) return;
      const p = S.predict(d.f, fit(rest, false));
      tot++; if (p[0].style === d.y) ok++;
      (conf[d.y] = conf[d.y] || { ok: 0, n: 0 }).n++; if (p[0].style === d.y) conf[d.y].ok++;
    });
    S.validation = tot ? { acc: ok / tot, n: tot, per: conf } : null;
  };
  S.predict = function (f, model) {
    model = model || (S.model && S.model.full);
    if (!model) return [];
    const x = VEC(f, model.sessionMode).map((v, j) => (v - model.mu[j]) / model.sd[j]);
    const ll = Object.entries(model.cls).map(([y, c]) => {
      let l = Math.log(c.n + 1);
      for (let j = 0; j < x.length; j++) l += -0.5 * ((x[j] - c.m[j]) ** 2) / c.v[j] - 0.5 * Math.log(c.v[j]);
      return [y, l];
    });
    const mx = Math.max(...ll.map((a) => a[1]));
    const z = ll.reduce((a, [, l]) => a + Math.exp(l - mx), 0);
    return ll.map(([y, l]) => ({ style: y, p: Math.exp(l - mx) / z })).sort((a, b) => b.p - a.p);
  };
  /** Reconhecer o estilo de uma sessão de stems (antes do master: só tempo, tonalidade, ritmo, largura). */
  S.suggestForSession = async function (state) {
    if (!S.model) return null;
    const stems = state.stems.filter((s) => !s.removed);
    const len = Math.max(...stems.map((s) => s.length));
    const L = new Float32Array(len), R = new Float32Array(len);
    stems.forEach((s) => { const g = D.db2lin(-20 - Math.max(-60, s.features.lufs) + ({ P: 0, S: -6, B: -12 }[s.hier] || -6)); const a = s.chs[0], b = s.chs[1] || s.chs[0]; for (let i = 0; i < a.length; i++) { L[i] += a[i] * g; R[i] += b[i] * g; } });
    const f = await S.masterFeatures(MM.toAudioBuffer([L, R], state.sampleRate), null, { bpm: state.music.bpm });
    const p = S.predict(f, S.model.session);
    return p.length ? { top: p[0], all: p.slice(0, 3), features: f } : null;
  };

  // ---------- aplicar o perfil aprendido ----------
  /** Ajustes da direção da mistura a partir do perfil (deltas e explicações). */
  S.directionDeltas = function (name, baseTargetBands) {
    const p = S.profile(name);
    if (!p || !p.bands7) return null;
    const c = p.conf, out = {}, why = [];
    const tilt = (b) => (b[5] + b[6]) / 2 - (b[0] + b[1]) / 2;
    const dt = tilt(p.bands7) - tilt(baseTargetBands);
    out.tone = D.clamp(dt * 6, -20, 20) * c;
    if (Math.abs(out.tone) > 2) why.push(`${name} aprendido é ${dt > 0 ? 'mais brilhante' : 'mais quente'} (${D.fmtDb(dt)} dB agudos vs graves) → ${dt > 0 ? 'Bright' : 'Warm'}.`);
    if (p.stat.width) { out.width = D.clamp((p.stat.width.med - 0.3) * 80, -18, 18) * c; if (Math.abs(out.width) > 2) why.push(`Largura típica ${Math.round(p.stat.width.med * 100)} % lado/centro → ${out.width > 0 ? 'mais aberto' : 'mais estreito'}.`); }
    if (p.stat.punch) { out.punch = D.clamp((p.stat.punch.med - 9) * 4, -15, 15) * c; if (Math.abs(out.punch) > 2) why.push(`Graves com crest ${fmt(p.stat.punch.med)} dB → ${out.punch > 0 ? 'mais punch' : 'mais suave'}.`); }
    if (p.stat.plr) { out.loud = D.clamp((9 - p.stat.plr.med) * 6, -20, 20) * c; if (Math.abs(out.loud) > 2) why.push(`PLR típico ${fmt(p.stat.plr.med)} dB → ${out.loud > 0 ? 'mais denso/alto' : 'mais dinâmico'}.`); }
    return { d: out, why, n: p.n };
  };
  /** Balanço aprendido (LU relativo à voz) para um papel, ou null. */
  S.learnedBalance = function (name, role) {
    const p = S.profile(name);
    if (!p || !p.balance || !p.balance[role]) return null;
    const b = p.balance[role];
    return { value: b.med, weight: D.clamp(b.n / 3, 0.3, 1) * 0.85, n: b.n };
  };

  // ---------- exportar / importar ----------
  S.exportLibrary = function (onlyStyle) {
    const styles = S.list.filter((s) => (!onlyStyle || s.id === onlyStyle) && S.tracksOf(s.id).some((t) => t.status === 'approved'));
    return {
      app: 'MixMind', kind: 'style-library', v: 1, exported: new Date().toISOString(),
      styles: styles.map((s) => ({ name: s.name, base: s.base, builtin: !!s.builtin, tracks: S.tracksOf(s.id).filter((t) => t.status === 'approved').map((t) => ({ name: t.name, kind: t.kind, features: t.features || null, balance: t.balance || null, added: t.added })) })),
    };
  };
  S.importLibrary = async function (lib, o) {
    o = o || {};
    if (!lib || lib.kind !== 'style-library' || !Array.isArray(lib.styles)) throw new Error('Ficheiro não é uma biblioteca de estilos MixMind');
    let nT = 0, nS = 0;
    for (const s of lib.styles) {
      let st = S.byName(s.name);
      if (!st) {
        st = { id: 's' + S.uid(), name: s.name, base: MM.GENRES[s.base] ? s.base : 'Pop', builtin: false, created: Date.now() };
        S.list.push(st); S.registerGenre(st); nS++;
        if (!o.shipped) await put('styles', st);
      } else if (!o.shipped) await ensureStored(st);
      for (const t of s.tracks || []) {
        if (S.tracks.some((x) => x.styleId === st.id && x.name === t.name && (x.features ? x.features.lufs : '') === (t.features ? t.features.lufs : ''))) continue;
        const nt = { id: (o.shipped ? 'lib' : 't') + S.uid(), styleId: st.id, kind: t.kind, name: t.name, features: t.features, balance: t.balance, status: 'approved', added: t.added || Date.now(), files: [], size: 0, shipped: !!o.shipped };
        S.tracks.push(nt); nT++;
        if (!o.shipped) await put('tracks', nt);
      }
    }
    if (!o.silent) S.recompute();
    return { styles: nS, tracks: nT };
  };
})();
