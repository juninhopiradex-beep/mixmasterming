// MIXMIND · loja, contas, pagamentos e licenças v1.8 — servidor num só ficheiro (gerado; fonte em server/src na versão completa).
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
    // endereço da app: por omissão /app/ neste mesmo servidor (relativo a PUBLIC_URL); pode ser um endereço completo
    appUrl: (env.APP_URL || "/app/").trim(),
    appDir: env.APP_DIR || "",
    // pasta dos ficheiros da app (vazio = a pasta acima de server/)
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
  if (cfg2.appUrl.startsWith("/")) cfg2.appUrl = cfg2.publicUrl + cfg2.appUrl;
  if (!cfg2.secretKey) cfg2.secretKey = "modo-de-testes-chave-local-nao-usar-em-producao-0000";
  return cfg2;
}

// server/src/core.js
import fs5 from "node:fs";
import path5 from "node:path";

// server/src/db.js
import fs2 from "node:fs";
import path2 from "node:path";
import { DatabaseSync } from "node:sqlite";
function openDb(file) {
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  const cache = /* @__PURE__ */ new Map();
  const st = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  return {
    raw: db,
    get: (sql, ...a) => st(sql).get(...a),
    all: (sql, ...a) => st(sql).all(...a),
    run: (sql, ...a) => st(sql).run(...a),
    exec: (sql) => db.exec(sql),
    /** Transação imediata: tudo ou nada (usada em pagamentos e licenças). */
    tx(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }
        throw e;
      }
    },
    close: () => db.close()
  };
}
function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const done = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => r.name));
  const dir = path2.join(ROOT, "migrations");
  for (const f of fs2.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    db.exec("BEGIN");
    try {
      db.exec(fs2.readFileSync(path2.join(dir, f), "utf8"));
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(f, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migração ${f} falhou: ${e.message}`);
    }
  }
}

// server/src/defaults.js
var PLANS = [
  { id: "perpetual", name: "Licença perpétua", kind: "perpetual", interval: null, price_usd_cents: 9900, sort: 1 },
  { id: "monthly", name: "Subscrição mensal", kind: "subscription", interval: "month", price_usd_cents: 1999, sort: 2 },
  { id: "annual", name: "Subscrição anual", kind: "subscription", interval: "year", price_usd_cents: 5900, sort: 3 }
];
function defaultSettings(test) {
  const EX = "EXEMPLO DE TESTES — NÃO TRANSFERIR";
  return {
    currencies: { base: "USD", rates: test ? { EUR: { rate: 0.92, note: "exemplo de testes" }, AOA: { rate: 915, note: "exemplo de testes" } } : { EUR: { rate: null }, AOA: { rate: null } } },
    taxes: { mode: "added", rules: test ? [{ country: "PT", rate: 23, label: "IVA (exemplo de testes — validar com contabilista)" }] : [] },
    methods: {
      card: { enabled: true, countries: "*" },
      paypal: { enabled: true, countries: "*" },
      bank_pt: { enabled: true, countries: "*" },
      bank_ao: { enabled: true, countries: "*" },
      test: { enabled: test }
    },
    bank_pt: test ? { holder: EX, bank: "Banco Exemplo, S.A.", iban: "PT50 0000 0000 0000 0000 0000 0", swift: "EXMPPTPL", currency: "EUR", instructions: "Indica a referência da encomenda no descritivo da transferência.", deadlineDays: 5, example: true } : { holder: "", bank: "", iban: "", swift: "", currency: "EUR", instructions: "Indica a referência da encomenda no descritivo da transferência.", deadlineDays: 5 },
    bank_ao: test ? { holder: EX, bank: "Banco Exemplo Angola, S.A.", iban: "AO06 0000 0000 0000 0000 0000 0", swift: "EXMPAOLU", currency: "AOA", instructions: "Indica a referência da encomenda no descritivo da transferência.", deadlineDays: 5, example: true } : { holder: "", bank: "", iban: "", swift: "", currency: "AOA", instructions: "Indica a referência da encomenda no descritivo da transferência.", deadlineDays: 5 },
    licensing: { graceDays: 7, transferLimit: 3, transferWindowDays: 30, checkDays: 7 },
    demo: { exportSeconds: 60, formats: ["mp3"], text: "Demonstração gratuita: todas as funções de mistura e master, exportação limitada a 60 s em MP3." },
    security: { require2faForStaff: false, loginMaxAttempts: 5, lockMinutes: 15 },
    support: { email: "", url: "" },
    store: { productName: "MIXMIND by Piradex", refundDaysPerpetual: 14, taxNotice: "Os impostos aplicáveis, incluindo IVA, poderão ser acrescentados no checkout, conforme o país e a configuração fiscal." }
  };
}
var T = (title, body) => ({ title, body });
var TEXTS = {
  terms: T("Termos e condições", `# Termos e condições de venda e utilização

**Rascunho — sujeito a validação jurídica antes da publicação.**

1. **Objeto.** Estes termos regulam a compra de licenças do software MIXMIND by Piradex ("Software").
2. **Conta e licença.** A palavra-passe dá acesso à conta. A chave de licença ativa o Software. Uma conta pode ter várias licenças; cada licença permite a ativação e utilização num único computador de cada vez, Windows ou macOS.
3. **Licença perpétua.** Pagamento único; utilização permanente da versão 1.x adquirida, com atualizações gratuitas da série 1.x. Versões principais futuras (por exemplo 2.x) não estão incluídas automaticamente.
4. **Subscrição.** Utilização durante o período pago; renovação automática quando paga por cartão ou PayPal; renovação manual quando paga por transferência. O cancelamento termina a renovação e mantém o acesso até ao fim do período pago.
5. **Preços e impostos.** Preços em dólares dos EUA (USD). Os impostos aplicáveis, incluindo IVA, poderão ser acrescentados no checkout, conforme o país e a configuração fiscal.
6. **Reembolsos.** Ver a Política de reembolsos.
7. **Ativação e funcionamento offline.** O processamento áudio é local. A licença é validada por um comprovativo digital assinado; licenças perpétuas funcionam offline depois de ativadas; subscrições dentro do período pago e da tolerância indicada.
8. **Dados pessoais.** Ver a Política de privacidade.
9. **Lei aplicável.** [A definir pelo jurídico.]`),
  privacy: T("Política de privacidade", `# Política de privacidade

**Rascunho — sujeito a validação jurídica antes da publicação.**

- **Responsável pelo tratamento:** [nome, morada e contacto a preencher].
- **Dados recolhidos:** nome, email, país, dados de faturação e identificação fiscal quando necessários, histórico de compras, licenças e identificador anónimo do computador ativado (hash).
- **Pagamentos:** os dados de cartão são tratados exclusivamente pelo prestador de pagamento (Stripe ou PayPal); não guardamos números de cartão nem CVV.
- **Comprovativos de transferência:** guardados de forma privada, acessíveis apenas ao cliente e a administradores autorizados.
- **Áudio:** o processamento é local; os teus ficheiros de áudio não são enviados para os nossos servidores.
- **Direitos:** acesso, retificação, apagamento, portabilidade e oposição — [contacto a preencher].
- **Conservação:** [prazos a definir pelo jurídico/contabilidade].`),
  refund: T("Política de reembolsos", `# Política de reembolsos

**Rascunho — sujeito a validação jurídica antes da publicação.**

- **Licença perpétua:** garantia comercial de reembolso de 14 dias a contar da compra. Após o reembolso, a licença é revogada.
- **Subscrições (mensal e anual):** os pagamentos de subscrição não são reembolsáveis, sem prejuízo dos direitos legais aplicáveis ao consumidor no teu país. Podes cancelar a renovação a qualquer momento e manténs o acesso até ao fim do período pago.
- **Recomendação:** experimenta a demonstração gratuita antes de comprar.`)
};
var EMAILS = {
  account_confirm: T("Confirmação de conta", "Assunto: Confirma o teu email — {{product}}\n\nOlá {{name}},\n\nConfirma o teu email para ativar a conta:\n{{link}}\n\nA ligação é válida durante 48 horas. Se não criaste esta conta, ignora esta mensagem."),
  password_reset: T("Recuperação de palavra-passe", "Assunto: Recuperar a palavra-passe — {{product}}\n\nOlá {{name}},\n\nPara definires uma nova palavra-passe, abre:\n{{link}}\n\nA ligação é válida durante 1 hora. Se não pediste a recuperação, ignora esta mensagem — a palavra-passe atual continua válida."),
  invite: T("Convite", "Assunto: Foi criada uma conta para ti — {{product}}\n\nOlá {{name}},\n\nFoi criada uma conta {{product}} para este email. Define a tua palavra-passe aqui:\n{{link}}\n\nA ligação é válida durante 7 dias."),
  order_created: T("Encomenda criada", "Assunto: Encomenda {{ref}} criada\n\nOlá {{name}},\n\nRecebemos a tua encomenda {{ref}}: {{plan}} — {{amount}}.\nMétodo: {{method}}.\n\nPodes acompanhar o estado em {{link}}."),
  transfer_instructions: T("Instruções de transferência", "Assunto: Instruções de pagamento da encomenda {{ref}}\n\nOlá {{name}},\n\nTransfere {{amount}} para:\n{{bank}}\n\nReferência obrigatória no descritivo: {{ref}}\nPrazo: {{due}}\n\nDepois, envia o comprovativo em {{link}}. A licença é emitida depois de confirmarmos a entrada do pagamento."),
  proof_received: T("Comprovativo recebido", "Assunto: Comprovativo recebido — encomenda {{ref}}\n\nOlá {{name}},\n\nComprovativo recebido. O pagamento encontra-se a aguardar validação.\nVamos confirmar a entrada do valor e avisar-te por email."),
  proof_needs_info: T("Pedido de esclarecimento", "Assunto: Precisamos de mais informação — encomenda {{ref}}\n\nOlá {{name}},\n\nPara validarmos o pagamento da encomenda {{ref}} precisamos do seguinte:\n{{reason}}\n\nPodes complementar ou substituir o comprovativo em {{link}}."),
  payment_approved: T("Pagamento aprovado", "Assunto: Pagamento confirmado — encomenda {{ref}}\n\nOlá {{name}},\n\nO pagamento da encomenda {{ref}} foi confirmado. Obrigado!"),
  payment_rejected: T("Pagamento rejeitado", "Assunto: Pagamento não confirmado — encomenda {{ref}}\n\nOlá {{name}},\n\nNão foi possível confirmar o pagamento da encomenda {{ref}}.\nMotivo: {{reason}}\n\nSe tiveres dúvidas, responde a este email ou contacta o suporte."),
  license_issued: T("Licença emitida", "Assunto: A tua licença {{product}}\n\nOlá {{name}},\n\nA tua licença ({{plan}}) está pronta.\nChave de licença: {{key}}\n\nAtiva-a em MIXMIND → Definições → Licença. Cada licença permite a ativação num único computador de cada vez.\nGere a licença e o computador autorizado em {{link}}."),
  renewal_reminder: T("Aproximação da expiração", "Assunto: A tua subscrição termina a {{date}}\n\nOlá {{name}},\n\nA tua subscrição ({{plan}}) termina a {{date}}.\n{{action}}\n\nGere a subscrição em {{link}}."),
  renewed: T("Renovação", "Assunto: Subscrição renovada até {{date}}\n\nOlá {{name}},\n\nA tua subscrição ({{plan}}) foi renovada e está válida até {{date}}."),
  payment_failed: T("Falha de cobrança", "Assunto: Não conseguimos cobrar a tua subscrição\n\nOlá {{name}},\n\nA cobrança da subscrição ({{plan}}) falhou. Atualiza o método de pagamento junto do prestador ({{provider}}) para manteres o acesso depois de {{date}}.\n\n{{link}}"),
  subscription_cancelled: T("Cancelamento de subscrição", "Assunto: Renovação cancelada\n\nOlá {{name}},\n\nCancelámos a renovação da tua subscrição ({{plan}}). Manténs o acesso até {{date}}."),
  device_changed: T("Alteração do computador autorizado", "Assunto: Computador autorizado alterado\n\nOlá {{name}},\n\nA licença terminada em {{key4}} foi {{what}} ({{device}}) em {{date}}.\nSe não foste tu, contacta o suporte de imediato.")
};

// server/src/security.js
import crypto from "node:crypto";
var SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw).normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${h.toString("base64")}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) {
    crypto.scryptSync("x", "y", 32, SCRYPT);
    return false;
  }
  const [, N, r, p, salt, hash] = stored.split("$");
  const h = crypto.scryptSync(String(pw).normalize("NFKC"), Buffer.from(salt, "base64"), 32, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  const ref = Buffer.from(hash, "base64");
  return ref.length === h.length && crypto.timingSafeEqual(ref, h);
}
function passwordProblem(pw, email) {
  pw = String(pw || "");
  if (pw.length < 10) return "A palavra-passe tem de ter pelo menos 10 caracteres.";
  if (pw.length > 200) return "A palavra-passe é demasiado longa.";
  if (email && pw.toLowerCase().includes(String(email).split("@")[0].toLowerCase()) && String(email).split("@")[0].length > 3) return "A palavra-passe não pode conter o teu email.";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|password|palavrapasse)/i.test(pw)) return "Escolhe uma palavra-passe menos previsível.";
  return null;
}
var randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
var sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
var uuid = () => crypto.randomUUID();
var hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest("hex");
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
function makeCipher(secretKey) {
  const key = crypto.createHash("sha256").update("mixmind-secrets:" + secretKey).digest();
  return {
    enc(plain) {
      const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
      return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
    },
    dec(s) {
      if (!s) return "";
      const [, iv, tag, ct] = s.split(":");
      const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
    }
  };
}
var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) {
  let bits = 0, v = 0, out = "";
  for (const b of buf) {
    v = v << 8 | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[v >>> bits - 5 & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[v << 5 - bits & 31];
  return out;
}
function unbase32(s) {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, v = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    v = v << 5 | i;
    bits += 5;
    if (bits >= 8) {
      out.push(v >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secretB32, t = Date.now(), step = 30) {
  const ctr = Math.floor(t / 1e3 / step), b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(ctr));
  const h = crypto.createHmac("sha1", unbase32(secretB32)).update(b).digest(), o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 2147483647) % 1e6).padStart(6, "0");
}
function verifyTotp(secretB32, code, t = Date.now()) {
  code = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => safeEqual(totp(secretB32, t + w * 3e4), code));
}

// server/src/licensing.js
import fs4 from "node:fs";
import path4 from "node:path";
import crypto2 from "node:crypto";

// server/src/http.js
import fs3 from "node:fs";
import path3 from "node:path";
var HttpError = class extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code || "ERRO";
    this.extra = extra;
  }
};
var fail = (status, message, code, extra) => {
  throw new HttpError(status, message, code, extra);
};
function router() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
      keys.push(k);
      return "/([^/]+)";
    }) + "/?$");
    routes.push({ method, re, keys, handlers });
  };
  return {
    get: (p, ...h) => add("GET", p, ...h),
    post: (p, ...h) => add("POST", p, ...h),
    put: (p, ...h) => add("PUT", p, ...h),
    patch: (p, ...h) => add("PATCH", p, ...h),
    del: (p, ...h) => add("DELETE", p, ...h),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    }
  };
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "Pedido demasiado grande.", "DEMASIADO_GRANDE"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function parseCookies(h) {
  const out = {};
  (h || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
var SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin"
};
var CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; form-action 'self' https://checkout.stripe.com https://www.paypal.com https://www.sandbox.paypal.com; frame-ancestors 'none'; base-uri 'self'";
function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const h = { ...SEC_HEADERS, ...headers };
  if (body !== void 0 && typeof body !== "string" && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    h["Content-Type"] = h["Content-Type"] || "application/json; charset=utf-8";
  }
  h["Cache-Control"] = h["Cache-Control"] || "no-store";
  res.writeHead(status, h);
  res.end(body);
}
var TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
function serveStatic(root, pathname, res, status = 200) {
  let rel = decodeURIComponent(pathname).replace(/\/+$/, "") || "/index";
  if (!path3.extname(rel)) rel += ".html";
  const file = path3.resolve(root, "." + rel);
  if (!file.startsWith(root + path3.sep) || !fs3.existsSync(file) || fs3.statSync(file).isDirectory()) return false;
  const ext = path3.extname(file);
  send(res, status, fs3.readFileSync(file), { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300", ...ext === ".html" ? { "Content-Security-Policy": CSP } : {} });
  return true;
}

// server/src/licensing.js
var CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newKey() {
  const b = crypto2.randomBytes(13);
  let v = 0n, out = "";
  for (const x of b) v = v << 8n | BigInt(x);
  for (let i = 0; i < 20; i++) out += CROCK[Number(v >> BigInt(5 * i) & 31n)];
  return "MMX1-" + out.match(/.{5}/g).join("-");
}
var normKey = (k) => String(k || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1").replace(/^MMX1/, "MMX1").replace(/^(MMX1)(.{5})(.{5})(.{5})(.{5})$/, "$1-$2-$3-$4-$5");
function signingKeys(ctx2) {
  if (ctx2._keys) return ctx2._keys;
  const file = ctx2.cfg.licenseKeyFile || path4.join(ctx2.cfg.dataDir, "keys", "license-private.pem");
  let pem;
  if (fs4.existsSync(file)) pem = fs4.readFileSync(file, "utf8");
  else {
    fs4.mkdirSync(path4.dirname(file), { recursive: true, mode: 448 });
    pem = crypto2.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });
    fs4.writeFileSync(file, pem, { mode: 384 });
    ctx2.log("Par de chaves de licenças criado em", file, "(guarda uma cópia de segurança; nunca a publiques)");
  }
  const priv = crypto2.createPrivateKey(pem), pub = crypto2.createPublicKey(priv);
  const spki = pub.export({ type: "spki", format: "der" }).toString("base64");
  ctx2._keys = { priv, pub, spki, jwk: pub.export({ format: "jwk" }), kid: sha256(spki).slice(0, 16) };
  return ctx2._keys;
}
var b64u = (b) => Buffer.from(b).toString("base64url");
function signToken(ctx2, payload) {
  const K = signingKeys(ctx2), body = "MMX1." + b64u(JSON.stringify({ ...payload, kid: K.kid }));
  const sig = crypto2.sign("sha256", Buffer.from(body), { key: K.priv, dsaEncoding: "ieee-p1363" });
  return body + "." + b64u(sig);
}
var licEvent = (ctx2, licId, actor, action, details) => ctx2.db.run("INSERT INTO license_events (license_id, at, actor, action, details) VALUES (?,?,?,?,?)", licId, ctx2.now(), typeof actor === "string" ? actor : actor && actor.email || "sistema", action, details ? typeof details === "string" ? details : JSON.stringify(details) : null);
function issueLicense(ctx2, o) {
  const db = ctx2.db;
  if (o.orderId) {
    const ex = db.get("SELECT * FROM licenses WHERE order_id = ?", o.orderId);
    if (ex) return { license: ex, created: false };
  }
  if (o.subscriptionId) {
    const ex = db.get("SELECT * FROM licenses WHERE subscription_id = ?", o.subscriptionId);
    if (ex) return { license: ex, created: false };
  }
  const id = uuid(), now = ctx2.now();
  let key;
  do {
    key = newKey();
  } while (db.get("SELECT 1 FROM licenses WHERE key = ?", key));
  db.run(
    "INSERT INTO licenses (id, key, user_id, product_id, type, order_id, subscription_id, major, issued_at, expires_at, status, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    id,
    key,
    o.userId || null,
    "mixmind",
    o.type,
    o.orderId || null,
    o.subscriptionId || null,
    o.major || 1,
    now,
    o.expiresAt || null,
    "active",
    o.note || null,
    o.actor || "sistema"
  );
  licEvent(ctx2, id, o.actor || "sistema", "issued", { type: o.type, order: o.orderId || null, expires: o.expiresAt || null, note: o.note || null });
  return { license: db.get("SELECT * FROM licenses WHERE id = ?", id), created: true };
}
function licenseUsable(ctx2, lic, now = ctx2.now()) {
  if (!lic) return { ok: false, code: "NAO_EXISTE", msg: "Chave de licença inválida." };
  if (lic.status === "revoked") return { ok: false, code: "REVOGADA", msg: "Esta licença foi revogada." };
  if (lic.status === "suspended") return { ok: false, code: "SUSPENSA", msg: "Esta licença está suspensa. Contacta o suporte." };
  if (lic.user_id) {
    const u = ctx2.db.get("SELECT status FROM users WHERE id = ?", lic.user_id);
    if (u && u.status === "blocked") return { ok: false, code: "CONTA_BLOQUEADA", msg: "A conta associada a esta licença está bloqueada." };
  }
  const grace = (getSetting(ctx2, "licensing").graceDays || 0) * 864e5;
  if (lic.expires_at && now > lic.expires_at + grace) return { ok: false, code: "EXPIRADA", msg: "O período desta licença terminou. Renova a subscrição para continuares." };
  if (lic.status === "expired" && !(lic.expires_at && now <= lic.expires_at + grace)) return { ok: false, code: "EXPIRADA", msg: "O período desta licença terminou." };
  return { ok: true };
}
var machineHash = (ctx2, mid) => sha256("machine:" + ctx2.cfg.secretKey + ":" + String(mid));
function tokenFor(ctx2, lic, dev, machineId) {
  const L = getSetting(ctx2, "licensing"), now = ctx2.now();
  return signToken(ctx2, {
    v: 1,
    lic: lic.id,
    key4: lic.key.slice(-4),
    typ: lic.type,
    prod: lic.product_id,
    maj: lic.major,
    mid: dev.machine_hash.slice(0, 32),
    // vínculo verificável pela app sem segredos: sha256('mmx-bind:' + identificador do computador)
    mb: machineId ? sha256("mmx-bind:" + String(machineId)).slice(0, 32) : void 0,
    iat: now,
    chk: now + (L.checkDays || 7) * 864e5,
    // perpétuas: sem expiração (funcionam offline); subscrições/demonstrações: até ao fim do período pago + tolerância
    exp: lic.expires_at ? lic.expires_at + (L.graceDays || 0) * 864e5 : null,
    until: lic.expires_at || null
  });
}
function activate(ctx2, { key, machineId, name, platform, appVersion }, ip) {
  if (!machineId || String(machineId).length < 8 || String(machineId).length > 200) fail(400, "Identificador do computador inválido.", "MAQUINA_INVALIDA");
  const db = ctx2.db, k = normKey(key);
  return db.tx(() => {
    const lic = db.get("SELECT * FROM licenses WHERE key = ?", k);
    const u = licenseUsable(ctx2, lic);
    if (!u.ok) fail(lic ? 403 : 404, u.msg, u.code);
    const mh = machineHash(ctx2, machineId), now = ctx2.now();
    const active = db.get("SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL", lic.id);
    if (active && active.machine_hash === mh) {
      db.run("UPDATE devices SET last_seen_at = ?, app_version = ?, name = COALESCE(?, name), platform = COALESCE(?, platform) WHERE id = ?", now, appVersion || active.app_version, name || null, platform || null, active.id);
      licEvent(ctx2, lic.id, "app", "reactivated_same_machine", { device: active.name, ip });
      return { token: tokenFor(ctx2, lic, active, machineId), license: publicLicense(lic), device: { name: active.name, platform: active.platform }, reused: true };
    }
    if (active) fail(409, `Esta licença já está ativa noutro computador (${active.name || "sem nome"}). Desativa-o na app ou na área de cliente para mudares de computador.`, "OUTRA_MAQUINA", { device: active.name, since: active.activated_at });
    const L = getSetting(ctx2, "licensing");
    const recent = db.get("SELECT COUNT(*) n FROM devices WHERE license_id = ? AND activated_at > ?", lic.id, Math.max(now - (L.transferWindowDays || 30) * 864e5, lic.transfer_reset_at || 0)).n;
    const used = db.get("SELECT COUNT(*) n FROM devices WHERE license_id = ?", lic.id).n;
    if (used > 0 && recent >= (L.transferLimit || 3)) fail(429, `Atingiste o limite de ${L.transferLimit} mudanças de computador em ${L.transferWindowDays} dias. Contacta o suporte para uma recuperação administrativa.`, "LIMITE_MUDANCAS");
    const dev = { id: uuid(), license_id: lic.id, machine_hash: mh, name: String(name || "Computador").slice(0, 80), platform: String(platform || "").slice(0, 40), app_version: String(appVersion || "").slice(0, 20) };
    db.run("INSERT INTO devices (id, license_id, machine_hash, name, platform, app_version, activated_at, last_seen_at) VALUES (?,?,?,?,?,?,?,?)", dev.id, lic.id, mh, dev.name, dev.platform, dev.app_version, now, now);
    licEvent(ctx2, lic.id, "app", "activated", { device: dev.name, platform: dev.platform, ip });
    if (lic.user_id) {
      const usr = db.get("SELECT * FROM users WHERE id = ?", lic.user_id);
      if (usr) mail(ctx2, usr.email, "device_changed", { name: usr.name, key4: lic.key.slice(-4), what: "ativada num computador", device: dev.name, date: new Date(now).toLocaleString("pt-PT") });
    }
    return { token: tokenFor(ctx2, lic, dev, machineId), license: publicLicense(lic), device: { name: dev.name, platform: dev.platform }, reused: false };
  });
}
function validate(ctx2, { key, machineId, appVersion }) {
  const db = ctx2.db, lic = db.get("SELECT * FROM licenses WHERE key = ?", normKey(key));
  const u = licenseUsable(ctx2, lic);
  if (!u.ok) return { ok: false, code: u.code, message: u.msg };
  const dev = db.get("SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL AND machine_hash = ?", lic.id, machineHash(ctx2, machineId));
  if (!dev) return { ok: false, code: "DESATIVADA", message: "Este computador já não está autorizado para esta licença." };
  db.run("UPDATE devices SET last_seen_at = ?, app_version = COALESCE(?, app_version) WHERE id = ?", ctx2.now(), appVersion || null, dev.id);
  return { ok: true, token: tokenFor(ctx2, lic, dev, machineId), license: publicLicense(lic) };
}
function deactivate(ctx2, lic, by, reason, onlyMachine) {
  const db = ctx2.db, dev = db.get("SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL", lic.id);
  if (!dev) return { ok: true, already: true };
  if (onlyMachine && dev.machine_hash !== machineHash(ctx2, onlyMachine)) fail(403, "Este computador não é o que está ativo nesta licença.", "OUTRA_MAQUINA");
  db.run("UPDATE devices SET deactivated_at = ?, deactivated_by = ?, deactivation_reason = ? WHERE id = ?", ctx2.now(), typeof by === "string" ? by : by.email, reason || null, dev.id);
  licEvent(ctx2, lic.id, by, "deactivated", { device: dev.name, reason: reason || null });
  if (lic.user_id) {
    const usr = db.get("SELECT * FROM users WHERE id = ?", lic.user_id);
    if (usr) mail(ctx2, usr.email, "device_changed", { name: usr.name, key4: lic.key.slice(-4), what: "desativada no computador", device: dev.name, date: (/* @__PURE__ */ new Date()).toLocaleString("pt-PT") });
  }
  return { ok: true, device: dev.name };
}
var publicLicense = (l) => ({ type: l.type, status: l.status, major: l.major, expires_at: l.expires_at, key4: l.key.slice(-4) });
function setLicenseStatus(ctx2, lic, status, actor, reason) {
  if (!reason || String(reason).trim().length < 3) fail(400, "Indica o motivo.", "MOTIVO_OBRIGATORIO");
  if (lic.status === "revoked" && status !== "revoked" && actor.role !== "owner") fail(403, "Só o administrador principal reativa licenças revogadas.", "SEM_PERMISSAO");
  ctx2.db.run("UPDATE licenses SET status = ?, status_reason = ? WHERE id = ?", status, reason, lic.id);
  licEvent(ctx2, lic.id, actor, "status_" + status, reason);
  audit(ctx2, actor, "license." + status, ["license", lic.id], { key4: lic.key.slice(-4) }, reason);
}

// server/src/core.js
function createContext(cfg2) {
  fs5.mkdirSync(cfg2.dataDir, { recursive: true });
  fs5.mkdirSync(path5.join(cfg2.dataDir, "uploads"), { recursive: true, mode: 448 });
  const db = openDb(path5.join(cfg2.dataDir, cfg2.test ? "mixmind-test.db" : "mixmind.db"));
  const ctx2 = { cfg: cfg2, db, cipher: makeCipher(cfg2.secretKey), now: () => Date.now(), log: (...a) => {
    if (!cfg2.quiet) console.log((/* @__PURE__ */ new Date()).toISOString(), ...a);
  } };
  seed(ctx2);
  return ctx2;
}
function seed(ctx2) {
  const { db, cfg: cfg2 } = ctx2, now = ctx2.now();
  if (!db.get("SELECT 1 FROM products WHERE id = ?", "mixmind")) db.run("INSERT INTO products VALUES (?, ?, ?)", "mixmind", "MIXMIND by Piradex", 1);
  if (!db.get("SELECT 1 FROM versions LIMIT 1")) db.run("INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?)", uuid(), "mixmind", "1.8.0", 1, "Loja, contas e licenças; editor de voz; WebAssembly.", cfg2.appUrl, null, null, 1, now);
  for (const p of PLANS) if (!db.get("SELECT 1 FROM plans WHERE id = ?", p.id)) db.run("INSERT INTO plans (id, name, kind, interval, price_usd_cents, active, sort) VALUES (?,?,?,?,?,1,?)", p.id, p.name, p.kind, p.interval, p.price_usd_cents, p.sort);
  const ds = defaultSettings(cfg2.test);
  for (const [k, v] of Object.entries(ds)) if (!db.get("SELECT 1 FROM settings WHERE key = ?", k)) db.run("INSERT INTO settings VALUES (?,?,?,?)", k, JSON.stringify(v), now, "sistema");
  for (const [k, t] of Object.entries(TEXTS)) if (!db.get("SELECT 1 FROM texts WHERE key = ?", k)) db.run("INSERT INTO texts (key, title, draft, updated_by, updated_at) VALUES (?,?,?,?,?)", k, t.title, t.body, "sistema", now);
  for (const [k, t] of Object.entries(EMAILS)) if (!db.get("SELECT 1 FROM texts WHERE key = ?", "email:" + k)) db.run("INSERT INTO texts (key, title, draft, published, updated_by, updated_at, published_at, published_by) VALUES (?,?,?,?,?,?,?,?)", "email:" + k, t.title, t.body, t.body, "sistema", now, now, "sistema");
  if (!db.get("SELECT 1 FROM users WHERE role = 'owner'") && cfg2.adminEmail && cfg2.adminInitialPassword) {
    db.run(
      "INSERT INTO users (id, email, name, role, status, email_verified_at, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
      uuid(),
      cfg2.adminEmail.toLowerCase(),
      "Administrador",
      "owner",
      "active",
      now,
      hashPassword(cfg2.adminInitialPassword),
      now,
      now
    );
    db.run("INSERT INTO audit_log (at, actor_email, action, target_type, details) VALUES (?,?,?,?,?)", now, "sistema", "admin.bootstrap", "user", "Administrador inicial criado a partir de ADMIN_EMAIL/ADMIN_INITIAL_PASSWORD (troca obrigatória no primeiro acesso).");
    ctx2.log("Administrador inicial criado para", cfg2.adminEmail, "— troca de palavra-passe obrigatória no primeiro acesso.");
  }
  if (!/github\.io/.test(cfg2.appUrl)) db.run("UPDATE versions SET url_web = ? WHERE url_web LIKE '%.github.io/%'", cfg2.appUrl);
  adminReset(ctx2);
  betaAccounts(ctx2);
}
function adminReset(ctx2) {
  const { db, cfg: cfg2 } = ctx2, pw = cfg2.adminResetPassword, now = ctx2.now();
  if (!pw) return;
  const done = getSetting(ctx2, "admin_reset");
  if (done && done.mark && verifyPassword(pw, done.mark)) return;
  const email = (cfg2.adminEmail || "").trim().toLowerCase();
  let u = email && db.get("SELECT * FROM users WHERE email = ? AND role = 'owner'", email) || db.get("SELECT * FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1");
  if (!u) {
    if (!email) {
      ctx2.log("ADMIN_RESET_PASSWORD ignorada: define também ADMIN_EMAIL.");
      return;
    }
    db.run("INSERT INTO users (id, email, name, role, status, email_verified_at, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)", uuid(), email, "Administrador", "owner", "active", now, hashPassword(pw), now, now);
  } else {
    let to = u.email;
    if (email && email !== u.email.toLowerCase()) {
      if (db.get("SELECT 1 FROM users WHERE email = ? AND id <> ?", email, u.id)) ctx2.log("ADMIN_EMAIL já pertence a outra conta — o email do administrador mantém-se", u.email);
      else to = email;
    }
    db.run("UPDATE users SET email = ?, password_hash = ?, must_change_password = 1, status = 'active', status_reason = NULL, updated_at = ? WHERE id = ?", to, hashPassword(pw), now, u.id);
    if (cfg2.adminReset2fa) db.run("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", u.id);
    db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, u.id);
    db.run("DELETE FROM login_attempts WHERE key IN (?, ?)", "e:" + to.toLowerCase(), "m:" + u.id);
  }
  setSetting(ctx2, "admin_reset", { mark: hashPassword(pw), at: now }, "sistema");
  db.run("INSERT INTO audit_log (at, actor_email, action, target_type, details) VALUES (?,?,?,?,?)", now, "sistema", "admin.reset", "user", "Acesso do administrador reposto a partir de ADMIN_RESET_PASSWORD" + (cfg2.adminReset2fa ? " (2FA desligado)" : "") + " — troca obrigatória no primeiro acesso.");
  ctx2.log("Acesso do administrador reposto a partir de ADMIN_RESET_PASSWORD (troca obrigatória no 1.º acesso). Podes apagar ADMIN_RESET_PASSWORD no alojamento.");
}
function parseBeta(raw) {
  const out = [], bad = [];
  for (const item of String(raw || "").split(/[\s,;]+/).filter(Boolean)) {
    const m = /^([a-z0-9][a-z0-9._@+-]{2,63}):(scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+)(?::(\d{4}-\d{2}-\d{2}))?$/i.exec(item);
    if (!m) {
      bad.push(item.split(":")[0]);
      continue;
    }
    out.push({ id: m[1].toLowerCase(), hash: m[2], until: m[3] ? Date.parse(m[3] + "T23:59:59Z") : null });
  }
  return { list: out, bad };
}
function betaAccounts(ctx2) {
  const { db, cfg: cfg2 } = ctx2, now = ctx2.now();
  const { list, bad } = parseBeta(cfg2.betaAccess);
  if (bad.length) ctx2.log("BETA_ACESSOS: entradas ignoradas (formato inválido):", bad.join(", "));
  const applied = getSetting(ctx2, "beta_applied") || {}, seen = /* @__PURE__ */ new Set();
  db.tx(() => {
    for (const e of list) {
      seen.add(e.id);
      const mark = sha256("beta:" + e.hash);
      let u = db.get("SELECT * FROM users WHERE email = ?", e.id);
      if (u && u.role !== "customer") {
        ctx2.log('BETA_ACESSOS: "' + e.id + '" é uma conta da equipa — ignorada.');
        continue;
      }
      if (!u) {
        db.run("INSERT INTO users (id, email, name, role, status, email_verified_at, password_hash, must_change_password, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,?,?)", uuid(), e.id, "Beta tester " + e.id, "customer", "active", now, e.hash, now, now);
        u = db.get("SELECT * FROM users WHERE email = ?", e.id);
        db.run("INSERT INTO audit_log (at, actor_email, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)", now, "sistema", "beta.create", "user", u.id, "Conta beta criada a partir de BETA_ACESSOS: " + e.id);
      } else if (applied[e.id] !== mark) {
        db.run("UPDATE users SET password_hash = ?, status = CASE WHEN status = 'blocked' THEN status ELSE 'active' END, status_reason = NULL, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?", e.hash, now, now, u.id);
        db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, u.id);
        db.run("INSERT INTO audit_log (at, actor_email, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)", now, "sistema", "beta.password", "user", u.id, "Palavra-passe beta atualizada a partir de BETA_ACESSOS: " + e.id);
      } else if (u.status === "suspended" && u.status_reason === "Acesso beta retirado") {
        db.run("UPDATE users SET status = 'active', status_reason = NULL, updated_at = ? WHERE id = ?", now, u.id);
      }
      const lic = db.get("SELECT * FROM licenses WHERE user_id = ? AND note = 'beta' ORDER BY issued_at DESC LIMIT 1", u.id);
      if (!lic) issueLicense(ctx2, { userId: u.id, type: "gift", expiresAt: e.until, actor: "sistema", note: "beta" });
      else if ((lic.expires_at || null) !== e.until && lic.status !== "revoked") {
        db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", e.until, lic.id);
        licEvent(ctx2, lic.id, "sistema", "beta.validade", { expires: e.until });
      }
      applied[e.id] = mark;
    }
    for (const id of Object.keys(applied)) {
      if (seen.has(id)) continue;
      const u = db.get("SELECT * FROM users WHERE email = ? AND role = 'customer'", id);
      if (u && u.status !== "blocked") {
        db.run("UPDATE users SET status = 'suspended', status_reason = 'Acesso beta retirado', updated_at = ? WHERE id = ?", now, u.id);
        db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, u.id);
        db.run("INSERT INTO audit_log (at, actor_email, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)", now, "sistema", "beta.remove", "user", u.id, "Retirado de BETA_ACESSOS: " + id);
      }
      delete applied[id];
    }
  });
  setSetting(ctx2, "beta_applied", applied, "sistema");
  if (list.length) ctx2.log("Beta testers ativos:", list.map((e) => e.id).join(", "));
}
var getSetting = (ctx2, k) => {
  const r = ctx2.db.get("SELECT value FROM settings WHERE key = ?", k);
  return r ? JSON.parse(r.value) : null;
};
var setSetting = (ctx2, k, v, by) => ctx2.db.run("INSERT INTO settings VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by", k, JSON.stringify(v), ctx2.now(), by || null);
function getText(ctx2, key) {
  return ctx2.db.get("SELECT * FROM texts WHERE key = ?", key);
}
function publicText(ctx2, key) {
  const t = getText(ctx2, key);
  if (!t) return null;
  if (t.published) return { title: t.title, body: t.published, provisional: false, published_at: t.published_at };
  return ctx2.cfg.test ? { title: t.title, body: t.draft, provisional: true } : { title: t.title, body: null, provisional: true };
}
var legalReady = (ctx2) => ["terms", "privacy", "refund"].every((k) => {
  const t = getText(ctx2, k);
  return t && t.published;
});
var fill = (s, v) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] === void 0 || v[k] === null ? "" : String(v[k]));
async function sendEmail(ctx2, to, template, vars) {
  const t = getText(ctx2, "email:" + template);
  if (!t) throw new Error("Template inexistente: " + template);
  const v = { product: "MIXMIND by Piradex", ...vars };
  const text = fill(t.published || t.draft, v);
  const m = /^Assunto:\s*(.*)\n+/.exec(text);
  const subject = m ? m[1].trim() : t.title, body = m ? text.slice(m[0].length) : text;
  const now = ctx2.now(), E = ctx2.cfg.email;
  const id = ctx2.db.run("INSERT INTO emails (to_addr, template, subject, body, status, created_at) VALUES (?,?,?,?,?,?)", to, template, subject, body, E.provider === "outbox" ? "test" : "queued", now).lastInsertRowid;
  if (E.provider === "outbox") return { id, subject, body };
  try {
    let r;
    if (E.provider === "resend") r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + E.apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ from: E.from, to: [to], subject, text: body }) });
    else if (E.provider === "postmark") r = await fetch("https://api.postmarkapp.com/email", { method: "POST", headers: { "X-Postmark-Server-Token": E.apiKey, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ From: E.from, To: to, Subject: subject, TextBody: body, MessageStream: "outbound" }) });
    else throw new Error("EMAIL_PROVIDER desconhecido: " + E.provider);
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    ctx2.db.run("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ?", ctx2.now(), id);
  } catch (e) {
    ctx2.db.run("UPDATE emails SET status = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 500), id);
    ctx2.log("Email falhou", template, to, e.message);
  }
  return { id, subject, body };
}
var mail = (ctx2, to, template, vars) => {
  sendEmail(ctx2, to, template, vars).catch((e) => ctx2.log("Email", e.message));
};
function audit(ctx2, actor, action, target, details, reason) {
  ctx2.db.run(
    "INSERT INTO audit_log (at, actor_id, actor_email, action, target_type, target_id, reason, details, ip) VALUES (?,?,?,?,?,?,?,?,?)",
    ctx2.now(),
    actor && actor.id || null,
    actor && actor.email || (typeof actor === "string" ? actor : null),
    action,
    target && target[0] || null,
    target && target[1] || null,
    reason || null,
    details ? typeof details === "string" ? details : JSON.stringify(details) : null,
    actor && actor.ip || null
  );
}
var ROLES = { owner: "Administrador principal", finance: "Financeiro", support: "Suporte" };
var P = {
  "dashboard.view": ["owner", "finance", "support"],
  "customers.view": ["owner", "finance", "support"],
  "customers.edit": ["owner", "support"],
  "customers.suspend": ["owner", "support"],
  "customers.block": ["owner"],
  "orders.view": ["owner", "finance", "support"],
  "payments.validate": ["owner", "finance"],
  "payments.refund": ["owner", "finance"],
  "payments.events": ["owner", "finance"],
  "licenses.view": ["owner", "finance", "support"],
  "licenses.manage": ["owner", "support"],
  // suspender/reativar, desativar computador, mudança de computador
  "licenses.revoke": ["owner"],
  "licenses.issue": ["owner"],
  // ofertas, lotes, demonstrações
  "subscriptions.manage": ["owner", "finance"],
  // prolongar, aprovar renovações, cancelar renovação
  "settings.view": ["owner", "finance"],
  "settings.edit": ["owner"],
  "texts.edit": ["owner"],
  "texts.publish": ["owner"],
  "staff.manage": ["owner"],
  "audit.view": ["owner"],
  "emails.view": ["owner", "support"]
};
var can = (user, perm) => !!user && (P[perm] || []).includes(user.role);
var permsOf = (role) => Object.keys(P).filter((k) => P[k].includes(role));
function need(user, perm) {
  if (!can(user, perm)) fail(403, "Não tens permissão para esta operação.", "SEM_PERMISSAO");
}
function createSession(ctx2, user, req, mfaOk) {
  const token2 = randomToken(32), now = ctx2.now();
  ctx2.db.run("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, ua, mfa_ok) VALUES (?,?,?,?,?,?,?,?)", sha256(token2), user.id, now, now + ctx2.cfg.sessionDays * 864e5, now, req.ip, String(req.headers["user-agent"] || "").slice(0, 200), mfaOk ? 1 : 0);
  return token2;
}
function sessionCookie(ctx2, token2, maxAgeS) {
  return `mm_s=${token2}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS === void 0 ? ctx2.cfg.sessionDays * 86400 : maxAgeS}${ctx2.cfg.test ? "" : "; Secure"}`;
}
var fmtMoney = (cents, cur) => {
  const v = cents / 100;
  const s = v.toLocaleString("pt-PT", { minimumFractionDigits: cur === "AOA" ? 0 : 2, maximumFractionDigits: cur === "AOA" ? 0 : 2 });
  return cur === "USD" ? `US$${s}` : cur === "EUR" ? `${s} €` : `${s} Kz`;
};
function annualSaving(ctx2) {
  const m = ctx2.db.get("SELECT price_usd_cents p FROM plans WHERE id = 'monthly'"), a = ctx2.db.get("SELECT price_usd_cents p FROM plans WHERE id = 'annual'");
  if (!m || !a) return null;
  return Math.round((1 - a.p / (12 * m.p)) * 1e3) / 10;
}
function quote(ctx2, plan, method, country) {
  const cur = method === "bank_pt" ? getSetting(ctx2, "bank_pt").currency || "EUR" : method === "bank_ao" ? getSetting(ctx2, "bank_ao").currency || "AOA" : "USD";
  const rates = getSetting(ctx2, "currencies").rates || {};
  let fx = 1;
  if (cur !== "USD") {
    fx = rates[cur] && rates[cur].rate;
    if (!fx || fx <= 0) fail(400, `Câmbio USD→${cur} ainda não configurado. Escolhe outro método de pagamento.`, "CAMBIO_EM_FALTA");
  }
  const round = cur === "AOA" ? 100 : 1;
  const base = Math.round(plan.price_usd_cents * fx / round) * round;
  const tx = getSetting(ctx2, "taxes"), rule = (tx.rules || []).find((r) => r.country === country);
  const rate = rule ? +rule.rate : 0;
  const tax = tx.mode === "included" ? 0 : Math.round(base * rate / 100 / round) * round;
  return { currency: cur, fx, net_cents: base, tax_cents: tax, tax_rate: rate, tax_label: rule ? rule.label : null, tax_mode: tx.mode, total_cents: base + tax, usd_cents: plan.price_usd_cents };
}

// server/src/server.js
import http from "node:http";
import path8 from "node:path";
import { URL } from "node:url";

// server/src/jobs.js
function runJobs(ctx2) {
  const db = ctx2.db, now = ctx2.now(), L = getSetting(ctx2, "licensing"), grace = (L.graceDays || 0) * 864e5;
  const out = { expired: 0, reminders: 0, ordersExpired: 0 };
  for (const s of db.all("SELECT * FROM subscriptions WHERE status IN ('active','past_due','cancelled') AND current_period_end IS NOT NULL AND current_period_end + ? < ?", grace, now)) {
    db.run("UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE id = ?", now, s.id);
    const lic = db.get("SELECT * FROM licenses WHERE subscription_id = ? AND status = 'active'", s.id);
    if (lic) {
      db.run("UPDATE licenses SET status = 'expired', status_reason = 'Fim do período pago' WHERE id = ?", lic.id);
      licEvent(ctx2, lic.id, "sistema", "expired", "Fim do período pago");
    }
    out.expired++;
  }
  for (const l of db.all("SELECT * FROM licenses WHERE status = 'active' AND subscription_id IS NULL AND expires_at IS NOT NULL AND expires_at + ? < ?", grace, now)) {
    db.run("UPDATE licenses SET status = 'expired', status_reason = 'Validade terminada' WHERE id = ?", l.id);
    licEvent(ctx2, l.id, "sistema", "expired", "Validade terminada");
    out.expired++;
  }
  for (const s of db.all("SELECT * FROM subscriptions WHERE status IN ('active','past_due') AND current_period_end BETWEEN ? AND ? AND (reminder_for IS NULL OR reminder_for != current_period_end)", now, now + 7 * 864e5)) {
    const u = db.get("SELECT * FROM users WHERE id = ?", s.user_id), plan = db.get("SELECT * FROM plans WHERE id = ?", s.plan_id);
    const action = s.cancel_at_period_end ? "A renovação está cancelada: o acesso termina nessa data." : s.auto_renew ? "Será renovada automaticamente pelo método de pagamento associado." : "Esta subscrição é paga por transferência: renova-a na área de cliente antes dessa data.";
    mail(ctx2, u.email, "renewal_reminder", { name: u.name, plan: plan.name, date: new Date(s.current_period_end).toLocaleDateString("pt-PT"), action, link: ctx2.cfg.publicUrl + "/conta#subscricoes" });
    db.run("UPDATE subscriptions SET reminder_for = current_period_end WHERE id = ?", s.id);
    out.reminders++;
  }
  out.ordersExpired += db.run("UPDATE orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND method IN ('bank_pt','bank_ao') AND due_at < ? AND NOT EXISTS (SELECT 1 FROM proofs p WHERE p.order_id = orders.id AND p.status IN ('submitted','needs_info'))", now, now).changes;
  out.ordersExpired += db.run("UPDATE orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND method IN ('card','paypal','test') AND created_at < ?", now, now - 48 * 36e5).changes;
  db.run("DELETE FROM sessions WHERE expires_at < ? OR revoked_at < ?", now, now - 30 * 864e5);
  db.run("DELETE FROM login_attempts WHERE at < ?", now - 864e5);
  db.run("DELETE FROM tokens WHERE expires_at < ?", now - 7 * 864e5);
  return out;
}

// server/src/routes/auth.js
import crypto3 from "node:crypto";

// server/src/routes/util.js
function requireUser(req) {
  if (!req.user) fail(401, "Inicia sessão para continuar.", "SEM_SESSAO");
  return req.user;
}
function requireStaff(req, perm) {
  const u = requireUser(req);
  if (u.role === "customer") fail(403, "Acesso reservado à equipa.", "SEM_PERMISSAO");
  if (!req.session.mfa_ok) fail(401, "Falta o código de dois fatores.", "MFA_PENDENTE");
  if (u.must_change_password) fail(403, "Tens de alterar a palavra-passe inicial antes de continuar.", "TROCA_PALAVRA_PASSE");
  if (!u.totp_enabled && req.ctx && getSetting(req.ctx, "security").require2faForStaff) fail(403, "Ativa a autenticação de dois fatores para continuar.", "MFA_OBRIGATORIA");
  if (perm) need(u, perm);
  return u;
}
var str = (v, max = 200) => String(v === void 0 || v === null ? "" : v).trim().slice(0, max);
var emailOk = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e || "");
var countryOk = (c) => /^[A-Z]{2}$/.test(c || "");
var safeUser = (u) => u && { id: u.id, email: u.email, name: u.name, country: u.country, role: u.role, status: u.status, status_reason: u.status_reason, email_verified: !!u.email_verified_at, must_change_password: !!u.must_change_password, totp_enabled: !!u.totp_enabled, billing_name: u.billing_name, billing_address: u.billing_address, tax_id: u.tax_id, created_at: u.created_at, last_login_at: u.last_login_at, invited: !u.password_hash };

// server/src/routes/auth.js
function makeToken(ctx2, userId, kind, ttlMs) {
  const t = randomToken(32), now = ctx2.now();
  ctx2.db.run("INSERT INTO tokens (id, user_id, kind, created_at, expires_at) VALUES (?,?,?,?,?)", sha256(t), userId, kind, now, now + ttlMs);
  return t;
}
function useToken(ctx2, token2, kinds) {
  const row = ctx2.db.get("SELECT * FROM tokens WHERE id = ?", sha256(String(token2 || "")));
  if (!row || row.used_at || row.expires_at < ctx2.now() || !kinds.includes(row.kind)) fail(400, "Ligação inválida ou expirada. Pede uma nova.", "TOKEN_INVALIDO");
  ctx2.db.run("UPDATE tokens SET used_at = ? WHERE id = ?", ctx2.now(), row.id);
  return row;
}
function sendVerification(ctx2, u) {
  mail(ctx2, u.email, "account_confirm", { name: u.name, link: `${ctx2.cfg.publicUrl}/verificar?token=${makeToken(ctx2, u.id, "verify", 48 * 36e5)}` });
}
function sendReset(ctx2, u, kind = "reset") {
  const ttl = kind === "invite" ? 7 * 864e5 : 36e5;
  mail(ctx2, u.email, kind === "invite" ? "invite" : "password_reset", { name: u.name, link: `${ctx2.cfg.publicUrl}/redefinir?token=${makeToken(ctx2, u.id, kind, ttl)}${kind === "invite" ? "&convite=1" : ""}` });
}
function createCustomer(ctx2, { name, email, password, country }) {
  name = str(name, 100);
  email = str(email, 254).toLowerCase();
  country = str(country, 2).toUpperCase();
  if (name.length < 2) fail(400, "Indica o teu nome.", "NOME");
  if (!emailOk(email)) fail(400, "Email inválido.", "EMAIL");
  if (country && !countryOk(country)) fail(400, "País inválido.", "PAIS");
  if (ctx2.db.get("SELECT 1 FROM users WHERE email = ?", email)) fail(409, "Já existe uma conta com este email. Entra na tua conta para continuar.", "EMAIL_EXISTE");
  if (password !== void 0) {
    const p = passwordProblem(password, email);
    if (p) fail(400, p, "PALAVRA_PASSE_FRACA");
  }
  const id = uuid(), now = ctx2.now();
  ctx2.db.run("INSERT INTO users (id, email, name, country, password_hash, role, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", id, email, name, country || null, password !== void 0 ? hashPassword(password) : null, "customer", "pending", now, now);
  return ctx2.db.get("SELECT * FROM users WHERE id = ?", id);
}
function authenticate(ctx2, req, emailIn, password) {
  const email = str(emailIn, 254).toLowerCase(), S = getSetting(ctx2, "security"), now = ctx2.now();
  const since = now - S.lockMinutes * 6e4;
  const fails = (k) => ctx2.db.get("SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ? AND ok = 0", k, since).n;
  if (fails("e:" + email) >= S.loginMaxAttempts || fails("i:" + req.ip) >= S.loginMaxAttempts * 4) fail(429, `Demasiadas tentativas. Tenta novamente dentro de ${S.lockMinutes} minutos ou recupera a palavra-passe.`, "BLOQUEIO_TEMPORARIO");
  const u = ctx2.db.get("SELECT * FROM users WHERE email = ?", email);
  const ok = u && u.password_hash && verifyPassword(String(password || ""), u.password_hash);
  const note = (good) => {
    ctx2.db.run("INSERT INTO login_attempts VALUES (?,?,?)", "e:" + email, now, good ? 1 : 0);
    ctx2.db.run("INSERT INTO login_attempts VALUES (?,?,?)", "i:" + req.ip, now, good ? 1 : 0);
  };
  if (!ok) {
    if (!u) verifyPassword("x", null);
    note(false);
    fail(401, "Email ou palavra-passe incorretos.", "CREDENCIAIS");
  }
  if (u.status === "blocked") {
    note(false);
    fail(403, "Esta conta está bloqueada. Contacta o suporte.", "CONTA_BLOQUEADA");
  }
  if (u.status === "suspended") {
    note(false);
    fail(403, "O acesso a esta conta está suspenso. Contacta o suporte.", "CONTA_SUSPENSA");
  }
  note(true);
  ctx2.db.run("UPDATE users SET last_login_at = ? WHERE id = ?", now, u.id);
  return u;
}
var meOf = (ctx2, req) => req.user ? { user: safeUser(req.user), mfaPending: !req.session.mfa_ok, perms: req.user.role === "customer" ? [] : permsOf(req.user.role), roleLabel: ROLES[req.user.role] || "Cliente", require2fa: req.user.role !== "customer" && getSetting(ctx2, "security").require2faForStaff && !req.user.totp_enabled } : { user: null };
function register(r, ctx2) {
  r.get("/api/auth/me", (req) => meOf(ctx2, req));
  r.post("/api/auth/register", (req, res) => {
    const b = req.body;
    if (!b.acceptTerms) fail(400, "Tens de aceitar os termos e a política de privacidade.", "TERMOS");
    const u = createCustomer(ctx2, b);
    sendVerification(ctx2, u);
    res.setHeader("Set-Cookie", sessionCookie(ctx2, createSession(ctx2, u, req, true)));
    return { user: safeUser(u) };
  });
  r.post("/api/auth/login", (req, res) => {
    const u = authenticate(ctx2, req, req.body.email, req.body.password);
    const needMfa = u.role !== "customer" && !!u.totp_enabled;
    res.setHeader("Set-Cookie", sessionCookie(ctx2, createSession(ctx2, u, req, !needMfa)));
    if (u.role !== "customer") audit(ctx2, { ...u, ip: req.ip }, "staff.login", ["user", u.id], needMfa ? "aguarda 2FA" : null);
    return { user: safeUser(u), mfaPending: needMfa, mustChangePassword: !!u.must_change_password };
  });
  r.post("/api/auth/mfa", (req) => {
    const u = requireUser(req);
    if (!u.totp_enabled) fail(400, "2FA não está ativo.", "MFA");
    const S = getSetting(ctx2, "security"), now = ctx2.now();
    if (ctx2.db.get("SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ? AND ok = 0", "m:" + u.id, now - S.lockMinutes * 6e4).n >= S.loginMaxAttempts) fail(429, "Demasiadas tentativas de código.", "BLOQUEIO_TEMPORARIO");
    const ok = verifyTotp(ctx2.cipher.dec(u.totp_secret), req.body.code, now);
    ctx2.db.run("INSERT INTO login_attempts VALUES (?,?,?)", "m:" + u.id, now, ok ? 1 : 0);
    if (!ok) fail(401, "Código inválido.", "MFA_CODIGO");
    ctx2.db.run("UPDATE sessions SET mfa_ok = 1 WHERE id = ?", req.session.id);
    audit(ctx2, u, "staff.mfa_ok", ["user", u.id]);
    return { ok: true };
  });
  r.post("/api/auth/logout", (req, res) => {
    if (req.session) ctx2.db.run("UPDATE sessions SET revoked_at = ? WHERE id = ?", ctx2.now(), req.session.id);
    res.setHeader("Set-Cookie", sessionCookie(ctx2, "", 0));
    return { ok: true };
  });
  r.post("/api/auth/verify", (req) => {
    const t = useToken(ctx2, req.body.token, ["verify"]);
    ctx2.db.run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", ctx2.now(), ctx2.now(), t.user_id);
    return { ok: true };
  });
  r.post("/api/auth/resend-verification", (req) => {
    const u = requireUser(req);
    if (!u.email_verified_at) sendVerification(ctx2, u);
    return { ok: true };
  });
  r.post("/api/auth/forgot", (req) => {
    const email = str(req.body.email, 254).toLowerCase(), now = ctx2.now();
    const recent = ctx2.db.get("SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ?", "r:" + email, now - 36e5).n;
    ctx2.db.run("INSERT INTO login_attempts VALUES (?,?,?)", "r:" + email, now, 1);
    const u = ctx2.db.get("SELECT * FROM users WHERE email = ?", email);
    if (u && u.status !== "blocked" && recent < 5) sendReset(ctx2, u, u.password_hash ? "reset" : "invite");
    return { ok: true, message: "Se existir uma conta com esse email, vais receber uma ligação para definir uma nova palavra-passe." };
  });
  r.post("/api/auth/reset", (req) => {
    const t = useToken(ctx2, req.body.token, ["reset", "invite"]);
    const u = ctx2.db.get("SELECT * FROM users WHERE id = ?", t.user_id);
    const p = passwordProblem(req.body.password, u.email);
    if (p) fail(400, p, "PALAVRA_PASSE_FRACA");
    const now = ctx2.now();
    ctx2.db.run("UPDATE users SET password_hash = ?, must_change_password = 0, email_verified_at = COALESCE(email_verified_at, ?), status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", hashPassword(req.body.password), now, now, u.id);
    ctx2.db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, u.id);
    audit(ctx2, u, "user.password_reset", ["user", u.id], t.kind);
    return { ok: true };
  });
  r.post("/api/auth/change-password", (req) => {
    const u = requireUser(req);
    if (!verifyPassword(String(req.body.current || ""), u.password_hash)) fail(400, "A palavra-passe atual não está correta.", "CREDENCIAIS");
    const p = passwordProblem(req.body.password, u.email);
    if (p) fail(400, p, "PALAVRA_PASSE_FRACA");
    if (req.body.password === req.body.current) fail(400, "A nova palavra-passe tem de ser diferente.", "IGUAL");
    const now = ctx2.now();
    ctx2.db.run("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?", hashPassword(req.body.password), now, u.id);
    ctx2.db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL", now, u.id, req.session.id);
    audit(ctx2, u, "user.password_change", ["user", u.id]);
    return { ok: true };
  });
  r.get("/api/auth/sessions", (req) => {
    const u = requireUser(req);
    return ctx2.db.all("SELECT id, created_at, last_seen_at, ip, ua FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC", u.id, ctx2.now()).map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === req.session.id }));
  });
  r.post("/api/auth/sessions/:id/revoke", (req) => {
    const u = requireUser(req);
    ctx2.db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND substr(id, 1, 16) = ?", ctx2.now(), u.id, req.params.id);
    return { ok: true };
  });
  r.post("/api/auth/mfa/setup", (req) => {
    const u = requireUser(req);
    if (u.totp_enabled) fail(400, "2FA já está ativo.", "MFA");
    const secret = base32(crypto3.randomBytes(20));
    ctx2.db.run("UPDATE users SET totp_secret = ? WHERE id = ?", ctx2.cipher.enc(secret), u.id);
    return { secret, uri: `otpauth://totp/${encodeURIComponent("MIXMIND:" + u.email)}?secret=${secret}&issuer=MIXMIND&algorithm=SHA1&digits=6&period=30` };
  });
  r.post("/api/auth/mfa/enable", (req) => {
    const u = requireUser(req);
    if (!u.totp_secret || !verifyTotp(ctx2.cipher.dec(u.totp_secret), req.body.code, ctx2.now())) fail(400, "Código inválido. Confirma a hora do telemóvel e tenta de novo.", "MFA_CODIGO");
    ctx2.db.run("UPDATE users SET totp_enabled = 1 WHERE id = ?", u.id);
    ctx2.db.run("UPDATE sessions SET mfa_ok = 1 WHERE id = ?", req.session.id);
    audit(ctx2, u, "user.mfa_enable", ["user", u.id]);
    return { ok: true };
  });
  r.post("/api/auth/mfa/disable", (req) => {
    const u = requireUser(req);
    if (!verifyPassword(String(req.body.password || ""), u.password_hash) || !verifyTotp(ctx2.cipher.dec(u.totp_secret), req.body.code, ctx2.now())) fail(400, "Palavra-passe ou código inválidos.", "MFA_CODIGO");
    if (u.role !== "customer" && getSetting(ctx2, "security").require2faForStaff) fail(403, "A 2FA é obrigatória para a equipa.", "MFA_OBRIGATORIA");
    ctx2.db.run("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?", u.id);
    audit(ctx2, u, "user.mfa_disable", ["user", u.id]);
    return { ok: true };
  });
}

