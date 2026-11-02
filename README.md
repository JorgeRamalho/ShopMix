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

O comando sobe o conteúdo de `public/` em `http://localhost:4173`.

No Live Server, abra `public/index.html`. Os estilos e scripts acompanham essa pasta. Se o servidor já estiver no ar, pare e inicie de novo depois desta correção.
