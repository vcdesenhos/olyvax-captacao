# Prospecção — CRM interno de captação

Ferramenta interna pra prospectar negócios em escala: **scraping → enriquecimento → pipeline**.
Roda 100% local, sem serviços pagos. Banco em arquivo único (SQLite nativo do Node).

![stack](https://img.shields.io/badge/node-%E2%89%A522.5-43c08a) ![db](https://img.shields.io/badge/db-sqlite_nativo-4d8ff0)

---

## Por que essa stack

- **SQLite nativo (`node:sqlite`)** — zero compilação, zero `node-gyp`, zero dependência nativa.
  O banco é um arquivo `prospec.db` que você pode copiar, versionar ou apagar à vontade.
- **Express** — API REST simples.
- **Playwright** — scraper do Google Maps (só precisa baixar o Chromium uma vez).
- **Front vanilla** (HTML/CSS/JS) — sem build step. Edita e recarrega.

---

## Rodar

Precisa de **Node 22.5 ou superior** (`node -v`).

```bash
npm install          # express + playwright
npm run seed         # popula 240 leads de exemplo (pula se quiser começar vazio)
npm start            # sobe em http://localhost:3000
```

Abra **http://localhost:3000**. O dashboard já nasce populado com os dados de exemplo.

### Para usar o scraper de verdade

O Playwright precisa baixar o navegador uma vez:

```bash
npx playwright install chromium
```

Depois, ou clica em **⚡ Scraper** no app (informa termo + cidade), ou pelo terminal:

```bash
npm run scrape -- "clinica de odontologia" "Mogi Guaçu, SP" 60
npm run enrich -- 50     # checa site/IG/Meta Ads de 50 leads pendentes
```

---

## O que já funciona

| Recurso | Status |
|---|---|
| Dashboard com métricas (total, sem site, com IG, rodam ads, abordados, pipeline, follow-up) | ✅ |
| Abas (Sem Site, Com Site, Abordados, Frio, Com/Sem IG, Ads, Follow-up…) | ✅ |
| Busca + filtros por nicho e cidade + paginação | ✅ |
| Ações na linha: **Abordar**, **→ Pipeline**, **WhatsApp** (abre wa.me) | ✅ |
| Adicionar lead manual (**+ Lead**) | ✅ |
| Scraper Google Maps (nome, endereço, telefone, nota, reviews, site) com dedupe | ✅ |
| Enriquecimento: confirma site vivo, tenta achar IG, checa Meta Ads | ✅ (heurística) |

## Pontos de extensão (próximos módulos)

São ganchos já preparados, marcados no código:

- **Importar/Exportar CSV** — botões prontos no front; falta `/api/import` e `/api/export` (parse/serialização). Trivial com o schema atual.
- **Tarefas / + Tarefa** — tabela e fluxo de follow-up agendado.
- **WhatsApp em lote** — hoje abre `wa.me` por lead; dá pra plugar uma API (ex. Z-API/Evolution) no backend.
- **Enriquecimento robusto** — o check de IG e Meta Ads usa heurística pública. Pra produção, trocar por Graph API / Meta Ad Library API oficiais (mais confiável).

---

## Arquitetura

```
src/
  db.js            schema SQLite + queries (filtros das abas, stats, upsert/dedupe)
  server.js        API REST + serve o front
  cli.js           scrape/enrich pelo terminal
  seed.js          dados de exemplo
  scraper/
    maps.js        Playwright → Google Maps
    enrich.js      site vivo + Instagram + Meta Ads
public/
  index.html · styles.css · app.js     dashboard
```

### API

```
GET   /api/stats                      métricas dos cards
GET   /api/leads?tab=&nicho=&cidade=&q=&limit=&offset=
GET   /api/filters                    nichos e cidades distintos
POST  /api/leads                      cria lead manual
PATCH /api/leads/:id                  atualiza (status, próxima ação, etc.)
POST  /api/leads/:id/pipeline         atalho: joga no pipeline
POST  /api/scrape  {termo,cidade,max} dispara job (assíncrono)
GET   /api/scrape/:id                 status/log do job
POST  /api/enrich  {limit}            enriquece leads pendentes
```

---

## ⚠️ Sobre o scraping (honestidade técnica)

Raspar o Google Maps **contraria os termos de uso do Google** e pode ser bloqueado
(CAPTCHA, limite de taxa). Pra uso interno e volume baixo costuma funcionar. Pra escala
(milhares/dia) você vai querer **proxies rotativos + delays**, ou migrar pra
**Google Places API** oficial — mais estável e sem risco de bloqueio. Os seletores do
Maps mudam de tempos em tempos; se algo quebrar, ajuste os marcados com `[SELETOR]`
em `src/scraper/maps.js`.
