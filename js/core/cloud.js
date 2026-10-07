/* MIXMIND — backend para clientes (Supabase, só REST com fetch: sem SDK, sem build).
 *   · portal.html: clientes enviam masters/stems com consentimento de direitos → ficam PENDENTES
 *   · vista Estilos: o admin entra, ouve/aprova/rejeita; aprovar = descarregar, analisar localmente, publicar as MEDIDAS
 *     na biblioteca partilhada e APAGAR o áudio do servidor
 *   · arranque da app: a biblioteca partilhada (só medidas) é carregada para todos os utilizadores
 * Configuração: config.js (ou Definições → Backend, guardado neste browser). */
(function () {
  const MM = (window.MM = window.MM || {});
  const C = (MM.cloud = {});
  const LS = 'mixmind-cloud', SS = 'mixmind-cloud-session';
  C.cfg = function () {
    const base = Object.assign({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '', BUCKET: 'submissions' }, window.MIXMIND_CONFIG || {});
    try { const o = JSON.parse(localStorage.getItem(LS) || 'null'); if (o && o.SUPABASE_URL) Object.assign(base, o); } catch (e) { /* */ }
    base.SUPABASE_URL = (base.SUPABASE_URL || '').replace(/\/+$/, '');
    return base;
  };
  C.saveLocal = (o) => { try { if (o) localStorage.setItem(LS, JSON.stringify(o)); else localStorage.removeItem(LS); } catch (e) { /* */ } };
  C.on = () => { const c = C.cfg(); return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY); };
  const H = (token, extra) => { const c = C.cfg(); return Object.assign({ apikey: c.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (token || c.SUPABASE_ANON_KEY) }, extra || {}); };
  async function req(path, o) {
    o = o || {};
    const c = C.cfg();
    const r = await fetch(c.SUPABASE_URL + path, { method: o.method || 'GET', headers: H(o.token, o.headers), body: o.body });
    if (!r.ok) { let m = r.status + ' ' + r.statusText; try { const j = await r.json(); m = j.message || j.error_description || j.error || m; } catch (e) { /* */ } const er = new Error(m); er.status = r.status; throw er; }
    return r;
  }
  C.req = req;
  const json = (o) => JSON.stringify(o);

  // ---------- sessão do admin ----------
  C.session = () => { try { const s = JSON.parse(sessionStorage.getItem(SS) || 'null'); return s && s.exp > Date.now() + 30000 ? s : null; } catch (e) { return null; } };
  C.login = async function (email, password) {
    const r = await req('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json({ email, password }) });
    const j = await r.json();
    const s = { token: j.access_token, email: (j.user && j.user.email) || email, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    try { sessionStorage.setItem(SS, JSON.stringify(s)); } catch (e) { /* */ }
    return s;
  };
  C.logout = () => { try { sessionStorage.removeItem(SS); } catch (e) { /* */ } };
  const tok = () => { const s = C.session(); if (!s) throw new Error('Sessão de admin expirada — entra de novo'); return s.token; };

  // ---------- submissões (admin) ----------
  C.listSubmissions = async (status) => (await req(`/rest/v1/submissions?select=*&status=eq.${status || 'pending'}&order=created_at.desc&limit=200`, { token: tok() })).json();
  C.download = async (path) => (await req(`/storage/v1/object/authenticated/${C.cfg().BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { token: tok() })).blob();
  C.removeFiles = async (paths) => { if (!paths.length) return; await req(`/storage/v1/object/${C.cfg().BUCKET}`, { method: 'DELETE', token: tok(), headers: { 'Content-Type': 'application/json' }, body: json({ prefixes: paths }) }); };
  C.setStatus = async (id, status) => req(`/rest/v1/submissions?id=eq.${id}`, { method: 'PATCH', token: tok(), headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: json({ status, reviewed_at: new Date().toISOString() }) });
  C.publish = async (row) => req('/rest/v1/library_tracks', { method: 'POST', token: tok(), headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: json(row) });

  /** Aprovar: descarrega → análise local (igual a um exemplo teu) → publica só as medidas → apaga o áudio do servidor. */
  C.approve = async function (sub, styleId, ctx, onProgress) {
    const S = MM.styles, st = S.byId(styleId);
    const files = [];
    for (let i = 0; i < sub.files.length; i++) {
      const f = sub.files[i];
      const blob = await C.download(f.path);
      files.push(new File([blob], f.name, { type: blob.type || 'audio/wav' }));
      if (onProgress) onProgress(((i + 1) / sub.files.length) * 0.3);
    }
    const items = await S.addItem(styleId, files, sub.kind);
    const published = [];
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      t.name = sub.kind === 'master' && items.length === 1 ? sub.title : t.name;
      t.client = sub.client_name;
      await S.approve(t.id, ctx, (p) => onProgress && onProgress(0.3 + ((i + p) / items.length) * 0.6));
      const t2 = S.tracks.find((x) => x.id === t.id);
      if (!t2 || t2.status !== 'approved') throw new Error('A análise falhou: ' + ((t2 && t2.error) || '?'));
      await C.publish({ style: st.name, base: st.base || st.name, kind: t2.kind, name: t2.name, features: t2.features || null, balance: t2.balance || null, submission_id: sub.id });
      published.push(t2);
    }
    await C.removeFiles(sub.files.map((f) => f.path));
    await C.setStatus(sub.id, 'approved');
    if (onProgress) onProgress(1);
    return published;
  };
  C.reject = async function (sub) { await C.removeFiles(sub.files.map((f) => f.path)); await C.setStatus(sub.id, 'rejected'); };

  // ---------- biblioteca partilhada (pública: só medidas) ----------
  C.loadLibrary = async function () {
    if (!C.on() || !MM.styles) return 0;
    try {
      const rows = await (await req('/rest/v1/library_tracks?select=id,style,base,kind,name,features,balance,created_at&order=created_at.asc&limit=5000')).json();
      const by = new Map();
      rows.forEach((r) => { if (!by.has(r.style)) by.set(r.style, { name: r.style, base: r.base, builtin: !!(MM.GENRES[r.style] && !MM.GENRES[r.style].custom), tracks: [] }); by.get(r.style).tracks.push({ name: r.name, kind: r.kind, features: r.features, balance: r.balance, added: Date.parse(r.created_at) || Date.now() }); });
      const res = await MM.styles.importLibrary({ kind: 'style-library', styles: [...by.values()] }, { shipped: true, silent: true });
      MM.styles.recompute();
      C.libraryRows = rows.length;
      return res.tracks;
    } catch (e) { console.warn('Biblioteca partilhada indisponível', e); C.libraryError = e.message; return 0; }
  };

  // ---------- portal (envio dos clientes, chave anon) ----------
  C.safeName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 90);
  /** Envio com progresso (XHR). path relativo ao bucket, sempre em incoming/… */
  C.upload = function (file, path, onProgress) {
    const c = C.cfg();
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('POST', `${c.SUPABASE_URL}/storage/v1/object/${c.BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
      x.setRequestHeader('apikey', c.SUPABASE_ANON_KEY); x.setRequestHeader('Authorization', 'Bearer ' + c.SUPABASE_ANON_KEY);
      x.setRequestHeader('x-upsert', 'false'); x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => (x.status >= 200 && x.status < 300 ? res(path) : rej(new Error(`Falhou o envio de ${file.name}: ${x.status} ${(x.responseText || '').slice(0, 160)}`)));
      x.onerror = () => rej(new Error('Sem ligação ao servidor'));
      x.send(file);
    });
  };
  C.submit = async (row) => req('/rest/v1/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: json(row) });
  C.styles = async function () {
    const base = (MM.BUILTIN_GENRES || ['Kizomba', 'Semba', 'Kuduro', 'Afrobeat', 'Amapiano', 'R&B', 'Pop', 'Hip-Hop', 'Trap', 'Reggaeton', 'Rock', 'Jazz', 'Acoustic', 'EDM', 'House', 'Techno', 'Gospel', 'Afro House', 'Ghetto Zouk', 'Tarraxinha', 'Zouk']).slice();
    try { const rows = await (await req('/rest/v1/library_tracks?select=style&limit=5000')).json(); rows.forEach((r) => { if (!base.includes(r.style)) base.push(r.style); }); } catch (e) { /* */ }
    return base;
  };
})();
