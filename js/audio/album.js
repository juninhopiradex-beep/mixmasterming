/* MIXMIND — Modo álbum / EP
 * Sequência de masters com pausas, fades e ganho; loudness coerente entre faixas;
 * exportação de masters individuais com metadados, WAV 16-bit/44,1 kHz + CUE e imagem DDP 2.0 para fábrica de CD.
 *
 * DDP: o formato é licenciado pela DCA; os campos usados (DDPID, DDPMS, PQDESCR) seguem a disposição pública
 * verificada byte a byte por ferramentas de mastering abertas. Confirma sempre o DDP num leitor (ex.: HOFA DDP Player)
 * antes de o enviar para a fábrica. */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const A = (MM.album = {});
  const FPS = 588, BPS = 2352, SPS = 75, PREGAP = 150; // frames por setor, bytes por setor, setores por segundo, pregap de 2 s
  A.CD = { FPS, BPS, SPS, PREGAP, MAX_TRACKS: 99, MIN_TRACK_SEC: 4, MAX_SEC: 79 * 60 + 57 };

  // ---------- persistência (IndexedDB próprio) ----------
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('mixmind-albums', 1); r.onupgradeneeded = () => r.result.createObjectStore('albums', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('albums', mode); const out = fn(t.objectStore('albums')); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
  A.list = async () => { try { const all = await tx('readonly', (s) => s.getAll()); return (all || []).map((a) => ({ id: a.id, name: a.name, n: a.tracks.length, updated: a.updated })).sort((x, y) => y.updated - x.updated); } catch (e) { return []; } };
  A.get = (id) => tx('readonly', (s) => s.get(id));
  A.save = (al) => { al.updated = Date.now(); return tx('readwrite', (s) => s.put(al)); };
  A.remove = (id) => tx('readwrite', (s) => s.delete(id));
  A.create = (name) => ({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || 'Novo álbum', artist: '', upc: '', year: String(new Date().getFullYear()), label: '', copyright: '', genre: '', target: null, ceiling: -1, tracks: [], updated: Date.now() });

  // ---------- faixas ----------
  A.addTrack = async function (al, buf, info) {
    info = info || {};
    const chs = D.channelsOf(buf).slice(0, 2).map((x) => Float32Array.from(x));
    if (chs.length === 1) chs.push(Float32Array.from(chs[0]));
    const t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      title: info.title || 'Faixa ' + (al.tracks.length + 1), artist: info.artist || al.artist || '', isrc: info.isrc || '', composer: info.composer || '',
      gain: 0, intent: 0, gapAfter: 2, fadeIn: 0, fadeOut: 0, sr: buf.sampleRate, chs, duration: buf.duration, source: info.source || '',
    };
    t.metrics = await A.measure(t);
    al.tracks.push(t);
    return t;
  };
  A.measure = async function (t) {
    const m = await MM.measure({ getChannelData: (c) => t.chs[c], numberOfChannels: 2, sampleRate: t.sr, channels: t.chs });
    return { lufs: m.lufs, tp: m.tp, lra: m.lra, plr: m.plr, stMax: m.stMax, bands7: m.bands7, head: m.head, tail: m.tail };
  };
  A.move = (al, i, d) => { const j = i + d; if (j < 0 || j >= al.tracks.length) return; const t = al.tracks; [t[i], t[j]] = [t[j], t[i]]; };

  /**
   * Loudness do álbum: cada faixa vai para o alvo (+ a intenção: ex. −2 LU numa balada),
   * limitado para o true peak nunca passar o ceiling. Devolve as faixas que ficaram limitadas.
   */
  A.matchLoudness = function (al) {
    const L = al.tracks.map((t) => t.metrics.lufs).filter(isFinite).sort((a, b) => a - b);
    if (!L.length) return [];
    const target = al.target !== null && al.target !== undefined ? al.target : +L[Math.floor(L.length / 2)].toFixed(1);
    const limited = [];
    al.tracks.forEach((t) => {
      let g = target + (t.intent || 0) - t.metrics.lufs;
      const maxG = al.ceiling - t.metrics.tp;
      if (g > maxG + 0.01) { limited.push({ t, want: g, got: maxG }); g = maxG; }
      t.gain = +g.toFixed(2);
    });
    al.appliedTarget = target;
    return limited;
  };
  A.effLufs = (t) => t.metrics.lufs + (t.gain || 0);
  A.effTp = (t) => t.metrics.tp + (t.gain || 0);

  /** Junta as faixas (ganho, fades, pausas) num único sinal a `sr`. Para CD cada faixa+pausa é alinhada ao setor. */
  A.render = async function (al, sr, opts) {
    opts = opts || {};
    const parts = [], marks = [];
    let total = 0;
    for (let i = 0; i < al.tracks.length; i++) {
      const t = al.tracks[i];
      let chs = t.chs;
      if (t.sr !== sr) { const b = await MM.resample(MM.toAudioBuffer(t.chs, t.sr), sr); chs = D.channelsOf(b); }
      const g = D.db2lin(t.gain || 0), n = chs[0].length;
      const fi = Math.round((t.fadeIn || 0) * sr), fo = Math.round((t.fadeOut || 0) * sr);
      const gapN = i < al.tracks.length - 1 ? Math.round((t.gapAfter || 0) * sr) : 0;
      let len = n + gapN;
      if (opts.cd) len = Math.ceil(len / FPS) * FPS;
      const L = new Float32Array(len), R = new Float32Array(len);
      for (let k = 0; k < n; k++) {
        let e = g;
        if (k < fi) e *= Math.sin((k / fi) * Math.PI / 2) ** 2;
        if (k > n - fo) e *= Math.sin(((n - k) / fo) * Math.PI / 2) ** 2;
        L[k] = chs[0][k] * e; R[k] = chs[1][k] * e;
      }
      marks.push({ track: i + 1, start: total, audio: n, length: len });
      parts.push([L, R]); total += len;
      await D.yieldUI();
    }
    const L = new Float32Array(total), R = new Float32Array(total);
    let o = 0; parts.forEach(([a, b]) => { L.set(a, o); R.set(b, o); o += a.length; });
    return { chs: [L, R], sr, marks, total };
  };

  const pad2 = (n) => String(n).padStart(2, '0');
  const msf = (frames) => { const sec = Math.floor(frames / SPS); return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}:${pad2(frames % SPS)}`; };
  A.msf = msf;
  /** CUE sheet para o WAV do álbum (CD-DA). */
  A.cue = function (al, rendered, fileName) {
    const q = (s) => '"' + String(s || '').replace(/"/g, "'") + '"';
    let out = '';
    if (al.upc && MM.delivery.validEAN(al.upc)) out += `CATALOG ${String(al.upc).replace(/\D/g, '').padStart(13, '0')}\r\n`;
    out += `PERFORMER ${q(al.artist)}\r\nTITLE ${q(al.name)}\r\nFILE ${q(fileName)} WAVE\r\n`;
    rendered.marks.forEach((m, i) => {
      const t = al.tracks[i];
      out += `  TRACK ${pad2(i + 1)} AUDIO\r\n    TITLE ${q(t.title)}\r\n    PERFORMER ${q(t.artist || al.artist)}\r\n`;
      if (t.isrc && MM.delivery.validISRC(t.isrc)) out += `    ISRC ${MM.delivery.normISRC(t.isrc)}\r\n`;
      out += `    INDEX 01 ${msf(Math.round(m.start / FPS))}\r\n`;
    });
    return out;
  };
  /** WAV 16-bit (TPDF) a partir do álbum renderizado a 44,1 kHz. */
  A.pcm16 = function (rendered) {
    const n = rendered.total, out = new Uint8Array(n * 4), v = new DataView(out.buffer);
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const [L, R] = rendered.chs;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        let x = (c ? R[i] : L[i]) * 32767 + rnd() - rnd();
        x = Math.round(x); x = x > 32767 ? 32767 : x < -32768 ? -32768 : x;
        v.setInt16(i * 4 + c * 2, x, true);
      }
    }
    return out;
  };

  // ---------- DDP 2.0 ----------
  const ascii = (len) => new Uint8Array(len).fill(32);
  const put = (buf, off, width, str) => { const s = String(str); if (s.length > width) throw new Error(`campo DDP demasiado longo: “${s}”`); for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i) & 255; };
  const msfDigits = (sec) => msf(sec).replace(/:/g, '');
  A.ddpChecks = function (al, rendered) {
    const errs = [], warns = [];
    if (!al.tracks.length) errs.push('O álbum não tem faixas.');
    if (al.tracks.length > 99) errs.push('Máximo de 99 faixas num CD.');
    const totalSec = PREGAP / SPS + rendered.total / 44100;
    if (totalSec > A.CD.MAX_SEC) errs.push(`Duração total ${msf(Math.round(totalSec * SPS))} excede 79:57.`);
    rendered.marks.forEach((m, i) => { if (m.length / 44100 < 4) errs.push(`Faixa ${i + 1} tem menos de 4 s (mínimo Red Book).`); });
    al.tracks.forEach((t, i) => { if (t.isrc && !MM.delivery.validISRC(t.isrc)) errs.push(`Faixa ${i + 1}: ISRC inválido.`); if (!t.isrc) warns.push(`Faixa ${i + 1} sem ISRC.`); if (A.effTp(t) > -0.1) warns.push(`Faixa ${i + 1}: true peak ${D.fmtNum(A.effTp(t))} dBTP (a conversão a 16 bits pode criar overs).`); });
    if (al.upc && !MM.delivery.validEAN(al.upc)) errs.push('UPC/EAN inválido.');
    return { errs, warns };
  };
  /** Gera a imagem DDP: DDPID, DDPMS, PQDESCR, IMAGE.DAT, CHECKSUM.MD5 e PQ.txt. */
  A.ddp = function (al, rendered) {
    if (rendered.sr !== 44100) throw new Error('DDP exige 44,1 kHz');
    const chk = A.ddpChecks(al, rendered);
    if (chk.errs.length) throw new Error(chk.errs.join(' '));
    const upc = al.upc ? String(al.upc).replace(/\D/g, '').padStart(13, '0') : '';
    // IMAGE.DAT: 150 setores de silêncio + programa (16-bit LE estéreo), alinhado ao setor
    const pcm = A.pcm16(rendered);
    const image = new Uint8Array(PREGAP * BPS + pcm.length);
    image.set(pcm, PREGAP * BPS);
    const imageSectors = image.length / BPS;
    // PQDESCR (64 bytes por entrada)
    const pq = [];
    const entry = (track, index, sector, isrc, cat) => { const r = ascii(64); put(r, 0, 4, 'VVVS'); put(r, 4, 2, track); put(r, 6, 2, index); put(r, 10, 6, msfDigits(sector)); put(r, 16, 2, '01'); if (isrc) put(r, 20, 12, isrc); if (cat) put(r, 32, 13, cat); pq.push(r); };
    entry('00', '00', 0, '', upc);
    const starts = rendered.marks.map((m) => PREGAP + m.start / FPS);
    al.tracks.forEach((t, i) => {
      const isrc = t.isrc ? MM.delivery.normISRC(t.isrc) : '';
      if (i === 0) { entry('01', '00', 0, isrc, ''); entry('01', '01', starts[0], '', ''); }
      else entry(pad2(i + 1), '01', starts[i], isrc, '');
    });
    entry('AA', '01', imageSectors, '', upc); entry('AA', '01', imageSectors, '', upc);
    const pqBytes = new Uint8Array(pq.length * 64); pq.forEach((r, i) => pqBytes.set(r, i * 64));
    // DDPID (128 bytes)
    const id = ascii(128); put(id, 0, 8, 'DDP 2.00'); if (upc) put(id, 8, 13, upc); put(id, 87, 2, 'CD');
    // DDPMS: mapa de streams (128 bytes por registo)
    const ms = (kind, size, name, file, main) => { const r = ascii(128); put(r, 0, 6, kind); put(r, 14, 8, String(size).padStart(8, '0')); if (main) { put(r, 22, 8, '00000000'); put(r, 38, 4, 'DA70'); put(r, 47, 3, String(PREGAP)); } put(r, 30, 8, name); put(r, 71, 3, '017'); put(r, 74, 54, file); return r; };
    const ddpms = new Uint8Array(256); ddpms.set(ms('VVVMS0', pqBytes.length, 'PQ DESCR', 'PQDESCR', false), 0); ddpms.set(ms('VVVMD0', imageSectors, '', 'IMAGE.DAT', true), 128);
    const files = [{ name: 'DDPID', data: id }, { name: 'DDPMS', data: ddpms }, { name: 'PQDESCR', data: pqBytes }, { name: 'IMAGE.DAT', data: image }];
    // folha PQ legível
    let txt = `PQ LIST — ${al.name}${al.artist ? ' — ' + al.artist : ''}\r\nGerado por MIXMIND by Piradex em ${new Date().toLocaleString('pt-PT')}\r\nUPC/EAN: ${upc || '—'}\r\n\r\nFaixa  Início (MM:SS:FF)  Duração   ISRC          Título\r\n`;
    al.tracks.forEach((t, i) => { const len = (i < starts.length - 1 ? starts[i + 1] : imageSectors) - starts[i]; txt += `${pad2(i + 1)}     ${msf(starts[i])}          ${msf(len)}  ${(t.isrc ? MM.delivery.normISRC(t.isrc) : '—').padEnd(12)}  ${t.title}\r\n`; });
    txt += `Lead-out ${msf(imageSectors)}\r\n`;
    files.push({ name: 'PQ.txt', data: txt });
    const sums = files.map((f) => `${A.md5(typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data)} *${f.name}`).join('\r\n') + '\r\n';
    files.push({ name: 'CHECKSUM.MD5', data: sums });
    return { files, warns: chk.warns, imageSectors, starts };
  };
  /** Leitura independente de uma imagem DDP (verificação): devolve as entradas PQ e o tamanho do áudio. */
  A.readDDP = function (files) {
    const get = (n) => { const f = files.find((x) => x.name === n); return f && (typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data); };
    const str = (u8, a, n) => String.fromCharCode(...u8.subarray(a, a + n)).trim();
    const id = get('DDPID'), ms = get('DDPMS'), pq = get('PQDESCR'), img = get('IMAGE.DAT');
    const out = { level: str(id, 0, 8), upc: str(id, 8, 13), type: str(id, 87, 2), streams: [], pq: [], problems: [] };
    for (let o = 0; o + 128 <= ms.length; o += 128) out.streams.push({ kind: str(ms, o, 6), size: +str(ms, o + 14, 8), type: str(ms, o + 38, 4), pregap: +str(ms, o + 47, 3) || 0, file: str(ms, o + 74, 54) });
    for (let o = 0; o + 64 <= pq.length; o += 64) {
      const p = str(pq, o + 10, 6);
      out.pq.push({ magic: str(pq, o, 4), track: str(pq, o + 4, 2), index: str(pq, o + 6, 2), sector: (+p.slice(0, 2) * 60 + +p.slice(2, 4)) * SPS + +p.slice(4, 6), ctrl: str(pq, o + 16, 2), isrc: str(pq, o + 20, 12), upc: str(pq, o + 32, 13) });
    }
    const main = out.streams.find((s) => s.kind === 'VVVMD0');
    if (out.level !== 'DDP 2.00') out.problems.push('DDPID sem “DDP 2.00”');
    if (!main || main.file !== 'IMAGE.DAT') out.problems.push('DDPMS sem stream principal IMAGE.DAT');
    if (main && img && main.size * BPS !== img.length) out.problems.push(`IMAGE.DAT tem ${img.length} bytes; o DDPMS indica ${main.size * BPS}`);
    if (img && img.length % BPS) out.problems.push('IMAGE.DAT não está alinhado ao setor (2352 bytes)');
    if (out.pq.some((e) => e.magic !== 'VVVS')) out.problems.push('Entradas PQ sem “VVVS”');
    const lo = out.pq.filter((e) => e.track === 'AA');
    if (lo.length < 1 || (main && lo[0].sector !== main.size)) out.problems.push('Lead-out não coincide com o fim do IMAGE.DAT');
    const t1 = out.pq.find((e) => e.track === '01' && e.index === '01');
    if (!t1 || t1.sector !== PREGAP) out.problems.push('Faixa 1 tem de começar aos 00:02:00');
    return out;
  };

  // ---------- MD5 (RFC 1321) para CHECKSUM.MD5 ----------
  A.md5 = function (u8) {
    const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    const n = u8.length, blocks = ((n + 8) >>> 6) + 1, total = blocks * 64;
    const tail = new Uint8Array(total - Math.floor(n / 64) * 64);
    const full = Math.floor(n / 64) * 64;
    tail.set(u8.subarray(full)); tail[n - full] = 0x80;
    const bits = n * 8; const tv = new DataView(tail.buffer);
    tv.setUint32(tail.length - 8, bits >>> 0, true); tv.setUint32(tail.length - 4, Math.floor(bits / 4294967296), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    const block = (src, off) => {
      for (let i = 0; i < 16; i++) M[i] = src[off + i * 4] | (src[off + i * 4 + 1] << 8) | (src[off + i * 4 + 2] << 16) | (src[off + i * 4 + 3] << 24);
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (b | ~d); g = (7 * i) & 15; }
        const tmp = d; d = c; c = b;
        const x = (a + f + K[i] + M[g]) >>> 0, s = S[(i >> 4) * 4 + (i & 3)];
        b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0; a = tmp;
      }
      a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
    };
    for (let off = 0; off < full; off += 64) block(u8, off);
    for (let off = 0; off < tail.length; off += 64) block(tail, off);
    const hex = (w) => [0, 8, 16, 24].map((s) => ((w >>> s) & 255).toString(16).padStart(2, '0')).join('');
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  };
})();
