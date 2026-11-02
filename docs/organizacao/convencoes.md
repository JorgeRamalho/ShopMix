# Convenções

## Nomes

- Pastas e arquivos em minúsculas, sem espaço, em português quando o nome é de produto (`catalogo`, `carrinho`, `conscientizacao`).
- Uma rota, um arquivo HTML com o mesmo nome da rota: `catalogo.html` publica `/pages/catalogo.html`.
- Documentação: uma pasta por assunto e um arquivo por tema. O nome do arquivo diz o conteúdo (`visao-e-escopo.md`, não `notas.md`).

## Caminhos

Links internos são relativos à raiz do site, sem barra no início: `css/shopmix.css`, `js/shopmix.js`, `pages/catalogo.html`, `index.html`.

Cada HTML define essa raiz com um `<base>` no início do `<head>`. Se o Live Server abrir `.../public/index.html`, a raiz vira `/public/`. Se o servidor já publicar a pasta `public` em `/`, a raiz vira `/`.

Endereços antigos na raiz (`/catalogo`, `/conta.html` e os equivalentes) redirecionam em `serve.json`. O endereço canônico é o de `public/pages/`.

## Ao acrescentar algo

1. Página nova: criar `public/pages/<rota>.html`, apontar CSS, manifesto e scripts com caminhos absolutos, incluir a rota no `sitemap.xml` e, se substituir um endereço antigo, um redirect em `serve.json`.
2. Estilo novo: arquivo próprio em `public/css/`, ligado pelas páginas que o usam.
3. Comportamento novo: função no `public/js/shopmix.js`, ou um arquivo novo em `public/js/` se o assunto for outro (dados, não interface).
4. Imagem de marca: arquivo próprio em `public/assets/`.
5. Decisão de produto, pesquisa, estrutura ou regra de time: arquivo novo na pasta correspondente de `docs/`, e uma linha no índice `docs/README.md`.

Nada disso volta para a raiz do repositório.