// server/src/payments/index.js
import fs6 from "node:fs";
import path6 from "node:path";

// server/src/payments/orders.js
var REF = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newRef(ctx2) {
  const d = new Date(ctx2.now()), yymm = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, "0");
  let r;
  do {
    r = "MMX-" + yymm + "-" + Array.from({ length: 6 }, () => REF[Math.floor(Math.random() * 32)]).join("");
  } while (ctx2.db.get("SELECT 1 FROM orders WHERE ref = ?", r));
  return r;
}
var METHOD_LABEL = { card: "Cartão (Visa, Mastercard…)", paypal: "PayPal", bank_pt: "Transferência bancária — Portugal", bank_ao: "Transferência bancária — Angola", test: "Pagamento simulado (modo de testes)", gift: "Oferta" };
var addInterval = (t, interval) => {
  const d = new Date(t);
  if (interval === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
};
function createOrder(ctx2, user, planId, method, country, billing, opts = {}) {
  const plan = ctx2.db.get("SELECT * FROM plans WHERE id = ? AND active = 1", planId);
  if (!plan) fail(400, "Plano indisponível.", "PLANO_INVALIDO");
  const q = quote(ctx2, plan, method, country);
  const id = uuid(), ref = newRef(ctx2), now = ctx2.now();
  const bank = method === "bank_pt" || method === "bank_ao" ? getSetting(ctx2, method) : null;
  const due = bank ? now + (bank.deadlineDays || 5) * 864e5 : now + 864e5;
  ctx2.db.run(`INSERT INTO orders (id, ref, user_id, plan_id, kind, subscription_id, method, currency, amount_cents, tax_cents, tax_rate, usd_cents, fx_rate, country, billing, status, created_at, due_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ref, user.id, plan.id, opts.kind || "purchase", opts.subscriptionId || null, method, q.currency, q.total_cents, q.tax_cents, q.tax_rate, q.usd_cents, q.fx, country || null, JSON.stringify(billing || {}), "pending", now, due, now);
  const order = ctx2.db.get("SELECT * FROM orders WHERE id = ?", id);
  mail(ctx2, user.email, "order_created", { name: user.name, ref, plan: plan.name, amount: fmtMoney(order.amount_cents, order.currency), method: METHOD_LABEL[method], link: ctx2.cfg.publicUrl + "/conta#encomendas" });
  return { order, plan, quote: q };
}
function confirmOrder(ctx2, orderId, p) {
  const db = ctx2.db;
  const res = db.tx(() => {
    const order = db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!order) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    const dup = db.get("SELECT * FROM payments WHERE provider = ? AND provider_payment_id = ?", p.provider, p.paymentId);
    if (dup && dup.status === "confirmed") return { order, duplicate: true };
    if (order.status === "confirmed") return { order, duplicate: true };
    if (["refunded", "disputed"].includes(order.status)) fail(409, "Encomenda reembolsada ou contestada.", "ESTADO_INVALIDO");
    const now = ctx2.now();
    if (dup) db.run("UPDATE payments SET status = 'confirmed', confirmed_by = ?, updated_at = ? WHERE id = ?", p.actor || null, now, dup.id);
    else db.run("INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_cents, currency, confirmed_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", uuid(), order.id, p.provider, p.paymentId, "confirmed", p.amountCents ?? order.amount_cents, p.currency || order.currency, p.actor || null, now, now);
    db.run("UPDATE orders SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?", now, now, order.id);
    const plan = db.get("SELECT * FROM plans WHERE id = ?", order.plan_id);
    const prod = db.get("SELECT major FROM products WHERE id = 'mixmind'");
    let license = null, created = false, sub = null, renewed = false;
    if (order.kind === "renewal") {
      sub = db.get("SELECT * FROM subscriptions WHERE id = ?", order.subscription_id);
      const end = p.periodEnd || addInterval(Math.max(now, sub.current_period_end || now), plan.interval);
      db.run("UPDATE subscriptions SET status = 'active', current_period_end = ?, cancel_at_period_end = 0, updated_at = ? WHERE id = ?", end, now, sub.id);
      license = db.get("SELECT * FROM licenses WHERE subscription_id = ?", sub.id);
      if (license) {
        db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", end, license.id);
        licEvent(ctx2, license.id, p.actor || p.provider, "renewed", { until: end, order: order.ref });
      }
      renewed = true;
      sub.current_period_end = end;
    } else if (plan.kind === "perpetual") {
      ({ license, created } = issueLicense(ctx2, { userId: order.user_id, type: "perpetual", orderId: order.id, major: prod.major, actor: p.actor || p.provider }));
    } else {
      const end = p.periodEnd || addInterval(now, plan.interval), sid = uuid();
      const auto = ["card", "paypal", "test"].includes(order.method) ? 1 : 0;
      db.run(
        "INSERT INTO subscriptions (id, user_id, plan_id, method, provider, provider_sub_id, status, auto_renew, current_period_start, current_period_end, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        sid,
        order.user_id,
        plan.id,
        order.method,
        p.providerSubId ? p.provider : null,
        p.providerSubId || null,
        "active",
        auto,
        now,
        end,
        now,
        now
      );
      db.run("UPDATE orders SET subscription_id = ? WHERE id = ?", sid, order.id);
      sub = db.get("SELECT * FROM subscriptions WHERE id = ?", sid);
      ({ license, created } = issueLicense(ctx2, { userId: order.user_id, type: "subscription", orderId: order.id, subscriptionId: sid, major: prod.major, expiresAt: end, actor: p.actor || p.provider }));
    }
    return { order: db.get("SELECT * FROM orders WHERE id = ?", order.id), plan, license, created, sub, renewed };
  });
  if (!res.duplicate) {
    const u = ctx2.db.get("SELECT * FROM users WHERE id = ?", res.order.user_id);
    mail(ctx2, u.email, "payment_approved", { name: u.name, ref: res.order.ref });
    if (res.created) mail(ctx2, u.email, "license_issued", { name: u.name, plan: res.plan.name, key: res.license.key, link: ctx2.cfg.publicUrl + "/conta#licencas" });
    if (res.renewed) mail(ctx2, u.email, "renewed", { name: u.name, plan: res.plan.name, date: new Date(res.sub.current_period_end).toLocaleDateString("pt-PT") });
  }
  return res;
}
function providerRenewal(ctx2, sub, p) {
  const db = ctx2.db;
  const out = db.tx(() => {
    if (db.get("SELECT 1 FROM payments WHERE provider = ? AND provider_payment_id = ? AND status = 'confirmed'", p.provider, p.paymentId)) return { duplicate: true };
    const plan = db.get("SELECT * FROM plans WHERE id = ?", sub.plan_id), now = ctx2.now();
    const id = uuid(), ref = newRef(ctx2);
    db.run(
      `INSERT INTO orders (id, ref, user_id, plan_id, kind, subscription_id, method, currency, amount_cents, usd_cents, fx_rate, status, created_at, confirmed_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,'confirmed',?,?,?)`,
      id,
      ref,
      sub.user_id,
      plan.id,
      "renewal",
      sub.id,
      sub.method,
      p.currency || "USD",
      p.amountCents ?? plan.price_usd_cents,
      plan.price_usd_cents,
      now,
      now,
      now
    );
    db.run("INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", uuid(), id, p.provider, p.paymentId, "confirmed", p.amountCents ?? plan.price_usd_cents, p.currency || "USD", now, now);
    const end = p.periodEnd || addInterval(Math.max(now, sub.current_period_end || now), plan.interval);
    db.run("UPDATE subscriptions SET status = 'active', current_period_end = ?, updated_at = ? WHERE id = ?", end, now, sub.id);
    const lic = db.get("SELECT * FROM licenses WHERE subscription_id = ?", sub.id);
    if (lic) {
      db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", end, lic.id);
      licEvent(ctx2, lic.id, p.provider, "renewed", { until: end, order: ref });
    }
    return { end, plan };
  });
  if (!out.duplicate) {
    const u = db.get("SELECT * FROM users WHERE id = ?", sub.user_id);
    mail(ctx2, u.email, "renewed", { name: u.name, plan: out.plan.name, date: new Date(out.end).toLocaleDateString("pt-PT") });
  }
  return out;
}
function failOrder(ctx2, orderId, status, provider, paymentId, reason) {
  const db = ctx2.db, o = db.get("SELECT * FROM orders WHERE id = ?", orderId);
  if (!o || o.status === "confirmed") return o;
  db.run("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", status, ctx2.now(), o.id);
  if (provider && paymentId && !db.get("SELECT 1 FROM payments WHERE provider = ? AND provider_payment_id = ?", provider, paymentId))
    db.run("INSERT INTO payments (id, order_id, provider, provider_payment_id, status, amount_cents, currency, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)", uuid(), o.id, provider, paymentId, status === "expired" ? "expired" : "failed", o.amount_cents, o.currency, ctx2.now(), ctx2.now());
  void reason;
  return db.get("SELECT * FROM orders WHERE id = ?", o.id);
}
function reverseOrder(ctx2, orderId, kind, actor, reason) {
  const db = ctx2.db;
  return db.tx(() => {
    const o = db.get("SELECT * FROM orders WHERE id = ?", orderId);
    if (!o) return null;
    if (o.status === kind) return { order: o, duplicate: true };
    const now = ctx2.now();
    db.run("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", kind, now, o.id);
    db.run("UPDATE payments SET status = ?, updated_at = ? WHERE order_id = ? AND status = ?", kind, now, o.id, "confirmed");
    const lic = db.get("SELECT * FROM licenses WHERE order_id = ?", o.id) || o.subscription_id && db.get("SELECT * FROM licenses WHERE subscription_id = ?", o.subscription_id);
    if (lic && lic.status !== "revoked") {
      const st = kind === "refunded" ? "revoked" : "suspended";
      db.run("UPDATE licenses SET status = ?, status_reason = ? WHERE id = ?", st, kind === "refunded" ? "Pagamento reembolsado" : "Pagamento contestado", lic.id);
      licEvent(ctx2, lic.id, actor || "prestador", "status_" + st, reason || kind);
    }
    if (o.subscription_id && kind === "refunded") db.run("UPDATE subscriptions SET status = 'cancelled', auto_renew = 0, cancelled_at = ?, updated_at = ? WHERE id = ?", now, now, o.subscription_id);
    audit(ctx2, actor || "prestador", "order." + kind, ["order", o.id], { ref: o.ref }, reason);
    return { order: db.get("SELECT * FROM orders WHERE id = ?", o.id) };
  });
}
function recordEvent(ctx2, provider, eventId, type, payload) {
  try {
    ctx2.db.run("INSERT INTO payment_events (provider, event_id, type, received_at, payload) VALUES (?,?,?,?,?)", provider, eventId, type, ctx2.now(), typeof payload === "string" ? payload : JSON.stringify(payload));
    return true;
  } catch (e) {
    if (!/UNIQUE/.test(e.message)) throw e;
    const r = ctx2.db.get("SELECT processed_at FROM payment_events WHERE provider = ? AND event_id = ?", provider, eventId);
    return !(r && r.processed_at);
  }
}
var eventDone = (ctx2, provider, eventId, result) => ctx2.db.run("UPDATE payment_events SET processed_at = ?, result = ? WHERE provider = ? AND event_id = ?", ctx2.now(), String(result).slice(0, 300), provider, eventId);

// server/src/payments/stripe.js
var stripe_exports = {};
__export(stripe_exports, {
  createCheckout: () => createCheckout,
  handleStripe: () => handleStripe,
  stripeCancel: () => stripeCancel,
  stripeConfigured: () => stripeConfigured,
  stripeRefund: () => stripeRefund,
  subFailed: () => subFailed,
  verifyStripe: () => verifyStripe
});
import crypto4 from "node:crypto";
var stripeConfigured = (ctx2) => !!(cred(ctx2).secretKey && cred(ctx2).webhookSecret);
function cred(ctx2) {
  const s = ctx2.creds ? ctx2.creds("stripe") : {};
  return { secretKey: ctx2.cfg.stripe.secretKey || s.secretKey || "", webhookSecret: ctx2.cfg.stripe.webhookSecret || s.webhookSecret || "", apiBase: ctx2.cfg.stripe.apiBase };
}
function form(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === void 0 || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(v));
  }
  return out.join("&");
}
async function api(ctx2, method, path9, body) {
  const c = cred(ctx2);
  if (!c.secretKey) fail(503, "Pagamentos por cartão ainda não configurados.", "PRESTADOR_NAO_CONFIGURADO");
  const r = await fetch(c.apiBase + path9, { method, headers: { Authorization: "Bearer " + c.secretKey, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2024-06-20" }, body: body ? form(body) : void 0 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "Stripe: " + (j.error && j.error.message || r.status), "PRESTADOR_ERRO");
  return j;
}
async function createCheckout(ctx2, order, plan, user) {
  const base = ctx2.cfg.publicUrl, sub = plan.kind === "subscription";
  const line = plan.stripe_price_id && !order.tax_cents ? { price: plan.stripe_price_id, quantity: 1 } : { quantity: 1, price_data: { currency: order.currency.toLowerCase(), unit_amount: order.amount_cents, product_data: { name: `MIXMIND by Piradex — ${plan.name}` }, ...sub ? { recurring: { interval: plan.interval } } : {} } };
  const s = await api(ctx2, "POST", "/v1/checkout/sessions", {
    mode: sub ? "subscription" : "payment",
    customer_email: user.email,
    client_reference_id: order.id,
    success_url: `${base}/conta#encomenda/${order.ref}`,
    cancel_url: `${base}/comprar?plano=${plan.id}&cancelado=1`,
    line_items: { 0: line },
    metadata: { order_id: order.id, ref: order.ref },
    ...sub ? { subscription_data: { metadata: { order_id: order.id, ref: order.ref } } } : { payment_intent_data: { metadata: { order_id: order.id, ref: order.ref } } }
  });
  ctx2.db.run("UPDATE orders SET provider_ref = ? WHERE id = ?", s.id, order.id);
  return s.url;
}
function verifyStripe(ctx2, raw, header) {
  const secret = cred(ctx2).webhookSecret;
  if (!secret) fail(503, "Webhook Stripe sem segredo configurado.", "PRESTADOR_NAO_CONFIGURADO");
  const parts = Object.fromEntries(String(header || "").split(",").map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), v]));
  const sigs = String(header || "").split(",").filter((x) => x.startsWith("v1=")).map((x) => x.slice(3));
  const t = +parts.t;
  if (!t || !sigs.length) fail(400, "Assinatura em falta.", "ASSINATURA");
  if (Math.abs(ctx2.now() / 1e3 - t) > 300) fail(400, "Evento fora de tempo.", "ASSINATURA");
  const exp = crypto4.createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  if (!sigs.some((s) => safeEqual(s, exp))) fail(400, "Assinatura inválida.", "ASSINATURA");
  return JSON.parse(raw.toString("utf8"));
}
var orderFrom = (ctx2, id) => id ? ctx2.db.get("SELECT * FROM orders WHERE id = ?", id) : null;
var subIdOf = (inv) => inv.subscription || inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription || null;
var subMetaOf = (inv) => inv.subscription_details && inv.subscription_details.metadata || inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata || {};
async function handleStripe(ctx2, ev) {
  const o = ev.data && ev.data.object || {};
  switch (ev.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const order = orderFrom(ctx2, o.metadata && o.metadata.order_id);
      if (!order) return "encomenda desconhecida";
      if (o.mode === "subscription") {
        ctx2.db.run("UPDATE orders SET provider_ref = ? WHERE id = ?", o.subscription || o.id, order.id);
        return "subscrição: aguarda invoice.paid";
      }
      if (o.payment_status !== "paid") return "ainda não pago (" + o.payment_status + ")";
      confirmOrder(ctx2, order.id, { provider: "stripe", paymentId: o.payment_intent || o.id, amountCents: o.amount_total, currency: String(o.currency || "usd").toUpperCase() });
      return "confirmada";
    }
    case "checkout.session.async_payment_failed": {
      const order = orderFrom(ctx2, o.metadata && o.metadata.order_id);
      if (order) failOrder(ctx2, order.id, "failed", "stripe", o.payment_intent || o.id);
      return "falhada";
    }
    case "checkout.session.expired": {
      const order = orderFrom(ctx2, o.metadata && o.metadata.order_id);
      if (order && order.status === "pending") failOrder(ctx2, order.id, "expired");
      return "expirada";
    }
    case "invoice.paid": {
      const sid = subIdOf(o);
      if (!sid) return "sem subscrição";
      const line = o.lines && o.lines.data && o.lines.data[0], periodEnd = line && line.period && line.period.end ? line.period.end * 1e3 : null;
      const existing = ctx2.db.get("SELECT * FROM subscriptions WHERE provider = 'stripe' AND provider_sub_id = ?", sid);
      if (o.billing_reason === "subscription_create" || !existing) {
        const order = orderFrom(ctx2, subMetaOf(o).order_id) || ctx2.db.get("SELECT * FROM orders WHERE provider_ref = ?", sid);
        if (!order) return "encomenda desconhecida";
        confirmOrder(ctx2, order.id, { provider: "stripe", paymentId: o.id, amountCents: o.amount_paid, currency: String(o.currency || "usd").toUpperCase(), periodEnd, providerSubId: sid });
        return "subscrição iniciada";
      }
      providerRenewal(ctx2, existing, { provider: "stripe", paymentId: o.id, amountCents: o.amount_paid, currency: String(o.currency || "usd").toUpperCase(), periodEnd });
      return "renovada";
    }
    case "invoice.payment_failed": {
      const sub = ctx2.db.get("SELECT * FROM subscriptions WHERE provider = 'stripe' AND provider_sub_id = ?", subIdOf(o));
      if (!sub) return "subscrição desconhecida";
      subFailed(ctx2, sub, "Stripe");
      return "falha de cobrança";
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = ctx2.db.get("SELECT * FROM subscriptions WHERE provider = 'stripe' AND provider_sub_id = ?", o.id);
      if (!sub) return "subscrição desconhecida";
      if (ev.type === "customer.subscription.deleted" || o.status === "canceled") ctx2.db.run("UPDATE subscriptions SET status = 'cancelled', auto_renew = 0, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE id = ?", ctx2.now(), ctx2.now(), sub.id);
      else ctx2.db.run("UPDATE subscriptions SET cancel_at_period_end = ?, auto_renew = ?, updated_at = ? WHERE id = ?", o.cancel_at_period_end ? 1 : 0, o.cancel_at_period_end ? 0 : 1, ctx2.now(), sub.id);
      return "atualizada";
    }
    case "charge.refunded": {
      if (!o.refunded) return "reembolso parcial (sem alteração automática)";
      const pay = ctx2.db.get("SELECT * FROM payments WHERE provider = 'stripe' AND provider_payment_id IN (?, ?)", o.payment_intent || "", o.invoice || "");
      if (!pay) return "pagamento desconhecido";
      reverseOrder(ctx2, pay.order_id, "refunded", "stripe", "Reembolso Stripe");
      return "reembolsada";
    }
    case "charge.dispute.created": {
      const pay = ctx2.db.get("SELECT * FROM payments WHERE provider = 'stripe' AND provider_payment_id = ?", o.payment_intent || "");
      if (!pay) return "pagamento desconhecido";
      reverseOrder(ctx2, pay.order_id, "disputed", "stripe", "Contestação de pagamento (Stripe)");
      return "contestada";
    }
    default:
      return "ignorado";
  }
}
function subFailed(ctx2, sub, providerName) {
  ctx2.db.run("UPDATE subscriptions SET status = 'past_due', updated_at = ? WHERE id = ?", ctx2.now(), sub.id);
  const u = ctx2.db.get("SELECT * FROM users WHERE id = ?", sub.user_id), plan = ctx2.db.get("SELECT * FROM plans WHERE id = ?", sub.plan_id);
  mail(ctx2, u.email, "payment_failed", { name: u.name, plan: plan.name, provider: providerName, date: new Date(sub.current_period_end).toLocaleDateString("pt-PT"), link: ctx2.cfg.publicUrl + "/conta#subscricoes" });
}
var stripeCancel = (ctx2, sub) => api(ctx2, "POST", "/v1/subscriptions/" + encodeURIComponent(sub.provider_sub_id), { cancel_at_period_end: "true" });
async function stripeRefund(ctx2, pay) {
  let pi = pay.provider_payment_id;
  if (pi.startsWith("in_")) {
    const inv = await api(ctx2, "GET", "/v1/invoices/" + encodeURIComponent(pi));
    pi = inv.payment_intent || inv.payments && inv.payments.data && inv.payments.data[0] && inv.payments.data[0].payment && inv.payments.data[0].payment.payment_intent;
    if (!pi) fail(409, "Fatura sem pagamento associado.", "SEM_PAGAMENTO");
  }
  return api(ctx2, "POST", "/v1/refunds", { payment_intent: pi });
}

