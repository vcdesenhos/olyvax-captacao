const $ = (s, el = document) => el.querySelector(s);
const api = (url, opts) => fetch(url, opts).then(r => r.json());

/* ===== Personalização (defaults; sobrescritos pelas Configurações salvas) ===== */
const USUARIO = 'Victor';
const COPILOTO = 'Owlix';
const TICKET_MEDIO = 350;   // € — usado só para a estimativa de potencial

let SET = {};                                   // configurações salvas (Configurações)
const nomeUsuario = () => (SET.nome && SET.nome.trim()) || USUARIO;
const ticketMedio = () => Number(SET.ticket) || TICKET_MEDIO;
function aplicarIdentidade() {
  const nome = nomeUsuario();
  const h1 = document.querySelector('.greeting h1');
  if (h1) h1.childNodes[0].textContent = `Olá, ${nome}! `;
  const av = document.querySelector('.avatar');
  if (av) { av.textContent = nome.trim().charAt(0).toUpperCase(); av.title = nome; }
}
async function loadSettings() {
  try { SET = await api('/api/settings') || {}; } catch { SET = {}; }
  aplicarIdentidade();
  // popula o formulário
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v ?? ''; };
  set('set_nome', SET.nome); set('set_empresa', SET.empresa);
  set('set_nicho', SET.nicho); set('set_cidade', SET.cidade); set('set_ddi', SET.ddi);
  set('set_ticket', SET.ticket); set('set_wamsg', SET.wamsg);
}

const state = { tab: 'todos', nicho: '', cidade: '', status: '', q: '', offset: 0, limit: 50, total: 0, stats: {}, prev: {} };

