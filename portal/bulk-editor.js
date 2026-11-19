/* ML SH Support - editor de anuncios em massa */
(function(){
'use strict';
let rows=[],failures=[],busy=false,term='',results=[],resultPanelOpen=false;
const $=id=>document.getElementById(id), escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cols=[['company_name','Loja',155,true],['id','MLB',160,true],['sku','SKU',160,true],['title','Titulo',350],['price','Preco (R$)',120],['available_quantity','Estoque',100,true],['description','Descricao',330]];
const permitted=['title','price','description'];
const key=r=>r.company_id+'|'+r.id;
const secureImage=url=>{try{const x=new URL(String(url||''),location.origin);return x.protocol==='https:'?x.href:x.protocol==='http:'?('https://'+x.host+x.pathname+x.search):''}catch{return ''}};
const orig=r=>r.original||{};
const changed=r=>permitted.filter(c=>String(r[c]??'')!==String(orig(r)[c]??''));
const viewRows=()=>rows.filter(r=>!term||[r.id,r.company_name,r.sku,r.title].some(v=>String(v||'').toLowerCase().includes(term.toLowerCase())));
let inputDraft='';
let adjustmentMode='increase',adjustmentUnit='brl';
function parseAdjustmentValue(text){
 const raw=String(text??'').trim().replace(/\s/g,'');
 if(!raw)return NaN;
 // Aceita 12,50 / 12.50 / 1.234,56 (sem interpretação ambígua).
 const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;
 if(!/^(?:\d+)(?:\.\d+)?$/.test(normalized))return NaN;
 return Number(normalized);
}
function calculateAdjustedPrice(base,mode,unit,amount){
 const price=Number(base),value=Number(amount);
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(value)||value<=0)return null;
 if(!['increase','discount','fixed'].includes(mode)||!['brl','percent'].includes(unit))return null;
 if(mode==='discount'&&unit==='percent'&&value>=100)return null;
 if(unit==='percent'&&value>1000)return null;
 const next=mode==='fixed'?value:
   mode==='increase'?(unit==='percent'?price*(1+value/100):price+value):
   (unit==='percent'?price*(1-value/100):price-value);
 const rounded=Math.round((next+Number.EPSILON)*100)/100;
 return Number.isFinite(rounded)&&rounded>=0.01&&rounded<=999999999?rounded:null;
}
function adjustmentHelp(){
 const input=$('bulkAdjustValue'),button=$('bulkAdjustApply'),preview=$('bulkAdjustPreview');
 if(!input||!button||!preview)return;
 const amount=parseAdjustmentValue(input.value),count=rows.length;
 const eligible=rows.filter(r=>calculateAdjustedPrice(r.price,adjustmentMode,adjustmentUnit,amount)!==null);
 button.disabled=busy||!count||!Number.isFinite(amount)||amount<=0||eligible.length!==count;
 const hint=adjustmentMode==='fixed'?'Preço único em R$':adjustmentUnit==='percent'?'Percentual (%)':'Valor em reais (R$)';
 input.placeholder=adjustmentMode==='fixed'?'Digite o preço final (R$)':adjustmentUnit==='percent'?'Digite o percentual':'Digite o valor (R$) '+(adjustmentMode==='discount'?'a descontar':'a acrescer');
 preview.textContent=!count?'Adicione anúncios para realizar um reajuste.':
   !input.value.trim()?'O reajuste usa o preço atual da tabela; revise antes de aplicar.':
   eligible.length!==count?'Valor inválido: algum anúncio ficaria com preço menor que R$ 0,01 ou acima do limite.':
   count+' anúncio(s) elegível(is). Reajuste calculado sobre os preços atuais da tabela.';
 preview.dataset.error=input.value.trim()&&eligible.length!==count?'true':'false';
 $('bulkAdjustUnit').hidden=adjustmentMode==='fixed';
 input.setAttribute('aria-label',hint);
}
function applyAdjustment(){
 const input=$('bulkAdjustValue'),amount=parseAdjustmentValue(input?.value);
 if(busy||!rows.length||!Number.isFinite(amount)||amount<=0)return;
 const pending=rows.map(r=>({row:r,price:calculateAdjustedPrice(r.price,adjustmentMode,adjustmentUnit,amount)}));
 if(pending.some(p=>p.price===null)){adjustmentHelp();window.toast?.('Reajuste inválido para um ou mais anúncios.');return}
 let changedCount=0;
 for(const item of pending){
   if(Number(item.row.price)!==item.price)changedCount++;
   item.row.price=String(item.price.toFixed(2));
 }
 results=[];render();
 window.toast?.('Reajuste calculado para '+changedCount+' anúncio(s). Revise a tabela antes de aplicar.');
}
function initAdjustment(){
 const input=$('bulkAdjustValue'),options=$('bulkAdjustModes'),units=$('bulkAdjustUnit');
 if(!input||!options||!units)return;
 options.addEventListener('click',e=>{
   const button=e.target.closest('button[data-adjust-mode]');if(!button)return;
   adjustmentMode=button.dataset.adjustMode;
   options.querySelectorAll('button[data-adjust-mode]').forEach(b=>{
     const selected=b===button;b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));
   });
   adjustmentHelp();
 });
 units.addEventListener('click',e=>{
   const button=e.target.closest('button[data-adjust-unit]');if(!button)return;
   adjustmentUnit=button.dataset.adjustUnit;
   units.querySelectorAll('button[data-adjust-unit]').forEach(b=>{
     const selected=b===button;b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));
   });
   adjustmentHelp();
 });
 input.addEventListener('input',adjustmentHelp);
 $('bulkAdjustApply')?.addEventListener('click',applyAdjustment);
 adjustmentHelp();
}
function render(){
 const body=$('bulkRows');if(!body)return;
 if($('bulkClear'))$('bulkClear').disabled=busy||(!rows.length&&!failures.length&&!results.length);
 body.innerHTML=viewRows().map((r,i)=>'<tr data-key="'+escape(key(r))+'"><td class="bulk-num">'+(i+1)+'</td><td><img class="bulk-thumb" src="'+escape(secureImage(r.image))+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></td>'+cols.map(([k,label,w,locked])=>'<td class="'+(locked?'bulk-locked':'')+(changed(r).includes(k)?' bulk-changed':'')+'">'+(locked?'<span title="Somente leitura">'+escape(r[k]??'—')+'</span>':k==='status'?'<select data-field="'+k+'">'+[['active','Publicado'],['paused','Pausado']].map(([v,n])=>'<option value="'+v+'" '+(String(r[k])===v?'selected':'')+'>'+n+'</option>').join('')+'</select>':k==='description'?'<textarea data-field="'+k+'" rows="1" title="Clique para editar a descricao">'+escape(r[k]??'')+'</textarea>':'<input data-field="'+k+'" type="'+(['price','available_quantity'].includes(k)?'number':'text')+'" '+(k==='price'?'min="0.01" step="0.01"':k==='available_quantity'?'min="0" step="1"':'')+' value="'+escape(r[k]??'')+'" '+(k==='title'?'maxlength="60"':'')+'>')+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="9" class="bulk-empty">Nenhum anúncio carregado. Clique em Adicione os MLB\'s para começar.</td></tr>';
 $('bulkCount').textContent=rows.length+' anuncio(s) · '+rows.filter(r=>changed(r).length).length+' alterado(s)';
 $('bulkFailures').innerHTML=failures.map(f=>'<div class="bulk-error">'+escape(f.input)+': '+escape(f.error)+'</div>').join('');
 const countFor=status=>results.filter(r=>r.status===status).length;
 $('bulkResults').innerHTML=results.length?'<div class="bulk-result-summary"><div><strong>Resultado da edição em massa</strong><span>'+countFor('success')+' sincronizado(s) · '+countFor('error')+' erro(s) · '+countFor('skipped')+' ignorado(s)</span></div><button type="button" id="bulkViewDetails" class="btn btn-ghost">Ver detalhes</button></div>':'';
 $('bulkViewDetails')?.addEventListener('click',openResultPanel);
 $('bulkApply').disabled=busy||!rows.some(r=>changed(r).length);
 adjustmentHelp();
}
function markBusy(v){busy=v;['bulkSearch','bulkApply','bulkExport','bulkImport','bulkClear','bulkAdjustValue'].forEach(id=>{if($(id))$(id).disabled=v});adjustmentHelp();}
async function lookup(){
 const input=String($('bulkInputs').value||'').split(/[\n\r,;]+/).map(x=>x.trim()).filter(Boolean);
 if(!input.length){window.toast?.('Informe ao menos um MLB ou SKU.');return}
 if(input.length>100){window.toast?.('Limite de 100 codigos.');return}
 markBusy(true);$('bulkSearch').textContent='Consultando...';
 try{
 const data=await api('/api/portal/bulk-editor/preview',{method:'POST',body:JSON.stringify({inputs:[...new Set(input)]})});
 rows=(data.items||[]).map(r=>({...r,original:Object.fromEntries(permitted.map(k=>[k,r[k]??'']))}));
 closeBulkModal();
 failures=data.failed||[];results=[];render();window.toast?.(rows.length+' anuncio(s) encontrado(s).');
 }catch(e){window.toast?.(e.message||'Erro na consulta.')}
 finally{markBusy(false);$('bulkSearch').textContent='Buscar anuncios';render()}
}
function edit(ev){
 const field=ev.target.dataset.field, tr=ev.target.closest('tr[data-key]');
 if(!field||!tr)return;
 const row=rows.find(r=>key(r)===tr.dataset.key);if(!row)return;
 row[field]=ev.target.value;
 tr.querySelectorAll('[data-field]').forEach(el=>el.closest('td').classList.toggle('bulk-changed',changed(row).includes(el.dataset.field)));
 $('bulkCount').textContent=rows.length+' anuncio(s) · '+rows.filter(r=>changed(r).length).length+' alterado(s)';
 $('bulkApply').disabled=!rows.some(r=>changed(r).length);
 adjustmentHelp();
}
async function apply(){
 const selection=rows.filter(r=>changed(r).length).map(r=>({id:r.id,company_id:r.company_id,changes:Object.fromEntries(changed(r).map(c=>[c,r[c]]))}));
 if(!selection.length)return;
 const summary=selection.map(x=>x.id+' ('+Object.keys(x.changes).join(', ')+')').join('\n');
 if(!await showConfirmModal('Aplicar alteracoes em '+selection.length+' anuncio(s)?\n\n'+summary.slice(0,1400)))return;
 markBusy(true);results=[];render();
 for(let i=0;i<selection.length;i++){
  $('bulkApply').textContent='Aplicando '+(i+1)+'/'+selection.length;
  const item=selection[i];
  try{
   const r=await api('/api/portal/bulk-editor/apply',{method:'POST',body:JSON.stringify({items:[item]})});
   results.push(...(r.results||[]).map(result=>({
    ...result, company_id:item.company_id,
    title:rows.find(row=>row.id===item.id&&String(row.company_id)===String(item.company_id))?.title||item.id,
    sku:rows.find(row=>row.id===item.id&&String(row.company_id)===String(item.company_id))?.sku||'',
    company_name:rows.find(row=>row.id===item.id&&String(row.company_id)===String(item.company_id))?.company_name||''
   })));
   const ok=(r.results||[]).find(x=>x.status==='success');
   if(ok){const row=rows.find(x=>x.id===item.id&&String(x.company_id)===String(item.company_id));if(row)row.original=Object.fromEntries(permitted.map(k=>[k,row[k]??'']));}
  }catch(e){const row=rows.find(x=>x.id===item.id&&String(x.company_id)===String(item.company_id));results.push({id:item.id,status:'error',message:e.message||'Falha na atualizacao',company_id:item.company_id,title:row?.title||item.id,sku:row?.sku||'',company_name:row?.company_name||''})}
  render();
 }
 markBusy(false);$('bulkApply').textContent='Revisar e aplicar alteracoes';render();openResultPanel();
}
function downloadFile(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function exportExcel(){
 if(!rows.length)return;
 if(!window.XLSX){window.toast?.('Biblioteca Excel indisponivel.');return}
 // A coluna técnica oculta não contém MLB, loja, SKU ou estoque.
 // Serve apenas para impedir que uma planilha reordenada altere o anúncio errado.
 const headers=['Título','Preço','Descrição','__MLSH_REF'];
 const values=[headers,...rows.map(r=>{
  if(!r.exportToken)r.exportToken=crypto.randomUUID();
  return [r.title,Number(r.price),r.description||'',r.exportToken];
 })];
 const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(values);
 ws['!cols']=[{wch:65},{wch:15},{wch:80},{hidden:true}];
 XLSX.utils.book_append_sheet(wb,ws,'Anuncios');XLSX.writeFile(wb,'ml-sh-acoes-em-massa.xlsx');
}
async function importExcel(file){
 if(!file)return;
 if(!window.XLSX){window.toast?.('Biblioteca Excel indisponivel.');return}
 try{
 const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array'}),array=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
 const pending=[];let ignored=0;
 if(!array.length)throw new Error('Planilha vazia.');
 if(array.some(input=>!Object.hasOwn(input,'__MLSH_REF')))throw new Error('Use uma planilha exportada desta sessão. A coluna técnica oculta é necessária para identificar cada linha com segurança.');
 const seen=new Set(),updates=[];
 for(const input of array){
  const token=String(input.__MLSH_REF||'').trim();
  const matched=rows.filter(r=>r.exportToken===token);
  if(matched.length!==1||seen.has(token)){ignored++;continue}
  seen.add(token);
  const row=matched[0],mapping={'Título':'title','Preço':'price','Descrição':'description'};
  for(const [col,k] of Object.entries(mapping)){
   if(Object.hasOwn(input,col)&&String(input[col])!==String(row[k]??'')){
    updates.push({row,k,value:String(input[col])});
   }
  }
 }
 if(ignored)throw new Error(ignored+' linha(s) sem identificação válida ou repetida. Nenhuma alteração foi importada.');
 for(const update of updates){update.row[update.k]=update.value;pending.push(update.k)}
 results=[];render();window.toast?.('Planilha importada: '+pending.length+' célula(s) atualizada(s). Revise antes de aplicar.');
 }catch(e){window.toast?.('Erro ao importar: '+e.message)}
 finally{$('bulkImportFile').value=''}
}
function openBulkModal(){
 const modal=$('bulkModal');if(!modal)return;
 modal.hidden=false;document.body.classList.add('bulk-modal-open');
 const area=$('bulkInputs');area.value=inputDraft;area.focus();
}
function closeBulkModal(){
 const modal=$('bulkModal');if(!modal)return;
 inputDraft=$('bulkInputs')?.value||inputDraft;
 modal.hidden=true;document.body.classList.remove('bulk-modal-open');
}
function clearBulkList(){
 if(busy)return;
 rows=[];failures=[];results=[];term='';inputDraft='';closeResultPanel(); if($('bulkInputs'))$('bulkInputs').value='';
 if($('bulkImportFile'))$('bulkImportFile').value='';
 render();
 window.toast?.('Lista limpa. Nenhum anúncio do Mercado Livre foi alterado.');
}
function cancelBulkEditor(){
 if(busy)return;
 closeBulkModal();
 clearBulkList();
}
function openResultPanel(){
 if(!results.length)return;
 resultPanelOpen=true;
 const overlay=$('bulkResultOverlay');if(!overlay)return;
 const counts={success:0,error:0,warning:0,skipped:0};
 results.forEach(r=>{if(Object.hasOwn(counts,r.status))counts[r.status]++});
 $('bulkResultSummary').innerHTML=
  '<div class="bulk-result-hero"><div class="bulk-result-hero-mark">M</div><div><span>PROCESSAMENTO CONCLUÍDO</span><strong>'+results.length+' anúncio(s) processado(s)</strong><small>Confira abaixo o resultado de cada alteração realizada.</small></div></div>'+
  '<div class="bulk-result-stats">'+
  [['success','check-circle','Aplicados'],['error','alert-circle','Com erro'],['warning','alert-triangle','Avisos'],['skipped','minus-circle','Ignorados']]
    .map(([status,icon,label])=>'<div class="bulk-result-stat '+status+'"><span>'+label+'</span><strong>'+counts[status]+'</strong></div>').join('')+
  '</div>';
 $('bulkResultGroups').innerHTML=[
  ['success','Atualizados com sucesso','success',true],
  ['error','Atualizações com erro','error',true],
  ['warning','Atualizações com aviso','warning',true],
  ['skipped','Sem alterações','skipped',false]
 ].map(([status,label,cls,expanded])=>{
  const items=results.filter(r=>r.status===status);
  if(!items.length)return '';
  return '<details class="bulk-result-group '+cls+'" '+(expanded?'open':'')+'><summary><span class="bulk-result-heading"><span class="bulk-status-dot"></span>'+label+'</span><span class="bulk-result-right"><span class="bulk-result-number">'+items.length+'</span><span class="bulk-result-chevron">⌄</span></span></summary><div class="bulk-result-items">'+items.map(r=>
   '<article class="bulk-result-item"><div class="bulk-result-item-main"><strong>'+escape(r.title||r.id||'Anúncio')+'</strong><span class="bulk-item-state '+cls+'">'+(cls==='success'?'Concluído':cls==='error'?'Falhou':cls==='warning'?'Aviso':'Ignorado')+'</span></div>'+
   '<div class="bulk-result-item-info"><span><small>MLB</small>'+escape(r.id||'')+'</span><span><small>SKU</small>'+escape(r.sku||'Não informado')+'</span><span><small>Loja</small>'+escape(r.company_name||'Não informada')+'</span></div>'+
   (r.message?'<div class="bulk-result-item-note">'+escape(r.message)+'</div>':'')+'</article>').join('')+'</div></details>';
 }).join('')||'<p>Nenhum resultado.</p>';
 overlay.hidden=false;document.body.classList.add('bulk-results-open');
 $('bulkResultClose')?.focus();
}
function finishBulkResults(){
 closeResultPanel();
 clearBulkList();
}
function closeResultPanel(){
 resultPanelOpen=false;
 const overlay=$('bulkResultOverlay');if(overlay)overlay.hidden=true;
 document.body.classList.remove('bulk-results-open');
}
function downloadResultReport(){
 if(!results.length)return;
 if(!window.XLSX){window.toast?.('Biblioteca Excel indisponível.');return}
 const data=[['Resultado','Anúncio','SKU','MLB','Loja','Mensagem'],
 ...results.map(r=>[r.status==='success'?'Sucesso':r.status==='error'?'Erro':r.status==='warning'?'Aviso':'Ignorado',r.title||'',r.sku||'',r.id||'',r.company_name||'',r.message||''])];
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(data);
 sheet['!cols']=[{wch:16},{wch:65},{wch:26},{wch:20},{wch:32},{wch:85}];
 XLSX.utils.book_append_sheet(book,sheet,'Resultados');
 XLSX.writeFile(book,'ml-sh-resultado-edicao-em-massa.xlsx');
}
function markup(){
 return pageHead('FERRAMENTAS','Ações em massa','Edite títulos, preços e descrições diretamente nas células, como no Excel.')+
 '<section class="panel bulk-panel"><div class="bulk-head"><div><h3>Editor de anúncios</h3><p class="small muted">Tabela de edição em massa, com identificação e estoque protegidos.</p></div><span class="bulk-tag">Mercado Livre</span></div>'+
 '<div class="bulk-toolbar"><button class="btn btn-primary bulk-add-btn" id="bulkOpen">+ Adicione os MLB&#39;s</button><span id="bulkCount">0 anúncios</span><div class="bulk-toolbar-right"><button class="btn btn-ghost bulk-clear-btn" id="bulkClear">Limpar lista</button><button class="btn btn-ghost" id="bulkExport">↓ Baixar Excel</button><button class="btn btn-ghost" id="bulkImport">↑ Importar Excel</button><input id="bulkImportFile" type="file" accept=".xlsx,.xls" hidden></div></div>'+
 '<section class="bulk-adjustment" aria-labelledby="bulkAdjustTitle">'+
 '<div class="bulk-adjust-head"><div><h4 id="bulkAdjustTitle">Reajuste de preços</h4><p>Defina um reajuste para todos os anúncios carregados, antes de publicar.</p></div><span class="bulk-adjust-chip">PREÇOS</span></div>'+
 '<div class="bulk-adjust-fields"><div class="bulk-adjust-group"><label>Tipo de reajuste</label><div class="bulk-adjust-modes" id="bulkAdjustModes" role="group" aria-label="Tipo de reajuste">'+
 '<button type="button" class="is-selected" data-adjust-mode="increase" aria-pressed="true"><span aria-hidden="true">＋</span> Acréscimo</button>'+
 '<button type="button" data-adjust-mode="discount" aria-pressed="false"><span aria-hidden="true">−</span> Desconto</button>'+
 '<button type="button" data-adjust-mode="fixed" aria-pressed="false"><span aria-hidden="true">▣</span> Fixar preço único</button></div></div>'+
 '<div class="bulk-adjust-group"><label for="bulkAdjustValue">Valor</label><div class="bulk-adjust-amount"><input id="bulkAdjustValue" type="text" inputmode="decimal" autocomplete="off" placeholder="Digite o valor (R$) a acrescer" aria-describedby="bulkAdjustPreview">'+
 '<div id="bulkAdjustUnit" class="bulk-adjust-unit" role="group" aria-label="Unidade do reajuste"><button type="button" class="is-selected" data-adjust-unit="brl" aria-pressed="true">R$</button><button type="button" data-adjust-unit="percent" aria-pressed="false">%</button></div></div></div></div>'+
 '<div class="bulk-adjust-foot"><p id="bulkAdjustPreview" aria-live="polite">Adicione anúncios para realizar um reajuste.</p><button class="btn btn-primary" id="bulkAdjustApply" type="button" disabled>Aplicar na tabela</button></div></section>'+
  '<div class="bulk-grid"><table><thead><tr><th class="bulk-num">#</th><th>Foto</th>'+cols.map(c=>'<th style="min-width:'+c[2]+'px">'+escape(c[1])+(c[3]?' 🔒':'')+'</th>').join('')+'</tr></thead><tbody id="bulkRows"></tbody></table></div>'+
 '<div class="bulk-footer"><span class="small muted">As células alteradas ficam destacadas. Loja, MLB, SKU e Estoque são somente leitura.</span><button class="btn btn-primary" id="bulkApply" disabled>Revisar e aplicar alterações</button></div><div id="bulkFailures"></div><div id="bulkResults"></div></section>'+
 '<div id="bulkResultOverlay" class="bulk-result-overlay" hidden><aside class="bulk-result-panel" role="dialog" aria-modal="true" aria-labelledby="bulkResultTitle"><header class="bulk-result-top"><div><span class="bulk-result-eyebrow">ML SH SUPPORT / AÇÕES EM MASSA</span><h2 id="bulkResultTitle">Resumo das alterações</h2></div><button type="button" id="bulkResultClose" aria-label="Fechar resultados">×</button></header><div class="bulk-result-scroll"><div id="bulkResultSummary"></div><div class="bulk-result-section-title">Detalhes por situação</div><div class="bulk-result-groups" id="bulkResultGroups"></div></div><footer class="bulk-result-actions"><button class="btn btn-ghost" type="button" id="bulkResultDownload">↓ Exportar resultado</button><button class="btn btn-primary" type="button" id="bulkResultContinue">Concluir</button></footer></aside></div>'+
 '<div id="bulkModal" class="bulk-modal-overlay" hidden><div class="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulkModalTitle"><div class="bulk-modal-top"><div><div class="bulk-modal-kicker">MERCADO LIVRE · IMPORTAÇÃO</div><h2 id="bulkModalTitle">Adicionar anúncios</h2><p>Cole os códigos MLB ou SKU. Vamos procurar nas lojas vinculadas à sua conta.</p></div><button type="button" class="bulk-close" id="bulkClose" aria-label="Fechar">×</button></div>'+
 '<div class="bulk-modal-content"><label for="bulkInputs">MLBs ou SKUs dos anúncios</label><textarea id="bulkInputs" placeholder="MLB5360939846&#10;MLB5361165102&#10;SKU-EXEMPLO" rows="7" spellcheck="false"></textarea><div class="bulk-modal-hint"><span>Um código por linha, vírgula ou ponto e vírgula</span><strong>Até 100 códigos</strong></div></div>'+
 '<div class="bulk-modal-actions"><button type="button" class="btn btn-ghost" id="bulkCancel">Cancelar</button><button type="button" class="btn btn-primary" id="bulkSearch">Buscar anúncios</button></div></div></div>';
}
function init(){
 $('bulkResultClose')?.addEventListener('click',closeResultPanel);
 $('bulkResultContinue')?.addEventListener('click',finishBulkResults);
 $('bulkResultDownload')?.addEventListener('click',downloadResultReport);
 $('bulkResultOverlay')?.addEventListener('click',e=>{if(e.target.id==='bulkResultOverlay')closeResultPanel()});
 $('bulkOpen')?.addEventListener('click',openBulkModal);
 $('bulkClear')?.addEventListener('click',clearBulkList);
 $('bulkClose')?.addEventListener('click',closeBulkModal);
 $('bulkCancel')?.addEventListener('click',cancelBulkEditor);
 $('bulkModal')?.addEventListener('click',e=>{if(e.target.id==='bulkModal'&&!busy)closeBulkModal()});
 $('bulkInputs')?.addEventListener('input',e=>{inputDraft=e.target.value});
 $('bulkSearch')?.addEventListener('click',lookup);$('bulkApply')?.addEventListener('click',apply);
 $('bulkRows')?.addEventListener('input',edit);$('bulkRows')?.addEventListener('change',edit);
 $('bulkExport')?.addEventListener('click',exportExcel);$('bulkImport')?.addEventListener('click',()=>$('bulkImportFile').click());
 $('bulkImportFile')?.addEventListener('change',e=>importExcel(e.target.files[0]));initAdjustment();render();
}
window.mlshBulkEditor={markup,init,calculateAdjustedPrice,parseAdjustmentValue};
})();