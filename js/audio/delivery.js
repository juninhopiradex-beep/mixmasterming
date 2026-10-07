/* MIXMIND — Entrega profissional
 * · Metadados nos ficheiros: WAV (BWF bext v2 com loudness, LIST/INFO, aXML com ISRC — EBU Tech 3352, ID3), AIFF (ID3),
 *   FLAC (Vorbis comments), MP3 (ID3v2.3).
 * · Validação de ISRC e UPC/EAN.
 * · Pré-escuta de codecs: codifica e descodifica o master (MP3, AAC, Opus) e volta a medir true peak e loudness. */
(function () {
  const MM = (window.MM = window.MM || {});
  const D = MM.dsp;
  const M = (MM.delivery = {});
  const enc = new TextEncoder();

  // ---------- validação ----------
  /** ISRC: CC-XXX-YY-NNNNN (país, registante, ano, código). Aceita com ou sem hífens. */
  M.normISRC = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  M.validISRC = (s) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(M.normISRC(s));
  M.fmtISRC = (s) => { const n = M.normISRC(s); return n.length === 12 ? `${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5, 7)}-${n.slice(7)}` : n; };
  /** UPC-A (12) / EAN-13 (13) com dígito de controlo. */
  M.validEAN = (s) => {
    const c = String(s || '').replace(/\D/g, '');
    if (c.length !== 12 && c.length !== 13) return false;
    const d = c.padStart(13, '0');
    let t = 0; for (let i = 0; i < 12; i++) t += +d[i] * (i % 2 ? 3 : 1);
    return (10 - (t % 10)) % 10 === +d[12];
  };
  M.defaults = (st) => Object.assign({ title: '', artist: '', album: '', composer: '', producer: 'Piradex', engineer: 'BeatFreak Studio', year: String(new Date().getFullYear()), genre: (st && st.music && st.music.genre) || '', isrc: '', upc: '', copyright: '', comment: 'Masterizado com MIXMIND by Piradex', label: '' }, st && st.meta);

  // ---------- RIFF/WAV ----------
  const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
  const concat = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; };
  const chunk = (id, payload) => { const pad = payload.length & 1 ? new Uint8Array(1) : new Uint8Array(0); return concat([enc.encode(id), u32le(payload.length), payload, pad]); };
  const latin1 = (s, len) => { const b = new Uint8Array(len); const t = String(s || ''); for (let i = 0; i < Math.min(len, t.length); i++) { const c = t.charCodeAt(i); b[i] = c < 256 ? c : 63; } return b; };
  /** BWF 'bext' versão 2 (EBU Tech 3285) — inclui loudness (EBU R128) do master. */
  M.bext = function (meta, loud, sr) {
    const b = new Uint8Array(602), v = new DataView(b.buffer), now = new Date();
    b.set(latin1(`${meta.artist || ''} - ${meta.title || ''}`.trim().replace(/^- |- $/, ''), 256), 0);
    b.set(latin1('MIXMIND by Piradex', 32), 256);
    b.set(latin1(meta.isrc ? 'ISRC' + M.normISRC(meta.isrc) : 'MIXMIND' + now.getTime().toString(36).toUpperCase(), 32), 288);
    b.set(latin1(now.toISOString().slice(0, 10), 10), 320);
    b.set(latin1(now.toTimeString().slice(0, 8).replace(/:/g, '-'), 8), 330);
    v.setUint32(338, 0, true); v.setUint32(342, 0, true); // time reference
    v.setUint16(346, 2, true); // versão 2
    const L = (x) => Math.round((x || 0) * 100);
    if (loud) { v.setInt16(412, L(loud.lufs), true); v.setInt16(414, L(loud.lra), true); v.setInt16(416, L(loud.tp), true); v.setInt16(418, L(loud.mMax), true); v.setInt16(420, L(loud.stMax), true); }
    const hist = enc.encode(`A=PCM,F=${sr},W=24,M=stereo,T=MIXMIND by Piradex\r\n`);
    return chunk('bext', concat([b, hist]));
  };
  /** LIST/INFO: INAM título, IART artista, IPRD álbum, IGNR género, ICRD ano, ICMT comentário, ICOP copyright, ISFT software, IENG engenheiro, ISRC. */
  M.listInfo = function (meta) {
    const items = [['INAM', meta.title], ['IART', meta.artist], ['IPRD', meta.album], ['IGNR', meta.genre], ['ICRD', meta.year], ['ICMT', meta.comment], ['ICOP', meta.copyright], ['IENG', meta.engineer], ['ISFT', 'MIXMIND by Piradex'], ['ISRC', meta.isrc ? M.normISRC(meta.isrc) : '']];
    const parts = [enc.encode('INFO')];
    items.forEach(([id, val]) => { if (val) { const t = enc.encode(String(val) + '\0'); parts.push(chunk(id, t)); } });
    return chunk('LIST', concat(parts));
  };
  /** aXML com o ISRC (EBU Tech 3352) — lido por fábricas, distribuidoras e DAWs de mastering. */
  M.axml = function (meta) {
    if (!meta.isrc) return new Uint8Array(0);
    const x = `<?xml version="1.0" encoding="UTF-8"?><ebucore:ebuCoreMain xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:ebucore="urn:ebu:metadata-schema:ebuCore_2012"><ebucore:coreMetadata><ebucore:identifier typeLabel="GUID" typeDefinition="Globally Unique Identifier" formatLabel="ISRC" formatDefinition="International Standard Recording Code" formatLink="http://www.ebu.ch/metadata/cs/ebu_IdentifierTypeCodeCS.xml#3.7"><dc:identifier>ISRC:${M.normISRC(meta.isrc)}</dc:identifier></ebucore:identifier></ebucore:coreMetadata></ebucore:ebuCoreMain>`;
    return chunk('axml', enc.encode(x));
  };
  /** Insere metadados num WAV já escrito (RIFF + fmt + data): bext/LIST/aXML antes de 'data', ID3 no fim. */
  M.wavWithMeta = function (wav, meta, loud) {
    if (!meta) return wav;
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const sr = v.getUint32(24, true);
    const head = wav.subarray(12, 36); // 'fmt ' + 16 bytes
    const data = wav.subarray(36);
    const id3 = M.id3(meta);
    const body = concat([enc.encode('WAVE'), head, M.bext(meta, loud, sr), M.listInfo(meta), M.axml(meta), data, chunk('id3 ', id3)]);
    return concat([enc.encode('RIFF'), u32le(body.length), body]);
  };
  M.aiffWithMeta = function (aiff, meta) {
    if (!meta) return aiff;
    const id3 = M.id3(meta);
    const be = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0); return b; };
    const ch = concat([enc.encode('ID3 '), be(id3.length), id3, id3.length & 1 ? new Uint8Array(1) : new Uint8Array(0)]);
    const out = concat([aiff, ch]);
    new DataView(out.buffer).setUint32(4, out.length - 8);
    return out;
  };

  // ---------- ID3v2.3 ----------
  const utf16 = (s) => { const t = String(s); const b = new Uint8Array(3 + t.length * 2 + 2); b[0] = 1; b[1] = 0xff; b[2] = 0xfe; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); b[3 + i * 2] = c & 255; b[4 + i * 2] = c >> 8; } return b; };
  const frame = (id, payload) => { const h = new Uint8Array(10); h.set(enc.encode(id), 0); new DataView(h.buffer).setUint32(4, payload.length); return concat([h, payload]); };
  M.id3 = function (meta) {
    const fr = [];
    const T = (id, val) => { if (val) fr.push(frame(id, utf16(val))); };
    T('TIT2', meta.title); T('TPE1', meta.artist); T('TALB', meta.album); T('TCOM', meta.composer); T('TYER', meta.year); T('TCON', meta.genre);
    T('TSRC', meta.isrc ? M.normISRC(meta.isrc) : ''); T('TCOP', meta.copyright); T('TPUB', meta.label); T('TENC', 'MIXMIND by Piradex');
    if (meta.producer) fr.push(frame('TXXX', concat([utf16('PRODUCER').subarray(0, utf16('PRODUCER').length), utf16(meta.producer).subarray(1)])));
    if (meta.upc) fr.push(frame('TXXX', concat([utf16('BARCODE'), utf16(String(meta.upc)).subarray(1)])));
    if (meta.comment) { const c = utf16(meta.comment); fr.push(frame('COMM', concat([new Uint8Array([1]), enc.encode('por'), new Uint8Array([0xff, 0xfe, 0, 0]), c.subarray(1)]))); }
    const body = concat(fr);
    const pad = new Uint8Array(256);
    const size = body.length + pad.length;
    const h = new Uint8Array(10); h.set(enc.encode('ID3'), 0); h[3] = 3; h[4] = 0; h[5] = 0;
    h[6] = (size >> 21) & 127; h[7] = (size >> 14) & 127; h[8] = (size >> 7) & 127; h[9] = size & 127;
    return concat([h, body, pad]);
  };
  M.mp3WithMeta = (mp3, meta) => (meta ? concat([M.id3(meta), mp3]) : mp3);

  // ---------- FLAC: bloco VORBIS_COMMENT ----------
  M.flacWithMeta = function (flac, meta) {
    if (!meta) return flac;
    // flac = 'fLaC' + STREAMINFO (4 + 34) + frames; o bit "último bloco" do STREAMINFO passa a 0
    const out = new Uint8Array(flac);
    const tags = [['TITLE', meta.title], ['ARTIST', meta.artist], ['ALBUM', meta.album], ['COMPOSER', meta.composer], ['DATE', meta.year], ['GENRE', meta.genre], ['ISRC', meta.isrc ? M.normISRC(meta.isrc) : ''], ['COPYRIGHT', meta.copyright], ['LABEL', meta.label], ['BARCODE', meta.upc], ['PRODUCER', meta.producer], ['COMMENT', meta.comment], ['ENCODER', 'MIXMIND by Piradex']].filter(([, v]) => v);
    const le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
    const vendor = enc.encode('MIXMIND by Piradex');
    const parts = [le(vendor.length), vendor, le(tags.length)];
    tags.forEach(([k, v]) => { const t = enc.encode(k + '=' + v); parts.push(le(t.length), t); });
    const vc = concat(parts);
    out[4] = out[4] & 0x7f; // STREAMINFO deixa de ser o último bloco
    const hdr = new Uint8Array([0x80 | 4, (vc.length >> 16) & 255, (vc.length >> 8) & 255, vc.length & 255]);
    return concat([out.subarray(0, 42), hdr, vc, out.subarray(42)]);
  };

  // ---------- pré-escuta de codecs ----------
  M.CODECS = [
    { id: 'mp3', name: 'MP3 320 kbps', where: 'Downloads, DJs, Beatport', kind: 'lame', kbps: 320 },
    { id: 'mp3-128', name: 'MP3 128 kbps', where: 'SoundCloud, YouTube antigo, WhatsApp', kind: 'lame', kbps: 128 },
    { id: 'aac', name: 'AAC 256 kbps', where: 'Apple Music / iTunes (Apple Digital Masters)', kind: 'webcodecs', codec: 'mp4a.40.2', kbps: 256 },
    { id: 'opus', name: 'Opus 160 kbps', where: 'YouTube, WhatsApp, Spotify Web', kind: 'webcodecs', codec: 'opus', kbps: 160 },
  ];
  M.supported = async function (c, sr) {
    if (c.kind === 'lame') return true;
    if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return false;
    try {
      const r = await AudioEncoder.isConfigSupported({ codec: c.codec, sampleRate: c.codec === 'opus' ? 48000 : sr, numberOfChannels: 2, bitrate: c.kbps * 1000 });
      return !!r.supported;
    } catch (e) { return false; }
  };
  async function webcodecsRoundtrip(c, chs, sr, onProgress) {
    const out = [], meta = {};
    let err = null;
    const encd = new AudioEncoder({ output: (ch, md) => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); out.push({ type: ch.type, timestamp: ch.timestamp, duration: ch.duration, data: d }); if (md && md.decoderConfig) meta.cfg = md.decoderConfig; }, error: (e) => (err = e) });
    encd.configure({ codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: c.kbps * 1000 });
    const N = 4800, n = chs[0].length;
    for (let i = 0; i < n; i += N) {
      const len = Math.min(N, n - i), buf = new Float32Array(len * 2);
      buf.set(chs[0].subarray(i, i + len), 0); buf.set((chs[1] || chs[0]).subarray(i, i + len), len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data: buf });
      encd.encode(ad); ad.close();
      if (i % (N * 100) === 0) { if (onProgress) onProgress((i / n) * 0.5); await D.yieldUI(); }
    }
    await encd.flush(); encd.close();
    if (err) throw err;
    const L = [], R = [];
    const decd = new AudioDecoder({ output: (ad) => { const k = ad.numberOfFrames, a = new Float32Array(k), b = new Float32Array(k); ad.copyTo(a, { planeIndex: 0, format: 'f32-planar' }); ad.copyTo(b, { planeIndex: ad.numberOfChannels > 1 ? 1 : 0, format: 'f32-planar' }); L.push(a); R.push(b); ad.close(); }, error: (e) => (err = e) });
    decd.configure(Object.assign({ codec: c.codec, sampleRate: sr, numberOfChannels: 2 }, meta.cfg || {}));
    out.forEach((o, j) => { decd.decode(new EncodedAudioChunk({ type: o.type, timestamp: o.timestamp, duration: o.duration, data: o.data })); });
    await decd.flush(); decd.close();
    if (err) throw err;
    if (onProgress) onProgress(0.9);
    const join = (arr) => { const t = arr.reduce((a, x) => a + x.length, 0), o = new Float32Array(t); let k = 0; arr.forEach((x) => { o.set(x, k); k += x.length; }); return o; };
    return { chs: [join(L), join(R)], bytes: out.reduce((a, o) => a + o.data.length, 0) };
  }
  async function lameRoundtrip(c, chs, sr, ctx, onProgress) {
    const mp3 = await MM.exporter.mp3(chs, sr, c.kbps);
    if (onProgress) onProgress(0.6);
    const buf = await ctx.decodeAudioData(mp3.buffer.slice(0));
    return { chs: D.channelsOf(buf).map((x) => x.slice()), bytes: mp3.length, sr: buf.sampleRate };
  }
  /** Alinha o descodificado com o original (atraso do codificador) por correlação cruzada. */
  function align(ref, x, maxLag) {
    const n = Math.min(ref.length, x.length) - maxLag - 1, start = Math.floor(ref.length * 0.3), len = Math.min(48000, n - start);
    let best = 0, bl = 0;
    for (let L = 0; L <= maxLag; L += 1) { let s = 0; for (let i = start; i < start + len; i += 4) s += ref[i] * x[i + L]; if (s > best) { best = s; bl = L; } }
    return bl;
  }
  /**
   * Codifica e descodifica o master; mede true peak, loudness, overs e perda de agudos.
   * @returns {codec, chs, sr, tp, lufs, overs, peak, hfLoss, bytes, kbps}
   */
  M.roundtrip = async function (buf, codecId, ctx, onProgress) {
    const c = M.CODECS.find((x) => x.id === codecId);
    let chs = D.channelsOf(buf), sr = buf.sampleRate;
    if (c.kind === 'webcodecs' && c.codec === 'opus' && sr !== 48000) { const b2 = await MM.resample(buf, 48000); chs = D.channelsOf(b2); sr = 48000; }
    const r = c.kind === 'lame' ? await lameRoundtrip(c, chs, sr, ctx, onProgress) : await webcodecsRoundtrip(c, chs, sr, onProgress);
    if (r.sr && r.sr !== sr) { const b2 = await MM.resample(MM.toAudioBuffer(r.chs, r.sr), sr); r.chs = D.channelsOf(b2).map((x) => x.slice()); }
    const lag = align(chs[0], r.chs[0], 4000);
    const out = r.chs.map((x) => { const y = new Float32Array(chs[0].length); y.set(x.subarray(lag, lag + y.length)); return y; });
    const tp = D.lin2db(D.truePeak(out)), lufs = D.loudness(out, sr).integrated;
    let overs = 0, peak = 0; out.forEach((x) => { for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; if (a >= 1) overs++; } });
    // perda de agudos: energia > 16 kHz do descodificado face ao original
    const hf = (arr) => { const n = 4096, p = new Float64Array(n / 2 + 1), acc = new Float64Array(n / 2 + 1), m = D.mono(arr); for (let o = Math.floor(m.length * 0.25); o + n < m.length * 0.75; o += n * 8) { D.powerSpectrum(m, o, n, p); for (let k = 0; k < p.length; k++) acc[k] += p[k]; } const k0 = Math.round((16000 * n) / sr); let s = 0, t = 0; for (let k = 1; k < acc.length; k++) { t += acc[k]; if (k >= k0) s += acc[k]; } return s / (t + 1e-20); };
    const hfLoss = 10 * Math.log10((hf(out) + 1e-12) / (hf(chs) + 1e-12));
    if (onProgress) onProgress(1);
    return { codec: c, chs: out, sr, tp, lufs, overs, peak: D.lin2db(peak), hfLoss, bytes: r.bytes, lag };
  };
  /** Ceiling recomendado para o pior codec ficar ≤ −1 dBTP depois da codificação. */
  M.safeCeiling = function (results, ceiling, masterTp) {
    const worst = Math.max(...results.map((r) => r.tp));
    if (worst <= -1.0) return null;
    const over = worst - masterTp; // quanto o codec acrescenta
    return Math.max(-3, +((-1.0 - over) - 0.1).toFixed(1));
  };
})();
