import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { login, logout, purgeAccounts, registerCustomer } from "./db.mjs";
import {
  bindUserToken,
  mergeGuestIntoUser,
  openGuest,
  readWorkspace,
  resolveToken,
  revokeToken,
  writeWorkspace,
} from "./workspace.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = resolve(rootDir, "public");
const COOKIE = "shopmix_session";
const BODY_LIMIT = 1_572_864;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 30;

const REDIRECTS = new Map([
  ["/catalogo", "/pages/catalogo.html"],
  ["/catalogo.html", "/pages/catalogo.html"],
  ["/conta", "/pages/conta.html"],
  ["/conta.html", "/pages/conta.html"],
  ["/painel", "/pages/painel.html"],
  ["/painel.html", "/pages/painel.html"],
  ["/vender", "/pages/vender.html"],
  ["/vender.html", "/pages/vender.html"],
  ["/conscientizacao", "/pages/conscientizacao.html"],
  ["/conscientizacao.html", "/pages/conscientizacao.html"],
  ["/termos", "/pages/termos.html"],
  ["/termos.html", "/pages/termos.html"],
  ["/carrinho", "/pages/carrinho.html"],
  ["/carrinho.html", "/pages/carrinho.html"],
  ["/produto", "/pages/produto.html"],
  ["/produto.html", "/pages/produto.html"],
  ["/checkout", "/pages/checkout.html"],
  ["/checkout.html", "/pages/checkout.html"],
]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
};

const attempts = new Map();

const clientIp = (req) => {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "local";
};

const tooManyAttempts = (req) => {
  const now = Date.now();
  const ip = clientIp(req);
  const bucket = attempts.get(ip) || [];
  const recent = bucket.filter((at) => now - at < WINDOW_MS);
  attempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS;
};

const noteAttempt = (req) => {
  const ip = clientIp(req);
  const bucket = attempts.get(ip) || [];
  bucket.push(Date.now());
  attempts.set(ip, bucket);
};

const readCookie = (req, name) => {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return "";
};

const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;

const corsHeaders = (req) => {
  const origin = req?.headers?.origin;
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
};

