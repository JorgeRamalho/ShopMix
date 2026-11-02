(() => {
  const DATA = window.SHOPMIX_DATA;
  const KEYS = {
    cart: "shopmix.cart",
    wish: "shopmix.wish",
    user: "shopmix.user",
    recent: "shopmix.recent",
    compare: "shopmix.compare",
    consent: "shopmix.consent",
    cep: "shopmix.cep",
    orders: "shopmix.orders",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const money = (n) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const discount = (p) =>
    p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;

  const storeOf = (p) => DATA.stores.find((s) => s.id === p.storeId);

  const read = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  const params = () => new URLSearchParams(location.search);

  const normalize = (s) =>
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const toast = (msg) => {
    const stack = $("#toast-stack") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "toast-stack", className: "toast-stack" }));
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  };

  const state = {
    cart: read(KEYS.cart, []),
    wish: read(KEYS.wish, []),
    user: read(KEYS.user, null),
    recent: read(KEYS.recent, []),
    compare: read(KEYS.compare, []),
    cep: read(KEYS.cep, ""),
  };

  const persist = () => {
    write(KEYS.cart, state.cart);
    write(KEYS.wish, state.wish);
    write(KEYS.user, state.user);
    write(KEYS.recent, state.recent);
    write(KEYS.compare, state.compare);
    write(KEYS.cep, state.cep);
    syncCounts();
  };

  const productById = (id) => DATA.products.find((p) => p.id === id);

  const cartCount = () => state.cart.reduce((n, i) => n + i.qty, 0);
  const cartTotal = () =>
    state.cart.reduce((n, i) => {
      const p = productById(i.id);
      return n + (p ? p.price * i.qty : 0);
    }, 0);

  const addCart = (id, qty = 1, extra = {}) => {
    const item = state.cart.find((i) => i.id === id && i.color === extra.color && i.size === extra.size);
    if (item) item.qty += qty;
    else state.cart.push({ id, qty, ...extra });
    persist();
    toast("Adicionado ao carrinho");
  };

  const toggleWish = (id) => {
    state.wish = state.wish.includes(id)
      ? state.wish.filter((x) => x !== id)
      : [...state.wish, id];
    persist();
    toast(state.wish.includes(id) ? "Salvo nos favoritos" : "Removido dos favoritos");
  };

  const toggleCompare = (id) => {
    if (state.compare.includes(id)) {
      state.compare = state.compare.filter((x) => x !== id);
    } else if (state.compare.length >= 3) {
      toast("Compare até 3 produtos");
      return;
    } else {
      state.compare.push(id);
    }
    persist();
    renderCompare();
  };

  const searchProducts = (query, filters = {}) => {
    const q = normalize(query);
    let list = DATA.products.slice();
    if (q) {
      list = list
        .map((p) => {
          const hay = normalize([p.title, p.brand, p.category, p.description, ...(p.tags || [])].join(" "));
          let score = 0;
          if (hay.includes(q)) score += 8;
          q.split(" ").filter(Boolean).forEach((w) => {
            if (hay.includes(w)) score += 2;
          });
          return { p, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.p);
    }
    if (filters.category) list = list.filter((p) => p.category === filters.category);
    if (filters.brand) list = list.filter((p) => p.brand === filters.brand);
    if (filters.min != null && filters.min !== "") list = list.filter((p) => p.price >= Number(filters.min));
    if (filters.max != null && filters.max !== "") list = list.filter((p) => p.price <= Number(filters.max));
    if (filters.rating) list = list.filter((p) => p.rating >= Number(filters.rating));
    if (filters.free) list = list.filter((p) => p.freeShipping);
    if (filters.full) list = list.filter((p) => p.shipping === "full");
    if (filters.official) list = list.filter((p) => storeOf(p)?.official);
    if (filters.condition) list = list.filter((p) => p.condition === filters.condition);
    if (filters.deal) list = list.filter((p) => p.deal);
    if (filters.cupons) list = list.filter((p) => discount(p) >= 5);
    switch (filters.sort) {
      case "price-asc":
        list.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list.sort((a, b) => b.price - a.price);
        break;
      case "rating":
        list.sort((a, b) => b.rating - a.rating);
        break;
      case "discount":
        list.sort((a, b) => discount(b) - discount(a));
        break;
      case "new":
        list.reverse();
        break;
      default:
        break;
    }
    return list;
  };

  const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

  const card = (p) => `
    <article class="product-card" data-id="${p.id}">
      <div class="thumb">
        <a href="pages/produto.html?id=${p.id}">
          <img src="${p.image}" alt="${p.title}" width="400" height="400" loading="lazy">
        </a>
        <button class="wish ${state.wish.includes(p.id) ? "is-on" : ""}" type="button" data-wish="${p.id}" aria-label="Favoritar ${p.title}">♥</button>
      </div>
      <div class="card-body">
        <div class="pills">
          ${p.freeShipping ? '<span class="pill">Frete grátis</span>' : ""}
          ${p.shipping === "full" ? '<span class="pill full">Mix Full</span>' : ""}
          ${p.live ? '<span class="pill live">Ao vivo</span>' : ""}
          ${p.condition === "usado" ? '<span class="pill warn">Seminovo</span>' : ""}
        </div>
        <h3><a href="pages/produto.html?id=${p.id}">${p.title}</a></h3>
        <p class="meta">${p.brand} · ${stars(p.rating)} ${p.rating} (${p.reviews})</p>
        <p>
          ${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ""}
          <span class="price">${money(p.price)}</span>
          ${discount(p) ? `<span class="off">${discount(p)}% OFF</span>` : ""}
        </p>
        <p class="meta">em até 10x de ${money(p.price / 10)} sem juros</p>
        <div class="chips">
          <button class="btn btn-ghost" type="button" data-add="${p.id}">Adicionar</button>
          <button class="chip" type="button" data-compare="${p.id}" aria-pressed="${state.compare.includes(p.id)}">Comparar</button>
        </div>
      </div>
    </article>
  `;

  const icon = (name) => {
    const map = {
      search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      mic: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
      cam: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h4l2-3h4l2 3h4v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
      user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
      bag: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8h12l-1 13H7L6 8z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/></svg>',
      cart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
      home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 11 12 4l8 7v9H4z"/></svg>',
      heart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z"/></svg>',
      chevDown:
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
      grid: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      menu: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    };
    return map[name] || "";
  };

  const chrome = () => {
    const header = $("#site-header");
    const footer = $("#site-footer");
    if (!header) return;
    const page = document.body.dataset.page;
    header.innerHTML = `
      <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <div class="topbar">
        <div class="wrap">
          <p>Compra protegida · Frete Mix Full em capitais · Parcelamento sem juros</p>
          <p><a href="pages/conscientizacao.html">Conscientização do consumidor</a> · <a href="pages/vender.html">Venda no ShopMix</a></p>
        </div>
      </div>
      <div class="wrap header-main">
        <a class="brand" href="index.html" aria-label="ShopMix, página inicial">
          <img src="assets/favicon.svg" alt="" width="42" height="42">
          <span><strong class="brand-name">ShopMix</strong><small>Marketplace híbrido</small></span>
        </a>
        <div class="search-shell">
          <form class="search-form" id="search-form" role="search" action="pages/catalogo.html" method="get">
            <label class="sr-only" for="cat-select">Categoria da busca</label>
            <select id="cat-select" name="cat">
              <option value="">Tudo</option>
              ${DATA.categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}
            </select>
            <label class="sr-only" for="q">Buscar produtos, marcas e lojas</label>
            <input id="q" name="q" type="search" placeholder="Buscar produtos, marcas e muito mais…" autocomplete="off" aria-autocomplete="list" aria-controls="suggest" aria-expanded="false">
            <div class="search-tools">
              <button class="icon-btn" id="voice-btn" type="button" aria-label="Busca por voz">${icon("mic")}</button>
              <button class="icon-btn" id="visual-btn" type="button" aria-label="Busca visual">${icon("cam")}</button>
            </div>
            <button type="submit" aria-label="Buscar">${icon("search")}</button>
          </form>
          <div class="suggest" id="suggest" role="listbox" hidden></div>
          <input class="vis-search" id="visual-input" type="file" accept="image/*" aria-label="Enviar imagem para busca visual">
        </div>
        <div class="header-actions">
          <a class="header-link hide-sm" href="pages/conta.html">
            <span>Olá, ${state.user ? state.user.name.split(" ")[0] : "entre"}</span>
            <strong>Conta e pedidos</strong>
          </a>
          <a class="header-link hide-sm" href="pages/vender.html">
            <span>Loja oficial</span>
            <strong>Vender</strong>
          </a>
          <a class="header-icon-btn badge-count" href="pages/carrinho.html" id="cart-link" aria-label="Carrinho">
            ${icon("cart")}
            <i id="cart-count">0</i>
          </a>
          <div class="site-menu-wrap">
            <button class="header-icon-btn" id="site-menu-btn" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Menu do site">
              ${icon("menu")}
            </button>
            <nav class="site-menu" id="site-menu" hidden aria-label="Menu do site">
              <a href="index.html">Início</a>
              <a href="pages/catalogo.html">Catálogo</a>
              <button type="button" id="site-menu-cat">Categorias</button>
              <a href="pages/catalogo.html?deal=1">Ofertas</a>
              <a href="pages/catalogo.html?cupons=1">Cupons</a>
              <a href="pages/catalogo.html?cat=supermercado">Supermercado</a>
              <a href="pages/catalogo.html?cat=moda">Moda</a>
              <a href="pages/conta.html#mixpay">MixPay</a>
              <a href="pages/vender.html">Vender</a>
              <a href="pages/conscientizacao.html#contato">Contato</a>
              <a href="pages/conta.html#compras">Compras</a>
              <a href="pages/conta.html#favoritos">Favoritos</a>
              <a href="pages/conta.html">Conta</a>
            </nav>
          </div>
        </div>
      </div>
      <div class="cat-nav-block">
        <nav class="cat-nav" aria-label="Categorias">
          <div class="wrap cat-nav-track">
            <button class="nav-cat nav-cat--expand" id="cat-expand-btn" type="button" aria-expanded="false" aria-controls="cat-expand">
              Categorias
              <span class="nav-cat-chevron" aria-hidden="true">${icon("chevDown")}</span>
            </button>
            <a href="pages/catalogo.html?deal=1">Ofertas</a>
            <a href="pages/catalogo.html?cupons=1">Cupons</a>
            <a href="pages/catalogo.html?cat=supermercado">Supermercado</a>
            <a href="pages/catalogo.html?cat=moda">Moda</a>
            <a href="pages/conta.html#mixpay">MixPay</a>
            <a href="pages/vender.html">Vender</a>
            <a href="pages/conscientizacao.html#contato">Contato</a>
            <a href="pages/conta.html#compras">Compras</a>
            <a href="pages/conta.html#favoritos">Favoritos</a>
          </div>
        </nav>
        <div class="cat-expand-backdrop" id="cat-expand-backdrop" hidden></div>
        <section class="cat-expand" id="cat-expand" hidden aria-labelledby="cat-expand-title">
          <div class="wrap cat-expand-inner">
            <header class="cat-expand-head">
              <h2 id="cat-expand-title">Todas as categorias</h2>
              <p class="meta">Escolha uma vitrine ou atalho rápido abaixo.</p>
            </header>
            <div class="cat-expand-grid">
              ${DATA.categories
                .map(
                  (c) => `
                <article class="cat-expand-card">
                  <h3><a href="pages/catalogo.html?cat=${c.id}">${c.name}</a></h3>
                  <p class="meta">${c.blurb}</p>
                  <div class="cat-expand-links">
                    <a href="pages/catalogo.html?cat=${c.id}">Ver vitrine</a>
                    <a href="pages/catalogo.html?cat=${c.id}&full=1">Mix Full</a>
                    <a href="pages/catalogo.html?cat=${c.id}&sort=discount">Descontos</a>
                  </div>
                </article>`
                )
                .join("")}
            </div>
            <footer class="cat-expand-foot">
              <a class="btn btn-ghost" href="pages/catalogo.html">Catálogo completo</a>
            </footer>
          </div>
        </section>
      </div>
    `;

    if (footer) {
      footer.innerHTML = `
        <div class="wrap foot-grid">
          <div>
            <strong class="brand-name">ShopMix</strong>
            <p>Um marketplace que mistura descoberta visual, busca precisa e confiança de compra — sem copiar ninguém, com a autenticidade de quem aprendeu com os gigantes.</p>
          </div>
          <div>
            <h2 style="font-size:1rem">Comprar</h2>
            <a href="pages/catalogo.html">Catálogo</a>
            <a href="pages/catalogo.html?deal=1">Ofertas</a>
            <a href="pages/conscientizacao.html">Direitos do consumidor</a>
          </div>
          <div>
            <h2 style="font-size:1rem">Vender</h2>
            <a href="pages/vender.html">Abrir loja</a>
            <a href="pages/conta.html">Entrar</a>
          </div>
          <div>
            <h2 style="font-size:1rem">Padrões</h2>
            <a href="pages/conscientizacao.html#acessibilidade">WCAG 2.2</a>
            <a href="pages/conscientizacao.html#privacidade">LGPD</a>
            <a href="sitemap.xml">Sitemap</a>
          </div>
        </div>
      `;
    }

    const app = $("#app-nav");
    if (app) {
      app.innerHTML = `
        <nav aria-label="Navegação do aplicativo">
          <a href="index.html" ${page === "home" ? 'aria-current="page"' : ""}>${icon("home")}Início</a>
          <button type="button" id="app-cat-btn">${icon("grid")}Categorias</button>
          <a href="pages/catalogo.html?deal=1" ${page === "catalogo" && params().get("deal") === "1" ? 'aria-current="page"' : ""}>⚡Ofertas</a>
          <a class="badge-count app-nav-cart" href="pages/carrinho.html" ${page === "carrinho" ? 'aria-current="page"' : ""}>${icon("bag")}Sacola<i id="app-cart-count">0</i></a>
          <a href="pages/conta.html" ${page === "conta" ? 'aria-current="page"' : ""}>${icon("user")}Conta</a>
        </nav>
      `;
    }

    bindChrome();
    syncCounts();
    renderCompare();
    consent();
  };

  const bindChrome = () => {
    const form = $("#search-form");
    const input = $("#q");
    const box = $("#suggest");
    const catExpandBtn = $("#cat-expand-btn");
    const catExpand = $("#cat-expand");
    const catExpandBackdrop = $("#cat-expand-backdrop");
    if (form && input && box) {
      const current = params();
      input.value = current.get("q") || "";
      const cat = $("#cat-select");
      if (cat) cat.value = current.get("cat") || "";
      const renderSuggest = () => {
        const q = input.value.trim();
        const hits = q ? searchProducts(q).slice(0, 6) : [];
        const recents = state.recent.slice(0, 4);
        box.innerHTML = `
          ${q ? "" : `<p class="meta" style="padding:8px 12px">Buscas em alta</p>${DATA.popularQueries.map((s) => `<a role="option" href="pages/catalogo.html?q=${encodeURIComponent(s)}">${s}</a>`).join("")}`}
          ${recents.length && !q ? `<p class="meta" style="padding:8px 12px">Recentes</p>${recents.map((s) => `<a role="option" href="pages/catalogo.html?q=${encodeURIComponent(s)}">${s}</a>`).join("")}` : ""}
          ${hits.map((p) => `<a role="option" href="pages/produto.html?id=${p.id}">${p.title} · ${money(p.price)}</a>`).join("")}
        `;
        box.hidden = false;
        box.classList.add("is-open");
        input.setAttribute("aria-expanded", "true");
      };
      input.addEventListener("input", renderSuggest);
      input.addEventListener("focus", renderSuggest);
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-shell")) {
          box.classList.remove("is-open");
          box.hidden = true;
          input.setAttribute("aria-expanded", "false");
        }
      });
      form.addEventListener("submit", () => {
        const q = input.value.trim();
        if (q) {
          state.recent = [q, ...state.recent.filter((x) => x !== q)].slice(0, 8);
          persist();
        }
      });
    }

    const setCatExpandOpen = (open) => {
      if (!catExpand || !catExpandBtn) return;
      catExpand.hidden = !open;
      if (catExpandBackdrop) catExpandBackdrop.hidden = !open;
      catExpandBtn.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("cat-expand-open", open);
    };
    catExpandBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      setCatExpandOpen(catExpand.hidden);
    });
    $("#app-cat-btn")?.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setCatExpandOpen(true);
    });
    catExpandBackdrop?.addEventListener("click", () => setCatExpandOpen(false));
    catExpand?.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setCatExpandOpen(false));
    });
    document.addEventListener("click", (e) => {
      if (!catExpand || catExpand.hidden) return;
      if (e.target.closest(".cat-nav-block")) return;
      setCatExpandOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && catExpand && !catExpand.hidden) setCatExpandOpen(false);
    });

    const siteMenu = $("#site-menu");
    const siteMenuBtn = $("#site-menu-btn");
    const setSiteMenuOpen = (open) => {
      if (!siteMenu || !siteMenuBtn) return;
      siteMenu.hidden = !open;
      siteMenuBtn.setAttribute("aria-expanded", String(open));
    };
    siteMenuBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      setSiteMenuOpen(siteMenu.hidden);
    });
    siteMenu?.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setSiteMenuOpen(false));
    });
    $("#site-menu-cat")?.addEventListener("click", () => {
      setSiteMenuOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      setCatExpandOpen(true);
    });

    $("#voice-btn")?.addEventListener("click", () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        toast("Busca por voz indisponível neste navegador");
        return;
      }
      const rec = new SR();
      rec.lang = "pt-BR";
      rec.onresult = (ev) => {
        $("#q").value = ev.results[0][0].transcript;
        $("#search-form").requestSubmit();
      };
      rec.start();
      toast("Ouvindo…");
    });

    const vis = $("#visual-input");
    $("#visual-btn")?.addEventListener("click", () => vis?.click());
    vis?.addEventListener("change", () => {
      if (!vis.files?.[0]) return;
      location.href = "pages/catalogo.html?q=moda&visual=1";
    });

    document.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      const wish = e.target.closest("[data-wish]");
      const cmp = e.target.closest("[data-compare]");
      if (add) {
        e.preventDefault();
        addCart(add.dataset.add);
      }
      if (wish) {
        e.preventDefault();
        e.stopPropagation();
        toggleWish(wish.dataset.wish);
        wish.classList.toggle("is-on", state.wish.includes(wish.dataset.wish));
      }
      if (cmp) {
        e.preventDefault();
        toggleCompare(cmp.dataset.compare);
        cmp.setAttribute("aria-pressed", String(state.compare.includes(cmp.dataset.compare)));
      }
    });
  };

  const syncCounts = () => {
    const n = cartCount();
    const el = $("#cart-count");
    const appEl = $("#app-cart-count");
    if (el) el.textContent = String(n);
    if (appEl) {
      appEl.textContent = String(n);
      appEl.hidden = n === 0;
    }
  };

  const renderCompare = () => {
    let bar = $("#compare-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "compare-bar";
      bar.className = "compare-bar";
      document.body.appendChild(bar);
    }
    if (!state.compare.length) {
      bar.classList.remove("is-on");
      bar.innerHTML = "";
      return;
    }
    bar.classList.add("is-on");
    bar.innerHTML = `
      <strong>Comparar (${state.compare.length}/3)</strong>
      <span class="meta">${state.compare.map((id) => productById(id)?.title.split(" ").slice(0, 2).join(" ")).join(" · ")}</span>
      <button class="btn btn-soft" type="button" id="do-compare">Ver</button>
      <button class="chip" type="button" id="clear-compare">Limpar</button>
    `;
    $("#clear-compare").onclick = () => {
      state.compare = [];
      persist();
      renderCompare();
    };
    $("#do-compare").onclick = () => {
      const rows = ["title", "price", "rating", "freeShipping", "brand"];
      const html = state.compare
        .map((id) => productById(id))
        .filter(Boolean)
        .map((p) => `<p><strong>${p.title}</strong><br>${money(p.price)} · ${p.rating}★ · ${p.brand} · ${p.freeShipping ? "Frete grátis" : "Frete a calcular"}</p>`)
        .join("");
      toast("Comparativo aberto");
      const box = document.createElement("div");
      box.className = "consent";
      box.innerHTML = `<h3>Comparativo Mix</h3>${html}<button class="btn btn-primary" type="button">Fechar</button>`;
      box.querySelector("button").onclick = () => box.remove();
      document.body.appendChild(box);
    };
  };

  const consent = () => {
    if (read(KEYS.consent, false)) return;
    const box = document.createElement("div");
    box.className = "consent-banner";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-labelledby", "consent-title");
    box.innerHTML = `
      <div class="wrap consent-banner-inner">
        <div class="consent-copy">
          <p id="consent-title"><strong>Privacidade ShopMix</strong></p>
          <p class="meta">Usamos cookies essenciais de carrinho e, com o seu aceite, cookies de personalização da vitrine. Consulte a <a href="pages/conscientizacao.html#privacidade">política LGPD</a>.</p>
        </div>
        <div class="consent-actions">
          <button class="btn btn-primary" type="button" id="ok-c">Aceitar</button>
          <button class="btn btn-ghost" type="button" id="no-c">Só essenciais</button>
        </div>
      </div>
    `;
    document.body.appendChild(box);
    $("#ok-c").onclick = () => {
      write(KEYS.consent, { all: true, at: Date.now() });
      box.remove();
    };
    $("#no-c").onclick = () => {
      write(KEYS.consent, { all: false, at: Date.now() });
      box.remove();
    };
  };

  const setupRailNav = (rail, prevBtn, nextBtn) => {
    if (!rail || !prevBtn || !nextBtn) return;

    const scrollStep = () => {
      const card = rail.querySelector(".product-card");
      if (!card) return Math.max(200, rail.clientWidth * 0.85);
      const styles = getComputedStyle(rail);
      const gap = Number.parseFloat(styles.columnGap || styles.gap) || 14;
      return card.getBoundingClientRect().width + gap;
    };

    const sync = () => {
      const max = Math.max(0, rail.scrollWidth - rail.clientWidth);
      const left = rail.scrollLeft;
      prevBtn.setAttribute("aria-disabled", String(left <= 2));
      nextBtn.setAttribute("aria-disabled", String(left >= max - 2));
    };

    const scrollByStep = (dir) => {
      const blocked =
        (dir < 0 && prevBtn.getAttribute("aria-disabled") === "true") ||
        (dir > 0 && nextBtn.getAttribute("aria-disabled") === "true");
      if (blocked) return;
      const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      rail.scrollBy({ left: dir * scrollStep(), behavior });
    };

    prevBtn.addEventListener("click", () => scrollByStep(-1));
    nextBtn.addEventListener("click", () => scrollByStep(1));
    rail.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(sync);
      ro.observe(rail);
    }
    sync();
  };

  const dealsByCategoryMix = (items) => {
    const buckets = Object.fromEntries(DATA.categories.map((c) => [c.id, []]));
    items.forEach((p) => {
      if (buckets[p.category]) buckets[p.category].push(p);
    });
    const mixed = [];
    let added = true;
    while (added) {
      added = false;
      for (const cat of DATA.categories) {
        const next = buckets[cat.id]?.shift();
        if (next) {
          mixed.push(next);
          added = true;
        }
      }
    }
    return mixed;
  };

  const home = () => {
    const deals = dealsByCategoryMix(DATA.products.filter((p) => p.deal));
    const featured = DATA.products.filter((p) => p.featured);
    const live = DATA.products.filter((p) => p.live);
    $("#deal-rail").innerHTML = deals.map(card).join("");
    setupRailNav($("#deal-rail"), $("#deal-rail-prev"), $("#deal-rail-next"));
    $("#feat-grid").innerHTML = featured.map(card).join("");
    $("#cat-grid").innerHTML = DATA.categories
      .map(
        (c) => `
        <a class="cat-card" href="pages/catalogo.html?cat=${c.id}">
          <strong>${c.name}</strong>
          <span>${c.blurb}</span>
        </a>`
      )
      .join("");
    $("#live-grid").innerHTML = live
      .map(
        (p) => `
        <a class="live-card" href="pages/produto.html?id=${p.id}" style="background-image:url('${p.image}')">
          <div>
            <span class="pulse">Mix Live</span>
            <h3>${p.title}</h3>
            <p>${money(p.price)}</p>
          </div>
        </a>`
      )
      .join("");
    $("#store-grid").innerHTML = DATA.stores
      .map(
        (s) => `
        <article class="store-card">
          <h3>${s.name}</h3>
          <p class="meta">${s.official ? "Loja oficial verificada" : "Vendedor Mix"}</p>
          <a class="btn btn-ghost" href="pages/catalogo.html?q=${encodeURIComponent(s.name)}">Ver vitrine</a>
        </article>`
      )
      .join("");

    const slides = $$(".hero-slide");
    const dots = $("#hero-dots");
    const heroSection = $(".hero");
    if (dots && slides.length) {
      dots.innerHTML = slides
        .map((_, i) => `<button type="button" aria-label="Slide ${i + 1}" ${i === 0 ? 'aria-current="true"' : ""}></button>`)
        .join("");
      let i = 0;
      const syncHeroChrome = (idx) => {
        const slide = slides[idx];
        if (!slide || !heroSection) return;
        const photos = slide.querySelector("[data-photos]")?.dataset.photos ?? "1";
        heroSection.dataset.activePhotos = photos;
      };
      const go = (n) => {
        i = (n + slides.length) % slides.length;
        slides.forEach((s, idx) => s.classList.toggle("is-active", idx === i));
        $$("button", dots).forEach((b, idx) => b.setAttribute("aria-current", String(idx === i)));
        syncHeroChrome(i);
      };
      syncHeroChrome(0);
      $$("button", dots).forEach((b, idx) => b.addEventListener("click", () => go(idx)));
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setInterval(() => go(i + 1), 6500);
      }
    }

    const end = Date.now() + 1000 * 60 * 60 * 8;
    const tick = () => {
      const left = Math.max(0, end - Date.now());
      const h = String(Math.floor(left / 3600000)).padStart(2, "0");
      const m = String(Math.floor((left % 3600000) / 60000)).padStart(2, "0");
      const s = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
      const t = $("#deal-timer");
      if (t) t.innerHTML = `<b>${h}</b><b>${m}</b><b>${s}</b>`;
    };
    tick();
    setInterval(tick, 1000);
  };

  const catalog = () => {
    const p = params();
    const filters = {
      q: p.get("q") || "",
      category: p.get("cat") || "",
      brand: p.get("brand") || "",
      min: p.get("min") || "",
      max: p.get("max") || "",
      rating: p.get("rating") || "",
      free: p.get("free") === "1",
      full: p.get("full") === "1",
      official: p.get("official") === "1",
      condition: p.get("condition") || "",
      deal: p.get("deal") === "1",
      cupons: p.get("cupons") === "1",
      sort: p.get("sort") || "relevance",
    };
    const brands = [...new Set(DATA.products.map((x) => x.brand))];
    $("#filters").innerHTML = `
      <div class="filters-head">
        <h2>Filtros avançados</h2>
        <button class="filter-close" id="filter-close" type="button" aria-label="Fechar filtros">×</button>
      </div>
      <form id="filter-form">
        <div class="filter-group field">
          <label for="f-cat">Categoria</label>
          <select id="f-cat" name="cat">
            <option value="">Todas</option>
            ${DATA.categories.map((c) => `<option value="${c.id}" ${filters.category === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <p><strong>Preço</strong></p>
          <div class="range-pair">
            <label class="field">Mínimo <input type="number" name="min" min="0" value="${filters.min}" inputmode="numeric"></label>
            <label class="field">Máximo <input type="number" name="max" min="0" value="${filters.max}" inputmode="numeric"></label>
          </div>
          <label class="field">Faixa rápida
            <input type="range" id="price-range" min="0" max="5000" step="10" value="${filters.max || 5000}" aria-describedby="price-note">
          </label>
          <p class="meta" id="price-note">O controle deslizante também pode ser ajustado pelos campos numéricos, sem arrastar.</p>
        </div>
        <div class="filter-group field">
          <label for="f-brand">Marca</label>
          <select id="f-brand" name="brand">
            <option value="">Todas</option>
            ${brands.map((b) => `<option ${filters.brand === b ? "selected" : ""}>${b}</option>`).join("")}
          </select>
        </div>
        <div class="filter-group">
          <label class="check"><input type="checkbox" name="free" value="1" ${filters.free ? "checked" : ""}> Frete grátis</label>
          <label class="check"><input type="checkbox" name="full" value="1" ${filters.full ? "checked" : ""}> Mix Full</label>
          <label class="check"><input type="checkbox" name="official" value="1" ${filters.official ? "checked" : ""}> Loja oficial</label>
          <label class="check"><input type="checkbox" name="deal" value="1" ${filters.deal ? "checked" : ""}> Ofertas</label>
        </div>
        <div class="filter-group field">
          <label for="f-rate">Avaliação mínima</label>
          <select id="f-rate" name="rating">
            <option value="">Qualquer</option>
            <option value="4" ${filters.rating === "4" ? "selected" : ""}>4 estrelas ou mais</option>
            <option value="4.5" ${filters.rating === "4.5" ? "selected" : ""}>4,5 ou mais</option>
          </select>
        </div>
        <div class="filter-group field">
          <label for="f-cond">Condição</label>
          <select id="f-cond" name="condition">
            <option value="">Todas</option>
            <option value="novo" ${filters.condition === "novo" ? "selected" : ""}>Novo</option>
            <option value="usado" ${filters.condition === "usado" ? "selected" : ""}>Seminovo</option>
          </select>
        </div>
        <button class="btn btn-primary" type="submit">Aplicar filtros</button>
      </form>
    `;
    $("#price-range")?.addEventListener("input", (e) => {
      const max = $("#filter-form [name=max]");
      if (max) max.value = e.target.value;
    });
    const filtersEl = $("#filters");
    const filterBackdrop = $("#filter-backdrop");
    const filterOpenBtn = $("#filter-open");
    const setFiltersDrawerOpen = (open) => {
      filtersEl?.classList.toggle("filters-drawer-open", open);
      if (filterBackdrop) filterBackdrop.hidden = !open;
      filterOpenBtn?.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("filter-drawer-open", open);
    };
    filterOpenBtn?.addEventListener("click", () =>
      setFiltersDrawerOpen(!filtersEl?.classList.contains("filters-drawer-open")),
    );
    filterBackdrop?.addEventListener("click", () => setFiltersDrawerOpen(false));
    $("#filter-close")?.addEventListener("click", () => setFiltersDrawerOpen(false));

    $("#filter-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const next = new URLSearchParams();
      if (filters.q) next.set("q", filters.q);
      for (const [k, v] of fd.entries()) {
        if (v) next.set(k, v);
      }
      setFiltersDrawerOpen(false);
      location.search = next.toString();
    });

    const list = searchProducts(filters.q, filters);
    $("#result-title").textContent = filters.q
      ? `Resultados para “${filters.q}”`
      : filters.category
        ? DATA.categories.find((c) => c.id === filters.category)?.name || "Catálogo"
        : filters.deal
          ? "Ofertas Mix"
          : filters.cupons
            ? "Cupons e descontos"
            : "Vitrine ShopMix";
    $("#result-count").textContent = `${list.length} produto${list.length === 1 ? "" : "s"}`;
    $("#sort").value = filters.sort;
    $("#sort").onchange = () => {
      const next = new URLSearchParams(location.search);
      next.set("sort", $("#sort").value);
      location.search = next.toString();
    };
    const chips = [];
    if (filters.q) chips.push(["Busca", filters.q, "q"]);
    if (filters.category) chips.push(["Categoria", filters.category, "cat"]);
    if (filters.free) chips.push(["Frete", "grátis", "free"]);
    if (filters.full) chips.push(["Envio", "Full", "full"]);
    $("#active-chips").innerHTML = chips
      .map(([k, v]) => `<span class="chip">${k}: ${v}</span>`)
      .join("");
    $("#catalog-grid").innerHTML = list.length
      ? list.map(card).join("")
      : `<div class="empty"><h3>Nada por aqui</h3><p>Tente remover filtros ou explorar categorias próximas.</p><a class="btn btn-primary" href="pages/catalogo.html">Limpar busca</a></div>`;
    if (p.get("visual") === "1") toast("Busca visual: mostramos moda semelhante à imagem enviada");
  };

  const product = () => {
    const p = productById(params().get("id"));
    if (!p) {
      $("#pdp").innerHTML = `<div class="empty"><h1>Produto não encontrado</h1><a class="btn btn-primary" href="pages/catalogo.html">Voltar à vitrine</a></div>`;
      return;
    }
    document.title = `${p.title} | ShopMix`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", `${p.title} por ${money(p.price)} no ShopMix. ${p.description}`);
    const related = DATA.products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 4);
    let color = p.colors?.[0] || "";
    let size = p.sizes?.[0] || "";
    let photo = p.gallery[0];
    const bindStickyBuy = () => {
      let bar = $("#pdp-sticky");
      if (!bar) {
        bar = document.createElement("aside");
        bar.id = "pdp-sticky";
        bar.className = "pdp-sticky";
        bar.setAttribute("aria-label", "Compra rápida");
        document.body.appendChild(bar);
      }
      bar.innerHTML = `
        <p class="pdp-sticky-price"><span class="price">${money(p.price)}</span></p>
        <button class="btn btn-ghost" id="sticky-add" type="button">Sacola</button>
        <button class="btn btn-primary" id="sticky-buy" type="button">Comprar</button>
      `;
      const qty = () => Number($("#qty")?.value || 1);
      $("#sticky-add").onclick = () => addCart(p.id, qty(), { color, size });
      $("#sticky-buy").onclick = () => {
        addCart(p.id, qty(), { color, size });
        location.href = "pages/checkout.html";
      };
    };
    const draw = () => {
      $("#pdp").innerHTML = `
        <div class="gallery">
          <div class="thumbs">
            ${p.gallery.map((src) => `<button type="button" data-src="${src}" aria-current="${src === photo}"><img src="${src}" alt=""></button>`).join("")}
          </div>
          <div class="stage"><img src="${photo}" alt="${p.title}"></div>
        </div>
        <div>
          <p class="meta">${DATA.categories.find((c) => c.id === p.category)?.name} · ${p.brand} · ${storeOf(p)?.name || ""} ${storeOf(p)?.official ? "· Oficial" : ""}</p>
          <h1>${p.title}</h1>
          <p class="meta">${stars(p.rating)} ${p.rating} · ${p.reviews} avaliações · ${p.sold} vendidos</p>
          <p>${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ""}<span class="price">${money(p.price)}</span> ${discount(p) ? `<span class="off">${discount(p)}% OFF</span>` : ""}</p>
          <p>ou 10x de ${money(p.price / 10)} sem juros no Mix Pay</p>
          <p>${p.description}</p>
          ${p.colors?.length ? `<p><strong>Cor</strong></p><div class="swatches">${p.colors.map((c) => `<button type="button" data-color="${c}" aria-pressed="${c === color}">${c}</button>`).join("")}</div>` : ""}
          ${p.sizes?.length ? `<p><strong>Tamanho</strong></p><div class="sizes">${p.sizes.map((s) => `<button type="button" data-size="${s}" aria-pressed="${s === size}">${s}</button>`).join("")}</div>` : ""}
          <p><strong>Quantidade</strong></p>
          <div class="qty">
            <button type="button" data-q="-1" aria-label="Diminuir">−</button>
            <input id="qty" type="number" min="1" max="${p.stock}" value="1">
            <button type="button" data-q="1" aria-label="Aumentar">+</button>
          </div>
          <p class="meta">${p.stock} em estoque · ${p.freeShipping ? "Frete grátis" : "Frete a calcular"} · ${p.shipping === "full" ? "Mix Full" : "Envio padrão"}</p>
          <label class="field">Calcular entrega
            <input id="cep" inputmode="numeric" maxlength="9" placeholder="00000-000" value="${state.cep}">
          </label>
          <p class="meta" id="cep-out"></p>
          <div class="chips">
            <button class="btn btn-primary" id="buy" type="button">Comprar agora</button>
            <button class="btn btn-ghost" id="add" type="button">Adicionar à sacola</button>
            <button class="btn btn-soft" data-wish="${p.id}" type="button">${state.wish.includes(p.id) ? "Nos favoritos" : "Favoritar"}</button>
          </div>
        </div>
      `;
      $$(".thumbs button").forEach((b) => {
        b.onclick = () => {
          photo = b.dataset.src;
          draw();
        };
      });
      $$("[data-color]").forEach((b) => (b.onclick = () => { color = b.dataset.color; draw(); }));
      $$("[data-size]").forEach((b) => (b.onclick = () => { size = b.dataset.size; draw(); }));
      $$("[data-q]").forEach((b) => {
        b.onclick = () => {
          const input = $("#qty");
          input.value = Math.max(1, Math.min(p.stock, Number(input.value) + Number(b.dataset.q)));
        };
      });
      $("#cep").oninput = (e) => {
        state.cep = e.target.value;
        persist();
        const digits = state.cep.replace(/\D/g, "");
        $("#cep-out").textContent = digits.length === 8
          ? (p.freeShipping ? "Chega em 1–2 dias úteis · grátis via Mix Full" : "Chega em 3–6 dias · R$ 19,90")
          : "Digite 8 números para estimar";
      };
      $("#add").onclick = () => addCart(p.id, Number($("#qty").value), { color, size });
      $("#buy").onclick = () => {
        addCart(p.id, Number($("#qty").value), { color, size });
        location.href = "pages/checkout.html";
      };
      bindStickyBuy();
    };
    draw();
    $("#related").innerHTML = related.map(card).join("");
    const ld = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.title,
      image: p.gallery,
      description: p.description,
      brand: { "@type": "Brand", name: p.brand },
      offers: {
        "@type": "Offer",
        priceCurrency: "BRL",
        price: p.price,
        availability: "https://schema.org/InStock",
      },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: p.rating,
        reviewCount: p.reviews,
      },
    };
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);
  };

  const cartPage = () => {
    const box = $("#cart-list");
    if (!state.cart.length) {
      box.innerHTML = `<div class="empty"><h1>Sua sacola está vazia</h1><a class="btn btn-primary" href="pages/catalogo.html">Explorar vitrine</a></div>`;
      $("#summary").hidden = true;
      return;
    }
    box.innerHTML = state.cart
      .map((i) => {
        const p = productById(i.id);
        if (!p) return "";
        return `
          <article class="cart-item">
            <img src="${p.image}" alt="">
            <div>
              <h2 style="font-size:1.05rem"><a href="pages/produto.html?id=${p.id}">${p.title}</a></h2>
              <p class="meta">${i.color || ""} ${i.size || ""}</p>
              <div class="qty">
                <button type="button" data-cid="${i.id}" data-d="-1">−</button>
                <input value="${i.qty}" readonly aria-label="Quantidade">
                <button type="button" data-cid="${i.id}" data-d="1">+</button>
              </div>
              <button class="btn btn-danger" data-del="${i.id}" type="button">Remover</button>
            </div>
            <strong>${money(p.price * i.qty)}</strong>
          </article>`;
      })
      .join("");
    $("#sum-items").textContent = `${cartCount()} itens`;
    $("#sum-total").textContent = money(cartTotal());
    box.onclick = (e) => {
      const d = e.target.closest("[data-d]");
      const del = e.target.closest("[data-del]");
      if (d) {
        const item = state.cart.find((x) => x.id === d.dataset.cid);
        if (item) item.qty = Math.max(1, item.qty + Number(d.dataset.d));
        persist();
        cartPage();
      }
      if (del) {
        state.cart = state.cart.filter((x) => x.id !== del.dataset.del);
        persist();
        cartPage();
      }
    };
  };

  const checkout = () => {
    if (!state.cart.length) {
      location.href = "pages/carrinho.html";
      return;
    }
    const form = $("#checkout-form");
    const same = $("#same-addr");
    const bill = $("#billing-fields");
    same?.addEventListener("change", () => {
      bill.hidden = same.checked;
      $$("input", bill).forEach((i) => (i.required = !same.checked));
    });
    if (state.user) {
      form.nome.value = state.user.name || "";
      form.email.value = state.user.email || "";
    }
    $("#pay-total").textContent = money(cartTotal());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const total = cartTotal();
      const orders = read(KEYS.orders, []);
      orders.push({
        id: `MX-${Date.now().toString(36).toUpperCase()}`,
        when: new Date().toLocaleString("pt-BR"),
        total,
      });
      write(KEYS.orders, orders);
      state.cart = [];
      persist();
      $("#checkout-form").hidden = true;
      $("#done").hidden = false;
    });
  };

  const account = () => {
    const login = $("#login-form");
    const reg = $("#register-form");
    const tabs = $$("[data-tab]");
    const show = (name) => {
      $("#pane-login").hidden = name !== "login";
      $("#pane-register").hidden = name !== "register";
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    };
    tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));
    login.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = login.email.value.trim();
      const saved = state.user;
      if (!saved || saved.email !== email || saved.pass !== login.senha.value) {
        $("#login-error").textContent = "E-mail ou senha não conferem.";
        return;
      }
      toast("Bem-vindo de volta");
      location.href = "index.html";
    });
    reg.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = reg.nome.value.trim();
      const email = reg.email.value.trim();
      const pass = reg.senha.value;
      if (name.length < 2) return ($("#reg-error").textContent = "Nome precisa ter ao menos 2 caracteres.");
      if (!email.includes("@")) return ($("#reg-error").textContent = "Informe um e-mail válido.");
      if (pass.length < 8) return ($("#reg-error").textContent = "Senha com no mínimo 8 caracteres.");
      if (pass !== reg.confirma.value) return ($("#reg-error").textContent = "As senhas não coincidem.");
      if (!reg.termos.checked) return ($("#reg-error").textContent = "Aceite os termos para continuar.");
      state.user = { name, email, pass };
      persist();
      toast("Conta criada");
      location.href = "index.html";
    });
    if (state.user) {
      $("#session-box").hidden = false;
      $("#session-name").textContent = state.user.name;
      $("#logout").onclick = () => {
        state.user = null;
        persist();
        location.reload();
      };
    }
    $("#wish-grid").innerHTML = state.wish.length
      ? state.wish.map((id) => productById(id)).filter(Boolean).map(card).join("")
      : "<p class='meta'>Nenhum favorito ainda.</p>";
    const orders = read(KEYS.orders, []);
    const ordersEl = $("#orders-list");
    if (ordersEl) {
      ordersEl.innerHTML = orders.length
        ? `<ul class="order-list">${orders
            .slice()
            .reverse()
            .map(
              (o) =>
                `<li><strong>${o.id}</strong> · ${o.when} · ${money(o.total)}</li>`,
            )
            .join("")}</ul>`
        : "<p class='meta'>Nenhum pedido ainda. Suas compras aparecem aqui após o checkout.</p>";
    }
    const hash = location.hash.replace("#", "");
    if (hash) {
      const target = document.getElementById(hash);
      if (target) {
        requestAnimationFrame(() =>
          target.scrollIntoView({ behavior: "smooth", block: "start" }),
        );
      }
    }
  };

  const seller = () => {
    $("#seller-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      if (!f.checkValidity()) return f.reportValidity();
      if (f.cnpj.value.replace(/\D/g, "").length !== 14) {
        $("#seller-error").textContent = "CNPJ deve ter 14 dígitos.";
        return;
      }
      toast("Loja enviada para análise Mix");
      f.reset();
      $("#seller-ok").hidden = false;
    });
  };

  const pwa = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      const bar = document.createElement("div");
      bar.className = "install-banner";
      bar.innerHTML = `<p><strong>Instalar o app ShopMix</strong></p><p class="meta">Acesso rápido, busca e sacola na tela inicial.</p><button class="btn btn-primary" type="button">Instalar</button>`;
      document.body.appendChild(bar);
      bar.querySelector("button").onclick = async () => {
        e.prompt();
        bar.remove();
      };
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    chrome();
    pwa();
    const page = document.body.dataset.page;
    if (page === "home") home();
    if (page === "catalogo") catalog();
    if (page === "produto") product();
    if (page === "carrinho") cartPage();
    if (page === "checkout") checkout();
    if (page === "conta") account();
    if (page === "vender") seller();
  });
})();
