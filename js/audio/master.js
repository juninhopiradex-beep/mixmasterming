/* MixMind — Mastering Engine + sistema de referência
 * Análise do premaster → decisões por estilo/género/referência → render iterativo até ao alvo LUFS
 * com correção automática de true peak (o QC nunca deve falhar por TP).
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const fmt = (v, d = 1) => D.fmtNum(v, d);

  MM.defaultMaster = () => ({
    target: -9, ceiling: -1, ceilAdj: 0, style: 'Punchy', width: 108, inGain: 0, premasterLufs: -18,
    order: ['eq', 'dyn', 'mb', 'glue', 'sat', 'ms', 'clip', 'lim'],
    chain: {
      eq: { on: true, low: 0, mud: 0, pres: 0, air: 0, ref: [0, 0, 0, 0, 0, 0, 0] },
      dyn: { on: true, mud: 0, harsh: 0 },
      mb: { on: true, xLow: 120, xHigh: 2500, bands: [{ thr: -20, ratio: 2, atk: 30, rel: 160 }, { thr: -18, ratio: 1.5, atk: 20, rel: 120 }, { thr: -20, ratio: 1.5, atk: 8, rel: 80 }] },
      glue: { on: true, thr: -12, ratio: 2, atk: 30, rel: 200, gr: 1.2 },
      sat: { on: true, model: 'tape', drive: 0.12, mix: 0.5 },
      ms: { on: true, monoBelow: 120 },
      clip: { on: true, amount: 0.3 },
      lim: { on: true, lookahead: 4, release: 80 },
    },
    manual: {},
  });

  // estilos: glue (dB GR), saturação, largura, clipper, tilt (dB), alvo sugerido
  MM.MASTER_STYLES = {
    Transparent: { glue: 0.6, sat: 0, model: 'tape', width: 100, clip: 0, tilt: 0, mb: 0.6, order: 'std', desc: 'Correções mínimas, máxima fidelidade.' },
    Warm: { glue: 1.2, sat: 0.18, model: 'tube', width: 102, clip: 0.15, tilt: -0.8, mb: 1, order: 'satFirst', desc: 'Médios-graves cheios, agudos suaves, harmónicos pares.' },
    Punchy: { glue: 1.2, sat: 0.12, model: 'tape', width: 108, clip: 0.4, tilt: 0.2, mb: 1, atk: 30, order: 'std', desc: 'Ataque lento no glue para deixar passar os transientes do bombo.' },
    Wide: { glue: 1, sat: 0.08, model: 'transformer', width: 118, clip: 0.25, tilt: 0.4, mb: 1, order: 'std', desc: 'Lados abertos nos agudos, graves sempre em mono.' },
    Aggressive: { glue: 2.2, sat: 0.25, model: 'console', width: 106, clip: 0.7, tilt: 0.6, mb: 1.4, order: 'std', desc: 'Densidade e loudness, mais clipping controlado.' },
    Analog: { glue: 1.5, sat: 0.22, model: 'tape', width: 100, clip: 0.2, tilt: -0.5, mb: 1, order: 'satFirst', desc: 'Tape antes do glue, como numa cadeia analógica.' },
    Modern: { glue: 1.2, sat: 0.06, model: 'transformer', width: 110, clip: 0.45, tilt: 0.8, mb: 1.2, order: 'std', desc: 'Low-end firme, agudos abertos, limpo.' },
    Streaming: { glue: 0.9, sat: 0.08, model: 'tape', width: 105, clip: 0.15, tilt: 0.2, mb: 0.8, target: -14, order: 'std', desc: 'Otimizado para −14 LUFS: dinâmica preservada após normalização.' },
    Club: { glue: 1.6, sat: 0.12, model: 'console', width: 104, clip: 0.6, tilt: 0, mb: 1.3, target: -8, monoBelow: 150, order: 'std', desc: 'Graves mono até 150 Hz, loudness alto para sistemas de som.' },
    Radio: { glue: 1.8, sat: 0.1, model: 'tape', width: 100, clip: 0.3, tilt: 0.5, mb: 1.5, target: -10, order: 'std', desc: 'Densidade constante e presença vocal para processamento de rádio.' },
  };

  MM.PLATFORMS = [
    { id: 'spotify', name: 'Spotify', lufs: -14, tp: -1 },
    { id: 'apple', name: 'Apple Music', lufs: -16, tp: -1 },
    { id: 'youtube', name: 'YouTube', lufs: -14, tp: -1 },
    { id: 'tidal', name: 'Tidal', lufs: -14, tp: -1 },
    { id: 'club', name: 'Club', lufs: -8, tp: -0.5 },
    { id: 'radio', name: 'Rádio', lufs: -16, tp: -1, note: 'Menos limiter, mais dinâmica' },
    { id: 'cd', name: 'CD', lufs: null, tp: -0.3, bits: 16, note: '16-bit · dither' },
  ];

  /** Decisões de master a partir das métricas do premaster (e opcionalmente da referência). */
  MM.runMaster = function (state, pm, ref) {
    const M = state.master, ch = M.chain, man = M.manual || {};
    const st = MM.MASTER_STYLES[M.style] || MM.MASTER_STYLES.Punchy;
    const guard = MM.GUARD[state.settings.guard] || MM.GUARD.normal;
    const dir = state.direction;
    const n = (k) => (dir[k] - 50) / 50;
    const ex = [];
    const say = (module, text, conf) => ex.push({ module, text, conf: conf || 0.85 });
    // tonalidade vs curva-alvo (tilt por género + estilo)
    const genreTilt = { Kizomba: -0.3, 'Hip-Hop': -0.6, Trap: -0.6, EDM: 0.4, House: 0.2, Pop: 0.4, Rock: 0, Jazz: -0.4, Acoustic: -0.2 }[state.music.genre] || 0;
    const tilt = st.tilt + genreTilt + n('tone') * 0.8;
    // alvo relativo por banda (perfil médio de masters comerciais, dB relativo à energia total)
    const TARGET = [-9.5, -4.2, -7.6, -6.6, -12.4, -17.6, -24.5];
    const tgt = TARGET.map((v, i) => v + tilt * (i - 3) * 0.9);
    const dev = pm.bands7.map((v, i) => v - tgt[i]);
    if (!man.eq) {
      ch.eq.low = +D.clamp(-dev[0] * 0.35 - dev[1] * 0.2, -guard.eq * 0.6, guard.eq * 0.6).toFixed(1);
      ch.eq.mud = +D.clamp(-Math.max(0, dev[2]) * 0.3, -2, 0).toFixed(1);
      ch.eq.pres = +D.clamp(-dev[4] * 0.3, -1.5, 1.5).toFixed(1);
      ch.eq.air = +D.clamp(-dev[6] * 0.3 - dev[5] * 0.15 + (st.tilt > 0 ? 0.3 : 0), -guard.eq * 0.6, guard.eq * 0.6).toFixed(1);
      ch.eq.on = true;
      const parts = [];
      if (Math.abs(ch.eq.low) >= 0.3) parts.push(`${D.fmtDb(ch.eq.low)} dB @ 80 Hz`);
      if (Math.abs(ch.eq.air) >= 0.3) parts.push(`${D.fmtDb(ch.eq.air)} dB @ 9 kHz`);
      if (Math.abs(ch.eq.pres) >= 0.3) parts.push(`${D.fmtDb(ch.eq.pres)} dB @ 3 kHz`);
      say('EQ', parts.length ? `EQ tonal (${parts.join(' · ')}): alinha o balanço com a curva-alvo ${M.style} para ${state.music.genre}.` : 'Tonalidade já alinhada com a curva-alvo — EQ estática neutra.', 0.88);
    }
    if (!man.dyn) {
      ch.dyn.on = true;
      ch.dyn.mud = +(-D.clamp(0.8 + Math.max(0, dev[2]) * 0.5, 0.8, 3)).toFixed(1);
      ch.dyn.harsh = +(-D.clamp(0.6 + Math.max(0, dev[4]) * 0.5 + n('aggr') * -0.5, 0.5, 3)).toFixed(1);
      say('EQ dinâmico', `Lama @ 320 Hz (até ${D.fmtDb(ch.dyn.mud)} dB) e aspereza @ 3,2 kHz (até ${D.fmtDb(ch.dyn.harsh)} dB): só atuam quando a energia excede o alvo.`, 0.86);
    }
    if (!man.mb) {
      const lowCrest = pm.crest;
      ch.mb.on = st.mb > 0;
      ch.mb.xLow = st.monoBelow && st.monoBelow > 120 ? 140 : 120;
      ch.mb.bands = [
        { thr: 0, ratio: +(1.6 + 0.8 * st.mb).toFixed(1), atk: 30, rel: 160, rel0: 6 },
        { thr: 0, ratio: +(1.2 + 0.4 * st.mb).toFixed(1), atk: 20, rel: 120, rel0: 8 },
        { thr: 0, ratio: +(1.2 + 0.4 * st.mb).toFixed(1), atk: 8, rel: 80, rel0: 9 },
      ];
      say('Multibanda', `4 bandas reduzidas a 3 (cruzamentos ${ch.mb.xLow} Hz / 2,5 kHz): low-end controlado com ${fmt(ch.mb.bands[0].ratio)}:1, médios e agudos suaves${lowCrest > 16 ? ' — o premaster tem picos altos' : ''}.`, 0.84);
    }
    if (!man.glue) {
      ch.glue = { on: st.glue > 0, thr: 0, ratio: 2, atk: st.atk || 30, rel: 200, gr: +(st.glue + n('loud') * 0.5).toFixed(1) };
      if (ref && state.refInfluence > 0) {
        const plrDiff = pm.plr - ref.plr;
        ch.glue.gr = +D.clamp(ch.glue.gr + plrDiff * 0.15 * state.refInfluence, 0.3, 4).toFixed(1);
      }
      say('Glue', `Bus glue 2:1, ataque ${ch.glue.atk} ms, release auto: ~${fmt(ch.glue.gr)} dB GR.`, 0.86);
    }
    if (!man.sat) {
      ch.sat = { on: st.sat > 0, model: st.model, drive: +(st.sat * (0.7 + 0.6 * (dir.sat / 100))).toFixed(2), mix: 0.5 };
      if (ch.sat.on) say('Saturação', `${MM.SAT_NAMES[ch.sat.model]} (${Math.round(ch.sat.drive * 100)} %): harmónicos ${ch.sat.model === 'tube' ? 'pares' : 'de fita'} com oversampling 4×.`, 0.8);
    }
    if (!man.ms) {
      ch.ms = { on: true, monoBelow: st.monoBelow || 120 };
      let w = st.width + n('width') * 6;
      if (ref && state.refInfluence > 0) w += (ref.width - pm.width) * 40 * state.refInfluence;
      if (pm.corrMin < 0.3) w = Math.min(w, 102);
      M.width = Math.round(D.clamp(w, 80, 135));
      say('M/S', `Largura ${M.width} % com graves em mono abaixo de ${ch.ms.monoBelow} Hz${pm.corrMin < 0.3 ? ' (limitada: correlação mínima baixa no premaster)' : ''}.`, 0.84);
    }
    if (!man.clip) {
      ch.clip = { on: st.clip > 0, amount: +(st.clip + Math.max(0, n('loud')) * 0.2).toFixed(2) };
      if (ch.clip.on) say('Clipper', `Soft clipper apara os picos do bombo antes do limiter (~${fmt(ch.clip.amount * 1.5)} dB): o limiter trabalha menos e o punch mantém-se.`, 0.82);
    }
    if (!man.order) M.order = st.order === 'satFirst' ? ['eq', 'dyn', 'mb', 'sat', 'glue', 'ms', 'clip', 'lim'] : ['eq', 'dyn', 'mb', 'glue', 'sat', 'ms', 'clip', 'lim'];
    // referência → EQ por banda e alvo
    if (ref && state.refInfluence > 0 && state.refApply.master) {
      const diff = pm.bands7.map((v, i) => v - ref.bands7[i]);
      ch.eq.ref = diff.map((d) => +D.clamp(-d * 0.7 * state.refInfluence, -3, 3).toFixed(1));
      const tgtRef = D.lerp(st.target || state.master.targetBase || M.target, ref.lufs, state.refInfluence);
      if (!man.target) M.target = +tgtRef.toFixed(1);
      say('Referência', `Influência ${Math.round(state.refInfluence * 100)} %: EQ por banda aproxima a tonalidade da referência; alvo ${fmt(M.target)} LUFS. A IA respeita o teu ceiling de ${fmt(M.ceiling)} dBTP.`, 0.83);
    } else ch.eq.ref = [0, 0, 0, 0, 0, 0, 0];
    say('Limiter', `Limiter true-peak com look-ahead de ${ch.lim.lookahead} ms e ceiling ${fmt(M.ceiling)} dBTP; ganho de entrada calculado iterativamente até ao alvo de ${fmt(M.target)} LUFS.`, 0.95);
    state.masterExplain = ex;
    return ex;
  };

  /** Ajusta limiares dos compressores do master ao nível que efetivamente lhes chega. */
  /** Os módulos antes do drive recebem o premaster ao nível original (Lp ≈ −18 LUFS). */
  function setThresholds(M, Lp) {
    const ch = M.chain;
    ch.glue.thr = +(Lp + 9 - ch.glue.gr / (1 - 1 / ch.glue.ratio)).toFixed(1);
    // limiares por banda: graves concentram mais energia que médios/agudos
    ch.mb.bands.forEach((b, i) => { b.thr = +(Lp + [5, 2, -2][i] - (b.ratio - 1) * 1.5).toFixed(1); });
  }
  MM.setMasterThresholds = setThresholds;

  /**
   * Renderiza o master a partir do premaster, iterando o ganho de entrada até ao alvo.
   * @returns {buffer, metrics, iterations}
   */
  MM.masterize = async function (state, premaster, o) {
    o = o || {};
    const M = state.master;
    const target = o.target !== undefined ? o.target : M.target;
    const ceiling = o.ceiling !== undefined ? o.ceiling : M.ceiling;
    const pmL = o.premasterLufs !== undefined ? o.premasterLufs : M.premasterLufs;
    const saved = { target: M.target, ceiling: M.ceiling, inGain: M.inGain, ceilAdj: M.ceilAdj };
    M.target = target; M.ceiling = ceiling;
    let gain = o.reuseGain && Math.abs(saved.target - target) < 0.01 ? M.inGain : target - pmL + 1;
    M.ceilAdj = o.reuseGain ? M.ceilAdj || 0 : 0;
    let buf, met, it = 0, prev = null;
    const quick = (b) => { const chs = D.channelsOf(b); return { lufs: D.loudness(chs, b.sampleRate).integrated, tp: D.lin2db(D.truePeak(chs)) }; };
    const pchs = D.channelsOf(premaster), psr = premaster.sampleRate;
    const full = D.loudness(pchs, psr);
    // 1) procurar o ganho num excerto (os 30 s mais fortes) — rápido
    const exLen = 30;
    if (premaster.duration > exLen * 1.6 && !o.reuseGain) {
      const st = full.short; // por segundo
      let best = 0, bi = 0;
      for (let i = 0; i + exLen <= st.length; i++) { let s2 = 0; for (let k = i; k < i + exLen; k++) s2 += Math.pow(10, st[k] / 10); if (s2 > best) { best = s2; bi = i; } }
      const a0 = Math.round(bi * psr), a1 = Math.min(pchs[0].length, a0 + exLen * psr);
      const ex = MM.toAudioBuffer(pchs.map((c) => c.slice(a0, a1)), psr);
      const exPre = D.loudness(D.channelsOf(ex), psr).integrated;
      const exTarget = target + (exPre - full.integrated);
      for (let k = 0; k < 5; k++) {
        M.inGain = +gain.toFixed(2);
        setThresholds(M, pmL);
        const b = await MM.render(state, { premaster: ex, sr: psr, tail: 0, onProgress: o.onProgress ? (p) => o.onProgress(Math.min(0.5, (k + p) / 8)) : null });
        const q = quick(b);
        const err = exTarget - q.lufs, tpOver = q.tp - ceiling;
        if (Math.abs(err) < 0.1 && tpOver <= 0.02) break;
        const adjChanged = tpOver > 0.02;
        if (adjChanged) M.ceilAdj = +((M.ceilAdj || 0) - tpOver - 0.05).toFixed(2);
        let slope = Math.abs(err) > 3 ? 0.9 : 0.75;
        if (prev && !prev.adjChanged && Math.abs(gain - prev.gain) > 0.05) slope = D.clamp((q.lufs - prev.lufs) / (gain - prev.gain), 0.4, 1.2);
        prev = { gain, lufs: q.lufs, adjChanged };
        gain += err / slope;
      }
      prev = null;
    }
    // 2) render completo + correção fina
    const maxIt = premaster.duration < 120 ? 6 : 4;
    for (; it < maxIt; it++) {
      M.inGain = +gain.toFixed(2);
      setThresholds(M, pmL);
      buf = await MM.render(state, { premaster, sr: o.sr || premaster.sampleRate, tail: 0, onProgress: o.onProgress ? (p) => o.onProgress(Math.min(0.97, 0.5 + (it + p) / maxIt)) : null });
      const q = quick(buf);
      const err = target - q.lufs, tpOver = q.tp - ceiling;
      if (Math.abs(err) < 0.15 && tpOver <= 0.02) break;
      const adjChanged = tpOver > 0.02;
      if (adjChanged) M.ceilAdj = +((M.ceilAdj || 0) - tpOver - 0.05).toFixed(2);
      let slope = 0.8;
      // a secante só é válida se o ceiling não mudou entre as duas medições
      if (prev && !prev.adjChanged && Math.abs(gain - prev.gain) > 0.05) slope = D.clamp((q.lufs - prev.lufs) / (gain - prev.gain), 0.4, 1.2);
      prev = { gain, lufs: q.lufs, adjChanged };
      gain += err / slope;
    }
    met = await MM.measure(buf, { sections: state.music && state.music.sections });
    const res = { buffer: buf, metrics: met, iterations: it + 1, inGain: M.inGain, ceilAdj: M.ceilAdj };
    if (o.temporary) Object.assign(M, saved);
    return res;
  };

  /** Analisa uma faixa de referência. */
  MM.analyzeReference = async function (buf, name) {
    const met = await MM.measure(buf);
    return { name, lufs: met.lufs, lra: met.lra, plr: met.plr, width: met.width, corr: met.corr, bands7: met.bands7, tp: met.tp, crest: met.crest, spectrum: met.spectrum, duration: buf.duration, monoLow: met.monoLow };
  };

  /** Diferenças mix vs referência, por banda, para a vista Referências. */
  MM.referenceDiff = function (mixM, ref) {
    const diff = mixM.bands7.map((v, i) => v - ref.bands7[i]);
    const notes = diff.map((d, i) => {
      const b = D.BANDS7[i];
      if (Math.abs(d) < 0.8) return 'Perto da referência';
      if (i === 0) return d > 0 ? `Tens sub a mais; a IA corta ${fmt(Math.min(3, d * 0.6))} dB` : 'Menos sub que a referência';
      if (i === 2 && d > 0) return 'Lama; Dynamic EQ ativo @ 320 Hz';
      if (i === 4 && d < 0) return `Falta mordida na voz; +${fmt(Math.min(2, -d * 0.7))} dB proposto`;
      if (i === 5 && d < 0) return `Mais escuro; shelf +${fmt(Math.min(2, -d * 0.4))} dB`;
      if (i === 6 && d < 0) return 'Falta ar; shelf de 10 kHz';
      return d > 0 ? `${b.name} acima da referência` : `${b.name} abaixo da referência`;
    });
    const learned = [];
    const big = diff.map((d, i) => [d, i]).filter(([d]) => Math.abs(d) > 1).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 3);
    if (big.length) learned.push(['Tom', 'Em relação à tua mix, a referência tem ' + big.map(([d, i]) => `${d > 0 ? 'menos' : 'mais'} ${D.BANDS7[i].name.toLowerCase()} (${D.fmtDb(-d)} dB)`).join(', ') + '.']);
    else learned.push(['Tom', 'Tonalidade muito próxima da tua mix (todas as bandas a menos de 1 dB).']);
    learned.push(['Loudness', `Alvo de ${fmt(ref.lufs)} LUFS; a IA limita-se ao teu ceiling.`]);
    learned.push(['Dinâmica', ref.plr < mixM.plr - 0.5 ? `Mais comprimida (PLR ${fmt(ref.plr)} vs ${fmt(mixM.plr)} dB): compressão de bus mais firme.` : `Mais dinâmica (PLR ${fmt(ref.plr)} dB): menos limiting.`]);
    learned.push(['Estéreo', `Graves em mono ${Math.round(ref.monoLow)} %, largura ${Math.round(ref.width * 100 + 70)} %.`]);
    return { diff, notes, learned };
  };
  MM.widthPct = (w) => Math.round(70 + w * 100); // escala visual (0.42 → 112 %)
})();
