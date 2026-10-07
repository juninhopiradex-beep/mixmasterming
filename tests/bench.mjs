// (loudness: o wasm perde para o JS — por isso está desligado na app; MM.WASM_LOUD liga-o só aqui)
// Comparação de velocidade JavaScript vs WebAssembly nos núcleos DSP: `node tests/bench.mjs`
import { loadMM } from './load.mjs';
const MM = loadMM(['js/core/wasm-bin.js', 'js/core/wasm.js', 'js/core/dsp.js']);
const D = MM.dsp, sr = 44100, n = sr * 180;
const x = new Float32Array(n), y = new Float32Array(n);
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
for (let i = 0; i < n; i++) { x[i] = 0.7 * Math.tanh(2 * rnd() * Math.sin(i / 3000)); y[i] = 0.7 * Math.tanh(2 * rnd() * Math.cos(i / 2700)); }
const time = async (fn) => { const t0 = performance.now(); await fn(); return performance.now() - t0; };
const cases = {
  'STFT 4096/1024 (3 min mono)': () => D.stft(x, sr, 4096, 1024, () => {}),
  'Loudness BS.1770 (3 min estéreo)': () => D.loudness([x, y], sr),
  'True peak (3 min estéreo)': () => D.truePeak([x, y]),
  'Biquad (3 min mono)': () => D.filter(x, D.biquad('peaking', 1000, 1, 3, sr)),
};
console.log('núcleo'.padEnd(36), 'JS ms'.padStart(8), 'wasm ms'.padStart(8), 'ganho'.padStart(7));
for (const [k, fn] of Object.entries(cases)) {
  MM.WASM_OFF = true; MM.WASM_LOUD = false; await fn(); const a = await time(fn);
  MM.WASM_OFF = false; MM.WASM_LOUD = true; await fn(); const b = await time(fn);
  console.log(k.padEnd(36), a.toFixed(0).padStart(8), b.toFixed(0).padStart(8), (a / b).toFixed(2).padStart(6) + '×');
}
