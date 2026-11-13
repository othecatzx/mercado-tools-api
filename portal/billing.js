let billingData=null,billingLoading=false,billingError='',billingBusy=false,billingSeq=0,billingSelected=new Set(),billingPeriod=1,billingQuote=null,billingQuoteToken='',billingRequestKey='';
function resetBilling(){billingSeq++;billingData=null;billingLoading=false;billingError='';billingBusy=false;billingSelected=new Set();billingPeriod=1;billingQuote=null;billingQuoteToken='';billingRequestKey='';}
const billingMoney=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const billingDay=v=>v?new Date(String(v).length===10?v+'T12:00:00-03:00':v).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Sem vencimento';
function billingInvalidate(){billingSeq++;billingQuote=null;billingQuoteToken='';billingRequestKey='';billingError='';}
function billingMarkup(){
 const rows=billingData?.licenses||[],today=new Date();
 const expiring=rows.filter(l=>l.expires_at&&new Date(l.expires_at)>today&&new Date(l.expires_at)-today<=30*86400000).length;
 const expired=rows.filter(l=>l.expires_at&&new Date(l.expires_at)<=today).length;
 const period=(billingData?.periods||[]).find(p=>p.months===billingPeriod);
 const returned=new URLSearchParams(location.search).get('billing_return');
 return pageHead('MINHAS LICENÇAS','Vencimentos e renovação','Selecione as empresas para renovar juntas, com uma única data de vencimento.','<button class="btn btn-ghost" id="billingRefresh" '+(billingLoading||billingBusy?'disabled':'')+'>'+(billingLoading?'Atualizando…':'Atualizar licenças')+'</button>')+
 (billingError?'<div class="alert error" role="alert">'+esc(billingError)+'</div>':'')+
 (returned?'<div class="notice">'+(returned==='success'?'O pagamento está sendo conferido. Atualize as licenças para confirmar os novos vencimentos.':'O pagamento não foi concluído. Confira os vencimentos antes de tentar novamente.')+'</div>':'')+
 '<div class="renew-stats"><div class="panel"><b>'+rows.length+'</b><span>Licenças registradas</span></div><div class="panel"><b>'+expiring+'</b><span>Vencem em até 30 dias</span></div><div class="panel"><b>'+expired+'</b><span>Expiradas</span></div></div>'+
 '<section class="panel"><div class="panel-head"><h3>Suas empresas</h3><label class="renew-select-all"><input type="checkbox" id="billingSelectAll" '+(billingBusy?'disabled':'')+'> Selecionar disponíveis</label></div><div class="table-wrap"><table class="renew-table"><thead><tr><th></th><th>Empresa</th><th>Vencimento atual</th><th>Situação</th></tr></thead><tbody>'+
 (rows.map(l=>{const past=l.expires_at&&new Date(l.expires_at)<=today;return '<tr><td><input type="checkbox" data-renew-license="'+esc(l.id)+'" aria-label="Selecionar '+esc(l.company_name)+'" '+(billingSelected.has(l.id)?'checked':'')+' '+(!l.can_renew||billingBusy?'disabled':'')+'></td><td><b>'+esc(l.company_name)+'</b></td><td>'+esc(billingDay(l.expires_at))+'</td><td><span class="badge '+(past?'warn':'')+'">'+esc(!l.can_renew?'Consulte o administrador':past?'Expirada':new Date(l.expires_at)-today<=30*86400000?'Próxima do vencimento':'Válida')+'</span></td></tr>';}).join('')||'<tr><td colspan="4" class="ops-empty">'+(billingLoading?'Carregando licenças…':'Registre uma licença para acompanhar o vencimento e renovar.')+'</td></tr>')+
 '</tbody></table></div></section><section class="panel renew-box"><div><div class="eyebrow">'+esc(billingData?.product||'ML SH Support')+' · PLANO ÚNICO</div><h3>Renovar empresas selecionadas</h3><p class="small muted">As mesmas funções nos três períodos. O tempo que já está pago em cada licença é preservado no cálculo.</p></div><div class="renew-controls"><label>Período<select id="billingPeriod" class="filter-control" '+(billingBusy?'disabled':'')+'>'+(billingData?.periods||[{months:1,label:'Mensal'},{months:6,label:'Semestral'},{months:12,label:'Anual'}]).map(p=>'<option value="'+p.months+'" '+(p.months===billingPeriod?'selected':'')+'>'+esc(p.label)+'</option>').join('')+'</select></label><button type="button" class="btn btn-primary" id="billingCalculate" '+(!billingSelected.size||!period?.configured||billingBusy?'disabled':'')+'>'+(billingBusy?'Aguarde…':'Calcular renovação de '+billingSelected.size+' empresa(s)')+'</button></div>'+
 (billingData&&!period?.configured?'<p class="small muted">O valor deste período ainda será definido pelo administrador.</p>':'')+
 (billingQuote?'<div class="renew-quote"><div class="renew-common"><div><span>Novo vencimento de todas as empresas</span><strong>'+esc(billingDay(billingQuote.target_date))+'</strong></div><div><span>Pagamento único</span><strong>'+billingMoney(billingQuote.total)+'</strong></div></div><div class="table-wrap"><table class="renew-table"><thead><tr><th>Empresa</th><th>Vencimento atual</th><th>Dias adicionais</th><th>Valor proporcional</th></tr></thead><tbody>'+billingQuote.items.map(i=>'<tr><td>'+esc(i.company_name)+'</td><td>'+esc(billingDay(i.base_expiry))+'</td><td>'+i.days+'</td><td><b>'+billingMoney(i.amount)+'</b></td></tr>').join('')+'</tbody></table></div><p class="small muted">A data única é um período após o maior vencimento selecionado. O valor considera apenas os dias acrescentados a cada licença. Referência: '+billingMoney(billingQuote.period_price)+' por '+billingQuote.reference_days+' dias.</p><button type="button" id="billingPay" class="btn btn-primary" '+(!billingData?.purchases_enabled||billingBusy?'disabled':'')+'>Gerar pagamento único →</button>'+(!billingData?.purchases_enabled?'<p class="small muted">A geração de pagamentos ainda não foi liberada pelo administrador.</p>':'')+'</div>':'')+'</section>';
}
async function loadBilling(){
 if(billingLoading)return;const seq=++billingSeq,session=token;billingLoading=true;billingError='';if(currentPage==='billing')renderPage();
 try{const data=await api('/api/portal/billing');if(seq!==billingSeq||session!==token)return;billingData=data;billingSelected=new Set([...billingSelected].filter(id=>data.licenses.some(l=>l.id===id&&l.can_renew)));billingQuote=null;billingQuoteToken='';}
 catch(e){if(seq===billingSeq&&session===token)billingError=e.message;}
 finally{if(seq===billingSeq&&session===token){billingLoading=false;if(currentPage==='billing')renderPage();}}
}
async function calculateBilling(){
 if(billingBusy||!billingSelected.size)return;const seq=++billingSeq,session=token;billingBusy=true;billingError='';renderPage();
 try{const result=await api('/api/portal/billing/quote',{method:'POST',body:JSON.stringify({license_ids:[...billingSelected],period:billingPeriod})});if(seq!==billingSeq||session!==token)return;billingQuote=result.quote;billingQuoteToken=result.quote_token;billingRequestKey=crypto.randomUUID();}
 catch(e){if(seq===billingSeq&&session===token)billingError=e.message;}
 finally{if(seq===billingSeq&&session===token){billingBusy=false;if(currentPage==='billing')renderPage();}}
}
async function payBilling(){
 if(billingBusy||!billingQuoteToken||!billingData?.purchases_enabled)return;const session=token;billingBusy=true;billingError='';renderPage();
 try{const result=await api('/api/portal/billing/checkout',{method:'POST',body:JSON.stringify({quote_token:billingQuoteToken,request_key:billingRequestKey})});if(session!==token)return;const url=new URL(result.checkout_url);if(url.origin!=='https://asaas.com'||url.pathname!=='/checkoutSession/show')throw Error('Link de pagamento inválido.');location.assign(url.href);}
 catch(e){if(session===token)billingError=e.message;}
 finally{if(session===token){billingBusy=false;if(currentPage==='billing')renderPage();}}
}
function initBilling(){
 if($('billingRefresh'))$('billingRefresh').onclick=()=>{billingInvalidate();refreshDashboard().catch(()=>{});loadBilling();};
 document.querySelectorAll('[data-renew-license]').forEach(box=>box.onchange=()=>{if(box.checked)billingSelected.add(box.dataset.renewLicense);else billingSelected.delete(box.dataset.renewLicense);billingInvalidate();renderPage();});
 if($('billingSelectAll')){$('billingSelectAll').checked=!!billingData?.licenses?.filter(l=>l.can_renew).length&&billingData.licenses.filter(l=>l.can_renew).every(l=>billingSelected.has(l.id));$('billingSelectAll').onchange=e=>{billingSelected=new Set(e.target.checked?(billingData?.licenses||[]).filter(l=>l.can_renew).map(l=>l.id):[]);billingInvalidate();renderPage();};}
 if($('billingPeriod'))$('billingPeriod').onchange=e=>{billingPeriod=Number(e.target.value);billingInvalidate();renderPage();};
 if($('billingCalculate'))$('billingCalculate').onclick=calculateBilling;
 if($('billingPay'))$('billingPay').onclick=payBilling;
 if(!billingData&&!billingLoading&&!billingError)loadBilling();
}
