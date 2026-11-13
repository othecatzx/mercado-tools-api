/* Configuração e histórico. A execução pertence ao servidor. */
let automationData=null,automationLoading=false,automationError='',automationRequest=0,automationTimer=null,automationBusy=false;
function resetAutomations(){automationRequest++;automationData=null;automationError='';automationLoading=false;automationBusy=false;clearTimeout(automationTimer);automationTimer=null;}
const autoNumber=n=>Number(n||0).toLocaleString('pt-BR');
const autoMoney=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const autoDate=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';
const autoDay=v=>v?new Date(v+'T12:00:00-03:00').toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—';
function autoRunMarkup(run){
 const labels={queued:'Na fila',running:'Gerando',completed:'Concluído',partial:'Consulta parcial',failed:'Falhou'};
 const result=run.result;
 return '<article class="auto-run"><div class="auto-run-head"><div><strong>Vendas de '+esc(autoDay(run.report_day))+'</strong><p class="small muted">Solicitado em '+esc(autoDate(run.created_at))+(run.finished_at?' · Finalizado em '+esc(autoDate(run.finished_at)):'')+'</p></div><span class="badge '+(['partial','failed'].includes(run.status)?'warn':'')+'">'+esc(labels[run.status]||run.status)+'</span></div>'+
  (run.error?'<p class="auto-error">'+esc(run.error)+(run.status==='queued'?' Nova tentativa prevista para '+esc(autoDate(run.retry_at))+'.':'')+'</p>':'')+
  (result?'<div class="auto-result"><div><b>'+autoMoney(result.revenue)+'</b><span>Valor bruto dos pedidos</span></div><div><b>'+autoNumber(result.orders)+'</b><span>Pedidos não cancelados</span></div><div><b>'+autoNumber(result.units)+'</b><span>Unidades</span></div><div><b>'+autoNumber(result.cancelled)+'</b><span>Atualmente cancelados</span></div></div>'+
   '<details class="auto-details"><summary>Ver resultado por loja</summary><div class="table-wrap"><table class="ops-table"><thead><tr><th>Loja</th><th>Pedidos</th><th>Valor bruto</th><th>Consulta</th></tr></thead><tbody>'+(result.stores||[]).map(s=>'<tr><td><b>'+esc(s.name)+'</b></td><td>'+(s.connected?autoNumber(s.orders):'—')+'</td><td>'+(s.connected?autoMoney(s.revenue):'—')+'</td><td>'+esc(s.connected?'Concluída':s.error||'Indisponível')+'</td></tr>').join('')+'</tbody></table></div></details><p class="small muted">'+esc(result.definition)+'</p>':'<p class="small muted">'+(run.status==='failed'?'Confira as conexões e use Gerar resumo de ontem para tentar novamente.':'O resultado aparecerá aqui após a execução no servidor.')+'</p>')+'</article>';
}
function automationsMarkup(){
 const rule=automationData?.rule,runs=automationData?.runs||[],ready=!!automationData;
 return pageHead('AUTOMAÇÕES','Menos tarefas repetidas.','Configure uma rotina e acompanhe cada execução no portal.','<button type="button" class="btn btn-ghost" id="autoRefresh" '+(automationLoading?'disabled':'')+'>'+(automationLoading?'Atualizando…':'Atualizar histórico')+'</button>')+
  (automationError?'<div class="alert error" role="alert">'+esc(automationError)+'</div>':'')+
  '<div class="auto-layout"><section class="panel auto-config"><div class="auto-kicker">RELATÓRIOS · MODELO PRONTO</div><h2>Resumo diário de vendas</h2><p class="muted">Gere um fechamento do dia anterior, reunindo as lojas ativas e autorizadas da sua conta.</p><div class="auto-flow"><span>Todos os dias</span><span>→</span><span>Consultar lojas</span><span>→</span><span>Salvar resumo</span></div><form id="autoSettings"><label class="auto-switch"><input type="checkbox" id="autoEnabled" '+(rule?.enabled?'checked':'')+' '+(!ready||automationBusy?'disabled':'')+'><span>Ativar geração diária</span></label><label class="auto-time" for="autoTime">Horário da geração<input type="time" id="autoTime" value="'+esc(String(rule?.run_time||'08:00').slice(0,5))+'" required '+(!ready||automationBusy?'disabled':'')+'></label><p class="small muted">Horário de São Paulo. O resumo sempre considera o dia anterior, de 00h a 23h59.</p><button type="submit" class="btn btn-primary" '+(!ready||automationBusy?'disabled':'')+'>'+(automationBusy?'Salvando…':'Salvar configuração')+'</button></form><div class="auto-manual"><h3>Confira um resumo agora</h3><p class="small muted">Gere o resumo de ontem sem ativar o agendamento. Solicitações repetidas usam o mesmo registro; falhas ou consultas parciais podem ser tentadas novamente.</p><button type="button" class="btn btn-ghost" id="autoRun" '+(!ready||automationBusy?'disabled':'')+'>Gerar resumo de ontem →</button></div></section><section class="panel auto-explanation"><span class="badge">'+(rule?.enabled?'Agendamento ativo':'Agendamento pausado')+'</span><h3>Disponível mesmo com o navegador fechado</h3><p>A rotina roda no servidor e guarda o resultado para você consultar depois.</p><ul><li>Pedidos, unidades, valor bruto e cancelamentos por loja.</li><li>Dia completo no fuso de São Paulo.</li><li>Erros e consultas parciais ficam identificados.</li><li>Não envia mensagens nem altera anúncios.</li></ul><p class="small muted">Pausar impede novos agendamentos. Resumos já solicitados continuam na fila. O histórico mostra as últimas 30 execuções.</p></section></div>'+
  '<div class="section-row"><div><h2>Histórico de execuções</h2><p>Resultados salvos pela sua conta.</p></div><span class="badge">'+runs.length+' registros</span></div><section class="auto-history">'+(runs.length?runs.map(autoRunMarkup).join(''):'<div class="panel ops-empty">'+(automationLoading?'Carregando configurações e histórico…':'Nenhum resumo gerado. Use Gerar resumo de ontem para começar.')+'</div>')+'</section>';
}
async function loadAutomations(silent=false){
 if(automationLoading)return;const seq=++automationRequest,session=token;automationLoading=true;
 if(!silent){automationError='';if(currentPage==='automations')renderPage();}
 try{const data=await api('/api/portal/automations');if(seq!==automationRequest||session!==token)return;automationData=data;automationError='';}
 catch(e){if(seq===automationRequest&&session===token)automationError=e.message;}
 finally{if(seq===automationRequest&&session===token){automationLoading=false;if(currentPage==='automations')renderPage();}}
}
async function saveAutomation(event){
 event.preventDefault();if(automationBusy)return;
 const session=token;const body={enabled:$('autoEnabled').checked,run_time:$('autoTime').value};automationBusy=true;renderPage();
 try{await api('/api/portal/automations/daily-sales',{method:'PUT',body:JSON.stringify(body)});if(session!==token)return;toast('Configuração salva.');automationData=null;}
 catch(e){if(session===token)automationError=e.message;}
 finally{if(session!==token)return;automationBusy=false;if(!automationData)await loadAutomations();else if(currentPage==='automations')renderPage();}
}
async function runAutomation(){
 if(automationBusy)return;const session=token;automationBusy=true;renderPage();
 try{const result=await api('/api/portal/automations/daily-sales/run',{method:'POST',body:'{}'});if(session!==token)return;toast(result.message);automationData=null;}
 catch(e){if(session===token)automationError=e.message;}
 finally{if(session!==token)return;automationBusy=false;if(!automationData)await loadAutomations();else if(currentPage==='automations')renderPage();}
}
function initAutomations(){
 clearTimeout(automationTimer);automationTimer=null;
 if($('autoSettings'))$('autoSettings').onsubmit=saveAutomation;
 if($('autoRun'))$('autoRun').onclick=runAutomation;
 if($('autoRefresh'))$('autoRefresh').onclick=()=>loadAutomations();
 if(!automationData&&!automationLoading&&!automationError){loadAutomations();return;}
 if((automationData?.runs||[]).some(r=>['queued','running'].includes(r.status))){const session=token;automationTimer=setTimeout(()=>{if(currentPage==='automations'&&session===token&&!automationBusy)loadAutomations(true);},8000);}
}
