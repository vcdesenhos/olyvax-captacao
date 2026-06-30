import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'prospec.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nome          TEXT NOT NULL,
      nicho         TEXT,
      cidade        TEXT,
      endereco      TEXT,
      telefone      TEXT,
      whatsapp      TEXT,            -- número E.164 só dígitos, ou NULL
      avaliacao     REAL,            -- nota Google (0-5) ou NULL
      reviews       INTEGER,         -- qtd de avaliações
      site          TEXT,            -- URL ou NULL
      instagram     TEXT,            -- @handle/URL ou NULL
      email         TEXT,            -- e-mail encontrado no site, ou NULL
      maps_url      TEXT,            -- link direto do negócio no Google Maps
      meta_ads      INTEGER DEFAULT 0,   -- 0/1: roda anúncios na Meta
      status        TEXT DEFAULT 'Identificado',
                    -- Identificado | Abordado | Respondeu | Convertido | Frio
      proxima_acao  TEXT,            -- texto livre
      acao_em       TEXT,            -- data ISO da próxima ação (follow-up)
      no_pipeline   INTEGER DEFAULT 0,
      maps_id       TEXT UNIQUE,     -- chave de dedupe do scraper
      fonte         TEXT DEFAULT 'manual',
      enriquecido   INTEGER DEFAULT 0,
      criado_em     TEXT DEFAULT (datetime('now')),
      atualizado_em TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_leads_nicho   ON leads(nicho);
    CREATE INDEX IF NOT EXISTS idx_leads_cidade  ON leads(cidade);
    CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status);

    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      termo       TEXT,
      cidade      TEXT,
      status      TEXT DEFAULT 'pendente',  -- pendente | rodando | concluido | erro
      encontrados INTEGER DEFAULT 0,
      novos       INTEGER DEFAULT 0,
      log         TEXT,
      criado_em   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      dia   TEXT PRIMARY KEY,   -- YYYY-MM-DD
      total INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );
    CREATE TABLE IF NOT EXISTS descartes (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nome      TEXT,
      motivo    TEXT,
      criado_em TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tarefas (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo    TEXT NOT NULL,
      lead      TEXT,                       -- nome do lead associado (opcional)
      lead_id   INTEGER,                    -- id do lead (opcional)
      vence_em  TEXT,                       -- data ISO YYYY-MM-DD
      feito     INTEGER DEFAULT 0,
      criado_em TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migração leve: colunas novas em bancos já existentes (ignora se já existe).
  for (const col of ['email TEXT', 'maps_url TEXT', 'descricao TEXT']) {
    try { db.exec(`ALTER TABLE leads ADD COLUMN ${col}`); } catch { /* já existe */ }
  }
}

// Garante o schema antes de qualquer prepared statement de nível de módulo.
initSchema();

// ---- Upsert vindo do scraper (dedupe por maps_id) ----
const insertStmt = db.prepare(`
  INSERT INTO leads (nome, nicho, cidade, endereco, telefone, whatsapp,
                     avaliacao, reviews, site, instagram, email, maps_url, maps_id, fonte)
  VALUES (@nome, @nicho, @cidade, @endereco, @telefone, @whatsapp,
          @avaliacao, @reviews, @site, @instagram, @email, @maps_url, @maps_id, @fonte)
  ON CONFLICT(maps_id) DO UPDATE SET
    telefone  = COALESCE(excluded.telefone, leads.telefone),
    avaliacao = COALESCE(excluded.avaliacao, leads.avaliacao),
    reviews   = COALESCE(excluded.reviews, leads.reviews),
    site      = COALESCE(excluded.site, leads.site),
    email     = COALESCE(excluded.email, leads.email),
    maps_url  = COALESCE(excluded.maps_url, leads.maps_url),
    atualizado_em = datetime('now')
`);

export function upsertLead(lead) {
  const before = db.prepare('SELECT COUNT(*) c FROM leads WHERE maps_id = ?').get(lead.maps_id)?.c || 0;
  insertStmt.run({
    nome: lead.nome, nicho: lead.nicho ?? null, cidade: lead.cidade ?? null,
    endereco: lead.endereco ?? null, telefone: lead.telefone ?? null,
    whatsapp: lead.whatsapp ?? null, avaliacao: lead.avaliacao ?? null,
    reviews: lead.reviews ?? null, site: lead.site ?? null,
    instagram: lead.instagram ?? null, email: lead.email ?? null,
    maps_url: lead.maps_url ?? null, maps_id: lead.maps_id,
    fonte: lead.fonte ?? 'scraper'
  });
  return before === 0; // true = novo
}

// ---- Filtros das abas do dashboard ----
const TAB_WHERE = {
  todos: '1=1',
  sem_site: "(site IS NULL OR site = '')",
  com_site: "(site IS NOT NULL AND site != '')",
  abordados: "status IN ('Abordado','Respondeu','Convertido')",
  responderam: "status = 'Respondeu'",
  convertidos: "status = 'Convertido'",
  follow_up: "acao_em IS NOT NULL AND date(acao_em) <= date('now','+3 day')",
  frio: "status = 'Frio'",
  com_ig: "(instagram IS NOT NULL AND instagram != '')",
  sem_ig: "(instagram IS NULL OR instagram = '')",
  ads: 'meta_ads = 1',
  sem_ads: 'meta_ads = 0',
  com_whatsapp: "(whatsapp IS NOT NULL AND whatsapp != '')",
  pipeline: 'no_pipeline = 1'
};

// ---- Opportunity Score (0-100): o quão "vale a pena" abordar este lead ----
// Lógica transparente: sem site = grande oportunidade; ter WhatsApp/e-mail = fácil
// de alcançar; rodar anúncios = investe em marketing; bem avaliado = negócio real.
export const SCORE_SQL = `CAST(MIN(100, MAX(0,
    40
    + (CASE WHEN site IS NULL OR site = '' THEN 25 ELSE 0 END)
    + (CASE WHEN whatsapp IS NOT NULL AND whatsapp != '' THEN 12 ELSE 0 END)
    + (CASE WHEN email IS NOT NULL AND email != '' THEN 6 ELSE 0 END)
    + (CASE WHEN meta_ads = 1 THEN 8 ELSE 0 END)
    + (CASE WHEN instagram IS NOT NULL AND instagram != '' THEN 4 ELSE 0 END)
    + (CASE WHEN avaliacao >= 4.5 AND reviews >= 20 THEN 5 ELSE 0 END)
    + (CASE WHEN status = 'Respondeu' THEN 10 ELSE 0 END)
    + (CASE WHEN status = 'Convertido' THEN -25 ELSE 0 END)
    + (CASE WHEN status = 'Frio' THEN -15 ELSE 0 END)
  )) AS INTEGER)`;

export function queryLeads({ tab = 'todos', nicho, cidade, status, q, limit = 50, offset = 0 }) {
  const where = [TAB_WHERE[tab] || '1=1'];
  const params = {};
  if (nicho)  { where.push('nicho = @nicho'); params.nicho = nicho; }
  if (cidade) { where.push('cidade = @cidade'); params.cidade = cidade; }
  if (status) { where.push('status = @status'); params.status = status; }
  if (q) {
    where.push('(nome LIKE @q OR nicho LIKE @q OR telefone LIKE @q OR endereco LIKE @q OR email LIKE @q OR instagram LIKE @q)');
    params.q = `%${q}%`;
  }
  const clause = where.join(' AND ');
  const rows = db.prepare(
    `SELECT *, ${SCORE_SQL} AS score FROM leads WHERE ${clause}
     ORDER BY score DESC, (avaliacao IS NULL), avaliacao DESC, id LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) c FROM leads WHERE ${clause}`).get(params).c;
  return { rows, total };
}

// Público de uma campanha: leads do segmento que TÊM telefone/WhatsApp.
// (o filtro fino de "é celular" é feito no front, que já conhece a regra por país)
export function campaignAudience({ tab = 'todos', nicho, cidade, soNaoAbordados } = {}) {
  const where = [TAB_WHERE[tab] || '1=1', "whatsapp IS NOT NULL AND whatsapp != ''"];
  const params = {};
  if (nicho)  { where.push('nicho = @nicho'); params.nicho = nicho; }
  if (cidade) { where.push('cidade = @cidade'); params.cidade = cidade; }
  if (soNaoAbordados) where.push("status = 'Identificado'");
  return db.prepare(
    `SELECT id, nome, nicho, cidade, whatsapp, status, ${SCORE_SQL} AS score
     FROM leads WHERE ${where.join(' AND ')} ORDER BY score DESC LIMIT 1000`
  ).all(params);
}

export function stats() {
  const one = (sql) => db.prepare(sql).get().c;
  const total = one('SELECT COUNT(*) c FROM leads');
  // baseline do dia: grava o total no primeiro acesso de hoje; "novos hoje" = total atual - baseline
  db.prepare("INSERT OR IGNORE INTO snapshots (dia, total) VALUES (date('now'), ?)").run(total);
  const base = db.prepare("SELECT total FROM snapshots WHERE dia = date('now')").get()?.total ?? total;
  return {
    total,
    novos_hoje:  Math.max(0, total - base),
    sem_site:    one(`SELECT COUNT(*) c FROM leads WHERE site IS NULL OR site = ''`),
    com_ig:      one(`SELECT COUNT(*) c FROM leads WHERE instagram IS NOT NULL AND instagram != ''`),
    meta_ads:    one('SELECT COUNT(*) c FROM leads WHERE meta_ads = 1'),
    abordados:   one(`SELECT COUNT(*) c FROM leads WHERE status IN ('Abordado','Respondeu','Convertido')`),
    pipeline:    one('SELECT COUNT(*) c FROM leads WHERE no_pipeline = 1'),
    follow_up:   one(`SELECT COUNT(*) c FROM leads WHERE acao_em IS NOT NULL AND date(acao_em) <= date('now','+3 day')`),
    enriquecidos:one('SELECT COUNT(*) c FROM leads WHERE enriquecido = 1'),
    responderam: one(`SELECT COUNT(*) c FROM leads WHERE status = 'Respondeu'`),
    convertidos: one(`SELECT COUNT(*) c FROM leads WHERE status = 'Convertido'`),
    pendentes_enriquecimento: one('SELECT COUNT(*) c FROM leads WHERE enriquecido = 0'),
    com_whatsapp: one(`SELECT COUNT(*) c FROM leads WHERE whatsapp IS NOT NULL AND whatsapp != ''`),
    alta_prioridade: one(`SELECT COUNT(*) c FROM (SELECT ${SCORE_SQL} AS score FROM leads) WHERE score >= 80`)
  };
}

export function updateLead(id, fields) {
  const allowed = ['nome', 'nicho', 'cidade', 'endereco', 'status', 'proxima_acao',
                   'acao_em', 'no_pipeline', 'site', 'instagram', 'email',
                   'meta_ads', 'telefone', 'whatsapp', 'descricao'];
  const sets = [], params = { id };
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = @${k}`); params[k] = fields[k]; }
  }
  if (!sets.length) return;
  sets.push("atualizado_em = datetime('now')");
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

export function deleteLead(id, motivo) {
  const l = db.prepare('SELECT nome FROM leads WHERE id = ?').get(id);
  if (!l) return false;
  db.prepare('INSERT INTO descartes (nome, motivo) VALUES (?, ?)').run(l.nome, motivo || 'não informado');
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  return true;
}

// Marca leads (que têm site) como não-enriquecidos, para o Turbinar reprocessar
// e corrigir Instagram/e-mail antigos. Retorna quantos foram marcados.
export function resetEnriquecimento() {
  const r = db.prepare("UPDATE leads SET enriquecido = 0 WHERE site IS NOT NULL AND site != ''").run();
  return r.changes;
}

// ---- Tarefas ----
export function listTarefas({ feito } = {}) {
  let sql = 'SELECT * FROM tarefas';
  if (feito === '0' || feito === 0) sql += ' WHERE feito = 0';
  else if (feito === '1' || feito === 1) sql += ' WHERE feito = 1';
  sql += " ORDER BY feito, (vence_em IS NULL), vence_em, id DESC";
  return db.prepare(sql).all();
}
export function createTarefa(d) {
  const r = db.prepare('INSERT INTO tarefas (titulo, lead, lead_id, vence_em) VALUES (@titulo,@lead,@lead_id,@vence_em)')
    .run({ titulo: d.titulo, lead: d.lead ?? null, lead_id: d.lead_id ?? null, vence_em: d.vence_em ?? null });
  return db.prepare('SELECT * FROM tarefas WHERE id = ?').get(r.lastInsertRowid);
}
export function updateTarefa(id, fields) {
  const allowed = ['titulo', 'lead', 'vence_em', 'feito'];
  const sets = [], params = { id };
  for (const k of allowed) if (k in fields) { sets.push(`${k} = @${k}`); params[k] = fields[k]; }
  if (!sets.length) return;
  db.prepare(`UPDATE tarefas SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id);
}
export function deleteTarefa(id) { db.prepare('DELETE FROM tarefas WHERE id = ?').run(id); return true; }

