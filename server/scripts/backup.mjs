// Cópia de segurança da loja: base de dados consistente (VACUUM INTO, funciona com o servidor a correr),
// comprovativos e chave privada das licenças. Guarda a pasta resultante FORA do servidor e cifrada
// (contém dados pessoais e a chave de assinatura).
//
//   node server/scripts/backup.mjs [pasta-de-destino]      (por omissão: server/backups/AAAAMMDD-HHMMSS)
//
// Restauro: parar o servidor, copiar mixmind.db para DATA_DIR, uploads/ para DATA_DIR/uploads e
// keys/license-private.pem para DATA_DIR/keys (ou para LICENSE_PRIVATE_KEY_FILE), arrancar.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, ROOT } from '../src/config.js';

const cfg = loadConfig();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = path.resolve(process.argv[2] || path.join(ROOT, 'backups', stamp));
const dbFile = path.join(cfg.dataDir, cfg.mode === 'test' ? 'mixmind-test.db' : 'mixmind.db');
if (!fs.existsSync(dbFile)) { console.error('Base de dados não encontrada:', dbFile); process.exit(1); }
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${path.join(out, path.basename(dbFile)).replace(/'/g, "''")}'`);
fs.chmodSync(path.join(out, path.basename(dbFile)), 0o600);
db.close();
const copyDir = (from, to) => { if (!fs.existsSync(from)) return 0; fs.mkdirSync(to, { recursive: true, mode: 0o700 }); let n = 0; for (const f of fs.readdirSync(from)) { const s = path.join(from, f); if (fs.statSync(s).isFile()) { fs.copyFileSync(s, path.join(to, f)); fs.chmodSync(path.join(to, f), 0o600); n++; } } return n; };
const nUp = copyDir(path.join(cfg.dataDir, 'uploads'), path.join(out, 'uploads'));
const keyFile = cfg.licenseKeyFile || path.join(cfg.dataDir, 'keys', 'license-private.pem');
if (fs.existsSync(keyFile)) { fs.mkdirSync(path.join(out, 'keys'), { recursive: true, mode: 0o700 }); fs.copyFileSync(keyFile, path.join(out, 'keys', 'license-private.pem')); fs.chmodSync(path.join(out, 'keys', 'license-private.pem'), 0o600); }
fs.writeFileSync(path.join(out, 'LEIA-ME.txt'), `Cópia de segurança MIXMIND · ${new Date().toISOString()} · modo ${cfg.mode}\nContém dados pessoais, comprovativos e a chave privada de assinatura das licenças.\nGuardar cifrada e fora do servidor. Restauro: ver server/scripts/backup.mjs.\n`);
console.log(`Cópia criada em ${out} (${nUp} comprovativos${fs.existsSync(keyFile) ? ', chave de licenças' : ''}).`);