// server/src/payments/paypal.js
var paypal_exports = {};
__export(paypal_exports, {
  captureReturn: () => captureReturn,
  createCheckout: () => createCheckout2,
  handlePaypal: () => handlePaypal,
  paypalCancel: () => paypalCancel,
  paypalConfigured: () => paypalConfigured,
  paypalRefund: () => paypalRefund,
  subReturn: () => subReturn,
  verifyPaypal: () => verifyPaypal
});
function cred2(ctx2) {
  const s = ctx2.creds ? ctx2.creds("paypal") : {};
  return { clientId: ctx2.cfg.paypal.clientId || s.clientId || "", clientSecret: ctx2.cfg.paypal.clientSecret || s.clientSecret || "", webhookId: ctx2.cfg.paypal.webhookId || s.webhookId || "", apiBase: ctx2.cfg.paypal.apiBase };
}
var paypalConfigured = (ctx2) => {
  const c = cred2(ctx2);
  return !!(c.clientId && c.clientSecret && c.webhookId);
};
var tok = null;
async function token(ctx2) {
  const c = cred2(ctx2);
  if (!c.clientId || !c.clientSecret) fail(503, "PayPal ainda não configurado.", "PRESTADOR_NAO_CONFIGURADO");
  if (tok && tok.base === c.apiBase && tok.exp > Date.now() + 6e4) return tok.v;
  const r = await fetch(c.apiBase + "/v1/oauth2/token", { method: "POST", headers: { Authorization: "Basic " + Buffer.from(c.clientId + ":" + c.clientSecret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "PayPal: autenticação falhou.", "PRESTADOR_ERRO");
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 300) * 1e3, base: c.apiBase };
  return tok.v;
}
async function api2(ctx2, method, path9, body) {
  const r = await fetch(cred2(ctx2).apiBase + path9, { method, headers: { Authorization: "Bearer " + await token(ctx2), "Content-Type": "application/json", Prefer: "return=representation" }, body: body ? JSON.stringify(body) : void 0 });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(502, "PayPal: " + (j.message || j.name || r.status), "PRESTADOR_ERRO");
  return j;
}
var money = (cents) => (cents / 100).toFixed(2);
var approveLink = (j) => (j.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
async function createCheckout2(ctx2, order, plan) {
  const base = ctx2.cfg.publicUrl;
  if (plan.kind === "subscription") {
    if (!plan.paypal_plan_id) fail(503, "Subscrição PayPal ainda não configurada para este plano (falta o ID do plano PayPal).", "PRESTADOR_NAO_CONFIGURADO");
    const s = await api2(ctx2, "POST", "/v1/billing/subscriptions", { plan_id: plan.paypal_plan_id, custom_id: order.id, application_context: { brand_name: "MIXMIND by Piradex", user_action: "SUBSCRIBE_NOW", return_url: `${base}/api/pay/paypal/sub-return?o=${order.id}`, cancel_url: `${base}/comprar?plano=${plan.id}&cancelado=1` } });
    ctx2.db.run("UPDATE orders SET provider_ref = ? WHERE id = ?", s.id, order.id);
    const l2 = approveLink(s);
    if (!l2) fail(502, "PayPal não devolveu a ligação de aprovação.", "PRESTADOR_ERRO");
    return l2.href;
  }
  const o = await api2(ctx2, "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: order.id, custom_id: order.id, invoice_id: order.ref, description: `MIXMIND by Piradex — ${plan.name}`, amount: { currency_code: order.currency, value: money(order.amount_cents) } }],
    payment_source: { paypal: { experience_context: { brand_name: "MIXMIND by Piradex", user_action: "PAY_NOW", return_url: `${base}/api/pay/paypal/return?o=${order.id}`, cancel_url: `${base}/comprar?plano=${plan.id}&cancelado=1` } } }
  });
  ctx2.db.run("UPDATE orders SET provider_ref = ? WHERE id = ?", o.id, order.id);
  const l = approveLink(o);
  if (!l) fail(502, "PayPal não devolveu a ligação de aprovação.", "PRESTADOR_ERRO");
  return l.href;
}
async function captureReturn(ctx2, orderId) {
  const order = ctx2.db.get("SELECT * FROM orders WHERE id = ?", orderId);
  if (!order || !order.provider_ref) fail(404, "Encomenda desconhecida.", "NAO_EXISTE");
  if (order.status === "confirmed") return order;
  const c = await api2(ctx2, "POST", `/v2/checkout/orders/${encodeURIComponent(order.provider_ref)}/capture`, {});
  const cap = c.purchase_units && c.purchase_units[0] && c.purchase_units[0].payments && c.purchase_units[0].payments.captures && c.purchase_units[0].payments.captures[0];
  if (c.status === "COMPLETED" && cap && cap.status === "COMPLETED" && cap.amount.currency_code === order.currency && Math.round(+cap.amount.value * 100) === order.amount_cents)
    confirmOrder(ctx2, order.id, { provider: "paypal", paymentId: cap.id, amountCents: order.amount_cents, currency: order.currency });
  return ctx2.db.get("SELECT * FROM orders WHERE id = ?", order.id);
}
async function subReturn(ctx2, orderId) {
  const order = ctx2.db.get("SELECT * FROM orders WHERE id = ?", orderId);
  if (!order || !order.provider_ref) fail(404, "Encomenda desconhecida.", "NAO_EXISTE");
  if (order.status === "confirmed") return order;
  const s = await api2(ctx2, "GET", "/v1/billing/subscriptions/" + encodeURIComponent(order.provider_ref));
  if (s.status === "ACTIVE" && s.custom_id === order.id) confirmOrder(ctx2, order.id, { provider: "paypal", paymentId: "activation:" + s.id, periodEnd: s.billing_info && s.billing_info.next_billing_time ? Date.parse(s.billing_info.next_billing_time) : null, providerSubId: s.id });
  return ctx2.db.get("SELECT * FROM orders WHERE id = ?", order.id);
}
async function verifyPaypal(ctx2, raw, h) {
  const c = cred2(ctx2);
  if (!c.webhookId) fail(503, "Webhook PayPal sem ID configurado.", "PRESTADOR_NAO_CONFIGURADO");
  const ev = JSON.parse(raw.toString("utf8"));
  const v = await api2(ctx2, "POST", "/v1/notifications/verify-webhook-signature", { auth_algo: h["paypal-auth-algo"], cert_url: h["paypal-cert-url"], transmission_id: h["paypal-transmission-id"], transmission_sig: h["paypal-transmission-sig"], transmission_time: h["paypal-transmission-time"], webhook_id: c.webhookId, webhook_event: ev });
  if (v.verification_status !== "SUCCESS") fail(400, "Assinatura PayPal inválida.", "ASSINATURA");
  return ev;
}
var byCapture = (ctx2, capId) => ctx2.db.get("SELECT * FROM payments WHERE provider = 'paypal' AND provider_payment_id = ?", capId || "");
async function handlePaypal(ctx2, ev) {
  const r = ev.resource || {};
  switch (ev.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const order = ctx2.db.get("SELECT * FROM orders WHERE id = ?", r.custom_id || "");
      if (!order) return "encomenda desconhecida";
      if (r.amount && (r.amount.currency_code !== order.currency || Math.round(+r.amount.value * 100) !== order.amount_cents)) return "valor diferente do esperado — verificação manual";
      confirmOrder(ctx2, order.id, { provider: "paypal", paymentId: r.id, amountCents: order.amount_cents, currency: order.currency });
      return "confirmada";
    }
    case "PAYMENT.CAPTURE.DENIED": {
      const order = ctx2.db.get("SELECT * FROM orders WHERE id = ?", r.custom_id || "");
      if (order) failOrder(ctx2, order.id, "failed", "paypal", r.id);
      return "falhada";
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      const up = (r.links || []).find((l) => l.rel === "up"), capId = up ? up.href.split("/").pop() : null;
      const pay = byCapture(ctx2, capId) || r.custom_id && ctx2.db.get("SELECT * FROM payments WHERE provider = 'paypal' AND order_id = ?", r.custom_id);
      if (!pay) return "pagamento desconhecido";
      reverseOrder(ctx2, pay.order_id, "refunded", "paypal", "Reembolso PayPal");
      return "reembolsada";
    }
    case "CUSTOMER.DISPUTE.CREATED": {
      const tx = r.disputed_transactions && r.disputed_transactions[0], pay = tx && byCapture(ctx2, tx.seller_transaction_id);
      if (!pay) return "pagamento desconhecido";
      reverseOrder(ctx2, pay.order_id, "disputed", "paypal", "Contestação de pagamento (PayPal)");
      return "contestada";
    }
    case "BILLING.SUBSCRIPTION.ACTIVATED": {
      const order = ctx2.db.get("SELECT * FROM orders WHERE id = ?", r.custom_id || "");
      if (!order) return "encomenda desconhecida";
      confirmOrder(ctx2, order.id, { provider: "paypal", paymentId: "activation:" + r.id, periodEnd: r.billing_info && r.billing_info.next_billing_time ? Date.parse(r.billing_info.next_billing_time) : null, providerSubId: r.id });
      return "subscrição iniciada";
    }
    case "PAYMENT.SALE.COMPLETED": {
      const sub = ctx2.db.get("SELECT * FROM subscriptions WHERE provider = 'paypal' AND provider_sub_id = ?", r.billing_agreement_id || "");
      if (!sub) return "subscrição desconhecida (ou primeira cobrança antes da ativação)";
      const s = await api2(ctx2, "GET", "/v1/billing/subscriptions/" + encodeURIComponent(sub.provider_sub_id));
      const next = s.billing_info && s.billing_info.next_billing_time ? Date.parse(s.billing_info.next_billing_time) : null;
      if (!next || next <= (sub.current_period_end || 0) + 36e5) return "primeira cobrança (já contada na ativação)";
      providerRenewal(ctx2, sub, { provider: "paypal", paymentId: r.id, amountCents: r.amount ? Math.round(+r.amount.total * 100) : void 0, currency: r.amount ? r.amount.currency : "USD", periodEnd: next });
      return "renovada";
    }
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
      const sub = ctx2.db.get("SELECT * FROM subscriptions WHERE provider = 'paypal' AND provider_sub_id = ?", r.id || "");
      if (sub) subFailed(ctx2, sub, "PayPal");
      return "falha de cobrança";
    }
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED":
    case "BILLING.SUBSCRIPTION.SUSPENDED": {
      const sub = ctx2.db.get("SELECT * FROM subscriptions WHERE provider = 'paypal' AND provider_sub_id = ?", r.id || "");
      if (!sub) return "subscrição desconhecida";
      ctx2.db.run("UPDATE subscriptions SET status = CASE WHEN ? = 'BILLING.SUBSCRIPTION.SUSPENDED' THEN 'past_due' ELSE 'cancelled' END, auto_renew = 0, cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE id = ?", ev.event_type, ctx2.now(), ctx2.now(), sub.id);
      return "atualizada";
    }
    default:
      return "ignorado";
  }
}
var paypalCancel = (ctx2, sub) => api2(ctx2, "POST", `/v1/billing/subscriptions/${encodeURIComponent(sub.provider_sub_id)}/cancel`, { reason: "Cancelado pelo cliente na área de cliente" });
var paypalRefund = (ctx2, pay) => api2(ctx2, "POST", `/v2/payments/captures/${encodeURIComponent(pay.provider_payment_id)}/refund`, {});