export function createLead(d) {
  const r = db.prepare(`
    INSERT INTO leads (nome, nicho, cidade, endereco, telefone, whatsapp, site, instagram, email, descricao, fonte)
    VALUES (@nome,@nicho,@cidade,@endereco,@telefone,@whatsapp,@site,@instagram,@email,@descricao,'manual')`)
    .run({
      nome: d.nome, nicho: d.nicho ?? null, cidade: d.cidade ?? null,
      endereco: d.endereco ?? null, telefone: d.telefone ?? null,
      whatsapp: d.whatsapp ?? null,
      site: d.site ?? null, instagram: d.instagram ?? null, email: d.email ?? null,
      descricao: d.descricao ?? null
    });
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid);
}

export function getSettings() {
  const o = {};
  db.prepare('SELECT chave, valor FROM settings').all().forEach(r => (o[r.chave] = r.valor));
  return o;
}
export function setSettings(obj) {
  const up = db.prepare('INSERT INTO settings (chave, valor) VALUES (@c, @v) ON CONFLICT(chave) DO UPDATE SET valor = @v');
  for (const [c, v] of Object.entries(obj || {})) up.run({ c, v: v == null ? '' : String(v) });
  return getSettings();
}

export function distinct(col) {
  if (!['nicho', 'cidade'].includes(col)) return [];
  return db.prepare(`SELECT DISTINCT ${col} v FROM leads WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`)
           .all().map(r => r.v);
}
