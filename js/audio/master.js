/* MIXMIND — Mastering Engine + sistema de referência
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
      lim: { on: true, lookahead: 4, release: 60, releaseSlow: 200, susTime: 1.5 },
    },
    manual: {},
  });

  // estilos: glue (dB GR), saturação, largura, clipper, tilt (dB), alvo sugerido
  // energia relativa por banda (7 bandas, dB vs total) de um master comercial médio — usada quando não há perfil aprendido
  MM.MASTER_TARGET_BANDS = [-9.5, -4.2, -7.6, -6.6, -12.4, -17.6, -24.5];
  MM.MASTER_STYLES = {
    Transparent: { glue: 0.6, sat: 0, model: 'tape', width: 100, clip: 0, tilt: 0, mb: 0.6, maxPush: 4, order: 'std', desc: 'Correções mínimas, máxima fidelidade.' },
    Warm: { glue: 1.2, sat: 0.18, model: 'tube', width: 102, clip: 0.15, tilt: -0.8, mb: 1, order: 'satFirst', desc: 'Médios-graves cheios, agudos suaves, harmónicos pares.' },
    Punchy: { glue: 1.2, sat: 0.12, model: 'tape', width: 108, clip: 0.4, tilt: 0.2, mb: 1, atk: 30, order: 'std', desc: 'Ataque lento no glue para deixar passar os transientes do bombo.' },
    Wide: { glue: 1, sat: 0.08, model: 'transformer', width: 118, clip: 0.25, tilt: 0.4, mb: 1, order: 'std', desc: 'Lados abertos nos agudos, graves sempre em mono.' },
    Aggressive: { glue: 2.2, sat: 0.25, model: 'console', width: 106, clip: 0.7, tilt: 0.6, mb: 1.4, maxPush: 10, order: 'std', desc: 'Densidade e loudness, mais clipping controlado.' },
    Analog: { glue: 1.5, sat: 0.22, model: 'tape', width: 100, clip: 0.2, tilt: -0.5, mb: 1, order: 'satFirst', desc: 'Tape antes do glue, como numa cadeia analógica.' },
    Modern: { glue: 1.2, sat: 0.06, model: 'transformer', width: 110, clip: 0.45, tilt: 0.8, mb: 1.2, order: 'std', desc: 'Low-end firme, agudos abertos, limpo.' },
    Streaming: { glue: 0.9, sat: 0.08, model: 'tape', width: 105, clip: 0.15, tilt: 0.2, mb: 0.8, maxPush: 5, target: -14, order: 'std', desc: 'Otimizado para −14 LUFS: dinâmica preservada após normalização.' },
    Club: { glue: 1.6, sat: 0.12, model: 'console', width: 104, clip: 0.6, tilt: 0, mb: 1.3, maxPush: 9, target: -8, monoBelow: 150, order: 'std', desc: 'Graves mono até 150 Hz, loudness alto para sistemas de som.' },
    Radio: { glue: 1.8, sat: 0.1, model: 'tape', width: 100, clip: 0.3, tilt: 0.5, mb: 1.5, target: -10, order: 'std', desc: 'Densidade constante e presença vocal para processamento de rádio.' },
  };

  MM.PLATFORMS = [
    { id: 'spotify', name: 'Spotify', lufs: -14, tp: -1 },
    { id: 'apple', name: 'Apple Music', lufs: -16, tp: -1 },
    { id: 'youtube', name: 'YouTube', lufs: -14, tp: -1 },
    { id: 'tidal', name: 'Tidal', lufs: -14, tp: -1 },
    { id: 'club', name: 'Club', lufs: -8, tp: -0.5 },
    { id: 'radio', name: 'Rádio', lufs: -16, tp: -1, note: 'Menos limiter, mais dinâmica' },
    // radiodifusão: normas de loudness para TV e rádio (o nome entra no nome do ficheiro — sem barras)
    { id: 'ebu', name: 'Broadcast EBU', lufs: -23, tp: -1, note: 'EBU R128 · TV e rádio na Europa' },
    { id: 'atsc', name: 'Broadcast ATSC', lufs: -24, tp: -2, note: 'ATSC A/85 · TV nos EUA' },
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
    const TARGET = MM.MASTER_TARGET_BANDS;
    let tgt = TARGET.map((v, i) => v + tilt * (i - 3) * 0.9);
    // perfil aprendido do estilo: a curva-alvo passa a ser a média dos masters aprovados
    const prof = MM.styles && MM.styles.profile ? MM.styles.profile(state.music.genre) : null;
    if (prof && prof.bands7) {
      const w = prof.conf;
      tgt = tgt.map((v, i) => D.lerp(v, prof.bands7[i] + (st.tilt + n('tone') * 0.8 - (MM.MASTER_STYLES.Punchy.tilt)) * (i - 3) * 0.5, w));
    }
    const dev = pm.bands7.map((v, i) => v - tgt[i]);
    // material que já chega masterizado (alto, pouco dinâmico ou com overs): intervenção mínima
    const hot = pm.lufs > -13 && (pm.tp > -0.3 || pm.plr < 9.5);
    const kE = hot ? 0.35 : 1, kD = hot ? 0.45 : 1;
    M.hotInput = hot;
    if (hot) say('Entrada', `A mix já chega masterizada (${fmt(pm.lufs)} LUFS, true peak ${D.fmtDb(pm.tp)} dBTP, PLR ${fmt(pm.plr)} dB). Intervenção mínima: EQ a ${Math.round(kE * 100)} %, compressão e saturação a metade${pm.tp > 0 ? '; o original já tem overs/clipping inter-amostra, que o limiter corrige' : ''}.`, 0.9);
    if (!man.eq) {
      ch.eq.low = +(D.clamp(-dev[0] * 0.35 - dev[1] * 0.2, -guard.eq * 0.6, guard.eq * 0.6) * kE).toFixed(1);
      ch.eq.mud = +(D.clamp(-Math.max(0, dev[2]) * 0.3, -2, 0) * kE).toFixed(1);
      ch.eq.pres = +(D.clamp(-dev[4] * 0.3, -1.5, 1.5) * kE).toFixed(1);
      ch.eq.air = +(D.clamp(-dev[6] * 0.3 - dev[5] * 0.15 + (st.tilt > 0 ? 0.3 : 0), -guard.eq * 0.6, guard.eq * 0.6) * kE).toFixed(1);
      ch.eq.on = true;
      const parts = [];
      if (Math.abs(ch.eq.low) >= 0.3) parts.push(`${D.fmtDb(ch.eq.low)} dB @ 80 Hz`);
      if (Math.abs(ch.eq.air) >= 0.3) parts.push(`${D.fmtDb(ch.eq.air)} dB @ 9 kHz`);
      if (Math.abs(ch.eq.pres) >= 0.3) parts.push(`${D.fmtDb(ch.eq.pres)} dB @ 3 kHz`);
      const tsrc = prof && prof.bands7 ? `a curva aprendida de ${state.music.genre} (${prof.n} ${prof.n === 1 ? 'música' : 'músicas'})` : `a curva-alvo ${M.style} para ${state.music.genre}`;
      say('EQ', parts.length ? `EQ tonal (${parts.join(' · ')}): alinha o balanço com ${tsrc}.` : `Tonalidade já alinhada com ${tsrc} — EQ estática neutra.`, prof ? 0.9 : 0.88);
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
        { thr: 0, ratio: +(1.6 + 0.8 * st.mb).toFixed(1), atk: 30, rel: 160, gr: +(1.2 * st.mb * kD).toFixed(1) },
        { thr: 0, ratio: +(1.2 + 0.4 * st.mb).toFixed(1), atk: 20, rel: 120, gr: +(0.6 * st.mb * kD).toFixed(1) },
        { thr: 0, ratio: +(1.2 + 0.4 * st.mb).toFixed(1), atk: 8, rel: 80, gr: +(0.8 * st.mb * kD).toFixed(1) },
      ];
      say('Multibanda', `4 bandas reduzidas a 3 (cruzamentos ${ch.mb.xLow} Hz / 2,5 kHz): low-end controlado com ${fmt(ch.mb.bands[0].ratio)}:1, médios e agudos suaves${lowCrest > 16 ? ' — o premaster tem picos altos' : ''}.`, 0.84);
    }
    if (!man.glue) {
      ch.glue = { on: st.glue > 0, thr: 0, ratio: 2, atk: st.atk || 30, rel: 200, gr: +(D.clamp(st.glue + n('loud') * 0.5, 0.3, 4) * kD).toFixed(1) };
      if (ref && state.refInfluence > 0) {
        const plrDiff = pm.plr - ref.plr;
        ch.glue.gr = +D.clamp(ch.glue.gr + plrDiff * 0.15 * state.refInfluence, 0.3, 4).toFixed(1);
      }
      say('Glue', `Bus glue 2:1, ataque ${ch.glue.atk} ms, release auto: ~${fmt(ch.glue.gr)} dB GR.`, 0.86);
    }
    if (!man.sat) {
      ch.sat = { on: st.sat > 0, model: st.model, drive: +(st.sat * (0.7 + 0.6 * (dir.sat / 100)) * kD).toFixed(2), mix: hot ? 0.35 : 0.5 };
      const HARM = { tube: 'pares (tube)', tape: 'de fita, suaves', transformer: 'de transformador', console: 'ímpares de consola', soft: 'de soft clip', exciter: 'de exciter nos agudos' };
      if (ch.sat.on) say('Saturação', `${MM.SAT_NAMES[ch.sat.model]} (${Math.round(ch.sat.drive * 100)} %, mistura ${Math.round(ch.sat.mix * 100)} %): harmónicos ${HARM[ch.sat.model] || ''}, oversampling 2× com sinal limpo alinhado (sem filtro em pente).`, 0.8);
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
      ch.clip = { on: st.clip > 0, amount: +((st.clip + Math.max(0, n('loud')) * 0.2) * (hot ? 0.6 : 1)).toFixed(2) };
      if (ch.clip.on) say('Clipper', `Soft clipper apara os picos do bombo antes do limiter (~${fmt(ch.clip.amount * 1.5)} dB): o limiter trabalha menos e o punch mantém-se.`, 0.82);
    }
    if (prof && prof.stat) {
      const w = prof.conf, ps = prof.stat;
      if (ps.plr && !man.clip) { ch.clip.amount = +D.clamp(ch.clip.amount + D.clamp((8 - ps.plr.med) * 0.08, -0.25, 0.3) * w, 0, 0.9).toFixed(2); ch.clip.on = ch.clip.amount > 0.02; }
      if (ps.plr && !man.glue) ch.glue.gr = +D.clamp(ch.glue.gr + D.clamp((9 - ps.plr.med) * 0.15, -0.5, 0.8) * w, 0.3, 4).toFixed(1);
      if (ps.width && !man.ms && pm.width > 0.02) M.width = Math.round(D.clamp(D.lerp(M.width, 100 * ps.width.med / pm.width, w * 0.7), 85, 135));
      if (ps.wLow && !man.ms) ch.ms.monoBelow = ps.wLow.med < 0.05 ? 140 : ps.wLow.med < 0.12 ? 120 : 100;
      if (ps.lufs && !man.target && !(ref && state.refInfluence > 0 && state.refApply.master)) M.target = +(Math.round(D.lerp(M.target, ps.lufs.med, w) * 2) / 2).toFixed(1);
      say('Estilo aprendido', `${state.music.genre}: ${prof.nMasters} master(s) de referência na biblioteca — alvo ${fmt(M.target)} LUFS (mediana ${ps.lufs ? fmt(ps.lufs.med) : '—'}), PLR típico ${ps.plr ? fmt(ps.plr.med) : '—'} dB, largura ${M.width} %, graves mono < ${ch.ms.monoBelow} Hz. Confiança ${Math.round(w * 100)} %.`, 0.8 + 0.15 * w);
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

  /**
   * Renderiza o master a partir do premaster, iterando o ganho de entrada até ao alvo.
   * @returns {buffer, metrics, iterations}
   */
  // ---------- calibração da dinâmica a partir do próprio áudio ----------
  // Simula exatamente o detetor do compressor (picos em sub-blocos de 8 amostras + balística ataque/release)
  // e procura o threshold que produz a redução média pedida nas partes ativas da música.
  function blockLevels(chs, filt) {
    const n = chs[0].length, nb = Math.floor(n / 8), out = new Float32Array(nb);
    const sig = filt ? chs.map((c) => filt.reduce((x, co) => D.filter(x, co), c)) : chs;
    for (let b = 0; b < nb; b++) {
      let pk = 0;
      for (const c of sig) for (let i = b * 8; i < b * 8 + 8; i++) { const v = c[i] < 0 ? -c[i] : c[i]; if (v > pk) pk = v; }
      out[b] = pk > 1e-9 ? 20 * Math.log10(pk) : -180;
    }
    return out;
  }
  function simGR(lv, sr, c, thr, active) {
    const aA = Math.exp(-8 / (c.atk * 0.001 * sr)), aR = Math.exp(-8 / (c.rel * 0.001 * sr));
    const slope = 1 - 1 / c.ratio, knee = Math.max(0.01, c.knee || 6);
    let env = 0, sum = 0, cnt = 0;
    for (let b = 0; b < lv.length; b++) {
      const over = lv[b] - thr;
      const gr = over <= -knee / 2 ? 0 : over >= knee / 2 ? over * slope : (slope * (over + knee / 2) ** 2) / (2 * knee);
      env = gr > env ? aA * env + (1 - aA) * gr : aR * env + (1 - aR) * gr;
      if (lv[b] > active) { sum += env; cnt++; }
    }
    return cnt ? sum / cnt : 0;
  }
  function calibThr(lv, sr, c, target) {
    const act = Array.from(lv.filter((v) => v > -70));
    if (!act.length || !(target > 0.05)) return 0;
    const active = D.percentile(act, 0.5), top = D.percentile(act, 0.995);
    let lo = top - 45, hi = top + 3;
    for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (simGR(lv, sr, c, mid, active) > target) lo = mid; else hi = mid; }
    return +((lo + hi) / 2).toFixed(1);
  }
  const calibCache = new WeakMap();
  MM.calibrateDynamics = function (state, premaster) {
    const M = state.master, ch = M.chain, sr = premaster.sampleRate;
    let cache = calibCache.get(premaster);
    if (!cache) {
      // excerto: os 60 s mais fortes (ou a música toda se for mais curta)
      const chs = D.channelsOf(premaster), st = D.loudness(chs, sr).short, len = Math.min(60, st.length);
      let best = -1, bi = 0;
      for (let i = 0; i + len <= st.length; i++) { let s2 = 0; for (let k = i; k < i + len; k++) s2 += Math.pow(10, st[k] / 10); if (s2 > best) { best = s2; bi = i; } }
      const ex = chs.map((c) => c.subarray(Math.round(bi * sr), Math.min(c.length, Math.round((bi + len) * sr))));
      cache = { ex, full: blockLevels(ex), bands: {} };
      calibCache.set(premaster, cache);
    }
    if (ch.glue.on) ch.glue.thr = calibThr(cache.full, sr, ch.glue, ch.glue.gr);
    if (ch.mb.on) {
      const lr = (t, f) => [D.biquad(t, f, 0.7071, 0, sr), D.biquad(t, f, 0.7071, 0, sr)];
      const key = ch.mb.xLow + ':' + ch.mb.xHigh;
      if (!cache.bands[key]) cache.bands[key] = [
        blockLevels(cache.ex, lr('lowpass', ch.mb.xLow)),
        blockLevels(cache.ex, lr('highpass', ch.mb.xLow).concat(lr('lowpass', ch.mb.xHigh))),
        blockLevels(cache.ex, lr('highpass', ch.mb.xLow).concat(lr('highpass', ch.mb.xHigh))),
      ];
      ch.mb.bands.forEach((b, i) => { b.thr = b.gr > 0.05 ? calibThr(cache.bands[key][i], sr, b, b.gr) : 0; });
    }
  };

  /**
   * Renderiza o master a partir do premaster, iterando o ganho de entrada até ao alvo.
   * Para quando o loudness deixa de responder ao ganho (limite físico do material/estilo) em vez de esmagar o som.
   * @returns {buffer, metrics, iterations, reached, maxLufs}
   */
  MM.masterize = async function (state, premaster, o) {
    o = o || {};
    const M = state.master;
    const target = o.target !== undefined ? o.target : M.target;
    const ceiling = o.ceiling !== undefined ? o.ceiling : M.ceiling;
    const pmL = o.premasterLufs !== undefined ? o.premasterLufs : M.premasterLufs;
    const saved = { target: M.target, ceiling: M.ceiling, inGain: M.inGain, ceilAdj: M.ceilAdj };
    M.target = target; M.ceiling = ceiling;
    MM.calibrateDynamics(state, premaster);
    const st = MM.MASTER_STYLES[M.style] || MM.MASTER_STYLES.Punchy;
    const maxGain = target - pmL + (st.maxPush || 7); // nunca mais do que isto acima do ganho "linear"
    let gain = o.reuseGain && Math.abs(saved.target - target) < 0.01 ? M.inGain : target - pmL + 1;
    M.ceilAdj = o.reuseGain ? M.ceilAdj || 0 : 0;
    let buf, met, it = 0, prev = null, capped = false;
    const quick = (b) => { const chs = D.channelsOf(b); return { lufs: D.loudness(chs, b.sampleRate).integrated, tp: D.lin2db(D.truePeak(chs)) }; };
    const pchs = D.channelsOf(premaster), psr = premaster.sampleRate;
    const full = D.loudness(pchs, psr);
    const step = (q, err, tpOver) => {
      const adjChanged = tpOver > 0.02;
      if (adjChanged) M.ceilAdj = +((M.ceilAdj || 0) - tpOver - 0.05).toFixed(2);
      let slope = Math.abs(err) > 3 ? 0.9 : 0.75;
      if (prev && !prev.adjChanged && Math.abs(gain - prev.gain) > 0.05) slope = (q.lufs - prev.lufs) / (gain - prev.gain);
      // rendimento decrescente: +1 dB de ganho já quase não sobe o loudness → parar
      if (prev && !prev.adjChanged && err > 0 && slope < 0.22) { capped = true; return false; }
      slope = D.clamp(slope, 0.3, 1.2);
      prev = { gain, lufs: q.lufs, adjChanged };
      gain = Math.min(maxGain, gain + err / slope);
      if (gain >= maxGain - 0.01 && prev.gain >= maxGain - 0.01) { capped = true; return false; }
      return true;
    };
    // 1) procurar o ganho num excerto (os 30 s mais fortes) — rápido
    const exLen = 30;
    if (premaster.duration > exLen * 1.6 && !o.reuseGain) {
      const stS = full.short;
      let best = 0, bi = 0;
      for (let i = 0; i + exLen <= stS.length; i++) { let s2 = 0; for (let k = i; k < i + exLen; k++) s2 += Math.pow(10, stS[k] / 10); if (s2 > best) { best = s2; bi = i; } }
      const a0 = Math.round(bi * psr), a1 = Math.min(pchs[0].length, a0 + exLen * psr);
      const ex = MM.toAudioBuffer(pchs.map((c) => c.slice(a0, a1)), psr);
      const exPre = D.loudness(D.channelsOf(ex), psr).integrated;
      const exTarget = target + (exPre - full.integrated);
      for (let k = 0; k < 6; k++) {
        M.inGain = +gain.toFixed(2);
        const b = await MM.render(state, { premaster: ex, sr: psr, tail: 0, noFade: true, timeOffset: a0 / psr, onProgress: o.onProgress ? (p) => o.onProgress(Math.min(0.5, (k + p) / 8)) : null });
        const q = quick(b);
        const err = exTarget - q.lufs, tpOver = q.tp - ceiling;
        if (Math.abs(err) < 0.1 && tpOver <= 0.02) break;
        if (!step(q, err, tpOver)) { gain = prev ? prev.gain : gain; break; }
      }
      prev = null;
    }
    // 2) render completo + correção fina
    const maxIt = premaster.duration < 120 ? 6 : 4;
    let lastQ = null;
    for (; it < maxIt; it++) {
      M.inGain = +gain.toFixed(2);
      buf = await MM.render(state, { premaster, sr: o.sr || premaster.sampleRate, tail: 0, noFade: true, onProgress: o.onProgress ? (p) => o.onProgress(Math.min(0.97, 0.5 + (it + p) / maxIt)) : null });
      const q = quick(buf);
      lastQ = q;
      const err = target - q.lufs, tpOver = q.tp - ceiling;
      if (Math.abs(err) < 0.15 && tpOver <= 0.02) break;
      if (capped && tpOver <= 0.02) break;
      if (!step(q, err, tpOver)) { if (tpOver <= 0.02) break; }
    }
    // o fade do master (se houver) entra depois de acertar o loudness: não empurra o ganho para compensar
    MM.applyMasterFade(state, buf, 0);
    met = await MM.measure(buf, { sections: state.music && state.music.sections });
    const reached = Math.abs(met.lufs - target) <= 0.3;
    M.reached = reached; M.achieved = +met.lufs.toFixed(1);
    const res = { buffer: buf, metrics: met, iterations: it + 1, inGain: M.inGain, ceilAdj: M.ceilAdj, reached };
    if (o.temporary) Object.assign(M, saved);
    void lastQ;
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