// server/src/payments/index.js
var bankReady = (b) => !!(b && b.holder && b.bank && b.iban);
function methodsFor(ctx2, country) {
  const M = getSetting(ctx2, "methods"), rates = getSetting(ctx2, "currencies").rates || {};
  const okCountry = (m) => !m.countries || m.countries === "*" || String(m.countries).split(",").map((s) => s.trim().toUpperCase()).includes(String(country || "").toUpperCase());
  const out = [];
  const add = (id, configured, why, extra) => {
    const m = M[id] || {};
    if (m.enabled && okCountry(m)) out.push({ id, label: METHOD_LABEL[id], available: configured, why: configured ? null : why, ...extra });
  };
  add("card", stripeConfigured(ctx2), "Stripe por configurar");
  add("paypal", paypalConfigured(ctx2), "PayPal por configurar");
  for (const k of ["bank_pt", "bank_ao"]) {
    const b = getSetting(ctx2, k), cur = b.currency, rateOk = cur === "USD" || rates[cur] && rates[cur].rate > 0;
    add(k, bankReady(b) && rateOk, !bankReady(b) ? "Dados bancários por preencher" : "Câmbio USD→" + cur + " por configurar", { currency: cur, example: !!b.example });
  }
  if (ctx2.cfg.test) add("test", true, null, { test: true });
  return out;
}
async function startCheckout(ctx2, user, planId, method, country, billing) {
  const m = methodsFor(ctx2, country).find((x) => x.id === method);
  if (!m) fail(400, "Método de pagamento indisponível para o teu país.", "METODO_INDISPONIVEL");
  if (!m.available) fail(503, "Este método de pagamento ainda não está configurado: " + m.why + ".", "METODO_INDISPONIVEL");
  const { order, plan } = createOrder(ctx2, user, planId, method, country, billing);
  if (method === "card") return { order, redirect: await createCheckout(ctx2, order, plan, user) };
  if (method === "paypal") return { order, redirect: await createCheckout2(ctx2, order, plan, user) };
  if (method === "test") return { order, redirect: `${ctx2.cfg.publicUrl}/teste-pagamento?ref=${order.ref}` };
  const b = getSetting(ctx2, method);
  mail(ctx2, user.email, "transfer_instructions", { name: user.name, ref: order.ref, amount: fmtMoney(order.amount_cents, order.currency), bank: bankText(b), due: new Date(order.due_at).toLocaleDateString("pt-PT"), link: `${ctx2.cfg.publicUrl}/conta#encomenda/${order.ref}` });
  return { order, redirect: `${ctx2.cfg.publicUrl}/conta#encomenda/${order.ref}` };
}
var bankText = (b) => [`Titular: ${b.holder}`, `Banco: ${b.bank}`, `IBAN / conta: ${b.iban}`, b.swift ? `SWIFT/BIC: ${b.swift}` : null, `Moeda: ${b.currency}`, b.example ? "(EXEMPLO DE TESTES — NÃO TRANSFERIR)" : null].filter(Boolean).join("\n");
async function webhook(ctx2, provider, raw, headers) {
  let ev, id, type;
  if (provider === "stripe") {
    ev = verifyStripe(ctx2, raw, headers["stripe-signature"]);
    id = ev.id;
    type = ev.type;
  } else if (provider === "paypal") {
    ev = await verifyPaypal(ctx2, raw, headers);
    id = ev.id;
    type = ev.event_type;
  } else if (provider === "test") {
    if (!ctx2.cfg.test) fail(404, "Não encontrado.", "NAO_EXISTE");
    if (!safeEqual(headers["x-test-signature"] || "", hmac(ctx2.cfg.testWebhookSecret, raw))) fail(400, "Assinatura inválida.", "ASSINATURA");
    ev = JSON.parse(raw.toString("utf8"));
    id = ev.id;
    type = ev.type;
  } else fail(404, "Prestador desconhecido.", "NAO_EXISTE");
  if (!id) fail(400, "Evento sem id.", "EVENTO_INVALIDO");
  if (!recordEvent(ctx2, provider, id, type, raw.toString("utf8"))) return { duplicate: true };
  try {
    const result = provider === "stripe" ? await handleStripe(ctx2, ev) : provider === "paypal" ? await handlePaypal(ctx2, ev) : handleTest(ctx2, ev);
    eventDone(ctx2, provider, id, result);
    return { ok: true, result };
  } catch (e) {
    ctx2.db.run("UPDATE payment_events SET result = ? WHERE provider = ? AND event_id = ?", "erro: " + e.message, provider, id);
    throw e;
  }
}
function handleTest(ctx2, ev) {
  const o = ev.data || {};
  const order = o.order_id ? ctx2.db.get("SELECT * FROM orders WHERE id = ?", o.order_id) : null;
  switch (ev.type) {
    case "payment.succeeded":
      if (!order) return "encomenda desconhecida";
      confirmOrder(ctx2, order.id, { provider: "test", paymentId: o.payment_id, amountCents: order.amount_cents, currency: order.currency });
      return "confirmada";
    case "payment.failed":
      if (order) failOrder(ctx2, order.id, "failed", "test", o.payment_id);
      return "falhada";
    case "payment.refunded": {
      const p = ctx2.db.get("SELECT * FROM payments WHERE provider = 'test' AND provider_payment_id = ?", o.payment_id || "");
      if (p) reverseOrder(ctx2, p.order_id, "refunded", "test", "Reembolso (simulado)");
      return "reembolsada";
    }
    case "payment.disputed": {
      const p = ctx2.db.get("SELECT * FROM payments WHERE provider = 'test' AND provider_payment_id = ?", o.payment_id || "");
      if (p) reverseOrder(ctx2, p.order_id, "disputed", "test", "Contestação (simulada)");
      return "contestada";
    }
    case "subscription.renewed": {
      const s = ctx2.db.get("SELECT * FROM subscriptions WHERE id = ?", o.subscription_id || "");
      if (!s) return "subscrição desconhecida";
      providerRenewal(ctx2, s, { provider: "test", paymentId: o.payment_id });
      return "renovada";
    }
    case "subscription.payment_failed": {
      const s = ctx2.db.get("SELECT * FROM subscriptions WHERE id = ?", o.subscription_id || "");
      if (s) subFailed(ctx2, s, "simulado");
      return "falha de cobrança";
    }
    default:
      return "ignorado";
  }
}
async function simulate(ctx2, type, data, eventId) {
  if (!ctx2.cfg.test) fail(404, "Não encontrado.", "NAO_EXISTE");
  const raw = Buffer.from(JSON.stringify({ id: eventId || "evt_test_" + randomToken(9), type, data }));
  return webhook(ctx2, "test", raw, { "x-test-signature": hmac(ctx2.cfg.testWebhookSecret, raw) });
}
var MAGIC = [["application/pdf", [37, 80, 68, 70]], ["image/jpeg", [255, 216, 255]], ["image/png", [137, 80, 78, 71]]];
var PROOF_MAX = 10 * 1024 * 1024;
function uploadProof(ctx2, user, order, buf, meta) {
  if (!["bank_pt", "bank_ao"].includes(order.method)) fail(400, "Esta encomenda não é por transferência.", "METODO_INVALIDO");
  if (!["pending", "awaiting_validation"].includes(order.status)) fail(409, "Esta encomenda já não aceita comprovativos.", "ESTADO_INVALIDO");
  if (!buf.length) fail(400, "Ficheiro vazio.", "FICHEIRO_INVALIDO");
  if (buf.length > PROOF_MAX) fail(413, "O comprovativo não pode passar de 10 MB.", "DEMASIADO_GRANDE");
  const kind = MAGIC.find(([, sig]) => sig.every((b, i) => buf[i] === b));
  if (!kind) fail(415, "Formato não aceite. Envia PDF, JPG ou PNG.", "FORMATO_INVALIDO");
  const name = String(meta.filename || "comprovativo").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 100);
  const storage = uuid();
  fs6.writeFileSync(path6.join(ctx2.cfg.dataDir, "uploads", storage), buf, { mode: 384 });
  const id = uuid(), now = ctx2.now();
  const declared = meta.amount ? Math.round(parseFloat(String(meta.amount).replace(/\s/g, "").replace(",", ".")) * 100) : null;
  ctx2.db.tx(() => {
    if (!meta.complement) ctx2.db.run("UPDATE proofs SET status = 'superseded' WHERE order_id = ? AND status IN ('submitted','needs_info')", order.id);
    ctx2.db.run(
      "INSERT INTO proofs (id, order_id, user_id, filename, mime, size, storage_name, declared_cents, declared_currency, transfer_date, transfer_ref, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id,
      order.id,
      user.id,
      name,
      kind[0],
      buf.length,
      storage,
      Number.isFinite(declared) ? declared : null,
      order.currency,
      String(meta.date || "").slice(0, 20) || null,
      String(meta.ref || "").slice(0, 80) || null,
      "submitted",
      now
    );
    ctx2.db.run("UPDATE orders SET status = 'awaiting_validation', updated_at = ? WHERE id = ?", now, order.id);
  });
  mail(ctx2, user.email, "proof_received", { name: user.name, ref: order.ref });
  return ctx2.db.get("SELECT * FROM proofs WHERE id = ?", id);
}
var proofPath = (ctx2, p) => path6.join(ctx2.cfg.dataDir, "uploads", p.storage_name);
function approveTransfer(ctx2, admin, order, note) {
  if (!["bank_pt", "bank_ao"].includes(order.method)) fail(400, "Não é uma transferência.", "METODO_INVALIDO");
  if (order.status === "confirmed") return { duplicate: true, order };
  if (!["pending", "awaiting_validation"].includes(order.status)) fail(409, "Estado não permite aprovação: " + order.status, "ESTADO_INVALIDO");
  const r = confirmOrder(ctx2, order.id, { provider: order.method, paymentId: "transfer:" + order.id, actor: admin.email, amountCents: order.amount_cents, currency: order.currency });
  ctx2.db.run("UPDATE proofs SET status = 'accepted', reviewed_by = ?, reviewed_at = ? WHERE order_id = ? AND status IN ('submitted','needs_info')", admin.email, ctx2.now(), order.id);
  audit(ctx2, admin, "transfer.approve", ["order", order.id], { ref: order.ref, amount: fmtMoney(order.amount_cents, order.currency) }, note || "Entrada do valor verificada");
  return r;
}
function proofDecision(ctx2, admin, order, decision, reason) {
  if (!reason || String(reason).trim().length < 3) fail(400, "O motivo é obrigatório.", "MOTIVO_OBRIGATORIO");
  const p = ctx2.db.get("SELECT * FROM proofs WHERE order_id = ? AND status IN ('submitted','needs_info') ORDER BY created_at DESC", order.id);
  if (!p && decision === "reject") fail(409, "Não há comprovativo por analisar.", "SEM_COMPROVATIVO");
  const now = ctx2.now(), u = ctx2.db.get("SELECT * FROM users WHERE id = ?", order.user_id);
  if (decision === "needs_info") {
    if (p) ctx2.db.run("UPDATE proofs SET status = 'needs_info', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", reason, admin.email, now, p.id);
    ctx2.db.run("UPDATE orders SET status = 'pending', updated_at = ? WHERE id = ?", now, order.id);
    mail(ctx2, u.email, "proof_needs_info", { name: u.name, ref: order.ref, reason, link: `${ctx2.cfg.publicUrl}/conta#encomenda/${order.ref}` });
  } else {
    ctx2.db.run("UPDATE proofs SET status = 'rejected', reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", reason, admin.email, now, p.id);
    ctx2.db.run("UPDATE orders SET status = 'pending', updated_at = ? WHERE id = ?", now, order.id);
    mail(ctx2, u.email, "payment_rejected", { name: u.name, ref: order.ref, reason });
  }
  audit(ctx2, admin, "transfer." + decision, ["order", order.id], { ref: order.ref }, reason);
}

