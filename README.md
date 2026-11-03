# ShopMix

Marketplace híbrido estático: busca, vitrine, sacola e compra protegida.

## Raiz do repositório

A raiz guarda só a entrada humana e a configuração. O site publicado fica em `public/`.

| Arquivo | Função |
| --- | --- |
| `README.md` | Entrada do projeto |
| `index.html` | Atalho do Live Server para `public/index.html` |
| `package.json` | Nome do pacote e script de desenvolvimento |
| `serve.json` | Servidor local, URLs limpas e redirecionamentos das rotas antigas |
| `.gitignore` | O que não entra no versionamento |

O restante está em pastas. O mapa completo está em [docs/estrutura/arquitetura-de-pastas.md](docs/estrutura/arquitetura-de-pastas.md). O índice da documentação está em [docs/README.md](docs/README.md).

## Desenvolvimento

Na raiz do repositório:

```bash
npm start
```

O comando sobe o site e o banco em `http://localhost:4173`. Conta, senha, carrinho, favoritos, loja, produtos e pedidos ficam em `data/shopmix.sqlite`.

O Live Server (e qualquer hospedagem estática) mostra as páginas, mas não grava sozinho. Com `npm start` ligado, o navegador encontra a API em `http://127.0.0.1:4173` e envia os dados com um token. Em outro servidor, defina `window.SHOPMIX_API_BASE` em `public/js/config.js` com o endereço dessa API.
