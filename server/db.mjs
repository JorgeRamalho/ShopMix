import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./password.mjs";

const CREDENTIALS_ERROR = "E-mail ou senha não conferem.";
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const REQUIRED_CONSENTS = [
  "termsOfUse",
  "privacyPolicy",
  "identityProtection",
  "dataProcessing",
  "consumerRights",
  "cookiePolicy",
  "judicialTerms",
  "identityTruthfulness",
];

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let database;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

const dummyHash = hashPassword(randomBytes(32).toString("base64url"));

const schemaSql = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'seller', 'admin')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  cpf TEXT,
  password_hash TEXT NOT NULL,
  terms_accepted_at TEXT,
  legal_consents TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  default_cep TEXT,
  default_address TEXT,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  wants_seller INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  cep TEXT,
  consent_json TEXT,
  legacy_orders_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  qty INTEGER NOT NULL,
  color TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wish_items (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, product_id)
);

CREATE TABLE IF NOT EXISTS list_items (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('recent', 'compare')),
  product_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, kind, position)
);

CREATE TABLE IF NOT EXISTS seller_applications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  store_name TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  category TEXT NOT NULL,
  about TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  fiscal_cep TEXT,
  legal_consents TEXT,
  status TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_user_id TEXT,
  application_id TEXT,
  name TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  official INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  old_price REAL,
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  image TEXT NOT NULL,
  condition TEXT NOT NULL,
  shipping TEXT NOT NULL,
  free_shipping INTEGER NOT NULL DEFAULT 0,
  deal INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  live INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 4.5,
  reviews INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '[]',
  gallery_json TEXT NOT NULL DEFAULT '[]',
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  order_number TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL,
  shipping_address_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT,
  title TEXT,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  extra_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_cart_workspace ON cart_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_workspace ON orders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_stores_workspace ON stores(workspace_id);
