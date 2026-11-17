/* ML SH Support - editor de anuncios em massa */
(function(){
'use strict';
let rows=[],failures=[],busy=false,term='',results=[];
const $=id=>document.getElementById(id), escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cols=[['company_name','Loja',155,true],['id','MLB',160,true],['sku','SKU',160,true],['title','Titulo',350],['price','Preco (R$)',120],['available_quantity','Estoque',100],['status','Status',120],['listing_type_id','Modalidade',145],['description','Descricao',330]];
const permitted=['title','price','available_quantity','status','listing_type_id','description'];
const key=r=>r.company_id+'|'+r.id;
const orig=r=>r.original||{};
const changed=r=>permitted.filter(c=>String(r[c]??'')!==String(orig(r)[c]??''));
const viewRows=()=>rows.filter(r=>!term||[r.id,r.company_name,r.sku,r.title].some(v=>String(v||'').toLowerCase().includes(term.toLowerCase())));
const money=v=>v==null?'':String(v);
function render(){
 const body=$('bulkRows');if(!body)return;
 body.innerHTML=viewRows().map((r,i)=>'<tr data-key="'+escape(key(r))+'"><td class="bulk-num">'+(i+1)+'</td><td><img class="bulk-thumb" src="'+escape(r.image||'')+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></td>'+cols.map(([k,label,w,locked])=>'<td class="'+(locked?'bulk-locked':'')+(changed(r).includes(k)?' bulk-changed':'')+'">'+(locked?'<span title="Somente leitura">'+escape(r[k]??'—')+'</span>':k==='status'?'<select data-field="'+k+'">'+[['active','Publicado'],['paused','Pausado']].map(([v,n])=>'<option value="'+v+'" '+(String(r[k])===v?'selected':'')+'>'+n+'</option>').join('')+'</select>':k==='description'?'<textarea data-field="'+k+'" rows="1" title="Clique para editar a descricao">'+escape(r[k]??'')+'</textarea>':'<input data-field="'+k+'" type="'+(['price','available_quantity'].includes(k)?'number':'text')+'" '+(k==='price'?'min="0.01" step="0.01"':k==='available_quantity'?'min="0" step="1"':'')+' value="'+escape(r[k]??'')+'" '+(k==='title'?'maxlength="60"':'')+'>')+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="11" class="bulk-empty">Nenhum anuncio carregado. Cole MLB ou SKU para buscar.</td></tr>';
 $('bulkCount').textContent=rows.length+' anuncio(s) · '+rows.filter(r=>changed(r).length).length+' alterado(s)';
 $('bulkFailures').innerHTML=failures.map(f=>'<div class="bulk-error">'+escape(f.input)+': '+escape(f.error)+'</div>').join('');
 $('bulkResults').innerHTML=results.map(r=>'<div class="bulk-result '+(r.status==='success'?'ok':r.status==='skipped'?'skip':'err')+'">'+escape(r.id)+' · '+escape(r.status==='success'?'Atualizado':r.status==='skipped'?'Sem alteracoes':'Erro')+' · '+escape(r.message||'')+'</div>').join('');
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
   results.push(...(r.results||[]));
   const ok=(r.results||[]).find(x=>x.status==='success');
   if(ok){const row=rows.find(x=>x.id===item.id&&String(x.company_id)===String(item.company_id));if(row)row.original=Object.fromEntries(permitted.map(k=>[k,row[k]??'']));}
  }catch(e){results.push({id:item.id,status:'error',message:e.message||'Falha na atualizacao'})}
  render();
 }
 markBusy(false);$('bulkApply').textContent='Revisar e aplicar alteracoes';render();
}
function downloadFile(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function exportExcel(){
 if(!rows.length)return;
 if(!window.XLSX){window.toast?.('Biblioteca Excel indisponivel.');return}
 const headers=['Loja','MLB','SKU','Titulo','Preco','Estoque','Status','Modalidade','Descricao'];
 const values=[headers,...rows.map(r=>[r.company_name,r.id,r.sku,r.title,Number(r.price),Number(r.available_quantity),r.status,r.listing_type_id,r.description||''])];
 const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(values);
 ws['!cols']=[{wch:24},{wch:20},{wch:24},{wch:65},{wch:15},{wch:12},{wch:16},{wch:20},{wch:80}];
 XLSX.utils.book_append_sheet(wb,ws,'Anuncios');XLSX.writeFile(wb,'ml-sh-acoes-em-massa.xlsx');
}
async function importExcel(file){
 if(!file)return;
 if(!window.XLSX){window.toast?.('Biblioteca Excel indisponivel.');return}
 try{
 const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array'}),array=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
 const pending=[];let ignored=0;
 for(const input of array){
  const id=String(input.MLB||'').trim().toUpperCase(),loja=String(input.Loja||'').trim();
  const matched=rows.filter(r=>r.id===id&&r.company_name===loja);
  if(matched.length!==1||String(input.SKU||'').trim()!==String(matched[0].sku||'')){ignored++;continue}
  const row=matched[0],mapping={Titulo:'title',Preco:'price',Estoque:'available_quantity',Status:'status',Modalidade:'listing_type_id',Descricao:'description'};
  Object.entries(mapping).forEach(([c,k])=>{if(Object.hasOwn(input,c)&&String(input[c])!==String(row[k]??'')){row[k]=String(input[c]);pending.push(k)}});
 }
 results=[];render();window.toast?.('Planilha importada. '+pending.length+' celula(s) revisada(s); '+ignored+' linha(s) ignorada(s).');
 }catch(e){window.toast?.('Erro ao importar: '+e.message)}
 finally{$('bulkImportFile').value=''}
}
function markup(){
 return pageHead('FERRAMENTAS','Acoes em massa','Editor de anuncios estilo Excel. Loja, MLB e SKU permanecem bloqueados.')+
 '<section class="panel bulk-panel"><div class="bulk-head"><div><h3>Buscar anuncios</h3><p class="small muted">Cole MLB, numero do anuncio ou SKU, um por linha (ate 100).</p></div><span class="bulk-tag">Mercado Livre</span></div>'+
 '<textarea id="bulkInputs" placeholder="MLB5360939846&#10;SKU-EXEMPLO" rows="3" spellcheck="false"></textarea><div class="bulk-toolbar"><button class="btn btn-primary" id="bulkSearch">Buscar anuncios</button><span id="bulkCount">0 anuncios</span><div class="bulk-toolbar-right"><button class="btn btn-ghost" id="bulkExport">↓ Baixar Excel</button><button class="btn btn-ghost" id="bulkImport">↑ Importar Excel</button><input id="bulkImportFile" type="file" accept=".xlsx,.xls" hidden></div></div>'+
 '<div class="bulk-grid"><table><thead><tr><th class="bulk-num">#</th><th>Foto</th>'+cols.map(c=>'<th style="min-width:'+c[2]+'px">'+escape(c[1])+(c[3]?' 🔒':'')+'</th>').join('')+'</tr></thead><tbody id="bulkRows"></tbody></table></div>'+
 '<div class="bulk-footer"><span class="small muted">Celulas amarelas = alteradas. Campos bloqueados sao somente leitura. Imagens nao entram no Excel.</span><button class="btn btn-primary" id="bulkApply" disabled>Revisar e aplicar alteracoes</button></div><div id="bulkFailures"></div><div id="bulkResults"></div></section>';
}
function init(){
 $('bulkSearch')?.addEventListener('click',lookup);$('bulkApply')?.addEventListener('click',apply);
 $('bulkRows')?.addEventListener('input',edit);$('bulkRows')?.addEventListener('change',edit);
 $('bulkExport')?.addEventListener('click',exportExcel);$('bulkImport')?.addEventListener('click',()=>$('bulkImportFile').click());
 $('bulkImportFile')?.addEventListener('change',e=>importExcel(e.target.files[0]));render();
}
window.mlshBulkEditor={markup,init};
})();