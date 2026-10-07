/* MIXMIND — "Modelo do engenheiro": aprende AS TUAS decisões de mistura a partir do teu arquivo.
 *
 * Exemplo de treino = um stem bruto + o mesmo stem já misturado por ti (bounce pós-fader). Por cada par:
 *   entrada (stem bruto): família do instrumento, nível face à voz, forma espectral em 7 bandas, crest, centroide, ataques, largura
 *   saída (o que tu fizeste): nível final face à voz (balanço), mudança de forma espectral (EQ) e de crest (compressão)
 * Modelo: regressão ridge por saída (variáveis normalizadas, λ escolhido por validação cruzada deixando uma SESSÃO de fora).
 * Só influencia a IA na medida em que bate as regras de base nessa validação — se não as bater, o peso é zero.
 * Nada de áudio é guardado: ficam só as medidas (IndexedDB 'mixmind-engineer'); exporta/importa em JSON. */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const E = (MM.engineer = { samples: [], sessions: [], model: null, loaded: false, settings: { use: true } });
  const DB = 'mixmind-engineer';
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; ['samples', 'sessions', 'meta'].forEach((s) => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
  const put = (s, v) => tx(s, 'readwrite', (st) => st.put(v));
  const del = (s, id) => tx(s, 'readwrite', (st) => st.delete(id));
  const getAll = (s) => tx(s, 'readonly', (st) => { const out = []; st.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } }; return out; });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const FAMS = () => [...new Set(Object.values(MM.ROLES).map((r) => r.fam))];
  const BAL0 = () => MM.BAL_TABLE || {};
  const MIN_SESSIONS = 3;

  E.load = async function () {
    try {
      E.samples = await getAll('samples');
      E.sessions = await getAll('sessions');
      const meta = await getAll('meta');
      const st = meta.find((m) => m.id === 'settings'); if (st) Object.assign(E.settings, st.v);
    } catch (e) { console.warn('Modelo do engenheiro indisponível', e); }
    E.loaded = true;
    E.train();
  };
  E.saveSettings = () => put('meta', { id: 'settings', v: E.settings }).catch(() => {});

  // ---------- características ----------
  const shapeDb = (bands) => { const v = bands.map((b) => 10 * Math.log10(Math.max(1e-7, b))); const m = D.mean(v); return v.map((x) => x - m); };
  /** Medidas de entrada de um stem bruto. relLu = LU face à voz bruta (ou ao stem mais alto). */
  E.inputOf = (f, relLu) => ({ relLu: D.clamp(relLu, -40, 20), b7: shapeDb(f.bands), crest: D.clamp(f.crest, 0, 40), cent: Math.log2(Math.max(50, f.centroid || 1000) / 1000), onset: D.clamp(f.onsetRate || 0, 0, 20), width: D.clamp(f.width || 0, 0, 1.5) });
  function vec(xf, fam) {
    const F = FAMS(), v = F.map((x) => (x === fam ? 1 : 0));
    v.push(xf.relLu, ...xf.b7, xf.crest, xf.cent, xf.onset, xf.width);
    return v;
  }
  /** Mudança de forma espectral (dB) com a energia do stem como referência: só a forma conta, não o volume. */
  E.shapeDelta = (rawBands, mixBands) => { const a = shapeDb(rawBands), b = shapeDb(mixBands); return b.map((v, i) => v - a[i]); };

  // ---------- emparelhar ficheiros brutos ↔ misturados ----------
  const norm = (n) => n.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[_\-.()[\]]+/g, ' ')
    .replace(/\b(mix(ed)?|bounce[d]?|print|final|pos ?fader|post ?fader|pf|stem|wet|proc(essed)?|raw|dry|bruto|original|v\d+|\d{2,3} ?bpm)\b/g, ' ')
    .replace(/^\s*\d{1,3}\s+/, '').replace(/\s+/g, ' ').trim();
  const bigr = (s) => { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); } return out; };
  E.similarity = (a, b) => {
    a = norm(a); b = norm(b);
    if (a === b) return 1;
    const A = bigr(a), B = bigr(b); let inter = 0, na = 0, nb = 0;
    A.forEach((v, k) => { na += v; if (B.has(k)) inter += Math.min(v, B.get(k)); }); B.forEach((v) => (nb += v));
    return na + nb ? (2 * inter) / (na + nb) : 0;
  };
  /** Emparelhamento guloso pela maior semelhança (≥ 0,55). */
  E.pair = function (raw, mix) {
    const cand = [];
    raw.forEach((r, i) => mix.forEach((m, j) => { const s = E.similarity(r.name, m.name); if (s >= 0.55) cand.push([s, i, j]); }));
    cand.sort((a, b) => b[0] - a[0]);
    const ur = new Set(), um = new Set(), pairs = [];
    cand.forEach(([s, i, j]) => { if (ur.has(i) || um.has(j)) return; ur.add(i); um.add(j); pairs.push({ raw: raw[i], mix: mix[j], score: s }); });
    return { pairs, unmatchedRaw: raw.filter((_, i) => !ur.has(i)), unmatchedMix: mix.filter((_, j) => !um.has(j)) };
  };
  const RAW_RE = /(^|\/)(raw|bruto|brutos|original|originais|multitrack|multitracks|tracks|dry|stems? ?raw|gravac(ao|oes)|grava[cç][õo]es)(\/|$)/i;
  const MIX_RE = /(^|\/)(mix|mixed|misturad[oa]s?|bounce[sd]?|prints?|stems? ?(mix|final|pf|pos.?fader|post.?fader)|pos.?fader|post.?fader|wet|final)(\/|$)/i;
  /** Agrupa os ficheiros de uma pasta de arquivo em sessões: …/<sessão>/<raw|mix>/ficheiro.wav */
  E.parseArchive = function (files) {
    const sess = new Map();
    Array.from(files).forEach((f) => {
      if (!/\.(wav|wave|aif|aiff|flac|mp3|m4a|ogg)$/i.test(f.name)) return;
      const p = (f.webkitRelativePath || f.relPath || f.name).replace(/\\/g, '/');
      const parts = p.split('/'); parts.pop();
      let k = -1, kind = null;
      for (let i = parts.length - 1; i >= 0; i--) { const seg = '/' + parts[i] + '/'; if (RAW_RE.test(seg)) { k = i; kind = 'raw'; break; } if (MIX_RE.test(seg)) { k = i; kind = 'mix'; break; } }
      if (k < 0) return;
      const key = parts.slice(0, k).join('/') || '(raiz)';
      if (!sess.has(key)) sess.set(key, { name: parts[k - 1] || key, key, raw: [], mix: [] });
      sess.get(key)[kind].push(f);
    });
    return [...sess.values()].filter((s) => s.raw.length && s.mix.length);
  };

  // ---------- adicionar exemplos ----------
  const decode = async (ctx, f) => { const buf = await ctx.decodeAudioData(await (f.blob || f).arrayBuffer()); const chs = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c)); return { chs, sr: buf.sampleRate }; };
  /** Analisa uma sessão (pares bruto/misturado) e guarda as medidas. O áudio não é guardado. */
  E.addSession = async function (sess, ctx, onProgress) {
    const P = E.pair(sess.raw, sess.mix);
    if (P.pairs.length < 2) throw new Error(`“${sess.name}”: menos de 2 pares bruto/misturado reconhecidos pelos nomes`);
    const rows = [];
    for (let i = 0; i < P.pairs.length; i++) {
      const { raw, mix } = P.pairs[i];
      const a = await decode(ctx, raw), b = await decode(ctx, mix);
      const fa = await MM.analyzeStem(a.chs, a.sr, 'fast'), fb = await MM.analyzeStem(b.chs, b.sr, 'fast');
      const role = MM.classify(raw.name, fa).role;
      rows.push({ name: raw.name, role, fa, fb });
      if (onProgress) onProgress((i + 1) / P.pairs.length);
      await D.yieldUI();
    }
    const live = rows.filter((r) => r.fa.lufs > -60 && r.fb.lufs > -60 && r.role !== 'Reference Track');
    const vRaw = live.filter((r) => r.role === 'Lead Vocal').sort((x, y) => y.fa.lufs - x.fa.lufs)[0];
    const refRaw = vRaw ? vRaw.fa.lufs : Math.max(...live.map((r) => r.fa.lufs));
    const refMix = vRaw ? vRaw.fb.lufs : null;
    const id = 'e' + uid();
    const samples = live.map((r) => ({
      id: id + ':' + uid(), sessionId: id, name: r.name, role: r.role, fam: MM.ROLES[r.role].fam,
      xf: E.inputOf(r.fa, r.fa.lufs - refRaw),
      y: { bal: refMix !== null && r.role !== 'Lead Vocal' ? +(r.fb.lufs - refMix).toFixed(2) : null, d7: E.shapeDelta(r.fa.bands, r.fb.bands).map((v) => +v.toFixed(2)), dCrest: +(r.fb.crest - r.fa.crest).toFixed(2) },
    }));
    const rec = { id, name: sess.name, added: Date.now(), source: 'archive', pairs: samples.length, unmatched: P.unmatchedRaw.map((f) => f.name).concat(P.unmatchedMix.map((f) => f.name)), vocal: !!vRaw };
    for (const s of samples) await put('samples', s);
    await put('sessions', rec);
    E.samples.push(...samples); E.sessions.push(rec);
    E.train();
    return rec;
  };
  /** A sessão atual (stems brutos + a tua mistura MEDIDA depois do processamento) como exemplo. */
  E.addCurrent = async function (st) {
    if (!MM.insight || !MM.insight.postFresh(st)) throw new Error('Mede primeiro os stems processados (Análise → Depois)');
    const stems = st.stems.filter((s) => !s.removed && s.role !== 'Reference Track' && s.features && s.features.lufs > -60);
    const v = stems.filter((s) => s.role === 'Lead Vocal').sort((a, b) => b.features.lufs - a.features.lufs)[0];
    const refRaw = v ? v.features.lufs : Math.max(...stems.map((s) => s.features.lufs));
    const lu = (s) => MM.stemLU(st, s);
    const refMix = v ? lu(v) : null;
    const map = D.THIRD_OCT.map((f) => D.bands7Edges.findIndex(([lo, hi]) => f >= lo && f < hi));
    const b7 = (L, nb) => { const acc = new Float64Array(7); for (let t = 0; t < nb; t++) for (let k = 0; k < 31; k++) if (map[k] >= 0) acc[map[k]] += L[t * 31 + k]; const s = acc.reduce((a, x) => a + x, 0) || 1; return Array.from(acc, (x) => x / s); };
    const id = 'e' + uid();
    const samples = stems.map((s) => {
      const post = st.post.bands[s.id];
      const rawB = b7(s.features.bandTL, s.features.bandFrames), mixB = post ? b7(post, s.features.bandFrames) : rawB;
      return { id: id + ':' + uid(), sessionId: id, name: s.name, role: s.role, fam: MM.ROLES[s.role].fam, xf: E.inputOf(s.features, s.features.lufs - refRaw), y: { bal: refMix !== null && s !== v ? +(lu(s) - refMix).toFixed(2) : null, d7: E.shapeDelta(rawB, mixB).map((x) => +x.toFixed(2)), dCrest: null } };
    });
    const rec = { id, name: st.project.name + ' · ' + (st.currentVersionName || 'mistura'), added: Date.now(), source: 'session', pairs: samples.length, unmatched: [], vocal: !!v };
    for (const s of samples) await put('samples', s);
    await put('sessions', rec);
    E.samples.push(...samples); E.sessions.push(rec);
    E.train();
    return rec;
  };
  E.removeSession = async function (id) {
    for (const s of E.samples.filter((x) => x.sessionId === id)) await del('samples', s.id);
    await del('sessions', id);
    E.samples = E.samples.filter((x) => x.sessionId !== id); E.sessions = E.sessions.filter((x) => x.id !== id);
    E.train();
  };

  // ---------- ridge ----------
  function solve(A, b) { // Gauss com pivot parcial (A n×n, pequeno)
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c] || 1e-12;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / d; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / (r[i] || 1e-12));
  }
  function fitRidge(X, y, lam) {
    const n = X.length, d = X[0].length;
    const mu = Array(d).fill(0), sd = Array(d).fill(0);
    X.forEach((r) => r.forEach((v, j) => (mu[j] += v / n)));
    X.forEach((r) => r.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / n)));
    for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
    const ym = D.mean(y);
    const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j]));
    const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((a, r) => a + r[i] * r[j], 0) + (i === j ? lam : 0)));
    const b = Array.from({ length: d }, (_, i) => Z.reduce((a, r, k) => a + r[i] * (y[k] - ym), 0));
    return { w: solve(A, b), mu, sd, ym };
  }
  // z-scores limitados a ±3 na previsão: um stem muito diferente do que o modelo viu não é extrapolado sem limite
  const predictR = (m, x) => m.ym + x.reduce((a, v, j) => a + D.clamp((v - m.mu[j]) / m.sd[j], -3, 3) * m.w[j], 0);
  const LAMS = [0.3, 1, 3, 10, 30];
  /** Validação cruzada deixando uma sessão de fora: erro RMS do modelo e da base (regra fixa). */
  function cv(rows, getY, base, lam) {
    const ids = [...new Set(rows.map((r) => r.s.sessionId))];
    let em = 0, eb = 0, n = 0;
    ids.forEach((id) => {
      const tr = rows.filter((r) => r.s.sessionId !== id), te = rows.filter((r) => r.s.sessionId === id);
      if (tr.length < 6) return;
      const m = fitRidge(tr.map((r) => r.x), tr.map((r) => getY(r.s)), lam);
      te.forEach((r) => { const y = getY(r.s); em += (predictR(m, r.x) - y) ** 2; eb += (base(r.s) - y) ** 2; n++; });
    });
    return n ? { model: Math.sqrt(em / n), base: Math.sqrt(eb / n), n } : null;
  }
  /** Treina todas as saídas. Peso = quanto o modelo bate a base em validação cruzada (0 se não bater). */
  E.train = function () {
    const nSess = new Set(E.samples.map((s) => s.sessionId)).size;
    E.model = null;
    if (nSess < MIN_SESSIONS) return null;
    const rows = E.samples.map((s) => ({ s, x: vec(s.xf, s.fam) }));
    const outs = {};
    const fitOut = (key, sel, getY, base) => {
      const R = rows.filter((r) => sel(r.s));
      if (R.length < 8 || new Set(R.map((r) => r.s.sessionId)).size < MIN_SESSIONS) return;
      let best = null;
      LAMS.forEach((lam) => { const c = cv(R, getY, base, lam); if (c && (!best || c.model < best.cv.model)) best = { lam, cv: c }; });
      if (!best) return;
      const gain = best.cv.base > 1e-6 ? 1 - best.cv.model / best.cv.base : 0;
      const fam = {}; R.forEach((r) => (fam[r.s.fam] = (fam[r.s.fam] || 0) + 1));
      outs[key] = { m: fitRidge(R.map((r) => r.x), R.map((r) => getY(r.s)), best.lam), lam: best.lam, cv: best.cv, gain, n: R.length, fam };
    };
    const BAL = BAL0(), b0 = (s) => (BAL[s.role] !== undefined ? BAL[s.role] : -10);
    // balanço modelado como DIFERENÇA face à regra de base do papel (o que tu fazes de diferente), não em absoluto
    fitOut('bal', (s) => s.y.bal !== null && s.y.bal !== undefined, (s) => s.y.bal - b0(s), () => 0);
    for (let k = 0; k < 7; k++) fitOut('d' + k, () => true, (s) => s.y.d7[k], () => 0);
    fitOut('crest', (s) => s.y.dCrest !== null && s.y.dCrest !== undefined, (s) => s.y.dCrest, () => 0);
    const fam = {}; E.samples.forEach((s) => (fam[s.fam] = (fam[s.fam] || 0) + 1));
    E.model = { outs, sessions: nSess, samples: E.samples.length, fam, trained: Date.now() };
    return E.model;
  };
  const famW = (n) => n / (n + 4);
  // peso: quanto bateu a regra na validação × quantos exemplos DESTA família tem essa saída (0 se nenhum)
  const wOf = (o, fam) => (o ? D.clamp(o.gain * 1.6, 0, 0.9) * famW(o.fam[fam] || 0) : 0);
  /** Previsão para um stem da sessão. Devolve null se o modelo estiver desligado ou não existir. */
  E.predict = function (s, state) {
    const M = E.model;
    if (!M || !E.settings.use || !s.features) return null;
    const stems = state.stems.filter((x) => !x.removed && x.role !== 'Reference Track' && x.features && x.features.lufs > -60);
    const v = stems.filter((x) => x.role === 'Lead Vocal').sort((a, b) => b.features.lufs - a.features.lufs)[0];
    const ref = v ? v.features.lufs : Math.max(...stems.map((x) => x.features.lufs));
    const fam = MM.ROLES[s.role].fam, nf = M.fam[fam] || 0;
    const x = vec(E.inputOf(s.features, s.features.lufs - ref), fam);
    const o = M.outs, out = { n: nf, sessions: M.sessions };
    if (o.bal && v && s !== v) { const BAL = BAL0(); out.balRes = D.clamp(predictR(o.bal.m, x), -8, 8); out.bal = (BAL[s.role] !== undefined ? BAL[s.role] : -10) + out.balRes; out.wBal = wOf(o.bal, fam); out.errBal = o.bal.cv.model; }
    const dk = [0, 1, 2, 3, 4, 5, 6].map((k) => o['d' + k]);
    if (dk.every(Boolean)) { out.d7 = dk.map((m) => D.clamp(predictR(m.m, x), -9, 9)); out.wEq = D.mean(dk.map((m) => wOf(m, fam))); }
    if (o.crest) { out.dCrest = D.clamp(predictR(o.crest.m, x), -15, 6); out.wComp = wOf(o.crest, fam); }
    return out;
  };

  // ---------- exportar / importar ----------
  E.export = () => ({ app: 'MIXMIND by Piradex', kind: 'engineer-model', v: 1, saved: new Date().toISOString(), sessions: E.sessions, samples: E.samples });
  E.import = async function (j) {
    if (!j || j.kind !== 'engineer-model') throw new Error('Não é um modelo do engenheiro MIXMIND');
    const have = new Set(E.sessions.map((s) => s.id));
    let ns = 0;
    for (const s of j.sessions || []) { if (have.has(s.id)) continue; await put('sessions', s); E.sessions.push(s); ns++; }
    const hs = new Set(E.samples.map((s) => s.id));
    for (const s of j.samples || []) { if (hs.has(s.id)) continue; await put('samples', s); E.samples.push(s); }
    E.train();
    return { sessions: ns };
  };
})();
