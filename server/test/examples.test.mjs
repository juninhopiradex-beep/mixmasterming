// Exemplos de integração desktop (examples/desktop): CLI em Node e verificador C++/OpenSSL contra a loja real.
// `node --no-warnings server/test/examples.test.mjs` (a parte C++ é ignorada se não houver g++ + libssl-dev)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startAll } from './harness.mjs';
import { issueLicense, signingKeys } from '../src/licensing.js';
import { test, ok, summary } from '../../tests/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'examples/desktop/node/mixmind-license.mjs');
const S = await startAll();
const spki = signingKeys(S.ctx).spki;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmx-ex-'));
const env = { ...process.env, MIXMIND_API: S.base, MIXMIND_PUBLIC_KEY: spki, MIXMIND_LICENSE_FILE: path.join(tmp, 'license.json') };
const cli = (...a) => { const r = spawnSync(process.execPath, ['--no-warnings', CLI, ...a], { env, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lic = issueLicense(S.ctx, { type: 'perpetual', major: 1, actor: 'teste' }).license;

console.log('Exemplos de integração desktop');
// o CLI chama o servidor de forma síncrona (spawnSync) — o servidor corre neste processo, por isso usa-se um processo filho assíncrono
const cliAsync = (...a) => new Promise((res) => { import('node:child_process').then(({ execFile }) => execFile(process.execPath, ['--no-warnings', CLI, ...a], { env }, (e, so, se) => res({ code: e ? e.code : 0, out: so + se }))); });
let token;
await test('Node: ativar, estado offline, validar e desativar', async () => {
  let r = await cliAsync('activate', lic.key); ok(r.code === 0 && /"typ": "perpetual"/.test(r.out), r.out);
  r = cli('status'); ok(/"mode": "licensed"/.test(r.out), r.out);
  token = JSON.parse(fs.readFileSync(env.MIXMIND_LICENSE_FILE, 'utf8')).token;
  r = await cliAsync('validate'); ok(/"ok": true/.test(r.out), r.out);
});
const bin = path.join(tmp, 'verify_cli');
const built = spawnSync('g++', ['-std=c++17', '-O2', '-Wno-deprecated-declarations', path.join(ROOT, 'examples/desktop/cpp/verify_cli.cpp'), '-lcrypto', '-o', bin], { encoding: 'utf8' });
if (built.status === 0) {
  const mid = cli('id').out.trim().replace(/^"|"$/g, '');
  await test('C++/OpenSSL: aceita o comprovativo deste computador', async () => { const r = spawnSync(bin, [token, spki, mid], { encoding: 'utf8' }); ok(r.status === 0 && /"ok":true/.test(r.stdout) && /"type":"perpetual"/.test(r.stdout), r.stdout + r.stderr); });
  await test('C++/OpenSSL: recusa outro computador e comprovativo adulterado', async () => {
    let r = spawnSync(bin, [token, spki, 'outro-pc'], { encoding: 'utf8' }); ok(/outro computador/.test(r.stdout), r.stdout);
    const [a, b, c] = token.split('.'), pl = JSON.parse(Buffer.from(b, 'base64url')); pl.maj = 2;
    r = spawnSync(bin, [[a, Buffer.from(JSON.stringify(pl)).toString('base64url'), c].join('.'), spki, mid], { encoding: 'utf8' }); ok(/assinatura/.test(r.stdout), r.stdout);
  });
} else console.log('  (C++ ignorado: ' + (built.stderr || '').split('\n')[0] + ')');
await test('Node: desativar liberta a licença', async () => { const r = await cliAsync('deactivate'); ok(r.code === 0, r.out); ok(!S.ctx.db.get('SELECT 1 FROM devices WHERE license_id = ? AND deactivated_at IS NULL', lic.id), 'sem computador ativo'); });
S.close(); fs.rmSync(tmp, { recursive: true, force: true });
summary();
