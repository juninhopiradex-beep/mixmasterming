// server/scripts/backup.mjs
import fs2 from "node:fs";
import path2 from "node:path";
import { DatabaseSync } from "node:sqlite";

// server/src/config.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === void 0) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
function loadConfig(overrides = {}) {
  if (!overrides.noDotEnv) loadDotEnv(path.join(ROOT, ".env"));
  const env = { ...process.env, ...overrides };
  const mode = env.APP_MODE === "production" ? "production" : "test";
  const cfg2 = {
    mode,
    test: mode === "test",
    port: +(env.PORT || 8790),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 8790}`).replace(/\/+$/, ""),
    appUrl: (env.APP_URL || "https://juninhopiradex-beep.github.io/mixmasterming/").trim(),
    corsOrigins: (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, "data")),
    secretKey: env.SECRET_KEY || "",
    adminEmail: env.ADMIN_EMAIL || "",
    adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || "",
    adminResetPassword: env.ADMIN_RESET_PASSWORD || "",
    adminReset2fa: env.ADMIN_RESET_2FA === "1",
    betaAccess: env.BETA_ACESSOS || "",
    licenseKeyFile: env.LICENSE_PRIVATE_KEY_FILE || "",
    stripe: { secretKey: env.STRIPE_SECRET_KEY || "", webhookSecret: env.STRIPE_WEBHOOK_SECRET || "", apiBase: (env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "") },
    paypal: { clientId: env.PAYPAL_CLIENT_ID || "", clientSecret: env.PAYPAL_CLIENT_SECRET || "", webhookId: env.PAYPAL_WEBHOOK_ID || "", apiBase: (env.PAYPAL_API_BASE || (mode === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com")).replace(/\/+$/, "") },
    email: { provider: env.EMAIL_PROVIDER || "outbox", apiKey: env.EMAIL_API_KEY || "", from: env.EMAIL_FROM || "MIXMIND by Piradex <no-reply@example.com>" },
    testWebhookSecret: env.TEST_WEBHOOK_SECRET || "teste-local",
    sessionDays: +(env.SESSION_DAYS || 14),
    trustProxy: env.TRUST_PROXY === "1"
  };
  if (cfg2.mode === "production") {
    if (!cfg2.secretKey || cfg2.secretKey.length < 32) throw new Error("SECRET_KEY em falta ou demasiado curta (mín. 32 caracteres) — obrigatória em produção");
    if (!cfg2.publicUrl.startsWith("https://")) throw new Error("PUBLIC_URL tem de ser https:// em produção");
  }
  if (!cfg2.secretKey) cfg2.secretKey = "modo-de-testes-chave-local-nao-usar-em-producao-0000";
  return cfg2;
}

// server/scripts/backup.mjs
var cfg = loadConfig();
var stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
var out = path2.resolve(process.argv[2] || path2.join(ROOT, "backups", stamp));
var dbFile = path2.join(cfg.dataDir, cfg.mode === "test" ? "mixmind-test.db" : "mixmind.db");
if (!fs2.existsSync(dbFile)) {
  console.error("Base de dados não encontrada:", dbFile);
  process.exit(1);
}
fs2.mkdirSync(out, { recursive: true, mode: 448 });
var db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${path2.join(out, path2.basename(dbFile)).replace(/'/g, "''")}'`);
fs2.chmodSync(path2.join(out, path2.basename(dbFile)), 384);
db.close();
var copyDir = (from, to) => {
  if (!fs2.existsSync(from)) return 0;
  fs2.mkdirSync(to, { recursive: true, mode: 448 });
  let n = 0;
  for (const f of fs2.readdirSync(from)) {
    const s = path2.join(from, f);
    if (fs2.statSync(s).isFile()) {
      fs2.copyFileSync(s, path2.join(to, f));
      fs2.chmodSync(path2.join(to, f), 384);
      n++;
    }
  }
  return n;
};
var nUp = copyDir(path2.join(cfg.dataDir, "uploads"), path2.join(out, "uploads"));
var keyFile = cfg.licenseKeyFile || path2.join(cfg.dataDir, "keys", "license-private.pem");
if (fs2.existsSync(keyFile)) {
  fs2.mkdirSync(path2.join(out, "keys"), { recursive: true, mode: 448 });
  fs2.copyFileSync(keyFile, path2.join(out, "keys", "license-private.pem"));
  fs2.chmodSync(path2.join(out, "keys", "license-private.pem"), 384);
}
fs2.writeFileSync(path2.join(out, "LEIA-ME.txt"), `Cópia de segurança MIXMIND · ${(/* @__PURE__ */ new Date()).toISOString()} · modo ${cfg.mode}
Contém dados pessoais, comprovativos e a chave privada de assinatura das licenças.
Guardar cifrada e fora do servidor. Restauro: ver server/scripts/backup.mjs.
`);
console.log(`Cópia criada em ${out} (${nUp} comprovativos${fs2.existsSync(keyFile) ? ", chave de licenças" : ""}).`);
