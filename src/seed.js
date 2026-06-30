import { initSchema, db } from './db.js';

initSchema();
db.prepare('DELETE FROM leads').run();

const nichos = ['clinica de odontologia', 'clinica de estetica', 'pet shop', 'salao de beleza'];
const cidades = ['Mogi Guaçu, SP', 'Mogi Mirim, SP', 'Campinas, SP'];
const ruas = ['Rua Santa Júlia', 'Av. Londrina', 'R. Cláudio Manoel da Costa', 'R. João Rodrigues',
  'Av. Lotário Teixeira', 'R. Henrique Orrin', 'R. Cel. João Franco de Godoy', 'Av. Mogi Mirim',
  'Av. Carlos Braga de Faria', 'R. Treze de Maio', 'R. Apolinário', 'R. Pres. John F Kennedy'];
const sufixos = ['Odontologia', 'Clínica Odontológica', 'Implantes', 'Ortodontia', 'Odonto Premium',
  'Centro Odontológico', 'Dental Care', 'Sorriso', 'Reabilitação Oral'];
const nomes = ['Vita', 'Fisiodonto', 'Seri', 'Marcely Tauany', 'A F', 'Penteado', 'Gerlin',
  'Oral Unic', "Ben'to Blanc", 'Dentistas', 'Odonto Medic', 'Fernando Noronha Jr.', 'Julia Anselmo',
  'Bella', 'Prime', 'Sorridents', 'OdontoExcellence', 'Clínica Norte', 'Saúde Bucal', 'Odonto Vida'];
const status = ['Identificado', 'Identificado', 'Identificado', 'Abordado', 'Respondeu', 'Convertido', 'Frio'];

const ins = db.prepare(`
  INSERT INTO leads (nome,nicho,cidade,endereco,telefone,whatsapp,avaliacao,reviews,
                     site,instagram,meta_ads,status,no_pipeline,acao_em,proxima_acao,enriquecido,maps_id,fonte)
  VALUES (@nome,@nicho,@cidade,@endereco,@telefone,@whatsapp,@avaliacao,@reviews,
          @site,@instagram,@meta_ads,@status,@no_pipeline,@acao_em,@proxima_acao,@enriquecido,@maps_id,@fonte)`);

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

function inserirLote(n) {
  for (let i = 0; i < n; i++) {
    const base = rnd(nomes);
    const nome = `${base} ${rnd(sufixos)}`;
    const st = rnd(status);
    const temSite = chance(0.55);
    const tel = chance(0.5) ? `(19) 9${Math.floor(8000 + Math.random() * 1999)}-${Math.floor(1000 + Math.random() * 8999)}` : null;
    const followUp = st !== 'Identificado' && chance(0.4);
    ins.run({
      nome,
      nicho: rnd(nichos),
      cidade: rnd(cidades),
      endereco: `${rnd(ruas)}, ${Math.floor(50 + Math.random() * 900)} - Centro`,
      telefone: tel,
      whatsapp: tel ? '5519' + tel.replace(/\D/g, '').slice(2) : null,
      avaliacao: chance(0.6) ? Number((4 + Math.random()).toFixed(1)) : null,
      reviews: chance(0.6) ? Math.floor(Math.random() * 400) : null,
      site: temSite ? `https://${base.toLowerCase().replace(/[^a-z]/g, '')}.com.br` : null,
      instagram: chance(0.35) ? `@${base.toLowerCase().replace(/[^a-z]/g, '')}` : null,
      meta_ads: chance(0.25) ? 1 : 0,
      status: st,
      no_pipeline: ['Abordado', 'Respondeu', 'Convertido'].includes(st) ? 1 : 0,
      acao_em: followUp ? new Date(Date.now() + (Math.random() * 5 - 2) * 864e5).toISOString().slice(0, 10) : null,
      proxima_acao: followUp ? rnd(['Ligar', 'Mandar proposta', 'Cobrar retorno', 'Enviar portfólio']) : null,
      enriquecido: chance(0.4) ? 1 : 0,
      maps_id: `seed_${i}`,
      fonte: 'seed'
    });
  }
}

db.exec('BEGIN');
inserirLote(240);
db.exec('COMMIT');
const c = db.prepare('SELECT COUNT(*) c FROM leads').get().c;
console.log(`seed ok — ${c} leads inseridos`);
