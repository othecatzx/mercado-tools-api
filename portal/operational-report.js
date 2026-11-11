/* ML SH Support — Relatório Operacional Diário */
let opReportData=null,opReportQueue=null,opReportLoading=false,opReportError='',opReportDays=7,opReportStore='all',opReportDay='',opReportLastUpdate=null,opReportRequest=0;
const opFmtNumber=n=>Number(n||0).toLocaleString('pt-BR');
const opFmtMoney=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const opDayKey=value=>{
 if(!value)return '';
 const d=new Date(value);
 if(!Number.isFinite(d.getTime()))return '';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
};
const opToday=()=>opDayKey(new Date());
const opDateLabel=day=>day?new Date(day+'T12:00:00-03:00').toLocaleDateString('pt-BR'):'—';
const opSafeCsv=s=>{const v=String(s??'');return '"'+(/^[=+\-@\t\r]/.test(v)?'\''+v:v).replace(/"/g,'""')+'"';};
async function loadOperationalReport(force=false){
 if(opReportLoading)return;
 if(opReportData&&!force){if(currentPage==='operational-report')renderPage();return;}
 const seq=++opReportRequest;opReportLoading=true;opReportError='';
 if(currentPage==='operational-report')renderPage();
 try{
  const results=await Promise.allSettled([
   fetchPortalSalesSnapshot('/api/portal/sales?days='+opReportDays+'&reportOnly=1',{force}),
   fetchPortalSalesSnapshot('/api/portal/sales?today=1',{force})
  ]);
  if(seq!==opReportRequest)return;
  if(results[0].status==='fulfilled')opReportData=results[0].value;
  else {opReportData=null;opReportError='Não foi possível consultar o histórico: '+results[0].reason.message;}
  if(results[1].status==='fulfilled')opReportQueue=results[1].value;
  else {opReportQueue=null;opReportError+=(opReportError?' ':'')+'Fila atual indisponível: '+results[1].reason.message;}
  opReportLastUpdate=new Date();
  if(!opReportDay||!opReportData||!opReportDailyRows().some(r=>r.day===opReportDay))opReportDay=opToday();
 }finally{
  if(seq===opReportRequest){opReportLoading=false;if(currentPage==='operational-report')renderPage();}
 }
}
function opReportDailyRows(){
 const orders=Array.isArray(opReportData?.orders)?opReportData.orders:[];
 const dates=[];
 const today=opToday();
 for(let d=opReportDays-1;d>=0;d--){
  const date=new Date(today+'T12:00:00-03:00');date.setDate(date.getDate()-d);
  dates.push(opDayKey(date));
 }
 return dates.map(day=>{
  const rows=orders.filter(o=>opDayKey(o.date_created)===day&&(opReportStore==='all'||String(o.company_id)===opReportStore));
  const valid=rows.filter(o=>!['cancelled','canceled'].includes(String(o.status||'').toLowerCase()));
  return {day,orders:valid.length,revenue:valid.reduce((s,o)=>s+Number(o.total_amount||0),0),units:valid.reduce((s,o)=>s+Number(o.units||0),0),cancelled:rows.length-valid.length,rows};
 });
}
function operationalReportMarkup(){
 const stores=Array.isArray(opReportData?.stores)?opReportData.stores:[];
 const storeOptions=stores.slice().sort((a,b)=>firstCompanyName(a.company_name||'').localeCompare(firstCompanyName(b.company_name||''),'pt-BR',{numeric:true})).map(s=>'<option value="'+esc(s.company_id)+'" '+(String(s.company_id)===opReportStore?'selected':'')+'>'+esc(firstCompanyName(s.company_name||'Loja'))+'</option>').join('');
 const days=opReportDailyRows();
 const chosen=days.find(x=>x.day===opReportDay)||days.at(-1);
 const today=opToday(),currentDay=chosen?.day===today;
 const queue=Array.isArray(opReportQueue?.orders)?opReportQueue.orders.filter(o=>opReportStore==='all'||String(o.company_id)===opReportStore):[];
 const pending=queue.filter(o=>o.needs_separation&&o.status_group!=='cancelled');
 const separated=queue.filter(o=>o.already_separated&&o.status_group!=='cancelled');
 const flex=pending.filter(o=>o.shipping_logistic_type==='self_service');
 const connected=stores.filter(s=>s.connected).length;
 const failed=stores.filter(s=>!s.connected);
 const canShow=!!opReportData&&!opReportLoading;
 const k=(label,value,foot,icon)=>stat(label,value,icon,foot);
 const cards='<div class="grid op-report-stats">'+k('Pedidos criados',canShow?opFmtNumber(chosen?.orders):'—','Não cancelados na data','▤')+k('Valor dos pedidos',canShow?opFmtMoney(chosen?.revenue):'—','Pedidos criados na data','＄')+k('Unidades',canShow?opFmtNumber(chosen?.units):'—','Itens dos pedidos encontrados','▣')+k('Cancelados',canShow?opFmtNumber(chosen?.cancelled):'—','Status atual dos pedidos da data','×')+'</div>';
 const timeline=days.map(r=>'<tr class="'+(r.day===chosen?.day?'op-report-selected':'')+'"><td><button type="button" class="op-report-date" data-op-day="'+esc(r.day)+'">'+esc(opDateLabel(r.day))+'</button></td><td>'+opFmtNumber(r.orders)+'</td><td>'+opFmtMoney(r.revenue)+'</td><td>'+opFmtNumber(r.units)+'</td><td>'+opFmtNumber(r.cancelled)+'</td></tr>').reverse().join('');
 const dayOrders=(chosen?.rows||[]).slice().sort((a,b)=>new Date(b.date_created||0)-new Date(a.date_created||0)).slice(0,12);
 const maxRevenue=Math.max(1,...days.map(r=>r.revenue));
 const bars=days.map(r=>'<button title="'+esc(opDateLabel(r.day))+' · '+esc(opFmtMoney(r.revenue))+'" type="button" class="op-report-chart-col '+(r.day===chosen?.day?'selected':'')+'" data-op-day="'+esc(r.day)+'"><span class="op-report-chart-value" style="height:'+Math.max(3,Math.round(r.revenue/maxRevenue*100))+'%"></span><small>'+esc(r.day.slice(8))+'</small></button>').join('');
 const storeRows=stores.filter(s=>opReportStore==='all'||String(s.company_id)===opReportStore).map(s=>{
  const rows=(chosen?.rows||[]).filter(o=>String(o.company_id)===String(s.company_id));
  return '<tr><td><b>'+esc(firstCompanyName(s.company_name||'Loja'))+'</b></td><td>'+opFmtNumber(rows.filter(o=>!['cancelled','canceled'].includes(String(o.status).toLowerCase())).length)+'</td><td>'+opFmtMoney(rows.filter(o=>!['cancelled','canceled'].includes(String(o.status).toLowerCase())).reduce((n,o)=>n+Number(o.total_amount||0),0))+'</td><td>'+(s.connected?'<span class="badge">Consultada</span>':'<span class="badge off" title="'+esc(s.error||'Falha na consulta')+'">Indisponível</span>')+'</td></tr>';
 }).join('');
 return pageHead('WORKSPACE · OPERAÇÃO','Relatório operacional diário','Acompanhe pedidos por data, compare lojas e consulte a fila atual.', '<button type="button" class="btn btn-ghost" id="opReportRefresh" '+(opReportLoading?'disabled':'')+'>↻ '+(opReportLoading?'Consultando…':'Atualizar')+'</button><button type="button" class="btn btn-primary" id="opReportCsv" '+(!canShow?'disabled':'')+'>↓ Exportar CSV</button>')+
 '<section class="panel op-report-toolbar"><label>Período<select id="opReportDays" class="filter-control"><option value="7" '+(opReportDays===7?'selected':'')+'>Últimos 7 dias</option><option value="30" '+(opReportDays===30?'selected':'')+'>Últimos 30 dias</option></select></label><label>Loja<select id="opReportStore" class="filter-control"><option value="all">Todas as lojas</option>'+storeOptions+'</select></label><label>Dia do relatório<select id="opReportDay" class="filter-control">'+days.slice().reverse().map(r=>'<option value="'+esc(r.day)+'" '+(r.day===chosen?.day?'selected':'')+'>'+esc(opDateLabel(r.day))+'</option>').join('')+'</select></label><span class="small muted op-report-updated">'+(opReportLastUpdate?'Consultado às '+esc(opReportLastUpdate.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})):'Ainda não consultado')+'</span></section>'+
 (opReportError?'<div class="alert error" role="alert">'+esc(opReportError)+'</div>':'')+
 (opReportLoading?'<div class="panel loading-panel">Consultando vendas e situação atual nas lojas…</div>':'')+
 (failed.length?'<div class="notice">Consulta parcial: '+esc(failed.map(s=>firstCompanyName(s.company_name)+' ('+(s.error||'não conectada')+')').join(' · '))+'. Os totais podem estar incompletos.</div>':'')+
 cards+
 '<div class="section-row"><div><h2>Fila de separação atual</h2><p>Fotografia do momento, não o total processado durante o dia.</p></div><button class="btn btn-ghost" data-go="vendas">Abrir separação →</button></div>'+
 '<div class="grid op-report-stats">'+k('Aguardando separação',currentDay&&opReportQueue?opFmtNumber(pending.length):'—',currentDay?'Pedidos ainda pendentes':'Disponível somente para hoje','□')+k('Etiquetas impressas',currentDay&&opReportQueue?opFmtNumber(separated.length):'—',currentDay?'Atualmente na fila':'Não representa histórico','✓')+k('FLEX pendentes',currentDay&&opReportQueue?opFmtNumber(flex.length):'—',currentDay?'FLEX na fila atual':'Disponível somente para hoje','↗')+k('Lojas consultadas',opReportData?opFmtNumber(connected)+' / '+opFmtNumber(stores.length):'—','Resultado da consulta do período','▦')+'</div>'+
 '<div class="op-report-two"><section class="panel"><div class="panel-head"><h3>Histórico diário de pedidos</h3><span class="small muted">Data de criação no Mercado Livre</span></div><div class="op-report-chart">'+bars+'</div><div class="table-wrap"><table class="table"><thead><tr><th>Dia</th><th>Pedidos</th><th>Valor</th><th>Unidades</th><th>Cancelados*</th></tr></thead><tbody>'+timeline+'</tbody></table></div></section>'+
 '<section class="panel"><div class="panel-head"><h3>Lojas · '+esc(opDateLabel(chosen?.day))+'</h3></div><div class="table-wrap"><table class="table"><thead><tr><th>Loja</th><th>Pedidos</th><th>Valor</th><th>Conexão</th></tr></thead><tbody>'+storeRows+'</tbody></table></div><div class="small muted" style="margin-top:16px">* Cancelamentos indicam o estado atual dos pedidos criados naquela data; não necessariamente o dia do cancelamento.</div></section></div>'+
 '<div class="section-row"><div><h2>Pedidos do dia selecionado</h2><p>Últimos 12 pedidos encontrados na data.</p></div></div><section class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Pedido</th><th>Loja</th><th>Horário</th><th>Unidades</th><th>Valor</th><th>Status atual</th></tr></thead><tbody>'+ (dayOrders.map(o=>'<tr><td><b>#'+esc(o.id)+'</b></td><td>'+esc(firstCompanyName(o.company_name))+'</td><td>'+esc(o.date_created?new Date(o.date_created).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}):'—')+'</td><td>'+opFmtNumber(o.units)+'</td><td>'+opFmtMoney(o.total_amount)+'</td><td>'+esc(o.status_label||o.status||'—')+'</td></tr>').join('')||'<tr><td colspan="6" class="muted">Nenhum pedido encontrado para a data e loja selecionadas.</td></tr>')+'</tbody></table></div></section>'+
 '<div class="notice op-report-note"><b>Sobre os dados:</b> o histórico é calculado a partir de pedidos criados no período consultado, com seus status atuais. Não equivale a um registro histórico das mudanças de status. Tempo médio de separação, total de pedidos efetivamente separados no dia e produtividade por funcionário ainda exigem eventos de início/conclusão gravados no banco. Nenhum desses indicadores é estimado.</div>';
}
function initOperationalReport(){
 const days=$('opReportDays');if(!days)return;
 days.onchange=()=>{opReportDays=Number(days.value)===30?30:7;opReportDay='';opReportData=null;loadOperationalReport(true);};
 $('opReportStore').onchange=e=>{opReportStore=e.target.value;renderPage();};
 $('opReportDay').onchange=e=>{opReportDay=e.target.value;renderPage();};
 $('opReportRefresh').onclick=()=>loadOperationalReport(true);
 $('opReportCsv').onclick=exportOperationalReportCsv;
 document.querySelectorAll('[data-op-day]').forEach(b=>b.onclick=()=>{opReportDay=b.dataset.opDay;renderPage();});
 if(!opReportLoading&&(!opReportData&&!opReportError||(opReportLastUpdate&&Date.now()-opReportLastUpdate.getTime()>120000)))loadOperationalReport(true);
}
function exportOperationalReportCsv(){
 if(!opReportData)return;
 const records=opReportDailyRows();
 const rows=[['Data','Pedidos criados não cancelados','Valor dos pedidos (BRL)','Unidades','Pedidos atualmente cancelados'],...records.map(r=>[opDateLabel(r.day),r.orders,r.revenue.toFixed(2).replace('.',','),r.units,r.cancelled])];
 const csv='\ufeff'+rows.map(row=>row.map(opSafeCsv).join(';')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
 const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='relatorio-operacional-'+opToday()+'.csv';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
