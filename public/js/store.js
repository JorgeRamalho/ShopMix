(() => {
  const DB_KEY = "shopmix.db.v1";
  const SESSION_KEY = "shopmix.session";

  const defaultDb = () => ({
    version: 1,
    users: [],
    customerProfiles: [],
    sellerApplications: [],
    stores: [],
    products: [],
    orders: [],
    auditLog: [],
  });

  const readDb = () => {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return defaultDb();
      const parsed = JSON.parse(raw);
      return { ...defaultDb(), ...parsed };
    } catch {
      return defaultDb();
    }
  };

  const writeDb = (db) => {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    window.SHOPMIX_API?.schedulePush?.();
  };

  const uid = (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const slugify = (s) =>
    normalize(s)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "loja";

  const normalize = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const normalizeEmail = (email) => (email || "").trim().toLowerCase();

  const bytesToHex = (buf) =>
    [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const isSha256Hex = (value) => /^[a-f0-9]{64}$/i.test(value || "");

  const hashPassword = async (password) => {
    const data = new TextEncoder().encode(password);
    if (crypto?.subtle?.digest) {
      const buf = await crypto.subtle.digest("SHA-256", data);
      return bytesToHex(buf);
    }
    return password;
  };

  const verifyPassword = async (storedHash, password) => {
    if (!storedHash) return { ok: false, upgrade: false };
    const inputHash = await hashPassword(password);
    if (isSha256Hex(storedHash) && isSha256Hex(inputHash) && storedHash === inputHash) {
      return { ok: true, upgrade: false };
    }
    if (storedHash === password) return { ok: true, upgrade: true };
    if (!isSha256Hex(storedHash) && storedHash === inputHash) {
      return { ok: true, upgrade: false };
    }
    return { ok: false, upgrade: false };
  };

  const accountRecordScore = (db, user) => {
    const h = user.passwordHash || "";
    let score = 0;
    if (isSha256Hex(h)) score += 20;
    else if (h.length > 0) score += 1;
    if (user.legalConsents || user.termsAcceptedAt) score += 6;
    if (db.customerProfiles.some((p) => p.userId === user.id)) score += 4;
    const ts = Date.parse(user.updatedAt || user.createdAt || "") || 0;
    return score + ts / 1e15;
  };

  const findUserByEmail = (db, email) => {
    const mail = normalizeEmail(email);
    if (!mail) return null;
    return db.users.find((u) => normalizeEmail(u.email) === mail) || null;
  };

  const repairUserRecords = (db) => {
    let changed = false;
    const byEmail = new Map();
    const droppedIds = [];

    for (const user of db.users) {
      const mail = normalizeEmail(user.email);
      if (!mail) {
        droppedIds.push(user.id);
        changed = true;
        continue;
      }
      if (user.email !== mail) {
        user.email = mail;
        changed = true;
      }
      const prev = byEmail.get(mail);
      if (!prev) {
        byEmail.set(mail, user);
        continue;
      }
      const keep =
        accountRecordScore(db, prev) >= accountRecordScore(db, user) ? prev : user;
      const drop = keep.id === prev.id ? user : prev;
      droppedIds.push(drop.id);
      byEmail.set(mail, keep);
      changed = true;
    }

    if (byEmail.size !== db.users.length) changed = true;

    if (droppedIds.length) {
      const dropSet = new Set(droppedIds);
      const userById = new Map(db.users.map((u) => [u.id, u]));
      for (const droppedId of dropSet) {
        const dropped = userById.get(droppedId);
        if (!dropped) continue;
        const kept = byEmail.get(normalizeEmail(dropped.email));
        if (!kept || kept.id === droppedId) continue;
        for (const profile of db.customerProfiles) {
          if (profile.userId === droppedId) profile.userId = kept.id;
        }
      }
      db.users = [...byEmail.values()];
      changed = true;
    } else if (changed) {
      db.users = [...byEmail.values()];
    }

    if (changed) writeDb(db);
    return changed;
  };

  const log = (db, action, entity, entityId, userId, meta = {}) => {
    db.auditLog.push({
      id: uid("log"),
      action,
      entity,
      entityId,
      userId: userId || null,
      meta,
      at: new Date().toISOString(),
    });
    if (db.auditLog.length > 500) db.auditLog = db.auditLog.slice(-500);
  };

  const migrateLegacyUser = () => {
    try {
      const legacy = JSON.parse(localStorage.getItem("shopmix.user") || "null");
      if (!legacy?.email) return;
      const legacyPass = legacy.pass || legacy.password;
      if (!legacyPass) return;
      const db = readDb();
      const mail = normalizeEmail(legacy.email);
      if (findUserByEmail(db, mail)) return;
      db.users.push({
        id: uid("usr"),
        role: "customer",
        fullName: legacy.name || "Cliente Mix",
        email: mail,
        phone: null,
        cpf: null,
        passwordHash: legacyPass,
        termsAcceptedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      writeDb(db);
    } catch {
      /* ignore */
    }
  };

  migrateLegacyUser();
  repairUserRecords(readDb());

  const getSession = () => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
      return null;
    }
  };

  const setSession = (userId) => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ userId, at: new Date().toISOString() }),
    );
  };

  const clearSession = () => localStorage.removeItem(SESSION_KEY);

  const getUserById = (id) => readDb().users.find((u) => u.id === id) || null;

  const getPublicUser = (userId) => {
    const u = getUserById(userId);
    if (!u) return null;
    return { id: u.id, name: u.fullName, email: u.email, role: u.role };
  };

  const authRequest = async (path, body) => {
    if (!window.SHOPMIX_API?.request) {
      return {
        ok: false,
        error: "Servidor de contas indisponível. Deixe o npm start rodando em http://localhost:4173.",
      };
    }
    if (window.SHOPMIX_API.flush) await window.SHOPMIX_API.flush();
    const payload = await window.SHOPMIX_API.request(path, { method: "POST", body });
    if (payload?.token) window.SHOPMIX_API.setToken(payload.token);
    if (payload?.ok && window.SHOPMIX_API.pull) await window.SHOPMIX_API.pull();
    if (!payload || typeof payload.ok !== "boolean") {
      return { ok: false, error: payload?.error || "Resposta inválida do servidor de contas." };
    }
    return payload;
  };

  const requiredConsentFlags = () => ({
    termsOfUse: true,
    privacyPolicy: true,
    identityProtection: true,
    dataProcessing: true,
    consumerRights: true,
    cookiePolicy: true,
    judicialTerms: true,
    identityTruthfulness: true,
    marketing: false,
  });

  const consentsFromLocalUser = (user) => {
    if (!user) return null;
    return {
      ...requiredConsentFlags(),
      marketing: Boolean(user.marketingOptIn || user.legalConsents?.marketing),
    };
  };

  const promoteLocalAccount = async (email, password) => {
    migrateLegacyUser();
    const db = readDb();
    repairUserRecords(db);
    const local = findUserByEmail(db, email);
    if (!local) return null;
    if (local.passwordHash === "server") {
      return authRequest("/api/auth/register", {
        fullName: local.fullName || "Cliente Mix",
        email,
        password,
        phone: local.phone || null,
        cpf: local.cpf || null,
        wantsSeller: Boolean(local.wantsSeller),
        consents: consentsFromLocalUser(local),
      });
    }
    const verified = await verifyPassword(local.passwordHash, password);
    if (!verified.ok) return null;
    const consents = consentsFromLocalUser(local);
    if (!consents) return null;
    return authRequest("/api/auth/register", {
      fullName: local.fullName || "Cliente Mix",
      email,
      password,
      phone: local.phone || null,
      cpf: local.cpf || null,
      wantsSeller: Boolean(local.wantsSeller),
      consents,
    });
  };

  const adoptServerUser = (user) => {
    if (!user?.id || !user.email) return null;
    const db = readDb();
    repairUserRecords(db);
    const mail = normalizeEmail(user.email);
    const now = new Date().toISOString();
    let record = findUserByEmail(db, mail);
    if (record && record.id !== user.id) {
      const previousId = record.id;
      const reassign = (value) => (value === previousId ? user.id : value);
      record.id = user.id;
      for (const profile of db.customerProfiles) profile.userId = reassign(profile.userId);
      for (const app of db.sellerApplications) app.userId = reassign(app.userId);
      for (const store of db.stores) store.ownerUserId = reassign(store.ownerUserId);
      for (const order of db.orders) order.userId = reassign(order.userId);
      for (const entry of db.auditLog) entry.userId = reassign(entry.userId);
    }
    if (!record) {
      record = {
        id: user.id,
        role: user.role || "customer",
        fullName: user.fullName,
        email: mail,
        phone: user.phone || null,
        cpf: user.cpf || null,
        passwordHash: "server",
        termsAcceptedAt: user.termsAcceptedAt || now,
        legalConsents: user.legalConsents || null,
        createdAt: user.createdAt || now,
        updatedAt: user.updatedAt || now,
      };
      db.users.push(record);
    } else {
      record.role = user.role || record.role;
      record.fullName = user.fullName || record.fullName;
      record.email = mail;
      record.phone = user.phone ?? record.phone;
      record.cpf = user.cpf ?? record.cpf;
      record.passwordHash = "server";
      record.termsAcceptedAt = user.termsAcceptedAt || record.termsAcceptedAt;
      if (user.legalConsents) record.legalConsents = user.legalConsents;
      record.updatedAt = user.updatedAt || now;
    }

    let profile = db.customerProfiles.find((item) => item.userId === user.id);
    if (!profile) {
      db.customerProfiles.push({
        userId: user.id,
        defaultCep: null,
        defaultAddress: null,
        marketingOptIn: Boolean(user.marketingOptIn),
        wantsSeller: Boolean(user.wantsSeller),
        wantsSellerAt: user.wantsSeller ? now : null,
        createdAt: now,
      });
    } else {
      profile.marketingOptIn = Boolean(user.marketingOptIn);
      profile.wantsSeller = Boolean(user.wantsSeller);
      if (user.wantsSeller) profile.wantsSellerAt = profile.wantsSellerAt || now;
    }

    writeDb(db);
    setSession(user.id);
    return user.id;
  };

  const registerCustomer = async ({
    fullName,
    email,
    password,
    phone,
    cpf,
    wantsSeller,
    consents,
  }) => {
    const requiredConsents = [
      "termsOfUse",
      "privacyPolicy",
      "identityProtection",
      "dataProcessing",
      "consumerRights",
      "cookiePolicy",
      "judicialTerms",
      "identityTruthfulness",
    ];
    const missing = requiredConsents.filter((key) => !consents?.[key]);
    if (missing.length) {
      return {
        ok: false,
        error: "Aceite todos os termos obrigatórios de privacidade, identidade e disposições judiciais.",
      };
    }

    const result = await authRequest("/api/auth/register", {
      fullName,
      email,
      password,
      phone,
      cpf,
      wantsSeller,
      consents,
    });
    if (!result.ok) return { ok: false, error: result.error || "Não foi possível criar a conta." };
    const userId = adoptServerUser(result.user);
    if (!userId) return { ok: false, error: "Conta criada, mas a sessão local não foi gravada." };
    return { ok: true, userId };
  };

  const createServerAccountOnLogin = async (email, password) => {
    if (!window.SHOPMIX_LOGIN_CREATES_ACCOUNT) return null;
    const mail = normalizeEmail(email);
    const nameFromMail = mail.split("@")[0]?.replace(/[._-]+/g, " ").trim();
    const fullName =
      nameFromMail && nameFromMail.length >= 2
        ? nameFromMail.replace(/\b\w/g, (c) => c.toUpperCase())
        : "Cliente Mix";
    return authRequest("/api/auth/register", {
      fullName,
      email,
      password,
      consents: requiredConsentFlags(),
    });
  };

  const login = async (email, password) => {
    const mail = normalizeEmail(email);
    if (!mail || !mail.includes("@")) {
      return { ok: false, error: "Informe um e-mail válido." };
    }
    if (!password || password.length < 8) {
      return { ok: false, error: "Senha com no mínimo 8 caracteres." };
    }
    let result = await authRequest("/api/auth/login", { email: mail, password });
    if (!result.ok && result.status === 401) {
      const promoted = await promoteLocalAccount(mail, password);
      if (promoted?.ok) {
        result = promoted;
      } else if (promoted && !promoted.ok) {
        result = promoted;
      } else {
        const created = await createServerAccountOnLogin(mail, password);
        if (created?.ok) result = created;
        else if (created && !created.ok) {
          result =
            created.status === 409
              ? { ok: false, error: created.error || "E-mail ou senha não conferem." }
              : created;
        }
      }
    }
    if (!result.ok) return { ok: false, error: result.error || "E-mail ou senha não conferem." };
    const userId = adoptServerUser(result.user);
    if (!userId) return { ok: false, error: "E-mail ou senha não conferem." };
    return { ok: true, userId };
  };

  const logout = () => {
    const token = window.SHOPMIX_API?.getToken?.() || "";
    clearSession();
    const send = window.SHOPMIX_API?.request
      ? window.SHOPMIX_API.request("/api/auth/logout", { method: "POST", body: {}, token })
      : fetch("/api/auth/logout", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
    window.SHOPMIX_API?.setToken?.("");
    Promise.resolve(send).catch(() => {});
  };

  const submitSellerApplication = async (payload, userId) => {
    const db = readDb();
    const cnpj = payload.cnpj.replace(/\D/g, "");
    if (cnpj.length !== 14) {
      return { ok: false, error: "CNPJ deve ter 14 dígitos." };
    }
    const sellerRequired = [
      "termsOfUse",
      "privacyPolicy",
      "identityTruthfulness",
      "consumerRights",
      "judicialTerms",
    ];
    const missingSeller = sellerRequired.filter((key) => !payload.legalConsents?.[key]);
    if (missingSeller.length) {
      return {
        ok: false,
        error: "Aceite todos os termos legais do cadastro de vendedor.",
      };
    }
    const now = new Date().toISOString();
    const applicationId = uid("app");
    db.sellerApplications.push({
      id: applicationId,
      userId: userId || null,
      storeName: payload.storeName.trim(),
      cnpj,
      category: payload.category,
      about: payload.about.trim(),
      contactEmail: payload.contactEmail?.trim() || null,
      contactPhone: payload.contactPhone?.trim() || null,
      fiscalCep: payload.fiscalCep?.replace(/\D/g, "") || null,
      legalConsents: {
        termsOfUseAt: now,
        privacyPolicyAt: now,
        identityTruthfulnessAt: now,
        consumerRightsAt: now,
        judicialTermsAt: now,
        policyVersion: "2026-11-02",
      },
      status: "approved",
      submittedAt: now,
      reviewedAt: now,
    });

    let storeId = slugify(payload.storeName);
    if (db.stores.some((s) => s.id === storeId)) {
      storeId = `${storeId}-${Math.random().toString(36).slice(2, 6)}`;
    }

    db.stores.push({
      id: storeId,
      ownerUserId: userId || null,
      applicationId,
      name: payload.storeName.trim(),
      cnpj,
      category: payload.category,
      description: payload.about.trim(),
      official: false,
      status: "active",
      createdAt: now,
    });

    if (userId) {
      const user = db.users.find((u) => u.id === userId);
      if (user) {
        user.role = "seller";
        user.updatedAt = now;
      }
    }

    log(db, "seller.application.approved", "stores", storeId, userId, { applicationId });
    writeDb(db);
    return { ok: true, storeId, applicationId };
  };

  const getStoreForUser = (userId) => {
    const db = readDb();
    return db.stores.find((s) => s.ownerUserId === userId && s.status === "active") || null;
  };

  const listStoreProducts = (storeId) =>
    readDb().products.filter((p) => p.storeId === storeId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const mapProductToCatalog = (p) => ({
    id: p.id,
    title: p.title,
    brand: p.brand,
    storeId: p.storeId,
    category: p.category,
    price: p.price,
    oldPrice: p.oldPrice || null,
    rating: p.rating ?? 4.5,
    reviews: p.reviews ?? 0,
    sold: p.sold ?? 0,
    shipping: p.shipping || "rapido",
    freeShipping: Boolean(p.freeShipping),
    condition: p.condition || "novo",
    colors: p.colors || [],
    sizes: p.sizes || [],
    tags: p.tags || [],
    image: p.image,
    gallery: p.gallery?.length ? p.gallery : [p.image],
    stock: p.stock,
    featured: Boolean(p.featured),
    deal: Boolean(p.deal),
    live: Boolean(p.live),
    description: p.description,
    sellerProduct: true,
  });

  const listPublishedProducts = () =>
    readDb()
      .products.filter((p) => p.status === "published")
      .map(mapProductToCatalog);

  const upsertProduct = (storeId, payload, productId = null) => {
    const db = readDb();
    const now = new Date().toISOString();
    const base = {
      title: payload.title.trim(),
      brand: payload.brand.trim(),
      category: payload.category,
      price: Number(payload.price),
      oldPrice: payload.oldPrice ? Number(payload.oldPrice) : null,
      stock: Number(payload.stock),
      description: payload.description.trim(),
      image: payload.image.trim(),
      gallery: [payload.image.trim()],
      condition: payload.condition || "novo",
      shipping: payload.shipping || "rapido",
      freeShipping: Boolean(payload.freeShipping),
      deal: Boolean(payload.deal),
      featured: Boolean(payload.featured),
      live: Boolean(payload.live),
      tags: payload.tags
        ? payload.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      status: payload.status || "published",
      updatedAt: now,
    };

    if (productId) {
      const idx = db.products.findIndex((p) => p.id === productId && p.storeId === storeId);
      if (idx === -1) return { ok: false, error: "Produto não encontrado." };
      db.products[idx] = { ...db.products[idx], ...base };
      log(db, "product.update", "products", productId, getSession()?.userId);
      writeDb(db);
      return { ok: true, productId };
    }

    const id = uid("mx");
    db.products.push({
      id,
      storeId,
      ...base,
      rating: 4.5,
      reviews: 0,
      sold: 0,
      createdAt: now,
    });
    log(db, "product.create", "products", id, getSession()?.userId);
    writeDb(db);
    return { ok: true, productId: id };
  };

  const deleteProduct = (storeId, productId) => {
    const db = readDb();
    const before = db.products.length;
    db.products = db.products.filter((p) => !(p.id === productId && p.storeId === storeId));
    if (db.products.length === before) return { ok: false, error: "Produto não encontrado." };
    log(db, "product.delete", "products", productId, getSession()?.userId);
    writeDb(db);
    return { ok: true };
  };

  const saveOrder = (order) => {
    const db = readDb();
    const session = getSession();
    const id = order.id || uid("ord");
    db.orders.push({
      id,
      userId: session?.userId || null,
      orderNumber: order.orderNumber || id,
      total: order.total,
      items: order.items || [],
      shippingAddress: order.shippingAddress || null,
      status: "paid",
      createdAt: new Date().toISOString(),
    });
    log(db, "order.create", "orders", id, session?.userId);
    writeDb(db);
    return id;
  };

  const listOrdersForUser = (userId) =>
    readDb()
      .orders.filter((o) => o.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const getCustomerProfile = (userId) =>
    readDb().customerProfiles.find((p) => p.userId === userId) || null;

  const getAccountDashboard = (userId) => {
    const u = getUserById(userId);
    if (!u) return null;
    const profile = getCustomerProfile(userId);
    const orders = listOrdersForUser(userId);
    const store = getStoreForUser(userId);
    const products = store ? listStoreProducts(store.id) : [];
    return {
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      cpf: u.cpf,
      role: u.role,
      memberSince: u.createdAt,
      wantsSeller: Boolean(profile?.wantsSeller),
      ordersCount: orders.length,
      ordersTotal: orders.reduce((sum, o) => sum + (o.total || 0), 0),
      store,
      productsCount: products.length,
    };
  };

  const exportSnapshot = () => readDb();

  /** Remove contas do servidor local e a cópia da vitrine neste navegador. */
  const purgeAllAccounts = async () => {
    let removedServerUsers = 0;
    try {
      const payload = window.SHOPMIX_API?.request
        ? await window.SHOPMIX_API.request("/api/auth/purge", { method: "POST" })
        : null;
      if (payload?.ok) removedServerUsers = Number(payload.removedUsers) || 0;
    } catch {
      /* servidor ausente */
    }
    const db = readDb();
    const removedUsers = db.users.length;
    const removedStores = db.stores.length;
    const removedProducts = db.products.length;
    const removedOrders = db.orders.length;

    db.users = [];
    db.customerProfiles = [];
    db.sellerApplications = [];
    db.stores = [];
    db.products = [];
    db.orders = [];

    clearSession();
    try {
      localStorage.removeItem("shopmix.user");
    } catch {
      /* ignore */
    }

    log(db, "admin.purge_accounts", "users", null, null, {
      removedUsers,
      removedStores,
      removedProducts,
      removedOrders,
    });
    writeDb(db);

    return {
      ok: true,
      removedUsers: Math.max(removedUsers, removedServerUsers),
      removedStores,
      removedProducts,
      removedOrders,
    };
  };

  window.SHOPMIX_STORE = {
    registerCustomer,
    login,
    logout,
    getSession,
    setSession,
    getUserById,
    getPublicUser,
    submitSellerApplication,
    getStoreForUser,
    listStoreProducts,
    listPublishedProducts,
    upsertProduct,
    deleteProduct,
    saveOrder,
    listOrdersForUser,
    getAccountDashboard,
    exportSnapshot,
    purgeAllAccounts,
  };
})();
