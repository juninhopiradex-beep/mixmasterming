/* MIXMIND — projeto completo num ficheiro (.mixmind = ZIP)
 * project.json (decisões, versões, automação, secções, análise) + áudio original dos stems/referências.
 * Serve de cópia de segurança e para levar o projeto para outro computador/browser. */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const P = (MM.project = {});
  P.FORMAT = 'mixmind-project';
  P.VERSION = 2;

  // ---------- JSON com arrays tipados (base64) ----------
  const b64 = (u8) => { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  const unb64 = (str) => { const s = atob(str), u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; };
  P.replacer = function (k, v) {
    if (v && ArrayBuffer.isView(v)) {
      const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), t = v.constructor.name;
      if (t === 'Float32Array') return { __f32: b64(u) };
      if (t === 'Float64Array') return { __f64: b64(u) };
      if (t === 'Int32Array') return { __i32: b64(u) };
      if (t === 'Uint8Array') return { __u8: b64(u) };
    }
    if (typeof AudioBuffer !== 'undefined' && v instanceof AudioBuffer) return undefined;
    return v;
  };
  P.reviver = function (k, v) {
    if (v && typeof v === 'object') {
      if (v.__f32) { const u = unb64(v.__f32); return new Float32Array(u.buffer, 0, u.byteLength / 4); }
      if (v.__f64) { const u = unb64(v.__f64); return new Float64Array(u.buffer, 0, u.byteLength / 8); }
      if (v.__i32) { const u = unb64(v.__i32); return new Int32Array(u.buffer, 0, u.byteLength / 4); }
      if (v.__u8) return unb64(v.__u8);
    }
    return v;
  };
  const safeName = (s) => String(s).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 80);
  const extOf = (name, raw) => { const m = /\.([a-z0-9]{2,4})$/i.exec(name || ''); return m ? m[1].toLowerCase() : raw ? 'bin' : 'wav'; };

  /** Versões sem buffers de áudio (só decisões, métricas e scores). */
  P.versionsLite = (st) => (st.versions || []).map((v) => Object.assign({}, v, { masterBuf: null, premasterBuf: null }));

  /** Gera o ficheiro .mixmind (Uint8Array). */
  P.export = async function (st, onProgress) {
    const files = [];
    const stems = [];
    for (let i = 0; i < st.stems.length; i++) stems.push(await (async (s) => {
      let file = null;
      if (st.mode !== 'master') {
        file = `stems/${String(i + 1).padStart(2, '0')}_${safeName(s.name.replace(/\.[a-z0-9]+$/i, ''))}.${s.raw ? extOf(s.name, true) : 'flac'}`;
        // sem o ficheiro original (ex.: demo sintetizada): FLAC 24-bit sem perdas, ~metade do tamanho
        files.push({ name: file, data: s.raw ? new Uint8Array(s.raw) : MM.exporter.flac(s.chs, st.sampleRate, 24) });
      }
      if (onProgress) onProgress((i + 1) / Math.max(1, st.stems.length) * 0.7);
      await D.yieldUI();
      return { id: s.id, name: s.name, file, features: s.features, removed: !!s.removed };
    })(st.stems[i]));
    const refs = (st.refs || []).map((r, i) => {
      const file = `refs/${String(i + 1).padStart(2, '0')}_${safeName(r.name)}.${r.raw ? 'bin' : 'flac'}`;
      files.push({ name: file, data: r.raw ? new Uint8Array(r.raw) : MM.exporter.flac(D.channelsOf(r.buffer), st.sampleRate, 24) });
      return { id: r.id, name: r.name, file };
    });
    let premasterFile = null;
    if (st.mode === 'master' && (st.premasterRaw || st.premaster)) {
      premasterFile = 'premaster/' + safeName(st.project.name) + (st.premasterRaw ? '.bin' : '.flac');
      files.push({ name: premasterFile, data: st.premasterRaw ? new Uint8Array(st.premasterRaw) : MM.exporter.flac(D.channelsOf(st.premaster), st.sampleRate, 24) });
    }
    const doc = {
      app: 'MIXMIND by Piradex', format: P.FORMAT, v: P.VERSION, appVersion: MM.VERSION, saved: new Date().toISOString(),
      project: st.project, mode: st.mode, sampleRate: st.sampleRate, music: st.music, settings: st.settings, issues: st.issues,
      snap: MM.snapshot(st), versions: P.versionsLite(st), currentVersion: st.currentVersion, currentVersionName: st.currentVersionName,
      album: st.album || null, meta: st.meta || null,
      stems, refs, premasterFile,
    };
    files.unshift({ name: 'project.json', data: JSON.stringify(doc, P.replacer) });
    files.push({ name: 'LEIA-ME.txt', data: `Projeto MIXMIND by Piradex — ${st.project.name}\nGuardado em ${new Date().toLocaleString('pt-PT')} (app v${MM.VERSION}).\nAbre em MIXMIND → Início → "Abrir projeto (.mixmind)". Contém o áudio original dos stems e todas as decisões, versões e automações.\n` });
    if (onProgress) onProgress(0.9);
    const zip = MM.exporter.zip(files);
    if (onProgress) onProgress(1);
    return zip;
  };

  /** Lê um .mixmind e devolve um registo no mesmo formato do IndexedDB (rec), com o áudio em ArrayBuffers. */
  P.read = async function (u8) {
    const entries = await MM.exporter.unzip(u8);
    const byName = new Map(entries.map((e) => [e.name, e.data]));
    const pj = byName.get('project.json');
    if (!pj) throw new Error('Não é um projeto MIXMIND (falta project.json)');
    const doc = JSON.parse(new TextDecoder().decode(pj), P.reviver);
    if (doc.format !== P.FORMAT) throw new Error('Formato de projeto desconhecido');
    const ab = (name) => { const d = name && byName.get(name); return d ? d.slice().buffer : null; };
    return {
      id: doc.project.id || 'p' + Date.now().toString(36), name: doc.project.name, mode: doc.mode, sampleRate: doc.sampleRate,
      music: doc.music, settings: doc.settings, issues: doc.issues, snap: doc.snap, versions: doc.versions || [], currentVersion: doc.currentVersion, currentVersionName: doc.currentVersionName,
      album: doc.album, meta: doc.meta,
      stems: doc.stems.filter((s) => s.file).map((s) => ({ id: s.id, name: s.name, features: s.features, raw: ab(s.file), removed: s.removed })),
      refs: (doc.refs || []).map((r) => ({ id: r.id, name: r.name, raw: ab(r.file) })),
      premasterRaw: ab(doc.premasterFile), imported: true, appVersion: doc.appVersion,
    };
  };

  // ---------- recuperação de sessão ----------
  const KEY = 'mixmind-open-session';
  P.markOpen = (st) => { try { if (st && st.project && !st.project.demo) localStorage.setItem(KEY, JSON.stringify({ id: st.project.id, name: st.project.name, t: Date.now() })); } catch (e) { /* */ } };
  P.markClosed = () => { try { localStorage.removeItem(KEY); } catch (e) { /* */ } };
  P.pendingRecovery = () => { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
})();