// server/src/routes/public.js
function register2(r, ctx2) {
  r.get("/api/public/store", () => {
    const plans = ctx2.db.all("SELECT id, name, kind, interval, price_usd_cents FROM plans WHERE active = 1 ORDER BY sort");
    const st = getSetting(ctx2, "store"), demo = getSetting(ctx2, "demo"), v = ctx2.db.get("SELECT * FROM versions WHERE is_current = 1");
    return {
      mode: ctx2.cfg.mode,
      plans: plans.map((p) => ({ ...p, price: fmtMoney(p.price_usd_cents, "USD") })),
      annualSaving: annualSaving(ctx2),
      taxNotice: st.taxNotice,
      refundDays: st.refundDaysPerpetual,
      demo,
      appUrl: ctx2.cfg.appUrl,
      version: v && v.version,
      legalReady: legalReady(ctx2),
      support: getSetting(ctx2, "support"),
      methods: methodsFor(ctx2, "").map((m) => ({ id: m.id, label: m.label, available: m.available }))
    };
  });
  r.get("/api/public/text/:key", (req) => {
    if (!["terms", "privacy", "refund"].includes(req.params.key)) fail(404, "Texto inexistente.", "NAO_EXISTE");
    return publicText(ctx2, req.params.key);
  });
  r.get("/api/public/methods", (req) => methodsFor(ctx2, str(req.query.country, 2).toUpperCase()));
  r.get("/api/public/quote", (req) => {
    const plan = ctx2.db.get("SELECT * FROM plans WHERE id = ? AND active = 1", req.query.plan || "");
    if (!plan) fail(400, "Plano indisponível.", "PLANO_INVALIDO");
    const q = quote(ctx2, plan, req.query.method || "card", str(req.query.country, 2).toUpperCase());
    return { ...q, plan: { id: plan.id, name: plan.name, kind: plan.kind, interval: plan.interval }, total: fmtMoney(q.total_cents, q.currency), net: fmtMoney(q.net_cents, q.currency), tax: fmtMoney(q.tax_cents, q.currency), usd: fmtMoney(q.usd_cents, "USD") };
  });
  r.post("/api/checkout", async (req, res) => {
    const b = req.body;
    if (!ctx2.cfg.test && !legalReady(ctx2)) fail(503, "A loja abre depois da publicação dos termos, da política de privacidade e da política de reembolsos.", "LOJA_FECHADA");
    if (!b.acceptTerms || !b.acceptPrivacy) fail(400, "Tens de aceitar os termos e a política de privacidade.", "TERMOS");
    const country = str(b.country, 2).toUpperCase();
    if (!countryOk(country)) fail(400, "Escolhe o país.", "PAIS");
    let user = req.user;
    if (user && user.role !== "customer") fail(400, "Contas da equipa não fazem compras. Usa uma conta de cliente.", "EQUIPA");
    if (!user) {
      user = createCustomer(ctx2, { name: b.name, email: b.email, password: b.password, country });
      sendVerification(ctx2, user);
      res.setHeader("Set-Cookie", sessionCookie(ctx2, createSession(ctx2, user, req, true)));
    }
    const billing = { name: str(b.billingName || user.name, 120), address: str(b.billingAddress, 300), taxId: str(b.taxId, 40) };
    ctx2.db.run("UPDATE users SET country = COALESCE(country, ?), billing_name = COALESCE(?, billing_name), billing_address = COALESCE(?, billing_address), tax_id = COALESCE(?, tax_id), updated_at = ? WHERE id = ?", country, billing.name || null, billing.address || null, billing.taxId || null, ctx2.now(), user.id);
    const out = await startCheckout(ctx2, user, str(b.plan, 20), str(b.method, 20), country, billing);
    return { ref: out.order.ref, redirect: out.redirect, user: safeUser(ctx2.db.get("SELECT * FROM users WHERE id = ?", user.id)) };
  });
  r.get("/api/pay/paypal/return", async (req) => {
    const o = await paypal_exports.captureReturn(ctx2, str(req.query.o, 60));
    return { __redirect: `${ctx2.cfg.publicUrl}/conta#encomenda/${o.ref}` };
  });
  r.get("/api/pay/paypal/sub-return", async (req) => {
    const o = await paypal_exports.subReturn(ctx2, str(req.query.o, 60));
    return { __redirect: `${ctx2.cfg.publicUrl}/conta#encomenda/${o.ref}` };
  });
  r.post("/api/webhooks/:provider", async (req) => webhook(ctx2, req.params.provider, req.raw, req.headers));
  r.get("/api/test/order/:ref", (req) => {
    if (!ctx2.cfg.test) fail(404, "Não encontrado.", "NAO_EXISTE");
    const o = ctx2.db.get("SELECT o.*, p.name plan_name, p.kind plan_kind FROM orders o JOIN plans p ON p.id = o.plan_id WHERE ref = ?", str(req.params.ref, 40));
    if (!o || !req.user || o.user_id !== req.user.id && req.user.role === "customer") fail(404, "Encomenda não encontrada.", "NAO_EXISTE");
    const sub = o.subscription_id && ctx2.db.get("SELECT * FROM subscriptions WHERE id = ?", o.subscription_id);
    const pay = ctx2.db.get("SELECT provider_payment_id FROM payments WHERE order_id = ? AND provider = 'test' ORDER BY created_at DESC", o.id);
    return { ref: o.ref, status: o.status, plan: o.plan_name, kind: o.plan_kind, method: o.method, amount: fmtMoney(o.amount_cents, o.currency), subscription: sub ? { id: sub.id, status: sub.status, until: sub.current_period_end } : null, paymentId: pay && pay.provider_payment_id };
  });
  r.post("/api/test/simulate", async (req) => {
    if (!ctx2.cfg.test) fail(404, "Não encontrado.", "NAO_EXISTE");
    const o = ctx2.db.get("SELECT * FROM orders WHERE ref = ?", str(req.body.ref, 40));
    if (!o || !req.user || o.user_id !== req.user.id && req.user.role === "customer") fail(404, "Encomenda não encontrada.", "NAO_EXISTE");
    if (o.method !== "test") fail(400, "Só para encomendas com pagamento simulado.", "METODO_INVALIDO");
    const pay = ctx2.db.get("SELECT provider_payment_id FROM payments WHERE order_id = ? AND provider = 'test' ORDER BY created_at DESC", o.id);
    const pid = pay ? pay.provider_payment_id : "pay_test_" + o.id.slice(0, 8);
    const map = { paid: "payment.succeeded", failed: "payment.failed", refund: "payment.refunded", dispute: "payment.disputed", renew: "subscription.renewed", renew_failed: "subscription.payment_failed" };
    const type = map[req.body.outcome];
    if (!type) fail(400, "Resultado desconhecido.", "PEDIDO");
    const data = { order_id: o.id, payment_id: type === "subscription.renewed" ? "pay_test_renew_" + Date.now() : pid, subscription_id: o.subscription_id };
    return simulate(ctx2, type, data, req.body.eventId);
  });
}

