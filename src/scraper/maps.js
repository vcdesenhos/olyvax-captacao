import { chromium } from 'playwright';
import { upsertLead, db } from '../db.js';

/**
 * Scraper de listagens de negócios no Google Maps.
 *
 * Estratégia: coleta os LINKS de todos os negócios na lista (rolando até o fim)
 * e depois VISITA cada link direto. Isso evita o problema de "lista re-montada"
 * que fazia só o primeiro resultado entrar.
 *
 * Honestidade técnica: scraping do Maps contraria os ToS do Google e pode ser
 * bloqueado em escala. Pra uso interno e volume baixo costuma funcionar. Se os
 * seletores [SELETOR] quebrarem (o Maps muda de tempos em tempos), ajuste aqui.
 */

const FIELD_TIMEOUT = 2500;

function log(jobId, msg) {
  const row = db.prepare('SELECT log FROM scrape_jobs WHERE id = ?').get(jobId);
  const prev = row?.log ? row.log + '\n' : '';
  db.prepare('UPDATE scrape_jobs SET log = ? WHERE id = ?').run(prev + msg, jobId);
  console.log(`[scrape ${jobId}] ${msg}`);
}

const onlyDigits = (s) => (s ? s.replace(/\D/g, '') : null);

// Heurística de "é celular?" (fixos não têm WhatsApp).
//  - Portugal (351): número nacional começa com 9 (ex: 912 345 678)
//  - Brasil (55): celular tem 11 dígitos (DDD + 9 + 8); fixo tem 10
//  - outros DDIs: não bloqueia (assume válido)
function pareceMovel(national, ddi) {
  if (!national) return false;
  if (ddi === '351') return national.startsWith('9');
  if (ddi === '55')  return national.length === 11;
  return true;
}

// Monta o número de WhatsApp (E.164) SEM mexer no telefone exibido.
// Só devolve número se ele parecer um celular; fixos retornam null.
function montarWhatsapp(raw, ddi) {
  const d = onlyDigits(raw);
  if (!d) return null;
  let national, e164;
  if (raw.trim().startsWith('+')) {            // já internacional
    e164 = d;
    national = (ddi && d.startsWith(ddi)) ? d.slice(ddi.length) : d;
  } else if (d.startsWith(ddi)) {              // já tem o DDI colado
    e164 = d; national = d.slice(ddi.length);
  } else if (ddi) {
    national = d.replace(/^0+/, ''); e164 = ddi + national;
  } else {
    return null;                               // sem DDI, não adivinha
  }
  return pareceMovel(national, ddi) ? e164 : null;
}
async function readAttr(locator, attr) {
  try { return await locator.getAttribute(attr, { timeout: FIELD_TIMEOUT }); }
  catch { return null; }
}
async function readText(locator) {
  try { return await locator.textContent({ timeout: FIELD_TIMEOUT }); }
  catch { return null; }
}

// Tenta achar um e-mail no site do negócio (homepage). Sem browser, via fetch.
async function buscarEmail(site) {
  if (!site) return null;
  try {
    const url = site.startsWith('http') ? site : 'https://' + site;
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const html = await r.text();
    // prioriza mailto:, senão procura padrão de e-mail no texto
    const mailto = html.match(/mailto:([^"'?\s>]+@[^"'?\s>]+)/i);
    const achado = mailto?.[1] || html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0];
    if (!achado) return null;
    // descarta lixo comum (imagens, exemplos)
    if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(achado)) return null;
    if (/(example|sentry|wixpress|\.png)/i.test(achado)) return null;
    return achado.toLowerCase();
  } catch { return null; }
}

export async function runScrapeJob({ jobId, termo, cidade, max = 60, ddi = '351' }) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  let novos = 0;

  try {
    const busca = `${termo} em ${cidade}`;
    log(jobId, `abrindo Maps: "${busca}"`);
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(busca)}`,
      { waitUntil: 'domcontentloaded' });

    try {
      await page.getByRole('button', { name: /aceitar|accept|concordo/i }).click({ timeout: 4000 });
    } catch { /* sem banner */ }

    const feedSel = 'div[role="feed"]';
    await page.waitForSelector(feedSel, { timeout: 15000 });

    // --- 1) rolar e coletar os links (não clicamos em nada ainda) ---
    let prevCount = 0, stale = 0, hrefs = [];
    while (hrefs.length < max && stale < 5) {
      hrefs = await page.$$eval(`${feedSel} a[href*="/maps/place/"]`,
        els => [...new Set(els.map(e => e.href))]);
      log(jobId, `${hrefs.length} negócios na lista…`);
      await page.evaluate((sel) => {
        const f = document.querySelector(sel);
        if (f) f.scrollBy(0, f.scrollHeight);
      }, feedSel);
      await page.waitForTimeout(1800);
      if (hrefs.length === prevCount) stale++; else stale = 0;
      prevCount = hrefs.length;
    }

    const lista = hrefs.slice(0, max);
    log(jobId, `extraindo ${lista.length} negócios`);

    // --- 2) visitar cada link e extrair ---
    for (let i = 0; i < lista.length; i++) {
      try {
        await page.goto(lista[i], { waitUntil: 'domcontentloaded' });
        const nome = await page.locator('h1').first().textContent({ timeout: 8000 }).catch(() => null);
        if (!nome) { log(jobId, `${i + 1}/${lista.length} — pulado (não abriu)`); continue; }

        const ratingTxt  = await readText(page.locator('div.F7nice span[aria-hidden="true"]').first());
        const reviewsTxt = await readAttr(
          page.locator('div.F7nice span[aria-label*="avaliações"], div.F7nice span[aria-label*="reviews"]').first(),
          'aria-label');
        const endereco = await readAttr(page.locator('button[data-item-id="address"]'), 'aria-label');
        const telefone = await readAttr(page.locator('button[data-item-id^="phone"]'), 'aria-label');
        const site     = await readAttr(page.locator('a[data-item-id="authority"]'), 'href');

        const maps_url = page.url();
        const maps_id = maps_url.match(/!1s([^!?]+)/)?.[1] || lista[i];
        const telRaw = telefone ? telefone.replace(/^Telefone:\s*/i, '').trim() : null;
        const whatsapp = montarWhatsapp(telRaw, ddi);
        const email = await buscarEmail(site);

        const lead = {
          nome: nome.trim(), nicho: termo, cidade,
          endereco: endereco ? endereco.replace(/^Endereço:\s*/i, '').trim() : null,
          telefone: telRaw, whatsapp,
          avaliacao: ratingTxt ? parseFloat(ratingTxt.replace(',', '.')) : null,
          reviews: reviewsTxt ? parseInt(onlyDigits(reviewsTxt)) || null : null,
          site: site || null, instagram: null, email, maps_url, maps_id, fonte: 'maps'
        };
        const ehNovo = upsertLead(lead);
        if (ehNovo) novos++;
        log(jobId, `${i + 1}/${lista.length} — ${lead.nome}${email ? ' ✉' : ''}${ehNovo ? ' (novo)' : ' (já existia)'}`);
      } catch (e) {
        log(jobId, `${i + 1}/${lista.length} — falhou: ${e.message}`);
      }
    }

    db.prepare(`UPDATE scrape_jobs SET status='concluido', encontrados=?, novos=? WHERE id=?`)
      .run(lista.length, novos, jobId);
    log(jobId, `✓ concluído — ${lista.length} visitados, ${novos} novos no banco`);
  } finally {
    await browser.close();
  }
  return { novos };
}
