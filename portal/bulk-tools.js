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
'<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button type="button" id="mlbtClonePreview" class="btn btn-primary">Consultar e revisar</button><button type="button" id="mlbtCloneClear" class="btn" hidden>Limpar anúncios</button></div>',
'<div id="mlbtCloneStatus" class="mlsh-tools-status" aria-live="polite"></div><div id="mlbtCloneList" class="mlsh-tools-selection" hidden></div>',
'<label class="mlsh-tools-confirm" id="mlbtCloneConsentWrap" hidden><input type="checkbox" id="mlbtCloneConsent"> Confirmo que os produtos selecionados correspondem aos anúncios e, quando houver catálogo, à ficha técnica do catálogo. Autorizo a publicação na conta de destino.</label>',
'<button type="button" id="mlbtCloneApply" class="btn btn-primary" hidden disabled>Confirmar clonagem</button></section>',
'<section class="mlsh-tool-card"><h4>▣ Dimensões em massa por categoria</h4><p>Defina as dimensões da embalagem real. Não inclui anúncios Full.</p>',
'<label>Conta Mercado Livre<select id="mlbtDimAccount"><option value="">Carregando contas...</option></select></label>',
'<div class="mlbt-dim-category"><label>Buscar categoria<input id="mlbtCategory" type="search" autocomplete="off" placeholder="Digite: celular, fonte, notebook..." disabled></label><div id="mlbtCategoryPath" class="mlbt-category-suggestions" role="listbox" hidden></div><small id="mlbtCategoryHint">Selecione a conta e digite pelo menos 2 letras para ver sugestões.</small></div>',
'<div class="mlsh-tool-dimgrid">',
'<label>Altura (cm)<input id="mlbtHeight" type="number" min="1" max="300" placeholder="15"></label>',
'<label>Largura (cm)<input id="mlbtWidth" type="number" min="1" max="300" placeholder="20"></label>',
'<label>Comprimento (cm)<input id="mlbtLength" type="number" min="1" max="300" placeholder="30"></label>',
'<label>Peso (g)<input id="mlbtWeight" type="number" min="1" max="100000" placeholder="800"></label></div>',
'<label>Limite da busca<select id="mlbtLimit"><option value="20">20 anúncios</option><option value="50" selected>50 anúncios</option><option value="100">100 anúncios</option></select></label>',
'<button type="button" id="mlbtDimPreview" class="btn btn-primary">Buscar anúncios da categoria</button>',
'<div id="mlbtDimStatus" class="mlsh-tools-status" aria-live="polite"></div>',
'<div id="mlbtDimSelectionBar" class="mlbt-dim-selection-bar" hidden><strong id="mlbtDimSelectedCount">0 selecionados</strong><div><button type="button" id="mlbtDimSelectAll" class="mlbt-dim-secondary">Selecionar até 50</button><button type="button" id="mlbtDimSelectNone" class="mlbt-dim-secondary">Desmarcar todos</button><button type="button" id="mlbtDimClear" class="mlbt-dim-secondary">Limpar resultados</button></div></div>',
'<div id="mlbtDimList" class="mlsh-tools-selection mlbt-dim-list" hidden></div>',
'<label class="mlsh-tools-confirm" id="mlbtDimConsentWrap" hidden><input type="checkbox" id="mlbtDimConsent"> Confirmo as medidas e os anúncios selecionados.</label>',
'<button type="button" id="mlbtDimApply" class="btn btn-primary" hidden disabled>Aplicar dimensões</button></section></div></section>'
 ].join('');
}
function setStatus(id,value,error){const el=q(id);if(el){el.textContent=String(value||'');el.dataset.error=error?'true':'false'}}
function value(id){return String(q(id)?.value||'').trim()}
function resetClone(){state.clone=null;q('mlbtCloneConsent').checked=false;q('mlbtCloneApply').hidden=true;q('mlbtCloneApply').disabled=true;q('mlbtCloneConsentWrap').hidden=true;setStatus('mlbtCloneStatus','')}
function resetDim(){state.dimensions=null;q('mlbtDimConsent').checked=false;q('mlbtDimApply').hidden=true;q('mlbtDimApply').disabled=true;q('mlbtDimConsentWrap').hidden=true;q('mlbtDimSelectionBar').hidden=true;q('mlbtDimList').hidden=true;q('mlbtDimList').replaceChildren();setStatus('mlbtDimStatus','')}
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
 const dimReq=()=>({account_id:value('mlbtDimAccount'),category_id:state.dimCategory||'',dimensions:{height:Number(value('mlbtHeight')),width:Number(value('mlbtWidth')),length:Number(value('mlbtLength')),weight:Number(value('mlbtWeight'))}});
 for(const id of ['mlbtSource','mlbtTarget','mlbtItem','mlbtStock'])q(id).addEventListener('input',resetClone);
 q('mlbtLimit').addEventListener('input',resetDim);
 for(const id of ['mlbtHeight','mlbtWidth','mlbtLength','mlbtWeight'])q(id).addEventListener('input',resetDim);
 let categoryEpoch=0,categoryTimer=null;
 const categoryInput=q('mlbtCategory'),suggestions=q('mlbtCategoryPath'),hint=q('mlbtCategoryHint');
 function clearCategorySuggestions(){suggestions.replaceChildren();suggestions.hidden=true}
 categoryInput.oninput=()=>{
  const epoch=++categoryEpoch;
  if(categoryTimer)clearTimeout(categoryTimer);
  state.dimCategory='';resetDim();clearCategorySuggestions();
  const query=categoryInput.value.trim();
  if(!value('mlbtDimAccount')||query.length<2){hint.textContent='Digite pelo menos 2 letras para buscar categorias.';return}
  hint.textContent='Procurando sugestões...';
  categoryTimer=setTimeout(async()=>{
   try{
    const url='/api/portal/bulk-tools/dimensions/category-search?account_id='+encodeURIComponent(value('mlbtDimAccount'))+'&q='+encodeURIComponent(query);
    const data=await api(url);
    if(epoch!==categoryEpoch||!root.isConnected)return;
    for(const category of data.categories||[]){
     const option=document.createElement('button');option.type='button';option.className='mlbt-category-option';option.setAttribute('role','option');
     const title=document.createElement('strong');title.textContent=category.name;
     const subtitle=document.createElement('small');subtitle.textContent=[category.domain_name,category.id].filter(Boolean).join(' · ');
     option.append(title,subtitle);
     option.onclick=()=>{++categoryEpoch;categoryInput.value=category.name;state.dimCategory=category.id;clearCategorySuggestions();resetDim();hint.textContent='Categoria selecionada: '+category.name+'. Pronto para buscar anúncios.'};
     suggestions.append(option);
    }
    suggestions.hidden=!suggestions.children.length;
    hint.textContent=suggestions.hidden?'Nenhuma sugestão encontrada. Tente um termo mais específico.':'Selecione uma das categorias sugeridas.';
   }catch(e){if(epoch===categoryEpoch)hint.textContent='Não foi possível buscar categorias: '+e.message}
  },300);
 };
 q('mlbtDimAccount').onchange=()=>{
  ++categoryEpoch;if(categoryTimer)clearTimeout(categoryTimer);
  resetDim();state.dimCategory='';categoryInput.value='';clearCategorySuggestions();
  categoryInput.disabled=!value('mlbtDimAccount');
  hint.textContent=categoryInput.disabled?'Selecione primeiro uma conta.':'Digite o nome da categoria e escolha uma sugestão.';
 };
 q('mlbtCloneConsent').onchange=()=>q('mlbtCloneApply').disabled=!q('mlbtCloneConsent').checked;
 q('mlbtDimConsent').onchange=()=>updateDimSelected();
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
 function updateDimSelected(){
  const selected=root.querySelectorAll('.mlbtDimItem:checked').length;
  q('mlbtDimSelectedCount').textContent=selected+' selecionado(s) · máximo 50';
  q('mlbtDimApply').disabled=!state.dimensions||selected<1||selected>50||!q('mlbtDimConsent').checked;
 }
 q('mlbtDimList').addEventListener('change',e=>{if(e.target.matches('.mlbtDimItem'))updateDimSelected()});
 q('mlbtDimSelectAll').onclick=()=>{q('mlbtDimList').querySelectorAll('.mlbtDimItem').forEach((el,i)=>el.checked=i<50);updateDimSelected()};
 q('mlbtDimSelectNone').onclick=()=>{q('mlbtDimList').querySelectorAll('.mlbtDimItem').forEach(el=>el.checked=false);updateDimSelected()};
 q('mlbtDimClear').onclick=resetDim;
 previewDim.onclick=async()=>{
  await accountTask;resetDim();const req=dimReq();
  if(!req.account_id||!/^MLB\d+$/.test(req.category_id)){setStatus('mlbtDimStatus','Selecione a conta e a categoria final pelo nome.',true);return}
  disableWhile(previewDim,true,'Consultando...');
  try{
   const response=await api('/api/portal/bulk-tools/dimensions/preview',{method:'POST',body:JSON.stringify({...req,limit:Number(value('mlbtLimit'))})});
   if(!root.isConnected)return;
   if(JSON.stringify(req)!==JSON.stringify(dimReq()))return; // Dados alterados durante a consulta.
   state.dimensions=req;
   const list=q('mlbtDimList');list.replaceChildren();
   const formatDims=d=>d?([d.height,d.width,d.length].join(' × ')+' cm · '+d.weight+' g'):'Não informadas';
   for(const [index,item] of (response.items||[]).entries()){
    const label=document.createElement('label');label.className='mlsh-tools-item mlbt-dim-item';
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=item.id;checkbox.className='mlbtDimItem';checkbox.checked=index<50;
    const content=document.createElement('span');content.className='mlbt-dim-item-main';
    const title=document.createElement('strong');title.textContent=item.title||item.id;
    const meta=document.createElement('small');meta.textContent=item.id+(item.sku?' · SKU '+item.sku:'')+' · '+(item.status==='active'?'Ativo':'Pausado');
    const comparison=document.createElement('span');comparison.className='mlbt-dim-compare';
    const before=document.createElement('span');before.textContent='Atual: '+formatDims(item.dimensions);
    const after=document.createElement('span');after.textContent='Nova: '+formatDims(req.dimensions);
    comparison.append(before,after);content.append(title,meta,comparison);label.append(checkbox,content);list.append(label);
   }
   const count=(response.items||[]).length;
   setStatus('mlbtDimStatus',count+' anúncio(s) com medidas diferentes entre '+(response.scanned||0)+' consultado(s). '+(response.alreadyMatching||0)+' já estão corretos, '+(response.skipped||[]).length+' ignorados.'+(response.limitReached?' Busca limitada aos primeiros '+value('mlbtLimit')+' anúncios.':'')+' Selecione apenas os que deseja alterar.');
   list.hidden=!count;q('mlbtDimSelectionBar').hidden=!count;q('mlbtDimConsentWrap').hidden=!count;q('mlbtDimApply').hidden=!count;
   updateDimSelected();
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
