/* MIXMIND — motor de decisões de mistura ("AI proposes. Engineer decides.")
 * Segue a ordem de um engenheiro: ouvir → compreender → protagonistas → gain staging → balanço →
 * resolver problemas → espaço → dinâmica → profundidade → movimento (automação) → mix bus.
 * Todas as decisões são explicáveis, têm confiança e respeitam stems bloqueados e edições manuais.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const fmt = (v, d = 1) => D.fmtNum(v, d);
  const fmtDb = (v, d = 1) => D.fmtDb(v, d) + ' dB';
  const hz = D.fmtHz;

  // ---------- direção da mistura ----------
  MM.DIR = [
    ['tone', 'Warm', 'Bright'], ['aggr', 'Soft', 'Aggressive'], ['era', 'Vintage', 'Modern'],
    ['space', 'Dry', 'Spacious'], ['width', 'Narrow', 'Wide'], ['polish', 'Natural', 'Polished'],
    ['loud', 'Dynamic', 'Loud'], ['punch', 'Smooth', 'Punchy'], ['sat', 'Clean', 'Saturated'],
  ];
  const G = (dir, bal, target, style, extra) => Object.assign({ dir, bal: bal || {}, target, style }, extra || {});
  // dir: tone, aggr, era, space, width, polish, loud, punch, sat
  MM.GENRES = {
    Kizomba: G([38, 35, 70, 58, 68, 70, 62, 82, 42], { Kick: -1, Bass: -2.5, 'Hi-Hat': -12, 'Electric Guitar': -9 }, -9, 'punchy'),
    Semba: G([45, 40, 55, 55, 70, 60, 55, 70, 45], { 'Electric Guitar': -7, Percussion: -8 }, -10, 'warm'),
    Kuduro: G([60, 70, 85, 40, 65, 70, 80, 90, 55], { Kick: 0, Snare: -3, Bass: -2 }, -8, 'loud'),
    Afrobeat: G([50, 45, 70, 50, 70, 65, 62, 75, 45], { Percussion: -8, Shaker: -11, Bass: -2.5 }, -9, 'punchy'),
    Amapiano: G([45, 40, 75, 55, 72, 65, 60, 70, 45], { Bass: -1.5, Shaker: -10, Percussion: -9, Kick: -2 }, -9, 'wide'),
    'R&B': G([35, 25, 70, 60, 65, 80, 50, 55, 35], { Kick: -2.5, 'Backing Vocal': -6 }, -10, 'warm'),
    Pop: G([60, 45, 85, 55, 72, 85, 70, 70, 35], { 'Backing Vocal': -6.5 }, -9, 'punchy'),
    'Hip-Hop': G([45, 55, 75, 40, 60, 70, 70, 85, 50], { Kick: 0, Bass: -1, 'Sub Bass': -1.5 }, -8, 'punchy'),
    Trap: G([55, 60, 90, 40, 65, 75, 78, 85, 50], { Kick: -1, 'Sub Bass': -1, Bass: -1.5, 'Hi-Hat': -10 }, -8, 'loud'),
    Reggaeton: G([55, 55, 85, 45, 65, 75, 75, 85, 45], { Kick: -0.5, Snare: -3 }, -8, 'loud'),
    Rock: G([50, 70, 50, 45, 75, 50, 65, 75, 60], { 'Electric Guitar': -5, Snare: -2.5, Kick: -2 }, -9, 'punchy'),
    Jazz: G([35, 20, 25, 60, 60, 25, 15, 35, 30], { Kick: -6, Snare: -8, Bass: -4, Piano: -4 }, -14, 'transparent'),
    Acoustic: G([45, 20, 40, 55, 60, 40, 25, 40, 30], { 'Acoustic Guitar': -4, Piano: -5 }, -13, 'transparent'),
    EDM: G([65, 70, 95, 60, 85, 85, 85, 85, 50], { Kick: 0.5, Bass: -2, Synth: -6 }, -7, 'loud'),
    House: G([55, 50, 85, 55, 75, 75, 72, 80, 40], { Kick: 1, Bass: -2, 'Hi-Hat': -10 }, -8, 'punchy'),
    Techno: G([50, 65, 85, 55, 70, 65, 75, 85, 50], { Kick: 1.5, Bass: -2.5, 'Lead Vocal': -3 }, -8, 'loud'),
    Gospel: G([45, 35, 60, 65, 70, 70, 50, 60, 35], { Choir: -4, 'Backing Vocal': -5, Piano: -6 }, -11, 'warm'),
    'Afro House': G([48, 45, 82, 60, 74, 72, 72, 82, 42], { Kick: 0.5, Bass: -2, Percussion: -7, Congas: -7, Shaker: -10, 'Hi-Hat': -10, 'Lead Vocal': -1.5 }, -8, 'punchy'),
    'Ghetto Zouk': G([40, 35, 72, 55, 66, 72, 62, 78, 40], { Kick: -1, Bass: -2, 'Hi-Hat': -12 }, -9, 'punchy'),
    Tarraxinha: G([35, 40, 75, 50, 62, 68, 66, 80, 45], { Kick: -0.5, Bass: -1, 'Sub Bass': -1, 'Lead Vocal': -1 }, -8.5, 'punchy'),
    Zouk: G([45, 30, 60, 60, 68, 70, 55, 65, 38], { Kick: -2, Bass: -2.5, 'Electric Guitar': -8 }, -10, 'warm'),
  };
  MM.BUILTIN_GENRES = Object.keys(MM.GENRES);
  MM.AESTHETICS = {
    'Warm Analog': { tone: -15, era: -20, sat: +18 },
    'Modern Clean': { tone: +12, era: +20, sat: -20, polish: +10 },
    'Radio Ready': { polish: +15, loud: +12, tone: +8 },
    'Wide Pop': { width: +20, space: +8, polish: +10 },
    'Punchy Club': { punch: +15, loud: +12, aggr: +10 },
    'Smooth Vocal': { aggr: -15, polish: +10, tone: -6 },
    'Deep Low-End': { tone: -10, punch: +6 },
    'Vintage Soul': { era: -30, sat: +15, space: +10, tone: -10 },
    'Transparent Master': { loud: -20, sat: -15, aggr: -10 },
    'Aggressive Modern': { aggr: +25, loud: +15, sat: +10, era: +15 },
  };

  // ---------- balanço base (LU relativo à voz principal) ----------
  const BAL = {
    'Lead Vocal': 0, 'Backing Vocal': -7, Choir: -8, Adlibs: -6.5, Kick: -1.5, Snare: -4, Clap: -4.5,
    'Hi-Hat': -11, Shaker: -13, Percussion: -10, Congas: -10, 'Drum Loop': -5, Bass: -3, 'Sub Bass': -4,
    'Electric Bass': -3, 'Acoustic Guitar': -7, 'Electric Guitar': -8, Piano: -8, Rhodes: -8, Synth: -8,
    Pad: -13, Strings: -11, Brass: -8, FX: -14, Risers: -12, Impacts: -10, Ambience: -16, 'Reference Track': -60,
  };
  MM.BAL_TABLE = BAL;
  const HPF = {
    'Lead Vocal': 85, 'Backing Vocal': 120, Choir: 110, Adlibs: 140, Kick: 28, Snare: 90, Clap: 140, 'Hi-Hat': 320,
    Shaker: 380, Percussion: 110, Congas: 90, 'Drum Loop': 30, Bass: 30, 'Sub Bass': 22, 'Electric Bass': 32,
    'Acoustic Guitar': 90, 'Electric Guitar': 100, Piano: 70, Rhodes: 80, Synth: 110, Pad: 150, Strings: 90, Brass: 110,
    FX: 150, Risers: 160, Impacts: 35, Ambience: 200, 'Reference Track': 10,
  };
  const PRIORITY = ['Lead Vocal', 'Kick', 'Bass', 'Sub Bass', 'Electric Bass', 'Snare', 'Clap', 'Backing Vocal', 'Choir', 'Adlibs',
    'Drum Loop', 'Electric Guitar', 'Acoustic Guitar', 'Piano', 'Rhodes', 'Synth', 'Brass', 'Percussion', 'Congas', 'Hi-Hat', 'Shaker',
    'Strings', 'Pad', 'Impacts', 'Risers', 'FX', 'Ambience', 'Reference Track'];
  const prio = (s) => {
    const base = PRIORITY.indexOf(s.role);
    return (base < 0 ? 30 : base) + ({ P: 0, S: 4, B: 9 }[s.hier] || 0);
  };
  const GUARD = { conservative: { eq: 2, bands: 2, gr: 3, sat: 0.35 }, normal: { eq: 4, bands: 4, gr: 5, sat: 0.6 }, free: { eq: 8, bands: 6, gr: 9, sat: 1 } };
  MM.GUARD = GUARD;

  // ---------- parâmetros por omissão de um stem ----------
  MM.defaultParams = () => ({
    trim: 0, fader: 0, pan: 0,
    hpf: { on: false, freq: 20 }, lpf: { on: false, freq: 20000 },
    eq: [], dyn: [],
    deess: { on: false, freq: 6500, amount: 0 },
    comp: { on: false, thr: -18, ratio: 1, atk: 10, rel: 120, knee: 6, makeup: 0, mix: 1, style: 'VCA' },
    comp2: { on: false, thr: -20, ratio: 1, atk: 15, rel: 200, knee: 8, makeup: 0, mix: 1, style: 'Opto' },
    trans: { on: false, attack: 0, sustain: 0 },
    sat: { on: false, model: 'tape', drive: 0, mix: 0.3 },
    duck: { on: false, src: null, freq: 120, depth: 0 },
    sendRev: -60, revType: 'plate', sendDly: -60,
    polarity: false, align: 0,
  });

  // ---------- utilitários de espectro ----------
  const NPTS = 192;
  const fAt = (i) => 20 * Math.pow(1000, i / (NPTS - 1));
  const iAt = (f) => Math.round(((NPTS - 1) * Math.log10(f / 20)) / 3);
  const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let k = Math.max(0, i - w); k <= Math.min(a.length - 1, i + w); k++) { s += a[k]; n++; } return s / n; });
  function tiltFit(S, i0, i1) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
    for (let i = i0; i <= i1; i++) { sx += i; sy += S[i]; sxx += i * i; sxy += i * S[i]; n++; }
    const b = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx), a = (sy - b * sx) / n;
    return (i) => a + b * i;
  }

  // ---------- proposta de direção ----------
  MM.proposeDirection = function (state) {
    const g = MM.GENRES[state.music.genre] || MM.GENRES.Pop;
    const d = {};
    MM.DIR.forEach(([k], i) => (d[k] = g.dir[i]));
    const reasons = [];
    const stems = state.stems.filter((s) => !s.removed);
    const dens = stems.length;
    if (dens > 18) { d.space -= 8; reasons.push(`Sessão densa (${dens} stems): menos reverb para manter a clareza.`); }
    if (dens < 8) { d.space += 6; reasons.push('Arranjo esparso: mais espaço para preencher.'); }
    const drums = stems.filter((s) => s.group === 'drums');
    const crest = D.mean(drums.map((s) => s.features.crest));
    if (drums.length && crest > 18) { d.punch += 4; reasons.push(`Bateria com transientes fortes (crest ${fmt(crest)} dB): preservar o punch.`); }
    const v = stems.find((s) => s.role === 'Lead Vocal');
    if (v && v.features.lra > 8) { d.polish += 5; reasons.push('Voz com grande variação dinâmica: mais controlo de nível.'); }
    // perfil aprendido do estilo (biblioteca de treino)
    if (MM.styles && MM.styles.directionDeltas) {
      const dd = MM.styles.directionDeltas(state.music.genre, MM.MASTER_TARGET_BANDS);
      if (dd) { Object.entries(dd.d).forEach(([k, v]) => (d[k] += v)); reasons.push(`Perfil aprendido de ${state.music.genre} (${dd.n} ${dd.n === 1 ? 'música' : 'músicas'}): ` + (dd.why.join(' ') || 'próximo da base.')); }
    }
    (state.aesthetics || []).forEach((a) => Object.entries(MM.AESTHETICS[a] || {}).forEach(([k, dv]) => (d[k] += dv)));
    Object.keys(d).forEach((k) => (d[k] = Math.round(D.clamp(d[k], 0, 100))));
    return { dir: d, reasons };
  };

  // ---------- pipeline principal ----------
  /**
   * Executa (ou volta a executar) a mistura automática. Respeita stem.locked e stem.manual[param].
   * @returns {explain: [...], conflicts: [...], confidence: {...}}
   */
  MM.runMix = function (state, opts) {
    opts = opts || {};
    const stems = state.stems.filter((s) => !s.removed && s.role !== 'Reference Track');
    const dir = state.direction;
    const n = (k) => (dir[k] - 50) / 50; // −1..+1
    const guard = GUARD[state.settings.guard] || GUARD.normal;
    const genre = MM.GENRES[state.music.genre] || MM.GENRES.Pop;
    const explain = [];
    const ex = (stem, module, text, conf) => explain.push({ stem: stem ? stem.id : null, stemName: stem ? stem.label : null, module, text, conf: conf || 0.85 });
    const canSet = (s, key) => !s.locked && !(s.manual && s.manual[key]);
    const set = (s, key, val) => { if (canSet(s, key)) { s.p[key] = val; return true; } return false; };

    // 1) gain staging: −20 LUFS ativos, pico ≤ −3 dBFS
    stems.forEach((s) => {
      const f = s.features;
      let trim = -20 - Math.max(-60, f.lufs);
      if (f.peakDb + trim > -3) trim = -3 - f.peakDb;
      trim = D.clamp(trim, -30, 30);
      if (set(s, 'trim', +trim.toFixed(1))) ex(s, 'Gain staging', `Trim de ${fmtDb(trim)}: nível ativo levado a −20 LUFS com pico em ${fmtDb(f.peakDb + trim)} (sem clipping interno, processamento em 32-bit float).`, 0.97);
    });

    // 2) balanço estático (só faders)
    const vocal = stems.find((s) => s.role === 'Lead Vocal');
    stems.forEach((s) => {
      let t = (genre.bal[s.role] !== undefined ? genre.bal[s.role] : BAL[s.role] !== undefined ? BAL[s.role] : -10);
      if (s.pair) t -= 3; // o par soma +3 dB
      // balanço aprendido com stems pós-fader do estilo (já é por stem individual)
      const lb = MM.styles && MM.styles.learnedBalance ? MM.styles.learnedBalance(state.music.genre, s.role) : null;
      if (lb && s.role !== 'Lead Vocal') { t = D.lerp(t, lb.value, lb.weight); s._learned = lb; } else delete s._learned;
      // modelo do engenheiro (o teu arquivo): pesa na medida em que bateu as regras na validação cruzada
      const em = MM.engineer && MM.engineer.predict ? MM.engineer.predict(s, state) : null;
      s._eng = em;
      if (em && em.balRes !== undefined && em.wBal > 0.03) t += em.balRes * em.wBal; // o que TU fazes de diferente da regra, pesado pela validação
      const defH = MM.ROLES[s.role].hier;
      const hv = { P: 0, S: 1, B: 2 };
      t += (hv[defH] - hv[s.hier]) * 2.5; // hierarquia escolhida pelo utilizador
      if (['Kick', 'Snare', 'Clap'].includes(s.role)) t += n('punch') * 1.5;
      if (s.group === 'vocals' && s.role !== 'Lead Vocal') t += n('polish') * -0.5;
      if (!vocal) t += 2; // instrumental: sem referência de voz
      if (set(s, 'fader', +t.toFixed(1))) {
        const why = s.hier !== defH ? ` (hierarquia ${s.hier === 'P' ? 'Primary' : s.hier === 'S' ? 'Secondary' : 'Background'} definida por ti)` : '';
        const src = (s._learned ? `aprendida de ${s._learned.n} ${s._learned.n === 1 ? 'sessão' : 'sessões'} de ${state.music.genre} na tua biblioteca` : `típica de ${state.music.genre}`) + (s._eng && s._eng.wBal > 0.03 ? ` + o teu modelo de engenheiro (${s._eng.sessions} sessões: costumas pôr ${fmtDb(s._eng.balRes)} face à regra; peso ${Math.round(s._eng.wBal * 100)} %)` : '');
        ex(s, 'Balanço', `Fader em ${fmtDb(t)} relativo à voz: relação ${src} para ${MM.ROLES[s.role].pt}${why}.`, s._learned ? 0.9 : 0.86);
      }
    });

    // 3) panorâmica
    const spread = 0.45 + 0.45 * (dir.width / 100);
    const alt = { music: 1, perc: -1, vocals: -1 };
    stems.forEach((s) => {
      if (!canSet(s, 'pan')) return;
      let pan = 0, why = '';
      const fam = MM.ROLES[s.role].fam;
      if (s.pair) {
        const amt = s.group === 'vocals' ? spread * 0.78 : spread;
        pan = s.pairSide === 'L' ? -amt : amt; why = 'par L/R aberto de forma simétrica';
      } else if (['Lead Vocal', 'Kick', 'Snare', 'Clap', 'Bass', 'Sub Bass', 'Electric Bass', 'Drum Loop'].includes(s.role) || ['pad', 'fx'].includes(fam)) {
        pan = 0; why = s.role === 'Bass' || s.role === 'Kick' ? 'low-end ao centro para compatibilidade mono' : 'elemento central';
      } else if (s.role === 'Hi-Hat') { pan = 0.25 * spread / 0.75; why = 'perspetiva de bateria'; }
      else if (s.role === 'Shaker') { pan = -0.3 * spread / 0.75; why = 'contraponto ao hi-hat'; }
      else if (['Percussion', 'Congas'].includes(s.role)) { alt.perc *= -1; pan = alt.perc * 0.4 * spread / 0.75; why = 'percussão distribuída'; }
      else if (s.group === 'vocals') { alt.vocals *= -1; pan = alt.vocals * (s.role === 'Adlibs' ? 0.35 : 0.5) * spread / 0.75; why = 'colocação estéreo à volta da voz'; }
      else { alt.music *= -1; pan = alt.music * (fam === 'keys' ? 0.15 : 0.4) * spread / 0.75; why = 'campo estéreo equilibrado'; }
      s.p.pan = +D.clamp(pan, -1, 1).toFixed(2);
      if (pan !== 0) ex(s, 'Panorâmica', `${MM.panLabel(pan)}: ${why}.`, 0.84);
    });

    // 4) EQ corretiva + criativa
    let eqConfs = [];
    stems.forEach((s) => {
      if (s.locked) return;
      const f = s.features, fam = MM.ROLES[s.role].fam;
      // HPF
      if (canSet(s, 'hpf')) {
        let fr = HPF[s.role] || 80;
        if (s.role === 'Lead Vocal' && f.f0) fr = D.clamp(f.f0 * 0.55, 70, 140);
        fr *= 1 + 0.15 * n('era');
        if (s.role === 'Bass' && n('tone') < 0) fr *= 0.9;
        s.p.hpf = { on: true, freq: Math.round(fr) };
        if (fr > 60) ex(s, 'EQ', `High-pass a ${hz(fr)} (24 dB/oit): remove rumble e energia que não pertence a ${MM.ROLES[s.role].pt}.`, 0.95);
      }
      if (!canSet(s, 'eq')) return;
      const S = f.spectrum.slice();
      const S1 = smooth(S, 2), S9 = smooth(S, 9), S19 = smooth(S, 19);
      const mx = Math.max(...S19);
      let i0 = Math.max(iAt((s.p.hpf.on ? s.p.hpf.freq : 30) * 1.3), 0), i1 = NPTS - 1;
      while (i1 > i0 + 10 && S19[i1] < mx - 32) i1--;
      while (i0 < i1 - 10 && S19[i0] < mx - 32) i0++;
      const fit = tiltFit(S1, i0, i1);
      const cands = [];
      const region = (lo, hi, name, thr, minFam) => {
        if (minFam && !minFam.includes(fam)) return;
        const a = Math.max(i0, iAt(lo)), b = Math.min(i1, iAt(hi));
        if (b - a < 2) return;
        let best = -99, bi = a, mean = 0;
        for (let i = a; i <= b; i++) { const e = S1[i] - fit(i); mean += e; if (e > best) { best = e; bi = i; } }
        mean /= b - a + 1;
        const exc = 0.6 * best + 0.4 * mean;
        if (exc > thr) cands.push({ type: 'peaking', freq: Math.round(fAt(bi)), gain: -Math.min(guard.eq * 0.75, 0.6 + (exc - thr) * 0.7), q: 1.3, why: name, score: exc });
      };
      region(200, 450, 'lama', 2.2, ['vocal', 'guitar', 'keys', 'pad', 'synth', 'snare', 'perc']);
      region(160, 320, 'lama no baixo', 2.5, ['bass']);
      region(280, 600, 'som a caixa', 2.4, ['kick']);
      region(450, 900, 'boxiness', 2.6, ['vocal', 'guitar', 'snare', 'keys']);
      region(900, 1700, 'som nasal', 2.8, ['vocal']);
      region(2500, 5000, 'aspereza', 2.6, ['vocal', 'guitar', 'keys', 'synth', 'snare']);
      // ressonâncias estreitas
      const res = [];
      for (let i = Math.max(i0, iAt(150)); i <= Math.min(i1, iAt(8000)); i++) {
        const e = S[i] - S9[i];
        if (e > 5 && S[i] >= S[i - 1] && S[i] >= S[i + 1]) res.push({ i, e });
      }
      res.sort((a, b) => b.e - a.e).slice(0, 2).forEach((r) => cands.push({ type: 'peaking', freq: Math.round(fAt(r.i)), gain: -Math.min(guard.eq * 0.75, (r.e - 4) * 0.6), q: 5, why: 'ressonância', score: r.e }));
      // decisões musicais (aditivas, pequenas)
      if (fam === 'vocal') {
        const pres = D.mean(S1.slice(iAt(2000), iAt(5000))) - D.mean(Array.from({ length: iAt(5000) - iAt(2000) }, (_, k) => fit(iAt(2000) + k)));
        if (pres < -1.5) cands.push({ type: 'peaking', freq: 3500, gain: Math.min(guard.eq * 0.6, 1.2 - pres * 0.3 + n('aggr') * 0.5), q: 1, why: 'presença', score: 3 });
        const air = 1 + 1.2 * n('tone') + 0.5 * n('era');
        if (air > 0.4) cands.push({ type: 'highshelf', freq: 10000, gain: Math.min(guard.eq * 0.6, air), q: 0.7, why: 'ar', score: 2.5 });
      }
      if (fam === 'kick' && n('punch') > 0) {
        let pk = iAt(45), pv = -99; for (let i = iAt(40); i <= iAt(95); i++) if (S1[i] > pv) { pv = S1[i]; pk = i; }
        cands.push({ type: 'peaking', freq: Math.round(fAt(pk)), gain: 1 + n('punch'), q: 1.4, why: 'peso no fundamental', score: 2.6 });
        cands.push({ type: 'peaking', freq: 3800, gain: 0.8 + n('punch') * 1.2, q: 1.2, why: 'click / ataque', score: 2.5 });
      }
      if (fam === 'snare' && n('punch') > 0) cands.push({ type: 'peaking', freq: 200, gain: 0.8 + n('punch'), q: 1.2, why: 'corpo', score: 2.2 });
      if (fam === 'hat' && n('tone') < -0.1) cands.push({ type: 'highshelf', freq: 9000, gain: n('tone') * 2.5, q: 0.7, why: 'brilho mais suave', score: 2 });
      if (fam === 'pad' && n('tone') < 0) cands.push({ type: 'highshelf', freq: 7000, gain: n('tone') * 2, q: 0.7, why: 'calor', score: 1.8 });
      // escolher as mais importantes
      cands.sort((a, b) => b.score - a.score);
      const eq = [];
      cands.forEach((c) => {
        if (eq.length >= guard.bands) return;
        if (eq.some((e) => e.type === c.type && Math.abs(Math.log2(e.freq / c.freq)) < 0.5)) return;
        c.gain = +D.clamp(c.gain, -guard.eq, guard.eq).toFixed(1);
        if (Math.abs(c.gain) < 0.4) return;
        eq.push({ type: c.type, freq: c.freq, gain: c.gain, q: c.q, on: true, why: c.why });
      });
      // modelo do engenheiro: a forma tonal que TU costumas dar a este tipo de stem (em 7 bandas), menos o que o EQ acima já faz
      const em = s._eng;
      if (em && em.d7 && em.wEq > 0.05) {
        const C7 = [[ 'lowshelf', 70, 0.7 ], [ 'peaking', 120, 0.9 ], [ 'peaking', 330, 0.9 ], [ 'peaking', 1000, 0.8 ], [ 'peaking', 3200, 0.9 ], [ 'peaking', 7000, 0.9 ], [ 'highshelf', 11000, 0.7 ]];
        const fc = [40, 110, 320, 1000, 3200, 7000, 13000], pb = s.features.bands;
        const resp = fc.map((f) => eq.reduce((a, e) => a + 20 * Math.log10(Math.max(1e-6, D.analogMag(e.type, e.freq, e.q, e.gain, f) || 1)), 0));
        const shape = (d) => { const tot = 10 * Math.log10(pb.reduce((a, p, k) => a + p * Math.pow(10, d[k] / 10), 0) || 1); return d.map((v) => v - tot); };
        const want = shape(em.d7), have = shape(resp);
        const res = want.map((v, k) => (v - have[k]) * em.wEq).map((v, k) => (pb[k] < 0.01 ? 0 : v));
        res.map((v, k) => [v, k]).filter(([v]) => Math.abs(v) >= 0.8).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2).forEach(([v, k]) => {
          if (eq.length >= guard.bands || eq.some((e) => Math.abs(Math.log2(e.freq / C7[k][1])) < 0.6)) return;
          const g = +D.clamp(v, -guard.eq, guard.eq * 0.6).toFixed(1);
          eq.push({ type: C7[k][0], freq: C7[k][1], gain: g, q: C7[k][2], on: true, why: `o teu estilo de EQ (modelo do engenheiro, ${em.sessions} sessões)` });
        });
      }
      // bandas criadas pelo utilizador para automação mantêm-se (até 8 bandas no total)
      (s.p.eq || []).filter((e) => e && e.user).forEach((e) => { if (eq.length < 8) eq.push(e); });
      s.p.eq = eq;
      eq.filter((e) => !e.user).forEach((e) => ex(s, 'EQ', `${e.gain < 0 ? 'Corte' : 'Realce'} de ${fmtDb(Math.abs(e.gain)).replace('+', '')} em ${hz(e.freq)} (Q ${fmt(e.q)}): ${e.why}${e.gain < 0 ? ' detetada no espectro médio' : ''}.`, e.why === 'ressonância' ? 0.82 : 0.88));
      eqConfs.push(s.conf);
    });

    // 5) dinâmica
    stems.forEach((s) => {
      if (!canSet(s, 'comp')) return;
      const f = s.features, fam = MM.ROLES[s.role].fam;
      const P95 = f.envP95 + s.p.trim;
      let gr = 0, ratio = 2, atk = 10, rel = 120, style = 'VCA', why = '';
      const aggr = n('aggr'), pol = n('polish');
      if (s.role === 'Lead Vocal') { gr = 4 + pol * 1.5 + aggr; ratio = 3 + aggr; atk = 5; rel = 80; style = 'FET'; why = 'estabilidade de nível frase a frase'; }
      else if (fam === 'vocal') { gr = 3 + pol; ratio = 3; atk = 8; rel = 100; style = 'VCA'; why = 'manter os backings atrás da voz'; }
      else if (fam === 'bass') { gr = 3 + pol * 0.5; ratio = 4; atk = 15; rel = 120; style = 'Opto'; why = 'low-end estável'; }
      else if (fam === 'kick') { gr = 2 + aggr * 0.5; ratio = 2.5; atk = 25 - n('punch') * 8; rel = 90; why = 'densidade sem matar o transiente (ataque lento)'; }
      else if (fam === 'snare') { gr = 3 + aggr * 0.5; ratio = 3; atk = 10; rel = 100; why = 'corpo controlado'; }
      else if (fam === 'loop') { gr = 3; ratio = 3; atk = 15; rel = 120; why = 'coesão do loop'; }
      else if (['keys', 'guitar', 'synth'].includes(fam) && f.crest > 14) { gr = 2 + pol * 0.5; ratio = 2; atk = 20; rel = 150; why = `picos altos (crest ${fmt(f.crest)} dB)`; }
      // modelo do engenheiro: quanto costumas reduzir o crest deste tipo de stem (≈ dB de compressão nos picos)
      const emc = s._eng;
      if (emc && emc.dCrest !== undefined && emc.wComp > 0.05) { const want = D.clamp(-emc.dCrest, 0, 12); gr = D.lerp(gr, want, emc.wComp); if (gr >= 1 && !why) why = 'como costumas comprimir este tipo de stem (modelo do engenheiro)'; }
      gr = Math.min(gr, guard.gr);
      if (gr < 1) { s.p.comp = Object.assign(MM.defaultParams().comp, { on: false }); return; }
      ratio = D.clamp(ratio, 1.5, 8);
      const thr = P95 - gr / (1 - 1 / ratio);
      s.p.comp = { on: true, thr: +thr.toFixed(1), ratio: +ratio.toFixed(1), atk: +atk.toFixed(0), rel, knee: 6, makeup: +(gr * 0.55).toFixed(1), mix: 1, style };
      ex(s, 'Compressão', `Compressor ${style} ${fmt(ratio)}:1, ataque ${Math.round(atk)} ms, release ${rel} ms, ~${fmt(gr)} dB de GR nos picos: ${why}.`, 0.86);
      if (s.role === 'Lead Vocal' && pol > 0) {
        s.p.comp2 = { on: true, thr: +(P95 - 3 - 2 / 0.5).toFixed(1), ratio: 2, atk: 15, rel: 220, knee: 8, makeup: 1, mix: 1, style: 'Opto' };
        ex(s, 'Compressão', 'Compressão em série (Opto 2:1, release lento): o segundo andar alisa o nível sem esmagar os transientes da dicção.', 0.82);
      } else s.p.comp2 = Object.assign(MM.defaultParams().comp2, { on: false });
    });

    // transientes e saturação
    let satCount = 0;
    const satMax = Math.ceil(stems.length * 0.35);
    stems.forEach((s) => {
      const fam = MM.ROLES[s.role].fam;
      if (canSet(s, 'trans')) {
        if (['kick', 'snare'].includes(fam) && Math.abs(n('punch')) > 0.15) {
          s.p.trans = { on: true, attack: +(n('punch') * 0.35).toFixed(2), sustain: +(-Math.max(0, n('punch')) * 0.15).toFixed(2) };
          ex(s, 'Transientes', `${n('punch') > 0 ? 'Mais' : 'Menos'} ataque (${fmt(s.p.trans.attack * 12)} dB máx.) e sustain controlado: direção ${n('punch') > 0 ? 'Punchy' : 'Smooth'}.`, 0.84);
        } else s.p.trans = { on: false, attack: 0, sustain: 0 };
      }
      if (canSet(s, 'sat')) {
        const amt = (dir.sat / 100) * guard.sat;
        let sat = null;
        if (fam === 'bass' && amt > 0.2) sat = { model: 'tube', drive: amt * 0.9, mix: 0.35, why: 'harmónicos para o baixo se ouvir em colunas pequenas' };
        else if (s.role === 'Lead Vocal' && (dir.era < 55 || dir.sat > 45)) sat = { model: 'tape', drive: amt * 0.6, mix: 0.3, why: 'densidade e cola analógica na voz' };
        else if (fam === 'snare' && dir.aggr > 55) sat = { model: 'console', drive: amt * 0.8, mix: 0.4, why: 'agressividade na tarola' };
        else if (fam === 'keys' && dir.era < 40) sat = { model: 'transformer', drive: amt * 0.5, mix: 0.3, why: 'cor vintage' };
        if (sat && satCount < satMax) {
          satCount++;
          s.p.sat = { on: true, model: sat.model, drive: +sat.drive.toFixed(2), mix: sat.mix };
          ex(s, 'Saturação', `Saturação ${MM.SAT_NAMES[sat.model]} (drive ${Math.round(sat.drive * 100)} %, mix ${Math.round(sat.mix * 100)} %): ${sat.why}.`, 0.8);
        } else s.p.sat = { on: false, model: 'tape', drive: 0, mix: 0.3 };
      }
      // de-esser
      if (fam === 'vocal' && canSet(s, 'deess')) {
        const S = s.features.spectrum;
        const sib = D.mean(S.slice(iAt(5000), iAt(9000))) - D.mean(S.slice(iAt(1000), iAt(4000)));
        const amount = D.clamp(3 + (sib + 12) * 0.25 + n('tone') * 1, 1.5, 7);
        s.p.deess = { on: true, freq: 6500, amount: +amount.toFixed(1) };
        ex(s, 'De-esser', `De-esser dinâmico a ${hz(6500)}, até ${fmtDb(-amount)} só nas sibilantes detetadas.`, 0.85);
      }
    });

    // 6) espaço: reverb e delay
    const sp = n('space');
    const REV = {
      'Lead Vocal': ['plate', -20], 'Backing Vocal': ['plate', -15], Choir: ['hall', -13], Adlibs: ['plate', -17], Snare: ['room', -14], Clap: ['room', -15],
      Percussion: ['room', -16], Congas: ['room', -16], 'Electric Guitar': ['hall', -15], 'Acoustic Guitar': ['hall', -16], Piano: ['hall', -15], Rhodes: ['hall', -16],
      Synth: ['hall', -17], Pad: ['hall', -11], Strings: ['hall', -12], Brass: ['hall', -16], FX: ['hall', -12], Risers: ['hall', -12], Impacts: ['hall', -14],
    };
    stems.forEach((s) => {
      if (!canSet(s, 'sendRev')) return;
      const r = REV[s.role];
      if (!r) { s.p.sendRev = -60; return; }
      let lvl = r[1] + sp * 6 + ({ P: -1, S: 0, B: 2 }[s.hier] || 0);
      if (state.stems.length > 18) lvl -= 2;
      s.p.revType = r[0];
      s.p.sendRev = +lvl.toFixed(1);
      ex(s, 'Reverb', `Send ${fmtDb(lvl)} para ${MM.REV_NAMES[r[0]]}: ${s.hier === 'B' ? 'empurrado para trás na profundidade' : s.hier === 'P' ? 'mantém-se à frente, com cauda curta' : 'profundidade intermédia'}.`, 0.83);
    });
    stems.forEach((s) => {
      if (!canSet(s, 'sendDly')) return;
      s.p.sendDly = s.role === 'Lead Vocal' ? -26 + sp * 4 : s.role === 'Adlibs' ? -14 : s.role === 'Electric Guitar' && sp > 0.2 ? -24 : -60;
      if (s.p.sendDly > -40 && s.role !== 'Adlibs') ex(s, 'Delay', `Delay ${state.fx.delay.division} sincronizado a ${state.music.bpm} BPM, send ${fmtDb(s.p.sendDly)}, com ducking enquanto a voz canta.`, 0.82);
    });
    const beat = 60 / state.music.bpm;
    const fx = state.fx;
    if (!fx.manual) {
      fx.plate.decay = +(1.1 + 0.8 * (dir.space / 100)).toFixed(2);
      fx.plate.predelay = Math.round((beat / 8) * 1000);
      fx.room.decay = +(0.6 + 0.4 * (dir.space / 100)).toFixed(2);
      fx.hall.decay = +(1.8 + 1.4 * (dir.space / 100)).toFixed(2);
      fx.hall.predelay = Math.round((beat / 4) * 1000 * 0.5);
      [fx.plate, fx.room, fx.hall].forEach((r) => { r.lpf = Math.round(6500 + 5000 * (dir.tone / 100)); r.hpf = 250; });
      fx.delay.time = +(beat * ({ '1/4': 1, '1/8': 0.5, '1/8.': 0.75, '1/16': 0.25, '1/4.': 1.5, Slap: 0.11 / beat }[fx.delay.division] || 1)).toFixed(4);
      fx.delay.feedback = +(0.22 + 0.15 * (dir.space / 100)).toFixed(2);
      ex(null, 'Reverb', `Plate ${fmt(fx.plate.decay)} s com pre-delay de ${fx.plate.predelay} ms (1/32 a ${state.music.bpm} BPM) para a voz não perder inteligibilidade; hall ${fmt(fx.hall.decay)} s para instrumentos de fundo.`, 0.84);
    }

    // 7) masking (dinâmico, só quando o elemento protagonista toca)
    const conflicts = MM.analyzeMasking(state, stems, guard);
    conflicts.forEach((c) => {
      const b = state.stems.find((x) => x.id === c.b), a = state.stems.find((x) => x.id === c.a);
      if (!canSet(b, 'dyn') || c.overlap < 0.25) { c.action = 'nenhuma'; return; }
      if (c.kind === 'duck') {
        b.p.duck = { on: true, src: a.id, freq: 120, depth: c.cut };
        c.action = `duck <120 Hz ${fmtDb(-c.cut)} com o ${a.label.toLowerCase()}`;
        ex(b, 'Masking', `Kick × baixo a ${hz(c.freq)} em ${Math.round(c.overlap * 100)} % do tempo: sidechain multibanda no baixo (abaixo de 120 Hz, até ${fmtDb(-c.cut)}), só nas pancadas do bombo.`, 0.84);
      } else {
        if (!b.p.dyn) b.p.dyn = [];
        if (b.p.dyn.length >= 2) { c.action = 'limite de bandas'; return; }
        b.p.dyn.push({ freq: c.freq, q: 1.4, cut: c.cut, src: a.id });
        c.action = `EQ dinâmico ${fmtDb(-c.cut)} @ ${hz(c.freq)}`;
        ex(b, 'Masking', `Reduzi até ${fmt(c.cut)} dB a ${hz(c.freq)} no ${b.label.toLowerCase()} porque estava a mascarar ${a.role === 'Lead Vocal' ? 'o corpo da voz' : a.label.toLowerCase()} (${Math.round(c.overlap * 100)} % de sobreposição). O corte só atua quando ${a.label.toLowerCase()} toca.`, 0.88);
      }
    });

    // 7b) correções que se ajustam até resolver: sobe o corte (em passos de 0,5 dB, até ao limite do modo de proteção)
    //     até a sobreposição prevista cair para metade (ou abaixo de 20 %)
    if (MM.insight && MM.insight.simulateMask) {
      const maxCut = { conservative: 3, normal: 6, free: 9 }[state.settings.guard] || 6;
      conflicts.forEach((c) => {
        if (!c.action || /nenhuma|limite/.test(c.action)) return;
        const b = state.stems.find((x) => x.id === c.b), a = state.stems.find((x) => x.id === c.a);
        const d = c.kind === 'duck' ? b.p.duck : (b.p.dyn || []).find((x) => x.src === c.a);
        if (!d) return;
        const key = c.kind === 'duck' ? 'depth' : 'cut';
        const base = MM.insight.maskDetail(state, c, 'pre');
        if (!base) return;
        const o0 = base.overlap, goal = Math.max(0.2, o0 * 0.5);
        let amt = d[key], pred = MM.insight.simulateMask(state, c, amt);
        const start = amt, p0 = pred;
        while (pred !== null && pred > goal && amt < maxCut) { amt = +(amt + 0.5).toFixed(1); pred = MM.insight.simulateMask(state, c, amt); }
        d[key] = amt; c.cut = amt; c.overlap0 = +o0.toFixed(2); c.predicted = pred !== null ? +pred.toFixed(2) : null;
        c.action = c.kind === 'duck' ? `duck <${Math.round(d.freq || 120)} Hz ${fmtDb(-amt)} com o ${a.label.toLowerCase()}` : `EQ dinâmico ${fmtDb(-amt)} @ ${hz(d.freq)}`;
        if (amt > start + 0.01) ex(b, 'Masking', `Corte ajustado de ${fmt(start)} para ${fmt(amt)} dB até resolver: sobreposição prevista com ${a.label.toLowerCase()} ${Math.round(o0 * 100)} % → ${Math.round((pred || 0) * 100)} %${pred > goal ? ` (limite do modo de proteção: ${maxCut} dB)` : ''}. Verifica em Análise → Depois.`, 0.84);
        else if (p0 !== null) ex(b, 'Masking', `Corte de ${fmt(amt)} dB chega: sobreposição prevista ${Math.round(o0 * 100)} % → ${Math.round(p0 * 100)} %.`, 0.84);
      });
    }

    // 8) mix bus
    if (!state.bus.manual) {
      const b = state.bus;
      b.eq.low = +(n('tone') < 0 ? -n('tone') * 1 : 0).toFixed(1);
      b.eq.high = +(n('tone') * 1.2 + n('era') * 0.4).toFixed(1);
      b.glue = { on: true, thr: -14, ratio: 2, atk: 30, rel: 200, knee: 6, mix: 1, gr: +(1 + n('loud') * 0.8 + n('aggr') * 0.4).toFixed(1) };
      b.sat = { on: dir.sat > 35, model: dir.era < 50 ? 'tape' : 'transformer', drive: +((dir.sat / 100) * 0.4 * guard.sat).toFixed(2), mix: 0.5 };
      b.drumPar = { on: dir.punch > 55 && stems.some((s) => s.group === 'drums'), mix: +(0.15 + 0.25 * Math.max(0, n('punch'))).toFixed(2) };
      ex(null, 'Mix bus', `Bus compressor 2:1, ataque 30 ms, release auto (~${fmt(b.glue.gr)} dB GR): coesão sem achatar a dinâmica.${b.drumPar.on ? ` Compressão paralela no drum bus (${Math.round(b.drumPar.mix * 100)} %) para mais energia sem destruir os transientes.` : ''}`, 0.86);
      if (b.sat.on) ex(null, 'Mix bus', `${MM.SAT_NAMES[b.sat.model]} no mix bus (drive ${Math.round(b.sat.drive * 100)} %): cola harmónica subtil.`, 0.8);
    }

    // 9) automação
    MM.buildAutomation(state, stems, ex);

    const confidence = {
      instruments: D.mean(stems.map((s) => s.conf)),
      eq: D.clamp(0.8 + 0.12 * D.mean(eqConfs.length ? eqConfs : [0.9]), 0, 0.97),
      comp: 0.86,
      direction: D.clamp((state.music.genreConf || 0.7) * 0.6 + 0.35, 0, 0.95),
      masking: conflicts.length ? D.mean(conflicts.map((c) => c.conf || 0.85)) : 0.9,
    };
    state.explain = explain;
    state.conflicts = conflicts;
    state.confidence = confidence;
    return { explain, conflicts, confidence };
  };

  MM.panLabel = (p) => (Math.abs(p) < 0.02 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100));
  MM.SAT_NAMES = { tube: 'Tube', tape: 'Tape', transformer: 'Transformer', console: 'Console', soft: 'Soft clip', exciter: 'Harmonic exciter' };
  MM.REV_NAMES = { plate: 'Plate', room: 'Room', hall: 'Hall' };

  // ---------- masking ----------
  MM.analyzeMasking = function (state, stems, guard) {
    guard = guard || GUARD.normal;
    const out = [];
    const offs = (s) => s.p.trim + s.p.fader;
    const levels = (s) => {
      // nível por bloco/banda em dB depois de trim + fader
      const f = s.features, nb = f.bandFrames, L = new Float32Array(nb * 31), o = offs(s);
      for (let i = 0; i < nb * 31; i++) L[i] = 10 * Math.log10(f.bandTL[i] + 1e-14) + o;
      return L;
    };
    const cache = new Map();
    const lv = (s) => { if (!cache.has(s.id)) cache.set(s.id, levels(s)); return cache.get(s.id); };
    const sorted = stems.slice().sort((a, b) => prio(a) - prio(b));
    const hpfBand = (s) => (s.p.hpf.on ? D.THIRD_OCT.findIndex((f) => f > s.p.hpf.freq * 1.2) : 0);
    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i];
      if (!['P', 'S'].includes(A.hier)) continue;
      const LA = lv(A), nb = A.features.bandFrames;
      // bandas importantes de A (dentro de 12 dB da banda mais forte, acima do HPF)
      const mean = new Float64Array(31);
      for (let t = 0; t < nb; t++) for (let k = 0; k < 31; k++) mean[k] += Math.pow(10, LA[t * 31 + k] / 10);
      const mdb = Array.from(mean, (v) => 10 * Math.log10(v / nb + 1e-14));
      const mmax = Math.max(...mdb);
      const imp = mdb.map((v, k) => v > mmax - 12 && k >= hpfBand(A));
      const actThr = mmax - 20;
      for (let j = i + 1; j < sorted.length; j++) {
        const B = sorted[j];
        if (B.pair && B.pair === A.id) continue;
        if (B.group === A.group && A.group === 'vocals' && A.role !== 'Lead Vocal') continue;
        const LB = lv(B);
        const n2 = Math.min(nb, B.features.bandFrames);
        const cnt = new Float64Array(31); let active = 0;
        for (let t = 0; t < n2; t++) {
          let aOn = false;
          for (let k = 0; k < 31; k++) if (imp[k] && LA[t * 31 + k] > actThr) { aOn = true; break; }
          if (!aOn) continue;
          active++;
          for (let k = Math.max(hpfBand(B), 0); k < 31; k++) {
            if (!imp[k]) continue;
            const a = LA[t * 31 + k], b = LB[t * 31 + k];
            if (a > actThr && b > a - 4) cnt[k]++;
          }
        }
        if (active < 10) continue;
        // agrupar em regiões de ~1 oitava e escolher a pior
        let bestK = -1, bestV = 0;
        for (let k = 1; k < 30; k++) { const v = (cnt[k - 1] + cnt[k] * 1.5 + cnt[k + 1]) / 3.5 / active; if (v > bestV) { bestV = v; bestK = k; } }
        if (bestK < 0 || bestV < 0.15) continue;
        const freq = D.THIRD_OCT[bestK];
        const isLow = freq < 130 && ['kick'].includes(MM.ROLES[A.role].fam) && MM.ROLES[B.role].fam === 'bass';
        const cut = +D.clamp(1 + bestV * 2.5, 1, Math.min(3.5, guard.eq)).toFixed(1);
        out.push({ a: A.id, b: B.id, aName: A.label, bName: B.label, freq: Math.round(freq), band: bestK, overlap: +bestV.toFixed(2), cut, kind: isLow ? 'duck' : 'dyn', conf: D.clamp(0.75 + bestV * 0.3, 0.75, 0.95) });
      }
    }
    // manter os conflitos mais relevantes (máx. 12), protagonista primeiro
    out.sort((x, y) => y.overlap - x.overlap);
    return out.slice(0, 12);
  };

  // ---------- automação ----------
  MM.laneValue = function (lane, t) {
    if (lane.enabled.manual && lane.manual) for (const seg of lane.manual) if (seg.length && t >= seg[0][0] && t <= seg[seg.length - 1][0]) return D.curveAt(seg, t);
    if (!lane.enabled.ai || !lane.ai) return lane.def;
    if (lane.ai.values) {
      const x = (t - lane.ai.t0) * lane.ai.rate, i = Math.floor(x);
      const v = lane.ai.values;
      if (i < 0) return v[0]; if (i >= v.length - 1) return v[v.length - 1];
      return v[i] + (v[i + 1] - v[i]) * (x - i);
    }
    return D.curveAt(lane.ai.points, t);
  };

  MM.buildAutomation = function (state, stems, ex) {
    const keepManual = {};
    (state.automation || []).forEach((l) => { if (l.manual && l.manual.length) keepManual[l.id] = l.manual; });
    // lanes criadas pelo utilizador sobrevivem a qualquer reconstrução da automação da IA
    const userLanes = (state.automation || []).filter((l) => l.user && (l.target.type !== 'stem' || state.stems.some((s) => s.id === l.target.id && !s.removed)));
    const lanes = [];
    const secs = state.music.sections;
    const dur = state.music.duration;
    const secAt = (t) => secs.find((s) => t >= s.start && t < s.end) || secs[secs.length - 1];
    const ruler = state.rider;
    const blockSec = stems[0] ? stems[0].features.bandBlockSec : 0.1;
    const rate = 1 / blockSec;
    const bandsIdx = (lo, hi) => D.THIRD_OCT.map((f, k) => (f >= lo && f <= hi ? k : -1)).filter((k) => k >= 0);
    const bandLevel = (s, ks) => {
      const f = s.features, nb = f.bandFrames, o = s.p.trim + s.p.fader, out = new Float32Array(nb);
      for (let t = 0; t < nb; t++) { let p = 0; for (const k of ks) p += f.bandTL[t * 31 + k]; out[t] = 10 * Math.log10(p + 1e-14) + o; }
      return out;
    };
    const add = (l) => { l.manual = keepManual[l.id] || []; l.enabled = l.enabled || { ai: true, manual: true }; lanes.push(l); };
    // dinâmica das secções aprendida no treino do estilo (como o refrão abre face ao verso)
    const SP = MM.styles && MM.styles.sectionProfile ? MM.styles.sectionProfile(state.music.genre) : null;
    const grpOf = (name) => (MM.styles && MM.styles.groupOf ? MM.styles.groupOf(name) : /Refr/.test(name) ? 'chorus' : 'verse');
    const spK = SP ? SP.conf : 0;
    const vocOff = (t) => { if (!SP || !SP.vocal) return 0; const sc = secAt(t); return sc && grpOf(sc.name) === 'chorus' ? D.clamp(SP.vocal.med, -2, 2) * spK : 0; };

    // --- vocal rider ---
    const v = stems.find((s) => s.role === 'Lead Vocal');
    if (v && !v.locked) {
      const ks = bandsIdx(300, 4000);
      const vl = bandLevel(v, ks);
      const inst = new Float32Array(vl.length);
      stems.forEach((s) => { if (s === v || s.group === 'vocals') return; const l = bandLevel(s, ks); for (let t = 0; t < inst.length && t < l.length; t++) inst[t] += Math.pow(10, l[t] / 10); });
      const vmax = D.percentile(Array.from(vl), 0.97);
      const act = Array.from(vl, (x) => x > vmax - 18);
      const diffs = [];
      for (let t = 0; t < vl.length; t++) if (act[t]) diffs.push(vl[t] - 10 * Math.log10(inst[t] + 1e-14));
      const med = D.median(diffs);
      const target = med + (ruler.target - 1.5);
      const vals = new Float32Array(vl.length);
      let g = 0;
      const sm = 0.55 + 0.4 * (ruler.smooth / 100);
      let breaths = 0;
      for (let t = 0; t < vl.length; t++) {
        let desired;
        if (act[t]) desired = target + vocOff(t * blockSec) - (vl[t] - 10 * Math.log10(inst[t] + 1e-14));
        else {
          // respiração: nível baixo mas presente imediatamente antes de uma frase
          const next = act.indexOf(true, t);
          const isBreath = vl[t] > vmax - 34 && next > t && (next - t) * blockSec < 0.5;
          desired = isBreath ? ruler.breaths : g;
          if (isBreath) breaths++;
        }
        desired = D.clamp(desired, -ruler.max, ruler.max);
        g = g * sm + desired * (1 - sm);
        vals[t] = g;
      }
      add({ id: 'ride:' + v.id, label: v.label, sub: 'Volume (vocal rider)', target: { type: 'stem', id: v.id, param: 'ride' }, unit: 'dB', min: -6, max: 6, def: 0, ai: { t0: 0, rate, values: vals }, show: true, kind: 'rider' });
      const perSec = secs.filter((s) => s.name && /Refr|Vers|Pré|Bridge/.test(s.name)).map((s) => {
        const a = Math.floor(s.start * rate), b = Math.floor(s.end * rate);
        const avg = D.mean(Array.from(vals.slice(a, b)));
        const instL = D.mean(Array.from(inst.slice(a, b), (x) => 10 * Math.log10(x + 1e-14)));
        const vAct = []; for (let t = a; t < b; t++) if (act[t]) vAct.push(vl[t]);
        return { name: s.name, avg, instL, vocL: vAct.length ? D.mean(vAct) : -90 };
      });
      const fin = perSec.filter((x) => /final/.test(x.name))[0] || perSec.filter((x) => /Refr/.test(x.name)).pop();
      const ver = perSec.find((x) => /Vers/.test(x.name));
      state.riderInfo = { points: vals.length, sections: secs.length, breaths };
      if (ex) {
        ex(v, 'Vocal rider', `Mantém a voz ${fmt(ruler.target)} LU acima do instrumental na banda 300 Hz – 4 kHz, frase a frase (${vals.length} pontos, ${secs.length} secções).`, 0.88);
        if (fin && ver) {
          const di = fin.instL - ver.instL, dv = fin.vocL - ver.vocL;
          let txt;
          if (fin.avg > 0.2) txt = `${fin.name} ${fmtDb(fin.avg)}: o instrumental sobe ${fmt(di)} dB face ao ${ver.name.toLowerCase()} e a voz só ${fmt(dv)} dB, por isso o rider acompanha para manter a mesma distância.`;
          else if (fin.avg < -0.2) txt = `${fin.name} ${fmtDb(fin.avg)}: a voz já sobe ${fmt(dv)} dB sozinha (o instrumental sobe ${fmt(di)} dB), por isso o rider recua para não a pôr à frente demais.`;
          else txt = `${fin.name}: voz e instrumental sobem por igual (${fmt(dv)} / ${fmt(di)} dB) — o rider mantém-se quase neutro.`;
          ex(v, 'Vocal rider', txt, 0.86);
        }
      }
      // send de reverb da voz por secção
      const base = { Intro: -10, Outro: -10, Verso: 0, Pré: 1, Refrão: 2.5, Bridge: 4, 'Refrão final': 3 };
      const pts = [];
      secs.forEach((s) => {
        const key = Object.keys(base).find((k) => s.name.startsWith(k)) || 'Verso';
        const val = base[key];
        pts.push([s.start + 0.05, val], [Math.max(s.start + 0.1, s.end - 0.4), val]);
      });
      add({ id: 'sendRev:' + v.id, label: v.label, sub: `Send de reverb (${MM.REV_NAMES[v.p.revType]})`, target: { type: 'stem', id: v.id, param: 'sendRev' }, unit: 'dB', rel: true, min: -12, max: 8, def: 0, ai: { points: pts }, show: true });
    }
    // --- pad: filtro passa-baixo por secção ---
    const pad = stems.find((s) => ['Pad', 'Strings'].includes(s.role));
    if (pad && !pad.locked) {
      const val0 = (s) => (/Refrão final/.test(s.name) ? 14000 : /Refr/.test(s.name) ? 12000 : /Pré/.test(s.name) ? 7000 : /Vers/.test(s.name) ? 4200 : /Bridge/.test(s.name) ? 2200 : 3500);
      // brilho aprendido: refrões mais (ou menos) abertos do que a base
      const val = (s) => (SP && SP.chorus && grpOf(s.name) === 'chorus' ? D.clamp(val0(s) * Math.pow(2, (D.clamp(SP.chorus.bright, -3, 3) / 3) * spK), 1500, 18000) : val0(s));
      const pts = [];
      secs.forEach((s) => { pts.push([s.start + 0.05, val(s)], [Math.max(s.start + 0.1, s.end - 0.6), val(s)]); });
      add({ id: 'lpf:' + pad.id, label: pad.label, sub: 'Filtro passa-baixo', target: { type: 'stem', id: pad.id, param: 'lpf' }, unit: 'Hz', log: true, min: 500, max: 20000, def: 20000, ai: { points: pts }, show: true });
      if (ex) ex(pad, 'Automação', 'Filtro do pad fechado nos versos e aberto nos refrões: o refrão ganha brilho e largura por contraste, sem subir o volume.', 0.82);
    }
    // --- adlibs: delay throws no fim das frases ---
    const adl = stems.find((s) => s.role === 'Adlibs');
    if (adl && !adl.locked) {
      const bl = adl.features.blockMs.map((p) => -0.691 + 10 * Math.log10(p + 1e-20));
      const thr = adl.features.lufs - 12;
      const pts = [[0, -40]];
      let on = false;
      for (let t = 0; t < bl.length; t++) {
        const a = bl[t] > thr;
        if (on && !a) { const ts = t / 10; pts.push([ts - 0.05, -40], [ts, 0], [ts + 0.35, 0], [ts + 0.75, -40]); }
        on = a;
      }
      pts.push([dur, -40]);
      add({ id: 'sendDly:' + adl.id, label: adl.label, sub: `Send de delay ${state.fx.delay.division} (throws)`, target: { type: 'stem', id: adl.id, param: 'sendDly' }, unit: 'dB', rel: true, min: -40, max: 6, def: -40, base: -14, ai: { points: pts }, show: true });
      if (ex) ex(adl, 'Automação', 'Delay throws: o send de delay abre no fim de cada adlib e fecha antes da próxima frase da voz.', 0.84);
    }
    // --- master: largura por secção ---
    const wv0 = (s) => (/Refrão final/.test(s.name) ? 112 : /Refr/.test(s.name) ? 108 : /Bridge/.test(s.name) ? 92 : /Pré/.test(s.name) ? 104 : 100);
    // largura aprendida: rácio largura(refrão)/largura(verso) medido nas misturas do estilo
    const wv = (s) => {
      const g = grpOf(s.name), d = SP && SP[g];
      if (!d || g === 'verse' || !d.width) return wv0(s);
      const learned = 100 * D.clamp(d.width, 0.85, 1.3) + (/final/.test(s.name) ? 3 : 0);
      return Math.round(D.lerp(wv0(s), learned, spK));
    };
    const wpts = [];
    secs.forEach((s) => wpts.push([s.start + 0.05, wv(s)], [Math.max(s.start + 0.1, s.end - 0.5), wv(s)]));
    add({ id: 'width:master', label: 'Master', sub: 'Largura estéreo', target: { type: 'master', param: 'width' }, unit: '%', rel: true, min: 60, max: 150, def: 100, ai: { points: wpts }, show: true });

    // --- volume por secção aprendido (stems treinados): o que o engenheiro faz para além do arranjo ---
    if (SP && SP.roles && Object.keys(SP.roles).length) {
      const groups = { chorus: [], verse: [], low: [] };
      secs.forEach((sc) => groups[grpOf(sc.name)].push([sc.start, sc.end]));
      const luG = (bm, g) => { let s2 = 0, n = 0; groups[g].forEach(([a, b]) => { const i0 = Math.floor(a * 10), i1 = Math.min(bm.length, Math.ceil(b * 10)); for (let i = i0; i < i1; i++) { s2 += bm[i]; n++; } }); return n ? -0.691 + 10 * Math.log10(s2 / n + 1e-20) : -99; };
      const learnedTxt = [];
      if (groups.chorus.length && groups.verse.length) stems.forEach((s) => {
        if (s.role === 'Lead Vocal' || s.locked || !s.features.blockMs) return;
        const want = (g) => { const tab = g === 'chorus' ? SP.roles : SP.rolesLow; const r = tab && tab[s.role]; if (!r || !groups[g].length) return 0; const v = luG(s.features.blockMs, 'verse'), x = luG(s.features.blockMs, g); if (v < -50 || x < -50) return 0; return D.clamp(r.med - (x - v), -3, 3) * spK * 0.8; };
        const off = { chorus: want('chorus'), low: want('low'), verse: 0 };
        if (Math.abs(off.chorus) < 0.5 && Math.abs(off.low) < 0.5) return;
        const pts = [];
        secs.forEach((sc) => { const v = +off[grpOf(sc.name)].toFixed(1); pts.push([sc.start + 0.05, v], [Math.max(sc.start + 0.1, sc.end - 0.25), v]); });
        add({ id: 'ride:' + s.id, label: s.label, sub: `Volume por secção · aprendido (${state.music.genre})`, target: { type: 'stem', id: s.id, param: 'ride' }, unit: 'dB', min: -12, max: 6, def: 0, ai: { points: pts }, show: true, kind: 'learned' });
        if (Math.abs(off.chorus) >= 0.5) learnedTxt.push(`${s.label} ${D.fmtDb(off.chorus)} dB no refrão`);
      });
      if (ex) {
        const c = SP.chorus;
        ex(null, 'Automação', `Aprendido de ${state.music.genre} (${SP.n} ${SP.n === 1 ? 'exemplo' : 'exemplos'}, confiança ${Math.round(spK * 100)} %): ${c ? `no refrão a mix sobe ${fmt(c.lu)} LU${c.width ? `, largura ×${fmt(c.width, 2)}` : ''}, agudos ${D.fmtDb(c.bright)} dB face ao verso` : 'estrutura do estilo'}${SP.vocal ? `; a voz fica ${D.fmtDb(SP.vocal.med)} dB face ao instrumental no refrão` : ''}. ${learnedTxt.length ? 'Ajustes por secção: ' + learnedTxt.slice(0, 5).join(', ') + '.' : 'O arranjo destes stems já faz o contraste — sem ajustes de volume.'}`, 0.8 + 0.12 * spK);
      }
    } else if (SP && ex) {
      const c = SP.chorus;
      ex(null, 'Automação', `Aprendido de ${state.music.genre} (${SP.n} ${SP.n === 1 ? 'master' : 'masters'}): ${c ? `no refrão a mix sobe ${fmt(c.lu)} LU${c.width ? `, largura ×${fmt(c.width, 2)}` : ''}, agudos ${D.fmtDb(c.bright)} dB` : ''} — aplicado à largura do master e ao filtro do pad por secção. Treina com stems pós-fader para aprender também o volume de cada instrumento por secção.`, 0.78);
    }

    // --- automação interna (sidechain, EQ dinâmico, de-esser, ducking de efeitos) ---
    stems.forEach((s) => {
      if (s.p.duck && s.p.duck.on) {
        const src = state.stems.find((x) => x.id === s.p.duck.src);
        if (src) {
          const lp = D.filter(D.mono(src.chs), D.biquad('lowpass', 150, 0.7, 0, state.sampleRate));
          const env = D.envelope(lp, state.sampleRate, 1, 70, 100);
          const e = Array.from(env, (x) => D.lin2db(x));
          const p95 = D.percentile(e.filter((x) => x > -70), 0.95);
          const vals = Float32Array.from(e, (x) => -s.p.duck.depth * D.clamp((x - (p95 - 14)) / 12, 0, 1));
          add({ id: 'duck:' + s.id, label: s.label, sub: `Sidechain <120 Hz ← ${src.label}`, target: { type: 'stem', id: s.id, param: 'duck' }, unit: 'dB', min: -12, max: 0, def: 0, ai: { t0: 0, rate: 100, values: vals }, show: false, internal: true });
        }
      }
      (s.p.dyn || []).forEach((d, k) => {
        const src = state.stems.find((x) => x.id === d.src);
        if (!src) return;
        const ks = D.THIRD_OCT.map((f, i) => (Math.abs(Math.log2(f / d.freq)) < 0.6 ? i : -1)).filter((i) => i >= 0);
        const l = bandLevel(src, ks);
        const mx = D.percentile(Array.from(l), 0.97);
        const vals = new Float32Array(l.length);
        let g = 0;
        for (let t = 0; t < l.length; t++) {
          const want = -d.cut * D.clamp((l[t] - (mx - 22)) / 10, 0, 1);
          g = want < g ? g * 0.3 + want * 0.7 : g * 0.75 + want * 0.25;
          vals[t] = g;
        }
        add({ id: `dyn${k}:` + s.id, label: s.label, sub: `EQ dinâmico ${hz(d.freq)} ← ${src.label}`, target: { type: 'stem', id: s.id, param: 'dyn' + k }, unit: 'dB', min: -12, max: 0, def: 0, ai: { t0: 0, rate, values: vals }, show: false, internal: true });
      });
      if (s.p.deess && s.p.deess.on) {
        const sr = state.sampleRate, m = D.mono(s.chs);
        const hp = D.filter(D.filter(m, D.biquad('highpass', 4800, 0.7, 0, sr)), D.biquad('highpass', 4800, 0.7, 0, sr));
        const eh = D.envelope(hp, sr, 0.5, 30, 100), ef = D.envelope(m, sr, 0.5, 30, 100);
        const diff = Array.from(eh, (x, i) => D.lin2db(x) - D.lin2db(ef[i] + 1e-9));
        const loud = Array.from(ef, (x) => D.lin2db(x));
        const lmax = D.percentile(loud, 0.97);
        const act = diff.filter((_, i) => loud[i] > lmax - 30);
        const thr = D.percentile(act, 0.85);
        const vals = Float32Array.from(diff, (x, i) => (loud[i] > lmax - 36 ? -Math.min(s.p.deess.amount, Math.max(0, x - thr) * 1.5) : 0));
        add({ id: 'deess:' + s.id, label: s.label, sub: `De-esser ${hz(s.p.deess.freq)}`, target: { type: 'stem', id: s.id, param: 'deess' }, unit: 'dB', min: -12, max: 0, def: 0, ai: { t0: 0, rate: 100, values: vals }, show: false, internal: true });
      }
    });
    // ducking de reverb/delay pela voz
    if (v) {
      const bl = v.features.blockMs.map((p) => -0.691 + 10 * Math.log10(p + 1e-20));
      const thr = v.features.lufs - 10;
      let g = 0;
      const vals = Float32Array.from(bl, (x) => { const w = x > thr ? -1 : 0; g = w < g ? w : g * 0.8 + w * 0.2; return g; });
      add({ id: 'duck:plate', label: 'Plate (retorno)', sub: 'Ducking pela voz', target: { type: 'fx', id: 'plate', param: 'duck' }, unit: 'dB', min: -12, max: 0, def: 0, scale: state.fx.plate.duck, ai: { t0: 0, rate: 10, values: vals.map((x) => x * state.fx.plate.duck) }, show: false, internal: true });
      add({ id: 'duck:delay', label: 'Delay (retorno)', sub: 'Ducking pela voz', target: { type: 'fx', id: 'delay', param: 'duck' }, unit: 'dB', min: -12, max: 0, def: 0, ai: { t0: 0, rate: 10, values: vals.map((x) => x * state.fx.delay.duck) }, show: false, internal: true });
    }
    userLanes.forEach((u) => { const ex = lanes.find((l) => l.id === u.id); if (ex) { ex.show = true; ex.user = true; } else lanes.push(u); });
    state.automation = lanes;
    return lanes;
  };

  // ---------- score de qualidade ----------
  /* Score ancorado em referências EXTERNAS (v1.6) — deixa de comparar a mistura com as próprias decisões da IA.
   * Cada critério escolhe a âncora mais forte disponível, por esta ordem:
   *   1. estilo treinado (masters/stems aprovados: balanço por papel, curva tonal ± desvio, PLR, largura, mono nos graves)
   *   2. faixa de referência carregada (curva tonal, PLR, largura)
   *   3. norma objetiva (física/entrega: alvo de loudness, ceiling, correlação, regras de balanço por papel)
   * O masking usa a medição real depois do processamento quando está atualizada (senão, a previsão da simulação). */
  const NORM_TONE = { slopeLo: -5.2, slopeHi: -1.6, lowLo: -2, lowHi: 9 }; // inclinação 250 Hz–12,5 kHz (dB/oitava, bandas de 1/3) e graves 40–80 Hz face a 100 Hz–4 kHz
  MM.scoreAnchors = function (state) {
    const prof = MM.styles && MM.styles.profile ? MM.styles.profile(state.music && state.music.genre) : null;
    const r = (state.refs || []).find((x) => x.id === state.activeRef) || (state.refs || [])[0];
    return { prof: prof && prof.n + (prof.nStems || 0) > 0 ? prof : null, ref: r && r.metrics ? r : null, style: state.music && state.music.genre };
  };
  /** LU estimado de cada stem na mistura: medido (pós-processamento) quando há medição atual, senão nível + trim + fader. */
  MM.stemLU = function (state, s, o) {
    o = o || {};
    if (o.raw) return s.features.lufs;
    const I = MM.insight, f = s.features;
    if (I && I.postFresh && I.postFresh(state) && state.post.bands[s.id] && f.bandTL) {
      const P = state.post.bands[s.id], nb = f.bandFrames, fr = D.THIRD_OCT;
      let pk = 0, rk = 0;
      for (let k = 0; k < 31; k++) {
        const fc = fr[k] || 1000, kw = (D.analogMag('highshelf', 1681, 0.7071, 4, fc) ** 2) * (fc * fc) / (fc * fc + 38 * 38);
        let ps = 0, rs = 0; for (let t = 0; t < nb; t++) { ps += P[t * 31 + k]; rs += f.bandTL[t * 31 + k]; }
        pk += ps * kw; rk += rs * kw;
      }
      if (pk > 0 && rk > 0) return f.lufs + 10 * Math.log10(pk / rk);
    }
    return f.lufs + (s.p.trim || 0) + (s.p.fader || 0);
  };
  MM.computeScore = function (state, m, o) {
    o = o || {};
    // m: métricas do master/mix renderizados (ver engine.measure)
    const stems = state.stems.filter((s) => !s.removed && s.role !== 'Reference Track' && s.features);
    const tgt = state.master.target;
    const sc = {}, anchor = {}, detail = {};
    const clamp = (v) => Math.round(D.clamp(v, 0, 100));
    const { prof, ref, style } = MM.scoreAnchors(state);
    const conf = prof ? D.clamp(prof.conf || 0.5, 0.3, 1) : 0;
    const styleName = (k) => `estilo ${style} (${k} faixa${k === 1 ? '' : 's'})`;
    const refName = ref ? `referência “${ref.name}”` : '';
    const isMaster = !o.raw && !o.mix;
    // ---------- balanço por papel ----------
    const lu = stems.map((s) => ({ s, lu: MM.stemLU(state, s, o) })).filter((x) => isFinite(x.lu) && x.lu > -70);
    let nLearned = 0;
    const tgtOf = (role) => { const b = prof && prof.balance && prof.balance[role]; if (b) { nLearned++; return { v: b.med, tol: D.clamp((b.spread || 3) / 2, 1.5, 4) }; } return { v: BAL[role] !== undefined ? BAL[role] : -10, tol: 3 }; };
    const rows = lu.map((x) => Object.assign(x, { t: tgtOf(x.s.role) }));
    const off = rows.length ? D.median(rows.map((x) => x.lu - x.t.v)) : 0; // nível global livre: só contam as relações
    rows.forEach((x) => { x.dev = x.lu - x.t.v - off; });
    const balDev = rows.reduce((a, x) => a + Math.min(10, Math.max(0, Math.abs(x.dev) - x.t.tol)), 0) / Math.max(1, rows.length);
    sc.balance = clamp(97 - balDev * 7);
    anchor.balance = nLearned ? `${styleName(prof.nStems)} · ${nLearned}/${rows.length} papéis aprendidos` : 'norma por papel (sem stems treinados neste estilo)';
    detail.balance = rows.filter((x) => Math.abs(x.dev) > x.t.tol).sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, 3).map((x) => `${x.s.label || x.s.name} ${x.dev > 0 ? '+' : ''}${fmt(x.dev)} dB`).join(' · ');
    // ---------- voz face ao instrumental (VIR) ----------
    const v = rows.find((x) => x.s.role === 'Lead Vocal');
    if (v) {
      const others = rows.filter((x) => x !== v);
      const pw = (arr, key) => 10 * Math.log10(arr.reduce((a, x) => a + Math.pow(10, key(x) / 10), 0) + 1e-12);
      const virA = v.lu - pw(others, (x) => x.lu), virT = v.t.v - pw(others, (x) => x.t.v);
      const dv = virA - virT;
      sc.vocal = clamp(97 - Math.max(0, Math.abs(dv) - 1) * 7);
      anchor.vocal = prof && prof.balance && prof.balance['Lead Vocal'] !== undefined || nLearned ? styleName(prof.nStems) : 'norma por papel';
      detail.vocal = `voz/instrumental ${fmt(virA)} dB · alvo ${fmt(virT)} dB`;
    } else { sc.vocal = 85; anchor.vocal = 'sem voz principal'; }
    // ---------- clareza (masking) ----------
    const I = MM.insight, fresh = !o.raw && I && I.postFresh && I.postFresh(state);
    const corrDepth = (c) => {
      const B = state.stems.find((x) => x.id === c.b);
      if (!B) return 0;
      if (c.kind === 'duck' && B.p.duck && B.p.duck.on && B.p.duck.src === c.a) return B.p.duck.depth || 0;
      const d = (B.p.dyn || []).find((x) => x.src === c.a);
      return d ? d.cut : 0;
    };
    let src = o.raw ? 'medido nos stems originais' : fresh ? 'medido depois do processamento' : 'previsão da simulação';
    const ovNow = (c) => {
      if (o.raw) return c.overlap;
      if (fresh) { const md = I.maskDetail(state, c, 'post'); if (md) return md.overlap; }
      const dp = corrDepth(c);
      if (c.predicted !== undefined && Math.abs(dp - (c.cut || 0)) < 0.25) return c.predicted;
      if (!fresh) src = 'estimativa';
      return c.overlap * (dp > 0 ? D.clamp(1 - dp * 0.09, 0.3, 1) : c.action === 'limite de bandas' ? 0.8 : 1);
    };
    const confl = (state.conflicts || []).map((c) => ({ c, ov: ovNow(c) }));
    const FLOOR = 0.2; // sobreposição natural que não se ouve como masking
    const residual = confl.filter((x) => x.c.kind !== 'duck').reduce((a, x) => a + Math.max(0, x.ov - FLOOR), 0);
    sc.clarity = clamp(97 - residual * 16);
    anchor.clarity = `masking ${src} · tolerância ${Math.round(FLOOR * 100)} % do tempo`;
    detail.clarity = confl.filter((x) => x.c.kind !== 'duck' && x.ov > FLOOR).sort((a, b) => b.ov - a.ov).slice(0, 2).map((x) => `${x.c.bName || ''}/${x.c.aName || ''} ${Math.round(x.ov * 100)} %`).join(' · ');
    // ---------- dinâmica ----------
    const plr = m.plr;
    let plrT = D.clamp(-tgt - 0.5, 6, 14), plrTol = 1, dynA = `norma para ${fmt(tgt)} LUFS`;
    if (isMaster && prof && prof.stat.plr) { const s1 = prof.stat.plr; plrT = s1.med * conf + plrT * (1 - conf); plrTol = D.clamp((s1.p75 - s1.p25) / 2, 0.7, 2.5); dynA = styleName(s1.n); }
    else if (isMaster && ref && isFinite(ref.metrics.plr)) { plrT = ref.metrics.plr; plrTol = 1; dynA = refName; }
    if (o.mix) { plrT += 2.5; dynA = 'pré-master: mais folga que o master'; }
    sc.dynamics = clamp(97 - Math.max(0, Math.abs(plr - plrT) - plrTol) * 5 - Math.max(0, (m.gr || 0) - 4) * 3);
    anchor.dynamics = dynA; detail.dynamics = `PLR ${fmt(plr)} dB · alvo ${fmt(plrT)} ± ${fmt(plrTol)}`;
    // ---------- imagem estéreo ----------
    let wT = 0.45, wTol = 0.12, stA = 'norma (lados ≈ 45 % do centro)';
    if (prof && prof.stat.width) { const s1 = prof.stat.width; wT = s1.med; wTol = D.clamp((s1.p75 - s1.p25) / 2, 0.05, 0.2); stA = styleName(s1.n); }
    else if (ref && isFinite(ref.metrics.width)) { wT = ref.metrics.width; wTol = 0.08; stA = refName; }
    sc.stereo = clamp(97 - Math.max(0, Math.abs(m.width - wT) - wTol) * 60 - Math.max(0, 0.2 - m.corrMin) * 60);
    anchor.stereo = stA; detail.stereo = `largura ${Math.round(m.width * 100)} % · alvo ${Math.round(wT * 100)} ± ${Math.round(wTol * 100)} %`;
    // ---------- graves ----------
    let mlT = 92, lowA = 'norma (graves em mono ≥ 92 %)';
    if (prof && prof.stat.monoLow) { mlT = Math.min(98, prof.stat.monoLow.p25); lowA = styleName(prof.stat.monoLow.n); }
    const duckRes = confl.filter((x) => x.c.kind === 'duck').reduce((a, x) => a + Math.max(0, x.ov - FLOOR), 0);
    sc.lowEnd = clamp(98 - Math.max(0, mlT - m.monoLow) * 1.2 - duckRes * 25);
    anchor.lowEnd = `${lowA} · kick/baixo ${src}`; detail.lowEnd = `mono <120 Hz ${Math.round(m.monoLow)} %`;
    // ---------- loudness (alvo de entrega) ----------
    sc.loudness = clamp(100 - Math.abs(m.lufs - tgt) * 8 - Math.max(0, m.tp - state.master.ceiling) * 25);
    anchor.loudness = `alvo de entrega ${fmt(tgt)} LUFS · ceiling ${fmt(state.master.ceiling)} dBTP`; detail.loudness = `${fmt(m.lufs)} LUFS · ${fmt(m.tp)} dBTP`;
    // ---------- fase ----------
    sc.phase = clamp(100 - Math.max(0, 0.3 - m.corrMin) * 80 - (m.corr < 0.2 ? 20 : 0));
    anchor.phase = 'norma objetiva (correlação e compatibilidade mono)'; detail.phase = `correlação ${fmt(m.corr, 2)} · mínima ${fmt(m.corrMin, 2)}`;
    // ---------- tonalidade ----------
    const mine = I && I.curveOf ? I.curveOf(m.spectrum) : null;
    if (mine) {
      const F = I.THIRD;
      const scoreVs = (curve, sd, tol0) => { let e = 0, n = 0; F.forEach((f, i) => { if (f < 31 || f > 14000) return; const tol = Math.max(tol0, sd ? sd[i] : 0); e += Math.max(0, Math.abs(mine[i] - curve[i]) - tol); n++; }); return e / Math.max(1, n); };
      let err = 0, w = 0; const an = [];
      if (prof && prof.curve31) { err += scoreVs(prof.curve31, prof.curve31sd, 1) * conf; w += conf; an.push(styleName(prof.n)); }
      if (ref && ref.metrics.spectrum) { const rc = I.curveOf(ref.metrics.spectrum); if (rc) { const rw = D.clamp(state.refInfluence || 0.5, 0.3, 1); err += scoreVs(rc, null, 1.5) * rw; w += rw; an.push(refName); } }
      if (w) { sc.tone = clamp(97 - (err / w) * 9); anchor.tone = an.join(' + '); }
      else {
        // norma larga: inclinação dos agudos e peso dos graves dentro do intervalo de masters comerciais
        const xs = [], ys = []; F.forEach((f, i) => { if (f >= 250 && f <= 12500) { xs.push(Math.log2(f)); ys.push(mine[i]); } });
        const mx = D.mean(xs), my = D.mean(ys); let nu = 0, de = 0; xs.forEach((x, i) => { nu += (x - mx) * (ys[i] - my); de += (x - mx) ** 2; });
        const slope = nu / de, low = D.mean(F.map((f, i) => (f >= 40 && f <= 80 ? mine[i] : null)).filter((x) => x !== null));
        const out = Math.max(0, NORM_TONE.slopeLo - slope, slope - NORM_TONE.slopeHi) * 6 + Math.max(0, NORM_TONE.lowLo - low, low - NORM_TONE.lowHi) * 2;
        sc.tone = clamp(95 - out * 2);
        anchor.tone = 'norma larga (sem estilo treinado nem referência)';
        detail.tone = `inclinação ${fmt(slope)} dB/oit · graves ${low >= 0 ? '+' : ''}${fmt(low)} dB`;
      }
      if (w) { const dev = I.deviations(mine, prof && prof.curve31 ? prof.curve31 : I.curveOf(ref.metrics.spectrum), prof && prof.curve31 ? prof.curve31sd : null); detail.tone = dev.slice(0, 2).map((d) => `${d.label} ${d.db > 0 ? '+' : ''}${fmt(d.db)} dB`).join(' · ') || 'dentro da tolerância'; }
    } else { sc.tone = null; }
    const wts = { balance: 1.2, clarity: 1.2, dynamics: 1, stereo: 0.8, lowEnd: 1, vocal: 1.1, loudness: 0.8, phase: 0.9, tone: prof || ref ? 1.1 : 0.6 };
    let tot = 0, ws = 0;
    Object.keys(wts).forEach((k) => { if (typeof sc[k] === 'number') { tot += sc[k] * wts[k]; ws += wts[k]; } });
    sc.overall = Math.round(tot / ws);
    sc.anchor = anchor; sc.detail = detail;
    sc.anchored = { style: prof ? style : null, ref: ref ? ref.name : null, measured: !!fresh };
    // recomendações
    const recs = [];
    if (sc.dynamics < 88) recs.push({ text: `Dynamics ${sc.dynamics} — PLR ${fmt(plr)} dB (alvo ~${fmt(plrT)}, ${anchor.dynamics}). ${plr < plrT ? 'Reduzir a compressão do mix bus ou baixar o alvo de loudness?' : 'Pode aguentar mais cola no mix bus.'}`, action: plr < plrT ? 'lessBus' : 'moreBus', label: 'Aplicar' });
    const duck = (state.conflicts || []).find((c) => c.kind === 'duck');
    if (duck && sc.lowEnd < 92) recs.push({ text: `Low-end ${sc.lowEnd} — kick e baixo competem a ${duck.freq} Hz em ${Math.round(duck.overlap * 100)} % do tempo. Rever o ducking.`, action: 'moreDuck', label: 'Rever' });
    if (m.corrMin < 0.35) recs.push({ text: `Correlação mínima ${fmt(m.corrMin, 2)}; o alargamento pode colapsar em mono.`, action: 'phase', label: 'Ver fase' });
    if (sc.loudness < 90) recs.push({ text: `Loudness ${fmt(m.lufs)} LUFS vs alvo ${fmt(tgt)} — volta a correr o master para acertar o alvo.`, action: 'remaster', label: 'Aplicar' });
    if (sc.clarity < 88) recs.push({ text: `Clarity ${sc.clarity} — ainda há sobreposição de frequências. Reforçar o EQ dinâmico?`, action: 'moreDyn', label: 'Aplicar' });
    const worst = rows.filter((x) => !x.s.locked && Math.abs(x.dev) > x.t.tol + 0.5 && !o.raw).sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, 3);
    if (sc.balance < 90 && worst.length) recs.push({ text: `Balance ${sc.balance} — face a ${nLearned ? 'o ' + styleName(prof.nStems) : 'a norma por papel'}: ${worst.map((x) => `${x.s.label || x.s.name} ${x.dev > 0 ? '+' : ''}${fmt(x.dev)} dB`).join(', ')}.`, action: 'balance', fix: worst.map((x) => ({ id: x.s.id, db: -(Math.sign(x.dev) * (Math.abs(x.dev) - x.t.tol)) * 0.7 })), label: 'Aproximar' });
    if (typeof sc.tone === 'number' && sc.tone < 86 && (prof || ref)) recs.push({ text: `Tonalidade ${sc.tone} — face a ${anchor.tone}: ${detail.tone}.`, action: 'tone', label: 'Ver curva' });
    if (!o.raw && !fresh && state.stage === 'ready') recs.push({ text: 'Score com masking previsto: mede os stems processados para o score usar valores reais.', action: 'measure', label: 'Medir' });
    if (!recs.length) recs.push({ text: 'Mistura equilibrada. Compara com a referência com loudness match ligado para validar a tonalidade.', action: 'compare', label: 'Comparar' });
    sc.recs = recs;
    return sc;
  };

  // ---------- assistente (linguagem natural → alterações) ----------
  const T = [
    [/kick|bombo|bumbo/, 'Kick'], [/snare|tarola|caixa/, 'Snare'], [/backing|coro|\bbv/, 'Backing Vocal'], [/adlib/, 'Adlibs'],
    [/\bvoz|vocal|vox|cantor|\bvo\b/, 'Lead Vocal'], [/baixo|\bbass|sub\b/, 'Bass'], [/guitarra|\bgtr|guitar/, 'Electric Guitar'],
    [/piano|teclado|keys/, 'Piano'], [/\bpad/, 'Pad'], [/hi.?hat|pratos|chimbal/, 'Hi-Hat'], [/percuss/, 'Percussion'], [/bateria|drums/, 'drums'],
  ];
  MM.parseCommand = function (text, state) {
    const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const less = /\b(menos|reduz|baixa|tira|diminui|less|reduce|lower|nao tao|demasiado|muito .*(alto|forte|brilhante|agressiv))/.test(t);
    const amt = /\bmuito\b|bastante|a lot|much/.test(t) ? 1.5 : /pouco|ligeir|slight|a bit/.test(t) ? 0.5 : 1;
    const sign = less ? -1 : 1;
    const findStem = (role) => role === 'drums' ? state.stems.filter((s) => s.group === 'drums' && !s.removed) : state.stems.filter((s) => !s.removed && (s.role === role || (role === 'Bass' && MM.ROLES[s.role].fam === 'bass') || (role === 'Electric Guitar' && MM.ROLES[s.role].fam === 'guitar')));
    let target = null;
    for (const [re, r] of T) if (re.test(t)) { target = r; break; }
    const section = /refrao|chorus/.test(t) ? 'Refrão' : /verso|verse/.test(t) ? 'Verso' : /bridge|ponte/.test(t) ? 'Bridge' : null;
    const isMaster = /master/.test(t);
    const changes = [];
    const ch = (label, conf, apply, why) => changes.push({ label, conf, apply, why });
    const stems = target ? findStem(target) : [];
    const locked = stems.filter((s) => s.locked);
    const free = stems.filter((s) => !s.locked);
    if (/refer/.test(t)) {
      ch(`Influência da referência ${Math.round(state.refInfluence * 100)} % → ${Math.round(D.clamp(state.refInfluence + 0.25 * amt * sign, 0, 1) * 100)} %`, 0.84, (st) => { st.refInfluence = D.clamp(st.refInfluence + 0.25 * amt * sign, 0, 1); st.refApply.master = true; return 'remaster'; }, 'A referência orienta o alvo de tonalidade e dinâmica do master; não copia a música.');
    }
    if (/punch|soco|impacto|ataque/.test(t)) {
      const ss = free.length ? free : findStem('Kick').filter((s) => !s.locked);
      ss.forEach((s) => {
        const d = 2.4 * amt * sign;
        ch(`${s.label} · transient attack ${fmtDb(d)}`, 0.86, (st) => { const x = st.stems.find((y) => y.id === s.id); x.p.trans.on = true; x.p.trans.attack = D.clamp(x.p.trans.attack + d / 12, -1, 1); mark(x, 'trans'); }, 'O transient shaper realça só a frente de onda, sem subir o volume médio.');
        if (sign > 0 && MM.ROLES[s.role].fam === 'kick') ch(`${s.label} · EQ +1,5 dB @ 3,8 kHz`, 0.81, (st) => { const x = st.stems.find((y) => y.id === s.id); addEq(x, { type: 'peaking', freq: 3800, gain: 1.5, q: 1.2, on: true, why: 'click (assistente)' }); }, 'Mais click no ataque do bombo para recortar a mistura.');
      });
      const bass = findStem('Bass').filter((s) => !s.locked)[0];
      if (sign > 0 && bass && (target === 'Kick' || !target)) ch(`${bass.label} · duck <120 Hz −2,8 dB com o kick`, 0.84, (st) => { const x = st.stems.find((y) => y.id === bass.id); const k = st.stems.find((y) => MM.ROLES[y.role].fam === 'kick'); if (k) { x.p.duck = { on: true, src: k.id, freq: 120, depth: Math.max(2.8, x.p.duck.depth || 0) }; mark(x, 'dyn'); } return 'automation'; }, 'Abre espaço ao bombo no sub sem baixar o baixo inteiro.');
    }
    if (/pr[oó]xim|frente|presen|perto|closer|upfront|seca/.test(t) && (target === 'Lead Vocal' || !target)) {
      findStem('Lead Vocal').filter((s) => !s.locked).forEach((s) => {
        ch(`${s.label} · send de reverb ${fmtDb(-4 * amt * sign)}`, 0.85, (st) => { const x = st.stems.find((y) => y.id === s.id); x.p.sendRev -= 4 * amt * sign; mark(x, 'sendRev'); }, 'Menos reverb = voz mais à frente na profundidade.');
        ch(`${s.label} · presença +1,2 dB @ 3,2 kHz`, 0.82, (st) => { const x = st.stems.find((y) => y.id === s.id); addEq(x, { type: 'peaking', freq: 3200, gain: 1.2 * amt * sign, q: 1, on: true, why: 'presença (assistente)' }); }, 'A banda 2–5 kHz é onde o ouvido localiza a proximidade da voz.');
        ch(`${s.label} · fader ${fmtDb(0.8 * amt * sign)}`, 0.8, (st) => { const x = st.stems.find((y) => y.id === s.id); x.p.fader += 0.8 * amt * sign; mark(x, 'fader'); });
      });
    }
    if (/abert|larg|wide|espac|amplo/.test(t)) {
      if (section || /refrao/.test(t)) {
        ch(`Master · largura no ${section || 'Refrão'} +10 %`, 0.83, (st) => { const l = st.automation.find((x) => x.id === 'width:master'); if (l) l.ai.points = l.ai.points.map(([tt, vv]) => { const s = st.music.sections.find((q) => tt >= q.start && tt < q.end); return [tt, s && s.name.startsWith(section || 'Refrão') ? vv + 10 * amt * sign : vv]; }); return 'automation'; }, 'Só nas secções pedidas: o contraste faz o refrão parecer maior.');
        const pad = state.stems.find((s) => ['Pad', 'Strings'].includes(s.role));
        if (pad) ch(`${pad.label} · filtro mais aberto no ${section || 'Refrão'}`, 0.78, (st) => { const l = st.automation.find((x) => x.id === 'lpf:' + pad.id); if (l) l.ai.points = l.ai.points.map(([tt, vv]) => { const s = st.music.sections.find((q) => tt >= q.start && tt < q.end); return [tt, s && s.name.startsWith(section || 'Refrão') ? Math.min(20000, vv * 1.4) : vv]; }); return 'automation'; });
      } else {
        ch(`Direção Narrow ↔ Wide ${fmtDb(15 * amt * sign).replace(' dB', '')}`, 0.82, (st) => { st.direction.width = D.clamp(st.direction.width + 15 * amt * sign, 0, 100); return 'rerun'; }, 'Abre os pares estéreo e os elementos secundários; graves continuam em mono.');
        ch(`Master · M/S largura ${sign > 0 ? '+' : '−'}6 %`, 0.8, (st) => { st.master.width = D.clamp(st.master.width + 6 * amt * sign, 60, 150); return 'master'; });
      }
    }
    if (/anal[oó]gic|analog|quente|warm|vintage|calor/.test(t)) {
      ch(`Direção Vintage ↔ Modern −20 · Clean ↔ Saturated +15`, 0.8, (st) => { st.direction.era = D.clamp(st.direction.era - 20 * amt * sign, 0, 100); st.direction.sat = D.clamp(st.direction.sat + 15 * amt * sign, 0, 100); st.direction.tone = D.clamp(st.direction.tone - 8 * amt * sign, 0, 100); return 'rerun'; }, 'Tape na voz e no mix bus, tube no baixo, agudos ligeiramente mais suaves.');
      ch('Master · saturação Tape', 0.78, (st) => { st.master.chain.sat.on = true; st.master.chain.sat.model = 'tape'; st.master.chain.sat.drive = D.clamp(st.master.chain.sat.drive + 0.12 * amt * sign, 0, 1); return 'master'; });
    }
    if (/agress|aspero|harsh|duro|cansativ/.test(t)) {
      const s2 = less || /aspero|harsh|duro|cansativ/.test(t) ? -1 : 1;
      if (isMaster || !target) {
        ch(`Master · Dynamic EQ ${s2 < 0 ? '−1,5' : '+1'} dB @ 3,2 kHz`, 0.84, (st) => { st.master.chain.dyn.harsh = D.clamp((st.master.chain.dyn.harsh || 0) + 1.5 * s2 * amt, -6, 3); return 'master'; }, 'Atua só quando a energia em 2–5 kHz excede o alvo, por isso não escurece a música toda.');
        ch(`Master · clipper ${s2 < 0 ? 'mais suave' : 'mais duro'}`, 0.78, (st) => { st.master.chain.clip.amount = D.clamp(st.master.chain.clip.amount + 0.2 * s2, 0, 1); return 'master'; });
        if (s2 < 0) ch('Master · alvo de loudness +1 LU mais baixo', 0.76, (st) => { st.master.target -= 1; return 'remaster'; }, 'Menos limiting = transientes mais naturais.');
      } else free.forEach((s) => ch(`${s.label} · direção Soft ↔ Aggressive ${s2 > 0 ? '+' : '−'}`, 0.8, (st) => { st.direction.aggr = D.clamp(st.direction.aggr + 15 * s2, 0, 100); return 'rerun'; }));
    }
    if (/brilh|bright|agudo|\bar\b|air|abafad|escur|dark|opac/.test(t)) {
      const up = (/brilh|bright|agudo|\bar\b|air|abafad|opac/.test(t) ? 1 : -1) * (less ? -1 : 1);
      if (free.length) free.forEach((s) => ch(`${s.label} · shelf ${fmtDb(1.5 * up * amt)} @ 10 kHz`, 0.83, (st) => { addEq(st.stems.find((y) => y.id === s.id), { type: 'highshelf', freq: 10000, gain: 1.5 * up * amt, q: 0.7, on: true, why: 'brilho (assistente)' }); }));
      else ch(`Master · shelf de ar ${fmtDb(1 * up * amt)} @ 9 kHz`, 0.84, (st) => { st.master.chain.eq.air += 1 * up * amt; return 'master'; });
    }
    if (/grave|low.?end|peso|gordo|\bsub\b|boom/.test(t) && !/baixo|bass/.test(t)) {
      const up = less || /demais|muito/.test(t) ? -1 : 1;
      ch(`Master · low shelf ${fmtDb(1.2 * up * amt)} @ 80 Hz`, 0.82, (st) => { st.master.chain.eq.low += 1.2 * up * amt; return 'master'; });
    }
    if (/reverb|ambiente|eco|espaco|molhad/.test(t) && !/abert|larg/.test(t)) {
      const up = less || /sec|dry/.test(t) ? -1 : 1;
      (free.length ? free : state.stems.filter((s) => !s.removed && !s.locked && s.p.sendRev > -40)).forEach((s) => ch(`${s.label} · send de reverb ${fmtDb(3 * up * amt)}`, 0.82, (st) => { const x = st.stems.find((y) => y.id === s.id); x.p.sendRev += 3 * up * amt; mark(x, 'sendRev'); }));
    }
    if (/mais alto|subir|sobe|aumenta|louder|turn up|mais volume|\+ ?\d/.test(t) || /mais baixo|desce|baixar|quieter|turn down|menos volume/.test(t)) {
      const up = /mais baixo|desce|baixar|quieter|turn down|menos volume/.test(t) ? -1 : 1;
      const num = (t.match(/(\d+(?:[.,]\d+)?)\s*db/) || [])[1];
      const d = num ? parseFloat(num.replace(',', '.')) * up : 1.5 * up * amt;
      if (isMaster && !target) ch(`Master · alvo ${fmt(state.master.target)} → ${fmt(state.master.target + d)} LUFS`, 0.86, (st) => { st.master.target = D.clamp(st.master.target + d, -24, -5); return 'remaster'; });
      else free.forEach((s) => ch(`${s.label} · fader ${fmtDb(d)}`, 0.88, (st) => { const x = st.stems.find((y) => y.id === s.id); x.p.fader += d; mark(x, 'fader'); }));
    }
    if (/dinam|respir|menos comprim|comprimid|esmagad/.test(t)) {
      const up = /mais din|respir|menos comprim|esmagad|comprimid/.test(t) ? 1 : -1;
      ch(`Direção Dynamic ↔ Loud ${up > 0 ? '−15' : '+15'}`, 0.8, (st) => { st.direction.loud = D.clamp(st.direction.loud - 15 * up, 0, 100); st.bus.glue.gr = D.clamp(st.bus.glue.gr - 0.8 * up, 0, 6); return 'rerun'; });
      ch(`Master · alvo ${up > 0 ? '+1 LU mais dinâmico' : '−1 LU mais alto'}`, 0.78, (st) => { st.master.target -= up; return 'remaster'; });
    }
    if (!changes.length) return { changes: [], reply: 'Não percebi o que mudar. Experimenta, por exemplo: “Quero mais punch no kick”, “Quero a voz mais próxima”, “Quero o refrão mais aberto”, “Reduz a agressividade da master” ou “Aproxima esta mix da referência”.' };
    let reply = '';
    if (locked.length) reply = `${locked.map((s) => s.label).join(', ')} está bloqueado — não mexi.`;
    return { changes, reply };

    function mark(x, k) { x.manual = x.manual || {}; x.manual[k] = true; }
    function addEq(x, band) {
      if (!x || x.locked) return;
      const ex2 = x.p.eq.find((e) => e.type === band.type && Math.abs(Math.log2(e.freq / band.freq)) < 0.4);
      if (ex2) { ex2.gain = +D.clamp(ex2.gain + band.gain, -12, 12).toFixed(1); ex2.why = band.why; } else x.p.eq.push(band);
      mark(x, 'eq');
    }
  };

  // ---------- alternativas ----------
  MM.ALTERNATIVES = [
    { id: 'A', name: 'Natural', d: { polish: -20, punch: -10, loud: -15, sat: -10, space: -5 } },
    { id: 'B', name: 'Modern', d: { era: +20, tone: +12, polish: +15, sat: -10 } },
    { id: 'C', name: 'Aggressive', d: { aggr: +30, punch: +15, sat: +20, loud: +15 } },
    { id: 'D', name: 'Wide', d: { width: +25, space: +15 } },
  ];
})();
