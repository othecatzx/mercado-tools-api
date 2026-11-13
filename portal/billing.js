let billingData=null,billingLoading=false,billingError='',billingBusy=false,billingSeq=0,billingPlan='',billingTarget='new',billingCompany='',billingRequestKey=null;
function resetBilling(){billingSeq++;billingData=null;billingLoading=false;billingError='';billingBusy=false;billingPlan='';billingTarget='new';billingCompany='';billingRequestKey=null;}
const billingMoney=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const billingDate=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—';
function billingMarkup(){
 const d=billingData,plans=d?.plans||[],licenses=(d?.licenses||[]).filter(l=>!l.has_subscription),history=d?.checkouts||[];
 const active=plans.find(p=>p.id===billingPlan),ready=Boolean(d?.purchases_enabled);
 const labels={pending:'Aguardando confirmação',paid:'Pagamento confirmado',cancelled:'Checkout cancelado',expired:'Checkout expirado'};
 const returned=new URLSearchParams(location.search).get('billing_return');
 return pageHead('SUA CONTA','Planos e pagamentos','Escolha um plano e acompanhe a liberação das suas licenças.','<button type="button" class="btn btn-ghost" id="billingRefresh" '+(billingLoading||billingBusy?'disabled':'')+'>'+(billingLoading?'Atualizando…':'Atualizar situação')+'</button>')+
  (billingError?'<div class="alert error" role="alert">'+esc(billingError)+'</div>':'')+
  (returned?'<div class="notice">'+esc(returned==='success'?'Você voltou do checkout. A licença será liberada somente após a confirmação do Asaas. Atualize a situação para acompanhar.':returned==='cancelled'?'O checkout foi cancelado. Nenhuma licença é liberada somente pelo retorno da página.':'O checkout expirou. Confira o histórico antes de iniciar outra compra.')+'</div>':'')+
  (d&&!ready?'<div class="notice billing-setup"><b>'+(d.environment==='sandbox'?'Ambiente de testes':'Compras ainda não liberadas')+'</b><p>'+(d.environment==='sandbox'?'O Asaas está em Sandbox. Compras de clientes ficam desativadas até configurar e validar o ambiente de produção.':'A integração precisa ser configurada pelo administrador antes de receber novas compras.')+'</p></div>':'')+
  '<div class="billing-plans">'+(plans.map(p=>'<button type="button" class="panel billing-plan '+(p.id===billingPlan?'selected':'')+'" data-billing-plan="'+esc(p.id)+'" aria-pressed="'+String(p.id===billingPlan)+'"><span class="billing-plan-name">'+esc(p.nome)+'</span><strong>'+billingMoney(p.preco)+'<small>/ mês</small></strong><p>'+esc(p.descricao||'Assinatura ML SH Support')+'</p><span class="badge">'+(p.id===billingPlan?'Selecionado':'Selecionar plano')+'</span></button>').join('')||'<div class="panel ops-empty">'+(billingLoading?'Carregando planos…':'Nenhum plano disponível.')+'</div>')+'</div>'+
  '<div class="billing-columns"><section class="panel"><div class="panel-head"><h3>Contratar ou renovar</h3></div><form id="billingForm"><label class="billing-field">Destino da assinatura<select id="billingTarget" '+(billingBusy?'disabled':'')+'><option value="new">Nova empresa</option>'+licenses.map(l=>'<option value="'+esc(l.id)+'" '+(l.id===billingTarget?'selected':'')+'>Renovar '+esc(l.company_name)+'</option>').join('')+'</select></label>'+
  (billingTarget==='new'?'<label class="billing-field">Nome da empresa<input id="billingCompany" value="'+esc(billingCompany)+'" maxlength="150" minlength="2" required placeholder="Ex.: Minha loja" '+(billingBusy?'disabled':'')+'></label>':'<p class="small muted">A renovação preserva o período que ainda resta na licença. Trocas de plano e assinaturas já existentes são tratadas pelo suporte.</p>')+
  '<div class="billing-total"><span>Assinatura mensal</span><b>'+(active?billingMoney(active.preco):'Selecione um plano')+'</b></div><p class="small muted">Pagamento recorrente por cartão de crédito. Os dados do cartão são informados na página segura do Asaas. A confirmação libera a licença no portal.</p><button type="submit" class="btn btn-primary" '+(!ready||!active||billingBusy?'disabled':'')+'>'+(billingBusy?'Preparando checkout…':'Continuar para pagamento →')+'</button></form></section><section class="panel billing-help"><h3>Como a liberação funciona</h3><ol><li>Entre na sua conta e escolha o plano.</li><li>Conclua o pagamento no Asaas.</li><li>A confirmação cria ou renova a licença.</li><li>Acesse sua chave em Minhas licenças.</li></ol><p class="small muted">A renovação automática acompanha os pagamentos confirmados da assinatura. Para cancelar uma assinatura, solicitar troca de plano ou tratar estorno, entre em contato com o suporte.</p><button type="button" class="btn btn-ghost" data-go="licenses">Minhas licenças →</button></section></div>'+
  ((d?.reviews||[]).length?'<section class="panel billing-reviews"><h3>Pagamentos que precisam de revisão</h3>'+(d.reviews||[]).map(e=>'<p>'+esc(e.reason||'Entre em contato com o suporte para revisar esta cobrança.')+'</p>').join('')+'</section>':'')+
  '<div class="section-row"><div><h2>Histórico de compras</h2><p>Últimos 50 checkouts vinculados à sua conta.</p></div></div><section class="panel"><div class="table-wrap"><table class="billing-table"><thead><tr><th>Empresa</th><th>Solicitação</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>'+(history.map(c=>'<tr><td><b>'+esc(c.company_name||'Empresa')+'</b></td><td>'+esc(billingDate(c.created_at))+'</td><td>'+billingMoney(c.expected_value)+'</td><td><span class="badge">'+esc(labels[c.status]||c.status)+'</span>'+(c.creation_error?'<p class="small muted">'+esc(c.creation_error)+'</p>':'')+'</td><td>'+(c.status==='pending'&&c.checkout_url&&d.purchases_enabled?'<button type="button" class="btn btn-ghost" data-billing-open="'+esc(c.id)+'">Continuar</button>':'')+'</td></tr>').join('')||'<tr><td colspan="5" class="ops-empty">Nenhuma compra registrada nesta conta.</td></tr>')+'</tbody></table></div></section>';
}
async function loadBilling(){
 if(billingLoading)return;const seq=++billingSeq,session=token;billingLoading=true;billingError='';if(currentPage==='billing')renderPage();
 try{const data=await api('/api/portal/billing');if(seq!==billingSeq||session!==token)return;billingData=data;if(!data.plans?.some(p=>p.id===billingPlan))billingPlan=data.plans?.[0]?.id||'';}
 catch(e){if(seq===billingSeq&&session===token)billingError=e.message;}
 finally{if(seq===billingSeq&&session===token){billingLoading=false;if(currentPage==='billing')renderPage();}}
}
function billingOpen(url){
 try{const parsed=new URL(url);if(parsed.origin!=='https://asaas.com'||parsed.pathname!=='/checkoutSession/show')throw Error();location.assign(parsed.href);}catch(e){toast('Link de pagamento inválido. Entre em contato com o suporte.');}
}
async function submitBilling(event){
 event.preventDefault();if(billingBusy||!billingData?.purchases_enabled)return;
 billingCompany=$('billingCompany')?.value.trim()||billingCompany;
 if(billingTarget==='new'&&billingCompany.length<2){toast('Informe o nome da empresa.');return;}
 billingRequestKey=billingRequestKey||crypto.randomUUID();const session=token;billingBusy=true;renderPage();
 try{const result=await api('/api/portal/billing/checkout',{method:'POST',body:JSON.stringify({plan_id:billingPlan,request_key:billingRequestKey,company_name:billingCompany,license_id:billingTarget==='new'?null:billingTarget})});if(session!==token)return;billingOpen(result.checkout_url);}
 catch(e){if(session===token)billingError=e.message;}
 finally{if(session===token){billingBusy=false;if(currentPage==='billing')renderPage();}}
}
function initBilling(){
 if($('billingRefresh'))$('billingRefresh').onclick=()=>{billingRequestKey=null;loadBilling();};
 if($('billingForm'))$('billingForm').onsubmit=submitBilling;
 if($('billingCompany'))$('billingCompany').oninput=e=>{billingCompany=e.target.value;billingRequestKey=null;};
 if($('billingTarget'))$('billingTarget').onchange=e=>{billingTarget=e.target.value;billingRequestKey=null;const license=(billingData?.licenses||[]).find(l=>l.id===billingTarget);if(license?.plan_id)billingPlan=license.plan_id;renderPage();};
 document.querySelectorAll('[data-billing-plan]').forEach(button=>button.onclick=()=>{if(billingBusy)return;billingPlan=button.dataset.billingPlan;billingRequestKey=null;renderPage();});
 document.querySelectorAll('[data-billing-open]').forEach(button=>button.onclick=()=>{const checkout=billingData?.checkouts?.find(c=>c.id===button.dataset.billingOpen);if(checkout?.checkout_url)billingOpen(checkout.checkout_url);});
 if(!billingData&&!billingLoading&&!billingError)loadBilling();
}
