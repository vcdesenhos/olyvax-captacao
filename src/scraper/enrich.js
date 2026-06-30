import { db } from '../db.js';

/**
 * Turbinar (enriquecimento) dos leads:
 *  - site: confirma se a URL responde
 *  - email: busca PROFUNDA — homepage + páginas de contato comuns
 *  - instagram: extraído APENAS de links reais no site (sem chutar pelo nome)
 *  - meta_ads: consulta a Meta Ad Library
 *
 * Tudo via fetch nativo do Node (>=18). Sem dependências extras.
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PALAVRAS_RESERVADAS_IG = new Set(['p','explore','accounts','about','developer','legal',
  'directory','reels','reel','stories','tv','web','sharer','privacy','help','press']);

async function baixar(url) {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow',
      signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
}

function extrairEmails(html, hostSite) {
  const achados = new Set();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+@[^"'?\s>]+)/gi)) achados.add(m[1]);
  for (const m of html.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)) achados.add(m[0]);
  const limpos = [...achados]
    .map(e => e.toLowerCase().trim())
    .filter(e => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e))
    .filter(e => !/(example|sentry|wixpress|godaddy|\.wix|placeholder|your-?email|seu-?email|@2x|domain\.com)/i.test(e));
  if (!limpos.length) return null;
  // prefere e-mail do mesmo domínio do site
  if (hostSite) {
    const base = hostSite.replace(/^www\./, '');
    const mesmo = limpos.find(e => e.split('@')[1]?.includes(base));
    if (mesmo) return mesmo;
  }
  return limpos[0];
}

function extrairInstagram(html) {
  for (const m of html.matchAll(/instagram\.com\/([A-Za-z0-9_.]+)/gi)) {
    const h = m[1].replace(/\/$/, '');
    if (h && !PALAVRAS_RESERVADAS_IG.has(h.toLowerCase()) && h.length >= 2 && h.length <= 30)
      return '@' + h;
  }
  return null;
}

// Análise profunda do site: homepage + páginas de contato comuns.
async function analisarSite(url) {
  if (!url) return { vivo: false, email: null, instagram: null };
  const base = url.startsWith('http') ? url : 'https://' + url;
  let host = ''; try { host = new URL(base).host; } catch {}
  const home = await baixar(base);
  if (home === null) return { vivo: false, email: null, instagram: null };

  let email = extrairEmails(home, host);
  let instagram = extrairInstagram(home);

  // se não achou e-mail na home, tenta páginas de contato
  if (!email) {
    const origem = base.replace(/\/+$/, '');
    for (const p of ['/contato', '/contatos', '/contacto', '/contactos', '/contact', '/fale-conosco']) {
      const html = await baixar(origem + p);
      if (html) { email = extrairEmails(html, host); if (!instagram) instagram = extrairInstagram(html); }
      if (email) break;
    }
  }
  return { vivo: true, email, instagram };
}

async function rodaMetaAds(nome) {
  try {
    const url = `https://www.facebook.com/ads/library/async/search_ads/` +
      `?q=${encodeURIComponent(nome)}&active_status=active&ad_type=all&country=BR&media_type=all`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    const txt = await r.text();
    return /"totalCount":\s*([1-9]\d*)/.test(txt) || /ad_archive_id/.test(txt);
  } catch { return false; }
}

export async function enrichPending(limit = 20) {
  const leads = db.prepare('SELECT * FROM leads WHERE enriquecido = 0 ORDER BY id LIMIT ?').all(limit);
  console.log(`[turbinar] processando ${leads.length} leads`);

  // instagram é SOBRESCRITO pelo que achamos no site (mais confiável que o valor antigo)
  const upd = db.prepare(`
    UPDATE leads SET site = COALESCE(@site, site),
                     instagram = @instagram,
                     email = COALESCE(@email, email),
                     meta_ads = @meta_ads,
                     enriquecido = 1,
                     atualizado_em = datetime('now')
    WHERE id = @id`);

  for (const l of leads) {
    const { vivo, email, instagram } = await analisarSite(l.site);
    const ads = await rodaMetaAds(l.nome);
    upd.run({
      id: l.id,
      site: vivo ? (l.site || null) : null,
      instagram: instagram || null,    // só Instagram real do site; senão fica vazio
      email: l.email || email,
      meta_ads: ads ? 1 : 0
    });
    console.log(`[turbinar] ${l.nome} — site:${vivo} ig:${instagram || '—'} email:${l.email || email || '—'} ads:${ads}`);
    await sleep(1000);
  }
  console.log('[turbinar] concluído');
}