const sendJson = (req, res, status, body, cookie) => {
  const headers = {
    ...corsHeaders(req),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (cookie) headers["Set-Cookie"] = cookie;
  res.writeHead(status, headers);
  if (status === 204) {
    res.end();
    return;
  }
  res.end(JSON.stringify(body ?? {}));
};

const readJson = (req) =>
  new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error("payload"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!size) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(Object.assign(new Error("json"), { status: 400 }));
          return;
        }
        resolveBody(parsed);
      } catch {
        reject(Object.assign(new Error("json"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });

const isLoopback = (req) => {
  const host = String(req.headers.host || "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
};

const safeFile = (pathname) => {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const filePath = resolve(publicDir, `.${decoded}`);
  const rel = relative(publicDir, filePath);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || rel.startsWith(sep)) return null;
  return filePath;
};

const contentType = (filePath) => MIME[extname(filePath).toLowerCase()] || "application/octet-stream";

const sendFile = (req, res, filePath) => {
  const headers = {
    "Content-Type": contentType(filePath),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": extname(filePath).toLowerCase() === ".html" ? "no-cache" : "public, max-age=3600",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
};

const resolveStatic = (pathname) => {
  const candidates = [];
  const direct = safeFile(pathname);
  if (!direct) return { error: 403 };
  candidates.push(direct);
  if (!extname(pathname)) {
    const html = safeFile(pathname.endsWith("/") ? `${pathname}index.html` : `${pathname}.html`);
    if (html) candidates.push(html);
    const index = safeFile(pathname.endsWith("/") ? `${pathname}index.html` : `${pathname}/index.html`);
    if (index) candidates.push(index);
  }
  for (const filePath of candidates) {
    if (existsSync(filePath) && statSync(filePath).isFile()) return { filePath };
  }
  return { error: 404 };
};

const requestToken = (req) => {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return readCookie(req, COOKIE);
};

const handleAuth = async (req, res, url) => {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/session") {
    const existing = resolveToken(requestToken(req));
    if (existing) {
      sendJson(req, res, 200, { ok: true, token: existing.token, workspaceId: existing.workspaceId });
      return;
    }
    const opened = openGuest();
    sendJson(req, res, 201, opened, sessionCookie(opened.token, 14 * 24 * 60 * 60));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workspace") {
    const actor = resolveToken(requestToken(req));
    if (!actor) {
      sendJson(req, res, 401, { ok: false, error: "Sessão ausente." });
      return;
    }
    sendJson(req, res, 200, readWorkspace(actor));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/workspace") {
    const actor = resolveToken(requestToken(req));
    if (!actor) {
      sendJson(req, res, 401, { ok: false, error: "Sessão ausente." });
      return;
    }
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      const status = err.status || 400;
      sendJson(req, res, status, {
        ok: false,
        error: status === 413 ? "Dados grandes demais." : "Envie o carrinho e a loja em JSON.",
      });
      return;
    }
    sendJson(req, res, 200, writeWorkspace(actor, body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const actor = resolveToken(requestToken(req));
    if (!actor?.user) {
      sendJson(req, res, 401, { ok: false, error: "Sessão ausente." });
      return;
    }
    sendJson(req, res, 200, { ok: true, user: actor.user });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = requestToken(req);
    logout(token);
    revokeToken(token);
    sendJson(req, res, 200, { ok: true }, sessionCookie("", 0));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/purge") {
    if (!isLoopback(req)) {
      sendJson(req, res, 403, { ok: false, error: "Limpeza de contas só está disponível em localhost." });
      return;
    }
    const result = purgeAccounts();
    sendJson(req, res, 200, result, sessionCookie("", 0));
    return;
  }

  if (req.method !== "POST" || (url.pathname !== "/api/auth/register" && url.pathname !== "/api/auth/login")) {
    sendJson(req, res, 404, { ok: false, error: "Rota de conta não encontrada." });
    return;
  }

  if (tooManyAttempts(req)) {
    sendJson(req, res, 429, { ok: false, error: "Muitas tentativas. Espere um pouco e tente de novo." });
    return;
  }

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    const status = err.status || 400;
    const error = status === 413 ? "Dados do formulário grandes demais." : "Envie os dados da conta em JSON.";
    sendJson(req, res, status, { ok: false, error });
    return;
  }

  const actor = resolveToken(requestToken(req));
  const result = url.pathname === "/api/auth/register" ? registerCustomer(body) : login(body.email, body.password);
  if (result.ok) {
    if (actor?.workspaceId && !actor.userId) mergeGuestIntoUser(actor.workspaceId, result.user.id);
    bindUserToken(result.token, result.user.id);
  }
  if (!result.ok && result.status === 401) noteAttempt(req);
  const cookie = result.ok ? sessionCookie(result.token, 14 * 24 * 60 * 60) : undefined;
  const payload = result.ok
    ? { ok: true, user: result.user, token: result.token }
    : { ok: false, error: result.error };
  sendJson(req, res, result.status, payload, cookie);
};

const handleRequest = async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, null);
      return;
    }
    try {
      await handleAuth(req, res, url);
    } catch (err) {
      console.error("auth.fail", err instanceof Error ? err.message : "erro");
      if (!res.headersSent) {
        sendJson(req, res, 500, { ok: false, error: "Não foi possível gravar os dados agora." });
      }
    }
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const destination = REDIRECTS.get(url.pathname);
  if (destination) {
    res.writeHead(301, { Location: `${destination}${url.search}` });
    res.end();
    return;
  }

  const found = resolveStatic(url.pathname === "/" ? "/index.html" : url.pathname);
  if (found.filePath) {
    sendFile(req, res, found.filePath);
    return;
  }
  res.writeHead(found.error || 404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(found.error === 403 ? "Caminho inválido." : "Página não encontrada.");
};

export const startServer = ({ port = 4173, host = "0.0.0.0" } = {}) => {
  const server = createServer((req, res) => {
    handleRequest(req, res);
  });
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolveListen(server);
    });
  });
};

const isDirectRun = () => {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry) === fileURLToPath(import.meta.url);
};

if (isDirectRun()) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "0.0.0.0";
  startServer({ port, host }).then((server) => {
    const address = server.address();
    const shownPort = typeof address === "object" && address ? address.port : port;
    console.log(`ShopMix em http://localhost:${shownPort}`);
    console.log("Contas em data/shopmix.sqlite");
  });
}
