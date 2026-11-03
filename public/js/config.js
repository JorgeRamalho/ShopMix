(function () {
  const host = window.location.hostname;
  const port = window.location.port;
  const isLocal = host === "127.0.0.1" || host === "localhost";
  const onShopMixServer = isLocal && (!port || port === "4173");

  if (!onShopMixServer && isLocal) {
    window.SHOPMIX_API_BASE = "http://127.0.0.1:4173";
    window.SHOPMIX_LOGIN_CREATES_ACCOUNT = true;
    try {
      if (sessionStorage.getItem("shopmix.apiBase") === "same") {
        sessionStorage.removeItem("shopmix.apiBase");
      }
    } catch {
      /* ignore */
    }
  } else {
    window.SHOPMIX_API_BASE = window.SHOPMIX_API_BASE || "";
    window.SHOPMIX_LOGIN_CREATES_ACCOUNT = Boolean(window.SHOPMIX_LOGIN_CREATES_ACCOUNT);
  }
})();
