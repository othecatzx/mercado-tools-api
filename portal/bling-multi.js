/* Módulo aditivo das telas Bling; preserva a navegação e autenticação existentes. */
(() => {
// BLING_FRONT_PERMISSIONS_V1
function blingCan(p){return currentUser?.role!=='support_agent'||(currentUser.bling_permissions||[]).includes(p);}
const apiB=(path,method='GET',body)=>api('/api/portal/bling'+path,{method,...(body?{body:JSON.stringify(body)}:{})});
let connections=[], entries=[],templates=[],chosen=new Set(),editing=null,selectedConn='';
const baseElements=()=>[{type:'sku',x:2,y:2,w:24,h:5,fontSize:7,bold:true},{type:'qr',x:2,y:8,w:15,h:15},{type:'date',x:19,y:17,w:19,h:5,fontSize:7}];
const fmt=d=>d?new Date(d).toLocaleString('pt-BR'):'—';
function error(e){toast(e.message||'Erro inesperado');}
function content(markup){$('pageContent').innerHTML=markup;}
function blingDialog({title,description='',fields=[],confirmText='Salvar',danger=false}){
  return new Promise(resolve=>{
    document.getElementById('blingDialogShade')?.remove();
    const shade=document.createElement('div');shade.id='blingDialogShade';
    shade.innerHTML=`<div class="bling-dialog" role="dialog" aria-modal="true" aria-labelledby="blingDialogTitle">
      <h3 id="blingDialogTitle">${esc(title)}</h3>${description?`<p class="muted">${esc(description)}</p>`:''}
      <form id="blingDialogForm">${fields.map(f=>`<label class="bling-dialog-field">${esc(f.label)}${f.type==='select'?`<select class="filter-control" name="${esc(f.name)}" ${f.required?'required':''}>${(f.options||[]).map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(f.value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`:`<input class="filter-control" name="${esc(f.name)}" value="${esc(f.value??'')}" maxlength="${Number(f.maxlength)||100}" ${f.required?'required':''}>`}</label>`).join('')}
      <div class="bling-dialog-actions"><button class="btn btn-ghost" type="button" id="blingDialogCancel">Cancelar</button><button class="btn ${danger?'btn-ghost':'btn-primary'}" type="submit">${esc(confirmText)}</button></div></form></div>`;
    const css=document.getElementById('blingDialogCss')||document.createElement('style');
    css.id='blingDialogCss';css.textContent=`#blingDialogShade{position:fixed;inset:0;z-index:9999;background:rgba(10,15,30,.65);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}.bling-dialog{box-sizing:border-box;background:var(--card-bg,var(--surface,#fff));color:var(--text,#20242a);border:1px solid var(--line,#ddd);border-radius:16px;padding:24px;width:min(100%,460px);max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 14px 50px #0004}.bling-dialog h3{margin:0 0 12px;font-size:1.15rem}.bling-dialog-field{display:grid;gap:6px;margin:14px 0}.bling-dialog-field input,.bling-dialog-field select{width:100%;box-sizing:border-box}.bling-dialog-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:20px}@media(max-width:480px){.bling-dialog{padding:18px}.bling-dialog-actions button{flex:1}}`;
    if(!css.parentNode)document.head.appendChild(css);
    document.body.appendChild(shade);
    const close=(result)=>{document.removeEventListener('keydown',onKey);shade.remove();resolve(result)};
    const onKey=e=>{if(e.key==='Escape')close(null)};document.addEventListener('keydown',onKey);
    shade.addEventListener('click',e=>{if(e.target===shade)close(null)});
    shade.querySelector('#blingDialogCancel').onclick=()=>close(null);
    shade.querySelector('#blingDialogForm').onsubmit=e=>{e.preventDefault();close(Object.fromEntries(new FormData(e.currentTarget).entries()))};
    shade.querySelector('input')?.focus();
  });
}
async function getConnections(){connections=(await apiB('/connections')).connections||[];}
function selector(id='blingFilter'){return `<select class="filter-control" id="${id}"><option value="">Todas as contas</option>${connections.filter(c=>c.status==='connected').map(c=>`<option value="${esc(c.id)}" ${selectedConn===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`;}
async function integrations(){
  content(pageHead('CONFIGURAÇÕES · INTEGRAÇÕES','Bling','Cada conexão tem seus próprios tokens; o vínculo com webhooks ocorre automaticamente quando verificado.',`<button class="btn btn-primary" id="blingAdd">＋ Conectar Bling</button>`)+`<div class="panel" id="blingList">Carregando conexões…</div>`);
  if(currentUser?.role==='support_agent'||!blingCan('bling.connections.manage'))$('blingAdd').remove();else $('blingAdd').onclick=()=>connect();
  try{
    await getConnections();
    $('blingList').innerHTML=connections.length?connections.map(c=>`<article style="padding:18px 0;border-bottom:1px solid var(--line)">
      <h3>${esc(c.name)}</h3><p class="muted">${c.status==='connected'?'Conectada':'Desconectada'} · Webhook: ${c.webhook_company_id||c.company_id?'Vinculado automaticamente':'Aguardando identificação no primeiro evento de estoque'} · Última sincronização: ${fmt(c.last_sync_at)}</p>
      <div class="actions"><button class="btn btn-ghost" data-rename="${esc(c.id)}">Editar nome</button><button class="btn btn-ghost" data-reconnect="${esc(c.id)}">Reconectar</button><button class="btn btn-ghost" data-disconnect="${esc(c.id)}">Desconectar</button></div></article>`).join(''):'Nenhuma conta conectada.';
    if(!blingCan('bling.connections.manage'))document.querySelectorAll('[data-rename],[data-reconnect],[data-disconnect]').forEach(b=>b.remove());
    document.querySelectorAll('[data-rename]').forEach(b=>b.onclick=async()=>{
      const c=connections.find(x=>x.id===b.dataset.rename);
      const values=await blingDialog({title:'Editar nome da conexão',description:'O nome é apenas para organização no ML Support. Não modifica os dados da empresa no Bling.',fields:[{name:'name',label:'Nome da conexão',value:c.name,required:true}]});
      if(!values)return;
      try{await apiB('/connections/'+c.id,'PATCH',{name:values.name});toast('Nome atualizado');integrations();}catch(e){error(e)}
    });
    document.querySelectorAll('[data-reconnect]').forEach(b=>b.onclick=()=>connect(b.dataset.reconnect));
    document.querySelectorAll('[data-disconnect]').forEach(b=>b.onclick=async()=>{
      const c=connections.find(x=>x.id===b.dataset.disconnect);
      const yes=await blingDialog({title:'Desconectar '+c.name+'?',description:'Os registros históricos serão mantidos e novas entradas deixarão de ser recebidas para essa conexão.',confirmText:'Desconectar',danger:true});
      if(!yes)return;
      try{await apiB('/connections/'+c.id,'DELETE');integrations();}catch(e){error(e)}
    });
  }catch(e){$('blingList').textContent=e.message;}
}
async function connect(id){try{const r=await apiB('/connect','POST',id?{id}:{});location.href=r.url;}catch(e){error(e)}}
// Painel de entradas de estoque — layout responsivo e seleção persistente.
const entryLabelCounts = new Map();
let entrySearch = '';
function stockCss(){
 if(document.getElementById('blingStockCssV3'))return;
 const style=document.createElement('style');style.id='blingStockCssV3';
 style.textContent=`
 .bs-wrap{display:grid;gap:18px;font-size:14px;color:var(--text,#1d2939)}
 .bs-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
 .bs-stat{border:1px solid var(--line,#e2e8f0);background:var(--card-bg,var(--surface,#fff));border-radius:15px;padding:18px 20px;display:flex;align-items:center;gap:14px;min-width:0}
 .bs-stat-icon{flex:0 0 44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--primary-soft,#eef2ff);color:var(--primary,#5069d7);font-size:21px}
 .bs-stat-caption{display:block;font-size:12px;color:var(--muted,#64748b);font-weight:550;margin-bottom:3px}
 .bs-stat-value{display:block;font-size:25px;font-weight:750;letter-spacing:-.8px;line-height:1.2;color:var(--text,#172338);font-variant-numeric:tabular-nums}
 .bs-panel{border:1px solid var(--line,#e2e8f0);border-radius:16px;overflow:hidden;background:var(--card-bg,var(--surface,#fff))}
 .bs-filters{padding:20px;display:flex;align-items:flex-end;flex-wrap:wrap;gap:12px;border-bottom:1px solid var(--line,#e2e8f0)}
 .bs-field{display:grid;gap:7px;min-width:180px;flex:0 1 240px}
 .bs-field label{font-size:12px;font-weight:650;color:var(--muted,#64748b)}
 .bs-field-grow{flex:1 1 310px}
 .bs-field select,.bs-field input{box-sizing:border-box;width:100%;min-height:43px;border-radius:10px;border:1px solid var(--line,#dbe2eb);padding:10px 12px;background:var(--input-bg,var(--card-bg,#fff));color:var(--text,#1d2939);font:inherit;outline-offset:2px}
 .bs-filters .btn{min-height:43px;white-space:nowrap;border-radius:10px}
 .bs-toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:14px 20px;background:var(--panel-bg,rgba(120,140,170,.04));border-bottom:1px solid var(--line,#e2e8f0)}
 .bs-selectall{display:inline-flex;align-items:center;gap:9px;font-weight:650;cursor:pointer}
 .bs-selectall input,.bs-rowcheck{height:17px;width:17px;accent-color:var(--primary,#5069d7);cursor:pointer;flex-shrink:0}
 .bs-toolbar-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
 .bs-tag{font-size:12px;border-radius:999px;padding:6px 10px;font-weight:650;background:var(--primary-soft,#eef2ff);color:var(--primary,#5069d7)}
 .bs-results{font-size:12px;color:var(--muted,#64748b)}
 .bs-clear{border:0;background:none;color:var(--primary,#5069d7);font-weight:650;cursor:pointer;font:inherit;font-size:12px;padding:5px}
 .bs-table-wrap{width:100%;overflow-x:auto}
 .bs-table{width:100%;min-width:860px;border-spacing:0;border-collapse:separate;table-layout:auto;font-size:13px}
 .bs-table th{text-align:left;padding:13px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.055em;font-weight:750;color:var(--muted,#64748b);background:var(--panel-bg,rgba(120,140,170,.045));white-space:nowrap;border-bottom:1px solid var(--line,#e2e8f0)}
 .bs-table td{padding:12px 14px;border-bottom:1px solid var(--line,#e2e8f0);vertical-align:middle;color:var(--text,#263447)}
 .bs-table tbody tr:last-child td{border-bottom:0}.bs-table tbody tr:hover{background:var(--panel-bg,rgba(100,120,170,.045))}.bs-table tbody tr.bs-selected{background:var(--primary-soft,rgba(80,105,215,.06))}
 .bs-check-col{width:40px}.bs-product{display:flex;align-items:center;gap:11px;min-width:250px;max-width:460px}
 .bs-product-img{width:44px;height:44px;border-radius:10px;border:1px solid var(--line,#e2e8f0);background:var(--panel-bg,#f8fafc);flex:0 0 44px;object-fit:contain}
 .bs-product-fallback{display:grid;place-items:center;color:var(--muted,#94a3b8);font-size:19px}
 .bs-product-name{font-weight:650;line-height:1.4;overflow-wrap:anywhere}.bs-sku{display:inline-block;font-size:12px;white-space:nowrap;padding:6px 9px;border-radius:7px;background:var(--panel-bg,#f1f5f9);color:var(--text,#475569);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
 .bs-qty{font-weight:750;font-variant-numeric:tabular-nums}.bs-date{white-space:nowrap;font-variant-numeric:tabular-nums}.bs-account{display:inline-block;white-space:nowrap;max-width:175px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
 .bs-count{width:72px;min-height:37px;padding:7px 8px;box-sizing:border-box;border:1px solid var(--line,#dbe2eb);border-radius:8px;background:var(--input-bg,var(--card-bg,#fff));color:var(--text,#1d2939);font:inherit}
 .bs-empty{padding:44px 20px;text-align:center;color:var(--muted,#64748b)}.bs-empty strong{display:block;color:var(--text,#263447);font-size:15px;margin-bottom:5px}
 .bs-footer{padding:13px 20px;border-top:1px solid var(--line,#e2e8f0);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--muted,#64748b);font-size:12px}
 @media(max-width:760px){.bs-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.bs-stat:last-child{grid-column:1/-1}.bs-filters{padding:14px}.bs-toolbar{padding:12px 14px}.bs-stat{padding:14px}.bs-stat-value{font-size:22px}.bs-field{flex:1 1 100%;min-width:0}.bs-filters .btn{width:100%}}
 @media(max-width:420px){.bs-stats{grid-template-columns:1fr}.bs-stat:last-child{grid-column:auto}}
 `;document.head.appendChild(style);
}
function updateStockStats(){
 const unitCount=entries.reduce((sum,item)=>sum+(Number(item.quantity)||0),0);
 const selectedCount=entries.filter(item=>chosen.has(String(item.id))).length;
 const total=$('bsTotal'),units=$('bsUnits'),selected=$('bsSelected');
 if(total)total.textContent=entries.length.toLocaleString('pt-BR');
 if(units)units.textContent=unitCount.toLocaleString('pt-BR');
 if(selected)selected.textContent=selectedCount.toLocaleString('pt-BR');
 const tag=$('bsSelectionTag');if(tag)tag.textContent=selectedCount+' selecionado'+(selectedCount===1?'':'s');
 const clear=$('bsClearSelection');if(clear)clear.hidden=selectedCount===0;
}
async function stock(){
 stockCss();
 content(pageHead('ESTOQUE','Entradas de Estoque','Acompanhe as movimentações de entrada e prepare suas etiquetas.',`<button class="btn btn-primary" id="generateLabels">Gerar etiquetas</button>`)+`
 <div class="bs-wrap">
 <div class="bs-stats">
  <div class="bs-stat"><span class="bs-stat-icon" aria-hidden="true">▤</span><div><span class="bs-stat-caption">Movimentações</span><strong class="bs-stat-value" id="bsTotal">—</strong></div></div>
  <div class="bs-stat"><span class="bs-stat-icon" aria-hidden="true">▣</span><div><span class="bs-stat-caption">Unidades recebidas</span><strong class="bs-stat-value" id="bsUnits">—</strong></div></div>
  <div class="bs-stat"><span class="bs-stat-icon" aria-hidden="true">✓</span><div><span class="bs-stat-caption">Selecionadas</span><strong class="bs-stat-value" id="bsSelected">0</strong></div></div>
 </div>
 <div class="bs-panel">
  <div class="bs-filters">
   <div class="bs-field"><label for="blingFilter">Conta Bling</label>${selector()}</div>
   <div class="bs-field bs-field-grow"><label for="blingSearch">Pesquisar produto ou SKU</label><input class="filter-control" id="blingSearch" placeholder="Digite nome do produto ou código SKU" autocomplete="off"></div>
   <button class="btn btn-ghost" id="blingRefresh" type="button">↻ Atualizar produtos</button>
  </div>
  <div id="stockList"><div class="bs-empty">Carregando movimentações…</div></div>
 </div></div>`);
 $('blingFilter').onchange=e=>{selectedConn=e.target.value;stock()};
 $('blingSearch').value=entrySearch;
 $('blingSearch').oninput=e=>{entrySearch=e.target.value;renderEntries(entrySearch)};
 if(!blingCan('bling.products.sync'))$('blingRefresh').remove();else $('blingRefresh').onclick=async()=>{
  const btn=$('blingRefresh');btn.disabled=true;btn.textContent='Sincronizando produtos…';
  const ids=selectedConn?[selectedConn]:connections.filter(c=>c.status==='connected').map(c=>c.id);
  let fixed=0,pending=0;const issues=[];
  try{
   for(const id of ids){try{
    const result=await apiB('/entries/enrich','POST',{connection_id:id});
    fixed+=result.enriched||0;pending+=result.missingSku||0;
    if(result.failures?.length){const c=connections.find(x=>x.id===id),f=result.failures[0];issues.push((c?.name||'Bling')+': '+(f.status||'erro')+' - '+f.reason);}
   }catch(e){issues.push((connections.find(c=>c.id===id)?.name||'Bling')+': '+e.message);}}
   await stock();
   if(issues.length)error(new Error('Falha ao consultar produtos: '+issues.join('; ')));
   else if(pending)toast('Há '+pending+' produto(s) sem SKU cadastrado no Bling.');
   else toast(fixed?'Produtos sincronizados: '+fixed:'Nenhum produto pendente de sincronização.');
  }catch(e){error(e);await stock();}
 };
 if(!blingCan('bling.labels.print'))$('generateLabels').remove();else $('generateLabels').onclick=generate;
 try{
  await getConnections();
  $('blingFilter').innerHTML='<option value="">Todas as contas</option>'+connections.filter(c=>c.status==='connected').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('blingFilter').value=selectedConn;
  entries=(await apiB('/entries'+(selectedConn?'?connection_id='+encodeURIComponent(selectedConn):''))).entries||[];
  const ids=new Set(entries.map(e=>String(e.id)));
  // A seleção acompanha as entradas carregadas; quantidades são preservadas por ID.
  for(const id of [...chosen])if(!ids.has(id))chosen.delete(id);
  renderEntries(entrySearch);
 }catch(e){$('stockList').innerHTML=`<div class="bs-empty"><strong>Não foi possível carregar as entradas</strong>${esc(e.message)}</div>`;updateStockStats();}
}
function renderEntries(search){
 const q=String(search||'').trim().toLocaleLowerCase('pt-BR');
 const visible=entries.filter(e=>String((e.sku||'')+' '+(e.product_name||'')).toLocaleLowerCase('pt-BR').includes(q));
 const area=$('stockList');if(!area)return;
 area.innerHTML=`<div class="bs-toolbar">
  <label class="bs-selectall"><input type="checkbox" id="allEntries" aria-label="Selecionar todos os resultados visíveis"><span>Selecionar todos</span></label>
  <div class="bs-toolbar-right"><span class="bs-results">${visible.length} de ${entries.length} movimentações</span><span class="bs-tag" id="bsSelectionTag">0 selecionados</span><button type="button" class="bs-clear" id="bsClearSelection" hidden>Limpar seleção</button></div>
 </div>
 ${visible.length?`<div class="bs-table-wrap"><table class="bs-table"><thead><tr><th class="bs-check-col"><span class="bs-results">✓</span></th><th>Produto</th><th>SKU</th><th>Entrada</th><th>Data / hora</th><th>Conta</th><th>Etiquetas</th></tr></thead><tbody>
 ${visible.map(e=>{const id=String(e.id),active=chosen.has(id);return `<tr class="${active?'bs-selected':''}">
 <td><input type="checkbox" class="bs-rowcheck" data-entry="${esc(id)}" ${active?'checked':''} aria-label="Selecionar ${esc(e.product_name||e.sku||'entrada')}"></td>
 <td><div class="bs-product">${e.image_url&&/^https:\/\//i.test(e.image_url)?`<img class="bs-product-img" src="${esc(e.image_url)}" alt="" loading="lazy">`:`<span class="bs-product-img bs-product-fallback" aria-hidden="true">▣</span>`}<span class="bs-product-name">${esc(e.product_name||'Produto não sincronizado')}</span></div></td>
 <td><span class="bs-sku">${esc(e.sku||'—')}</span></td><td><span class="bs-qty">+${esc(e.quantity??0)}</span></td><td><span class="bs-date">${fmt(e.occurred_at)}</span></td><td><span class="bs-account" title="${esc(e.bling_connections?.name||'')}">${esc(e.bling_connections?.name||'—')}</span></td>
 <td><input type="number" class="bs-count" min="1" max="500" step="1" value="${entryLabelCounts.get(id)??1}" data-count="${esc(id)}" aria-label="Quantidade de etiquetas para ${esc(e.product_name||e.sku||'entrada')}"></td>
 </tr>`}).join('')}</tbody></table></div>`:`<div class="bs-empty"><strong>Nenhuma movimentação encontrada</strong>${q?'Tente pesquisar com outro nome ou SKU.':'As entradas de estoque aparecerão aqui assim que forem recebidas.'}</div>`}
 <div class="bs-footer"><span>Exibindo ${visible.length} resultado${visible.length===1?'':'s'}</span><span>Selecione as movimentações para gerar etiquetas.</span></div>`;
 const master=$('allEntries'),rowChecks=[...area.querySelectorAll('[data-entry]')];
 const syncMaster=()=>{
  const selectedCount=visible.filter(e=>chosen.has(String(e.id))).length;
  master.checked=visible.length>0&&selectedCount===visible.length;
  master.indeterminate=selectedCount>0&&selectedCount<visible.length;
  master.disabled=visible.length===0;
  updateStockStats();
 };
 rowChecks.forEach(input=>input.onchange=()=>{
  if(input.checked)chosen.add(input.dataset.entry);else chosen.delete(input.dataset.entry);
  input.closest('tr')?.classList.toggle('bs-selected',input.checked);syncMaster();
 });
 master.onchange=()=>{
  const checked=master.checked;
  visible.forEach(e=>checked?chosen.add(String(e.id)):chosen.delete(String(e.id)));
  rowChecks.forEach(input=>{input.checked=checked;input.closest('tr')?.classList.toggle('bs-selected',checked)});
  syncMaster();
 };
 $('bsClearSelection').onclick=()=>{chosen.clear();rowChecks.forEach(input=>{input.checked=false;input.closest('tr')?.classList.remove('bs-selected')});syncMaster()};
 area.querySelectorAll('[data-count]').forEach(input=>input.oninput=()=>entryLabelCounts.set(input.dataset.count,input.value));
 syncMaster();
}
async function generate(){
 const picked=entries.filter(e=>chosen.has(String(e.id)));
 if(!picked.length)return toast('Selecione pelo menos um produto.');
 if(picked.some(e=>!e.sku))return toast('Atualize os produtos para obter o SKU antes de imprimir.');
 const selection=picked.map(e=>({id:e.id,count:Number(entryLabelCounts.get(String(e.id))??document.querySelector(`[data-count="${e.id}"]`)?.value??1)}));
 if(selection.some(e=>!Number.isInteger(e.count)||e.count<1||e.count>500))return toast('Quantidade inválida (1 a 500).');
 try{
  templates=(await apiB('/templates')).templates||[];
  if(!templates.length)return toast('Crie primeiro um modelo em Configurações → Modelos de Etiquetas.');
  const defaultModel=templates.find(t=>t.is_default)||templates[0];
  const total=selection.reduce((n,e)=>n+e.count,0);
  if(total>1000)return toast('Limite de 1.000 etiquetas por PDF.');
  const values=await blingDialog({
   title:'Escolher modelo para impressão',
   description:`${picked.length} movimentação(ões) selecionada(s) · ${total} etiqueta(s). Selecione o layout que será usado para gerar o PDF.`,
   fields:[{name:'template_id',type:'select',label:'Modelo da etiqueta',value:defaultModel.id,required:true,
    options:templates.map(t=>({value:t.id,label:`${t.name} · ${t.width_mm} × ${t.height_mm} mm${t.is_default?' (Padrão)':''}`}))}],
   confirmText:'Visualizar PDF'
  });
  if(!values)return;
  const t=templates.find(t=>t.id===values.template_id);
  if(!t)return toast('Selecione um modelo válido.');
  const response=await fetch(API+'/api/portal/bling/labels/pdf',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({template_id:t.id,entries:selection})});
  if(!response.ok){let msg='Falha ao gerar PDF';try{msg=(await response.json()).message||msg}catch(_){}throw Error(msg)}
  const blob=await response.blob();const url=URL.createObjectURL(blob);
  const tab=window.open(url,'_blank');
  if(!tab){const link=document.createElement('a');link.href=url;link.download='etiquetas.pdf';link.click();toast('O navegador bloqueou a nova aba. O PDF foi disponibilizado para baixar.');}
  setTimeout(()=>URL.revokeObjectURL(url),120000);
 }catch(e){error(e)}
}
/* Editor de etiquetas v2: layout responsivo, imagem, tipografia e posicionamento direto. */
const labelTypes={sku:'SKU',name:'Nome do produto',quantity:'Quantidade',date:'Data da entrada',time:'Horário da entrada',qr:'QR Code',text:'Texto personalizado',logo:'Imagem / logotipo'};
let selectedElement=0;
function labelEditorCss(){
 if(document.getElementById('blingLabelEditorCss'))return;
 const style=document.createElement('style');style.id='blingLabelEditorCss';
 style.textContent=`
 .ble-wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,.85fr);gap:20px;align-items:start}
 .ble-pane{min-width:0;border:1px solid var(--line,#ddd);border-radius:16px;padding:20px;background:var(--card-bg,var(--surface,#fff))}
 .ble-pane-head{display:flex;align-items:start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
 .ble-heading{font-size:17px;margin:0 0 4px;font-weight:700}.ble-sub{font-size:12px;color:var(--muted,#858585);margin:0}
 .ble-topbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.ble-topbar select{flex:1;min-width:150px}
 .ble-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:16px}
 .ble-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;font-weight:600;color:var(--text,#333)}
 .ble-field input,.ble-field select{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--input-bg,var(--card-bg,#fff));color:var(--text,#222);padding:10px;font:inherit;font-weight:400}
 .ble-fields .ble-wide{grid-column:1/-1}.ble-check{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}.ble-check input{width:auto}
 .ble-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ble-actions .btn{max-width:100%}.ble-element-options{display:flex;gap:8px;margin-bottom:16px}.ble-element-options select{flex:1;min-width:0}
 .ble-elements{display:flex;flex-direction:column;gap:8px}.ble-element{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;box-sizing:border-box;border:1px solid var(--line,#ddd);border-radius:10px;padding:12px;background:transparent;color:var(--text,#222);cursor:pointer;text-align:left}
 .ble-element[aria-pressed=true]{border-color:var(--primary,#6278e9);background:var(--primary-soft,rgba(95,112,220,.08))}
 .ble-element .ble-kind{font-weight:650;font-size:13px}.ble-element small{display:block;color:var(--muted,#888);margin-top:3px}
 .ble-props{margin-top:15px;padding-top:16px;border-top:1px solid var(--line,#ddd)}.ble-props-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
 .ble-props .ble-fields{grid-template-columns:repeat(4,minmax(0,1fr))}.ble-props .ble-prop-wide{grid-column:span 2}.ble-hint{font-size:12px;line-height:1.5;color:var(--muted,#777)}
 .ble-stage{background:var(--panel-bg,rgba(125,125,125,.08));border:1px solid var(--line,#ddd);border-radius:12px;min-height:280px;padding:24px 12px;display:flex;align-items:center;justify-content:center;overflow:hidden}
 .ble-canvas{background:#fff;color:#111;box-shadow:0 5px 24px rgba(0,0,0,.16);position:relative;flex:none;touch-action:none;user-select:none;overflow:hidden}
 .ble-canvas-element{position:absolute;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;border:1px solid transparent;box-sizing:border-box;cursor:move;touch-action:none}
 .ble-canvas-element[data-active=true]{border:1px dashed #356ef3;background:rgba(55,112,235,.06)}
 .ble-canvas-element img{height:100%;width:100%;object-fit:contain;pointer-events:none}
 .ble-canvas-element .ble-qr{height:100%;display:grid;place-items:center;background:repeating-linear-gradient(45deg,#eee,#eee 3px,#fff 3px,#fff 6px);color:#111;font-weight:700;text-align:center;font-size:11px}
 .ble-preview-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;color:var(--muted,#777);font-size:12px}
 .ble-upload{padding:12px;border:1px dashed var(--line,#ccc);border-radius:10px}.ble-upload input{max-width:100%;font-size:12px}
 .ble-image-tools{display:grid;gap:12px;margin-top:12px;padding:14px;border-radius:12px;background:var(--panel-bg,rgba(125,125,125,.06))}
 .ble-size-line{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:13px}
 .ble-size-line strong{font-variant-numeric:tabular-nums}.ble-image-slider{width:100%;accent-color:var(--primary,#6278e9);cursor:pointer;min-height:28px}
 .ble-image-buttons{display:flex;gap:8px;flex-wrap:wrap}.ble-image-buttons .btn{font-size:12px}
 .ble-image-note{font-size:12px;color:var(--muted,#777);line-height:1.45;margin:0}
 @media(max-width:1000px){.ble-wrap{grid-template-columns:minmax(0,1fr)}.ble-preview-pane{order:-1}.ble-stage{min-height:240px}}
 @media(max-width:520px){.ble-pane{padding:14px;border-radius:12px}.ble-topbar .btn{flex:1}.ble-fields{gap:9px}.ble-props .ble-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.ble-props .ble-prop-wide{grid-column:span 2}.ble-stage{padding:16px 8px;min-height:210px}.ble-element-options{flex-wrap:wrap}.ble-element-options .btn{width:100%}}
 `;
 document.head.appendChild(style);
}
const labelDeepCopy=t=>JSON.parse(JSON.stringify(t));
function labelClamp(v,lo,hi){return Math.min(hi,Math.max(lo,v));}
// Ajusta sem distorcer: o tamanho visual fica limitado à área útil do modelo.
function labelFitImage(el,ratio){
 const areaW=Math.max(1,Number(editing.width_mm)||40),areaH=Math.max(1,Number(editing.height_mm)||25);
 const maxW=Math.max(1,areaW-4),maxH=Math.max(1,areaH-4);
 const r=labelClamp(Number(ratio)||1,.05,20);
 const w=Math.min(maxW,maxH*r);
 const h=w/r;
 el.w=Math.round(w*10)/10;el.h=Math.round(h*10)/10;
 el.x=Math.round(Math.max(0,(areaW-el.w)/2)*10)/10;
 el.y=Math.round(Math.max(0,(areaH-el.h)/2)*10)/10;
 labelNormalize(el);
}
function labelResizeImage(el,percent){
 const width=Math.max(1,Number(editing.width_mm)||40),height=Math.max(1,Number(editing.height_mm)||25);
 const ratio=labelClamp(Number(el.imageRatio)||(el.w/el.h)||1,.05,20);
 const maxW=Math.min(width-1,(height-1)*ratio);
 const fraction=labelClamp(Number(percent)||100,5,100)/100;
 const w=Math.max(.5,maxW*fraction),h=w/ratio;
 const cx=Number(el.x)+Number(el.w)/2,cy=Number(el.y)+Number(el.h)/2;
 el.w=Math.round(w*10)/10;el.h=Math.round(h*10)/10;
 el.x=Math.round((cx-el.w/2)*10)/10;el.y=Math.round((cy-el.h/2)*10)/10;
 labelNormalize(el);
}
// Reduz as dimensões em pixels antes de armazenar a imagem no modelo.
// O PDF recebe o JPEG/PNG real, não apenas uma prévia reduzida por CSS.
async function labelReadImage(file){
 if(!['image/png','image/jpeg'].includes(file.type))throw Error('Envie uma imagem PNG ou JPG.');
 const img=await new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file),image=new Image();
  image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};
  image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Não foi possível abrir a imagem.'))};
  image.src=url;
 });
 const ratio=img.naturalWidth/img.naturalHeight;
 const maxBytes=180000;
 // Mantém transparência do PNG quando possível; usa JPEG como alternativa compacta.
 for(const type of (file.type==='image/png'?['image/png','image/jpeg']:['image/jpeg'])){
  for(const maxSide of [800,640,480,360,280,200,150]){
   const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('Seu navegador não conseguiu processar a imagem.');
   if(type==='image/jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)}
   ctx.drawImage(img,0,0,canvas.width,canvas.height);
   const data=canvas.toDataURL(type,.82);
   if(data.length*3/4<=maxBytes)return {data,ratio};
  }
 }
 throw Error('A imagem ainda está muito grande. Tente uma versão mais simples.');
}
function labelNormalize(el){
 const w=Math.max(.5,Number(editing.width_mm)||40),h=Math.max(.5,Number(editing.height_mm)||25);
 el.w=labelClamp(Number(el.w)||1,.5,w);el.h=labelClamp(Number(el.h)||1,.5,h);
 el.x=labelClamp(Number(el.x)||0,0,Math.max(0,w-el.w));el.y=labelClamp(Number(el.y)||0,0,Math.max(0,h-el.h));
}
function labelControl(k,caption,value,step='0.5',extra=''){
 return `<label class="ble-field ${extra}">${caption}<input type="number" data-lprop="${k}" step="${step}" min="0" value="${esc(value??0)}"></label>`;
}
function labelProperties(){
 const el=editing.elements[selectedElement],panel=$('bleProperties');
 if(!el){panel.innerHTML='<p class="ble-hint">Adicione um elemento para começar.</p>';return;}
 const textType=['sku','name','quantity','date','time','text'].includes(el.type);
 panel.innerHTML=`<div class="ble-props-head"><strong>${esc(labelTypes[el.type]||el.type)}</strong><button class="btn btn-ghost" id="bleRemove" type="button">Excluir elemento</button></div>
 <div class="ble-fields">${labelControl('x','Posição X · mm',el.x)}${labelControl('y','Posição Y · mm',el.y)}${labelControl('w','Largura · mm',el.w)}${labelControl('h','Altura · mm',el.h)}
 ${textType?`${labelControl('fontSize','Fonte · pt',el.fontSize??8,'0.5','ble-prop-wide')}<label class="ble-field ble-prop-wide">Alinhamento<select data-lprop="align">${['left','center','right'].map(k=>`<option value="${k}" ${el.align===k?'selected':''}>${({left:'Esquerda',center:'Centro',right:'Direita'})[k]}</option>`).join('')}</select></label><label class="ble-check ble-prop-wide"><input type="checkbox" data-lprop="bold" ${el.bold?'checked':''}> Negrito</label>`:''}</div>
 ${el.type==='text'?`<label class="ble-field">Conteúdo do texto<input type="text" data-lprop="text" maxlength="300" value="${esc(el.text||'')}"></label>`:''}
 ${el.type==='logo'?`<label class="ble-field ble-upload">Adicionar ou trocar imagem (PNG/JPG)<input type="file" id="bleImageUpload" accept="image/png,image/jpeg"></label>
  <div class="ble-image-tools"><div class="ble-size-line"><strong>Tamanho da imagem</strong><span id="bleImageSizeValue">${Number(el.w).toFixed(1)} × ${Number(el.h).toFixed(1)} mm</span></div>
  <input class="ble-image-slider" id="bleImageSize" type="range" min="5" max="100" step="1" value="${Math.round(labelClamp(el.w/Math.max(1,Math.min(editing.width_mm-1,(editing.height_mm-1)*(el.imageRatio||el.w/el.h||1)))*100,5,100))}" aria-label="Tamanho da imagem em porcentagem">
  <div class="ble-image-buttons"><button type="button" class="btn btn-ghost" id="bleImageFit">Ajustar à etiqueta</button>${el.image?'<button type="button" id="bleImageRemove" class="btn btn-ghost">Remover imagem</button>':''}</div>
  <p class="ble-image-note">Use a barra para diminuir ou aumentar a imagem sem distorcer. Você também pode arrastá-la na prévia. Arquivos grandes são otimizados automaticamente.</p></div>`:''}
 <p class="ble-hint">Arraste o elemento na prévia para posicioná-lo. As medidas são em milímetros e serão respeitadas no PDF.</p>`;
 panel.querySelector('#bleRemove').onclick=()=>{editing.elements.splice(selectedElement,1);selectedElement=Math.max(0,Math.min(selectedElement,editing.elements.length-1));drawElements()};
 panel.querySelectorAll('[data-lprop]').forEach(input=>{const change=()=>{
 const key=input.dataset.lprop;el[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
 if(['x','y','w','h'].includes(key)){labelNormalize(el);panel.querySelectorAll('[data-lprop]').forEach(f=>{if(['x','y','w','h'].includes(f.dataset.lprop))f.value=el[f.dataset.lprop]});}
 renderPreview();if(['x','y','w','h'].includes(key))labelElementList();
 };input.addEventListener(input.type==='checkbox'||input.tagName==='SELECT'?'change':'input',change)});
 const sizeSlider=panel.querySelector('#bleImageSize');
 if(sizeSlider)sizeSlider.oninput=()=>{
  labelResizeImage(el,Number(sizeSlider.value));
  const out=panel.querySelector('#bleImageSizeValue');if(out)out.textContent=`${el.w.toFixed(1)} × ${el.h.toFixed(1)} mm`;
  renderPreview();labelElementList();
  panel.querySelectorAll('[data-lprop]').forEach(f=>{if(['x','y','w','h'].includes(f.dataset.lprop))f.value=el[f.dataset.lprop]});
 };
 const fitBtn=panel.querySelector('#bleImageFit');if(fitBtn)fitBtn.onclick=()=>{
  labelFitImage(el,el.imageRatio||el.w/el.h||1);drawElements();
 };
 const imgUpload=panel.querySelector('#bleImageUpload');if(imgUpload)imgUpload.onchange=async()=>{
  const file=imgUpload.files?.[0];if(!file)return;
  imgUpload.disabled=true;
  try{
   const {data,ratio}=await labelReadImage(file);
   el.image=data;el.imageRatio=ratio;
   labelFitImage(el,ratio);
   drawElements();toast('Imagem adicionada e ajustada à etiqueta.');
  }catch(e){error(e);imgUpload.disabled=false;imgUpload.value=''}
 };
 const removeImg=panel.querySelector('#bleImageRemove');if(removeImg)removeImg.onclick=()=>{delete el.image;delete el.imageRatio;renderPreview();labelProperties()};
}
function labelElementList(){
 const area=$('elementList');if(!area)return;
 area.innerHTML=editing.elements.length?editing.elements.map((e,i)=>`<button class="ble-element" type="button" data-select-label="${i}" aria-pressed="${i===selectedElement}"><span><span class="ble-kind">${esc(labelTypes[e.type]||e.type)}</span><small>${Number(e.x).toFixed(1)}, ${Number(e.y).toFixed(1)} mm · ${Number(e.w).toFixed(1)} × ${Number(e.h).toFixed(1)} mm</small></span><span aria-hidden="true">${i===selectedElement?'●':'○'}</span></button>`).join(''):'<p class="ble-hint">Nenhum elemento no modelo.</p>';
 area.querySelectorAll('[data-select-label]').forEach(b=>b.onclick=()=>{selectedElement=Number(b.dataset.selectLabel);drawElements()});
}
function renderPreview(){
 const preview=$('labelPreview');if(!preview||!editing)return;
 const stage=$('bleStage');const width=Math.max(15,Number(editing.width_mm)||40),height=Math.max(15,Number(editing.height_mm)||25);
 const avail=Math.max(170,(stage?.clientWidth||400)-40);const scale=Math.min(9,avail/width,400/height);
 preview.style.width=(width*scale)+'px';preview.style.height=(height*scale)+'px';
 preview.innerHTML=editing.elements.map((e,i)=>{
  const type=e.type;const val=type==='text'?(e.text||'Texto'):({sku:'4SVJF155F11XI57A_CZ',name:'Nome do produto',quantity:'1',date:'04/11/2026',time:'12:38'})[type]||'';
  const contents=type==='logo'?(e.image?`<img src="${esc(e.image)}" alt="Imagem enviada">`:'<span style="color:#888;font-size:11px">Imagem</span>'):type==='qr'?'<span class="ble-qr">QR · SKU</span>':esc(val);
  const fs=labelClamp(Number(e.fontSize)||8,5,40)*scale*72/25.4;
  return `<div class="ble-canvas-element" data-preview-item="${i}" data-active="${i===selectedElement}" style="left:${e.x*scale}px;top:${e.y*scale}px;width:${e.w*scale}px;height:${e.h*scale}px;font:${e.bold?'700':'400'} ${fs}px Arial,sans-serif;text-align:${['left','right','center'].includes(e.align)?e.align:'left'};line-height:1.1">${contents}</div>`;
 }).join('');
 preview.querySelectorAll('[data-preview-item]').forEach(node=>{
  node.onpointerdown=event=>{
   if(event.button!==0)return;
   const i=Number(node.dataset.previewItem);if(selectedElement!==i){selectedElement=i;labelElementList();labelProperties();preview.querySelectorAll('[data-preview-item]').forEach(n=>n.dataset.active=String(Number(n.dataset.previewItem)===i));}
   const el=editing.elements[i],originalX=el.x,originalY=el.y,startX=event.clientX,startY=event.clientY;
   node.setPointerCapture(event.pointerId);
   node.onpointermove=ev=>{if(!node.hasPointerCapture(ev.pointerId))return;el.x=labelClamp(Math.round((originalX+(ev.clientX-startX)/scale)*10)/10,0,Math.max(0,width-el.w));el.y=labelClamp(Math.round((originalY+(ev.clientY-startY)/scale)*10)/10,0,Math.max(0,height-el.h));node.style.left=el.x*scale+'px';node.style.top=el.y*scale+'px';};
   node.onpointerup=()=>{node.onpointermove=null;labelElementList();labelProperties();renderPreview();};
  };
 });
 const dim=$('bleDimensions');if(dim)dim.textContent=`${width} × ${height} mm`;
}
function drawEditor(){
 labelEditorCss();
 content(pageHead('CONFIGURAÇÕES','Modelos de Etiquetas','Monte suas etiquetas de forma visual, com medidas reais para impressão.')+`
 <div class="ble-wrap">
  <section class="ble-pane" aria-label="Editor de etiquetas">
   <div class="ble-pane-head"><div><h3 class="ble-heading">Personalizar etiqueta</h3><p class="ble-sub">Edite o modelo, adicione elementos e ajuste o posicionamento.</p></div></div>
   <div class="ble-topbar"><select id="templateSelect" class="filter-control" aria-label="Modelo selecionado">${templates.map(t=>`<option value="${esc(t.id)}" ${editing.id===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}${!editing.id?'<option value="" selected>Novo modelo</option>':''}</select><button type="button" id="templateNew" class="btn btn-ghost">Novo</button><button type="button" id="templateClone" class="btn btn-ghost">Duplicar</button><button type="button" id="templateDelete" class="btn btn-ghost">Excluir</button></div>
   <div class="ble-fields"><label class="ble-field ble-wide">Nome do modelo<input id="templateName" maxlength="100" placeholder="Ex.: Etiqueta 4Show"></label><label class="ble-field">Largura (mm)<input type="number" id="labelWidth" min="15" max="300" step="1"></label><label class="ble-field">Altura (mm)<input type="number" id="labelHeight" min="15" max="300" step="1"></label><label class="ble-check ble-wide"><input type="checkbox" id="templateDefault"> Usar como modelo padrão</label></div>
   <div class="ble-pane-head"><div><h3 class="ble-heading">Elementos</h3><p class="ble-sub">Escolha um item para editar tamanho, posição e fonte.</p></div></div>
   <div class="ble-element-options"><select id="newElement" class="filter-control" aria-label="Tipo de elemento">${Object.entries(labelTypes).map(([type,title])=>`<option value="${type}">${esc(title)}</option>`).join('')}</select><button type="button" id="addElement" class="btn btn-ghost">+ Adicionar</button></div>
   <div id="elementList" class="ble-elements"></div><div id="bleProperties" class="ble-props"></div>
   <div class="ble-actions" style="margin-top:20px"><button type="button" id="saveTemplate" class="btn btn-primary">Salvar modelo</button></div>
  </section>
  <section class="ble-pane ble-preview-pane" aria-label="Pré-visualização da etiqueta"><div class="ble-pane-head"><div><h3 class="ble-heading">Pré-visualização</h3><p class="ble-sub">Arraste elementos para ajustar a posição</p></div><span id="bleDimensions" class="ble-sub">40 × 25 mm</span></div><div class="ble-stage" id="bleStage"><div id="labelPreview" class="ble-canvas" aria-label="Etiqueta proporcional"></div></div><div class="ble-preview-meta"><span>Prévia proporcional em tela</span><span>Impressão no tamanho definido</span></div><p class="ble-hint" style="margin-top:12px">O QR mostrado é ilustrativo. No PDF, o código contém apenas o SKU do produto. Para reproduzir a etiqueta de referência, adicione uma imagem com o logotipo 4SHOW.</p></section>
 </div>`);
 $('templateSelect').onchange=()=>{const t=templates.find(t=>t.id===$('templateSelect').value);if(!t)return;editing=labelDeepCopy(t);selectedElement=0;editFields()};
 $('templateNew').onclick=()=>{editing={name:'Novo modelo',width_mm:40,height_mm:25,elements:baseElements(),is_default:false};selectedElement=0;drawEditor();editFields()};
 $('templateClone').onclick=()=>{editing={...labelDeepCopy(editing),id:null,name:editing.name+' (cópia)',is_default:false};selectedElement=0;drawEditor();editFields()};
 $('templateDelete').onclick=async()=>{if(!editing.id)return toast('Esse modelo ainda não foi salvo.');const yes=await blingDialog({title:'Excluir modelo?',description:'Esta ação removerá o modelo salvo.',confirmText:'Excluir',danger:true});if(!yes)return;try{await apiB('/templates/'+editing.id,'DELETE');await models();}catch(e){error(e)}};
 $('addElement').onclick=()=>{const type=$('newElement').value;const w=type==='qr'?15:type==='logo'?10:18,h=type==='qr'?15:type==='logo'?10:5;editing.elements.push({type,x:2,y:2,w:Math.min(w,editing.width_mm-2),h:Math.min(h,editing.height_mm-2),fontSize:8,bold:false,align:'left'});selectedElement=editing.elements.length-1;drawElements()};
 $('saveTemplate').onclick=async()=>{try{editing.name=$('templateName').value.trim();editing.width_mm=Number($('labelWidth').value);editing.height_mm=Number($('labelHeight').value);editing.is_default=$('templateDefault').checked;if(!editing.name)return toast('Informe um nome para o modelo.');if(!(editing.width_mm>=15&&editing.width_mm<=300&&editing.height_mm>=15&&editing.height_mm<=300))return toast('As dimensões devem estar entre 15 e 300 mm.');for(const el of editing.elements)labelNormalize(el);await apiB('/templates'+(editing.id?'/'+editing.id:''),editing.id?'PUT':'POST',editing);toast('Modelo salvo com sucesso.');await models()}catch(e){error(e)}};
 ['labelWidth','labelHeight'].forEach(k=>$(k).onchange=()=>{editing[k==='labelWidth'?'width_mm':'height_mm']=Number($(k).value);if(!Number.isFinite(editing.width_mm)||!Number.isFinite(editing.height_mm)||editing.width_mm<15||editing.height_mm<15)return;editing.elements.forEach(labelNormalize);drawElements()});
 const stage=$('bleStage');if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(document.getElementById('bleStage')===stage)renderPreview();else observer.disconnect()});observer.observe(stage)}
}
function editFields(){
 $('templateName').value=editing.name;$('labelWidth').value=editing.width_mm;$('labelHeight').value=editing.height_mm;$('templateDefault').checked=!!editing.is_default;drawElements();
}
function drawElements(){labelElementList();labelProperties();renderPreview();}
async function models(){content(pageHead('CONFIGURAÇÕES','Modelos de Etiquetas','Carregando…'));try{templates=(await apiB('/templates')).templates||[];editing=JSON.parse(JSON.stringify(templates.find(t=>t.is_default)||templates[0]||{name:'Etiqueta padrão',width_mm:40,height_mm:25,elements:baseElements(),is_default:true}));drawEditor();editFields();}catch(e){content(`<div class="alert error">${esc(e.message)}</div>`)}}
const prior=renderPage;renderPage=function(){if(!['bling-integrations','bling-entries','bling-labels'].includes(currentPage))return prior();if(currentUser?.role==='support_agent'&&!(currentUser.menu_permissions||[]).includes(currentPage)){currentPage='overview';return prior();}if(currentPage==='bling-integrations')integrations();else if(currentPage==='bling-entries')stock();else if(!blingCan('bling.templates.manage'))content('<div class="alert">Você não tem permissão para gerenciar modelos de etiquetas.</div>');else models();};
if(location.search.includes('bling=connected')){history.replaceState({},'',location.pathname);setTimeout(()=>toast('Conta Bling conectada.'),800)}
})();
