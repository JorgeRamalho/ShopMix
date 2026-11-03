# Arquitetura de pastas

A raiz do repositório é a entrada do projeto. `public/` é a raiz publicada: o que o servidor entrega.

```
Projeto-ShopMix/
├── README.md
├── package.json
├── serve.json
├── .gitignore
├── docs/
│   ├── README.md
│   ├── planejamento/visao-e-escopo.md
│   ├── pesquisas/referencias-de-mercado.md
│   ├── estrutura/arquitetura-de-pastas.md
│   └── organizacao/convencoes.md
├── server/
│   ├── index.mjs
│   ├── db.mjs
│   ├── workspace.mjs
│   └── password.mjs
├── database/
│   └── schema.sql
├── scripts/
│   ├── check-images.mjs
│   ├── verify-auth.mjs
│   └── verify-workspace.mjs
├── data/                  # banco local, fora do Git
└── public/
    ├── index.html
    ├── robots.txt
    ├── sitemap.xml
    ├── manifest.webmanifest
    ├── sw.js
    ├── pages/
    ├── css/shopmix.css
    ├── js/config.js
    ├── js/api.js
    ├── js/data.js
    ├── js/store.js
    ├── js/shopmix.js
    └── assets/
        ├── favicon.svg
        └── logo.svg
```

## O que fica na raiz do repositório

Só configuração e entrada:

- `README.md` explica como abrir o projeto.
- `package.json` define `npm start`.
- `serve.json` configura o servidor local e redireciona as URLs antigas (`/catalogo`) para `/pages/catalogo.html`.
- `.gitignore` lista o que não é código do site.

Página, estilo, script, imagem, pesquisa e nota de planejamento não entram aqui.

## O que fica na raiz publicada

`public/` precisa de alguns arquivos na origem porque navegador e buscador pedem esse caminho:

| Arquivo | Motivo |
| --- | --- |
| `index.html` | Entrada do site em `/` |
| `robots.txt` | Pedido padrão em `/robots.txt` |
| `sitemap.xml` | Mapa citado pelo `robots.txt` |
| `manifest.webmanifest` | Manifesto do app, ligado por caminho absoluto |
| `sw.js` | Service worker com escopo em `/` |

Todo o resto do site está numa pasta com um tipo de arquivo.

## Pastas por tipo de arquivo

| Pasta | Um arquivo representa |
| --- | --- |
| `public/pages/` | Uma rota |
| `public/css/` | A folha de estilo do site |
| `public/js/data.js` | O catálogo e os textos de dados |
| `public/js/shopmix.js` | O comportamento da interface |
| `public/assets/` | Uma marca (ícone ou logotipo) |
| `docs/planejamento/` | O escopo do produto |
| `docs/pesquisas/` | As referências que sustentam a interface |
| `docs/estrutura/` | Este contrato de pastas |
| `docs/organizacao/` | As convenções para acrescentar arquivos |
| `scripts/` | Uma ferramenta de verificação, fora do site publicado |
