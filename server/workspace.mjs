import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb, sessionUser } from "./db.mjs";

const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

const clip = (value, max) => String(value ?? "").trim().slice(0, max);

const asArray = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);

const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
};

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const rememberToken = (token, workspaceId, userId) => {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO devices (token_hash, workspace_id, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token_hash) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         user_id = excluded.user_id,
         expires_at = excluded.expires_at`,
    )
    .run(tokenHash(token), workspaceId, userId, expiresAt, now);
};

export const revokeToken = (token) => {
  if (!token) return;
  getDb().prepare("DELETE FROM devices WHERE token_hash = ?").run(tokenHash(token));
};

export const resolveToken = (token) => {
  if (!token) return null;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("DELETE FROM devices WHERE expires_at <= ?").run(now);
  const device = db
    .prepare("SELECT workspace_id, user_id, expires_at FROM devices WHERE token_hash = ?")
    .get(tokenHash(token));
  if (device && device.expires_at > now) {
    return {
      token,
      workspaceId: device.workspace_id,
      userId: device.user_id || null,
      user: device.user_id ? sessionUser(token) || publicUser(device.user_id) : null,
    };
  }
  const user = sessionUser(token);
  if (!user) return null;
  return { token, workspaceId: user.id, userId: user.id, user };
};

const publicUser = (userId) => {
  const row = getDb()
    .prepare(
      `SELECT p.id, p.role, p.full_name, p.email, p.phone, p.cpf,
              p.terms_accepted_at, p.legal_consents, p.created_at, p.updated_at,
              c.marketing_opt_in, c.wants_seller
       FROM profiles p
       LEFT JOIN customer_profiles c ON c.user_id = p.id
       WHERE p.id = ?`,
    )
    .get(userId);
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    cpf: row.cpf,
    termsAcceptedAt: row.terms_accepted_at,
    legalConsents: parseJson(row.legal_consents, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    marketingOptIn: Boolean(row.marketing_opt_in),
    wantsSeller: Boolean(row.wants_seller),
  };
};

const ensureWorkspace = (workspaceId, userId) => {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO workspaces (id, user_id, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = COALESCE(excluded.user_id, workspaces.user_id),
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId, userId, now);
};

export const openGuest = () => {
  const workspaceId = `gst-${randomUUID()}`;
  const token = randomBytes(32).toString("base64url");
  ensureWorkspace(workspaceId, null);
  rememberToken(token, workspaceId, null);
  return { ok: true, token, workspaceId };
};

export const ensureUserWorkspace = (userId) => {
  ensureWorkspace(userId, userId);
};

export const bindUserToken = (token, userId) => {
  ensureUserWorkspace(userId);
  rememberToken(token, userId, userId);
};

const listColumn = (workspaceId, kind) =>
  getDb()
    .prepare(
      `SELECT product_id FROM list_items
       WHERE workspace_id = ? AND kind = ?
       ORDER BY position ASC`,
    )
    .all(workspaceId, kind)
    .map((row) => row.product_id);

const readCart = (workspaceId) =>
  getDb()
    .prepare(
      `SELECT product_id, qty, color, size FROM cart_items
       WHERE workspace_id = ?
       ORDER BY rowid ASC`,
    )
    .all(workspaceId)
    .map((row) => ({
      id: row.product_id,
      qty: row.qty,
      ...(row.color ? { color: row.color } : {}),
      ...(row.size ? { size: row.size } : {}),
    }));

const readOwnedStores = (workspaceId) =>
  getDb()
    .prepare("SELECT * FROM stores WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId)
    .map(storeFromRow);

const readPublishedStores = (workspaceId) =>
  getDb()
    .prepare(
      `SELECT DISTINCT s.* FROM stores s
       JOIN products p ON p.store_id = s.id
       WHERE p.status = 'published' AND s.workspace_id <> ?
       ORDER BY s.created_at ASC`,
    )
    .all(workspaceId)
    .map(storeFromRow);

const storeFromRow = (row) => ({
  id: row.id,
  ownerUserId: row.owner_user_id,
  applicationId: row.application_id,
  name: row.name,
  cnpj: row.cnpj,
  category: row.category,
  description: row.description,
  official: Boolean(row.official),
  status: row.status,
  createdAt: row.created_at,
});

const productFromRow = (row) => {
  const extra = parseJson(row.extra_json, {});
  return {
    id: row.id,
    storeId: row.store_id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    price: row.price,
    oldPrice: row.old_price,
    stock: row.stock,
    description: row.description,
    image: row.image,
    gallery: parseJson(row.gallery_json, []),
    condition: row.condition,
    shipping: row.shipping,
    freeShipping: Boolean(row.free_shipping),
    deal: Boolean(row.deal),
    featured: Boolean(row.featured),
    live: Boolean(row.live),
    status: row.status,
    rating: row.rating,
    reviews: row.reviews,
    sold: row.sold,
    tags: parseJson(row.tags_json, []),
    colors: extra.colors || [],
    sizes: extra.sizes || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readProducts = (storeIds, includePublished) => {
  const db = getDb();
  const owned = storeIds.length
    ? db
        .prepare(
          `SELECT * FROM products WHERE store_id IN (${storeIds.map(() => "?").join(",")})`,
        )
        .all(...storeIds)
    : [];
  const published = includePublished
    ? db
        .prepare(
          `SELECT * FROM products WHERE status = 'published'${
            storeIds.length ? ` AND store_id NOT IN (${storeIds.map(() => "?").join(",")})` : ""
          }`,
        )
        .all(...(storeIds.length ? storeIds : []))
    : [];
  const byId = new Map();
  for (const row of [...owned, ...published]) byId.set(row.id, productFromRow(row));
  return [...byId.values()];
};

const readOrders = (workspaceId) => {
  const db = getDb();
  const orders = db
    .prepare("SELECT * FROM orders WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId);
  return orders.map((order) => ({
    id: order.id,
    userId: order.user_id,
    orderNumber: order.order_number,
    total: order.total,
    status: order.status,
    shippingAddress: parseJson(order.shipping_address_json, null),
    createdAt: order.created_at,
    items: db
      .prepare(
        `SELECT product_id, title, quantity, unit_price, extra_json
         FROM order_items WHERE order_id = ? ORDER BY rowid ASC`,
      )
      .all(order.id)
      .map((item) => ({
        productId: item.product_id,
        title: item.title,
        qty: item.quantity,
        unitPrice: item.unit_price,
        ...parseJson(item.extra_json, {}),
      })),
  }));
};

export const readWorkspace = (actor) => {
  const db = getDb();
  ensureWorkspace(actor.workspaceId, actor.userId);
  const workspace = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(actor.workspaceId);
  const user = actor.userId ? publicUser(actor.userId) : null;
  const ownStores = readOwnedStores(actor.workspaceId);
  const otherStores = readPublishedStores(actor.workspaceId);
  const profile = actor.userId
    ? db.prepare("SELECT * FROM customer_profiles WHERE user_id = ?").get(actor.userId)
    : null;
  return {
    ok: true,
    workspaceId: actor.workspaceId,
    user,
    browser: {
      cart: readCart(actor.workspaceId),
      wish: db
        .prepare("SELECT product_id FROM wish_items WHERE workspace_id = ? ORDER BY created_at ASC")
        .all(actor.workspaceId)
        .map((row) => row.product_id),
      recent: listColumn(actor.workspaceId, "recent"),
      compare: listColumn(actor.workspaceId, "compare"),
      cep: workspace?.cep || "",
      consent: parseJson(workspace?.consent_json, null),
      orders: parseJson(workspace?.legacy_orders_json, []),
    },
    catalog: {
      customerProfiles: profile
        ? [
            {
              userId: profile.user_id,
              defaultCep: profile.default_cep,
              defaultAddress: parseJson(profile.default_address, null),
              marketingOptIn: Boolean(profile.marketing_opt_in),
              wantsSeller: Boolean(profile.wants_seller),
              createdAt: profile.created_at,
            },
          ]
        : [],
      sellerApplications: db
        .prepare("SELECT * FROM seller_applications WHERE workspace_id = ? ORDER BY submitted_at ASC")
        .all(actor.workspaceId)
        .map((row) => ({
          id: row.id,
          userId: row.user_id,
          storeName: row.store_name,
          cnpj: row.cnpj,
          category: row.category,
          about: row.about,
          contactEmail: row.contact_email,
          contactPhone: row.contact_phone,
          fiscalCep: row.fiscal_cep,
          legalConsents: parseJson(row.legal_consents, null),
          status: row.status,
          submittedAt: row.submitted_at,
          reviewedAt: row.reviewed_at,
        })),
      stores: [...ownStores, ...otherStores],
      products: readProducts(
        ownStores.map((store) => store.id),
        true,
      ),
      orders: readOrders(actor.workspaceId),
      auditLog: actor.userId
        ? db
            .prepare(
              `SELECT id, user_id, action, entity, entity_id, meta, created_at
               FROM audit_log
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT 100`,
            )
            .all(actor.userId)
            .reverse()
            .map((row) => ({
              id: row.id,
              userId: row.user_id,
              action: row.action,
              entity: row.entity,
              entityId: row.entity_id,
              meta: parseJson(row.meta, {}),
              at: row.created_at,
            }))
        : [],
    },
  };
};

const replaceCart = (db, workspaceId, cart) => {
  db.prepare("DELETE FROM cart_items WHERE workspace_id = ?").run(workspaceId);
  const insert = db.prepare(
    `INSERT INTO cart_items (id, workspace_id, product_id, qty, color, size)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const seen = new Set();
  for (const item of asArray(cart, 100)) {
    const productId = clip(item?.id, 80);
    if (!productId) continue;
    const color = clip(item?.color, 40);
    const size = clip(item?.size, 40);
    const key = `${productId}\0${color}\0${size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const qty = Math.min(99, Math.max(1, Math.round(Number(item?.qty) || 1)));
    insert.run(`${workspaceId}:${key}`, workspaceId, productId, qty, color, size);
  }
};

const replaceWish = (db, workspaceId, wish) => {
  db.prepare("DELETE FROM wish_items WHERE workspace_id = ?").run(workspaceId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO wish_items (workspace_id, product_id, created_at) VALUES (?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const seen = new Set();
  for (const id of asArray(wish, 200)) {
    const productId = clip(id, 80);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    insert.run(workspaceId, productId, now);
  }
};

const replaceList = (db, workspaceId, kind, ids, max) => {
  db.prepare("DELETE FROM list_items WHERE workspace_id = ? AND kind = ?").run(workspaceId, kind);
  const insert = db.prepare(
    `INSERT INTO list_items (workspace_id, kind, product_id, position) VALUES (?, ?, ?, ?)`,
  );
  const seen = new Set();
  let position = 0;
  for (const id of asArray(ids, max)) {
    const productId = clip(id, 80);
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    insert.run(workspaceId, kind, productId, position);
    position += 1;
  }
};

const ownedStoreIds = (db, workspaceId) =>
  new Set(
    db
      .prepare("SELECT id FROM stores WHERE workspace_id = ?")
      .all(workspaceId)
      .map((row) => row.id),
  );

export const writeWorkspace = (actor, body) => {
  const db = getDb();
  const workspaceId = actor.workspaceId;
  const userId = actor.userId;
  ensureWorkspace(workspaceId, userId);
  const browser = body?.browser && typeof body.browser === "object" ? body.browser : {};
  const catalog = body?.catalog && typeof body.catalog === "object" ? body.catalog : {};
  const now = new Date().toISOString();
  const ownerId = userId || workspaceId;

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE workspaces
       SET cep = ?, consent_json = ?, legacy_orders_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      clip(browser.cep, 16),
      browser.consent ? JSON.stringify(browser.consent).slice(0, 2000) : null,
      JSON.stringify(asArray(browser.orders, 200)).slice(0, 200000),
      now,
      workspaceId,
    );
    replaceCart(db, workspaceId, browser.cart);
    replaceWish(db, workspaceId, browser.wish);
    replaceList(db, workspaceId, "recent", browser.recent, 30);
    replaceList(db, workspaceId, "compare", browser.compare, 3);

    const existingStores = ownedStoreIds(db, workspaceId);
    db.prepare("DELETE FROM seller_applications WHERE workspace_id = ?").run(workspaceId);
    const insertApp = db.prepare(
      `INSERT INTO seller_applications (
         id, workspace_id, user_id, store_name, cnpj, category, about,
         contact_email, contact_phone, fiscal_cep, legal_consents, status, submitted_at, reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const app of asArray(catalog.sellerApplications, 50)) {
      const id = clip(app?.id, 80);
      if (!id) continue;
      const appUser = app?.userId && userId && app.userId !== userId ? null : app?.userId || userId;
      if (app?.userId && userId && app.userId !== userId && app.userId !== workspaceId) continue;
      insertApp.run(
        id,
        workspaceId,
        appUser,
        clip(app?.storeName, 120),
        clip(app?.cnpj, 20),
        clip(app?.category, 80),
        clip(app?.about, 4000),
        clip(app?.contactEmail, 160) || null,
        clip(app?.contactPhone, 40) || null,
        clip(app?.fiscalCep, 16) || null,
        app?.legalConsents ? JSON.stringify(app.legalConsents).slice(0, 4000) : null,
        clip(app?.status, 20) || "approved",
        clip(app?.submittedAt, 40) || now,
        clip(app?.reviewedAt, 40) || null,
      );
    }

    const incomingStores = asArray(catalog.stores, 50).filter((store) => {
      const owner = store?.ownerUserId || null;
      return !owner || owner === userId || owner === workspaceId || existingStores.has(store?.id);
    });
    const incomingIds = new Set(incomingStores.map((store) => clip(store?.id, 80)).filter(Boolean));
    for (const id of existingStores) {
      if (incomingIds.has(id)) continue;
      db.prepare("DELETE FROM products WHERE store_id = ?").run(id);
      db.prepare("DELETE FROM stores WHERE id = ? AND workspace_id = ?").run(id, workspaceId);
    }
    const upsertStore = db.prepare(
      `INSERT INTO stores (
         id, workspace_id, owner_user_id, application_id, name, cnpj, category,
         description, official, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workspace_id = excluded.workspace_id,
         owner_user_id = excluded.owner_user_id,
         application_id = excluded.application_id,
         name = excluded.name,
         cnpj = excluded.cnpj,
         category = excluded.category,
         description = excluded.description,
         official = excluded.official,
         status = excluded.status`,
    );
    for (const store of incomingStores) {
      const id = clip(store?.id, 80);
      if (!id) continue;
      if (existingStores.has(id) || !db.prepare("SELECT id FROM stores WHERE id = ?").get(id)) {
        upsertStore.run(
          id,
          workspaceId,
          ownerId,
          clip(store?.applicationId, 80) || null,
          clip(store?.name, 120),
          clip(store?.cnpj, 20),
          clip(store?.category, 80),
          clip(store?.description, 4000),
          store?.official ? 1 : 0,
          clip(store?.status, 20) || "active",
          clip(store?.createdAt, 40) || now,
        );
      }
    }

    const storeIds = ownedStoreIds(db, workspaceId);
    db.prepare(
      `DELETE FROM products WHERE store_id IN (SELECT id FROM stores WHERE workspace_id = ?)`,
    ).run(workspaceId);
    const insertProduct = db.prepare(
      `INSERT INTO products (
         id, store_id, title, brand, category, price, old_price, stock, description, image,
         condition, shipping, free_shipping, deal, featured, live, status, rating, reviews, sold,
         tags_json, gallery_json, extra_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const product of asArray(catalog.products, 500)) {
      const storeId = clip(product?.storeId, 80);
      const id = clip(product?.id, 80);
      if (!id || !storeId || !storeIds.has(storeId)) continue;
      const occupied = db.prepare("SELECT store_id FROM products WHERE id = ?").get(id);
      if (occupied && !storeIds.has(occupied.store_id)) continue;
      insertProduct.run(
        id,
        storeId,
        clip(product?.title, 180),
        clip(product?.brand, 80),
        clip(product?.category, 80),
        money(product?.price),
        product?.oldPrice == null ? null : money(product.oldPrice),
        Math.max(0, Math.round(Number(product?.stock) || 0)),
        clip(product?.description, 8000),
        clip(product?.image, 500),
        clip(product?.condition, 40) || "novo",
        clip(product?.shipping, 40) || "rapido",
        product?.freeShipping ? 1 : 0,
        product?.deal ? 1 : 0,
        product?.featured ? 1 : 0,
        product?.live ? 1 : 0,
        clip(product?.status, 20) || "published",
        money(product?.rating ?? 4.5),
        Math.max(0, Math.round(Number(product?.reviews) || 0)),
        Math.max(0, Math.round(Number(product?.sold) || 0)),
        JSON.stringify(asArray(product?.tags, 30).map((tag) => clip(tag, 40))),
        JSON.stringify(asArray(product?.gallery, 8).map((url) => clip(url, 500))),
        JSON.stringify({
          colors: asArray(product?.colors, 20).map((color) => clip(color, 40)),
          sizes: asArray(product?.sizes, 20).map((size) => clip(size, 40)),
        }),
        clip(product?.createdAt, 40) || now,
        clip(product?.updatedAt, 40) || now,
      );
    }

    const orderIds = db
      .prepare("SELECT id FROM orders WHERE workspace_id = ?")
      .all(workspaceId)
      .map((row) => row.id);
    for (const orderId of orderIds) {
      db.prepare("DELETE FROM order_items WHERE order_id = ?").run(orderId);
    }
    db.prepare("DELETE FROM orders WHERE workspace_id = ?").run(workspaceId);
    const insertOrder = db.prepare(
      `INSERT INTO orders (
         id, workspace_id, user_id, order_number, total, status, shipping_address_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, title, quantity, unit_price, extra_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const order of asArray(catalog.orders, 300)) {
      const id = clip(order?.id, 80);
      if (!id) continue;
      if (order?.userId && userId && order.userId !== userId && order.userId !== workspaceId) continue;
      if (db.prepare("SELECT workspace_id FROM orders WHERE id = ?").get(id)) continue;
      insertOrder.run(
        id,
        workspaceId,
        userId || order?.userId || null,
        clip(order?.orderNumber, 80) || id,
        money(order?.total),
        clip(order?.status, 20) || "paid",
        order?.shippingAddress ? JSON.stringify(order.shippingAddress).slice(0, 4000) : null,
        clip(order?.createdAt, 40) || now,
      );
      for (const item of asArray(order?.items, 100)) {
        const extra = { ...item };
        delete extra.productId;
        delete extra.title;
        delete extra.qty;
        delete extra.unitPrice;
        insertItem.run(
          randomUUID(),
          id,
          clip(item?.productId, 80) || null,
          clip(item?.title, 180) || null,
          Math.max(1, Math.round(Number(item?.qty) || 1)),
          money(item?.unitPrice),
          Object.keys(extra).length ? JSON.stringify(extra).slice(0, 2000) : null,
        );
      }
    }

    if (userId) {
      const profile = asArray(catalog.customerProfiles, 5).find((item) => item?.userId === userId);
      if (profile) {
        db.prepare(
          `UPDATE customer_profiles
           SET marketing_opt_in = ?, wants_seller = ?, default_cep = COALESCE(?, default_cep)
           WHERE user_id = ?`,
        ).run(profile.marketingOptIn ? 1 : 0, profile.wantsSeller ? 1 : 0, clip(browser.cep, 16) || null, userId);
      }
      const hasStore = db
        .prepare("SELECT id FROM stores WHERE workspace_id = ? AND status = 'active'")
        .get(workspaceId);
      if (hasStore) {
        db.prepare("UPDATE profiles SET role = 'seller', updated_at = ? WHERE id = ? AND role = 'customer'").run(
          now,
          userId,
        );
      }
      const insertAudit = db.prepare(
        `INSERT OR IGNORE INTO audit_log (id, user_id, action, entity, entity_id, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const entry of asArray(catalog.auditLog, 100)) {
        const id = clip(entry?.id, 80);
        if (!id || (entry?.userId && entry.userId !== userId)) continue;
        insertAudit.run(
          id,
          userId,
          clip(entry?.action, 80) || "sync",
          clip(entry?.entity, 40) || "workspace",
          clip(entry?.entityId, 80) || null,
          entry?.meta ? JSON.stringify(entry.meta).slice(0, 2000) : null,
          clip(entry?.at, 40) || now,
        );
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return readWorkspace(actor);
};

const lineKey = (item) => `${item.product_id}\0${item.color || ""}\0${item.size || ""}`;

export const mergeGuestIntoUser = (guestWorkspaceId, userId) => {
  if (!guestWorkspaceId || guestWorkspaceId === userId) return;
  const db = getDb();
  ensureUserWorkspace(userId);
  const guest = db.prepare("SELECT id FROM workspaces WHERE id = ? AND user_id IS NULL").get(guestWorkspaceId);
  if (!guest) return;

  db.exec("BEGIN");
  try {
    const userCart = db.prepare("SELECT * FROM cart_items WHERE workspace_id = ?").all(userId);
    const guestCart = db.prepare("SELECT * FROM cart_items WHERE workspace_id = ?").all(guestWorkspaceId);
    const merged = new Map(userCart.map((item) => [lineKey(item), { ...item }]));
    for (const item of guestCart) {
      const key = lineKey(item);
      const prev = merged.get(key);
      if (!prev) merged.set(key, { ...item, workspace_id: userId });
      else prev.qty = Math.min(99, prev.qty + item.qty);
    }
    db.prepare("DELETE FROM cart_items WHERE workspace_id = ? OR workspace_id = ?").run(userId, guestWorkspaceId);
    const insertCart = db.prepare(
      `INSERT INTO cart_items (id, workspace_id, product_id, qty, color, size) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of merged.values()) {
      insertCart.run(`${userId}:${lineKey(item)}`, userId, item.product_id, item.qty, item.color || "", item.size || "");
    }

    const wish = new Set([
      ...db.prepare("SELECT product_id FROM wish_items WHERE workspace_id = ?").all(userId).map((row) => row.product_id),
      ...db.prepare("SELECT product_id FROM wish_items WHERE workspace_id = ?").all(guestWorkspaceId).map((row) => row.product_id),
    ]);
    db.prepare("DELETE FROM wish_items WHERE workspace_id = ? OR workspace_id = ?").run(userId, guestWorkspaceId);
    const insertWish = db.prepare(
      `INSERT INTO wish_items (workspace_id, product_id, created_at) VALUES (?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (const productId of wish) insertWish.run(userId, productId, now);

    for (const kind of ["recent", "compare"]) {
      const max = kind === "compare" ? 3 : 30;
      const ids = [];
      const pushUnique = (rows) => {
        for (const row of rows) {
          if (!ids.includes(row.product_id)) ids.push(row.product_id);
        }
      };
      pushUnique(db.prepare("SELECT product_id FROM list_items WHERE workspace_id = ? AND kind = ? ORDER BY position").all(userId, kind));
      pushUnique(
        db.prepare("SELECT product_id FROM list_items WHERE workspace_id = ? AND kind = ? ORDER BY position").all(guestWorkspaceId, kind),
      );
      db.prepare("DELETE FROM list_items WHERE (workspace_id = ? OR workspace_id = ?) AND kind = ?").run(userId, guestWorkspaceId, kind);
      const insert = db.prepare(
        `INSERT INTO list_items (workspace_id, kind, product_id, position) VALUES (?, ?, ?, ?)`,
      );
      ids.slice(0, max).forEach((productId, position) => insert.run(userId, kind, productId, position));
    }

    const userSpace = db.prepare("SELECT cep, consent_json, legacy_orders_json FROM workspaces WHERE id = ?").get(userId);
    const guestSpace = db.prepare("SELECT cep, consent_json, legacy_orders_json FROM workspaces WHERE id = ?").get(guestWorkspaceId);
    const legacy = [
      ...parseJson(userSpace?.legacy_orders_json, []),
      ...parseJson(guestSpace?.legacy_orders_json, []),
    ].slice(0, 200);
    db.prepare(
      `UPDATE workspaces SET cep = ?, consent_json = COALESCE(consent_json, ?), legacy_orders_json = ?, updated_at = ? WHERE id = ?`,
    ).run(
      userSpace?.cep || guestSpace?.cep || "",
      guestSpace?.consent_json || null,
      JSON.stringify(legacy),
      now,
      userId,
    );

    db.prepare("UPDATE stores SET workspace_id = ?, owner_user_id = ? WHERE workspace_id = ?").run(userId, userId, guestWorkspaceId);
    db.prepare("UPDATE seller_applications SET workspace_id = ?, user_id = ? WHERE workspace_id = ?").run(userId, userId, guestWorkspaceId);
    db.prepare("UPDATE orders SET workspace_id = ?, user_id = ? WHERE workspace_id = ?").run(userId, userId, guestWorkspaceId);
    db.prepare("DELETE FROM devices WHERE workspace_id = ?").run(guestWorkspaceId);
    db.prepare("DELETE FROM workspaces WHERE id = ?").run(guestWorkspaceId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
};
