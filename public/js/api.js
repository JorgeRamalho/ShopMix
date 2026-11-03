(() => {
  const TOKEN_KEY = "shopmix.apiToken";
  const BASE_KEY = "shopmix.apiBase";
  const DB_KEY = "shopmix.db.v1";

  let base;
  let ready = false;
  let silence = false;
  let timer = 0;
  let pushChain = Promise.resolve();

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const candidates = () => {
    const list = [];
    const configured = String(window.SHOPMIX_API_BASE || "").replace(/\/$/, "");
    if (configured) list.push(configured);
    list.push("");
    list.push("http://127.0.0.1:4173");
    list.push("http://localhost:4173");
    return [...new Set(list)];
  };

  const probe = async (candidate) => {
    try {
      const response = await fetch(`${candidate}/api/health`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(1500),
      });
      const data = await response.json();
      return response.ok && data?.ok === true;
    } catch {
      return false;
    }
  };

  const resolveBase = async () => {
    if (typeof base === "string") return base;
    const configured = String(window.SHOPMIX_API_BASE || "").replace(/\/$/, "");
    if (configured) {
      if (await probe(configured)) {
        base = configured;
        sessionStorage.setItem(BASE_KEY, configured);
        return base;
      }
      base = configured;
      sessionStorage.setItem(BASE_KEY, configured);
      return base;
    }
    const ordered = [];
    const cached = sessionStorage.getItem(BASE_KEY);
    const sameOriginOk =
      cached === "same" ||
      (!cached && (location.port === "" || location.port === "4173"));
    if (sameOriginOk) ordered.push("");
    else if (cached && cached !== "off") ordered.push(cached);
    for (const candidate of candidates()) {
      if (!ordered.includes(candidate)) ordered.push(candidate);
    }
    for (const candidate of ordered) {
      if (await probe(candidate)) {
        base = candidate;
        sessionStorage.setItem(BASE_KEY, candidate || "same");
        return base;
      }
    }
    sessionStorage.removeItem(BASE_KEY);
    base = null;
    return null;
  };

  const getToken = () => localStorage.getItem(TOKEN_KEY) || "";

  const setToken = (token) => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  };

  const request = async (path, { method = "GET", body, keepalive = false, token } = {}) => {
    const authToken = token !== undefined ? token : getToken();
    const root = await resolveBase();
    if (root === null) {
      return {
        ok: false,
        error: "Servidor de dados indisponível. Deixe o ShopMix aberto com npm start em http://localhost:4173.",
      };
    }
    const headers = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        keepalive,
      });
    } catch {
      base = null;
      sessionStorage.removeItem(BASE_KEY);
      return {
        ok: false,
        error: "Servidor de dados indisponível. Deixe o ShopMix aberto com npm start em http://localhost:4173.",
      };
    }
    if (response.status === 204) return { ok: true, status: 204 };
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "Resposta inválida do servidor de dados.", status: response.status };
    }
    payload.status = response.status;
    return payload;
  };

  const emptyCatalog = {
    customerProfiles: [],
    sellerApplications: [],
    stores: [],
    products: [],
    orders: [],
    auditLog: [],
  };

  const mapUser = (user) => ({
    id: user.id,
    role: user.role || "customer",
    fullName: user.fullName,
    email: user.email,
    phone: user.phone || null,
    cpf: user.cpf || null,
    passwordHash: "server",
    termsAcceptedAt: user.termsAcceptedAt || null,
    legalConsents: user.legalConsents || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });

  const hasRows = (catalog) =>
    ["customerProfiles", "sellerApplications", "stores", "products", "orders"].some(
      (key) => Array.isArray(catalog?.[key]) && catalog[key].length > 0,
    );

  const applySnapshot = (data) => {
    const localDb = readJson(DB_KEY, null);
    const serverCatalog = data.catalog || emptyCatalog;
    const useServerCatalog = hasRows(serverCatalog);
    const catalog = useServerCatalog ? serverCatalog : {
      customerProfiles: localDb?.customerProfiles || [],
      sellerApplications: localDb?.sellerApplications || [],
      stores: localDb?.stores || [],
      products: localDb?.products || [],
      orders: localDb?.orders || [],
      auditLog: localDb?.auditLog || [],
    };
    const browser = data.browser || {};
    const chooseList = (serverList, key) => {
      const local = readJson(key, []);
      const server = Array.isArray(serverList) ? serverList : [];
      return { value: server.length ? server : local, keptLocal: !server.length && local.length > 0 };
    };
    const cart = chooseList(browser.cart, "shopmix.cart");
    const wish = chooseList(browser.wish, "shopmix.wish");
    const recent = chooseList(browser.recent, "shopmix.recent");
    const compare = chooseList(browser.compare, "shopmix.compare");
    const orders = chooseList(browser.orders, "shopmix.orders");
    const localCep = readJson("shopmix.cep", "");
    const cep = browser.cep || localCep || "";
    const consent = browser.consent || readJson("shopmix.consent", null);
    const users = data.user
      ? [mapUser(data.user)]
      : (localDb?.users || []).map((user) => ({ ...user, passwordHash: "server" }));

    localStorage.setItem(DB_KEY, JSON.stringify({
      version: 1,
      users,
      customerProfiles: catalog.customerProfiles || [],
      sellerApplications: catalog.sellerApplications || [],
      stores: catalog.stores || [],
      products: catalog.products || [],
      orders: catalog.orders || [],
      auditLog: catalog.auditLog || [],
    }));
    localStorage.setItem("shopmix.cart", JSON.stringify(cart.value));
    localStorage.setItem("shopmix.wish", JSON.stringify(wish.value));
    localStorage.setItem("shopmix.recent", JSON.stringify(recent.value));
    localStorage.setItem("shopmix.compare", JSON.stringify(compare.value));
    localStorage.setItem("shopmix.orders", JSON.stringify(orders.value));
    if (cep) localStorage.setItem("shopmix.cep", JSON.stringify(cep));
    if (consent) localStorage.setItem("shopmix.consent", JSON.stringify(consent));
    if (data.user) {
      localStorage.setItem("shopmix.session", JSON.stringify({ userId: data.user.id, at: new Date().toISOString() }));
      localStorage.setItem("shopmix.user", JSON.stringify({
        id: data.user.id,
        name: data.user.fullName,
        email: data.user.email,
        role: data.user.role,
      }));
    } else {
      localStorage.removeItem("shopmix.session");
      localStorage.removeItem("shopmix.user");
    }
    return !useServerCatalog && hasRows(localDb)
      || cart.keptLocal
      || wish.keptLocal
      || recent.keptLocal
      || compare.keptLocal
      || orders.keptLocal
      || (!browser.cep && Boolean(localCep));
  };

  const collect = () => {
    const db = readJson(DB_KEY, {});
    return {
      browser: {
        cart: readJson("shopmix.cart", []),
        wish: readJson("shopmix.wish", []),
        recent: readJson("shopmix.recent", []),
        compare: readJson("shopmix.compare", []),
        cep: readJson("shopmix.cep", ""),
        consent: readJson("shopmix.consent", null),
        orders: readJson("shopmix.orders", []),
      },
      catalog: {
        customerProfiles: db.customerProfiles || [],
        sellerApplications: db.sellerApplications || [],
        stores: db.stores || [],
        products: db.products || [],
        orders: db.orders || [],
        auditLog: (db.auditLog || []).slice(-100),
      },
    };
  };

  const flushPush = (keepalive = false) => {
    if (!ready || silence || !getToken()) return pushChain;
    window.clearTimeout(timer);
    timer = 0;
    const body = collect();
    pushChain = pushChain
      .catch(() => {})
      .then(() => request("/api/workspace", { method: "PUT", body, keepalive }));
    return pushChain;
  };

  const schedulePush = () => {
    if (!ready || silence || !getToken()) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => flushPush(false), 250);
  };

  const pull = async () => {
    silence = true;
    try {
      const data = await request("/api/workspace");
      if (!data?.ok) return false;
      applySnapshot(data);
      return true;
    } finally {
      silence = false;
    }
  };

  const hydrate = async () => {
    silence = true;
    try {
      const root = await resolveBase();
      if (root === null) return false;
      if (!getToken()) {
        const opened = await request("/api/session", { method: "POST", body: {} });
        if (!opened?.token) return false;
        setToken(opened.token);
      }
      let data = await request("/api/workspace");
      if (data?.status === 401) {
        setToken("");
        const opened = await request("/api/session", { method: "POST", body: {} });
        if (!opened?.token) return false;
        setToken(opened.token);
        data = await request("/api/workspace");
      }
      if (!data?.ok) return false;
      const shouldUpload = applySnapshot(data);
      ready = true;
      silence = false;
      if (shouldUpload) schedulePush();
      return true;
    } finally {
      silence = false;
      if (base !== null && base !== undefined) ready = true;
    }
  };

  window.addEventListener("pagehide", () => {
    if (timer) flushPush(true);
  });

  window.SHOPMIX_API = {
    request,
    getToken,
    setToken,
    hydrate,
    pull,
    flush: () => flushPush(false),
    schedulePush,
  };
})();