let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600); }
function esc(s) { return String(s ?? '').replace(/[<>&"]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[m])); }
const pct = (n, d) => d ? Math.round(n / d * 100) : 0;

/* ===================== KPIs ===================== */
function sparkline(seed, color) {
  let s = seed * 97 + 13; const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const n = 16, w = 120, h = 30, pts = []; let v = 0.5;
  for (let i = 0; i < n; i++) { v += (rnd() - 0.4) * 0.22; v = Math.max(0.12, Math.min(0.9, v)); pts.push([(i/(n-1))*w, h - v*h]); }
  const line = pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  const area = `M0 ${h} `+pts.map(p=>'L'+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ')+` L${w} ${h} Z`;
  const g='g'+seed;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#${g})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

const HERO = [
  { key:'total',        filtro:'todos',        label:'Leads Encontrados', ic:'◴', tint:'t-cyan',  color:'var(--cyan)',  sub:s=>s.novos_hoje?`<span class="up">↑ +${s.novos_hoje} hoje</span>`:'no banco' },
  { key:'sem_site',     filtro:'sem_site',     label:'Sem Website',       ic:'◍', tint:'t-amber', color:'var(--amber)', sub:s=>`${pct(s.sem_site,s.total)}% do total · oportunidade` },
  { key:'com_whatsapp', filtro:'com_whatsapp', label:'Com WhatsApp',      ic:'✆', tint:'t-green', color:'var(--green)', sub:s=>`${pct(s.com_whatsapp,s.total)}% alcançáveis` },
];
const MINI = [
  { key:'com_ig',    filtro:'com_ig',    label:'Com Instagram', color:'var(--pink)',  sub:s=>`${pct(s.com_ig,s.total)}%` },
  { key:'meta_ads',  filtro:'ads',       label:'Rodam Ads',     color:'var(--blue)',  sub:s=>`${pct(s.meta_ads,s.total)}%` },
  { key:'abordados', filtro:'abordados', label:'Abordados',     color:'var(--cyan)',  sub:()=>'do banco' },
  { key:'pipeline',  filtro:'pipeline',  label:'No Pipeline',   color:'var(--green)', sub:()=>'negociação' },
  { key:'follow_up', filtro:'follow_up', label:'Follow-up',     color:'var(--red)',   sub:()=>'pendentes' },
];

function glowIf(key) {
  const before = state.prev[key]; const now = state.stats[key];
  return (before !== undefined && now > before) ? ' glow' : '';
}

function renderKpis(s) {
  $('#kpiHero').innerHTML = HERO.map((c,i)=>`
    <div class="card hero clik${glowIf(c.key)}" data-filter="${c.filtro}">
      <div class="top"><span class="label">${c.label}</span><span class="ic ${c.tint}">${c.ic}</span></div>
      <div class="num" style="color:${c.color}">${(s[c.key]??0).toLocaleString('pt-BR')}</div>
      <div class="sub">${c.sub(s)}</div>
      ${sparkline(i+1,c.color)}
    </div>`).join('');
  $('#kpiMini').innerHTML = MINI.map(c=>`
    <div class="card mini clik${glowIf(c.key)}" data-filter="${c.filtro}">
      <div class="label">${c.label}</div>
      <div class="num" style="color:${c.color}">${(s[c.key]??0).toLocaleString('pt-BR')}</div>
      <div class="sub">${c.sub(s)}</div>
    </div>`).join('');
}

function renderWow(s) {
  const alta = s.alta_prioridade || 0;
  const tk = ticketMedio();
  const potencial = (alta * tk).toLocaleString('pt-BR');
  $('#wow').innerHTML = `
    <div>
      <div class="wow-main"><b>${alta}</b> leads de alta prioridade prontos pra abordar</div>
      <div class="wow-sub">Potencial estimado <b style="color:var(--brand)">€${potencial}</b> · estimativa com ticket médio de €${tk} (ajustável em Configurações)</div>
    </div>
    <div class="wow-spacer"></div>
    <button class="wow-cta" data-jump="todos" id="wowCta">Ver prioritários →</button>`;
}

/* ===================== Filtros / tabela ===================== */
async function loadStats() {
  const s = await api('/api/stats');
  state.prev = state.stats || {}; state.stats = s;
  renderKpis(s); renderWow(s); renderCopilot(s);
}
async function loadFilters() {
  const f = await api('/api/filters');
  $('#fNicho').innerHTML = '<option value="">Todos os nichos</option>' + f.nichos.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');
  $('#fCidade').innerHTML = '<option value="">Todas as cidades</option>' + f.cidades.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function mapsLink(l){ if(l.maps_url) return esc(l.maps_url); const a=[l.endereco,l.cidade].filter(Boolean).join(' '); return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(a||l.nome); }
function igLink(ig){ if(!ig) return null; return /^https?:\/\//i.test(ig)?esc(ig):'https://instagram.com/'+esc(ig.replace(/^@/,'')); }
function siteCell(l){ return l.site?`<a class="tag-link" href="${esc(l.site)}" target="_blank" rel="noopener">↗ ver</a>`:`<span class="tag warn">sem site</span>`; }
function digitalCell(l){
  const ig = l.instagram?`<a class="ig-ok" href="${igLink(l.instagram)}" target="_blank" rel="noopener">▣ ${esc(l.instagram)}</a>`:`<span>sem IG</span>`;
  return `<div class="digital">${ig} ${l.meta_ads?'<span class="ads">◉ Ads</span>':'<span>sem ads</span>'}</div>`;
}
// Só considera WhatsApp se o número parecer celular (cobre leads já no banco):
//  351 (PT) → nacional começa com 9 · 55 (BR) → 11 dígitos · outros → aceita
function waValido(wa){
  if(!wa) return false;
  const d=String(wa).replace(/\D/g,'');
  if(d.startsWith('351')) return d.slice(3).startsWith('9');
  if(d.startsWith('55'))  return d.slice(2).length===11;
  return true;
}
function contatoCell(l){
  const L=[]; const wa = waValido(l.whatsapp) ? l.whatsapp : null;
  if(l.telefone){let r=`<span class="tel">☎ ${esc(l.telefone)}</span>`; if(wa) r+=`<a class="wa-link" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>`; L.push(`<div class="tel-row">${r}</div>`);}
  else if(wa) L.push(`<a class="pill wa" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">✆ WhatsApp</a>`);
  if(l.email) L.push(`<a class="email-link" href="mailto:${esc(l.email)}">✉ ${esc(l.email)}</a>`);
  return L.length?`<div class="contato">${L.join('')}</div>`:`<span class="dash">—</span>`;
}
function ratingCell(l){ return l.avaliacao==null?`<span class="dash">—</span>`:`<span class="rating">${l.avaliacao.toFixed(1)}<span class="q" title="${l.reviews??0} avaliações">☆</span></span>`; }

function scoreRing(score){
  const v=Math.max(0,Math.min(100,score||0));
  const cor = v>=80?'var(--green)':v>=60?'var(--cyan)':v>=40?'var(--amber)':'var(--muted)';
  const r=15,c=2*Math.PI*r,off=c*(1-v/100);
  return `<svg class="ring" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--border-2)" stroke-width="3.2"/>
    <circle cx="20" cy="20" r="${r}" fill="none" stroke="${cor}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 20 20)"/>
    <text x="20" y="24.5" text-anchor="middle" font-size="12.5" font-weight="700" fill="${cor}">${v}</text></svg>`;
}

const STATUS_CHIP = {
  Identificado:{dot:'var(--blue)'}, Abordado:{dot:'var(--cyan)'}, Respondeu:{dot:'var(--amber)'},
  Convertido:{dot:'var(--green)'}, Frio:{dot:'var(--muted-2)'}
};
function statusChip(s){ const c=STATUS_CHIP[s]||{dot:'var(--muted)'}; return `<span class="chip"><span class="chip-dot" style="background:${c.dot}"></span>${esc(s)}</span>`; }

function rowHTML(l){
  const wa = waValido(l.whatsapp) ? l.whatsapp : '';
  return `<tr data-id="${l.id}" data-wa="${esc(wa)}">
    <td>${scoreRing(l.score)}</td>
    <td><div class="lead-name">${esc(l.nome)}</div>
        ${l.nicho?`<div class="lead-nicho">${esc(l.nicho)}</div>`:''}
        ${l.endereco?`<a class="lead-addr" href="${mapsLink(l)}" target="_blank" rel="noopener">⚲ ${esc(l.endereco)}</a>`:''}</td>
    <td>${contatoCell(l)}</td>
    <td>${ratingCell(l)}</td>
    <td>${siteCell(l)}</td>
    <td>${digitalCell(l)}</td>
    <td>${statusChip(l.status)}</td>
    <td>${l.proxima_acao?esc(l.proxima_acao)+(l.acao_em?`<div class="lead-addr">${esc(l.acao_em)}</div>`:''):'<span class="dash">—</span>'}</td>
    <td><div class="row-actions">
      <button data-act="editar" title="Editar" aria-label="Editar">✎</button>
      <button data-act="abordar" title="Abordar" aria-label="Abordar">◉</button>
      <button data-act="pipeline" class="pipe" title="Enviar ao Pipeline" aria-label="Pipeline">⊞</button>
      ${wa?`<button data-act="wa" class="wabtn" title="Abrir WhatsApp" aria-label="WhatsApp">✆</button>`:''}
      <button data-act="excluir" class="delbtn" title="Excluir" aria-label="Excluir">🗑</button>
    </div></td></tr>`;
}
async function loadLeads(){
  const p=new URLSearchParams({tab:state.tab,limit:state.limit,offset:state.offset});
  if(state.nicho)p.set('nicho',state.nicho); if(state.cidade)p.set('cidade',state.cidade);
  if(state.status)p.set('status',state.status); if(state.q)p.set('q',state.q);
  const {rows,total}=await api('/api/leads?'+p); state.total=total;
  $('#leadsBody').innerHTML = rows.length?rows.map(rowHTML).join(''):`<tr><td colspan="9"><div class="empty">Nenhum lead aqui ainda. Rode a Busca ou importe um CSV.</div></td></tr>`;
  const ini=total?state.offset+1:0, fim=Math.min(state.offset+state.limit,total);
  $('#tableFooter').innerHTML=`<span>${ini}–${fim} de ${total.toLocaleString('pt-BR')}</span><span><button ${state.offset===0?'disabled':''} data-page="prev">← Anterior</button> <button ${fim>=total?'disabled':''} data-page="next">Próxima →</button></span>`;
}

// filtra a lista a partir de um card/atalho (sincroniza a barra de abas)
function filtrarPor(tab){
  state.tab=tab; state.status=''; state.offset=0;
  const fs=$('#fStatus'); if(fs) fs.value='';
  [...$('#tabs').children].forEach(x=>x.classList.toggle('active', x.dataset.tab===tab));
  showView('prospeccao');
  loadLeads();
  document.querySelector('.table-wrap')?.scrollIntoView({behavior:'smooth',block:'start'});
}

/* ===================== Owlix · Centro de Inteligência ===================== */
function saudacao(){ const h=new Date().getHours(); return h<12?'Bom dia':h<19?'Boa tarde':'Boa noite'; }
function jumpTab(tab){ document.querySelector(`#tabs [data-tab="${tab}"]`)?.click(); window.scrollTo({top:0,behavior:'smooth'}); }
async function enrichNow(){ await api('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:30})}); toast('Turbinar rodando… clique em ↻ em alguns segundos'); setTimeout(refresh,8000); }

function buildSuggestions(s){
  const out=[];
  if(!s.total){ out.push({tint:'t-cyan',count:'',txt:'Sua base está vazia. Quer captar negócios agora?',act:'Rodar Busca',fn:()=>modalScrape()}); return out; }
  if(s.sem_site)  out.push({tint:'t-amber', count:s.sem_site, txt:'negócios sem site — maior chance de conversão.', act:'Filtrar automaticamente', fn:()=>jumpTab('sem_site')});
  if(s.responderam) out.push({tint:'t-pink', count:s.responderam, txt:'empresas responderam — vale um follow-up agora.', act:'Ver conversas', fn:()=>jumpTab('responderam')});
  if(s.meta_ads)  out.push({tint:'t-blue', count:s.meta_ads, txt:'investem em anúncios na Meta (têm verba).', act:'Ver detalhes', fn:()=>jumpTab('ads')});
  if(s.follow_up) out.push({tint:'t-red', count:s.follow_up, txt:'follow-ups pendentes ou atrasados.', act:'Ver follow-ups', fn:()=>jumpTab('follow_up')});
  if(s.pendentes_enriquecimento) out.push({tint:'t-purple', count:s.pendentes_enriquecimento, txt:'leads podem ganhar site, IG e e-mail.', act:'Turbinar agora', fn:()=>enrichNow()});
  return out;
}
function bestAction(s){
  if(!s.total) return {tag:'Comece por aqui',txt:'Sua base está vazia. Vamos captar os primeiros negócios?',label:'Rodar o Busca',fn:()=>modalScrape()};
  if(s.sem_site) return {tag:'Próxima melhor ação',txt:`Filtrar os <b>${s.sem_site}</b> negócios sem website — o grupo mais quente.`,label:`Filtrar ${s.sem_site} sem site`,fn:()=>jumpTab('sem_site')};
  if(s.responderam) return {tag:'Próxima melhor ação',txt:`<b>${s.responderam}</b> empresas responderam. Hora do follow-up.`,label:'Ver quem respondeu',fn:()=>jumpTab('responderam')};
  if(s.pendentes_enriquecimento) return {tag:'Próxima melhor ação',txt:`Turbinar <b>${s.pendentes_enriquecimento}</b> leads com novas informações.`,label:'Turbinar agora',fn:()=>enrichNow()};
  return {tag:'Tudo em dia',txt:'Nenhuma ação urgente. Que tal captar mais leads?',label:'Rodar o Busca',fn:()=>modalScrape()};
}

function renderCopilot(s){
  const linha = !s.total ? 'Sua base ainda está vazia — bora encher.'
    : s.sem_site ? `Encontrei <b>${s.sem_site}</b> negócios sem website. Esse é o grupo com maior chance de conversão.`
    : s.responderam ? `<b>${s.responderam}</b> empresas responderam. Vale um follow-up.`
    : 'Analisei sua base e está tudo sob controle.';
  $('#copilotMsg').innerHTML = `${saudacao()}, ${USUARIO}. Analisei sua base.<br>${linha}`;

  const nba = bestAction(s);
  $('#nba').innerHTML = `<div class="nba"><div class="nba-tag">${nba.tag}</div><div class="nba-txt">${nba.txt}</div><button class="nba-btn" id="nbaBtn">${nba.label}</button></div>`;
  $('#nbaBtn').onclick = nba.fn;

  const all = buildSuggestions(s);
  $('#copilotCards').innerHTML = all.length ? all.map((g,i)=>`
    <div class="sug"><div class="badge ${g.tint}">${g.count!==''?g.count:'✦'}</div>
      <div class="body"><div class="txt">${esc(g.txt)}</div><a class="act ${g.tint}" data-sug="${i}">${esc(g.act)} →</a></div></div>`).join('')
    : `<div class="sug"><div class="badge t-green">✓</div><div class="body"><div class="txt">Nada pendente no momento.</div></div></div>`;
  renderCopilot._acoes = all;

  $('#shortcuts').innerHTML = [
    {ic:'🎯',tx:'Filtrar',fn:()=>jumpTab('sem_site')},
    {ic:'💬',tx:'WhatsApp',fn:()=>toast('Os botões de WhatsApp estão nas linhas com número')},
    {ic:'🚀',tx:'Campanha',fn:()=>abrirCampanhas()},
    {ic:'✦',tx:'Turbinar',fn:()=>enrichNow()},
  ].map((x,i)=>`<div class="sc" data-sc="${i}"><span class="sc-ic">${x.ic}</span>${x.tx}</div>`).join('');
  renderCopilot._sc = [()=>jumpTab('sem_site'),()=>toast('Os botões de WhatsApp estão nas linhas com número'),()=>abrirCampanhas(),()=>enrichNow()];
}
function abrirCampanhas(){ document.querySelector('.nav-item[data-view="campanhas"]')?.click(); }

/* ===================== Ações de linha ===================== */
async function rowAction(id,act){
  if(act==='editar') return modalEdit(id);
  if(act==='abordar'){ await api(`/api/leads/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'Abordado',no_pipeline:1})}); toast('Lead marcado como Abordado'); refresh(); }
  else if(act==='pipeline'){ await api(`/api/leads/${id}/pipeline`,{method:'POST'}); toast('Adicionado ao pipeline'); refresh(); }
  else if(act==='wa'){ const wa=document.querySelector(`tr[data-id="${id}"]`)?.dataset.wa; if(wa) window.open(`https://wa.me/${wa}`,'_blank'); else toast('Sem número de WhatsApp'); }
  else if(act==='excluir') return modalExcluir(id);
}

/* ===================== Modais ===================== */
function openModal(html){ $('#modal').innerHTML=html; $('#modalBackdrop').hidden=false; }
function closeModal(){ $('#modalBackdrop').hidden=true; }
let _pressNoFundo=false;
$('#modalBackdrop').addEventListener('mousedown',e=>{_pressNoFundo=(e.target.id==='modalBackdrop');});
$('#modalBackdrop').addEventListener('mouseup',e=>{if(_pressNoFundo&&e.target.id==='modalBackdrop')closeModal();_pressNoFundo=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

function modalAddLead(){
  openModal(`<h3>Novo lead</h3><p class="hint">Adiciona um lead manualmente.</p>
    <label>Nome *</label><input id="m_nome" autofocus>
    <label>Nicho</label><input id="m_nicho" value="${esc(state.nicho)}">
    <label>Cidade</label><input id="m_cidade" value="${esc(state.cidade)}">
    <label>Telefone</label><input id="m_tel">
    <label>Site</label><input id="m_site" placeholder="https://">
    <label>Instagram</label><input id="m_ig" placeholder="@perfil">
    <label>E-mail</label><input id="m_email" placeholder="contato@...">
    <label>Descrição / notas</label><textarea id="m_desc" rows="3" placeholder="Observações sobre o lead..."></textarea>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="m_save">Salvar lead</button></div>`);
  $('#m_save').onclick=async()=>{const nome=$('#m_nome').value.trim();if(!nome)return toast('Informe o nome');
    await api('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome,nicho:$('#m_nicho').value.trim(),cidade:$('#m_cidade').value.trim(),telefone:$('#m_tel').value.trim(),site:$('#m_site').value.trim(),instagram:$('#m_ig').value.trim(),email:$('#m_email').value.trim(),descricao:$('#m_desc').value.trim()})});
    closeModal();toast('Lead criado');refresh();};
}
const STATUS_OPTS=['Identificado','Abordado','Respondeu','Convertido','Frio'];
let _editLeadId=null;
async function modalEdit(id){
  _editLeadId=id;
  const l=await api('/api/leads/'+id); if(l.erro)return toast('Lead não encontrado');
  const opts=STATUS_OPTS.map(s=>`<option value="${s}" ${s===l.status?'selected':''}>${s}</option>`).join('');
  openModal(`<h3>Editar lead</h3><p class="hint">${esc(l.nome)}</p>
    <label>Nome</label><input id="e_nome" value="${esc(l.nome)}">
    <label>Nicho</label><input id="e_nicho" value="${esc(l.nicho)}">
    <label>Status</label><select id="e_status">${opts}</select>
    <label>Telefone</label><input id="e_tel" value="${esc(l.telefone)}">
    <label>WhatsApp <span class="lbl-aux">só números, com código do país — ex: 351912345678</span></label><input id="e_wa" value="${esc(l.whatsapp)}">
    <label>E-mail</label><input id="e_email" value="${esc(l.email)}">
    <label>Instagram <span class="lbl-aux">@perfil ou link</span></label><input id="e_ig" value="${esc(l.instagram)}">
    <label>Site</label><input id="e_site" value="${esc(l.site)}">
    <label>Endereço</label><input id="e_end" value="${esc(l.endereco)}">
    <label>Cidade</label><input id="e_cidade" value="${esc(l.cidade)}">
    <label>Próxima ação</label><input id="e_pa" value="${esc(l.proxima_acao)}">
    <label>Data da próxima ação</label><input id="e_ae" type="date" value="${esc(l.acao_em)}">
    <label>Descrição / notas</label><textarea id="e_desc" rows="3" placeholder="Observações sobre o lead...">${esc(l.descricao)}</textarea>
    <label class="chk"><input type="checkbox" id="e_pipe" ${l.no_pipeline?'checked':''}> No pipeline</label>
    <label class="chk"><input type="checkbox" id="e_ads" ${l.meta_ads?'checked':''}> Roda anúncios na Meta</label>
    <div class="lead-tasks">
      <div class="lt-head">⚲ Tarefas deste lead</div>
      <div id="e_tasks" class="lt-list"></div>
      <div class="lt-add">
        <input id="e_tk_titulo" placeholder="Nova tarefa para ${esc((l.nome||'').split(' ')[0])}...">
        <input id="e_tk_data" type="date">
        <button class="btn line" id="e_tk_add" type="button">+ Tarefa</button>
      </div>
    </div>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="e_save">Salvar alterações</button></div>`);
  renderLeadTasks(id);
  $('#e_tk_add').onclick=async()=>{
    const titulo=$('#e_tk_titulo').value.trim(); if(!titulo) return toast('Escreva a tarefa');
    await api('/api/tarefas',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({titulo,lead:l.nome,lead_id:id,vence_em:$('#e_tk_data').value||null})});
    $('#e_tk_titulo').value=''; $('#e_tk_data').value=''; toast('Tarefa criada'); renderLeadTasks(id);
  };
  $('#e_save').onclick=async()=>{const nome=$('#e_nome').value.trim();if(!nome)return toast('O nome não pode ficar vazio');
    await api('/api/leads/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({nome,nicho:$('#e_nicho').value.trim()||null,status:$('#e_status').value,telefone:$('#e_tel').value.trim()||null,whatsapp:$('#e_wa').value.replace(/\D/g,'')||null,email:$('#e_email').value.trim()||null,instagram:$('#e_ig').value.trim()||null,site:$('#e_site').value.trim()||null,endereco:$('#e_end').value.trim()||null,cidade:$('#e_cidade').value.trim()||null,proxima_acao:$('#e_pa').value.trim()||null,acao_em:$('#e_ae').value||null,descricao:$('#e_desc').value.trim()||null,no_pipeline:$('#e_pipe').checked?1:0,meta_ads:$('#e_ads').checked?1:0})});
    closeModal();toast('Lead atualizado');refresh();};
}

async function renderLeadTasks(leadId){
  const box=$('#e_tasks'); if(!box) return;
  const todas=await api('/api/tarefas');
  const minhas=todas.filter(t=>t.lead_id===leadId);
  const hoje=new Date().toISOString().slice(0,10);
  box.innerHTML = minhas.length ? minhas.map(t=>{
    const atras=t.vence_em && !t.feito && t.vence_em<hoje;
    return `<div class="lt-item ${t.feito?'done':''}" data-ltid="${t.id}">
      <button class="lt-check ${t.feito?'on':''}" data-ltact="toggle">${t.feito?'✓':''}</button>
      <span class="lt-tt">${esc(t.titulo)}${t.vence_em?` <small class="${atras?'atras':''}">${atras?'⚠ ':''}${esc(t.vence_em)}</small>`:''}</span>
      <button class="lt-del" data-ltact="del">🗑</button></div>`;
  }).join('') : '<div class="lt-vazio">Nenhuma tarefa ainda.</div>';
}

async function modalExcluir(id){
  const l=await api('/api/leads/'+id); if(l.erro)return toast('Lead não encontrado');
  openModal(`<h3>Excluir lead</h3><p class="hint">${esc(l.nome)} — esta ação é permanente.</p>
    <label>Motivo</label>
    <select id="x_motivo">
      <option value="Duplicado">Duplicado</option>
      <option value="Falta de dados">Falta de dados</option>
      <option value="Fora do perfil">Fora do perfil</option>
      <option value="Outro">Outro</option>
    </select>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn danger" id="x_go">Excluir lead</button></div>`);
  $('#x_go').onclick=async()=>{
    await api('/api/leads/'+id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({motivo:$('#x_motivo').value})});
    closeModal();toast('Lead excluído');refresh();
  };
}
function modalScrape(){
  openModal(`<h3>Busca — Google Maps</h3><p class="hint">Busca negócios e grava no banco (dedupe automático).</p>
    <label>Termo / nicho *</label><input id="s_termo" value="${esc(SET.nicho || 'clinica dentaria')}">
    <label>Cidade *</label><input id="s_cidade" value="${esc(SET.cidade || 'Porto, Portugal')}">
    <label>Código do país p/ link de WhatsApp <span class="lbl-aux">351 = Portugal · 55 = Brasil · não muda o número exibido</span></label><input id="s_ddi" value="${esc(SET.ddi || '351')}">
    <label>Máx. de resultados</label><input id="s_max" type="number" value="40">
    <div id="s_log" class="job-log" hidden></div>
    <div class="actions"><button class="btn" data-close>Fechar</button><button class="btn primary" id="s_go">Iniciar busca</button></div>`);
  $('#s_go').onclick=async()=>{const termo=$('#s_termo').value.trim(),cidade=$('#s_cidade').value.trim();if(!termo||!cidade)return toast('Preencha termo e cidade');
    const logBox=$('#s_log');logBox.hidden=false;logBox.textContent='iniciando…';$('#s_go').disabled=true;
    const {jobId}=await api('/api/scrape',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({termo,cidade,ddi:$('#s_ddi').value.trim()||'351',max:Number($('#s_max').value)||40})});
    const poll=setInterval(async()=>{const j=await api('/api/scrape/'+jobId);logBox.textContent=j.log||j.status;logBox.scrollTop=logBox.scrollHeight;
      if(j.status==='concluido'||j.status==='erro'){clearInterval(poll);$('#s_go').disabled=false;toast(j.status==='concluido'?`${j.novos} novos leads`:'Erro no scraping');refresh();}},1500);};
}

/* ===================== Bind ===================== */
function refresh(){ loadStats(); loadLeads(); loadFilters(); }
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;[...$('#tabs').children].forEach(x=>x.classList.remove('active'));b.classList.add('active');state.tab=b.dataset.tab;state.status='';const fs=$('#fStatus');if(fs)fs.value='';state.offset=0;loadLeads();});
$('#leadsBody').addEventListener('click',e=>{const b=e.target.closest('button[data-act]');if(!b)return;rowAction(Number(e.target.closest('tr').dataset.id),b.dataset.act);});
$('#tableFooter').addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(!b)return;state.offset+=b.dataset.page==='next'?state.limit:-state.limit;state.offset=Math.max(0,state.offset);loadLeads();});
let searchTimer;
$('#search').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value.trim();state.offset=0;loadLeads();},300);});
$('#globalSearch').addEventListener('input',e=>{$('#search').value=e.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.q=e.target.value.trim();state.offset=0;loadLeads();},300);});
$('#fNicho').addEventListener('change',e=>{state.nicho=e.target.value;state.offset=0;loadLeads();});
$('#fCidade').addEventListener('change',e=>{state.cidade=e.target.value;state.offset=0;loadLeads();});
$('#fStatus').addEventListener('change',e=>{
  state.status=e.target.value; state.offset=0;
  // se a aba atual já é baseada em status, volta pra "Todos" pra não dar resultado vazio
  if(['abordados','responderam','convertidos','frio'].includes(state.tab)){
    state.tab='todos';
    [...$('#tabs').children].forEach(x=>x.classList.toggle('active', x.dataset.tab==='todos'));
  }
  loadLeads();
});
$('#kpiHero').addEventListener('click',e=>{const c=e.target.closest('[data-filter]');if(c)filtrarPor(c.dataset.filter);});
$('#kpiMini').addEventListener('click',e=>{const c=e.target.closest('[data-filter]');if(c)filtrarPor(c.dataset.filter);});
$('#fAplicar').addEventListener('click',()=>{
  state.nicho=$('#fNicho').value; state.cidade=$('#fCidade').value; state.status=$('#fStatus').value;
  state.q=$('#search').value.trim(); state.offset=0;
  if(['abordados','responderam','convertidos','frio'].includes(state.tab) && state.status){
    state.tab='todos';
    [...$('#tabs').children].forEach(x=>x.classList.toggle('active', x.dataset.tab==='todos'));
  }
  loadLeads();
  document.querySelector('.table-wrap')?.scrollIntoView({behavior:'smooth',block:'start'});
  toast('Filtros aplicados');
});
$('#fLimpar').addEventListener('click',()=>{
  state.nicho='';state.cidade='';state.status='';state.q='';state.tab='todos';state.offset=0;
  $('#fNicho').value='';$('#fCidade').value='';$('#fStatus').value='';$('#search').value='';
  const g=$('#globalSearch'); if(g) g.value='';
  [...$('#tabs').children].forEach((x,i)=>x.classList.toggle('active', i===0));
  loadLeads();
});
$('#tf_lista').addEventListener('click',async e=>{
  const b=e.target.closest('[data-tfact]'); if(!b) return;
  const id=Number(b.closest('.tf-item').dataset.tid);
  if(b.dataset.tfact==='toggle'){ const done=b.classList.contains('on'); await api('/api/tarefas/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({feito:done?0:1})}); loadTarefas(); }
  else if(b.dataset.tfact==='del'){ await api('/api/tarefas/'+id,{method:'DELETE'}); loadTarefas(); }
});
$('.tf-filtros')?.addEventListener('click',e=>{const b=e.target.closest('.tf-fil');if(!b)return;[...b.parentElement.children].forEach(x=>x.classList.remove('active'));b.classList.add('active');_tfFiltro=b.dataset.tf;loadTarefas();});
$('#modal').addEventListener('click',async e=>{
  const b=e.target.closest('[data-ltact]'); if(!b) return;
  const id=Number(b.closest('.lt-item').dataset.ltid);
  if(b.dataset.ltact==='toggle'){ const done=b.classList.contains('on'); await api('/api/tarefas/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({feito:done?0:1})}); }
  else if(b.dataset.ltact==='del'){ await api('/api/tarefas/'+id,{method:'DELETE'}); }
  if(_editLeadId) renderLeadTasks(_editLeadId);
});
$('#copilotCards').addEventListener('click',e=>{const a=e.target.closest('[data-sug]');if(!a)return;renderCopilot._acoes?.[Number(a.dataset.sug)]?.fn();});
$('#shortcuts').addEventListener('click',e=>{const a=e.target.closest('[data-sc]');if(!a)return;renderCopilot._sc?.[Number(a.dataset.sc)]?.();});
document.addEventListener('click',async e=>{
  if(e.target.closest('[data-close]'))return closeModal();
  if(e.target.closest('[data-add-lead]'))return modalAddLead();
  if(e.target.closest('[data-scrape]'))return modalScrape();
  if(e.target.closest('[data-refresh]')){refresh();return toast('Atualizado');}
  if(e.target.closest('[data-enrich]')||e.target.closest('[data-enrich-nav]'))return enrichNow();
  if(e.target.closest('[data-export]'))return toast('Exportar CSV: ponto de extensão pronto no backend');
  if(e.target.closest('[data-import]'))return toast('Importar CSV: ponto de extensão pronto no backend');
  if(e.target.closest('[data-add-task]')){ document.querySelector('.nav-item[data-view="tarefas"]')?.click(); setTimeout(()=>$('#tf_titulo')?.focus(),50); return; }
  if(e.target.closest('#set_save'))return saveSettings();
  if(e.target.closest('#set_reproc'))return reprocessar();
  if(e.target.closest('#cp_montar'))return montarCampanha();
  if(e.target.closest('#tf_add'))return addTarefa();
  const cpb=e.target.closest('.cp-enviar'); if(cpb){const r=cpb.closest('.cp-row'); if(r) enviarCampanha(Number(r.dataset.cid)); return;}
  const jump=e.target.closest('[data-jump]');if(jump){showView('prospeccao');return jumpTab(jump.dataset.jump);}
  const nav=e.target.closest('.nav-item[data-view]');
  if(nav){
    [...$('#nav').children].forEach(x=>x.classList.remove('active'));nav.classList.add('active');
    const v=nav.dataset.view;
    if(v==='config') showView('settings');
    else if(v==='campanhas'){ showView('campanhas'); initCampanha(); }
    else if(v==='tarefas'){ showView('tarefas'); loadTarefas(); }
    else if(v==='prospeccao'||v==='leads') showView('prospeccao');
    else toast('Módulo "'+nav.querySelector('.ni-tx').textContent+'" em breve');
  }
});

function showView(v){
  $('#viewProspeccao').hidden = v!=='prospeccao';
  $('#viewSettings').hidden   = v!=='settings';
  $('#viewCampanhas').hidden  = v!=='campanhas';
  $('#viewTarefas').hidden    = v!=='tarefas';
  window.scrollTo({top:0});
}
async function reprocessar(){
  const b=$('#set_reproc'); if(b) b.disabled=true;
  const r=await api('/api/enrich/reset',{method:'POST'});
  toast(`Reprocessando ${r.reprocessando||0} leads em segundo plano… volte e clique ↻`);
  if(b) setTimeout(()=>b.disabled=false, 4000);
}

/* ===================== Tarefas ===================== */
let _tfFiltro='0';
async function loadTarefas(){
  const tarefas = await api('/api/tarefas'+(_tfFiltro!==''?`?feito=${_tfFiltro}`:''));
  const hoje = new Date().toISOString().slice(0,10);
  $('#tf_lista').innerHTML = tarefas.length ? tarefas.map(t=>{
    const atrasada = t.vence_em && !t.feito && t.vence_em < hoje;
    const meta=[]; if(t.lead) meta.push(`<span class="lead">⚲ ${esc(t.lead)}</span>`);
    if(t.vence_em) meta.push(`<span class="${atrasada?'atras':''}">${atrasada?'⚠ atrasada · ':''}${esc(t.vence_em)}</span>`);
    return `<div class="tf-item ${t.feito?'done':''}" data-tid="${t.id}">
      <button class="tf-check ${t.feito?'on':''}" data-tfact="toggle">${t.feito?'✓':''}</button>
      <div class="tf-info"><div class="tf-titulo">${esc(t.titulo)}</div>${meta.length?`<div class="tf-meta">${meta.join(' · ')}</div>`:''}</div>
      <button class="tf-del" data-tfact="del" title="Excluir">🗑</button>
    </div>`;
  }).join('') : `<div class="tf-empty">Nenhuma tarefa ${_tfFiltro==='0'?'pendente':_tfFiltro==='1'?'concluída':''}.</div>`;
}
async function addTarefa(){
  const titulo=$('#tf_titulo').value.trim(); if(!titulo) return toast('Escreva a tarefa');
  await api('/api/tarefas',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({titulo,lead:$('#tf_lead').value.trim()||null,vence_em:$('#tf_data').value||null})});
  $('#tf_titulo').value=''; $('#tf_lead').value=''; $('#tf_data').value='';
  toast('Tarefa criada'); loadTarefas();
}
async function saveSettings(){
  const g=id=>$('#'+id)?.value.trim();
  await api('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({nome:g('set_nome'),empresa:g('set_empresa'),nicho:g('set_nicho'),
      cidade:g('set_cidade'),ddi:g('set_ddi'),ticket:g('set_ticket'),wamsg:$('#set_wamsg')?.value})});
  await loadSettings(); loadStats(); toast('Configurações salvas ✓');
}

/* ===================== Campanha de WhatsApp ===================== */
let _cpFila = [], _cpEnviados = new Set();
function personalizar(msg, l){
  const primeiro = (l.nome||'').trim().split(/\s+/)[0] || l.nome || '';
  return (msg||'').replaceAll('{nome}', primeiro)
                  .replaceAll('{nicho}', l.nicho||'')
                  .replaceAll('{cidade}', (l.cidade||'').split(',')[0].trim());
}
async function initCampanha(){
  const f = await api('/api/filters');
  $('#cp_nicho').innerHTML  = '<option value="">Todos os nichos</option>'+f.nichos.map(n=>`<option>${esc(n)}</option>`).join('');
  $('#cp_cidade').innerHTML = '<option value="">Todas as cidades</option>'+f.cidades.map(c=>`<option>${esc(c)}</option>`).join('');
  if(!$('#cp_msg').value) $('#cp_msg').value = SET.wamsg || 'Olá {nome}, tudo bem? ';
}
async function montarCampanha(){
  const p = new URLSearchParams({ tab:$('#cp_seg').value, novos:$('#cp_novos').checked?'1':'0' });
  if($('#cp_nicho').value) p.set('nicho',$('#cp_nicho').value);
  if($('#cp_cidade').value) p.set('cidade',$('#cp_cidade').value);
  const rows = await api('/api/campaign?'+p);
  _cpFila = (rows||[]).filter(l=>waValido(l.whatsapp));
  _cpEnviados = new Set();
  $('#cp_resultado').hidden = false;
  renderFila();
}
function renderFila(){
  $('#cp_count').textContent = `· ${_cpEnviados.size}/${_cpFila.length} enviados`;
  $('#cp_fill').style.width = _cpFila.length ? (_cpEnviados.size/_cpFila.length*100)+'%' : '0';
  $('#cp_lista').innerHTML = _cpFila.length ? _cpFila.map(l=>{
    const sent=_cpEnviados.has(l.id);
    return `<div class="cp-row ${sent?'sent':''}" data-cid="${l.id}">
      <div class="cp-info"><div class="cp-nome">${esc(l.nome)}</div>
      <div class="cp-num">+${esc(l.whatsapp)}${l.nicho?' · '+esc(l.nicho):''}</div></div>
      <button class="cp-enviar">${sent?'✓ enviado':'Enviar →'}</button></div>`;
  }).join('') : '<div class="cp-empty">Nenhum lead com WhatsApp (celular) nesse segmento.</div>';
}
async function enviarCampanha(id){
  const l = _cpFila.find(x=>x.id===id); if(!l) return;
  const txt = encodeURIComponent(personalizar($('#cp_msg').value, l));
  window.open(`https://wa.me/${l.whatsapp}?text=${txt}`, '_blank');
  _cpEnviados.add(id);
  renderFila();
  try { await api('/api/leads/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({status:'Abordado',no_pipeline:1,proxima_acao:'Campanha WhatsApp enviada'})}); } catch{}
}

/* ===================== Init ===================== */
document.querySelector('.copilot-name').firstChild.textContent = COPILOTO + ' ';
loadSettings();
refresh();
setInterval(loadStats, 30000);
