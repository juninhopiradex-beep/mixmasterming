/* MIXMIND — cache por stem ("freeze" automático) para os renders offline.
 * No primeiro render completo da pré-master, a saída de cada stem pesado (até ao fader, antes do pan) é gravada
 * em canais extra do mesmo render — sem custo de um passe a mais. Nos renders seguintes, os stems cuja
 * assinatura não mudou (parâmetros, automação, mutes por secção, fontes de sidechain) entram já processados:
 * os compressores/saturação/EQ dinâmico desses stems não voltam a correr. Mexer num stem só re-renderiza esse.
 * Orçamento de memória: ~64 MB por GB de RAM do dispositivo (256–768 MB), LRU. */
(function () {
  const MM = (window.MM = window.MM || {});
  const C = (MM.stemCache = { entries: new Map(), hits: 0, misses: 0, last: null });
  const WORKLET = { comp: 3, comp2: 3, sat: 4, trans: 2, deess: 2, dyn0: 3, dyn1: 3, duck: 0.5 };
  C.budget = () => {
    const gb = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 4;
    return Math.round(Math.min(768, Math.max(256, gb * 64))) * 1024 * 1024;
  };
  C.enabled = () => !MM.STEM_CACHE_OFF;
  C.bytes = () => { let b = 0; C.entries.forEach((e) => (b += e.bytes)); return b; };
  C.clear = () => { C.entries.clear(); C.last = null; };
  const sigOf = (st, s, sr) => MM.insight.stemSig(st, s, { noMute: true }) + ':' + sr;
  const costOf = (st, s) => MM.Graph.prototype.stemKeys.call({ state: st, hasLane: MM.Graph.prototype.hasLane }, s).reduce((a, k) => a + (WORKLET[k] || 0.15), 0);

  /** Decide o que reutilizar (frozen) e o que gravar (capture) num render completo. */
  C.plan = function (st, sr, need, capture) {
    const frozen = {}, cap = [];
    C.prune(st);
    const stems = st.stems.filter((s) => !s.removed && s.role !== 'Reference Track');
    const now = Date.now();
    stems.forEach((s) => {
      const e = C.entries.get(s.id);
      if (e && e.sig === sigOf(st, s, sr) && e.len >= need) { frozen[s.id] = e; e.used = now; }
    });
    if (capture) {
      let room = 30, free = C.budget();
      C.entries.forEach((e, id) => { if (frozen[id]) free -= e.bytes; });
      stems.filter((s) => !frozen[s.id]).map((s) => ({ s, cost: costOf(st, s), ch: Math.min(2, s.chs.length) }))
        .filter((x) => x.cost >= 2).sort((a, b) => b.cost - a.cost)
        .forEach((x) => { const bytes = x.ch * need * 4; if (x.ch <= room && bytes <= free) { cap.push(x); room -= x.ch; free -= bytes; } });
    }
    return { frozen, capture: cap };
  };
  /** Guarda as saídas gravadas e aplica o orçamento (LRU, nunca expulsa o que acabou de entrar). */
  C.store = function (st, g, buf, cap, sr) {
    let ch = 2;
    const now = Date.now();
    cap.forEach((x) => {
      const n = g.stems[x.s.id];
      const chs = []; for (let c = 0; c < x.ch; c++) chs.push(buf.getChannelData(ch + c));
      ch += x.ch;
      const b = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: sr });
      chs.forEach((d, c) => b.copyToChannel(d, c));
      C.entries.set(x.s.id, { sig: sigOf(st, x.s, sr), len: b.length, buffer: b, lat: n ? n.lat || 0 : 0, mx: g.stemLatency || 0, bytes: b.length * b.numberOfChannels * 4, used: now, cost: x.cost });
    });
    const budget = C.budget();
    const order = [...C.entries.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [id, e] of order) { if (C.bytes() <= budget) break; if (e.used !== now) C.entries.delete(id); }
  };
  /** Esquece os stems que já não existem / foram removidos. */
  C.prune = function (st) { const ids = new Set(st.stems.filter((s) => !s.removed).map((s) => s.id)); [...C.entries.keys()].forEach((id) => { if (!ids.has(id)) C.entries.delete(id); }); };
})();
