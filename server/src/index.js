// Arranque: `node src/index.js` (ver README e .env.example).
import { loadConfig } from './config.js';
import { createContext } from './core.js';
import { createServer } from './server.js';
import { signingKeys } from './licensing.js';

const cfg = loadConfig();
const ctx = createContext(cfg);
signingKeys(ctx);
createServer(ctx).listen(cfg.port, () => {
  ctx.log(`MIXMIND · loja e licenças em ${cfg.publicUrl} (modo ${cfg.mode === 'test' ? 'DE TESTES' : 'produção'})`);
  if (!ctx.db.get("SELECT 1 FROM users WHERE role = 'owner'")) ctx.log('ATENÇÃO: sem administrador. Define ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD e reinicia.');
});
