// Carrega os módulos do MIXMIND (scripts clássicos com window.MM) num contexto Node, sem browser.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadMM(files) {
  const ctx = { console, performance, setTimeout, clearTimeout, TextEncoder, TextDecoder, Blob, Response, DecompressionStream, CompressionStream, atob, btoa, structuredClone, Math, Date, WebAssembly };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.MM;
}

// mini framework de testes
const results = [];
export async function test(name, fn) {
  const t0 = performance.now();
  try { await fn(); results.push([true, name, performance.now() - t0]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([false, name, performance.now() - t0, e]); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
export function near(a, b, tol, what) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what || 'valor'}: ${a} (esperado ${b} ± ${tol})`); }
export function ok(c, what) { if (!c) throw new Error(what || 'falhou'); }
export function summary() {
  const fail = results.filter((r) => !r[0]);
  console.log(`\n${results.length - fail.length}/${results.length} testes OK`);
  if (fail.length) process.exitCode = 1;
}
