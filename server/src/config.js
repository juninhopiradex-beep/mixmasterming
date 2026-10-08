// Configuração a partir de variáveis de ambiente (e de um ficheiro .env opcional, fora do repositório).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function loadConfig(overrides = {}) {
  if (!overrides.noDotEnv) loadDotEnv(path.join(ROOT, '.env'));
  const env = { ...process.env, ...overrides };
  const mode = env.APP_MODE === 'production' ? 'production' : 'test';
  const cfg = {
    mode,
    test: mode === 'test',
    port: +(env.PORT || 8790),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 8790}`).replace(/\/+$/, ''),
    appUrl: (env.APP_URL || 'https://juninhopiradex-beep.github.io/Mixmastermysong/').trim(),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
    secretKey: env.SECRET_KEY || '',
    adminEmail: env.ADMIN_EMAIL || '',
    adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || '',
    licenseKeyFile: env.LICENSE_PRIVATE_KEY_FILE || '',
    stripe: { secretKey: env.STRIPE_SECRET_KEY || '', webhookSecret: env.STRIPE_WEBHOOK_SECRET || '', apiBase: (env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '') },
    paypal: { clientId: env.PAYPAL_CLIENT_ID || '', clientSecret: env.PAYPAL_CLIENT_SECRET || '', webhookId: env.PAYPAL_WEBHOOK_ID || '', apiBase: (env.PAYPAL_API_BASE || (mode === 'production' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com')).replace(/\/+$/, '') },
    email: { provider: env.EMAIL_PROVIDER || 'outbox', apiKey: env.EMAIL_API_KEY || '', from: env.EMAIL_FROM || 'MIXMIND by Piradex <no-reply@example.com>' },
    testWebhookSecret: env.TEST_WEBHOOK_SECRET || 'teste-local',
    sessionDays: +(env.SESSION_DAYS || 14),
    trustProxy: env.TRUST_PROXY === '1',
  };
  if (cfg.mode === 'production') {
    if (!cfg.secretKey || cfg.secretKey.length < 32) throw new Error('SECRET_KEY em falta ou demasiado curta (mín. 32 caracteres) — obrigatória em produção');
    if (!cfg.publicUrl.startsWith('https://')) throw new Error('PUBLIC_URL tem de ser https:// em produção');
  }
  if (!cfg.secretKey) cfg.secretKey = 'modo-de-testes-chave-local-nao-usar-em-producao-0000';
  return cfg;
}