`;

export const databasePath = () =>
  process.env.SHOPMIX_DB_PATH || resolve(rootDir, "data", "shopmix.sqlite");

export const getDb = () => {
  if (database) return database;
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });
  database = new DatabaseSync(file);
  database.exec(schemaSql);
  return database;
};

export const closeDb = () => {
  if (!database) return;
  database.close();
  database = undefined;
};

const audit = (db, action, entity, entityId, userId, meta) => {
  db.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity, entity_id, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    userId,
    action,
    entity,
    entityId,
    meta ? JSON.stringify(meta) : null,
    new Date().toISOString(),
  );
};

const toPublicUser = (row) => {
  if (!row) return null;
  let legalConsents = null;
  if (row.legal_consents) {
    try {
      legalConsents = JSON.parse(row.legal_consents);
    } catch {
      legalConsents = null;
    }
  }
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    cpf: row.cpf,
    termsAcceptedAt: row.terms_accepted_at,
    legalConsents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    marketingOptIn: Boolean(row.marketing_opt_in),
    wantsSeller: Boolean(row.wants_seller),
  };
};

const loadPublicUser = (db, userId) =>
  toPublicUser(
    db
      .prepare(
        `SELECT p.id, p.role, p.full_name, p.email, p.phone, p.cpf,
                p.terms_accepted_at, p.legal_consents, p.created_at, p.updated_at,
                c.marketing_opt_in, c.wants_seller
         FROM profiles p
         LEFT JOIN customer_profiles c ON c.user_id = p.id
         WHERE p.id = ?`,
      )
      .get(userId),
  );

const createSession = (db, userId, now) => {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.parse(now) + SESSION_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, tokenHash(token), expiresAt, now);
  return { token, expiresAt };
};

const cleanCpf = (cpf) => {
  const digits = String(cpf || "").replace(/\D/g, "");
  return digits || null;
};

const validateRegistration = (input) => {
  const fullName = String(input?.fullName || "").trim();
  const email = normalizeEmail(input?.email);
  const password = String(input?.password || "");
  if (fullName.length < 2) return "Nome precisa ter ao menos 2 caracteres.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Informe um e-mail válido.";
  if (password.length < 8) return "Senha com no mínimo 8 caracteres.";
  if (password.length > 200) return "Senha longa demais.";
  const cpf = cleanCpf(input?.cpf);
  if (cpf && cpf.length !== 11) return "CPF deve ter 11 dígitos.";
  const phone = String(input?.phone || "").trim();
  if (phone.length > 40) return "Telefone longo demais.";
  const missing = REQUIRED_CONSENTS.filter((key) => !input?.consents?.[key]);
  if (missing.length) {
    return "Aceite todos os termos obrigatórios de privacidade, identidade e disposições judiciais.";
  }
  return null;
};

const consentRecord = (consents, now) => ({
  termsOfUseAt: now,
  privacyPolicyAt: now,
  identityProtectionAt: now,
  dataProcessingAt: now,
  consumerRightsAt: now,
  cookiePolicyAt: now,
  judicialTermsAt: now,
  identityTruthfulnessAt: now,
  marketingOptInAt: consents.marketing ? now : null,
  policyVersion: "2026-11-02",
});

export const registerCustomer = (input) => {
  const error = validateRegistration(input);
  if (error) return { ok: false, status: 400, error };

  const db = getDb();
  const mail = normalizeEmail(input.email);
  const existing = db.prepare("SELECT id FROM profiles WHERE email = ?").get(mail);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "Este e-mail já possui conta. Use Entrar com a senha cadastrada.",
    };
  }

  const now = new Date().toISOString();
  const userId = randomUUID();
  const cpf = cleanCpf(input.cpf);
  const phone = String(input.phone || "").trim() || null;
  const legalConsents = consentRecord(input.consents, now);
  const passwordHash = hashPassword(input.password);

  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO profiles (
         id, role, full_name, email, phone, cpf, password_hash,
         terms_accepted_at, legal_consents, created_at, updated_at
       ) VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      String(input.fullName).trim(),
      mail,
      phone,
      cpf,
      passwordHash,
      now,
      JSON.stringify(legalConsents),
      now,
      now,
    );
    db.prepare(
      `INSERT INTO customer_profiles (
         user_id, marketing_opt_in, wants_seller, created_at
       ) VALUES (?, ?, ?, ?)`,
    ).run(userId, input.consents.marketing ? 1 : 0, input.wantsSeller ? 1 : 0, now);
    audit(db, "customer.register", "profiles", userId, userId, null);
    const session = createSession(db, userId, now);
    db.exec("COMMIT");
    return {
      ok: true,
      status: 201,
      user: loadPublicUser(db, userId),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    if (String(err?.message || "").includes("UNIQUE")) {
      return {
        ok: false,
        status: 409,
        error: "Este e-mail já possui conta. Use Entrar com a senha cadastrada.",
      };
    }
    throw err;
  }
};

export const login = (email, password) => {
  const db = getDb();
  const mail = normalizeEmail(email);
  const row = mail
    ? db.prepare("SELECT id, password_hash FROM profiles WHERE email = ?").get(mail)
    : undefined;
  const matches = verifyPassword(row?.password_hash || dummyHash, password);
  if (!row || !matches) {
    return { ok: false, status: 401, error: CREDENTIALS_ERROR };
  }
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const session = createSession(db, row.id, now);
    audit(db, "auth.login", "profiles", row.id, row.id, null);
    db.exec("COMMIT");
    return {
      ok: true,
      status: 200,
      user: loadPublicUser(db, row.id),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};

export const sessionUser = (token) => {
  if (!token) return null;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  const session = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
    .get(tokenHash(token));
  if (!session || session.expires_at <= now) return null;
  return loadPublicUser(db, session.user_id);
};

export const logout = (token) => {
  if (!token) return;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
};

export const purgeAccounts = () => {
  const db = getDb();
  const removedUsers = Number(db.prepare("SELECT COUNT(*) AS n FROM profiles").get().n);
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM order_items");
    db.exec("DELETE FROM orders");
    db.exec("DELETE FROM products");
    db.exec("DELETE FROM stores");
    db.exec("DELETE FROM seller_applications");
    db.exec("DELETE FROM cart_items");
    db.exec("DELETE FROM wish_items");
    db.exec("DELETE FROM list_items");
    db.exec("DELETE FROM devices");
    db.exec("DELETE FROM workspaces");
    db.exec("DELETE FROM sessions");
    db.exec("DELETE FROM customer_profiles");
    db.exec("DELETE FROM audit_log");
    db.exec("DELETE FROM profiles");
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { ok: true, removedUsers };
};

export const credentialsError = CREDENTIALS_ERROR;
