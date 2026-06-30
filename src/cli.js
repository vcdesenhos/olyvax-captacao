import { initSchema, db } from './db.js';
import { runScrapeJob } from './scraper/maps.js';
import { enrichPending } from './scraper/enrich.js';

initSchema();
const [, , cmd, ...args] = process.argv;

if (cmd === 'scrape') {
  // node src/cli.js scrape "clinica de odontologia" "Mogi Guaçu" 60
  const [termo, cidade, max] = args;
  if (!termo || !cidade) {
    console.error('uso: npm run scrape -- "<termo>" "<cidade>" [max]');
    process.exit(1);
  }
  const job = db.prepare(`INSERT INTO scrape_jobs (termo,cidade,status) VALUES (?,?,'rodando')`)
    .run(termo, cidade);
  await runScrapeJob({ jobId: job.lastInsertRowid, termo, cidade, max: Number(max) || 60 });
  process.exit(0);
} else if (cmd === 'enrich') {
  // node src/cli.js enrich 50
  await enrichPending(Number(args[0]) || 20);
  process.exit(0);
} else {
  console.log('comandos: scrape | enrich');
  process.exit(0);
}
