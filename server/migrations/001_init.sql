-- MIXMIND · loja, contas e licenças — esquema inicial (SQLite)
-- Valores monetários em unidades mínimas (cêntimos) com a moeda ao lado. Datas em ms desde 1970 (UTC).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  country TEXT,
  password_hash TEXT,                      -- scrypt; NULL = convite por aceitar
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','owner','finance','support')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','blocked')),
  email_verified_at INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,                        -- cifrado (AES-256-GCM)
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  billing_name TEXT, billing_address TEXT, tax_id TEXT,
  status_reason TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                     -- SHA-256 do token (o token só existe no cookie)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  ip TEXT, ua TEXT, mfa_ok INTEGER NOT NULL DEFAULT 1, revoked_at INTEGER
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE tokens (                      -- confirmação de email, recuperação, convite
  id TEXT PRIMARY KEY,                     -- SHA-256 do token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify','reset','invite')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);

CREATE TABLE login_attempts (key TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL);
CREATE INDEX login_attempts_key ON login_attempts(key, at);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT);

CREATE TABLE texts (                       -- textos legais e templates de email (rascunho → validado → publicado)
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  draft TEXT NOT NULL,
  published TEXT,
  validated_by TEXT, validated_at INTEGER,
  published_by TEXT, published_at INTEGER,
  updated_by TEXT, updated_at INTEGER NOT NULL
);

CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, major INTEGER NOT NULL);
CREATE TABLE versions (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), version TEXT NOT NULL, major INTEGER NOT NULL,
  notes TEXT, url_web TEXT, url_windows TEXT, url_macos TEXT, is_current INTEGER NOT NULL DEFAULT 0, published_at INTEGER NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,                     -- perpetual | monthly | annual
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('perpetual','subscription')),
  interval TEXT CHECK (interval IN ('month','year')),
  price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents > 0),
  active INTEGER NOT NULL DEFAULT 1,
  stripe_price_id TEXT, paypal_plan_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,                -- referência mostrada ao cliente e usada na transferência
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  kind TEXT NOT NULL DEFAULT 'purchase' CHECK (kind IN ('purchase','renewal','gift')),
  subscription_id TEXT,                    -- renovações
  method TEXT NOT NULL CHECK (method IN ('card','paypal','bank_pt','bank_ao','test','gift')),
  currency TEXT NOT NULL, amount_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL DEFAULT 0, tax_rate REAL NOT NULL DEFAULT 0,
  usd_cents INTEGER NOT NULL, fx_rate REAL NOT NULL DEFAULT 1,
  country TEXT,
  billing TEXT,                            -- JSON (nome, morada, NIF)
  status TEXT NOT NULL CHECK (status IN ('pending','awaiting_validation','confirmed','failed','expired','refunded','disputed','cancelled')),
  provider_ref TEXT,                       -- sessão de checkout / ordem PayPal
  created_at INTEGER NOT NULL, due_at INTEGER, confirmed_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE INDEX orders_user ON orders(user_id);
CREATE INDEX orders_status ON orders(status);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL, provider_payment_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','expired','refunded','disputed')),
  amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
  confirmed_by TEXT,                       -- admin (transferências)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (provider, provider_payment_id)
);

CREATE TABLE payment_events (               -- eventos dos prestadores: chave única = idempotência
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL,
  received_at INTEGER NOT NULL, processed_at INTEGER, result TEXT, payload TEXT NOT NULL,
  UNIQUE (provider, event_id)
);

CREATE TABLE proofs (                       -- borderôs / comprovativos de transferência (ficheiros privados)
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, storage_name TEXT NOT NULL,
  declared_cents INTEGER, declared_currency TEXT, transfer_date TEXT, transfer_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('submitted','needs_info','rejected','accepted','superseded')),
  reason TEXT, reviewed_by TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX proofs_order ON proofs(order_id);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  method TEXT NOT NULL,
  provider TEXT, provider_sub_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','past_due','cancelled','expired')),
  auto_renew INTEGER NOT NULL DEFAULT 1,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  current_period_start INTEGER, current_period_end INTEGER,
  reminder_for INTEGER,                    -- fim de período para o qual já foi enviado o aviso
  cancelled_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX subscriptions_provider ON subscriptions(provider, provider_sub_id) WHERE provider_sub_id IS NOT NULL;

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('perpetual','subscription','demo','gift')),
  order_id TEXT UNIQUE REFERENCES orders(id),   -- uma encomenda nunca gera duas licenças
  subscription_id TEXT UNIQUE REFERENCES subscriptions(id),
  major INTEGER NOT NULL,                  -- versões autorizadas: série major.x
  issued_at INTEGER NOT NULL, expires_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active','suspended','revoked','expired')),
  status_reason TEXT, note TEXT, created_by TEXT
);
CREATE INDEX licenses_user ON licenses(user_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  machine_hash TEXT NOT NULL,
  name TEXT, platform TEXT, app_version TEXT,
  activated_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  deactivated_at INTEGER, deactivated_by TEXT, deactivation_reason TEXT
);
-- uma máquina ativa por licença, garantido pela base de dados
CREATE UNIQUE INDEX devices_one_active ON devices(license_id) WHERE deactivated_at IS NULL;
CREATE INDEX devices_license ON devices(license_id);

CREATE TABLE license_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, details TEXT
);
CREATE INDEX license_events_license ON license_events(license_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, actor_id TEXT, actor_email TEXT, action TEXT NOT NULL,
  target_type TEXT, target_id TEXT, reason TEXT, details TEXT, ip TEXT
);

CREATE TABLE emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL, template TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','test')),
  error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
);
