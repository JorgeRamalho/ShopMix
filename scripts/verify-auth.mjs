/**
 * Verifica o banco de contas: hash, cadastro, login, sessão e rotas HTTP.
 * Uso: node scripts/verify-auth.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "shopmix-auth-"));
process.env.SHOPMIX_DB_PATH = join(dir, "auth.sqlite");

const password = "SenhaTeste@123";
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
const assert = (name, cond) => {
  tests.push({ name, ok: Boolean(cond) });
};

const { hashPassword, verifyPassword } = await import("../server/password.mjs");
const db = await import("../server/db.mjs");
const { startServer } = await import("../server/index.mjs");

const stored = hashPassword(password);
assert("hash scrypt não guarda a senha", !stored.includes(password) && stored.startsWith("scrypt$"));
assert("hash aceita a senha correta", verifyPassword(stored, password));
assert("hash rejeita senha errada", !verifyPassword(stored, "outra-senha"));

const created = db.registerCustomer({
  fullName: "Cliente Teste",
  email: "Cliente@Teste.dev",
  password,
  phone: "11999999999",
  cpf: "12345678901",
  wantsSeller: false,
  consents,
});
assert("cadastro grava a conta", created.ok && created.user.email === "cliente@teste.dev");
const row = db.getDb().prepare("SELECT password_hash FROM profiles WHERE email = ?").get("cliente@teste.dev");
assert("banco guarda hash e não a senha", row.password_hash.startsWith("scrypt$") && !row.password_hash.includes(password));
assert("e-mail repetido não troca a senha", !db.registerCustomer({
  fullName: "Outra Pessoa",
  email: "cliente@teste.dev",
  password: "OutraSenha@123",
  consents,
}).ok);
assert("login com senha errada falha", !db.login("cliente@teste.dev", "senha-errada").ok);
assert("e-mail desconhecido usa o mesmo erro", db.login("nao-existe@teste.dev", password).error === db.login("cliente@teste.dev", "x").error);
const signed = db.login("cliente@teste.dev", password);
assert("login com senha certa abre sessão", signed.ok && signed.user.id === created.user.id);
assert("sessão reconhece o token", db.sessionUser(signed.token)?.email === "cliente@teste.dev");
db.logout(signed.token);
assert("logout encerra a sessão", db.sessionUser(signed.token) === null);
assert("cadastro sem termos falha", !db.registerCustomer({
  fullName: "Sem Termos",
  email: "sem-termos@teste.dev",
  password,
  consents: { termsOfUse: true },
}).ok);

const server = await startServer({ port: 0, host: "127.0.0.1" });
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

const registerResponse = await fetch(`${base}/api/auth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fullName: "Conta Http",
    email: "http@teste.dev",
    password,
    consents,
  }),
});
const setCookie = registerResponse.headers.getSetCookie?.()[0] || registerResponse.headers.get("set-cookie") || "";
const registerBody = await registerResponse.json();
assert("HTTP cadastro responde 201", registerResponse.status === 201 && registerBody.ok);
assert("HTTP cadastro envia cookie de sessão", setCookie.includes("shopmix_session=") && setCookie.includes("HttpOnly"));

const cookie = setCookie.split(";")[0];
const meResponse = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
const meBody = await meResponse.json();
assert("HTTP sessão lê a conta", meResponse.status === 200 && meBody.user.email === "http@teste.dev");

const badLogin = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "http@teste.dev", password: "errada-123" }),
});
const badBody = await badLogin.json();
assert("HTTP senha errada responde 401", badLogin.status === 401 && badBody.error === "E-mail ou senha não conferem.");

const traversal = await fetch(`${base}/%2e%2e/package.json`);
const traversalText = await traversal.text();
assert("arquivo fora de public não é servido", !traversalText.includes('"name": "shopmix"'));

const page = await fetch(`${base}/pages/conta.html`);
assert("página de login é servida", page.status === 200 && (await page.text()).includes("Criar conta"));

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
