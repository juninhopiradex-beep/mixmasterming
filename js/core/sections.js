/* MIXMIND — edição da estrutura (secções) e mute por secção.
 * As secções comandam a automação (send de reverb, filtro do pad, largura do master, vocal rider),
 * por isso qualquer edição reconstrói a automação da IA, mantendo as edições manuais. */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;

  const NAMES = ['Intro', 'Verso', 'Pré', 'Refrão', 'Bridge', 'Refrão final', 'Drop', 'Break', 'Instrumental', 'Outro'];
  const MIN_LEN = 0.5; // s

  const S = (MM.sections = {
    NAMES,
    list: (st) => (st.music && st.music.sections) || [],
    /** Tempo do compasso mais próximo (grelha do BPM detetado). */
    snap(st, t) {
      const m = st.music;
      if (!m || !m.barSec) return t;
      const b = Math.round((t - m.downbeat) / m.barSec);
      return D.clamp(m.downbeat + b * m.barSec, 0, m.duration);
    },
    barOf(st, t) { const m = st.music; return m && m.barSec ? Math.round((t - m.downbeat) / m.barSec) : 0; },
    at(st, t) { const L = S.list(st); return L.findIndex((s) => t >= s.start && t < s.end); },
    /** Recalcula compassos, garante contiguidade e reconstrói a automação. */
    commit(st) {
      const L = S.list(st);
      L.sort((a, b) => a.start - b.start);
      for (let i = 0; i < L.length; i++) {
        if (i) L[i].start = L[i - 1].end;
        L[i].startBar = S.barOf(st, L[i].start); L[i].endBar = S.barOf(st, L[i].end);
        L[i].mutes = (L[i].mutes || []).filter((id) => st.stems.some((s) => s.id === id && !s.removed));
      }
      if (L.length) { L[0].start = 0; L[L.length - 1].end = st.music.duration; }
      if (st.mode !== 'master' && st.stems.some((s) => s.features)) {
        const stems = st.stems.filter((s) => !s.removed && s.role !== 'Reference Track' && s.features);
        if (stems.length) MM.buildAutomation(st, stems, null);
      }
      st.dirty.mix = true; st.dirty.master = true;
      st.sectionsEdited = true;
    },
    /** Move a fronteira entre a secção i−1 e a secção i. */
    moveBoundary(st, i, t, free) {
      const L = S.list(st);
      if (i <= 0 || i >= L.length) return false;
      if (!free) t = S.snap(st, t);
      const lo = L[i - 1].start + MIN_LEN, hi = L[i].end - MIN_LEN;
      t = D.clamp(t, lo, hi);
      L[i - 1].end = t; L[i].start = t;
      return true;
    },
    rename(st, i, name) { const L = S.list(st); if (L[i] && name) L[i].name = String(name).slice(0, 32); },
    /** Divide a secção que contém t (no compasso mais próximo, salvo free). */
    split(st, t, free) {
      const L = S.list(st), i = S.at(st, t);
      if (i < 0) return -1;
      const s = L[i];
      if (!free) t = S.snap(st, t);
      if (t - s.start < MIN_LEN || s.end - t < MIN_LEN) return -1;
      const b = Object.assign({}, s, { start: t, mutes: (s.mutes || []).slice() });
      s.end = t;
      L.splice(i + 1, 0, b);
      return i + 1;
    },
    /** Junta a secção i com a seguinte (fica o nome da primeira; mutes só se ambos os tinham). */
    mergeNext(st, i) {
      const L = S.list(st);
      if (i < 0 || i >= L.length - 1) return false;
      const a = L[i], b = L[i + 1];
      a.end = b.end;
      a.mutes = (a.mutes || []).filter((id) => (b.mutes || []).includes(id));
      if (a.energy !== undefined && b.energy !== undefined) a.energy = (a.energy + b.energy) / 2;
      L.splice(i + 1, 1);
      return true;
    },
    remove(st, i) {
      const L = S.list(st);
      if (L.length < 2 || i < 0 || i >= L.length) return false;
      if (i > 0) { L[i - 1].end = L[i].end; L.splice(i, 1); } else { L[1].start = 0; L.splice(0, 1); }
      return true;
    },
    isMuted(st, i, id) { const s = S.list(st)[i]; return !!(s && s.mutes && s.mutes.includes(id)); },
    toggleMute(st, i, id) {
      const s = S.list(st)[i];
      if (!s) return;
      s.mutes = s.mutes || [];
      const k = s.mutes.indexOf(id);
      if (k >= 0) s.mutes.splice(k, 1); else s.mutes.push(id);
    },
    /** Intervalos [a,b] em que o stem está calado por secção (secções contíguas fundidas). */
    muteRanges(st, id) {
      const out = [];
      S.list(st).forEach((s) => {
        if (!s.mutes || !s.mutes.includes(id)) return;
        const last = out[out.length - 1];
        if (last && Math.abs(last[1] - s.start) < 1e-6) last[1] = s.end; else out.push([s.start, s.end]);
      });
      return out;
    },
    anyMutes(st) { return S.list(st).some((s) => s.mutes && s.mutes.length); },
    /** Nome com numeração quando o mesmo nome se repete (Refrão 1, Refrão 2…). */
    label(st, i) {
      const L = S.list(st), s = L[i];
      if (!s) return '';
      if (/\d$/.test(s.name)) return s.name;
      const same = L.filter((x) => x.name === s.name);
      return same.length > 1 ? `${s.name} ${same.indexOf(s) + 1}` : s.name;
    },
  });
})();