// server/src/routes/account.js
import fs7 from "node:fs";
var own = (ctx2, u, table, id) => {
  const row = ctx2.db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row || row.user_id !== u.id) fail(404, "Não encontrado.", "NAO_EXISTE");
  return row;
};
var orderView = (ctx2, o) => {
  const plan = ctx2.db.get("SELECT name, kind, interval FROM plans WHERE id = ?", o.plan_id);
  const bank = ["bank_pt", "bank_ao"].includes(o.method) ? getSetting(ctx2, o.method) : null;
  return {
    ref: o.ref,
    plan: plan.name,
    planKind: plan.kind,
    kind: o.kind,
    method: o.method,
    methodLabel: METHOD_LABEL[o.method],
    status: o.status,
    amount: fmtMoney(o.amount_cents, o.currency),
    currency: o.currency,
    tax: o.tax_cents ? fmtMoney(o.tax_cents, o.currency) : null,
    usd: fmtMoney(o.usd_cents, "USD"),
    fx: o.fx_rate,
    created_at: o.created_at,
    due_at: o.due_at,
    confirmed_at: o.confirmed_at,
    bank: bank && ["pending", "awaiting_validation"].includes(o.status) ? { text: bankText(bank), holder: bank.holder, bank: bank.bank, iban: bank.iban, swift: bank.swift, currency: bank.currency, instructions: bank.instructions, example: !!bank.example } : null,
    proofs: ctx2.db.all("SELECT id, filename, mime, size, declared_cents, declared_currency, transfer_date, transfer_ref, status, reason, created_at FROM proofs WHERE order_id = ? ORDER BY created_at DESC", o.id).map((p) => ({ ...p, declared: p.declared_cents !== null ? fmtMoney(p.declared_cents, p.declared_currency) : null }))
  };
};
function register3(r, ctx2) {
  r.get("/api/account/overview", (req) => {
    const u = requireUser(req), db = ctx2.db, verified = !!u.email_verified_at;
    const orders = db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", u.id).map((o) => orderView(ctx2, o));
    const subs = db.all("SELECT s.*, p.name plan_name, p.interval FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ? ORDER BY s.created_at DESC", u.id).map((s) => ({
      id: s.id,
      plan: s.plan_name,
      interval: s.interval,
      method: s.method,
      methodLabel: METHOD_LABEL[s.method],
      status: s.status,
      autoRenew: !!s.auto_renew,
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
      periodEnd: s.current_period_end,
      nextRenewal: s.auto_renew && !s.cancel_at_period_end && s.status === "active" ? s.current_period_end : null,
      manual: !s.provider_sub_id && ["bank_pt", "bank_ao"].includes(s.method),
      pendingRenewal: !!db.get("SELECT 1 FROM orders WHERE subscription_id = ? AND kind = 'renewal' AND status IN ('pending','awaiting_validation')", s.id)
    }));
    const licenses = db.all("SELECT * FROM licenses WHERE user_id = ? ORDER BY issued_at DESC", u.id).map((l) => {
      const d = db.get("SELECT name, platform, app_version, activated_at, last_seen_at FROM devices WHERE license_id = ? AND deactivated_at IS NULL", l.id);
      return {
        id: l.id,
        key: verified ? l.key : null,
        key4: l.key.slice(-4),
        type: l.type,
        status: l.status,
        statusReason: l.status_reason,
        major: l.major,
        issued_at: l.issued_at,
        expires_at: l.expires_at,
        device: d || null,
        transfers: db.get("SELECT COUNT(*) n FROM devices WHERE license_id = ?", l.id).n
      };
    });
    const versions = db.all("SELECT version, notes, url_web, url_windows, url_macos, published_at FROM versions ORDER BY published_at DESC LIMIT 5");
    return { user: safeUser(u), verified, orders, subscriptions: subs, licenses, versions, appUrl: ctx2.cfg.appUrl, support: getSetting(ctx2, "support"), licensing: getSetting(ctx2, "licensing"), mode: ctx2.cfg.mode };
  });
  r.patch("/api/account/profile", (req) => {
    const u = requireUser(req), b = req.body;
    const country = b.country !== void 0 ? str(b.country, 2).toUpperCase() : u.country;
    if (country && !countryOk(country)) fail(400, "País inválido.", "PAIS");
    const name = b.name !== void 0 ? str(b.name, 100) : u.name;
    if (name.length < 2) fail(400, "Nome inválido.", "NOME");
    ctx2.db.run("UPDATE users SET name = ?, country = ?, billing_name = ?, billing_address = ?, tax_id = ?, updated_at = ? WHERE id = ?", name, country || null, str(b.billing_name ?? u.billing_name, 120) || null, str(b.billing_address ?? u.billing_address, 300) || null, str(b.tax_id ?? u.tax_id, 40) || null, ctx2.now(), u.id);
    return { user: safeUser(ctx2.db.get("SELECT * FROM users WHERE id = ?", u.id)) };
  });
  r.get("/api/account/orders/:ref", (req) => {
    const u = requireUser(req), o = ctx2.db.get("SELECT * FROM orders WHERE ref = ?", str(req.params.ref, 40));
    if (!o || o.user_id !== u.id) fail(404, "Encomenda não encontrada.", "NAO_EXISTE");
    return orderView(ctx2, o);
  });
  r.post("/api/account/orders/:ref/proofs", (req) => {
    const u = requireUser(req), o = ctx2.db.get("SELECT * FROM orders WHERE ref = ?", str(req.params.ref, 40));
    if (!o || o.user_id !== u.id) fail(404, "Encomenda não encontrada.", "NAO_EXISTE");
    const p = uploadProof(ctx2, u, o, req.raw, { filename: req.query.filename, amount: req.query.amount, date: req.query.date, ref: req.query.ref, complement: req.query.complement === "1" });
    return { ok: true, proof: { id: p.id, status: p.status }, message: "Comprovativo recebido. O pagamento encontra-se a aguardar validação." };
  });
  r.get("/api/account/proofs/:id/file", (req, res) => {
    const u = requireUser(req), p = own(ctx2, u, "proofs", req.params.id);
    send(res, 200, fs7.readFileSync(proofPath(ctx2, p)), { "Content-Type": p.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(p.filename)}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", "Cache-Control": "private, no-store" });
  });
  r.post("/api/account/orders/:ref/cancel", (req) => {
    const u = requireUser(req), o = ctx2.db.get("SELECT * FROM orders WHERE ref = ?", str(req.params.ref, 40));
    if (!o || o.user_id !== u.id) fail(404, "Encomenda não encontrada.", "NAO_EXISTE");
    if (o.status !== "pending") fail(409, "Só encomendas pendentes podem ser canceladas.", "ESTADO_INVALIDO");
    ctx2.db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", ctx2.now(), o.id);
    return { ok: true };
  });
  r.post("/api/account/licenses/:id/deactivate", (req) => {
    const u = requireUser(req), l = own(ctx2, u, "licenses", req.params.id);
    if (!u.email_verified_at) fail(403, "Confirma primeiro o teu email.", "EMAIL_POR_CONFIRMAR");
    return deactivate(ctx2, l, u, "Desativado pelo cliente na área de cliente");
  });
  r.get("/api/account/licenses/:id/history", (req) => {
    const u = requireUser(req), l = own(ctx2, u, "licenses", req.params.id);
    return {
      events: ctx2.db.all("SELECT at, actor, action, details FROM license_events WHERE license_id = ? ORDER BY at DESC LIMIT 100", l.id).map((e) => ({ ...e, actor: e.actor.includes("@") && e.actor !== u.email ? "suporte" : e.actor })),
      devices: ctx2.db.all("SELECT name, platform, app_version, activated_at, last_seen_at, deactivated_at FROM devices WHERE license_id = ? ORDER BY activated_at DESC", l.id)
    };
  });
  r.post("/api/account/subscriptions/:id/cancel", async (req) => {
    const u = requireUser(req), s = own(ctx2, u, "subscriptions", req.params.id);
    if (!["active", "past_due"].includes(s.status) || s.cancel_at_period_end) fail(409, "Esta subscrição já não renova.", "ESTADO_INVALIDO");
    if (s.provider === "stripe" && s.provider_sub_id) await stripe_exports.stripeCancel(ctx2, s);
    if (s.provider === "paypal" && s.provider_sub_id) await paypal_exports.paypalCancel(ctx2, s);
    const now = ctx2.now();
    ctx2.db.run("UPDATE subscriptions SET cancel_at_period_end = 1, auto_renew = 0, cancelled_at = ?, updated_at = ? WHERE id = ?", now, now, s.id);
    const plan = ctx2.db.get("SELECT name FROM plans WHERE id = ?", s.plan_id);
    mail(ctx2, u.email, "subscription_cancelled", { name: u.name, plan: plan.name, date: new Date(s.current_period_end).toLocaleDateString("pt-PT") });
    audit(ctx2, u, "subscription.cancel_renewal", ["subscription", s.id]);
    return { ok: true, accessUntil: s.current_period_end };
  });
  r.post("/api/account/subscriptions/:id/renew", (req) => {
    const u = requireUser(req), s = own(ctx2, u, "subscriptions", req.params.id);
    if (s.provider_sub_id) fail(400, "Esta subscrição renova automaticamente pelo prestador.", "RENOVACAO_AUTOMATICA");
    const method = ["bank_pt", "bank_ao"].includes(req.body.method) ? req.body.method : s.method;
    if (!["bank_pt", "bank_ao", "test"].includes(method)) fail(400, "Método inválido para renovação manual.", "METODO_INVALIDO");
    const pend = ctx2.db.get("SELECT ref FROM orders WHERE subscription_id = ? AND kind = 'renewal' AND status IN ('pending','awaiting_validation')", s.id);
    if (pend) return { ref: pend.ref, redirect: `${ctx2.cfg.publicUrl}/conta#encomenda/${pend.ref}` };
    const { order } = createOrder(ctx2, u, s.plan_id, method, u.country, { name: u.billing_name || u.name, address: u.billing_address, taxId: u.tax_id }, { kind: "renewal", subscriptionId: s.id });
    return { ref: order.ref, redirect: `${ctx2.cfg.publicUrl}/conta#encomenda/${order.ref}` };
  });
}

// server/src/routes/admin.js
import fs8 from "node:fs";
var reasonOf = (b) => {
  const r = str(b.reason, 500);
  if (r.length < 3) fail(400, "O motivo é obrigatório.", "MOTIVO_OBRIGATORIO");
  return r;
};
var like = (q) => "%" + String(q || "").replace(/[%_]/g, "") + "%";
function register4(r, ctx2) {
  const db = ctx2.db;
  r.get("/api/admin/dashboard", (req) => {
    requireStaff(req, "dashboard.view");
    const now = ctx2.now(), from = +req.query.from || now - 30 * 864e5, to = +req.query.to || now;
    const revenue = db.all(`SELECT p.currency, SUM(CASE WHEN p.status = 'confirmed' THEN p.amount_cents ELSE 0 END) gross, SUM(CASE WHEN p.status = 'refunded' THEN p.amount_cents ELSE 0 END) refunded, COUNT(*) n
      FROM payments p WHERE p.created_at BETWEEN ? AND ? AND p.status IN ('confirmed','refunded','disputed') GROUP BY p.currency`, from, to).map((x) => ({ ...x, grossFmt: fmtMoney(x.gross, x.currency), refundedFmt: fmtMoney(x.refunded, x.currency) }));
    const c = (sql, ...a) => db.get(sql, ...a).n;
    const daily = db.all(`SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') d, currency, SUM(amount_cents) v FROM payments WHERE status = 'confirmed' AND created_at BETWEEN ? AND ? GROUP BY d, currency ORDER BY d`, from, to);
    return {
      from,
      to,
      revenue,
      daily,
      subs: { active: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'active'"), past_due: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'past_due'"), cancelled: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'cancelled' OR cancel_at_period_end = 1"), expired: c("SELECT COUNT(*) n FROM subscriptions WHERE status = 'expired'"), expiring: c("SELECT COUNT(*) n FROM subscriptions WHERE status IN ('active','past_due') AND current_period_end BETWEEN ? AND ?", now, now + 7 * 864e5) },
      perpetual: c("SELECT COUNT(*) n FROM licenses WHERE type = 'perpetual'"),
      customers: c("SELECT COUNT(*) n FROM users WHERE role = 'customer'"),
      activeDevices: c("SELECT COUNT(*) n FROM devices WHERE deactivated_at IS NULL"),
      transfersPending: c("SELECT COUNT(*) n FROM orders WHERE method IN ('bank_pt','bank_ao') AND status = 'pending'"),
      proofsToReview: c("SELECT COUNT(*) n FROM orders WHERE status = 'awaiting_validation'"),
      failed: c("SELECT COUNT(*) n FROM orders WHERE status = 'failed' AND updated_at BETWEEN ? AND ?", from, to),
      refunds: c("SELECT COUNT(*) n FROM orders WHERE status = 'refunded'"),
      disputes: c("SELECT COUNT(*) n FROM orders WHERE status = 'disputed'"),
      warnings: warnings()
    };
  });
  function warnings() {
    const w = [];
    for (const k of ["terms", "privacy", "refund"]) {
      const t = getText(ctx2, k);
      if (!t.published) w.push(`Texto legal por validar e publicar: ${t.title}`);
    }
    for (const k of ["bank_pt", "bank_ao"]) {
      const b = getSetting(ctx2, k);
      if (b.example) w.push(`Dados bancários ${k === "bank_pt" ? "PT" : "AO"} são de EXEMPLO (modo de testes)`);
      else if (!b.iban) w.push(`Dados bancários ${k === "bank_pt" ? "PT" : "AO"} por preencher`);
    }
    if (!stripe_exports.stripeConfigured(ctx2)) w.push("Stripe (cartões) por configurar");
    if (!paypal_exports.paypalConfigured(ctx2)) w.push("PayPal por configurar");
    const rates = getSetting(ctx2, "currencies").rates;
    for (const [k, v] of Object.entries(rates)) {
      if (!v.rate) w.push(`Câmbio USD→${k} por configurar`);
      else if (v.note) w.push(`Câmbio USD→${k}: ${v.note}`);
    }
    if (ctx2.cfg.email.provider === "outbox") w.push("Emails em modo de testes (ficam na caixa de saída, não são enviados)");
    if (ctx2.cfg.mode === "test") w.push("MODO DE TESTES ativo — pagamentos simulados disponíveis");
    return w;
  }
  r.get("/api/admin/customers", (req) => {
    requireStaff(req, "customers.view");
    const q = str(req.query.q, 100), st = str(req.query.status, 20);
    return db.all(`SELECT u.*, (SELECT COUNT(*) FROM licenses l WHERE l.user_id = u.id) licenses, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'confirmed') purchases
      FROM users u WHERE u.role = 'customer' AND (u.email LIKE ? OR u.name LIKE ?) AND (? = '' OR u.status = ?) ORDER BY u.created_at DESC LIMIT 200`, like(q), like(q), st, st).map((u) => ({ ...safeUser(u), licenses: u.licenses, purchases: u.purchases }));
  });
  r.post("/api/admin/customers", (req) => {
    const a = requireStaff(req, "customers.edit"), b = req.body;
    const u = createCustomer(ctx2, { name: b.name, email: b.email, country: b.country });
    if (b.sendInvite !== false) sendReset(ctx2, u, "invite");
    audit(ctx2, a, "customer.create", ["user", u.id], { email: u.email, invite: b.sendInvite !== false });
    return safeUser(u);
  });
  r.get("/api/admin/customers/:id", (req) => {
    requireStaff(req, "customers.view");
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
    if (!u) fail(404, "Cliente inexistente.", "NAO_EXISTE");
    return {
      user: safeUser(u),
      orders: db.all("SELECT o.*, p.name plan_name FROM orders o JOIN plans p ON p.id = o.plan_id WHERE user_id = ? ORDER BY created_at DESC", u.id).map((o) => ({ id: o.id, ref: o.ref, plan: o.plan_name, kind: o.kind, method: METHOD_LABEL[o.method], status: o.status, amount: fmtMoney(o.amount_cents, o.currency), created_at: o.created_at })),
      payments: db.all("SELECT p.*, o.ref FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.user_id = ? ORDER BY p.created_at DESC", u.id).map((p) => ({ ref: p.ref, provider: p.provider, status: p.status, amount: fmtMoney(p.amount_cents, p.currency), created_at: p.created_at, confirmed_by: p.confirmed_by })),
      subscriptions: db.all("SELECT s.*, p.name plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE user_id = ?", u.id),
      licenses: db.all("SELECT l.id, l.key, l.type, l.status, l.expires_at, l.issued_at, (SELECT name FROM devices d WHERE d.license_id = l.id AND d.deactivated_at IS NULL) device FROM licenses l WHERE user_id = ?", u.id),
      sessions: db.get("SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?", u.id, ctx2.now()).n,
      audit: db.all("SELECT at, actor_email, action, reason FROM audit_log WHERE target_type = 'user' AND target_id = ? ORDER BY at DESC LIMIT 30", u.id)
    };
  });
  r.patch("/api/admin/customers/:id", (req) => {
    const a = requireStaff(req, "customers.edit"), b = req.body;
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
    if (!u) fail(404, "Cliente inexistente.", "NAO_EXISTE");
    const email = b.email !== void 0 ? str(b.email, 254).toLowerCase() : u.email;
    if (!emailOk(email)) fail(400, "Email inválido.", "EMAIL");
    if (email !== u.email && db.get("SELECT 1 FROM users WHERE email = ?", email)) fail(409, "Email já usado por outra conta.", "EMAIL_EXISTE");
    db.run(
      "UPDATE users SET name = ?, email = ?, country = ?, billing_name = ?, billing_address = ?, tax_id = ?, email_verified_at = CASE WHEN ? != email THEN NULL ELSE email_verified_at END, updated_at = ? WHERE id = ?",
      str(b.name ?? u.name, 100),
      email,
      str(b.country ?? u.country, 2).toUpperCase() || null,
      str(b.billing_name ?? u.billing_name, 120) || null,
      str(b.billing_address ?? u.billing_address, 300) || null,
      str(b.tax_id ?? u.tax_id, 40) || null,
      email,
      ctx2.now(),
      u.id
    );
    audit(ctx2, a, "customer.edit", ["user", u.id], { email: email !== u.email ? `${u.email} → ${email}` : void 0 });
    return safeUser(db.get("SELECT * FROM users WHERE id = ?", u.id));
  });
  r.post("/api/admin/customers/:id/status", (req) => {
    const b = req.body, status = str(b.status, 20);
    const a = requireStaff(req, status === "blocked" ? "customers.block" : "customers.suspend");
    if (!["active", "suspended", "blocked"].includes(status)) fail(400, "Estado inválido.", "ESTADO_INVALIDO");
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
    if (!u) fail(404, "Cliente inexistente.", "NAO_EXISTE");
    if (u.status === "blocked" && status !== "blocked" && a.role !== "owner") fail(403, "Só o administrador principal desbloqueia contas.", "SEM_PERMISSAO");
    const reason = reasonOf(b);
    db.run("UPDATE users SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?", status === "active" && !u.email_verified_at ? "pending" : status, status === "active" ? null : reason, ctx2.now(), u.id);
    if (status !== "active") db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", ctx2.now(), u.id);
    audit(ctx2, a, "customer.status_" + status, ["user", u.id], { email: u.email }, reason);
    return { ok: true, consequence: status === "suspended" ? "Login suspenso; as licenças continuam a funcionar." : status === "blocked" ? "Login bloqueado e licenças da conta impedidas de ativar/validar (não foram revogadas)." : "Acesso reposto." };
  });
  r.post("/api/admin/customers/:id/reset-link", (req) => {
    const a = requireStaff(req, "customers.edit");
    const u = db.get("SELECT * FROM users WHERE id = ? AND role = 'customer'", req.params.id);
    if (!u) fail(404, "Cliente inexistente.", "NAO_EXISTE");
    sendReset(ctx2, u, u.password_hash ? "reset" : "invite");
    audit(ctx2, a, "customer.reset_link", ["user", u.id], { email: u.email });
    return { ok: true };
  });
  const orderRow = (o) => {
    const u = db.get("SELECT name, email FROM users WHERE id = ?", o.user_id), plan = db.get("SELECT name FROM plans WHERE id = ?", o.plan_id);
    const proofs = db.all("SELECT id, filename, mime, size, declared_cents, declared_currency, transfer_date, transfer_ref, status, reason, reviewed_by, reviewed_at, created_at FROM proofs WHERE order_id = ? ORDER BY created_at DESC", o.id).map((p) => ({ ...p, declared: p.declared_cents !== null ? fmtMoney(p.declared_cents, p.declared_currency) : null }));
    const lic = db.get("SELECT id, key, status FROM licenses WHERE order_id = ?", o.id);
    return {
      id: o.id,
      ref: o.ref,
      customer: u,
      user_id: o.user_id,
      plan: plan.name,
      kind: o.kind,
      method: o.method,
      methodLabel: METHOD_LABEL[o.method],
      destination: o.method === "bank_pt" ? "Portugal" : o.method === "bank_ao" ? "Angola" : null,
      status: o.status,
      amount: fmtMoney(o.amount_cents, o.currency),
      currency: o.currency,
      amount_cents: o.amount_cents,
      tax: fmtMoney(o.tax_cents, o.currency),
      usd: fmtMoney(o.usd_cents, "USD"),
      fx: o.fx_rate,
      country: o.country,
      billing: JSON.parse(o.billing || "{}"),
      created_at: o.created_at,
      due_at: o.due_at,
      confirmed_at: o.confirmed_at,
      proofs,
      license: lic ? { id: lic.id, key4: lic.key.slice(-4), status: lic.status } : null,
      history: db.all("SELECT at, actor_email, action, reason FROM audit_log WHERE target_type = 'order' AND target_id = ? ORDER BY at DESC", o.id)
    };
  };
  r.get("/api/admin/orders", (req) => {
    requireStaff(req, "orders.view");
    const st = str(req.query.status, 30), m = str(req.query.method, 20), q = str(req.query.q, 80);
    return db.all(`SELECT o.* FROM orders o JOIN users u ON u.id = o.user_id WHERE (? = '' OR o.status = ?) AND (? = '' OR o.method = ?) AND (o.ref LIKE ? OR u.email LIKE ?) ORDER BY o.created_at DESC LIMIT 300`, st, st, m, m, like(q), like(q)).map(orderRow);
  });
  r.get("/api/admin/transfers", (req) => {
    requireStaff(req, "orders.view");
    return db.all("SELECT * FROM orders WHERE method IN ('bank_pt','bank_ao') AND status IN ('pending','awaiting_validation') ORDER BY CASE status WHEN 'awaiting_validation' THEN 0 ELSE 1 END, created_at").map(orderRow);
  });
  r.get("/api/admin/orders/:id", (req) => {
    requireStaff(req, "orders.view");
    const o = db.get("SELECT * FROM orders WHERE id = ?", req.params.id);
    if (!o) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    return orderRow(o);
  });
  r.get("/api/admin/proofs/:id/file", (req, res) => {
    const a = requireStaff(req, "orders.view"), p = db.get("SELECT * FROM proofs WHERE id = ?", req.params.id);
    if (!p) fail(404, "Comprovativo inexistente.", "NAO_EXISTE");
    audit(ctx2, a, "proof.view", ["order", p.order_id], { proof: p.id });
    send(res, 200, fs8.readFileSync(proofPath(ctx2, p)), { "Content-Type": p.mime, "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename="${encodeURIComponent(p.filename)}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", "Cache-Control": "private, no-store" });
  });
  r.post("/api/admin/orders/:id/approve", (req) => {
    const a = requireStaff(req, "payments.validate"), o = db.get("SELECT * FROM orders WHERE id = ?", req.params.id);
    if (!o) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    if (!req.body.confirmReceived) fail(400, "Confirma que verificaste a entrada efetiva do dinheiro na conta.", "CONFIRMACAO");
    const res = approveTransfer(ctx2, a, o, str(req.body.note, 300));
    return { ok: true, duplicate: !!res.duplicate, order: orderRow(db.get("SELECT * FROM orders WHERE id = ?", o.id)) };
  });
  r.post("/api/admin/orders/:id/request-info", (req) => {
    const a = requireStaff(req, "payments.validate"), o = db.get("SELECT * FROM orders WHERE id = ?", req.params.id);
    if (!o) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    proofDecision(ctx2, a, o, "needs_info", str(req.body.reason, 500));
    return { ok: true };
  });
  r.post("/api/admin/orders/:id/reject", (req) => {
    const a = requireStaff(req, "payments.validate"), o = db.get("SELECT * FROM orders WHERE id = ?", req.params.id);
    if (!o) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    proofDecision(ctx2, a, o, "reject", str(req.body.reason, 500));
    return { ok: true };
  });
  r.post("/api/admin/orders/:id/cancel", (req) => {
    const a = requireStaff(req, "payments.validate"), o = db.get("SELECT * FROM orders WHERE id = ?", req.params.id);
    if (!o) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    if (!["pending", "awaiting_validation"].includes(o.status)) fail(409, "Só encomendas pendentes podem ser canceladas.", "ESTADO_INVALIDO");
    const reason = reasonOf(req.body);
    db.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", ctx2.now(), o.id);
    audit(ctx2, a, "order.cancel", ["order", o.id], { ref: o.ref }, reason);
    return { ok: true };
  });
  r.post("/api/admin/orders/:id/refund", async (req) => {
    const a = requireStaff(req, "payments.refund"), o = db.get("SELECT * FROM orders WHERE id = ?", req.params.id);
    if (!o) fail(404, "Encomenda inexistente.", "NAO_EXISTE");
    if (o.status !== "confirmed") fail(409, "Só pagamentos confirmados podem ser reembolsados.", "ESTADO_INVALIDO");
    const reason = reasonOf(req.body), pay = db.get("SELECT * FROM payments WHERE order_id = ? AND status = 'confirmed'", o.id);
    if (pay && pay.provider === "stripe") await stripe_exports.stripeRefund(ctx2, pay);
    else if (pay && pay.provider === "paypal") {
      if (pay.provider_payment_id.startsWith("activation:")) fail(400, "Reembolsos de subscrições PayPal fazem-se no painel do PayPal.", "MANUAL");
      await paypal_exports.paypalRefund(ctx2, pay);
    } else if (!req.body.manualDone) fail(400, 'Transferências: faz a devolução pelo banco e confirma com "reembolso manual efetuado".', "MANUAL");
    reverseOrder(ctx2, o.id, "refunded", a, reason);
    return { ok: true };
  });
  r.get("/api/admin/events", (req) => {
    requireStaff(req, "payments.events");
    return db.all("SELECT id, provider, event_id, type, received_at, processed_at, result FROM payment_events WHERE (? = '' OR provider = ?) ORDER BY received_at DESC LIMIT 200", str(req.query.provider, 20), str(req.query.provider, 20));
  });
  const licRow = (l) => {
    const u = l.user_id ? db.get("SELECT name, email FROM users WHERE id = ?", l.user_id) : null, d = db.get("SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL", l.id);
    const o = l.order_id ? db.get("SELECT ref FROM orders WHERE id = ?", l.order_id) : null;
    return { id: l.id, key: l.key, type: l.type, status: l.status, statusReason: l.status_reason, major: l.major, issued_at: l.issued_at, expires_at: l.expires_at, note: l.note, customer: u, user_id: l.user_id, order: o && o.ref, subscription_id: l.subscription_id, device: d ? { name: d.name, platform: d.platform, app_version: d.app_version, activated_at: d.activated_at, last_seen_at: d.last_seen_at } : null };
  };
  r.get("/api/admin/licenses", (req) => {
    requireStaff(req, "licenses.view");
    const q = str(req.query.q, 80), t = str(req.query.type, 20), st = str(req.query.status, 20);
    return db.all(`SELECT l.* FROM licenses l LEFT JOIN users u ON u.id = l.user_id WHERE (l.key LIKE ? OR IFNULL(u.email,'') LIKE ? OR IFNULL(l.note,'') LIKE ?) AND (? = '' OR l.type = ?) AND (? = '' OR l.status = ?) ORDER BY l.issued_at DESC LIMIT 300`, like(q.toUpperCase()), like(q), like(q), t, t, st, st).map(licRow);
  });
  r.get("/api/admin/licenses/:id", (req) => {
    requireStaff(req, "licenses.view");
    const l = db.get("SELECT * FROM licenses WHERE id = ?", req.params.id);
    if (!l) fail(404, "Licença inexistente.", "NAO_EXISTE");
    return { ...licRow(l), devices: db.all("SELECT name, platform, app_version, activated_at, last_seen_at, deactivated_at, deactivated_by, deactivation_reason FROM devices WHERE license_id = ? ORDER BY activated_at DESC", l.id), events: db.all("SELECT at, actor, action, details FROM license_events WHERE license_id = ? ORDER BY at DESC LIMIT 200", l.id) };
  });
  r.post("/api/admin/licenses", (req) => {
    const a = requireStaff(req, "licenses.issue"), b = req.body;
    const type = ["gift", "demo", "perpetual"].includes(b.type) ? b.type : "gift", n = Math.min(500, Math.max(1, +b.count || 1));
    const reason = reasonOf(b);
    const user = b.email ? db.get("SELECT * FROM users WHERE email = ? AND role = 'customer'", str(b.email, 254).toLowerCase()) : null;
    if (b.email && !user) fail(404, "Cliente com esse email não existe. Cria-o primeiro em Clientes.", "NAO_EXISTE");
    if (user && n > 1) fail(400, "Lotes não são associados a um cliente.", "PEDIDO");
    const days = +b.days || 0, expiresAt = type === "demo" ? ctx2.now() + (days || 14) * 864e5 : days ? ctx2.now() + days * 864e5 : null;
    const major = +b.major || db.get("SELECT major FROM products WHERE id = 'mixmind'").major;
    const keys = db.tx(() => Array.from({ length: n }, () => issueLicense(ctx2, { userId: user && user.id, type, major, expiresAt, actor: a.email, note: reason }).license));
    audit(ctx2, a, "license.issue", ["license", keys.length === 1 ? keys[0].id : "lote"], { type, count: n, email: user && user.email, days }, reason);
    if (user) mail(ctx2, user.email, "license_issued", { name: user.name, plan: type === "gift" ? "Oferta" : type === "demo" ? "Demonstração" : "Licença perpétua", key: keys[0].key, link: ctx2.cfg.publicUrl + "/conta#licencas" });
    return { keys: keys.map((k) => ({ id: k.id, key: k.key })) };
  });
  r.post("/api/admin/licenses/:id/status", (req) => {
    const status = str(req.body.status, 20);
    if (!["active", "suspended", "revoked"].includes(status)) fail(400, "Estado inválido.", "ESTADO_INVALIDO");
    const a = requireStaff(req, status === "revoked" ? "licenses.revoke" : "licenses.manage");
    const l = db.get("SELECT * FROM licenses WHERE id = ?", req.params.id);
    if (!l) fail(404, "Licença inexistente.", "NAO_EXISTE");
    setLicenseStatus(ctx2, l, status, a, reasonOf(req.body));
    return { ok: true, consequence: status === "revoked" ? "Revogada: deixa de ativar e de validar. Computadores offline só sabem quando voltarem a contactar o servidor (ou quando o comprovativo expirar)." : status === "suspended" ? "Suspensa: não ativa nem valida até ser reativada. O login do cliente não muda." : "Reativada." };
  });
  r.post("/api/admin/licenses/:id/release-device", (req) => {
    const a = requireStaff(req, "licenses.manage"), l = db.get("SELECT * FROM licenses WHERE id = ?", req.params.id);
    if (!l) fail(404, "Licença inexistente.", "NAO_EXISTE");
    const reason = reasonOf(req.body), out = deactivate(ctx2, l, a, "Recuperação administrativa: " + reason);
    if (req.body.resetLimit) {
      db.run("UPDATE licenses SET transfer_reset_at = ? WHERE id = ?", ctx2.now(), l.id);
      licEvent(ctx2, l.id, a, "transfer_limit_reset", reason);
    }
    audit(ctx2, a, "license.release_device", ["license", l.id], out, reason);
    return out;
  });
  r.post("/api/admin/licenses/:id/extend", (req) => {
    const a = requireStaff(req, "subscriptions.manage"), l = db.get("SELECT * FROM licenses WHERE id = ?", req.params.id);
    if (!l) fail(404, "Licença inexistente.", "NAO_EXISTE");
    const days = Math.round(+req.body.days);
    if (!(days > 0 && days <= 3650)) fail(400, "Dias inválidos.", "PEDIDO");
    if (!l.expires_at) fail(400, "Licenças perpétuas não expiram.", "PERPETUA");
    const reason = reasonOf(req.body), base = Math.max(ctx2.now(), l.expires_at), end = base + days * 864e5;
    db.tx(() => {
      db.run("UPDATE licenses SET expires_at = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END WHERE id = ?", end, l.id);
      if (l.subscription_id) db.run("UPDATE subscriptions SET current_period_end = ?, status = CASE WHEN status = 'expired' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", end, ctx2.now(), l.subscription_id);
      licEvent(ctx2, l.id, a, "extended", { days, until: end, reason });
    });
    audit(ctx2, a, "license.extend", ["license", l.id], { days, until: end }, reason);
    return { ok: true, until: end };
  });
  r.post("/api/admin/licenses/:id/assign", (req) => {
    const a = requireStaff(req, "licenses.issue"), l = db.get("SELECT * FROM licenses WHERE id = ?", req.params.id);
    if (!l) fail(404, "Licença inexistente.", "NAO_EXISTE");
    const u = db.get("SELECT * FROM users WHERE email = ? AND role = 'customer'", str(req.body.email, 254).toLowerCase());
    if (!u) fail(404, "Cliente inexistente.", "NAO_EXISTE");
    const reason = reasonOf(req.body);
    db.run("UPDATE licenses SET user_id = ? WHERE id = ?", u.id, l.id);
    licEvent(ctx2, l.id, a, "assigned", { email: u.email, reason });
    audit(ctx2, a, "license.assign", ["license", l.id], { email: u.email }, reason);
    return { ok: true };
  });
  r.get("/api/admin/subscriptions", (req) => {
    requireStaff(req, "licenses.view");
    const f = str(req.query.filter, 20), now = ctx2.now();
    const where = f === "expiring" ? `s.status IN ('active','past_due') AND s.current_period_end BETWEEN ${now} AND ${now + 7 * 864e5}` : f === "past_due" ? "s.status = 'past_due'" : f === "manual" ? "s.provider_sub_id IS NULL AND s.method IN ('bank_pt','bank_ao')" : f ? `s.status = '${["active", "cancelled", "expired"].includes(f) ? f : "active"}'` : "1=1";
    return db.all(`SELECT s.*, p.name plan_name, u.email, u.name, (SELECT id FROM licenses l WHERE l.subscription_id = s.id) license_id,
      (SELECT ref FROM orders o WHERE o.subscription_id = s.id AND o.kind = 'renewal' AND o.status IN ('pending','awaiting_validation')) pending_renewal FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN users u ON u.id = s.user_id WHERE ${where} ORDER BY s.current_period_end LIMIT 300`).map((s) => ({ id: s.id, plan: s.plan_name, customer: { email: s.email, name: s.name }, method: METHOD_LABEL[s.method], provider: s.provider, status: s.status, autoRenew: !!s.auto_renew, cancelAtPeriodEnd: !!s.cancel_at_period_end, periodEnd: s.current_period_end, licenseId: s.license_id, pendingRenewal: s.pending_renewal }));
  });
  r.post("/api/admin/subscriptions/:id/cancel-renewal", async (req) => {
    const a = requireStaff(req, "subscriptions.manage"), s = db.get("SELECT * FROM subscriptions WHERE id = ?", req.params.id);
    if (!s) fail(404, "Subscrição inexistente.", "NAO_EXISTE");
    const reason = reasonOf(req.body);
    if (s.provider === "stripe" && s.provider_sub_id) await stripe_exports.stripeCancel(ctx2, s);
    if (s.provider === "paypal" && s.provider_sub_id) await paypal_exports.paypalCancel(ctx2, s);
    db.run("UPDATE subscriptions SET cancel_at_period_end = 1, auto_renew = 0, cancelled_at = ?, updated_at = ? WHERE id = ?", ctx2.now(), ctx2.now(), s.id);
    audit(ctx2, a, "subscription.cancel_renewal", ["subscription", s.id], null, reason);
    return { ok: true, accessUntil: s.current_period_end };
  });
  const EDITABLE = ["currencies", "taxes", "methods", "bank_pt", "bank_ao", "licensing", "demo", "security", "support", "store"];
  r.get("/api/admin/settings", (req) => {
    requireStaff(req, "settings.view");
    const out = {};
    for (const k of EDITABLE) out[k] = getSetting(ctx2, k);
    const cr = getSetting(ctx2, "credentials") || {};
    const mask = (p, keys) => Object.fromEntries(keys.map((k) => {
      const envV = ctx2.cfg[p][k];
      const dbV = cr[p] && cr[p][k] ? ctx2.cipher.dec(cr[p][k]) : "";
      const v = envV || dbV;
      return [k, { set: !!v, source: envV ? "variável de ambiente" : dbV ? "painel (cifrado)" : null, hint: v ? "••••" + v.slice(-4) : "" }];
    }));
    out.credentials = { stripe: mask("stripe", ["secretKey", "webhookSecret"]), paypal: mask("paypal", ["clientId", "clientSecret", "webhookId"]), webhooks: { stripe: ctx2.cfg.publicUrl + "/api/webhooks/stripe", paypal: ctx2.cfg.publicUrl + "/api/webhooks/paypal" } };
    out.plans = db.all("SELECT * FROM plans ORDER BY sort");
    out.annualSaving = annualSaving(ctx2);
    out.versions = db.all("SELECT * FROM versions ORDER BY published_at DESC");
    out.licensePublicKey = signingKeys(ctx2).spki;
    out.mode = ctx2.cfg.mode;
    out.emailProvider = ctx2.cfg.email.provider;
    return out;
  });
  r.put("/api/admin/settings/:key", (req) => {
    const a = requireStaff(req, "settings.edit"), k = req.params.key;
    if (!EDITABLE.includes(k)) fail(404, "Configuração inexistente.", "NAO_EXISTE");
    const v = req.body.value;
    if (!v || typeof v !== "object") fail(400, "Valor inválido.", "PEDIDO");
    if (k === "methods" && v.test && v.test.enabled && !ctx2.cfg.test) v.test.enabled = false;
    if ((k === "bank_pt" || k === "bank_ao") && v.example) delete v.example;
    if (k === "currencies") for (const r2 of Object.values(v.rates || {})) {
      if (r2.rate !== null && !(+r2.rate > 0)) fail(400, "Câmbio inválido.", "PEDIDO");
      if (r2.rate) {
        r2.rate = +r2.rate;
        delete r2.note;
      }
    }
    setSetting(ctx2, k, v, a.email);
    audit(ctx2, a, "settings." + k, ["settings", k], k.startsWith("bank") ? { iban: v.iban ? "…" + String(v.iban).slice(-4) : "" } : v, str(req.body.reason, 300) || null);
    return { ok: true };
  });
  r.put("/api/admin/credentials/:provider", (req) => {
    const a = requireStaff(req, "settings.edit"), p = req.params.provider;
    const allowed = { stripe: ["secretKey", "webhookSecret"], paypal: ["clientId", "clientSecret", "webhookId"] }[p];
    if (!allowed) fail(404, "Prestador inexistente.", "NAO_EXISTE");
    const cr = getSetting(ctx2, "credentials") || {};
    cr[p] = cr[p] || {};
    for (const k of allowed) {
      const v = req.body[k];
      if (v === "") delete cr[p][k];
      else if (typeof v === "string" && v.length) cr[p][k] = ctx2.cipher.enc(v.trim());
    }
    setSetting(ctx2, "credentials", cr, a.email);
    audit(ctx2, a, "credentials." + p, ["settings", "credentials"], { fields: Object.keys(req.body).filter((k) => allowed.includes(k)) });
    return { ok: true };
  });
  r.put("/api/admin/plans/:id", (req) => {
    const a = requireStaff(req, "settings.edit"), pl = db.get("SELECT * FROM plans WHERE id = ?", req.params.id);
    if (!pl) fail(404, "Plano inexistente.", "NAO_EXISTE");
    const b = req.body, price = Math.round(+b.price_usd * 100);
    if (!(price >= 100 && price <= 1e7)) fail(400, "Preço inválido.", "PEDIDO");
    db.run("UPDATE plans SET name = ?, price_usd_cents = ?, active = ?, stripe_price_id = ?, paypal_plan_id = ? WHERE id = ?", str(b.name ?? pl.name, 60), price, b.active === false ? 0 : 1, str(b.stripe_price_id, 80) || null, str(b.paypal_plan_id, 80) || null, pl.id);
    audit(ctx2, a, "plan.edit", ["plan", pl.id], { price: price / 100, before: pl.price_usd_cents / 100 }, str(b.reason, 300) || null);
    return { ok: true, annualSaving: annualSaving(ctx2) };
  });
  r.post("/api/admin/versions", (req) => {
    const a = requireStaff(req, "settings.edit"), b = req.body, ver = str(b.version, 20);
    if (!/^\d+\.\d+(\.\d+)?$/.test(ver)) fail(400, "Versão inválida (ex.: 1.8.1).", "PEDIDO");
    const url = (u) => {
      u = str(u, 400);
      if (u && !/^https:\/\//.test(u)) fail(400, "As ligações têm de ser https://", "PEDIDO");
      return u || null;
    };
    db.tx(() => {
      if (b.current) db.run("UPDATE versions SET is_current = 0");
      db.run("INSERT INTO versions VALUES (?,?,?,?,?,?,?,?,?,?)", uuid(), "mixmind", ver, +ver.split(".")[0], str(b.notes, 2e3), url(b.url_web), url(b.url_windows), url(b.url_macos), b.current ? 1 : 0, ctx2.now());
    });
    audit(ctx2, a, "version.add", ["version", ver], b);
    return { ok: true };
  });
  r.get("/api/admin/texts", (req) => {
    requireStaff(req, "settings.view");
    return db.all("SELECT * FROM texts ORDER BY key");
  });
  r.put("/api/admin/texts/:key", (req) => {
    const a = requireStaff(req, "texts.edit"), t = getText(ctx2, req.params.key);
    if (!t) fail(404, "Texto inexistente.", "NAO_EXISTE");
    const draft = String(req.body.draft || "");
    if (draft.length < 10 || draft.length > 5e4) fail(400, "Texto inválido.", "PEDIDO");
    const isEmail = t.key.startsWith("email:");
    db.run(`UPDATE texts SET draft = ?, ${isEmail ? "published = ?, published_at = ?, published_by = ?," : ""} validated_by = NULL, validated_at = NULL, updated_by = ?, updated_at = ? WHERE key = ?`, ...isEmail ? [draft, draft, ctx2.now(), a.email] : [draft], a.email, ctx2.now(), t.key);
    audit(ctx2, a, "text.edit", ["text", t.key]);
    return { ok: true };
  });
  r.post("/api/admin/texts/:key/validate", (req) => {
    const a = requireStaff(req, "texts.publish"), t = getText(ctx2, req.params.key);
    if (!t) fail(404, "Texto inexistente.", "NAO_EXISTE");
    if (!req.body.confirm) fail(400, "Confirma que o texto foi revisto e validado (jurídico/comercial).", "CONFIRMACAO");
    db.run("UPDATE texts SET validated_by = ?, validated_at = ? WHERE key = ?", a.email + (req.body.reviewer ? " (revisto por " + str(req.body.reviewer, 80) + ")" : ""), ctx2.now(), t.key);
    audit(ctx2, a, "text.validate", ["text", t.key], { reviewer: str(req.body.reviewer, 80) });
    return { ok: true };
  });
  r.post("/api/admin/texts/:key/publish", (req) => {
    const a = requireStaff(req, "texts.publish"), t = getText(ctx2, req.params.key);
    if (!t) fail(404, "Texto inexistente.", "NAO_EXISTE");
    if (!t.validated_at) fail(409, "Valida o texto antes de o publicar.", "POR_VALIDAR");
    db.run("UPDATE texts SET published = draft, published_by = ?, published_at = ? WHERE key = ?", a.email, ctx2.now(), t.key);
    audit(ctx2, a, "text.publish", ["text", t.key]);
    return { ok: true };
  });
  r.get("/api/admin/staff", (req) => {
    requireStaff(req, "staff.manage");
    return { roles: Object.entries(ROLES).map(([id, label]) => ({ id, label, perms: permsOf(id) })), staff: db.all("SELECT * FROM users WHERE role != 'customer' ORDER BY created_at").map(safeUser) };
  });
  r.post("/api/admin/staff", (req) => {
    const a = requireStaff(req, "staff.manage"), b = req.body, role = str(b.role, 20);
    if (!["owner", "finance", "support"].includes(role)) fail(400, "Perfil inválido.", "PEDIDO");
    const email = str(b.email, 254).toLowerCase();
    if (!emailOk(email)) fail(400, "Email inválido.", "EMAIL");
    if (db.get("SELECT 1 FROM users WHERE email = ?", email)) fail(409, "Já existe uma conta com este email.", "EMAIL_EXISTE");
    const id = uuid(), now = ctx2.now();
    db.run("INSERT INTO users (id, email, name, role, status, email_verified_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", id, email, str(b.name, 100) || email, role, "active", now, now, now);
    sendReset(ctx2, db.get("SELECT * FROM users WHERE id = ?", id), "invite");
    audit(ctx2, a, "staff.invite", ["user", id], { email, role });
    return { ok: true };
  });
  r.patch("/api/admin/staff/:id", (req) => {
    const a = requireStaff(req, "staff.manage"), u = db.get("SELECT * FROM users WHERE id = ? AND role != 'customer'", req.params.id);
    if (!u) fail(404, "Membro inexistente.", "NAO_EXISTE");
    const role = str(req.body.role, 20), status = str(req.body.status, 20);
    if (u.id === a.id) fail(400, "Não podes alterar o teu próprio perfil ou estado.", "PEDIDO");
    if (role === "owner" || u.role === "owner") {
      const owners = db.get("SELECT COUNT(*) n FROM users WHERE role = 'owner' AND status = 'active'").n;
      if (u.role === "owner" && owners <= 1 && (role !== "owner" || status === "blocked")) fail(400, "Tem de existir pelo menos um administrador principal ativo.", "PEDIDO");
    }
    if (role && ["owner", "finance", "support"].includes(role)) db.run("UPDATE users SET role = ? WHERE id = ?", role, u.id);
    if (status && ["active", "blocked"].includes(status)) {
      db.run("UPDATE users SET status = ? WHERE id = ?", status, u.id);
      if (status === "blocked") db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ?", ctx2.now(), u.id);
    }
    audit(ctx2, a, "staff.edit", ["user", u.id], { role, status }, str(req.body.reason, 300) || null);
    return { ok: true };
  });
  r.get("/api/admin/audit", (req) => {
    requireStaff(req, "audit.view");
    return db.all("SELECT * FROM audit_log WHERE (? = '' OR action LIKE ?) ORDER BY at DESC LIMIT 300", str(req.query.q, 60), like(req.query.q));
  });
  r.get("/api/admin/emails", (req) => {
    requireStaff(req, "emails.view");
    return db.all("SELECT * FROM emails ORDER BY id DESC LIMIT 200");
  });
}

// server/src/routes/license.js
function register5(r, ctx2) {
  r.get("/api/v1/licenses/public-key", () => {
    const K = signingKeys(ctx2);
    return { alg: "ES256", curve: "P-256", format: "MMX1.<payload base64url>.<assinatura IEEE-P1363 base64url>", kid: K.kid, spki: K.spki, jwk: K.jwk };
  });
  r.get("/api/v1/app/config", () => {
    const v = ctx2.db.get("SELECT version, url_web, url_windows, url_macos FROM versions WHERE is_current = 1");
    return { demo: getSetting(ctx2, "demo"), latest: v, store: ctx2.cfg.publicUrl, checkDays: getSetting(ctx2, "licensing").checkDays };
  });
  r.post("/api/v1/licenses/activate", (req) => {
    const b = req.body;
    return activate(ctx2, { key: str(b.key, 40), machineId: str(b.machineId, 200), name: str(b.machineName, 80), platform: str(b.platform, 40), appVersion: str(b.appVersion, 20) }, req.ip);
  });
  r.post("/api/v1/licenses/validate", (req) => validate(ctx2, { key: str(req.body.key, 40), machineId: str(req.body.machineId, 200), appVersion: str(req.body.appVersion, 20) }));
  r.post("/api/v1/licenses/deactivate", (req) => {
    const lic = ctx2.db.get("SELECT * FROM licenses WHERE key = ?", normKey(str(req.body.key, 40)));
    if (!lic) fail(404, "Chave de licença inválida.", "NAO_EXISTE");
    void licenseUsable;
    return deactivate(ctx2, lic, "app", "Desativado na aplicação", str(req.body.machineId, 200));
  });
}

// server/src/routes/app.js
var TYPE_ORDER = { perpetual: 0, subscription: 1, gift: 2, demo: 3 };
function accessFor(ctx2, u, m, ip) {
  const demo = getSetting(ctx2, "demo");
  if (u.role !== "customer") return { mode: "staff", label: "Conta da equipa" };
  if (!m.machineId || String(m.machineId).length < 8) fail(400, "Identificador do computador inválido.", "MAQUINA_INVALIDA");
  const lics = ctx2.db.all("SELECT * FROM licenses WHERE user_id = ? AND status IN ('active','expired','suspended') ORDER BY issued_at", u.id).sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || (b.expires_at || 9e15) - (a.expires_at || 9e15));
  const usable = lics.filter((l) => licenseUsable(ctx2, l).ok);
  const mh = machineHash(ctx2, m.machineId);
  const dev = (l) => ctx2.db.get("SELECT * FROM devices WHERE license_id = ? AND deactivated_at IS NULL", l.id);
  for (const l of usable) {
    const d = dev(l);
    if (d && d.machine_hash === mh) {
      const v = validate(ctx2, { key: l.key, machineId: m.machineId, appVersion: m.appVersion });
      if (v.ok) return { mode: "licensed", key: l.key, token: v.token, license: v.license };
    }
  }
  const problems = [];
  for (const l of usable) {
    if (dev(l)) continue;
    try {
      const a = activate(ctx2, { key: l.key, machineId: m.machineId, name: m.machineName, platform: m.platform, appVersion: m.appVersion }, ip);
      return { mode: "licensed", key: l.key, token: a.token, license: a.license, activatedNow: !a.reused };
    } catch (e) {
      problems.push(e.message);
    }
  }
  const elsewhere = usable.map((l) => ({ l, d: dev(l) })).filter((x) => x.d);
  if (elsewhere.length) return { mode: "other_machine", demo, problems, devices: elsewhere.map(({ l, d }) => ({ license: publicLicense(l), name: d.name, platform: d.platform, lastSeen: d.last_seen_at })) };
  const reason = !lics.length ? "Ainda não tens uma licença." : problems[0] || licenseUsable(ctx2, lics[lics.length - 1]).msg;
  return { mode: "demo", demo, reason, licenses: lics.map(publicLicense) };
}
function register6(r, ctx2) {
  const db = ctx2.db;
  const machineOf = (b) => ({ machineId: str(b.machineId, 200), machineName: str(b.machineName, 80), platform: str(b.platform, 40), appVersion: str(b.appVersion, 20) });
  const sessionOf = (req) => {
    const h = String(req.headers.authorization || ""), tok2 = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!tok2) fail(401, "Sessão em falta. Entra de novo.", "SEM_SESSAO");
    const s = db.get("SELECT * FROM sessions WHERE id = ? AND kind = 'app' AND revoked_at IS NULL AND expires_at > ?", sha256(tok2), ctx2.now());
    if (!s) fail(401, "A sessão terminou. Entra de novo.", "SEM_SESSAO");
    const u = db.get("SELECT * FROM users WHERE id = ?", s.user_id);
    if (!u || u.status === "blocked" || u.status === "suspended") {
      db.run("UPDATE sessions SET revoked_at = ? WHERE id = ?", ctx2.now(), s.id);
      fail(403, u && u.status === "blocked" ? "Esta conta está bloqueada. Contacta o suporte." : "O acesso a esta conta está suspenso. Contacta o suporte.", u && u.status === "blocked" ? "CONTA_BLOQUEADA" : "CONTA_SUSPENSA");
    }
    db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", ctx2.now(), s.id);
    return { s, u };
  };
  const userOut = (u) => ({ name: u.name, email: u.email, role: u.role, staff: u.role !== "customer", totp: !!u.totp_enabled });
  const extra = () => ({ store: ctx2.cfg.publicUrl, demo: getSetting(ctx2, "demo"), checkDays: getSetting(ctx2, "licensing").checkDays });
  r.post("/api/v1/app/login", (req) => {
    const b = req.body, m = machineOf(b);
    const u = authenticate(ctx2, req, b.email, b.password);
    if (u.must_change_password) fail(403, "Tens de alterar a palavra-passe inicial antes de entrares. Faz isso na loja (Entrar) e volta.", "TROCA_PALAVRA_PASSE");
    if (u.role === "customer" && !u.email_verified_at) fail(403, "Confirma primeiro o teu email (enviámos uma ligação quando criaste a conta).", "EMAIL_POR_CONFIRMAR");
    if (u.role !== "customer" && getSetting(ctx2, "security").require2faForStaff && !u.totp_enabled) fail(403, "A verificação em dois passos é obrigatória para a equipa. Ativa-a na loja (A minha segurança).", "MFA_OBRIGATORIA");
    if (u.totp_enabled) {
      const code = str(b.code, 10);
      if (!code) fail(401, "Introduz o código de 6 dígitos da aplicação de autenticação.", "MFA_NECESSARIO");
      const S = getSetting(ctx2, "security"), now2 = ctx2.now();
      if (db.get("SELECT COUNT(*) n FROM login_attempts WHERE key = ? AND at > ? AND ok = 0", "m:" + u.id, now2 - S.lockMinutes * 6e4).n >= S.loginMaxAttempts) fail(429, "Demasiadas tentativas de código.", "BLOQUEIO_TEMPORARIO");
      const ok = verifyTotp(ctx2.cipher.dec(u.totp_secret), code, now2);
      db.run("INSERT INTO login_attempts VALUES (?,?,?)", "m:" + u.id, now2, ok ? 1 : 0);
      if (!ok) fail(401, "Código inválido.", "MFA_CODIGO");
    }
    const access = accessFor(ctx2, u, m, req.ip);
    const token2 = randomToken(32), now = ctx2.now();
    db.run("INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, ip, ua, mfa_ok, kind, machine) VALUES (?,?,?,?,?,?,?,1,'app',?)", sha256(token2), u.id, now, now + ctx2.cfg.sessionDays * 864e5, now, req.ip, ("App MIXMIND · " + (m.machineName || m.platform || "computador")).slice(0, 200), m.machineId ? sha256("m:" + m.machineId).slice(0, 16) : null);
    if (u.role !== "customer") audit(ctx2, { ...u, ip: req.ip }, "staff.app_login", ["user", u.id], m.machineName || null);
    return { token: token2, user: userOut(u), access, ...extra() };
  });
  r.post("/api/v1/app/session", (req) => {
    const { u } = sessionOf(req), m = machineOf(req.body);
    return { user: userOut(u), access: accessFor(ctx2, u, m, req.ip), ...extra() };
  });
  r.post("/api/v1/app/logout", (req) => {
    const { s } = sessionOf(req);
    db.run("UPDATE sessions SET revoked_at = ? WHERE id = ?", ctx2.now(), s.id);
    return { ok: true };
  });
}

// server/src/appsite.js
import fs9 from "node:fs";
import path7 from "node:path";
var FILES = /* @__PURE__ */ new Set(["index.html", "portal.html", "sw.js", "manifest.webmanifest", "mixmind.js", "mixmind.css", "portal.js"]);
var DIRS = /* @__PURE__ */ new Set(["js", "css", "assets", "styles", "wasm"]);
var TYPES2 = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm" };
var CDN = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com";
var APP_CSP = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' blob: ${CDN} 'sha256-uZcjrkjRXaJdE3hSPk1FMJntyHgj58w5MWC74X9n+ok='`,
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: data: blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'"
].join("; ");
var appDir = (ctx2) => path7.resolve(ctx2.cfg.appDir || path7.join(ROOT, ".."));
function configJs(ctx2) {
  if (ctx2._appConfig) return ctx2._appConfig;
  const f = path7.join(appDir(ctx2), "config.js");
  const base = fs9.existsSync(f) ? fs9.readFileSync(f, "utf8") : "window.MIXMIND_CONFIG = {};";
  const K = signingKeys(ctx2);
  ctx2._appConfig = `${base}
;/* servido pela loja: login, licenças e chave pública deste servidor (gerado automaticamente) */
(function (c) { c.LICENSE_API = location.origin; c.LICENSE_PUBLIC_KEY = ${JSON.stringify(K.spki)}; if (c.EXIGIR_LOGIN === undefined) c.EXIGIR_LOGIN = true; })(window.MIXMIND_CONFIG = window.MIXMIND_CONFIG || {});
`;
  return ctx2._appConfig;
}
function serveApp(ctx2, rel, res) {
  let p;
  try {
    p = decodeURIComponent(rel);
  } catch {
    return false;
  }
  if (p === "/" || p === "") p = "/index.html";
  const parts = p.split("/").filter(Boolean);
  if (!parts.length || parts.some((x) => x.startsWith(".") || x.includes("\\"))) return false;
  if (p === "/config.js") {
    send(res, 200, configJs(ctx2), { "Content-Type": TYPES2[".js"], "Cache-Control": "no-cache" });
    return true;
  }
  const ok = parts.length === 1 ? FILES.has(parts[0]) : DIRS.has(parts[0]);
  const ext = path7.extname(p).toLowerCase();
  if (!ok || !TYPES2[ext]) return false;
  const root = appDir(ctx2), file = path7.resolve(root, "." + p);
  if (!file.startsWith(root + path7.sep) || !fs9.existsSync(file) || !fs9.statSync(file).isFile()) return false;
  const fresh = ext === ".html" || ext === ".webmanifest" || parts[0] === "sw.js" || ext === ".json";
  send(res, 200, fs9.readFileSync(file), { "Content-Type": TYPES2[ext], "Cache-Control": fresh ? "no-cache" : "public, max-age=300", ...ext === ".html" ? { "Content-Security-Policy": APP_CSP } : {} });
  return true;
}

// server/src/server.js
function createServer(ctx2) {
  const r = router();
  ctx2.creds = (p) => {
    const c = getSetting(ctx2, "credentials") || {}, x = c[p] || {};
    const out = {};
    for (const [k, v] of Object.entries(x)) {
      try {
        out[k] = ctx2.cipher.dec(v);
      } catch {
        out[k] = "";
      }
    }
    return out;
  };
  register(r, ctx2);
  register2(r, ctx2);
  register3(r, ctx2);
  register4(r, ctx2);
  register5(r, ctx2);
  register6(r, ctx2);
  const publicDir = path8.join(ROOT, "public");
  const licOrigins = () => new Set([...ctx2.cfg.corsOrigins, (() => {
    try {
      return new URL(ctx2.cfg.appUrl).origin;
    } catch {
      return null;
    }
  })()].filter(Boolean));
  const rate = /* @__PURE__ */ new Map();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    req.ip = ctx2.cfg.trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
    req.query = Object.fromEntries(url.searchParams);
    req.ctx = ctx2;
    const isApi = url.pathname.startsWith("/api/");
    try {
      if (url.pathname.startsWith("/api/v1/")) {
        const o = req.headers.origin;
        if (o && licOrigins().has(o)) {
          res.setHeader("Access-Control-Allow-Origin", o);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST");
        }
        if (req.method === "OPTIONS") return send(res, 204, "");
        const k = req.ip + ":" + Math.floor(Date.now() / 6e4), n = (rate.get(k) || 0) + 1;
        rate.set(k, n);
        if (rate.size > 5e3) rate.clear();
        if (n > 60) fail(429, "Demasiados pedidos. Tenta dentro de um minuto.", "LIMITE");
      }
      if (!isApi) {
        if (req.method !== "GET" && req.method !== "HEAD") fail(405, "Método não permitido.");
        if (url.pathname === "/teste-pagamento" && !ctx2.cfg.test) fail(404, "Não encontrado.");
        if (url.pathname === "/app") return send(res, 301, "", { Location: "/app/" + url.search });
        if (url.pathname.startsWith("/app/") && serveApp(ctx2, url.pathname.slice(4), res)) return;
        if (serveStatic(publicDir, url.pathname, res)) return;
        return serveStatic(publicDir, "/404", res, 404) || send(res, 404, "Não encontrado");
      }
      const m = r.match(req.method, url.pathname);
      if (!m) fail(404, "Endpoint inexistente.", "NAO_EXISTE");
      req.params = m.params;
      const tok2 = parseCookies(req.headers.cookie).mm_s;
      if (tok2) {
        const s = ctx2.db.get("SELECT * FROM sessions WHERE id = ? AND kind = 'web' AND revoked_at IS NULL AND expires_at > ?", sha256(tok2), Date.now());
        if (s) {
          const u = ctx2.db.get("SELECT * FROM users WHERE id = ?", s.user_id);
          if (u && u.status !== "blocked" && u.status !== "suspended") {
            req.session = s;
            req.user = { ...u, ip: req.ip };
            if (Date.now() - s.last_seen_at > 6e4) ctx2.db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", Date.now(), s.id);
          }
        }
      }
      const webhook2 = url.pathname.startsWith("/api/webhooks/") || url.pathname.startsWith("/api/v1/");
      if (!["GET", "HEAD"].includes(req.method) && !webhook2) {
        if (req.headers["x-mm"] !== "1") fail(403, "Pedido recusado (CSRF).", "CSRF");
        const o = req.headers.origin;
        if (o && o !== ctx2.cfg.publicUrl && !ctx2.cfg.test) fail(403, "Origem não permitida.", "CSRF");
      }
      const raw = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req, url.pathname.includes("/proofs") ? 11 * 1024 * 1024 : 1024 * 1024) : Buffer.alloc(0);
      req.raw = raw;
      if (raw.length && String(req.headers["content-type"] || "").includes("application/json")) {
        try {
          req.body = JSON.parse(raw.toString("utf8"));
        } catch {
          fail(400, "JSON inválido.", "JSON");
        }
      } else req.body = {};
      let out;
      for (const h of m.handlers) {
        out = await h(req, res, ctx2);
        if (res.headersSent) return;
      }
      if (out && out.__redirect) return send(res, 302, "", { Location: out.__redirect });
      return send(res, 200, out === void 0 ? { ok: true } : out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, isApi ? { error: e.message, code: e.code, ...e.extra || {} } : e.message);
      ctx2.log("ERRO", req.method, url.pathname, e.stack || e.message);
      return send(res, 500, isApi ? { error: "Erro interno. Tenta novamente.", code: "INTERNO" } : "Erro interno");
    }
  });
  const tick = () => {
    try {
      const r2 = runJobs(ctx2);
      if (r2.expired || r2.reminders || r2.ordersExpired) ctx2.log("Tarefas:", JSON.stringify(r2));
    } catch (e) {
      ctx2.log("Tarefas falharam", e.message);
    }
  };
  tick();
  const timer = setInterval(tick, 15 * 6e4);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  return server;
}

// server/src/index.js
var cfg = loadConfig();
var ctx = createContext(cfg);
signingKeys(ctx);
createServer(ctx).listen(cfg.port, () => {
  ctx.log(`MIXMIND · loja e licenças em ${cfg.publicUrl} (modo ${cfg.mode === "test" ? "DE TESTES" : "produção"})`);
  if (!ctx.db.get("SELECT 1 FROM users WHERE role = 'owner'")) ctx.log("ATENÇÃO: sem administrador. Define ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD e reinicia.");
});
