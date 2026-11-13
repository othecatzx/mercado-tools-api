/* Central de operações: dados reais da fila, sem persistir informações do cliente. */
(function(root){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number(value||0).toLocaleString('pt-BR');
 const short=value=>String(value||'Loja').trim().split(/\s+/)[0];
 const cancelled=o=>o.status_group==='cancelled'||['cancelled','canceled'].includes(String(o.status||'').toLowerCase());
 const flex=o=>o.shipping_logistic_type==='self_service';
 const can=(user,page)=>{
  if(user?.role!=='support_agent')return true;
  const menus=user.menu_permissions||[];
  const key=page==='vendas'||page==='operational-report'?'orders':page;
  return menus.includes(key)||(key==='orders'&&menus.includes('sales'));
 };
 function model(data,licenses=[],filter='all',now=Date.now()){
  const orders=Array.isArray(data?.orders)?data.orders:[];
  const stores=Array.isArray(data?.stores)?data.stores:[];
  const grouped=new Map();
  stores.forEach(s=>{
   const id=String(s.company_id);
   if(!grouped.has(id))grouped.set(id,{id,name:short(s.company_name||s.nickname),accounts:[],orders:[]});
   grouped.get(id).accounts.push(s);
  });
  orders.forEach(o=>{
   const id=String(o.company_id);
   if(!grouped.has(id))grouped.set(id,{id,name:short(o.company_name),accounts:[],orders:[]});
   grouped.get(id).orders.push(o);
  });
  const allStores=[...grouped.values()].map(s=>{
   const pending=s.orders.filter(o=>o.needs_separation&&!cancelled(o));
   return {...s,pending,flex:pending.filter(flex),failures:s.accounts.filter(a=>a.connected===false||a.error),unknown:!s.accounts.length};
  }).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'}));
  const selected=allStores.filter(s=>filter==='all'||s.id===String(filter));
  const rows=orders.filter(o=>filter==='all'||String(o.company_id)===String(filter));
  const pending=rows.filter(o=>o.needs_separation&&!cancelled(o));
  const expiring=licenses.map(l=>({name:short(l.company?.nome||l.company),time:new Date(l.vencimento).getTime(),companyId:String(l.company_id??l.company?.id??'')}))
   .filter(l=>Number.isFinite(l.time)&&l.time>now&&l.time-now<=30*86400000&&(filter==='all'||l.companyId===String(filter)))
   .sort((a,b)=>a.time-b.time);
  return {allStores,selected,pending,flex:pending.filter(flex),separated:rows.filter(o=>o.already_separated&&!cancelled(o)),failures:selected.flatMap(s=>s.failures.map(a=>({...a,store:s}))),expiring,
   priorities:pending.slice().sort((a,b)=>Number(flex(b))-Number(flex(a))||new Date(a.date_created||0)-new Date(b.date_created||0)).slice(0,8)};
 }
 function chatMarkup({user,filter,chatData,chatError,chatLoading}){
  if(!can(user,'chat')||(user?.role==='support_agent'&&!(user.permissions||[]).includes('conversations.view')))return '';
  const stores=(chatData?.stores||[]).filter(s=>filter==='all'||String(s.company_id)===String(filter));
  const total=key=>stores.reduce((n,s)=>n+Number(s[key]||0),0);
  const action=(s,kind,text)=>'<button type="button" class="btn btn-ghost" data-ops-chat="'+escape(s.license_id)+'" data-ops-chat-filter="'+kind+'">'+text+' →</button>';
  const rows=stores.filter(s=>Number(s.waiting)||Number(s.unassigned)).map(s=>'<div class="ops-chat-row"><div><strong>'+escape(short(s.company_name))+'</strong><p class="small muted">'+number(s.waiting)+' aguardando resposta · '+number(s.unassigned)+' sem responsável</p></div><div class="ops-links">'+(Number(s.waiting)?action(s,'waiting','Responder'):'')+(Number(s.unassigned)?action(s,'unassigned','Distribuir'):'')+'</div></div>').join('');
  return '<section class="panel ops-chat-panel"><div class="panel-head"><div><h3>Pendências de atendimento</h3><div class="small muted">Mensagens já sincronizadas com o portal</div></div><button type="button" class="btn btn-ghost" id="operationsChatRefresh" '+(chatLoading?'disabled':'')+'>'+(chatLoading?'Consultando…':'Atualizar atendimento')+'</button></div>'+
   (chatError?'<div class="alert error" role="alert">'+escape(chatError)+(chatData?' Exibindo a última consulta disponível.':'')+'</div>':'')+
   '<div class="ops-chat-counts"><div><b>'+(chatData?number(total('waiting')):'—')+'</b><span>Aguardando resposta</span></div><div><b>'+(chatData?number(total('unassigned')):'—')+'</b><span>Sem responsável</span></div><div><b>'+(chatData?number(total('open')):'—')+'</b><span>Conversas abertas</span></div></div>'+
   (rows||'<p class="small muted">'+(chatData?'Nenhuma pendência encontrada nas conversas sincronizadas deste filtro.':chatLoading?'Consultando conversas autorizadas…':'As pendências aparecerão após a consulta.')+'</p>')+
   '<p class="small muted ops-note">Aguardando resposta significa que a última mensagem é do comprador, mesmo que já tenha sido lida. Conversas encerradas ou bloqueadas não entram. As contagens podem se sobrepor.'+(total('unknown_sender')?' Há '+number(total('unknown_sender'))+' conversa(s) sem remetente identificado; elas não entram em aguardando resposta.':'')+'</p></section>';
 }
 function render({data,licenses,user,filter='all',loaded=false,loading=false,error='',updatedAt=null,chatData=null,chatError='',chatLoading=false}){
  const m=model(data,licenses,filter);
  const e=escape;
  const go=(label,page)=>can(user,page)?'<button type="button" class="btn btn-ghost" data-go="'+e(page)+'">'+e(label)+' →</button>':'';
  const queue=(label,id='all',type='all')=>can(user,'vendas')?'<button type="button" class="btn btn-ghost" data-ops-store="'+e(id)+'" data-ops-logistic="'+e(type)+'">'+e(label)+' →</button>':'';
  const card=(label,value,foot,icon)=>'<article class="stat-card"><div class="stat-top"><span>'+e(label)+'</span><span class="stat-icon">'+icon+'</span></div><div class="stat-number">'+(loaded?e(number(value)):'—')+'</div><div class="stat-foot">'+e(foot)+'</div></article>';
  const ready=loaded&&!loading;
  const tasks=[];
  if(loaded)m.failures.forEach(a=>tasks.push('<article class="ops-task ops-task-error"><div class="ops-task-icon" aria-hidden="true">!</div><div><strong>'+e(a.store.name)+' · consulta indisponível</strong><p>'+e(a.error||'Não foi possível consultar esta conta.')+'</p><small>Os totais podem estar incompletos.</small></div>'+go('Revisar licenças','licenses')+'</article>'));
  if(loaded)m.selected.filter(s=>s.pending.length).sort((a,b)=>b.flex.length-a.flex.length||b.pending.length-a.pending.length).forEach(s=>tasks.push('<article class="ops-task"><div class="ops-task-icon" aria-hidden="true">▤</div><div><strong>'+e(s.name)+' · '+number(s.pending.length)+' pedido(s) para separar</strong><p>'+number(s.flex.length)+' FLEX · '+number(s.pending.length-s.flex.length)+' outros envios</p></div>'+queue('Separar pedidos',s.id)+'</article>'));
  m.expiring.forEach(l=>tasks.push('<article class="ops-task"><div class="ops-task-icon" aria-hidden="true">◷</div><div><strong>'+e(l.name)+' · licença próxima do vencimento</strong><p>Vencimento em '+e(new Date(l.time).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}))+'</p></div>'+go('Ver licença','licenses')+'</article>'));
  const time=updatedAt?new Date(updatedAt).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}):'Ainda não consultado';
  const options=m.allStores.map(s=>'<option value="'+e(s.id)+'" '+(s.id===filter?'selected':'')+'>'+e(s.name)+'</option>').join('');
  return '<div class="ops-center" aria-busy="'+String(loading)+'">'+
   '<div class="page-head"><div><div class="eyebrow">CENTRAL DE OPERAÇÕES</div><h1>Seu dia, em um só lugar.</h1><p>Acompanhe as pendências e siga direto para o trabalho de cada loja.</p></div><button type="button" class="btn btn-primary" id="overviewRefresh" '+(loading?'disabled':'')+'>↻ '+(loading?'Consultando lojas…':'Atualizar agora')+'</button></div>'+
   '<section class="panel ops-toolbar"><label for="operationsStore">Loja <select id="operationsStore" class="filter-control"><option value="all">Todas as lojas</option>'+options+'</select></label><div class="ops-sync" role="status"><span class="ops-dot '+(error||m.failures.length?'ops-dot-warn':'')+'"></span>'+(loading?'Consultando a situação atual…':updatedAt?'Última consulta às '+e(time):e(time))+'</div></section>'+
   (error?'<div class="alert error" role="alert">'+e(error)+(loaded?' Os dados abaixo são da última consulta concluída.':' Tente atualizar novamente.')+'</div>':'')+
   (m.failures.length?'<div class="notice" role="status">Consulta parcial: '+number(m.failures.length)+' conta(s) indisponível(is). A fila e os totais podem estar incompletos.</div>':'')+
   '<div class="grid ops-stats">'+card('Aguardando separação',m.pending.length,'Pedidos da fila operacional','▤')+card('FLEX pendentes',m.flex.length,'Entre os pedidos para separar','↗')+card('Etiquetas impressas',m.separated.length,'Pedidos ainda presentes na fila','✓')+card('Contas consultadas',m.selected.reduce((n,s)=>n+s.accounts.filter(a=>a.connected===true&&!a.error).length,0),'Consulta concluída sem erro','⇄')+'</div>'+
   chatMarkup({user,filter,chatData,chatError,chatLoading})+
   '<div class="section-row"><div><h2>Precisa da sua atenção</h2><p>Pendências encontradas nos dados disponíveis.</p></div><span class="badge">'+number(tasks.length)+' ações</span></div>'+
   '<section class="panel ops-tasks">'+(loading&&!loaded?'<div class="ops-empty" role="status">Consultando pedidos e contas autorizadas…</div>':tasks.join('')||'<div class="ops-empty">'+(loaded?'Nenhuma pendência identificada nos dados consultados.':'Atualize para consultar as pendências das lojas.')+'</div>')+'</section>'+
   '<div class="ops-columns"><section class="panel"><div class="panel-head"><div><h3>Fila prioritária</h3><div class="small muted">FLEX primeiro; depois, pedidos mais antigos.</div></div>'+queue('Ver todos',filter)+'</div><div class="table-wrap"><table class="ops-table"><thead><tr><th>Pedido / produto</th><th>Loja</th><th>Envio</th><th>Un.</th></tr></thead><tbody>'+
   (m.priorities.map(o=>'<tr><td><b>#'+e(o.id)+'</b><div class="product-sub">'+e((o.products||[]).map(p=>p.title).filter(Boolean).slice(0,2).join(' · ')||'Pedido')+'</div></td><td>'+e(short(o.company_name))+'</td><td>'+(flex(o)?'<span class="badge warn">FLEX</span>':'Normal')+'</td><td>'+number(o.units)+'</td></tr>').join('')||'<tr><td colspan="4" class="ops-empty">'+(loaded?'Nenhum pedido para separar neste filtro.':'Aguardando consulta.')+'</td></tr>')+
   '</tbody></table></div></section><section class="panel"><div class="panel-head"><h3>Situação por loja</h3></div>'+
   (m.selected.map(s=>'<div class="ops-store"><div><strong>'+e(s.name)+'</strong><div class="small muted">'+(s.failures.length?'Consulta parcial ou indisponível':s.unknown?'Sem diagnóstico da conta':'Consulta concluída')+'</div></div><div class="ops-store-count"><b>'+(s.failures.length&&!s.orders.length?'—':number(s.pending.length))+'</b><span class="small muted">'+(s.failures.length&&!s.orders.length?'Indisponível':s.failures.length?'parcial · para separar':'para separar')+'</span></div></div>').join('')||'<div class="ops-empty">'+(ready?'Nenhuma loja encontrada.':'As lojas aparecerão após a consulta.')+'</div>')+
   '</section></div><section class="panel ops-shortcuts"><div><h3>Acesse suas ferramentas</h3><p class="small muted">Continue a operação pelos módulos do portal.</p></div><div class="ops-links">'+go('Vendas e separação','vendas')+go('Atendimento','chat')+go('Códigos ML','codes')+go('Relatório operacional','operational-report')+go('Entradas de estoque','bling-entries')+'</div></section>'+
   '<p class="small muted ops-note">Esta é a fila operacional atual, que pode incluir pedidos de dias anteriores. Ela não representa o faturamento nem o total de vendas criadas hoje. Etiquetas impressas não equivalem ao total separado no dia. As consultas são feitas ao abrir a tela ou atualizar.</p></div>';
 }
 root.mlshOperationsCenter={model,render,can};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.mlshOperationsCenter;
})(globalThis);
