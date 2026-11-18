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
}
function markBusy(v){busy=v;['bulkSearch','bulkApply','bulkExport','bulkImport','bulkClear'].forEach(id=>{if($(id))$(id).disabled=v});}
async function lookup(){
 const input=String($('bulkInputs').value||'').split(/[\n\r,;]+/).map(x=>x.trim()).filter(Boolean);
 if(!input.length){window.toast?.('Informe ao menos um MLB ou SKU.');return}
 if(input.length>100){window.toast?.('Limite de 100 codigos.');return}
 markBusy(true);$('bulkSearch').textContent='Consultando...';
 try{
 const data=await api('/api/portal/bulk-editor/preview',{method:'POST',body:JSON.stringify({inputs:[...new Set(input)]})});
 rows=(data.items||[]).map(r=>({...r,original:Object.fromEntries(permitted.map(k=>[k,r[k]??'']))}));
 scanSummary=null;if($('bulkScanSummary'))$('bulkScanSummary').hidden=true;
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
 if(field==='price')row.aiImported=false;
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
 rows=[];failures=[];results=[];term='';inputDraft='';scanSummary=null;closeResultPanel();
 if($('bulkScanSummary'))$('bulkScanSummary').hidden=true;
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
let scanned=null;
const formatPrice=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
// Combina apenas especificacoes completas, nao um titulo genericamente parecido.
// Analisa titulo natural ("Lenovo ... 16gb 512gb Ssd") e linha compacta da tabela.
function productSpecs(value){
 const t=String(value||'').replace(/\b1000\s*GB\b(\s*M2)?\s*\(\s*1\s*TB\s*\)/ig,'1000GB$1').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
  .replace(/\b(\d+)\s*TB\b/g,(_,n)=>String(Number(n)*1024)+'GB')
  .replace(/\b(\d{1,4})\s*G\b/g,'$1GB').replace(/\bM[ .-]*2\b/g,'M2')
  .replace(/[^A-Z0-9]+/g,' ').trim();
 const candidates=[...t.matchAll(/\b(4|8|16|32|64)\s*GB\b/g)];
 const explicitBefore=t.match(/\bRAM\s*(4|8|16|32|64)\s*GB\b/);
 const explicitAfter=t.match(/\b(4|8|16|32|64)\s*GB\s*RAM\b/);
 const explicit=explicitBefore||explicitAfter;
 // Somente um valor possivel de RAM se o titulo nao escrever RAM.
 if(!explicit&&candidates.length!==1)return null;
 const ram=explicit?Number(explicit[1]):Number(candidates[0][1]);
 const ramIndex=explicitBefore?explicitBefore.index+explicitBefore[0].indexOf(explicitBefore[1]):
  explicitAfter?explicitAfter.index:candidates[0].index;
 const capacities=[...t.matchAll(/\b(120|128|240|250|256|480|500|512|960|1000|1024|1920|2048)\s*GB\b/g)]
  .filter(m=>m.index!==ramIndex);
 if(!capacities.length)return null;
 const disks=[];
 for(const m of capacities){
  const before=t.slice(0,m.index),after=t.slice(m.index+m[0].length);
  const lastType=[...before.matchAll(/\b(SSD|HDD|HD)\b/g)].at(-1);
  const nextType=after.match(/^\s*(SSD|HDD|HD)\b/);
  // "SSD 240GB SATA 256GB M2" herda SSD; "HDD 500GB / SSD 120GB" troca corretamente.
  const prefixType=before.match(/\b(SSD|HDD|HD)\b(?:\s+(?:SATA|M2|NVME))?\s*$/);
  const previousCapacity=[...before.matchAll(/\b(?:120|128|240|250|256|480|500|512|960|1000|1024|1920|2048)\s*GB\b/g)].at(-1);
  const suffixOfPrevious=!!(lastType&&previousCapacity&&lastType.index>previousCapacity.index);
  let type=(suffixOfPrevious&&nextType?nextType[1]:prefixType?.[1]||nextType?.[1]||lastType?.[1])||'';
  // M2/NVMe identifica SSD mesmo quando o titulo omite a palavra SSD.
  if(!type&&(/^(?:\s*(?:M2|NVME))\b/.test(after)||/\b(?:M2|NVME)\s*$/.test(before)))type='SSD';
  if(!type&&capacities.length===1&&Number(m[1])<1000)type='SSD';
  if(!type)return null; // Ex.: 1TB sem especificar SSD ou HDD.
  const formatAfter=after.match(/^\s*(?:SSD|HDD|HD)?\s*(M2|NVME|SATA)\b/)?.[1]||'';
  const formatBefore=lastType&&!nextType?before.slice(lastType.index).match(/\b(M2|NVME|SATA)\s*$/)?.[1]||'':'';
  const fmt=formatAfter||formatBefore;
  const bothForms=/\bSATA\s+E\s+M2\b|\bM2\s+E\s+SATA\b/.test(after.slice(0,35));
  disks.push({size:Number(m[1])===1000?1024:Number(m[1]),
   type:type==='SSD'?'SSD':'HD',
   form:bothForms?'':fmt==='M2'||fmt==='NVME'?'M2':fmt==='SATA'?'SATA':''});
 }
 return {ram,disks,text:t};
}
function matchingTableItems(row,items){
 const specs=productSpecs(row.title+' '+row.sku);
 if(!specs||specs.disks.length!==1)return [];
 // Na TABELA os discos listados na mesma linha sao ALTERNATIVAS de preco.
 // "SSD 240GB SATA 256GB M2" = 240GB OU 256GB, nao duas unidades.
 // No ANUNCIO, exigir um armazenamento identificavel e coincidente.
 const disk=specs.disks[0];
 const compatible=(option,size)=>option.type===disk.type&&option.size===size&&
  (!option.form||!disk.form||option.form===disk.form);
 const eligible=items.map(item=>({item,reference:productSpecs(item.configuration)}))
  .filter(x=>x.reference?.ram===specs.ram);
 // Correspondencia exata tem prioridade. 1TB pode usar a linha de 960GB
 // somente se nao houver nenhuma linha de 1TB na tabela.
 const exact=eligible.filter(x=>x.reference.disks.some(option=>compatible(option,disk.size)));
 if(exact.length)return exact.map(x=>x.item);
 if(disk.type==='SSD'&&(disk.size===1024||disk.size===960)){
  const equivalent=disk.size===1024?960:1024;
  return eligible.filter(x=>x.reference.disks.some(option=>compatible(option,equivalent))).map(x=>x.item);
 }
 return [];
}
// Desktop: titulo curto pode indicar "480gb 16gb" sem dizer RAM/SSD.
// Exigir mesmo numero de discos da tabela; nao atribuir precos de kits mistos a unidade unica.
function desktopSpecs(value){
 const s=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
  .replace(/\b(\d+)\s*TB\b/g,(_,n)=>String(Number(n)*1024)+'GB')
  .replace(/\b(\d{1,4})\s*G\b/g,'$1GB').replace(/\bM[\s.-]*2\b/g,'M2')
  .replace(/[^A-Z0-9]+/g,' ').trim();
 const explicit=s.match(/\bRAM\s*(4|8|16|32|64)\s*GB\b/)||s.match(/\b(4|8|16|32|64)\s*GB\s*RAM\b/);
 const ramCandidates=[...s.matchAll(/\b(4|8|16|32|64)\s*GB\b/g)];
 if(!explicit&&ramCandidates.length!==1)return null;
 const ram=explicit?Number(explicit[1]):Number(ramCandidates[0][1]);
 const ramStart=explicit?(explicit[0].startsWith('RAM')?explicit.index+explicit[0].indexOf(explicit[1]):explicit.index):ramCandidates[0].index;
 const capacities=[...s.matchAll(/\b(120|128|240|250|256|480|500|512|960|1000|1024|1920|2048)\s*GB\b/g)].filter(m=>m.index!==ramStart);
 const disks=[];
 for(const m of capacities){
  const start=m.index,end=start+m[0].length;
  const before=s.slice(0,start),after=s.slice(end,end+18);
  const previous=[...before.matchAll(/\b(SSD|HD|HDD)\b/g)].at(-1);
  const following=after.match(/^\s*(SSD|HD|HDD)\b/);
  let kind=following?.[1]||previous?.[1]||'';
  if(!kind&&capacities.length===1&&Number(m[1])<1000)kind='SSD';
  if(!kind)return null;
  const formAfter=after.match(/^\s*(SATA|M2|NVME)\b/)?.[1]||'';
  const formBefore=previous&&!following?before.slice(previous.index).match(/\b(SATA|M2|NVME)\s*$/)?.[1]||'':'';
  const formName=formAfter||formBefore;
  disks.push({kind:kind==='SSD'?'SSD':'HD',size:Number(m[1])===1000?1024:Number(m[1]),
   form:formName==='M2'||formName==='NVME'?'M2':formName==='SATA'?'SATA':''});
 }
 return disks.length?{ram,disks}:null;
}
function desktopMatches(row,items){
 const specs=desktopSpecs(row.title+' '+row.sku);
 if(!specs||specs.disks.length!==1)return [];
 // Na tabela, "SSD SATA 240GB SATA 256GB M2 / 1TB HDD" significa
 // tres ALTERNATIVAS com o mesmo preco, nao tres discos instalados.
 // O anuncio deve ter somente um armazenamento identificavel para preencher.
 const disk=specs.disks[0];
 const found=items.filter(item=>{
  const table=desktopSpecs(item.configuration);
  if(!table||table.ram!==specs.ram)return false;
  return table.disks.some(option=>option.kind===disk.kind&&option.size===disk.size&&
   (!option.form||!disk.form||option.form===disk.form));
 });
 // A IA pode repetir a mesma linha com ordem diferente (RAM 8GB / 8GB RAM).
 // Eliminar duplicatas apenas quando configuracao normalizada E preco sao iguais.
 const keys=new Set();
 return found.filter(item=>{
  const table=desktopSpecs(item.configuration);
  const key=table.ram+'|'+table.disks.map(x=>x.kind+':'+x.size+':'+x.form).sort().join(',')+'|'+item.parsedPrice;
  if(keys.has(key))return false;
  keys.add(key);
  return true;
 });
}
function conditionConflict(text,condition){
 const s=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const categories={caixa_aberta:/caixa\s*aberta/,mostruario:/mostruario/,com_marcas:/com\s*marcas|com\s*marca/,recondicionado:/recondicionad/};
 return Object.entries(categories).some(([id,re])=>id!==condition&&re.test(s));
}
let scanSummary=null;
function autoFillScan(data,condition,productType='notebook'){
 const valid=[],ignored=[];
 const parsePrice=v=>{
  if(typeof v==='number')return v;
  if(typeof v!=='string')return NaN;
  let s=v.trim().replace(/^R\$\s*/i,'').replace(/\s/g,'');
  if(!/^\d[\d.,]*$/.test(s))return NaN;
  if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
  return Number(s);
 };
 for(const item of data.items){
  const price=parsePrice(item.prices?.[0]);
  if(!(productType==='desktop'?desktopSpecs(item.configuration):productSpecs(item.configuration))||!Number.isFinite(price)||price<=0){
   ignored.push(item.configuration+' (configuracao ou preco ilegivel)');continue;
  }
  valid.push({...item,parsedPrice:price});
 }
 let updated=0,already=0,unmatched=0,ambiguous=0,conflicts=0,manual=0;
 const updatedKeys=[],used=new Set();
 for(const row of rows){
  if(conditionConflict(row.title+' '+row.sku,condition)){conflicts++;continue}
  const matches=productType==='desktop'?desktopMatches(row,valid):matchingTableItems(row,valid);
  // Mesmo tamanho de SSD/RAM pode corresponder a mais de uma configuracao; nunca escolher por proximidade.
  if(!matches.length){unmatched++;continue}
  if(matches.length!==1){ambiguous++;continue}
  if(changed(row).includes('price')&&!row.aiImported){manual++;continue}
  const price=matches[0].parsedPrice;
  used.add(matches[0]);
  if(Number(row.price)===price){already++;continue}
  row.price=String(price);row.aiImported=true;updatedKeys.push(key(row));updated++;
 }
 for(const item of valid)if(!used.has(item))ignored.push(item.configuration+' (nenhum anuncio compativel)');
 scanSummary={updated,already,unmatched,ambiguous,conflicts,manual,ignored,condition,updatedKeys};
 results=[];render();
 const panel=$('bulkScanSummary');
 if(panel){
  panel.hidden=false;
  panel.innerHTML='<strong>IA: '+updated+' preco(s) preenchido(s) automaticamente</strong><span>'+already+' ja corretos · '+unmatched+' sem correspondencia · '+ambiguous+' ambiguos · '+conflicts+' condicao divergente · '+manual+' edicoes manuais preservadas</span>'+
   '<small>Compare os campos destacados com o print antes de publicar. A IA nao altera MLB, SKU ou estoque.</small>'+
   (ignored.length?'<details><summary>Ver '+ignored.length+' configuracao(oes) nao aplicadas</summary><ul>'+ignored.slice(0,50).map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul></details>':'');
 }
 window.toast?.(updated?updated+' preco(s) preenchido(s). Revise antes de publicar.':'Nao houve correspondencias seguras. Os precos foram preservados.');
}
function closeScan(){if($('bulkScanOverlay'))$('bulkScanOverlay').hidden=true;}
function renderScan(){
 if(!scanned)return;
 const col=Number($('bulkScanColumn').value);
 $('bulkScanRows').innerHTML=scanned.items.map((item,i)=>{
  const price=item.prices[col],current=rows.find(r=>key(r)===item.target);
  const opts='<option value="">Selecionar anuncio...</option>'+rows.map(r=>'<option value="'+escape(key(r))+'" '+(key(r)===item.target?'selected':'')+'>'+escape(r.company_name+' / '+r.id+' / '+r.title.slice(0,55))+'</option>').join('');
  return '<tr><td><input type="checkbox" data-index="'+i+'" class="bulk-scan-check" '+(item.checked?'checked':'')+' '+(!price||!current?'disabled':'')+'></td><td>'+escape(item.configuration)+'</td><td>'+(price?formatPrice(price):'Duvidoso')+'</td><td><select class="bulk-scan-target" data-index="'+i+'">'+opts+'</select></td><td>'+(current?formatPrice(current.price)+' → '+formatPrice(price):'Sem anuncio vinculado')+'</td></tr>';
 }).join('');
 const active=scanned.items.filter(x=>x.checked&&x.target&&Number(x.prices[col])>0);
 const repeated=new Set(active.map(x=>x.target)).size!==active.length;
 $('bulkScanStatus').textContent=active.length+' selecionado(s)'+(repeated?' · anuncio duplicado: corrija antes de continuar':'');
 $('bulkScanConfirm').disabled=!active.length||repeated;
}
async function prepareScanImage(file){
 const objectUrl=URL.createObjectURL(file);
 try{
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Nao foi possivel abrir a imagem.'));image.src=objectUrl});
  const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('Nao foi possivel processar a imagem.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.88);
 }finally{URL.revokeObjectURL(objectUrl)}
}
async function scanImage(file){
 if(!file)return; // O usuario cancelou a escolha do arquivo: manter o modal aberto.
 const setup=$('bulkAiSetup'),choose=$('bulkAiChooseImage'),status=$('bulkAiProgress');
 try{
  if($('bulkScanError')){$('bulkScanError').hidden=true;$('bulkScanError').textContent=''}
  markBusy(true);
  $('bulkScanOpen').disabled=true;$('bulkScanOpen').textContent='Analisando imagem...';
  if(choose){choose.disabled=true;choose.classList.add('bulk-ai-loading');choose.textContent='Analisando imagem...'}
  if(status){status.hidden=false;status.textContent='Processando imagem com IA. Aguarde a conclusão.'}
  for(const id of ['bulkScanCondition','bulkScanProductType','bulkAiClose','bulkAiCancel'])if($(id))$(id).disabled=true;
  if(!rows.length)throw new Error('Adicione primeiro os anuncios MLB ou SKU.');
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>4*1024*1024)
   throw new Error('Use PNG, JPG ou WebP de ate 4 MB.');
  const image=await prepareScanImage(file);
  const condition=$('bulkScanCondition')?.value;
  const productType=$('bulkScanProductType')?.value||'notebook';
  if(!condition)throw new Error('Escolha primeiro a categoria de preco.');
  const data=await api('/api/portal/bulk-editor/scan-image',{method:'POST',body:JSON.stringify({image,condition,productType})});
  if(!data.items?.length)throw new Error('Nenhuma configuracao encontrada.');
  autoFillScan(data,condition,productType);
 }catch(e){
  const message=e.message||'Falha na leitura da imagem';
  window.toast?.(message);
  if($('bulkScanError')){$('bulkScanError').hidden=false;$('bulkScanError').textContent=message}
 }finally{
  if(setup)setup.hidden=true;
  if(status){status.hidden=true;status.textContent=''}
  if(choose){choose.disabled=false;choose.classList.remove('bulk-ai-loading');choose.textContent='Selecionar imagem / print'}
  for(const id of ['bulkScanCondition','bulkScanProductType','bulkAiClose','bulkAiCancel'])if($(id))$(id).disabled=false;
  markBusy(false);
  $('bulkScanOpen').disabled=false;$('bulkScanOpen').textContent='✦ Importar print com IA';
  $('bulkScanFile').value='';render();
 }
}
function acceptScan(){
 if(!scanned)return;
 const col=Number($('bulkScanColumn').value),chosen=scanned.items.filter(x=>x.checked&&x.target&&Number(x.prices[col])>0);
 if(!chosen.length||new Set(chosen.map(x=>x.target)).size!==chosen.length)return;
 for(const item of chosen){const row=rows.find(r=>key(r)===item.target);if(row)row.price=String(item.prices[col])}
 results=[];closeScan();scanned=null;render();
 window.toast?.(chosen.length+' preco(s) preenchido(s). Revise as celulas antes de publicar.');
}
function markup(){
 return pageHead('FERRAMENTAS','Ações em massa','Edite títulos, preços e descrições diretamente nas células, como no Excel.')+
 '<section class="panel bulk-panel"><div class="bulk-head"><div><h3>Editor de anúncios</h3><p class="small muted">Tabela de edição em massa, com identificação e estoque protegidos.</p></div><span class="bulk-tag">Mercado Livre</span></div>'+
 '<div class="bulk-toolbar"><button class="btn btn-primary bulk-add-btn" id="bulkOpen">+ Adicione os MLB&#39;s</button><span id="bulkCount">0 anúncios</span><div class="bulk-toolbar-right"><button class="btn btn-ghost bulk-clear-btn" id="bulkClear">Limpar lista</button><button class="btn btn-ghost" id="bulkScanOpen">✦ Importar print com IA</button><input id="bulkScanFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><button class="btn btn-ghost" id="bulkExport">↓ Baixar Excel</button><button class="btn btn-ghost" id="bulkImport">↑ Importar Excel</button><input id="bulkImportFile" type="file" accept=".xlsx,.xls" hidden></div></div>'+
 '<div id="bulkScanError" class="bulk-scan-error" role="alert" hidden></div><div id="bulkScanSummary" class="bulk-scan-summary" hidden></div>'+
 '<div class="bulk-grid"><table><thead><tr><th class="bulk-num">#</th><th>Foto</th>'+cols.map(c=>'<th style="min-width:'+c[2]+'px">'+escape(c[1])+(c[3]?' 🔒':'')+'</th>').join('')+'</tr></thead><tbody id="bulkRows"></tbody></table></div>'+
 '<div class="bulk-footer"><span class="small muted">As células alteradas ficam destacadas. Loja, MLB, SKU e Estoque são somente leitura.</span><button class="btn btn-primary" id="bulkApply" disabled>Revisar e aplicar alterações</button></div><div id="bulkFailures"></div><div id="bulkResults"></div></section>'+
 '<div id="bulkResultOverlay" class="bulk-result-overlay" hidden><aside class="bulk-result-panel" role="dialog" aria-modal="true" aria-labelledby="bulkResultTitle"><header class="bulk-result-top"><div><span class="bulk-result-eyebrow">ML SH SUPPORT / AÇÕES EM MASSA</span><h2 id="bulkResultTitle">Resumo das alterações</h2></div><button type="button" id="bulkResultClose" aria-label="Fechar resultados">×</button></header><div class="bulk-result-scroll"><div id="bulkResultSummary"></div><div class="bulk-result-section-title">Detalhes por situação</div><div class="bulk-result-groups" id="bulkResultGroups"></div></div><footer class="bulk-result-actions"><button class="btn btn-ghost" type="button" id="bulkResultDownload">↓ Exportar resultado</button><button class="btn btn-primary" type="button" id="bulkResultContinue">Concluir</button></footer></aside></div>'+
 '<div id="bulkScanOverlay" class="bulk-scan-overlay" hidden><section class="bulk-scan-modal" role="dialog" aria-modal="true" aria-labelledby="bulkScanTitle"><header class="bulk-scan-head"><div><small>ML SH SUPPORT · LEITURA POR IA</small><h2 id="bulkScanTitle">Conferir preços da imagem</h2><p>Selecione a coluna de preços, confira cada configuração e escolha os anúncios corretos. Nada será publicado agora.</p></div><button type="button" class="btn btn-ghost" id="bulkScanClose">Fechar</button></header><div class="bulk-scan-controls"><label for="bulkScanColumn">Coluna da imagem</label><select id="bulkScanColumn"></select><span id="bulkScanStatus"></span></div><div class="bulk-scan-scroll"><table><thead><tr><th>Usar</th><th>Configuração identificada</th><th>Preço da imagem</th><th>Anúncio vinculado</th><th>Preço atual → novo</th></tr></thead><tbody id="bulkScanRows"></tbody></table></div><footer class="bulk-scan-actions"><span>Revise os preços na imagem original. Sugestões automáticas não são selecionadas por padrão.</span><button class="btn btn-primary" id="bulkScanConfirm" disabled>Preencher preços selecionados</button></footer></section></div>'+
 '<div id="bulkAiSetup" class="bulk-modal-overlay" hidden><section class="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulkAiTitle"><div class="bulk-modal-top"><div><div class="bulk-modal-kicker">ML SH SUPPORT · IMPORTAÇÃO IA</div><h2 id="bulkAiTitle">Importar tabela de preços</h2><p>Escolha o produto e o tipo de preço. Depois selecione o print recortado.</p></div><button type="button" class="bulk-close" id="bulkAiClose" aria-label="Fechar">×</button></div><div class="bulk-modal-content"><label for="bulkScanProductType">Produto</label><select id="bulkScanProductType" class="bulk-price-condition"><option value="notebook">Notebook</option><option value="desktop">Desktop</option></select><label for="bulkScanCondition" style="margin-top:15px">Tipo de preço</label><select id="bulkScanCondition" class="bulk-price-condition"><option value="">Escolha a condição</option><option value="caixa_aberta">Caixa aberta</option><option value="mostruario">Mostruário</option><option value="com_marcas">Com marcas</option><option value="recondicionado">Recondicionado</option></select><p class="small muted" style="margin-top:12px">A coluna Adicional será ignorada. A importação apenas preenche os campos para conferência.</p></div><div class="bulk-modal-actions"><span id="bulkAiProgress" class="bulk-ai-progress" role="status" aria-live="polite" hidden></span><button type="button" class="btn btn-ghost" id="bulkAiCancel">Cancelar</button><button type="button" class="btn btn-primary" id="bulkAiChooseImage">Selecionar imagem / print</button></div></section></div>'+
 '<div id="bulkModal" class="bulk-modal-overlay" hidden><div class="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulkModalTitle"><div class="bulk-modal-top"><div><div class="bulk-modal-kicker">MERCADO LIVRE · IMPORTAÇÃO</div><h2 id="bulkModalTitle">Adicionar anúncios</h2><p>Cole os códigos MLB ou SKU. Vamos procurar nas lojas vinculadas à sua conta.</p></div><button type="button" class="bulk-close" id="bulkClose" aria-label="Fechar">×</button></div>'+
 '<div class="bulk-modal-content"><label for="bulkInputs">MLBs ou SKUs dos anúncios</label><textarea id="bulkInputs" placeholder="MLB5360939846&#10;MLB5361165102&#10;SKU-EXEMPLO" rows="7" spellcheck="false"></textarea><div class="bulk-modal-hint"><span>Um código por linha, vírgula ou ponto e vírgula</span><strong>Até 100 códigos</strong></div></div>'+
 '<div class="bulk-modal-actions"><button type="button" class="btn btn-ghost" id="bulkCancel">Cancelar</button><button type="button" class="btn btn-primary" id="bulkSearch">Buscar anúncios</button></div></div></div>';
}
function init(){
 $('bulkScanOpen')?.addEventListener('click',()=>{if(!rows.length){window.toast?.('Adicione primeiro os anuncios MLB ou SKU.');return}$('bulkAiSetup').hidden=false;$('bulkScanProductType').focus()});
 const closeAi=()=>{if(!busy)$('bulkAiSetup').hidden=true};
 $('bulkAiClose')?.addEventListener('click',closeAi);
 $('bulkAiCancel')?.addEventListener('click',closeAi);
 $('bulkAiSetup')?.addEventListener('click',e=>{if(e.target.id==='bulkAiSetup')closeAi()});
 $('bulkAiChooseImage')?.addEventListener('click',()=>{if(!$('bulkScanCondition').value){window.toast?.('Escolha o tipo de preco.');$('bulkScanCondition').focus();return}$('bulkScanFile').click()});
 $('bulkScanFile')?.addEventListener('change',e=>scanImage(e.target.files[0]));
 $('bulkScanClose')?.addEventListener('click',closeScan);
 $('bulkScanColumn')?.addEventListener('change',()=>{if(scanned)scanned.items.forEach(x=>x.checked=false);renderScan()});
 $('bulkScanRows')?.addEventListener('change',e=>{
  if(!scanned)return;
  const i=Number(e.target.dataset.index),item=scanned.items[i];
  if(!item)return;
  if(e.target.classList.contains('bulk-scan-target')){item.target=e.target.value;item.checked=false}
  if(e.target.classList.contains('bulk-scan-check'))item.checked=e.target.checked;
  renderScan();
 });
 $('bulkScanConfirm')?.addEventListener('click',acceptScan);
 $('bulkScanOverlay')?.addEventListener('click',e=>{if(e.target.id==='bulkScanOverlay')closeScan()});
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
 $('bulkImportFile')?.addEventListener('change',e=>importExcel(e.target.files[0]));render();
}
window.mlshBulkEditor={markup,init};
})();