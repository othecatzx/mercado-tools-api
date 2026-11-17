/* ML SH Support - editor de anuncios em massa */
(function(){
'use strict';
let rows=[],failures=[],busy=false,term='',results=[],resultPanelOpen=false;
const $=id=>document.getElementById(id), escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cols=[['company_name','Loja',155,true],['id','MLB',160,true],['sku','SKU',160,true],['title','Titulo',350],['price','Preco (R$)',120],['available_quantity','Estoque',100,true],['description','Descricao',330]];
const permitted=['title','price','description'];
const key=r=>r.company_id+'|'+r.id;
const orig=r=>r.original||{};
const changed=r=>permitted.filter(c=>String(r[c]??'')!==String(orig(r)[c]??''));
const viewRows=()=>rows.filter(r=>!term||[r.id,r.company_name,r.sku,r.title].some(v=>String(v||'').toLowerCase().includes(term.toLowerCase())));
let inputDraft='';
function render(){
 const body=$('bulkRows');if(!body)return;
 if($('bulkClear'))$('bulkClear').disabled=busy||(!rows.length&&!failures.length&&!results.length);
 body.innerHTML=viewRows().map((r,i)=>'<tr data-key="'+escape(key(r))+'"><td class="bulk-num">'+(i+1)+'</td><td><img class="bulk-thumb" src="'+escape(r.image||'')+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></td>'+cols.map(([k,label,w,locked])=>'<td class="'+(locked?'bulk-locked':'')+(changed(r).includes(k)?' bulk-changed':'')+'">'+(locked?'<span title="Somente leitura">'+escape(r[k]??'—')+'</span>':k==='status'?'<select data-field="'+k+'">'+[['active','Publicado'],['paused','Pausado']].map(([v,n])=>'<option value="'+v+'" '+(String(r[k])===v?'selected':'')+'>'+n+'</option>').join('')+'</select>':k==='description'?'<textarea data-field="'+k+'" rows="1" title="Clique para editar a descricao">'+escape(r[k]??'')+'</textarea>':'<input data-field="'+k+'" type="'+(['price','available_quantity'].includes(k)?'number':'text')+'" '+(k==='price'?'min="0.01" step="0.01"':k==='available_quantity'?'min="0" step="1"':'')+' value="'+escape(r[k]??'')+'" '+(k==='title'?'maxlength="60"':'')+'>')+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="9" class="bulk-empty">Nenhum anúncio carregado. Clique em Adicione os MLB\'s para começar.</td></tr>';
 $('bulkCount').textContent=rows.length+' anuncio(s) · '+rows.filter(r=>changed(r).length).length+' alterado(s)';
 $('bulkFailures').innerHTML=failures.map(f=>'<div class="bulk-error">'+escape(f.input)+': '+escape(f.error)+'</div>').join('');
 const countFor=status=>results.filter(r=>r.status===status).length;
 $('bulkResults').innerHTML=results.length?'<div class="bulk-result-summary"><div><strong>Resultado da edição em massa</strong><span>'+countFor('success')+' sincronizado(s) · '+countFor('error')+' erro(s) · '+countFor('skipped')+' ignorado(s)</span></div><button type="button" id="bulkViewDetails" class="btn btn-ghost">Ver detalhes</button></div>':'';
 $('bulkViewDetails')?.addEventListener('click',openResultPanel);
 $('bulkApply').disabled=busy||!rows.some(r=>changed(r).length);
}
function markBusy(v){busy=v;['bulkSearch','bulkApply','bulkExport','bulkImport'].forEach(id=>{if($(id))$(id).disabled=v});}
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
 rows=[];failures=[];results=[];term='';inputDraft='';closeResultPanel();
 if($('bulkInputs'))$('bulkInputs').value='';
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
 $('bulkResultGroups').innerHTML=[
  ['success','✓ Sincronizados com sucesso','success',true],
  ['warning','⚠ Atualizados com aviso','warning',true],
  ['error','✕ Falharam','error',true],
  ['skipped','↷ Ignorados / sem alteração','skipped',false]
 ].map(([status,label,cls,expanded])=>{
  const items=results.filter(r=>r.status===status);
  if(!items.length)return '';
  return '<details class="bulk-result-group '+cls+'" '+(expanded?'open':'')+'><summary><span>'+label+' ('+items.length+')</span><span class="bulk-result-chevron">⌄</span></summary><div class="bulk-result-items">'+items.map(r=>
   '<article class="bulk-result-item"><strong>'+escape(r.title||r.id||'Anúncio')+'</strong>'+
   '<div><b>SKU:</b> '+escape(r.sku||'Não informado')+'</div>'+
   '<div><b>MLB:</b> '+escape(r.id||'')+'</div>'+
   '<div><b>Loja:</b> '+escape(r.company_name||'Não informada')+'</div>'+
   (r.message?'<p>'+escape(r.message)+'</p>':'')+'</article>').join('')+'</div></details>';
 }).join('')||'<p>Nenhum resultado.</p>';
 overlay.hidden=false;document.body.classList.add('bulk-results-open');
 $('bulkResultClose')?.focus();
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
 '<div class="bulk-grid"><table><thead><tr><th class="bulk-num">#</th><th>Foto</th>'+cols.map(c=>'<th style="min-width:'+c[2]+'px">'+escape(c[1])+(c[3]?' 🔒':'')+'</th>').join('')+'</tr></thead><tbody id="bulkRows"></tbody></table></div>'+
 '<div class="bulk-footer"><span class="small muted">As células alteradas ficam destacadas. Loja, MLB, SKU e Estoque são somente leitura.</span><button class="btn btn-primary" id="bulkApply" disabled>Revisar e aplicar alterações</button></div><div id="bulkFailures"></div><div id="bulkResults"></div></section>'+
 '<div id="bulkResultOverlay" class="bulk-result-overlay" hidden><aside class="bulk-result-panel" role="dialog" aria-modal="true" aria-labelledby="bulkResultTitle"><header class="bulk-result-top"><h2 id="bulkResultTitle">Resultado da edição em massa</h2><button type="button" id="bulkResultClose" aria-label="Fechar resultados">×</button></header><div class="bulk-result-groups" id="bulkResultGroups"></div><footer class="bulk-result-actions"><button class="btn btn-ghost" type="button" id="bulkResultDownload">↓ Baixar relatório</button><button class="btn btn-primary" type="button" id="bulkResultContinue">Prosseguir</button></footer></aside></div>'+
 '<div id="bulkModal" class="bulk-modal-overlay" hidden><div class="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulkModalTitle"><div class="bulk-modal-top"><div><div class="bulk-modal-kicker">MERCADO LIVRE · IMPORTAÇÃO</div><h2 id="bulkModalTitle">Adicionar anúncios</h2><p>Cole os códigos MLB ou SKU. Vamos procurar nas lojas vinculadas à sua conta.</p></div><button type="button" class="bulk-close" id="bulkClose" aria-label="Fechar">×</button></div>'+
 '<div class="bulk-modal-content"><label for="bulkInputs">MLBs ou SKUs dos anúncios</label><textarea id="bulkInputs" placeholder="MLB5360939846&#10;MLB5361165102&#10;SKU-EXEMPLO" rows="7" spellcheck="false"></textarea><div class="bulk-modal-hint"><span>Um código por linha, vírgula ou ponto e vírgula</span><strong>Até 100 códigos</strong></div></div>'+
 '<div class="bulk-modal-actions"><button type="button" class="btn btn-ghost" id="bulkCancel">Cancelar</button><button type="button" class="btn btn-primary" id="bulkSearch">Buscar anúncios</button></div></div></div>';
}
function init(){
 $('bulkResultClose')?.addEventListener('click',closeResultPanel);
 $('bulkResultContinue')?.addEventListener('click',closeResultPanel);
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
 $('bulkImportFile')?.addEventListener('change',e=>importExcel(e.target.files[0]));render();
}
window.mlshBulkEditor={markup,init};
})();