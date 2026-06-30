import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  initSchema, queryLeads, stats, updateLead, distinct, createLead,
  getSettings, setSettings, campaignAudience, deleteLead,
  resetEnriquecimento, listTarefas, createTarefa, updateTarefa, deleteTarefa, db
} from './db.js';
import { runScrapeJob } from './scraper/maps.js';
import { enrichPending } from './scraper/enrich.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

initSchema();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

// --- Leitura ---
app.get('/api/stats', (_req, res) => res.json(stats()));

// Sugestões do copiloto (OWLIX): geradas a partir dos dados reais do banco.
app.get('/api/suggestions', (_req, res) => {
  const s = stats();
  const one = (sql) => db.prepare(sql).get().c;
  const respondeu = one(`SELECT COUNT(*) c FROM leads WHERE status = 'Respondeu'`);
  const novosHoje = one(`SELECT COUNT(*) c FROM leads WHERE date(criado_em) = date('now')`);
  const waProspect = one(`SELECT COUNT(*) c FROM leads WHERE whatsapp IS NOT NULL AND whatsapp != '' AND status = 'Identificado'`);

  const sug = [];
  if (s.sem_site)   sug.push({ icon: 'search', text: `Encontrei ${s.sem_site} ${s.sem_site === 1 ? 'negócio' : 'negócios'} sem site na sua base.`, count: s.sem_site, actionLabel: 'Ver oportunidades', action: 'tab:sem_site' });
  if (s.meta_ads)   sug.push({ icon: 'chart',  text: `${s.meta_ads} ${s.meta_ads === 1 ? 'empresa está' : 'empresas estão'} rodando anúncios no Meta Ads.`, count: s.meta_ads, actionLabel: 'Ver detalhes', action: 'tab:ads' });
  if (respondeu)    sug.push({ icon: 'chat',   text: `${respondeu} ${respondeu === 1 ? 'empresa respondeu' : 'empresas responderam'} — vale um follow-up.`, count: respondeu, actionLabel: 'Ver conversas', action: 'tab:responderam' });
  if (s.follow_up)  sug.push({ icon: 'clock',  text: `${s.follow_up} follow-up(s) pendentes ou atrasados.`, count: s.follow_up, actionLabel: 'Ver follow-ups', action: 'tab:follow_up' });
  if (s.total - s.enriquecidos > 0) {
    const pend = s.total - s.enriquecidos;
    sug.push({ icon: 'sparkle', text: `${pend} leads podem ser enriquecidos com novas informações.`, count: pend, actionLabel: 'Enriquecer agora', action: 'enrich' });
  }
  if (novosHoje)    sug.push({ icon: 'plus',   text: `${novosHoje} ${novosHoje === 1 ? 'novo lead adicionado' : 'novos leads adicionados'} hoje.`, count: novosHoje, actionLabel: 'Ver recentes', action: 'tab:todos' });
  if (waProspect)   sug.push({ icon: 'whatsapp', text: `Posso iniciar uma campanha de WhatsApp para ${waProspect} contatos?`, count: waProspect, actionLabel: 'Em breve', action: 'soon' });

  if (!sug.length) sug.push({ icon: 'search', text: 'Tudo tranquilo por aqui. Que tal um novo scraping para encontrar leads?', actionLabel: 'Abrir Scraper', action: 'scrape' });
  res.json(sug);
});

app.get('/api/leads', (req, res) => {
  const { tab, nicho, cidade, status, q } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  res.json(queryLeads({ tab, nicho, cidade, status, q, limit, offset }));
});

app.delete('/api/leads/:id', (req, res) => {
  const ok = deleteLead(Number(req.params.id), req.body?.motivo);
  if (!ok) return res.status(404).json({ erro: 'lead não encontrado' });
  res.json({ ok: true });
});

app.get('/api/filters', (_req, res) =>
  res.json({ nichos: distinct('nicho'), cidades: distinct('cidade') }));

app.get('/api/settings', (_req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => res.json(setSettings(req.body)));

app.get('/api/campaign', (req, res) => {
  const { tab, nicho, cidade } = req.query;
  res.json(campaignAudience({ tab, nicho, cidade, soNaoAbordados: req.query.novos === '1' }));
});

// ---- Tarefas ----
app.get('/api/tarefas', (req, res) => res.json(listTarefas({ feito: req.query.feito })));
app.post('/api/tarefas', (req, res) => {
  if (!req.body?.titulo) return res.status(400).json({ erro: 'título obrigatório' });
  res.status(201).json(createTarefa(req.body));
});
app.patch('/api/tarefas/:id', (req, res) => res.json(updateTarefa(Number(req.params.id), req.body)));
app.delete('/api/tarefas/:id', (req, res) => { deleteTarefa(Number(req.params.id)); res.json({ ok: true }); });

app.get('/api/leads/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(req.params.id));
  if (!lead) return res.status(404).json({ erro: 'lead não encontrado' });
  res.json(lead);
});

// --- Escrita ---
app.post('/api/leads', (req, res) => {
  if (!req.body?.nome) return res.status(400).json({ erro: 'nome é obrigatório' });
  res.status(201).json(createLead(req.body));
});

app.patch('/api/leads/:id', (req, res) => {
  const lead = updateLead(Number(req.params.id), req.body);
  if (!lead) return res.status(404).json({ erro: 'lead não encontrado' });
  res.json(lead);
});

// Atalho: mandar pro pipeline
app.post('/api/leads/:id/pipeline', (req, res) => {
  const lead = updateLead(Number(req.params.id), { no_pipeline: 1, status: 'Abordado' });
  res.json(lead);
});

// --- Scraper (assíncrono, com job) ---
app.post('/api/scrape', async (req, res) => {
  const { termo, cidade, max, ddi } = req.body;
  if (!termo || !cidade) return res.status(400).json({ erro: 'informe termo e cidade' });
  const job = db.prepare(
    `INSERT INTO scrape_jobs (termo, cidade, status) VALUES (?, ?, 'rodando')`
  ).run(termo, cidade);
  const jobId = job.lastInsertRowid;
  res.status(202).json({ jobId, status: 'rodando' });
  // roda em background; o front consulta o status
  runScrapeJob({ jobId, termo, cidade, max: max || 60, ddi: (ddi || '351').replace(/\D/g, '') }).catch(err => {
    db.prepare(`UPDATE scrape_jobs SET status='erro', log=? WHERE id=?`)
      .run(String(err?.message || err), jobId);
  });
});

app.get('/api/scrape/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM scrape_jobs WHERE id = ?').get(Number(req.params.id));
  if (!job) return res.status(404).json({ erro: 'job não encontrado' });
  res.json(job);
});

// --- Enriquecimento (checa site/IG/Meta Ads em lote) ---
app.post('/api/enrich', async (req, res) => {
  const limit = Math.min(parseInt(req.body?.limit) || 20, 100);
  res.status(202).json({ status: 'rodando', limit });
  enrichPending(limit).catch(e => console.error('enrich erro:', e));
});

// Reprocessa: marca quem tem site como não-enriquecido e roda o Turbinar em todos (background)
app.post('/api/enrich/reset', async (_req, res) => {
  const n = resetEnriquecimento();
  res.status(202).json({ reprocessando: n });
  enrichPending(100000).catch(e => console.error('reprocess erro:', e));
});

app.listen(PORT, () =>
  console.log(`\n  PROSPECÇÃO rodando em http://localhost:${PORT}\n`));
