/**
 * Verifica carrinho, favoritos, loja e o acesso de outro endereço (Live Server).
 * Uso: node scripts/verify-workspace.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "shopmix-workspace-"));
process.env.SHOPMIX_DB_PATH = join(dir, "workspace.sqlite");

const password = "SenhaWorkspace@123";
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

const db = await import("../server/db.mjs");
const { startServer } = await import("../server/index.mjs");
const server = await startServer({ port: 0, host: "127.0.0.1" });
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const origin = "http://127.0.0.1:5500";

const json = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { response, body };
};

const health = await json("/api/health", { headers: { Origin: origin } });
assert("saúde do servidor responde", health.response.status === 200 && health.body?.ok === true);
assert(
  "outro endereço recebe CORS",
  health.response.headers.get("access-control-allow-origin") === origin,
);

const preflight = await fetch(`${base}/api/workspace`, {
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "PUT" },
});
assert("preflight do Live Server responde", preflight.status === 204);
assert(
  "preflight libera o endereço de origem",
  preflight.headers.get("access-control-allow-origin") === origin,
);

const opened = await json("/api/session", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: "{}",
});
const guestToken = opened.body?.token;
assert("visitante recebe um token", opened.response.status === 201 && Boolean(guestToken));

const guestAuth = {
  Authorization: `Bearer ${guestToken}`,
  "Content-Type": "application/json",
  Origin: origin,
};
const saved = await json("/api/workspace", {
  method: "PUT",
  headers: guestAuth,
  body: JSON.stringify({
    browser: {
      cart: [{ id: "sku-1", qty: 2, color: "azul" }],
      wish: ["sku-9"],
      recent: ["sku-9", "sku-1"],
      compare: ["sku-1"],
      cep: "01310100",
    },
    catalog: {
      stores: [{ id: "loja-1", name: "Loja Azul", cnpj: "12345678000199", category: "Casa", status: "active" }],
      products: [{
        id: "sku-loja",
        storeId: "loja-1",
        title: "Caneca",
        brand: "Azul",
        category: "Casa",
        price: 29.9,
        stock: 4,
        description: "Caneca azul",
        image: "/assets/logo.svg",
        status: "published",
      }],
    },
  }),
});
assert("visitante grava o workspace", saved.response.status === 200 && saved.body?.ok === true);
const cartRow = db.getDb().prepare("SELECT qty, color FROM cart_items WHERE product_id = ?").get("sku-1");
assert("carrinho fica no SQLite", cartRow?.qty === 2 && cartRow.color === "azul");
const wishRow = db.getDb().prepare("SELECT product_id FROM wish_items WHERE product_id = ?").get("sku-9");
assert("favorito fica no SQLite", wishRow?.product_id === "sku-9");

const loaded = await json("/api/workspace", { headers: { Authorization: `Bearer ${guestToken}` } });
const cart = loaded.body?.browser?.cart || [];
assert(
  "leitura devolve o carrinho",
  cart.some((item) => item.id === "sku-1" && item.qty === 2 && item.color === "azul"),
);
assert("leitura devolve o favorito", (loaded.body?.browser?.wish || []).includes("sku-9"));

const registered = await json("/api/auth/register", {
  method: "POST",
  headers: guestAuth,
  body: JSON.stringify({
    fullName: "Cliente Workspace",
    email: "workspace@teste.dev",
    password,
    consents,
  }),
});
const userToken = registered.body?.token;
assert("cadastro a partir do visitante responde 201", registered.response.status === 201 && Boolean(userToken));

const account = await json("/api/workspace", { headers: { Authorization: `Bearer ${userToken}` } });
const accountCart = account.body?.browser?.cart || [];
assert(
  "carrinho do visitante entra na conta",
  accountCart.some((item) => item.id === "sku-1" && item.qty === 2),
);
assert(
  "produto publicado da loja entra na conta",
  (account.body?.catalog?.products || []).some((product) => product.id === "sku-loja" && product.status === "published"),
);

const other = await json("/api/session", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
const otherView = await json("/api/workspace", {
  headers: { Authorization: `Bearer ${other.body?.token}` },
});
assert(
  "outro visitante vê o produto publicado",
  (otherView.body?.catalog?.products || []).some((product) => product.id === "sku-loja"),
);
assert(
  "outro visitante não recebe o carrinho da conta",
  !(otherView.body?.browser?.cart || []).some((item) => item.id === "sku-1"),
);

const again = await json("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${other.body?.token}` },
  body: JSON.stringify({
    fullName: "Outra Pessoa",
    email: "workspace@teste.dev",
    password: "OutraSenha@123",
    consents,
  }),
});
assert("e-mail repetido continua 409", again.response.status === 409 && again.body?.ok === false);

const guestCart = await json("/api/workspace", {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${other.body?.token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ browser: { cart: [{ id: "sku-2", qty: 1 }] } }),
});
assert("segundo visitante grava outro item", guestCart.response.status === 200);

const signed = await json("/api/auth/login", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${other.body?.token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email: "workspace@teste.dev", password }),
});
const merged = await json("/api/workspace", {
  headers: { Authorization: `Bearer ${signed.body?.token}` },
});
const mergedIds = (merged.body?.browser?.cart || []).map((item) => item.id);
assert("login junta os dois carrinhos", mergedIds.includes("sku-1") && mergedIds.includes("sku-2"));

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
