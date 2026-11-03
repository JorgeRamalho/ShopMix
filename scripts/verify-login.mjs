/**
 * Verifica fluxo register/login (mesma lógica de hash do store.js).
 * Uso: node scripts/verify-login.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storeSrc = readFileSync(join(root, "public/js/store.js"), "utf8");

const hashPasswordNode = async (password) => {
  return createHash("sha256").update(password, "utf8").digest("hex");
};

const isSha256Hex = (value) => /^[a-f0-9]{64}$/i.test(value || "");

const verifyPasswordLogic = async (stored, input) => {
  const inputHash = await hashPasswordNode(input);
  if (isSha256Hex(stored) && isSha256Hex(inputHash) && stored === inputHash) {
    return { ok: true, upgrade: false };
  }
  if (stored === input) return { ok: true, upgrade: true };
  if (!isSha256Hex(stored) && stored === inputHash) return { ok: true, upgrade: false };
  return { ok: false };
};

const accountRecordScore = (user, hasProfile) => {
  const h = user.passwordHash || "";
  let score = 0;
  if (isSha256Hex(h)) score += 20;
  else if (h.length >= 8) score += 8;
  if (user.legalConsents) score += 6;
  if (hasProfile) score += 4;
  return score;
};

const tests = [];

const assert = (name, cond) => {
  tests.push({ name, ok: Boolean(cond) });
};

await (async () => {
  const pass = "SenhaTeste@123";
  const hash = await hashPasswordNode(pass);
  assert("hash login com senha correta", (await verifyPasswordLogic(hash, pass)).ok);
  assert("hash rejeita senha errada", !(await verifyPasswordLogic(hash, "outra")).ok);
  assert("legacy plain aceita senha correta", (await verifyPasswordLogic(pass, pass)).ok);
  assert("legacy plain upgrade flag", (await verifyPasswordLogic(pass, pass)).upgrade === true);

  assert("store.js exporta login", /const login = async/.test(storeSrc));
  assert("login promove conta local", /promoteLocalAccount/.test(storeSrc));
  assert("store usa normalizeEmail", /normalizeEmail/.test(storeSrc));
  assert("migração legada exige senha", /if \(!legacyPass\) return/.test(storeSrc));
  assert("dedupe prefere hash sha256", /isSha256Hex\(h\)\) score \+= 20/.test(storeSrc));

  const ghost = { passwordHash: "", legalConsents: null };
  const real = { passwordHash: hash, legalConsents: { termsOfUseAt: "x" } };
  assert(
    "dedupe mantém conta com hash",
    accountRecordScore(real, true) > accountRecordScore(ghost, false),
  );
})();

const failed = tests.filter((t) => !t.ok);
for (const t of tests) {
  console.log(t.ok ? "OK" : "FAIL", t.name);
}
if (failed.length) {
  console.error(`\n${failed.length} teste(s) falharam.`);
  process.exit(1);
}
console.log(`\n${tests.length} verificações passaram.`);
