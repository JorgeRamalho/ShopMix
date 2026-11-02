# Visão e escopo

ShopMix é um marketplace híbrido em HTML, CSS e JavaScript, sem backend. A promessa de produto é misturar busca precisa, vitrine visual e compra protegida no mesmo fluxo.

## Rotas

Cada rota é um arquivo em `public/pages/`, exceto a home, que é a entrada do site.

| Rota publicada | Arquivo | Papel |
| --- | --- | --- |
| `/` | `public/index.html` | Home: vitrine, ofertas, categorias, Mix Live e lojas |
| `/pages/catalogo.html` | `public/pages/catalogo.html` | Busca e filtros |
| `/pages/produto.html` | `public/pages/produto.html` | Detalhe do item (`?id=`) |
| `/pages/carrinho.html` | `public/pages/carrinho.html` | Sacola |
| `/pages/checkout.html` | `public/pages/checkout.html` | Fechamento do pedido |
| `/pages/conta.html` | `public/pages/conta.html` | Conta, pedidos, favoritos e MixPay |
| `/pages/vender.html` | `public/pages/vender.html` | Cadastro de loja |
| `/pages/conscientizacao.html` | `public/pages/conscientizacao.html` | Direitos, acessibilidade, privacidade e contato |

O catálogo, as lojas e os textos de interface vivem em `public/js/data.js`. O comportamento da interface vive em `public/js/shopmix.js`. Os estilos vivem em `public/css/shopmix.css`.

## Dentro do escopo atual

- Navegação compartilhada, busca, filtros, sacola em `localStorage` e fluxo de checkout simulado.
- PWA mínimo: `public/manifest.webmanifest` e `public/sw.js`.
- SEO de site estático: `public/robots.txt` e `public/sitemap.xml`.

## Fora do escopo atual

- Conta real, pagamento, estoque e painel de vendedor no servidor.
- Bundler, framework ou pasta `src/` compilada. O que está em `public/` é o site.
