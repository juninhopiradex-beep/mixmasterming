/* MixMind — Music Intelligence Engine
 * Extração de features por stem, classificação (nome + áudio), deteção de problemas de importação,
 * BPM, tonalidade, compasso, estrutura/secções e sugestão de género.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;

  // ---------- catálogo de papéis ----------
  const R = (group, hier, color, pt, fam) => ({ group, hier, color, pt, fam });
  MM.ROLES = {
    'Lead Vocal': R('vocals', 'P', 'vocal', 'voz principal', 'vocal'),
    'Backing Vocal': R('vocals', 'S', 'vocal', 'backing', 'vocal'),
    Choir: R('vocals', 'S', 'vocal', 'coro', 'vocal'),
    Adlibs: R('vocals', 'S', 'vocal', 'adlibs', 'vocal'),
    Kick: R('drums', 'P', 'drum', 'bombo', 'kick'),
    Snare: R('drums', 'S', 'drum', 'tarola', 'snare'),
    Clap: R('drums', 'S', 'drum', 'palmas', 'snare'),
    'Hi-Hat': R('drums', 'B', 'drum', 'pratos', 'hat'),
    Shaker: R('drums', 'B', 'drum', 'shaker', 'hat'),
    Percussion: R('drums', 'S', 'drum', 'percussão', 'perc'),
    Congas: R('drums', 'S', 'drum', 'congas', 'perc'),
    'Drum Loop': R('drums', 'S', 'drum', 'loop de bateria', 'loop'),
    Bass: R('bass', 'P', 'bass', 'baixo', 'bass'),
    'Sub Bass': R('bass', 'P', 'bass', 'sub', 'bass'),
    'Electric Bass': R('bass', 'P', 'bass', 'baixo elétrico', 'bass'),
    'Acoustic Guitar': R('music', 'S', 'music', 'guitarra acústica', 'guitar'),
    'Electric Guitar': R('music', 'S', 'music', 'guitarra elétrica', 'guitar'),
    Piano: R('music', 'S', 'music', 'piano', 'keys'),
    Rhodes: R('music', 'S', 'music', 'rhodes', 'keys'),
    Synth: R('music', 'S', 'music', 'sintetizador', 'synth'),
    Pad: R('music', 'B', 'pad', 'pad', 'pad'),
    Strings: R('music', 'B', 'music', 'cordas', 'pad'),
    Brass: R('music', 'S', 'music', 'metais', 'synth'),
    FX: R('fx', 'B', 'fx', 'fx', 'fx'),
    Risers: R('fx', 'B', 'fx', 'riser', 'fx'),
    Impacts: R('fx', 'B', 'fx', 'impacto', 'fx'),
    Ambience: R('fx', 'B', 'fx', 'ambiência', 'pad'),
    'Reference Track': R('ref', 'B', 'fx', 'referência', 'ref'),
  };
  MM.ROLE_LIST = Object.keys(MM.ROLES);

  const NAME_RULES = [
    [/ad[\s_-]?lib|\badl\b/i, 'Adlibs'],
    [/\b(bv|bgv|bvs)\b|back(ing)?[\s_-]?v|harm(ony)?|backs?\b|dobra/i, 'Backing Vocal'],
    [/choir|coro|\bcoral\b/i, 'Choir'],
    [/vox|vocal|voz|voice|\bvo\b|lead[\s_-]?v|\blv\b/i, 'Lead Vocal'],
    [/kick|\bkik\b|bombo|\bbd\b|\bkck\b/i, 'Kick'],
    [/snare|\bsnr\b|caixa|tarola|\bsd\b/i, 'Snare'],
    [/clap|palma/i, 'Clap'],
    [/hi[\s_-]?hat|\bhh\b|\bhats?\b|chimbal|cymb|prato|\bride\b|\boh\b/i, 'Hi-Hat'],
    [/shak/i, 'Shaker'],
    [/conga|bongo|djemb/i, 'Congas'],
    [/perc|tamb|\btom\b/i, 'Percussion'],
    [/drum[\s_-]?loop|\bloop\b|\bdrums?\b|bateria|\bdrm\b/i, 'Drum Loop'],
    [/\bsub\b|808/i, 'Sub Bass'],
    [/bass|baixo|\bbx\b|\bbs\b/i, 'Bass'],
    [/ac(oustic)?[\s_-]?g|viol[aã]o|nylon/i, 'Acoustic Guitar'],
    [/gtr|guit|guitarra|\bgt\b/i, 'Electric Guitar'],
    [/rhodes|wurli|\bep\b|e[\s_-]?piano/i, 'Rhodes'],
    [/piano|\bpno\b|keys|teclado|\bkbd\b/i, 'Piano'],
    [/\bpad/i, 'Pad'],
    [/synth|\bsyn\b|\blead\b|arp|pluck/i, 'Synth'],
    [/string|cordas|violin|viol[ae]|cello/i, 'Strings'],
    [/brass|horn|trump|trompete|\bsax|trombon/i, 'Brass'],
    [/riser|sweep|uplift|whoosh/i, 'Risers'],
    [/impact|hit\b|boom|downlift/i, 'Impacts'],
    [/\bfx\b|sfx|efeito/i, 'FX'],
    [/amb|room|atmos/i, 'Ambience'],
    [/\bref\b|refer[eê]ncia|reference/i, 'Reference Track'],
  ];
  MM.nameRole = function (name) {
    const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ');
    // "Audio 12", "Track 3", "Untitled" etc. = nome genérico
    if (/^(audio|track|faixa|untitled|sem t[ií]tulo|stem|bounce|export)\s*\d*$/i.test(base.trim())) return null;
    for (const [re, role] of NAME_RULES) if (re.test(base)) return role;
    return null;
  };

  // ---------- cabeçalhos de ficheiro (sample rate original) ----------
  MM.parseHeader = function (ab) {
    try {
      const v = new DataView(ab);
      const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      if (tag(0) === 'RIFF' && tag(8) === 'WAVE') {
        let o = 12;
        while (o + 8 < v.byteLength) {
          const id = tag(o), sz = v.getUint32(o + 4, true);
          if (id === 'fmt ') return { format: 'WAV', channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
          o += 8 + sz + (sz & 1);
        }
      }
      if (tag(0) === 'FORM' && (tag(8) === 'AIFF' || tag(8) === 'AIFC')) {
        let o = 12;
        while (o + 8 < v.byteLength) {
          const id = tag(o), sz = v.getUint32(o + 4);
          if (id === 'COMM') {
            const ch = v.getUint16(o + 8), bits = v.getUint16(o + 14);
            const exp = v.getUint16(o + 16) & 0x7fff, mant = v.getUint32(o + 18);
            return { format: 'AIFF', channels: ch, bits, sampleRate: Math.round(mant * Math.pow(2, exp - 16383 - 31)) };
          }
          o += 8 + sz + (sz & 1);
        }
      }
      if (tag(0) === 'fLaC') {
        const b = new Uint8Array(ab, 18, 4);
        const sr = (b[0] << 12) | (b[1] << 4) | (b[2] >> 4);
        return { format: 'FLAC', sampleRate: sr, channels: ((b[2] >> 1) & 7) + 1, bits: (((b[2] & 1) << 4) | (b[3] >> 4)) + 1 };
      }
      if (tag(0).slice(0, 3) === 'ID3' || (v.getUint8(0) === 0xff && (v.getUint8(1) & 0xe0) === 0xe0)) return { format: 'MP3' };
    } catch (e) { /* ignore */ }
    return { format: 'Áudio' };
  };

  // ---------- features de um stem ----------
  const QUAL = { fast: { n: 4096, hop: 4096 }, balanced: { n: 2048, hop: 2048 }, max: { n: 2048, hop: 1024 } };

  MM.analyzeStem = async function (chs, sr, quality, onProgress) {
    const q = QUAL[quality] || QUAL.balanced;
    const x = D.mono(chs);
    const len = x.length;
    const peak = D.samplePeak(chs);
    const loud = D.loudness(chs, sr);
    const nb = loud.blockMs.length;
    const blockL = loud.blockMs.map((p) => -0.691 + 10 * Math.log10(p + 1e-20));
    const activeBlocks = blockL.filter((l) => l > -55).length;
    const silence = 1 - activeBlocks / Math.max(1, nb);
    // RMS em zonas ativas → crest factor
    let s2 = 0, cnt = 0;
    const blk = Math.round(sr * 0.1);
    for (let b = 0; b < nb; b++) if (blockL[b] > -55) { for (let i = b * blk; i < (b + 1) * blk; i++) s2 += x[i] * x[i]; cnt += blk; }
    const rmsActive = Math.sqrt(s2 / Math.max(1, cnt));
    const crest = D.lin2db(peak) - D.lin2db(rmsActive);

    // STFT
    const n = q.n, hop = q.hop;
    const bins31 = D.bandBins(n, sr, D.thirdOctEdges);
    const bins7 = D.bandBins(n, sr, D.bands7Edges);
    const avg = new Float64Array(n / 2 + 1);
    const b7 = new Float64Array(7);
    const tmp31 = new Float64Array(31), tmp7 = new Float64Array(7);
    const framesPerBlock = Math.max(1, Math.round((0.1 * sr) / hop));
    const nFrames = Math.max(1, Math.floor((len - n) / hop) + 1);
    const nBlk = Math.ceil(nFrames / framesPerBlock);
    const bandTL = new Float32Array(nBlk * 31); // energia por banda de terço de oitava, por bloco ~100 ms
    let prevLog = new Float64Array(31), flux = new Float32Array(nFrames);
    let centW = 0, centSum = 0, flatSum = 0, flatW = 0, totE = 0;
    const cents = new Float32Array(nFrames);
    await D.stft(x, sr, n, hop, (p, f) => {
      let e = 0, ce = 0;
      for (let k = 1; k < p.length; k++) { e += p[k]; ce += p[k] * (k * sr) / n; }
      if (e < 1e-12) { cents[f] = 0; return; }
      for (let k = 0; k < p.length; k++) avg[k] += p[k];
      totE += e;
      const c = ce / e; cents[f] = c;
      centSum += c * Math.sqrt(e); centW += Math.sqrt(e);
      // planura espectral 100 Hz – 10 kHz
      const k0 = Math.round((100 * n) / sr), k1 = Math.round((10000 * n) / sr);
      let lg = 0, ar = 0;
      for (let k = k0; k < k1; k++) { lg += Math.log(p[k] + 1e-20); ar += p[k]; }
      const m = k1 - k0;
      flatSum += (Math.exp(lg / m) / (ar / m + 1e-20)) * Math.sqrt(e); flatW += Math.sqrt(e);
      D.sumBands(p, bins31, tmp31);
      const bi = Math.floor(f / framesPerBlock);
      let fl = 0;
      for (let b = 0; b < 31; b++) {
        bandTL[bi * 31 + b] += tmp31[b] / framesPerBlock;
        const lgb = Math.log10(tmp31[b] + 1e-12);
        const d = lgb - prevLog[b]; if (d > 0) fl += d;
        prevLog[b] = lgb;
      }
      flux[f] = fl;
      D.sumBands(p, bins7, tmp7);
      for (let b = 0; b < 7; b++) b7[b] += tmp7[b];
    }, (p) => onProgress && onProgress(p * 0.8));
    const b7sum = b7.reduce((a, b) => a + b, 0) || 1;
    const bands = Array.from(b7).map((v) => v / b7sum);
    const centroid = centSum / Math.max(1e-9, centW);
    const flatness = flatSum / Math.max(1e-9, flatW);

    // percussividade: saltos de envolvente (dB por 5 ms) e taxa de onsets
    const envR = 200;
    const env = D.envelope(x, sr, 0.3, 15, envR);
    const envDb = Array.from(env, (v) => D.lin2db(v));
    let jumps = 0, jcount = 0, onsets = 0, lastOn = -99;
    const activeEnvMax = D.percentile(envDb.filter((v) => v > -60), 0.95);
    for (let i = 2; i < envDb.length; i++) {
      if (envDb[i] < activeEnvMax - 40) continue;
      const d = envDb[i] - envDb[i - 2];
      if (d > 0) { jumps += d; jcount++; }
      if (d > 9 && envDb[i] > activeEnvMax - 24 && i - lastOn > envR * 0.07) { onsets++; lastOn = i; }
    }
    const activeSec = Math.max(0.5, (activeBlocks * 0.1));
    const onsetRate = onsets / activeSec;
    // decaimento médio após onsets (quanto cai em 120 ms)
    let decSum = 0, decN = 0;
    for (let i = 2; i < envDb.length - 30; i++) {
      if (envDb[i] - envDb[i - 2] > 9 && envDb[i] > activeEnvMax - 24) { decSum += envDb[i + 2] - envDb[i + 24]; decN++; }
    }
    const decay = decN ? decSum / decN : 0; // dB
    const perc = D.clamp((decay - 4) / 16, 0, 1) * 0.6 + D.clamp((jumps / Math.max(1, jcount) - 1) / 5, 0, 1) * 0.4;

    // harmonicidade / f0 (autocorrelação normalizada em janelas ativas)
    const ds = 2, sr2 = sr / ds, W = 1024;
    const minLag = Math.floor(sr2 / 1000), maxLag = Math.floor(sr2 / 45);
    const cand = [];
    for (let b = 0; b < nb; b++) if (blockL[b] > loud.integrated - 6) cand.push(b);
    const pickN = Math.min(40, cand.length);
    let harmSum = 0, harmN = 0; const f0s = [];
    for (let k = 0; k < pickN; k++) {
      const b = cand[Math.floor((k * cand.length) / pickN)];
      const st = b * blk;
      if (st + W * ds >= len) continue;
      const w = new Float32Array(W);
      for (let i = 0; i < W; i++) w[i] = (x[st + i * ds] + x[st + i * ds + 1]) * 0.5;
      let e0 = 0; for (let i = 0; i < W; i++) e0 += w[i] * w[i];
      if (e0 < 1e-8) continue;
      let best = 0, bestLag = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0, e1 = 0, e2 = 0;
        for (let i = 0; i + lag < W; i++) { s += w[i] * w[i + lag]; e1 += w[i] * w[i]; e2 += w[i + lag] * w[i + lag]; }
        const r = s / Math.sqrt(e1 * e2 + 1e-20);
        if (r > best) { best = r; bestLag = lag; }
      }
      harmSum += best; harmN++;
      if (best > 0.6) f0s.push(sr2 / bestLag);
    }
    const harm = harmN ? harmSum / harmN : 0;
    const f0 = f0s.length ? D.median(f0s) : 0;
    // estéreo
    let corr = 1, width = 0, fakeMono = false;
    if (chs.length > 1) {
      corr = D.correlation(chs[0], chs[1]);
      width = D.width(chs[0], chs[1]);
      let md = 0; const a = chs[0], b = chs[1];
      for (let i = 0; i < a.length; i += 7) { const d = Math.abs(a[i] - b[i]); if (d > md) md = d; }
      fakeMono = md < peak * 1e-3;
    }
    // clipping no ficheiro original (≥3 amostras consecutivas no topo)
    let clips = 0;
    for (const c of chs) { let run = 0; for (let i = 0; i < c.length; i++) { if (Math.abs(c[i]) > 0.9995) { if (++run === 3) clips++; } else run = 0; } }
    // brilho ao longo do tempo (para riser)
    const cs = Array.from(cents).filter((v) => v > 0);
    const rising = cs.length > 20 ? D.percentile(cs, 0.9) / Math.max(1, D.percentile(cs, 0.1)) : 1;
    if (onProgress) onProgress(1);
    return {
      duration: len / sr, peak, peakDb: D.lin2db(peak), lufs: loud.integrated, lra: loud.lra, blockMs: loud.blockMs,
      rmsActiveDb: D.lin2db(rmsActive), crest, silence, centroid, flatness, bands, perc, onsetRate, decay, harm, f0,
      corr, width, fakeMono, clips, rising, channels: chs.length,
      envP95: activeEnvMax, envP50: D.percentile(envDb.filter((v) => v > -60), 0.5),
      bandTL, bandFrames: nBlk, bandBlockSec: (framesPerBlock * hop) / sr,
      spectrum: (() => {
        // espectro médio em 64 pontos log (dB relativos)
        const pts = 192, out = [];
        for (let i = 0; i < pts; i++) {
          const f = 20 * Math.pow(1000, i / (pts - 1));
          const a = Math.max(1, Math.floor((f / Math.pow(2, 1 / 12) * n) / sr)), bb = Math.max(a + 1, Math.ceil((f * Math.pow(2, 1 / 12) * n) / sr));
          let s = 0; for (let k = a; k < Math.min(bb, avg.length); k++) s += avg[k];
          out.push(D.pow2db(s / (totE || 1)));
        }
        return out;
      })(),
    };
  };

  // ---------- classificação ----------
  const near = (x, lo, hi, soft) => (x >= lo && x <= hi ? 1 : Math.exp(-Math.pow((x < lo ? lo - x : x - hi) / soft, 2)));
  function audioScores(f) {
    const [sub, low, lowmid, mid, pres, bright, air] = f.bands;
    const lows = sub + low, highs = bright + air;
    const c = f.centroid, P = f.perc, H = f.harm, sil = f.silence;
    const sustained = 1 - P;
    const vocalF0 = f.f0 ? near(f.f0, 85, 900, 60) : 0.4;
    const s = {};
    s.Kick = P * near(lows, 0.55, 1, 0.15) * near(c, 30, 450, 250);
    s['Sub Bass'] = sustained * near(sub, 0.45, 1, 0.15) * near(H, 0.5, 1, 0.3);
    s.Bass = near(lows, 0.5, 1, 0.15) * near(c, 30, 400, 250) * near(H, 0.55, 1, 0.25) * (0.4 + 0.6 * near(P, 0, 0.55, 0.25));
    s.Snare = P * near(mid + pres + lowmid, 0.45, 1, 0.2) * near(c, 700, 4500, 900) * near(H, 0, 0.6, 0.25) * near(f.onsetRate, 0.5, 4.5, 2);
    s.Clap = s.Snare * near(c, 1500, 5000, 900) * 0.95;
    s['Hi-Hat'] = near(P, 0.35, 1, 0.25) * near(highs, 0.45, 1, 0.2) * near(c, 5000, 16000, 2000);
    s.Shaker = s['Hi-Hat'] * near(f.onsetRate, 5, 20, 2) * 0.95;
    s.Percussion = near(P, 0.5, 1, 0.25) * near(c, 150, 2500, 500) * near(lows, 0, 0.55, 0.15) * near(f.onsetRate, 1.5, 12, 2);
    s.Congas = s.Percussion * 0.9;
    s['Drum Loop'] = P * near(lows, 0.25, 0.7, 0.2) * near(highs, 0.12, 0.6, 0.15) * near(f.onsetRate, 3, 20, 3) * 0.95;
    s['Lead Vocal'] = near(H, 0.6, 1, 0.25) * vocalF0 * near(c, 500, 3500, 600) * near(lows, 0, 0.3, 0.12) * near(sil, 0.08, 0.75, 0.2) * (0.5 + 0.5 * near(f.width, 0, 0.15, 0.1));
    s['Backing Vocal'] = s['Lead Vocal'] * (near(sil, 0.4, 0.95, 0.2) * 0.75 + 0.25) * 0.97;
    s.Choir = s['Backing Vocal'] * near(f.width, 0.2, 2, 0.15) * 0.9;
    s.Adlibs = near(H, 0.5, 1, 0.3) * vocalF0 * near(c, 500, 4000, 700) * near(sil, 0.75, 0.97, 0.08);
    s.Piano = near(H, 0.55, 1, 0.25) * near(P, 0.2, 0.75, 0.2) * near(c, 300, 2500, 600) * near(sil, 0, 0.6, 0.25) * near(mid + pres, 0.15, 1, 0.1);
    s.Rhodes = s.Piano * near(c, 200, 1500, 400) * 0.9;
    s['Electric Guitar'] = near(H, 0.5, 1, 0.25) * near(P, 0.2, 0.8, 0.25) * near(c, 900, 5000, 900) * near(lows, 0, 0.2, 0.1);
    s['Acoustic Guitar'] = s['Electric Guitar'] * near(highs, 0.08, 0.5, 0.1) * 0.95;
    s.Pad = near(P, 0, 0.25, 0.15) * near(H, 0.45, 1, 0.3) * near(sil, 0, 0.35, 0.2) * near(c, 200, 2500, 700) * near(f.onsetRate, 0, 2, 1.5);
    s.Strings = s.Pad * 0.85;
    s.Synth = near(H, 0.5, 1, 0.3) * near(c, 1200, 6000, 1000) * near(P, 0, 0.6, 0.25) * 0.85;
    s.Brass = s.Synth * 0.7;
    s.Risers = near(sil, 0.6, 1, 0.15) * near(f.rising, 2, 50, 1);
    s.FX = near(sil, 0.75, 1, 0.12) * near(H, 0, 0.7, 0.3);
    s.Impacts = near(sil, 0.85, 1, 0.1) * P;
    s.Ambience = near(P, 0, 0.2, 0.15) * near(H, 0, 0.45, 0.2) * near(f.flatness, 0.15, 1, 0.1);
    s['Reference Track'] = near(lows, 0.25, 0.6, 0.2) * near(highs, 0.05, 0.4, 0.1) * near(sil, 0, 0.05, 0.05) * near(f.lufs, -12, -4, 3) * 0.9;
    return s;
  }

  MM.classify = function (name, f) {
    const scores = audioScores(f);
    const nameR = MM.nameRole(name);
    if (nameR !== 'Reference Track') delete scores['Reference Track']; // só é referência se o nome o disser
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [bestA, bestS] = ranked[0];
    const second = ranked.find(([r]) => MM.ROLES[r].fam !== MM.ROLES[bestA].fam) || ranked[1];
    const notes = [];
    let role, conf;
    if (nameR) {
      const fam = MM.ROLES[nameR].fam;
      const famScore = Math.max(...Object.entries(scores).filter(([r]) => MM.ROLES[r].fam === fam).map(([, v]) => v));
      if (famScore >= 0.18 || bestS < 0.35 || MM.ROLES[bestA].fam === fam) {
        role = nameR;
        conf = 0.84 + 0.15 * D.clamp(famScore / Math.max(bestS, 1e-3), 0, 1);
      } else {
        role = bestA;
        conf = 0.5 + 0.25 * D.clamp(bestS - famScore, 0, 1);
        notes.push({ type: 'warn', text: `O nome diz “${nameR}”, o áudio parece ${MM.ROLES[bestA].pt} — rever` });
      }
    } else {
      role = bestA;
      const margin = bestS - (second ? second[1] : 0);
      conf = D.clamp(0.55 + 0.35 * D.clamp(margin * 2, 0, 1) + 0.1 * bestS, 0.5, 0.86);
      notes.push({ type: 'warn', text: 'Nome genérico: identificado só pelo áudio' });
    }
    // refinamentos de família pelo áudio
    if (role === 'Bass' && f.bands[0] > 0.5 && !/bass|baixo/i.test(name)) role = 'Sub Bass';
    if (role === 'Lead Vocal' && f.silence > 0.82 && !nameR) role = 'Adlibs';
    const alts = ranked.filter(([r]) => r !== role).slice(0, 3).map(([r, v]) => ({ role: r, score: v }));
    return { role, conf: D.clamp(conf, 0.5, 0.99), notes, alts, nameRole: nameR, scores };
  };

  // ---------- problemas de importação ----------
  MM.detectImportIssues = function (stems, projectSR) {
    const issues = [];
    const base = (n) => n.replace(/\.[a-z0-9]+$/i, '');
    const pairRe = /^(.*?)[\s_\-.]?(l|r|left|right|esq|dir)$/i;
    const byBase = {};
    stems.forEach((s) => {
      const m = base(s.name).match(pairRe);
      if (m && m[1]) {
        const side = /^(l|left|esq)$/i.test(m[2]) ? 'L' : 'R';
        (byBase[m[1].toLowerCase()] = byBase[m[1].toLowerCase()] || {})[side] = s;
      }
    });
    Object.values(byBase).forEach((p) => {
      if (p.L && p.R) {
        p.L.pair = p.R.id; p.R.pair = p.L.id;
        p.L.pairSide = 'L'; p.R.pairSide = 'R';
        const dl = Math.abs(p.L.length - p.R.length) / projectSR;
        p.L.notes.push({ type: 'info', text: `Par L/R detetado com ${p.R.name.replace(/\.[a-z0-9]+$/i, '')}` });
        if (dl > 0.001) {
          issues.push({ id: 'len-' + p.L.id, stem: p.L.id, kind: 'CANAL ÚNICO', title: p.L.name,
            text: `Parece um stem estéreo dividido. ${p.R.name} tem comprimento diferente (${(p.R.length > p.L.length ? '+' : '−')}${Math.round(dl * 1000)} ms).`,
            actions: [['align', 'Alinhar'], ['ignore', 'Ignorar']] });
        }
      }
    });
    stems.forEach((s) => {
      const h = s.header || {};
      if (h.sampleRate && h.sampleRate !== projectSR) {
        issues.push({ id: 'sr-' + s.id, stem: s.id, kind: 'SAMPLE RATE', title: s.name,
          text: `${(h.sampleRate / 1000).toString().replace('.', ',')} kHz num projeto de ${(projectSR / 1000).toString().replace('.', ',')} kHz. A conversão de alta qualidade do browser já foi aplicada.`,
          actions: [['convert', 'Converter'], ['ignore', 'Ignorar']] });
      }
      if (s.features.silence > 0.93 && !['Adlibs', 'FX', 'Risers', 'Impacts'].includes(s.role)) {
        const firstActive = s.features.blockMs.findIndex((p) => -0.691 + 10 * Math.log10(p + 1e-20) > -55);
        issues.push({ id: 'sil-' + s.id, stem: s.id, kind: 'SILÊNCIO', title: s.name,
          text: `${Math.round(s.features.silence * 100)} % silêncio${firstActive >= 0 ? `, com sinal a partir de ${D.fmtTime(firstActive / 10).slice(0, 5)}` : ''}. Pode ser um stem de FX.`,
          actions: [['keepfx', 'Manter como FX'], ['remove', 'Remover']] });
      }
      if (s.features.clips > 0) {
        issues.push({ id: 'clip-' + s.id, stem: s.id, kind: 'CLIPPING', title: s.name,
          text: `${s.features.clips} zona(s) com clipping no ficheiro original. A IA não consegue recuperar o que já está cortado — considera pedir um novo bounce.`,
          actions: [['ignore', 'Entendido']] });
      }
      if (s.features.fakeMono) s.notes.push({ type: 'info', text: 'Mono falso (L = R) — tratado como mono' });
    });
    return issues;
  };

  // ---------- análise musical ----------
  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const PC = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const PC_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const pearson = (a, b) => {
    const ma = D.mean(a), mb = D.mean(b);
    let s = 0, x = 0, y = 0;
    for (let i = 0; i < a.length; i++) { s += (a[i] - ma) * (b[i] - mb); x += (a[i] - ma) ** 2; y += (b[i] - mb) ** 2; }
    return s / Math.sqrt(x * y + 1e-20);
  };

  MM.analyzeMusic = async function (stems, sr, onProgress) {
    const len = Math.max(...stems.map((s) => s.length));
    const drumRoles = new Set(['kick', 'snare', 'hat', 'perc', 'loop']);
    const sumOf = (filter) => {
      const out = new Float32Array(len);
      let any = false;
      stems.forEach((s) => {
        if (!filter(s)) return;
        any = true;
        const m = D.mono(s.chs);
        const g = D.db2lin(-20 - Math.max(-60, s.features.lufs)); // nivelar
        for (let i = 0; i < m.length; i++) out[i] += m[i] * g;
      });
      return any ? out : null;
    };
    const drumSum = sumOf((s) => drumRoles.has(MM.ROLES[s.role].fam)) || sumOf(() => true);
    // ---- BPM por autocorrelação do fluxo espectral ----
    const n = 1024, hop = 512, fr = sr / hop;
    const oenv = [];
    let prev = null;
    const bins = D.bandBins(n, sr, D.thirdOctEdges);
    const tb = new Float64Array(31);
    await D.stft(drumSum, sr, n, hop, (p) => {
      D.sumBands(p, bins, tb);
      let fl = 0;
      const cur = Array.from(tb, (v) => Math.log10(v + 1e-10));
      if (prev) for (let b = 0; b < 31; b++) { const d = cur[b] - prev[b]; if (d > 0) fl += d; }
      prev = cur; oenv.push(fl);
    }, (p) => onProgress && onProgress(p * 0.5));
    // remover tendência
    const mEnv = D.mean(oenv);
    const o = oenv.map((v) => Math.max(0, v - mEnv));
    const minLag = Math.floor((fr * 60) / 200), maxLag = Math.ceil((fr * 60) / 55);
    const acf = new Float64Array(maxLag * 4 + 2);
    for (let lag = minLag; lag < acf.length; lag++) {
      let s = 0; for (let i = 0; i + lag < o.length; i++) s += o[i] * o[i + lag];
      acf[lag] = s / (o.length - lag);
    }
    const acfAt = (l) => { const i = Math.floor(l), t = l - i; return acf[i] * (1 - t) + (acf[i + 1] || 0) * t; };
    let best = 0, bestLag = minLag;
    for (let lag = minLag; lag <= maxLag; lag += 0.25) {
      const bpm = (fr * 60) / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 0.6, 2));
      const comb = acfAt(lag) + 0.5 * acfAt(lag * 2) + 0.33 * acfAt(lag * 4) + 0.25 * acfAt(lag * 3);
      const sc = comb * prior;
      if (sc > best) { best = sc; bestLag = lag; }
    }
    let bpm = (fr * 60) / bestLag;
    if (Math.abs(bpm - Math.round(bpm)) < 0.35) bpm = Math.round(bpm);
    else bpm = Math.round(bpm * 2) / 2;
    const bpmConf = D.clamp(best / (Math.max(...acf.slice(minLag, maxLag + 1)) * 1.0 + 1e-12), 0.5, 0.98);
    // ---- fase da batida e primeiro tempo forte ----
    const beatF = (fr * 60) / bpm;
    let bestPh = 0, bestPs = -1;
    for (let ph = 0; ph < beatF; ph += 0.5) {
      let s = 0; for (let t = ph; t < o.length; t += beatF) s += o[Math.round(t)] || 0;
      if (s > bestPs) { bestPs = s; bestPh = ph; }
    }
    const kick = stems.find((s) => MM.ROLES[s.role].fam === 'kick') || stems.find((s) => MM.ROLES[s.role].fam === 'bass');
    let downbeat = bestPh / fr;
    if (kick) {
      const kb = kick.features.blockMs; // 100 ms
      let bestS = -1, bestK = 0;
      for (let k = 0; k < 4; k++) {
        let s = 0;
        for (let t = downbeat + (k * 60) / bpm; t * 10 < kb.length; t += (240) / bpm) s += kb[Math.round(t * 10)] || 0;
        if (s > bestS) { bestS = s; bestK = k; }
      }
      downbeat += (bestK * 60) / bpm;
    }
    while (downbeat - 240 / bpm >= -0.05) downbeat -= 240 / bpm;
    if (downbeat < -0.05) downbeat += 240 / bpm;
    downbeat = Math.max(0, downbeat);
    if (onProgress) onProgress(0.6);

    // ---- tonalidade (cromagrama dos stems harmónicos) ----
    const harmSum = sumOf((s) => !drumRoles.has(MM.ROLES[s.role].fam) && MM.ROLES[s.role].fam !== 'fx') || sumOf(() => true);
    const chroma = new Float64Array(12);
    const kn = 8192;
    await D.stft(harmSum, sr, kn, kn, (p) => {
      for (let k = Math.round((55 * kn) / sr); k < Math.round((2000 * kn) / sr); k++) {
        const f = (k * sr) / kn;
        const pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12;
        chroma[pc] += Math.sqrt(p[k]);
      }
    });
    let bestKey = { r: -2 };
    const keyScores = [];
    for (let t = 0; t < 12; t++) {
      const rot = (prof) => prof.map((_, i) => prof[(i - t + 12) % 12]);
      const rM = pearson(Array.from(chroma), rot(KS_MAJ)), rm = pearson(Array.from(chroma), rot(KS_MIN));
      keyScores.push([t, 'maior', rM], [t, 'menor', rm]);
      if (rM > bestKey.r) bestKey = { r: rM, tonic: t, mode: 'maior' };
      if (rm > bestKey.r) bestKey = { r: rm, tonic: t, mode: 'menor' };
    }
    keyScores.sort((a, b) => b[2] - a[2]);
    // desambiguação relativa maior/menor: a tónica costuma soar no grave no início das frases
    {
      const rel = bestKey.mode === 'maior' ? { tonic: (bestKey.tonic + 9) % 12, mode: 'menor' } : { tonic: (bestKey.tonic + 3) % 12, mode: 'maior' };
      const relScore = keyScores.find((k) => k[0] === rel.tonic && k[1] === rel.mode)[2];
      if (bestKey.r - relScore < 0.3) {
        const low = stems.filter((s) => MM.ROLES[s.role].fam === 'bass');
        const src = low.length ? D.mono(low[0].chs) : harmSum;
        const lc = new Float64Array(12);
        const barS = 240 / bpm;
        for (let t = downbeat; t * sr + 8192 < src.length; t += barS * 4) {
          const p = D.powerSpectrum(src, Math.round(t * sr), 8192);
          for (let k = Math.round((35 * 8192) / sr); k < Math.round((400 * 8192) / sr); k++) {
            const f = (k * sr) / 8192, pc = ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12;
            lc[pc] += p[k];
          }
        }
        if (lc[rel.tonic] > lc[bestKey.tonic] * 1.15) bestKey = { r: relScore, tonic: rel.tonic, mode: rel.mode };
      }
    }
    const keyConf = D.clamp(0.55 + (keyScores[0][2] - keyScores[1][2]) * 3 + keyScores[0][2] * 0.3, 0.5, 0.97);
    const names = bestKey.mode === 'menor' || [6, 1, 8, 3, 10].includes(bestKey.tonic) ? PC_SHARP : PC;
    const keyName = names[bestKey.tonic] + ' ' + bestKey.mode;
    if (onProgress) onProgress(0.75);

    // ---- estrutura ----
    const barSec = 240 / bpm;
    const nBars = Math.max(1, Math.floor((len / sr - downbeat) / barSec));
    const barLoud = (blockMs, b) => D.loudnessRange(blockMs, downbeat + b * barSec, downbeat + (b + 1) * barSec);
    const total = [];
    const active = [];
    const vocalStem = stems.find((s) => s.role === 'Lead Vocal') || stems.find((s) => MM.ROLES[s.role].fam === 'vocal');
    const vocal = [];
    // soma de blocos (potência) de todos os stems normalizados
    for (let b = 0; b < nBars; b++) {
      let p = 0; const act = [];
      stems.forEach((s) => {
        const l = barLoud(s.features.blockMs, b);
        act.push(l > s.features.lufs - 14 && l > -50 ? 1 : 0);
        p += Math.pow(10, (l - s.features.lufs) / 10) * (MM.ROLES[s.role].fam === 'fx' ? 0.2 : 1);
      });
      total.push(10 * Math.log10(p + 1e-9));
      active.push(act);
      vocal.push(vocalStem ? (barLoud(vocalStem.features.blockMs, b) > vocalStem.features.lufs - 12 ? 1 : 0) : 0);
    }
    // fronteiras candidatas a cada 4 compassos
    const bounds = [0];
    for (let b = 4; b < nBars; b += 4) {
      const prevA = active.slice(b - 4, b), nextA = active.slice(b, b + 4);
      const avgVec = (rows) => rows[0].map((_, j) => D.mean(rows.map((r) => r[j])));
      const pa = avgVec(prevA), na = avgVec(nextA);
      let ham = 0; for (let j = 0; j < pa.length; j++) ham += Math.abs(pa[j] - na[j]);
      const de = Math.abs(D.mean(total.slice(b - 4, b)) - D.mean(total.slice(b, b + 4)));
      const dv = Math.abs(D.mean(vocal.slice(b - 4, b)) - D.mean(vocal.slice(b, b + 4)));
      if (ham >= 0.99 || de > 1.5 || dv > 0.5) bounds.push(b);
    }
    bounds.push(nBars);
    // fundir secções > 8 compassos? manter; dividir secções muito longas (> 16) a cada 8
    const segs = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      let a = bounds[i];
      const b = bounds[i + 1];
      while (b - a > 16) { segs.push([a, a + 8]); a += 8; }
      segs.push([a, b]);
    }
    const info = segs.map(([a, b]) => ({ a, b, E: D.mean(total.slice(a, b)), V: D.mean(vocal.slice(a, b)), N: D.mean(active.slice(a, b).map((r) => r.reduce((x, y) => x + y, 0))) }));
    const Es = info.map((s) => s.E);
    const maxE = Math.max(...Es), medE = D.median(Es);
    info.forEach((s, i) => {
      s.name = null;
      if (s.V > 0.3 && s.E >= maxE - 1.8) s.name = 'Refrão';
    });
    // um bloco curto antes de um refrão longo e mais forte é um pré-refrão
    info.forEach((s, i) => {
      const nx = info[i + 1];
      if (s.name === 'Refrão' && s.b - s.a <= 4 && nx && nx.name === 'Refrão' && nx.b - nx.a >= 8 && s.E < nx.E - 0.4) s.name = 'Pré';
    });
    const lastCh = info.map((s) => s.name).lastIndexOf('Refrão');
    if (lastCh > 0 && info.filter((s) => s.name === 'Refrão').length > 1) info[lastCh].name = 'Refrão final';
    let verse = 0;
    info.forEach((s, i) => {
      if (s.name) return;
      const nxt = info[i + 1];
      if (i === 0 && (s.V < 0.3 || s.E < medE - 1)) s.name = 'Intro';
      else if (i === info.length - 1 && (s.E < medE || s.V < 0.3)) s.name = 'Outro';
      else if (s.V >= 0.3 && nxt && /Refrão/.test(nxt.name || '') && s.b - s.a <= 4 && i > 0 && (s.E > info[i - 1].E + 0.5 || s.N > info[i - 1].N + 0.5)) s.name = 'Pré';
      else if (s.V >= 0.3) s.name = 'Verso ' + ++verse;
      else s.name = info.slice(0, i).some((x) => /Refrão/.test(x.name || '')) ? 'Bridge' : 'Intro';
    });
    if (verse === 1) info.forEach((s) => { if (s.name === 'Verso 1') s.name = 'Verso'; });
    // fundir secções consecutivas com o mesmo nome
    const sections = [];
    info.forEach((s) => {
      const last = sections[sections.length - 1];
      if (last && last.name === s.name) { last.endBar = s.b; last.end = downbeat + s.b * barSec; }
      else sections.push({ name: s.name, startBar: s.a, endBar: s.b, start: downbeat + s.a * barSec, end: downbeat + s.b * barSec, energy: s.E });
    });
    if (sections.length) { sections[0].start = 0; sections[sections.length - 1].end = len / sr; }
    if (onProgress) onProgress(0.9);

    // ---- género (heurística: andamento + instrumentação + espectro) ----
    const fams = stems.map((s) => MM.ROLES[s.role].fam);
    const has = (f) => fams.includes(f);
    const inR = (lo, hi) => near(bpm, lo, hi, 4);
    const bassPerc = stems.filter((s) => MM.ROLES[s.role].fam === 'bass').some((s) => s.features.perc > 0.45);
    const shaker = stems.some((s) => s.role === 'Shaker' || (s.role === 'Hi-Hat' && s.features.onsetRate > 5));
    const guitars = fams.filter((f) => f === 'guitar').length;
    const gs = {
      Kizomba: inR(84, 100) * (has('kick') ? 1 : 0.4) * (has('bass') ? 1 : 0.5) * (has('vocal') ? 1 : 0.6),
      Semba: inR(100, 126) * (guitars ? 1 : 0.5) * (has('perc') ? 1 : 0.6) * 0.85,
      Kuduro: inR(128, 146) * (has('kick') ? 1 : 0.3) * 0.85,
      Afrobeat: inR(96, 116) * (has('perc') ? 1 : 0.5) * (shaker ? 1 : 0.7) * 0.85,
      Amapiano: inR(108, 118) * (bassPerc ? 1 : 0.35) * (shaker ? 1 : 0.6),
      'R&B': (inR(60, 80) + inR(85, 100) * 0.5) * (has('vocal') ? 1 : 0.3) * 0.75,
      Pop: inR(98, 130) * (has('vocal') ? 1 : 0.4) * 0.7,
      'Hip-Hop': inR(80, 98) * (has('kick') ? 1 : 0.4) * (guitars ? 0.6 : 1) * 0.72,
      Trap: (inR(130, 160) + inR(65, 80)) * (has('bass') ? 1 : 0.5) * 0.75,
      Reggaeton: inR(88, 102) * (has('snare') ? 1 : 0.5) * 0.7,
      House: inR(118, 128) * (has('kick') ? 1 : 0.3) * 0.8,
      Techno: inR(126, 140) * (has('kick') ? 1 : 0.3) * (has('vocal') ? 0.5 : 1) * 0.75,
      Rock: inR(100, 170) * (guitars >= 2 ? 1 : 0.3) * (has('snare') ? 1 : 0.5) * 0.75,
      Gospel: inR(65, 120) * (fams.includes('keys') ? 1 : 0.5) * (stems.some((s) => s.role === 'Choir') ? 1 : 0.4) * 0.6,
      Jazz: inR(80, 200) * (has('kick') ? 0.4 : 1) * (fams.includes('keys') ? 1 : 0.5) * 0.5,
      Acoustic: (has('kick') ? 0.2 : 1) * (stems.some((s) => s.role === 'Acoustic Guitar') ? 1 : 0.5) * 0.6,
      EDM: inR(124, 132) * (stems.some((s) => /Synth|Risers/.test(s.role)) ? 1 : 0.4) * 0.75,
    };
    const gRank = Object.entries(gs).sort((a, b) => b[1] - a[1]);
    const genre = gRank[0][0];
    const genreConf = D.clamp(0.5 + (gRank[0][1] - gRank[1][1]) * 0.8 + gRank[0][1] * 0.15, 0.5, 0.9);
    if (onProgress) onProgress(1);
    return {
      bpm, bpmConf, downbeat, key: keyName, tonic: bestKey.tonic, mode: bestKey.mode, keyConf, meter: '4/4',
      sections, bars: nBars, barSec, genre, genreConf, genreAlts: gRank.slice(1, 4).map((g) => g[0]),
      energyPerBar: total, vocalPerBar: vocal, duration: len / sr,
    };
  };
})();
