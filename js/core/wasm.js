/* MIXMIND — ponte para os núcleos DSP em WebAssembly (wasm/mm_dsp.c → js/core/wasm-bin.js).
 * Compila de forma síncrona quando o ambiente deixa (Node, módulos pequenos); senão, assíncrona logo ao carregar
 * (MM.wasm.whenReady) — até lá, tudo corre em JavaScript.
 * Sem WebAssembly (ou com MM.WASM_OFF = true) tudo continua a funcionar com as versões em JavaScript.
 *
 * Memória: alocador simples por "concessões" (leases). Uma STFT longa mantém o canal na memória do wasm
 * enquanto cede a vez à interface; outras operações alocam acima das concessões vivas. */
(function () {
  const MM = (window.MM = window.MM || {});
  const W = (MM.wasm = { ready: false, stats: { calls: 0 }, whenReady: Promise.resolve(false) });
  const BASE = 256 * 1024; // acima da pilha e dos dados estáticos do módulo
  let inst = null, mem = null;
  const live = new Map();
  let nextId = 1, tables = new Map();

  function init() {
    if (W.ready || MM.WASM_OFF || typeof WebAssembly === 'undefined' || !MM.WASM_B64) return false;
    const s = atob(MM.WASM_B64), u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    const done = (i) => { inst = i; mem = inst.exports.memory; W.x = inst.exports; W.ready = true; return true; };
    try { return done(new WebAssembly.Instance(new WebAssembly.Module(u8), {})); } catch (e) { /* o Chrome não compila módulos > 4 KB de forma síncrona na thread principal */ }
    W.whenReady = WebAssembly.instantiate(u8, {}).then((r) => done(r.instance)).catch((e) => { console.warn('WebAssembly indisponível — a usar JavaScript', e); return false; });
    return false;
  }
  // topo = fim da concessão mais alta ainda viva (tabelas persistentes incluídas)
  const top = () => { let t = BASE; live.forEach((r) => { if (r.end > t) t = r.end; }); return t; };
  /** Reserva `bytes` (alinhado a 16) e devolve { id, ptr }. */
  W.alloc = function (bytes) {
    const ptr = (top() + 15) & ~15, end = ptr + bytes;
    const need = end - mem.buffer.byteLength;
    if (need > 0) mem.grow(Math.ceil(need / 65536));
    const id = nextId++;
    live.set(id, { ptr, end });
    return { id, ptr };
  };
  W.free = (a) => { if (a) live.delete(a.id); };
  W.f32 = (ptr, n) => new Float32Array(mem.buffer, ptr, n);
  W.f64 = (ptr, n) => new Float64Array(mem.buffer, ptr, n);
  W.i32 = (ptr, n) => new Int32Array(mem.buffer, ptr, n);
  /** Copia um Float32Array (ou similar) para uma concessão nova. */
  W.put = function (x) {
    const a = W.alloc(x.length * 4);
    const v = W.f32(a.ptr, x.length);
    if (x instanceof Float32Array) v.set(x); else for (let i = 0; i < x.length; i++) v[i] = x[i];
    return a;
  };
  /** Tabelas persistentes (janela, twiddles, núcleos de interpolação), criadas uma vez por chave. */
  W.table = function (key, make) {
    let t = tables.get(key);
    if (t) return t;
    t = make();
    tables.set(key, t);
    return t;
  };
  W.putF64 = function (arr) { const a = W.alloc(arr.length * 8); W.f64(a.ptr, arr.length).set(arr); return a; };
  W.putI32 = function (arr) { const a = W.alloc(arr.length * 4); W.i32(a.ptr, arr.length).set(arr); return a; };

  /** Tabelas da FFT real de n pontos: janela de Hann (a mesma do JS), twiddles de n e inversão de bits de n/2. */
  W.fftTables = function (n, win) {
    return W.table('fft' + n, () => {
      const m = n >> 1, tw = new Float64Array(n), rev = new Int32Array(m);
      for (let k = 0; k < m; k++) { tw[2 * k] = Math.cos((2 * Math.PI * k) / n); tw[2 * k + 1] = Math.sin((2 * Math.PI * k) / n); }
      const bits = Math.round(Math.log2(m));
      for (let i = 0; i < m; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
      return { win: W.putF64(win), tw: W.putF64(tw), rev: W.putI32(rev), n };
    });
  };
  W.init = init;
  if (init()) W.whenReady = Promise.resolve(true);
})();
