/* ML SH Support - clonagem entre contas e dimensoes por categoria */
(function(){
'use strict';
const q=id=>document.getElementById(id);
const state={clone:null,dimensions:null};
function markup(mode){
 return [
'<section class="mlsh-bulk-tools" data-tool="'+(mode||'clone')+'"><div class="mlsh-tools-head"><div><span>FERRAMENTAS MERCADO LIVRE</span><h3>'+ (mode==='clone'?'Clonagem entre contas':'Dimensões por categoria') +'</h3><p>'+ (mode==='clone'?'Revise os anúncios antes de publicar na conta de destino.':'Defina medidas reais e selecione os anúncios por categoria.') +'</p></div></div>',
'<div class="mlsh-tools-grid"><section class="mlsh-tool-card"><h4>⧉ Clonar anúncio entre contas</h4><p>Uma nova publicação na conta de destino após confirmação.</p>',
'<div class="mlbt-account-row"><label>Conta de origem<select id="mlbtSource"><option value="">Carregando contas...</option></select></label>',
'<label>Conta de destino<select id="mlbtTarget"><option value="">Carregando contas...</option></select></label></div>',
'<div class="mlbt-entry-row"><label>IDs de anúncios (até 20 por lote, com ou sem MLB)<textarea id="mlbtItem" rows="6" placeholder="MLB123456789&#10;MLB987654321" spellcheck="false"></textarea></label>',
'<label>Estoque inicial (por variação, quando houver)<input id="mlbtStock" type="number" min="1" max="99999" value="1"></label></div>',
'<p class="mlsh-tools-note">Selecione os anúncios da prévia e clique em <strong>Editar anúncio</strong> para personalizar título, família, preço, fotos e descrição.</p>',
'<p class="mlsh-tools-note">Dimensões e peso serão copiados automaticamente dos dados disponíveis no anúncio original. Nenhuma medida será inventada.</p>',
'<button type="button" id="mlbtClonePreview" class="btn btn-primary">Consultar e revisar</button>',
'<div id="mlbtCloneStatus" class="mlsh-tools-status" aria-live="polite"></div><div id="mlbtCloneList" class="mlsh-tools-selection" hidden></div>',
'<label class="mlsh-tools-confirm" id="mlbtCloneConsentWrap" hidden><input type="checkbox" id="mlbtCloneConsent"> Confirmo que os produtos selecionados correspondem aos anúncios e, quando houver catálogo, à ficha técnica do catálogo. Autorizo a publicação na conta de destino.</label>',
'<button type="button" id="mlbtCloneApply" class="btn btn-primary" hidden disabled>Confirmar clonagem</button></section>',
'<section class="mlsh-tool-card"><h4>▣ Dimensões em massa por categoria</h4><p>Defina as dimensões da embalagem real. Não inclui anúncios Full.</p>',
'<label>Conta Mercado Livre<select id="mlbtDimAccount"><option value="">Carregando contas...</option></select></label>',
'<label>ID da categoria<input id="mlbtCategory" placeholder="Ex.: MLB1234" autocomplete="off"></label>',
'<div class="mlsh-tool-dimgrid">',
'<label>Altura (cm)<input id="mlbtHeight" type="number" min="1" max="300" placeholder="15"></label>',
'<label>Largura (cm)<input id="mlbtWidth" type="number" min="1" max="300" placeholder="20"></label>',
'<label>Comprimento (cm)<input id="mlbtLength" type="number" min="1" max="300" placeholder="30"></label>',
'<label>Peso (g)<input id="mlbtWeight" type="number" min="1" max="100000" placeholder="800"></label></div>',
'<label>Limite da busca<select id="mlbtLimit"><option value="20">20 anúncios</option><option value="50" selected>50 anúncios</option><option value="100">100 anúncios</option></select></label>',
'<button type="button" id="mlbtDimPreview" class="btn btn-primary">Buscar anúncios da categoria</button>',
'<div id="mlbtDimStatus" class="mlsh-tools-status" aria-live="polite"></div>',
'<div id="mlbtDimList" class="mlsh-tools-selection" hidden></div>',
'<label class="mlsh-tools-confirm" id="mlbtDimConsentWrap" hidden><input type="checkbox" id="mlbtDimConsent"> Confirmo as medidas e os anúncios selecionados.</label>',
'<button type="button" id="mlbtDimApply" class="btn btn-primary" hidden disabled>Aplicar dimensões</button></section></div></section>'
 ].join('');
}
function setStatus(id,value,error){const el=q(id);if(el){el.textContent=String(value||'');el.dataset.error=error?'true':'false'}}
function value(id){return String(q(id)?.value||'').trim()}
function resetClone(){state.clone=null;q('mlbtCloneConsent').checked=false;q('mlbtCloneApply').hidden=true;q('mlbtCloneApply').disabled=true;q('mlbtCloneConsentWrap').hidden=true;setStatus('mlbtCloneStatus','')}
function resetDim(){state.dimensions=null;q('mlbtDimConsent').checked=false;q('mlbtDimApply').hidden=true;q('mlbtDimApply').disabled=true;q('mlbtDimConsentWrap').hidden=true;q('mlbtDimList').hidden=true;q('mlbtDimList').replaceChildren();setStatus('mlbtDimStatus','')}
function disableWhile(button,busy,text){button.disabled=busy;button.textContent=busy?text:button.dataset.original}
function init(config){
 const root=document.querySelector('.mlsh-bulk-tools');if(!root||!config?.api)return;
 const api=config.api;
 const previewClone=q('mlbtClonePreview'),previewDim=q('mlbtDimPreview');
 for(const btn of [previewClone,previewDim])btn.dataset.original=btn.textContent;
 const accountTask=(async()=>{
  try{
   const response=await api('/api/portal/bulk-tools/accounts');
   if(!root.isConnected)return;
   for(const id of ['mlbtSource','mlbtTarget','mlbtDimAccount']){
    const select=q(id);select.replaceChildren();
    const empty=document.createElement('option');empty.value='';empty.textContent='Selecione uma conta';select.append(empty);
    (response.accounts||[]).forEach(acc=>{
     const option=document.createElement('option');option.value=acc.ml_user_id;
     option.textContent=(acc.name||acc.company_name)+' · '+acc.company_name+' ('+acc.ml_user_id+')';
     select.append(option);
    });
   }
   if((response.accounts||[]).length<2)setStatus('mlbtCloneStatus','Conecte duas contas Mercado Livre para clonar.');
  }catch(e){setStatus('mlbtCloneStatus',e.message,true);setStatus('mlbtDimStatus',e.message,true)}
 })();
 const cloneReq=()=>({source_id:value('mlbtSource'),target_id:value('mlbtTarget'),item_id:value('mlbtItem').toUpperCase(),stock:Number(value('mlbtStock'))});
 const dimReq=()=>({account_id:value('mlbtDimAccount'),category_id:value('mlbtCategory').toUpperCase(),dimensions:{height:Number(value('mlbtHeight')),width:Number(value('mlbtWidth')),length:Number(value('mlbtLength')),weight:Number(value('mlbtWeight'))}});
 for(const id of ['mlbtSource','mlbtTarget','mlbtItem','mlbtStock'])q(id).addEventListener('input',resetClone);
 for(const id of ['mlbtDimAccount','mlbtCategory','mlbtHeight','mlbtWidth','mlbtLength','mlbtWeight','mlbtLimit'])q(id).addEventListener('input',resetDim);
 q('mlbtCloneConsent').onchange=()=>q('mlbtCloneApply').disabled=!q('mlbtCloneConsent').checked;
 q('mlbtDimConsent').onchange=()=>q('mlbtDimApply').disabled=!q('mlbtDimConsent').checked;
 previewClone.onclick=async()=>{
  await accountTask;resetClone();const req=cloneReq();
  if(!req.source_id||!req.target_id||req.source_id===req.target_id){setStatus('mlbtCloneStatus','Selecione origem e destino diferentes.',true);return}
  disableWhile(previewClone,true,'Consultando...');
  try{
   const data=await api('/api/portal/bulk-tools/clone/preview',{method:'POST',body:JSON.stringify(req)});
   if(!root.isConnected)return;
   state.clone=req;
   const p=data.preview;
   setStatus('mlbtCloneStatus',[p.title,p.item_id,p.source_name+' → '+p.target_name,'R$ '+p.price,'Estoque '+p.stock,p.pictures+' foto(s)',p.warning].join(' · '));
   q('mlbtCloneConsentWrap').hidden=false;q('mlbtCloneApply').hidden=false;
  }catch(e){setStatus('mlbtCloneStatus',e.message,true)}
  finally{if(root.isConnected)disableWhile(previewClone,false)}
 };
 q('mlbtCloneApply').onclick=async()=>{
  if(!state.clone||!q('mlbtCloneConsent').checked)return;
  const btn=q('mlbtCloneApply');btn.disabled=true;btn.textContent='Publicando...';
  try{
   const data=await api('/api/portal/bulk-tools/clone/apply',{method:'POST',body:JSON.stringify({...state.clone,confirm:true})});
   if(!root.isConnected)return;
   setStatus('mlbtCloneStatus','Novo anúncio '+data.created_id+' criado. Descrição: '+data.description_status+'. Confira na conta de destino.');
   state.clone=null;q('mlbtCloneConsentWrap').hidden=true;btn.hidden=true;
  }catch(e){setStatus('mlbtCloneStatus',e.message,true);btn.disabled=false}
  finally{btn.textContent='Confirmar clonagem'}
 };
 previewDim.onclick=async()=>{
  await accountTask;resetDim();const req=dimReq();
  if(!req.account_id||!/^MLB\d+$/.test(req.category_id)){setStatus('mlbtDimStatus','Escolha a conta e informe um ID de categoria válido.',true);return}
  disableWhile(previewDim,true,'Consultando...');
  try{
   const response=await api('/api/portal/bulk-tools/dimensions/preview',{method:'POST',body:JSON.stringify({...req,limit:Number(value('mlbtLimit'))})});
   if(!root.isConnected)return;
   state.dimensions=req;
   const list=q('mlbtDimList');list.replaceChildren();
   for(const [index,item] of (response.items||[]).entries()){
    const label=document.createElement('label');label.className='mlsh-tools-item';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=item.id;checkbox.className='mlbtDimItem';checkbox.checked=index<50;
    const text=document.createElement('span');text.textContent=item.id+' · '+item.title+' ('+item.status+')';
    label.append(checkbox,text);list.append(label);
   }
   const count=(response.items||[]).length;
   setStatus('mlbtDimStatus',count+' anúncio(s) elegível(is), '+(response.skipped||[]).length+' ignorado(s). '+(response.limitReached?'Limite de busca atingido. ':'')+'Revise a seleção (máximo 50 por aplicação).');
   list.hidden=!count;q('mlbtDimConsentWrap').hidden=!count;q('mlbtDimApply').hidden=!count;
  }catch(e){setStatus('mlbtDimStatus',e.message,true)}
  finally{if(root.isConnected)disableWhile(previewDim,false)}
 };
 q('mlbtDimApply').onclick=async()=>{
  if(!state.dimensions||!q('mlbtDimConsent').checked)return;
  const item_ids=[...root.querySelectorAll('.mlbtDimItem:checked')].map(e=>e.value);
  if(!item_ids.length||item_ids.length>50){setStatus('mlbtDimStatus','Selecione de 1 a 50 anúncios.',true);return}
  const btn=q('mlbtDimApply');btn.disabled=true;btn.textContent='Aplicando...';
  try{
   const result=await api('/api/portal/bulk-tools/dimensions/apply',{method:'POST',body:JSON.stringify({...state.dimensions,item_ids,confirm:true})});
   if(!root.isConnected)return;
   const errors=(result.failed||[]).slice(0,5).map(x=>x.id+': '+x.error).join(' | ');
   setStatus('mlbtDimStatus',(result.success||[]).length+' confirmada(s), '+(result.pending||[]).length+' pendente(s) de verificação, '+(result.failed||[]).length+' falha(s). '+errors+' Confira no Mercado Livre.',(result.failed||[]).length>0||(result.pending||[]).length>0);
   state.dimensions=null;q('mlbtDimConsentWrap').hidden=true;btn.hidden=true;
  }catch(e){setStatus('mlbtDimStatus',e.message,true);btn.disabled=false}
  finally{btn.textContent='Aplicar dimensões'}
 };
}
window.mlshBulkTools={markup,init};
})();
