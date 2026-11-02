/**
 * Limpa contas do ShopMix no localStorage.
 *
 * Opção A — no seu navegador (Chrome/Edge), com o site aberto em /conta:
 *   SHOPMIX_STORE.purgeAllAccounts();
 *   localStorage.removeItem("shopmix.user");
 *   location.reload();
 *
 * Opção B — em desenvolvimento local, abra uma vez:
 *   http://localhost:4173/conta?purge=all
 *   (confirme no diálogo; só funciona em localhost)
 */
console.log(`
ShopMix — apagar todas as contas deste navegador

1) DevTools (F12) → Console, na página /conta:

   SHOPMIX_STORE.purgeAllAccounts();
   localStorage.removeItem("shopmix.user");
   location.reload();

2) Ou, com npm start rodando:

   http://localhost:4173/conta?purge=all
`);
