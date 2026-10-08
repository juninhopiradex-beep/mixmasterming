#!/usr/bin/env node
// Exemplo de integração da API de licenças MIXMIND numa aplicação desktop (Windows / macOS / Linux), em Node 18+.
// Sem dependências. Mostra: identificador do computador, ativação, verificação OFFLINE do comprovativo (ECDSA P-256),
// validação periódica e desativação. Adapta a lógica à tua app (Electron, Tauri via sidecar, etc.).
//
//   MIXMIND_API=https://loja.exemplo MIXMIND_PUBLIC_KEY=MFkw… node mixmind-license.mjs activate MMX1-XXXXX-XXXXX-XXXXX-XXXXX
//   node mixmind-license.mjs status | validate | deactivate
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const API = (process.env.MIXMIND_API || 'http://localhost:8790').replace(/\/+$/, '');
const PUBLIC_KEY = process.env.MIXMIND_PUBLIC_KEY || ''; // SPKI base64 — embute-a na app (não é secreta)
const STORE = process.env.MIXMIND_LICENSE_FILE || path.join(os.homedir(), '.mixmind', 'license.json');
const APP_VERSION = '1.8.0';

/** Identificador estável do computador (não é enviado em claro para a nossa base de dados: o servidor guarda só um hash). */
export function machineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8' });
      const m = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(out); if (m) return 'win-' + m[1].toLowerCase();
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
      const m = /"IOPlatformUUID"\s*=\s*"([\w-]+)"/.exec(out); if (m) return 'mac-' + m[1].toLowerCase();
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) if (fs.existsSync(f)) return 'linux-' + fs.readFileSync(f, 'utf8').trim();
    }
  } catch { /* cai para o identificador local abaixo */ }
  // último recurso: identificador aleatório guardado junto da licença
  const f = STORE + '.machine'; if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'app-' + crypto.randomUUID()); }
  return fs.readFileSync(f, 'utf8').trim();
}
const platform = () => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] || process.platform) + ' ' + os.release();

/** Verificação offline: assinatura, computador, validade. */
export function verify(token, spkiB64 = PUBLIC_KEY, now = Date.now()) {
  const [h, p, s] = String(token || '').split('.');
  if (h !== 'MMX1' || !p || !s) return { ok: false, why: 'formato' };
  const key = crypto.createPublicKey({ key: Buffer.from(spkiB64, 'base64'), format: 'der', type: 'spki' });
  if (!crypto.verify('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))) return { ok: false, why: 'assinatura' };
  const pl = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  const mb = crypto.createHash('sha256').update('mmx-bind:' + machineId()).digest('hex').slice(0, 32);
  if (pl.mb && pl.mb !== mb) return { ok: false, why: 'outro computador', payload: pl };
  if (pl.exp && now > pl.exp) return { ok: false, why: 'expirado', payload: pl };
  return { ok: true, payload: pl, needsCheck: now > pl.chk };
}

async function call(p, body) {
  const r = await fetch(API + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { code: j.code });
  return j;
}
const load = () => (fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, 'utf8')) : null);
const save = (s) => { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(s, null, 1), { mode: 0o600 }); };

export async function activate(key) {
  const pub = PUBLIC_KEY || (await call('/api/v1/licenses/public-key')).spki;
  const r = await call('/api/v1/licenses/activate', { key, machineId: machineId(), machineName: os.hostname(), platform: platform(), appVersion: APP_VERSION });
  const v = verify(r.token, pub); if (!v.ok) throw new Error('Comprovativo inválido: ' + v.why);
  save({ key, token: r.token, pub }); return v.payload;
}
export async function validate() {
  const s = load(); if (!s) throw new Error('Sem licença ativada.');
  try {
    const r = await call('/api/v1/licenses/validate', { key: s.key, machineId: machineId(), appVersion: APP_VERSION });
    if (r.ok) { save({ ...s, token: r.token }); return { ok: true }; }
    save({ key: s.key, pub: s.pub, blocked: r }); return r; // revogada / suspensa / expirada / desativada
  } catch (e) { return { ok: null, offline: true, message: e.message }; } // sem rede: continua com o comprovativo atual
}
export async function deactivate() { const s = load(); if (!s) return; await call('/api/v1/licenses/deactivate', { key: s.key, machineId: machineId() }); fs.rmSync(STORE); }
export function status() { const s = load(); if (!s || !s.token) return { mode: 'demo', blocked: s && s.blocked }; const v = verify(s.token, s.pub); return v.ok ? { mode: 'licensed', ...v } : { mode: 'invalid', ...v }; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  const run = { activate: () => activate(arg), validate, deactivate, status: async () => status(), id: async () => machineId() }[cmd];
  if (!run) { console.log('Uso: mixmind-license.mjs activate <chave> | status | validate | deactivate | id'); process.exit(1); }
  run().then((r) => console.log(JSON.stringify(r, null, 1) ?? 'ok'), (e) => { console.error(`${e.code || 'ERRO'}: ${e.message}`); process.exit(2); });
}
