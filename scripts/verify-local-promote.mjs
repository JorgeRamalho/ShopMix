/**
 * Simula conta só no navegador (hash sha256) e confirma cadastro no servidor no login.
 * Uso: node scripts/verify-local-promote.mjs
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "shopmix-promote-"));
process.env.SHOPMIX_DB_PATH = join(dir, "promote.sqlite");

const password = "SenhaPromote@123";
const email = "promote@teste.dev";
const hash = createHash("sha256").update(password, "utf8").digest("hex");
const consents = {
  termsOfUse: true,
  privacyPolicy: true,
  identityProtection: true,
  dataProcessing: true,
  consumerRights: true,
  cookiePolicy: true,
  judicialTerms: true,
  identityTruthfulness: true,
  marketing: false,
};

const tests = [];
const assert = (name, cond) => tests.push({ name, ok: Boolean(cond) });

const { startServer } = await import("../server/index.mjs");
const db = await import("../server/db.mjs");
const server = await startServer({ port: 0, host: "127.0.0.1" });
const base = `http://127.0.0.1:${server.address().port}`;

const loginFail = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const loginBody = await loginFail.json();
assert("servidor vazio rejeita login", loginFail.status === 401 && loginBody.error === "E-mail ou senha não conferem.");

const register = await fetch(`${base}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fullName: "Cliente Promovido",
    email,
    password,
    consents,
  }),
});
const registerBody = await register.json();
assert("promoção grava a conta", register.status === 201 && registerBody.ok);

const row = db.getDb().prepare("SELECT email, password_hash FROM profiles WHERE email = ?").get(email);
assert("banco guarda scrypt", row?.password_hash?.startsWith("scrypt$"));
assert("hash não guarda senha em texto", !row?.password_hash?.includes(password));

const loginOk = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const loginOkBody = await loginOk.json();
assert("depois da promoção o login funciona", loginOk.status === 200 && loginOkBody.ok);

await new Promise((resolve) => server.close(resolve));
db.closeDb();
rmSync(dir, { recursive: true, force: true });

const failed = tests.filter((item) => !item.ok);
for (const item of tests) console.log(item.ok ? "OK" : "FAIL", item.name);
if (failed.length) {
  console.error(`\n${failed.length} teste(s) falharam.`);
  process.exit(1);
}
console.log(`\n${tests.length} verificações passaram.`);
