/* MIXMIND — Export engine
 * WAV (16 c/ dither TPDF, 24, 32 float), AIFF (16/24), FLAC (16/24, codificador próprio),
 * MP3 320 (lamejs via CDN), ZIP (store) e controlo de qualidade (QC) com relatório.
 */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const X = (MM.exporter = {});

  // ---------- conversão para inteiros ----------
  function toInt(chs, bits, dither) {
    const max = Math.pow(2, bits - 1) - 1;
    let seed = 22222;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    return chs.map((x) => {
      const out = new Int32Array(x.length);
      for (let i = 0; i < x.length; i++) {
        let v = x[i] * max;
        if (dither) v += rnd() - rnd(); // TPDF ±1 LSB
        v = Math.round(v);
        out[i] = v > max ? max : v < -max - 1 ? -max - 1 : v;
      }
      return out;
    });
  }

  // ---------- WAV ----------
  X.wav = function (chs, sr, bits) {
    const nc = chs.length, n = chs[0].length, fl = bits === 32;
    const bps = bits / 8, dataLen = n * nc * bps;
    const buf = new ArrayBuffer(44 + dataLen + (fl ? 0 : 0));
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, fl ? 3 : 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true);
    w(36, 'data'); v.setUint32(40, dataLen, true);
    let o = 44;
    if (fl) { for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { v.setFloat32(o, chs[c][i], true); o += 4; } }
    else {
      const ints = toInt(chs, bits, bits === 16);
      const u8 = new Uint8Array(buf);
      for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
        const s = ints[c][i];
        if (bits === 16) { v.setInt16(o, s, true); o += 2; }
        else { u8[o] = s & 255; u8[o + 1] = (s >> 8) & 255; u8[o + 2] = (s >> 16) & 255; o += 3; }
      }
    }
    return new Uint8Array(buf);
  };

  // ---------- AIFF ----------
  X.aiff = function (chs, sr, bits) {
    bits = bits === 16 ? 16 : 24;
    const nc = chs.length, n = chs[0].length, bps = bits / 8, dataLen = n * nc * bps;
    const buf = new ArrayBuffer(54 + dataLen), v = new DataView(buf), u8 = new Uint8Array(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'FORM'); v.setUint32(4, 46 + dataLen); w(8, 'AIFF'); w(12, 'COMM'); v.setUint32(16, 18);
    v.setUint16(20, nc); v.setUint32(22, n); v.setUint16(26, bits);
    // sample rate em extended 80-bit
    let e = 16383 + 31, m = sr; while (m < 0x80000000) { m *= 2; e--; }
    v.setUint16(28, e); v.setUint32(30, m >>> 0); v.setUint32(34, 0);
    w(38, 'SSND'); v.setUint32(42, 8 + dataLen); v.setUint32(46, 0); v.setUint32(50, 0);
    const ints = toInt(chs, bits, bits === 16);
    let o = 54;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      const s = ints[c][i];
      if (bits === 16) { v.setInt16(o, s); o += 2; } else { u8[o] = (s >> 16) & 255; u8[o + 1] = (s >> 8) & 255; u8[o + 2] = s & 255; o += 3; }
    }
    return u8;
  };

  // ---------- FLAC (preditores fixos + Rice) ----------
  class BitWriter {
    constructor(size) { this.buf = new Uint8Array(size || 1 << 20); this.pos = 0; this.acc = 0; this.n = 0; }
    grow() { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    bits(v, n) {
      while (n > 24) { this.bits(Math.floor(v / Math.pow(2, n - 24)) & 0xffffff, 24); n -= 24; v = v % Math.pow(2, n); }
      for (let i = n - 1; i >= 0; i--) {
        this.acc = (this.acc << 1) | ((v >>> i) & 1);
        if (++this.n === 8) { if (this.pos >= this.buf.length) this.grow(); this.buf[this.pos++] = this.acc; this.acc = 0; this.n = 0; }
      }
    }
    unary(q) { // q zeros seguidos de 1
      while (q >= 24) { this.bits(0, 24); q -= 24; }
      this.bits(1, q + 1);
    }
    align() { while (this.n) this.bits(0, 1); }
    bytes() { return this.buf.subarray(0, this.pos); }
  }
  const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; t[i] = c; } return t; })();
  const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; } return t; })();
  const crc8 = (b, a, z) => { let c = 0; for (let i = a; i < z; i++) c = CRC8[c ^ b[i]]; return c; };
  const crc16 = (b, a, z) => { let c = 0; for (let i = a; i < z; i++) c = ((c << 8) ^ CRC16[(c >> 8) ^ b[i]]) & 0xffff; return c; };

  X.flac = function (chs, sr, bits) {
    bits = bits === 16 ? 16 : 24;
    const nc = chs.length, n = chs[0].length, BS = 4096;
    const ints = toInt(chs, bits, bits === 16);
    const w = new BitWriter(n * nc * (bits / 8) + 4096);
    // cabeçalho + STREAMINFO
    [0x66, 0x4c, 0x61, 0x43].forEach((b) => w.bits(b, 8));
    w.bits(1, 1); w.bits(0, 7); w.bits(34, 24);
    w.bits(BS, 16); w.bits(BS, 16); w.bits(0, 24); w.bits(0, 24);
    w.bits(sr, 20); w.bits(nc - 1, 3); w.bits(bits - 1, 5);
    w.bits(Math.floor(n / 4294967296), 4); w.bits(n >>> 0, 32);
    for (let i = 0; i < 16; i++) w.bits(0, 8); // MD5 desconhecido (permitido)
    const res = new Int32Array(BS);
    let frame = 0;
    for (let start = 0; start < n; start += BS, frame++) {
      const bs = Math.min(BS, n - start);
      const f0 = w.pos;
      w.bits(0x3ffe, 14); w.bits(0, 1); w.bits(0, 1);
      w.bits(bs === BS ? 12 : 7, 4); w.bits(0, 4);
      w.bits(nc === 2 ? 1 : nc - 1, 4); w.bits(0, 3); w.bits(0, 1);
      // número do frame em "UTF-8"
      if (frame < 0x80) w.bits(frame, 8);
      else if (frame < 0x800) { w.bits(0xc0 | (frame >> 6), 8); w.bits(0x80 | (frame & 63), 8); }
      else if (frame < 0x10000) { w.bits(0xe0 | (frame >> 12), 8); w.bits(0x80 | ((frame >> 6) & 63), 8); w.bits(0x80 | (frame & 63), 8); }
      else { w.bits(0xf0 | (frame >> 18), 8); w.bits(0x80 | ((frame >> 12) & 63), 8); w.bits(0x80 | ((frame >> 6) & 63), 8); w.bits(0x80 | (frame & 63), 8); }
      if (bs !== BS) w.bits(bs - 1, 16);
      w.bits(crc8(w.buf, f0, w.pos), 8);
      for (let c = 0; c < nc; c++) {
        const x = ints[c].subarray(start, start + bs);
        // escolher ordem 0..4 com menor soma de |resíduo|
        let bestO = 0, bestS = Infinity;
        for (let o = 0; o <= Math.min(4, bs - 1); o++) {
          let s = 0;
          for (let i = o; i < bs; i++) s += Math.abs(pred(x, i, o));
          if (s < bestS) { bestS = s; bestO = o; }
        }
        const o = bestO;
        w.bits(0, 1); w.bits(8 + o, 6); w.bits(0, 1);
        for (let i = 0; i < o; i++) w.bits(x[i] & (Math.pow(2, bits) - 1), bits);
        const m = bs - o;
        for (let i = o; i < bs; i++) res[i - o] = pred(x, i, o);
        // Rice (método 1: parâmetros de 5 bits), partição única
        let sum = 0; for (let i = 0; i < m; i++) sum += Math.abs(res[i]);
        let k = 0; const mean = sum / Math.max(1, m);
        while (k < 30 && Math.pow(2, k + 1) <= mean * 1.4 + 1) k++;
        w.bits(1, 2); w.bits(0, 4); w.bits(k, 5);
        const pk = Math.pow(2, k);
        for (let i = 0; i < m; i++) {
          const r = res[i];
          const u = r >= 0 ? r * 2 : -r * 2 - 1;
          const q = Math.floor(u / pk);
          w.unary(q);
          if (k) w.bits(u - q * pk, k);
        }
      }
      w.align();
      w.bits(crc16(w.buf, f0, w.pos), 16);
    }
    return w.bytes().slice();
    function pred(x, i, o) {
      switch (o) {
        case 0: return x[i];
        case 1: return x[i] - x[i - 1];
        case 2: return x[i] - 2 * x[i - 1] + x[i - 2];
        case 3: return x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3];
        default: return x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
      }
    }
  };

  // ---------- MP3 (lamejs, carregado on-demand) ----------
  let lamePromise = null;
  X.loadLame = function () {
    if (window.lamejs) return Promise.resolve();
    if (lamePromise) return lamePromise;
    // cópia local primeiro (funciona offline); CDN só como recurso
    const urls = ['js/vendor/lame.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js', 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js', 'https://unpkg.com/lamejs@1.2.1/lame.min.js'];
    lamePromise = new Promise((resolve, reject) => {
      const tryOne = (i) => {
        if (i >= urls.length) { lamePromise = null; reject(new Error('Não foi possível carregar o codificador MP3 (sem ligação à internet?)')); return; }
        const s = document.createElement('script'); s.src = urls[i];
        s.onload = () => (window.lamejs ? resolve() : tryOne(i + 1)); s.onerror = () => tryOne(i + 1);
        document.head.appendChild(s);
      };
      tryOne(0);
    });
    return lamePromise;
  };
  X.mp3 = async function (chs, sr, kbps) {
    await X.loadLame();
    if (![32000, 44100, 48000].includes(sr)) throw new Error('MP3 suporta 32, 44,1 ou 48 kHz');
    const enc = new window.lamejs.Mp3Encoder(chs.length, sr, kbps || 320);
    const ints = toInt(chs, 16, true).map((a) => Int16Array.from(a));
    const parts = [];
    const B = 1152;
    for (let i = 0; i < ints[0].length; i += B) {
      const l = ints[0].subarray(i, i + B), r = (ints[1] || ints[0]).subarray(i, i + B);
      const d = chs.length > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (d.length) parts.push(new Uint8Array(d));
      if (i % (B * 400) === 0) await D.yieldUI();
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    const total = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(total);
    let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  };

  // ---------- ZIP (store) ----------
  const CRC32T = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
  X.crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC32T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  X.zip = function (files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let off = 0;
    const now = new Date();
    const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
    const dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = X.crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    const cSize = central.reduce((a, p) => a + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const total = all.reduce((a, p) => a + p.length, 0), out = new Uint8Array(total);
    let o = 0; all.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  };

  /** Leitor de ZIP (store e deflate). Devolve [{ name, data: Uint8Array }]. */
  X.unzip = async function (u8) {
    const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('Ficheiro ZIP inválido');
    const n = v.getUint16(e + 10, true);
    let p = v.getUint32(e + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP corrompido (diretório central)');
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const lnl = v.getUint16(lo + 26, true), lxl = v.getUint16(lo + 28, true);
      const start = lo + 30 + lnl + lxl;
      let data = u8.subarray(start, start + csize);
      if (method === 8) data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if (method !== 0) throw new Error('Compressão ZIP não suportada: ' + method);
      out.push({ name, data });
      p += 46 + nl + xl + cl;
    }
    return out;
  };

  X.download = function (data, name, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };

  /** meta (opcional): título, artista, ISRC… escritos no ficheiro; loud: métricas EBU R128 para o bext do WAV. */
  X.encode = async function (buf, fmt, bits, meta, loud) {
    // demonstração (licenciamento ligado e sem licença válida): só os formatos permitidos e corte no tempo
    const Lc = MM.license;
    if (Lc && Lc.isDemo()) { if (!Lc.formatAllowed(fmt)) throw new Error(Lc.demoMessage()); buf = Lc.trim(buf); }
    const chs = D.channelsOf(buf), sr = buf.sampleRate, Dl = MM.delivery;
    const m = meta && Dl ? meta : null;
    if (fmt === 'wav') return { data: m ? Dl.wavWithMeta(X.wav(chs, sr, bits), m, loud) : X.wav(chs, sr, bits), ext: 'wav', type: 'audio/wav' };
    if (fmt === 'aiff') return { data: m ? Dl.aiffWithMeta(X.aiff(chs, sr, bits), m) : X.aiff(chs, sr, bits), ext: 'aiff', type: 'audio/aiff' };
    if (fmt === 'flac') return { data: m ? Dl.flacWithMeta(X.flac(chs, sr, bits), m) : X.flac(chs, sr, bits), ext: 'flac', type: 'audio/flac' };
    if (fmt === 'mp3') { const d = await X.mp3(chs, sr, 320); return { data: m ? Dl.mp3WithMeta(d, m) : d, ext: 'mp3', type: 'audio/mpeg' }; }
    throw new Error('Formato desconhecido');
  };

  // ---------- QC ----------
  X.qc = function (m, state) {
    const M = state.master;
    const fmt = (v, d = 1) => D.fmtNum(v, d);
    const out = [];
    const add = (id, status, title, text) => out.push({ id, status, title, text });
    add('clip', m.clips ? 'fail' : 'ok', 'Clipping digital', m.clips ? `${m.clips} zona(s) a 0 dBFS` : '0 amostras a 0 dBFS');
    const tpOk = m.tp <= M.ceiling + 0.05;
    add('tp', tpOk ? 'ok' : 'warn', 'True peak', tpOk ? `${fmt(m.tp)} dBTP (ceiling ${fmt(M.ceiling)})` : `${fmt(m.tp)} dBTP; ceiling é ${fmt(M.ceiling)}. O limiter vai baixar ${fmt(m.tp - M.ceiling)} dB no export.`);
    add('dc', m.dc < -60 ? 'ok' : 'warn', 'DC offset', `${fmt(m.dc, 0)} dBFS${m.dc < -60 ? ', abaixo do limite' : ' — aplicar high-pass a 10 Hz'}`);
    add('phase', m.corrMin > 0.1 ? 'ok' : 'warn', 'Fase / correlação', `Mínima ${fmt(m.corrMin, 2)}${m.corrMin > 0.1 ? ' · sem cancelamento em mono' : ' · risco de cancelamento em mono'}`);
    add('mono', m.monoLow > 90 ? 'ok' : 'warn', 'Graves em mono', `Abaixo de 120 Hz: mono ${Math.round(m.monoLow)} %`);
    add('silence', m.head < 2 && m.tail < 4 ? 'ok' : 'warn', 'Silêncio e cortes', `Cabeça ${fmt(m.head)} s · cauda ${fmt(m.tail)} s`);
    add('clicks', m.clicks ? 'warn' : 'ok', 'Cliques / pops', m.clicks ? `${m.clicks} possível(eis) clique(s) detetado(s)` : '0 detetados');
    const gr = state.masterGR || 0;
    add('overlim', m.plr > 7 ? 'ok' : 'warn', 'Over-limiting', m.plr > 7 ? `PLR ${fmt(m.plr)} dB — dinâmica preservada` : `PLR ${fmt(m.plr)} dB: limiting pesado${gr ? ` (GR ~${fmt(gr)} dB)` : ''}. Considera alvo ${fmt(M.target - 1, 0)}.`);
    if (Math.abs(m.lufs - M.target) <= 0.3) add('loud', 'ok', 'Loudness vs alvo', `${fmt(m.lufs)} vs ${fmt(M.target)} LUFS (±0,3)`);
    else if (M.reached === false && m.lufs < M.target) add('loud', 'warn', 'Alvo não atingido sem esmagar', `${fmt(m.lufs)} vs ${fmt(M.target)} LUFS. Acima disto o limiter só destrói transientes. Para mais loudness: estilo Punchy/Aggressive (clipper) ou alvo ${fmt(Math.round(m.lufs))}.`);
    else add('loud', 'warn', 'Loudness vs alvo', `${fmt(m.lufs)} vs ${fmt(M.target)} LUFS (±0,3)`);
    if (m.sections && m.sections.length) {
      const ch = m.sections.filter((s) => /Refr/.test(s.name)).map((s) => s.lufs);
      const diff = ch.length > 1 ? Math.max(...ch) - Math.min(...ch) : 0;
      add('sections', diff < 1.5 ? 'ok' : 'warn', 'Consistência de secções', ch.length > 1 ? `Refrões a ${fmt(diff)} LU de diferença` : 'Secções consistentes');
    }
    return out;
  };

  X.reportHTML = function (state, m, qc) {
    const fmt = (v, d = 1) => D.fmtNum(v, d);
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const sc = state.score || {};
    const rows = qc.map((q) => `<tr><td class="${q.status}">${q.status === 'ok' ? '✓' : q.status === 'warn' ? '!' : '✕'}</td><td><b>${esc(q.title)}</b><br><span>${esc(q.text)}</span></td></tr>`).join('');
    const stems = state.stems.filter((s) => !s.removed).map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(s.role)}</td><td>${Math.round(s.conf * 100)} %</td><td>${D.fmtDb(s.p.fader)} dB</td><td>${MM.panLabel(s.p.pan)}</td></tr>`).join('');
    return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><title>Relatório de QC — ${esc(state.project.name)}</title>
<style>body{font:14px/1.5 -apple-system,Segoe UI,Inter,sans-serif;color:#111;max-width:820px;margin:40px auto;padding:0 24px}h1{font-size:24px;margin:0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-top:32px}
.sub{color:#666}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}.k{border:1px solid #ddd;border-radius:10px;padding:10px}.k b{display:block;font:600 20px ui-monospace,Menlo,monospace}.k span{color:#666;font-size:12px}
table{width:100%;border-collapse:collapse}td{padding:8px;border-bottom:1px solid #eee;vertical-align:top}td span{color:#666}.ok{color:#0a7d55;font-weight:700}.warn{color:#b26b00;font-weight:700}.fail{color:#c0262d;font-weight:700}
footer{margin-top:40px;color:#888;font-size:12px}@media print{body{margin:0}}</style></head><body>
<h1>${esc(state.project.name)}</h1><div class="sub">MIXMIND by Piradex · ${esc(state.currentVersionName || 'Mix')} · Master ${esc(state.master.style)} · ${state.music.bpm} BPM · ${esc(state.music.key)} · ${esc(state.music.genre)}</div>
<div class="grid"><div class="k"><span>LUFS-I</span><b>${fmt(m.lufs)}</b></div><div class="k"><span>True peak</span><b>${fmt(m.tp)} dBTP</b></div><div class="k"><span>LRA</span><b>${fmt(m.lra)} LU</b></div><div class="k"><span>PLR</span><b>${fmt(m.plr)} dB</b></div>
<div class="k"><span>Correlação</span><b>${fmt(m.corr, 2)}</b></div><div class="k"><span>Graves mono</span><b>${Math.round(m.monoLow)} %</b></div><div class="k"><span>Mix score</span><b>${sc.overall || '—'}</b></div><div class="k"><span>Duração</span><b>${D.fmtTime(m.duration).slice(0, 5)}</b></div></div>
<h2>Controlo de qualidade — ${qc.filter((q) => q.status === 'ok').length} OK · ${qc.filter((q) => q.status !== 'ok').length} avisos</h2><table>${rows}</table>
<h2>Stems</h2><table><tr><td><b>Stem</b></td><td><b>Papel</b></td><td><b>Confiança</b></td><td><b>Fader</b></td><td><b>Pan</b></td></tr>${stems}</table>
<h2>Decisões da IA</h2><ul>${(state.explain || []).slice(0, 40).map((e) => `<li><b>${esc(e.stemName || e.module)}</b> — ${esc(e.text)}</li>`).join('')}${(state.masterExplain || []).map((e) => `<li><b>Master · ${esc(e.module)}</b> — ${esc(e.text)}</li>`).join('')}</ul>
<footer>Gerado pelo MIXMIND by Piradex em ${new Date().toLocaleString('pt-PT')} · AI proposes. Engineer decides. · Imprime para PDF com Ctrl/Cmd+P.</footer></body></html>`;
  };
})();
