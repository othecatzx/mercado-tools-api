/* Módulo aditivo das telas Bling; preserva a navegação e autenticação existentes. */
(() => {
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
      <form id="blingDialogForm">${fields.map(f=>`<label class="bling-dialog-field">${esc(f.label)}<input class="filter-control" name="${esc(f.name)}" value="${esc(f.value??'')}" maxlength="${Number(f.maxlength)||100}" ${f.required?'required':''}></label>`).join('')}
      <div class="bling-dialog-actions"><button class="btn btn-ghost" type="button" id="blingDialogCancel">Cancelar</button><button class="btn ${danger?'btn-ghost':'btn-primary'}" type="submit">${esc(confirmText)}</button></div></form></div>`;
    const css=document.getElementById('blingDialogCss')||document.createElement('style');
    css.id='blingDialogCss';css.textContent=`#blingDialogShade{position:fixed;inset:0;z-index:9999;background:rgba(10,15,30,.65);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}.bling-dialog{box-sizing:border-box;background:var(--card-bg,var(--surface,#fff));color:var(--text,#20242a);border:1px solid var(--line,#ddd);border-radius:16px;padding:24px;width:min(100%,460px);max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 14px 50px #0004}.bling-dialog h3{margin:0 0 12px;font-size:1.15rem}.bling-dialog-field{display:grid;gap:6px;margin:14px 0}.bling-dialog-field input{width:100%;box-sizing:border-box}.bling-dialog-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:20px}@media(max-width:480px){.bling-dialog{padding:18px}.bling-dialog-actions button{flex:1}}`;
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
  $('blingAdd').onclick=()=>connect();
  try{
    await getConnections();
    $('blingList').innerHTML=connections.length?connections.map(c=>`<article style="padding:18px 0;border-bottom:1px solid var(--line)">
      <h3>${esc(c.name)}</h3><p class="muted">${c.status==='connected'?'Conectada':'Desconectada'} · Webhook: ${c.webhook_company_id||c.company_id?'Vinculado automaticamente':'Aguardando identificação no primeiro evento de estoque'} · Última sincronização: ${fmt(c.last_sync_at)}</p>
      <div class="actions"><button class="btn btn-ghost" data-rename="${esc(c.id)}">Editar nome</button><button class="btn btn-ghost" data-reconnect="${esc(c.id)}">Reconectar</button><button class="btn btn-ghost" data-disconnect="${esc(c.id)}">Desconectar</button></div></article>`).join(''):'Nenhuma conta conectada.';
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
async function stock(){content(pageHead('ESTOQUE','Entradas de Estoque','Movimentações físicas de entrada recebidas pelos webhooks.',`<button class="btn btn-primary" id="generateLabels">Gerar etiquetas</button>`)+`<div class="panel"><div class="actions" style="margin-bottom:16px">${selector()}<input class="filter-control" id="blingSearch" placeholder="Pesquisar por SKU ou nome"><button class="btn btn-ghost" id="blingRefresh">↻ Atualizar</button></div><div id="stockList">Carregando…</div></div>`);$('blingFilter').onchange=e=>{selectedConn=e.target.value;stock()};$('blingSearch').oninput=e=>renderEntries(e.target.value);$('blingRefresh').onclick=async()=>{
  const btn=$('blingRefresh');btn.disabled=true;btn.textContent='Sincronizando produtos…';
  const ids=selectedConn?[selectedConn]:connections.filter(c=>c.status==='connected').map(c=>c.id);
  let fixed=0, pending=0;const issues=[];
  try{
    for(const id of ids){
      try{
        const result=await apiB('/entries/enrich','POST',{connection_id:id});
        fixed+=result.enriched||0;pending+=result.missingSku||0;
        if(result.failures?.length){
          const c=connections.find(x=>x.id===id);
          const f=result.failures[0];
          issues.push((c?.name||'Bling')+': '+(f.status||'erro')+' - '+f.reason);
        }
      }catch(e){issues.push((connections.find(c=>c.id===id)?.name||'Bling')+': '+e.message);}
    }
    await stock();
    if(issues.length){error(new Error('Falha ao consultar produtos: '+issues.join('; ')));}
    else if(pending)toast('Há '+pending+' produto(s) sem SKU cadastrado no Bling.');
    else toast(fixed?'Produtos sincronizados: '+fixed:'Nenhum produto pendente de sincronização.');
  }catch(e){error(e);await stock();}
};$('generateLabels').onclick=generate;try{await getConnections();$('blingFilter').innerHTML='<option value="">Todas as contas</option>'+connections.filter(c=>c.status==='connected').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('blingFilter').value=selectedConn;
entries=(await apiB('/entries'+(selectedConn?'?connection_id='+encodeURIComponent(selectedConn):''))).entries||[];renderEntries('');}catch(e){$('stockList').textContent=e.message;}}
function renderEntries(search){const q=(search||'').toLowerCase();const visible=entries.filter(e=>(e.sku+' '+e.product_name).toLowerCase().includes(q));$('stockList').innerHTML=`<div style="margin-bottom:12px"><label><input type="checkbox" id="allEntries"> Selecionar todos os resultados</label> <small class="muted">(${visible.length} movimentações)</small></div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th></th><th>Produto</th><th>SKU</th><th>Entrada</th><th>Data / hora</th><th>Conta</th><th>Etiquetas</th></tr></thead><tbody>${visible.map(e=>`<tr style="border-top:1px solid var(--line)"><td><input type="checkbox" data-entry="${e.id}" ${chosen.has(e.id)?'checked':''}></td><td style="padding:10px">${e.image_url&&/^https:\/\//i.test(e.image_url)?`<img alt="" src="${esc(e.image_url)}" style="width:38px;height:38px;object-fit:contain;vertical-align:middle">`:''} ${esc(e.product_name||'Produto não sincronizado')}</td><td>${esc(e.sku||'—')}</td><td>${esc(e.quantity)}</td><td>${fmt(e.occurred_at)}</td><td>${esc(e.bling_connections?.name||'')}</td><td><input type="number" min="1" max="500" value="1" data-count="${e.id}" style="width:65px" aria-label="Quantidade de etiquetas"></td></tr>`).join('')}</tbody></table></div>`;document.querySelectorAll('[data-entry]').forEach(b=>b.onchange=()=>b.checked?chosen.add(b.dataset.entry):chosen.delete(b.dataset.entry));$('allEntries').onchange=e=>{visible.forEach(v=>e.target.checked?chosen.add(v.id):chosen.delete(v.id));renderEntries($('blingSearch').value)};}
async function generate(){const picked=entries.filter(e=>chosen.has(e.id));if(!picked.length)return toast('Selecione pelo menos um produto.');if(picked.some(e=>!e.sku))return toast('Atualize os produtos para obter o SKU antes de imprimir.');const selection=picked.map(e=>({id:e.id,count:Number(document.querySelector(`[data-count="${e.id}"]`)?.value||1)}));if(selection.some(e=>!Number.isInteger(e.count)||e.count<1||e.count>500))return toast('Quantidade inválida (1 a 500).');try{templates=(await apiB('/templates')).templates||[];if(!templates.length)return toast('Crie primeiro um modelo em Configurações → Modelos de Etiquetas.');const id=templates.find(t=>t.is_default)?.id||templates[0].id;const choices=templates.map(t=>t.name+' ('+t.width_mm+'×'+t.height_mm+' mm)').join(' | ');const values=await blingDialog({title:'Gerar etiquetas',description:'Modelo padrão: '+(templates.find(t=>t.id===id)?.name||'')+'. Modelos disponíveis: '+choices,fields:[{name:'name',label:'Nome do modelo',value:templates.find(t=>t.id===id)?.name,required:true}],confirmText:'Gerar PDF'});if(!values)return;const t=templates.find(t=>t.name===values.name);if(!t)return toast('Modelo não encontrado. Escolha um nome exibido na lista.');const response=await fetch(API+'/api/portal/bling/labels/pdf',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({template_id:t.id,entries:selection})});if(!response.ok)throw Error('Falha ao gerar PDF');const blob=await response.blob();const url=URL.createObjectURL(blob);window.open(url,'_blank');setTimeout(()=>URL.revokeObjectURL(url),120000);}catch(e){error(e)}}
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
 @media(max-width:1000px){.ble-wrap{grid-template-columns:minmax(0,1fr)}.ble-preview-pane{order:-1}.ble-stage{min-height:240px}}
 @media(max-width:520px){.ble-pane{padding:14px;border-radius:12px}.ble-topbar .btn{flex:1}.ble-fields{gap:9px}.ble-props .ble-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.ble-props .ble-prop-wide{grid-column:span 2}.ble-stage{padding:16px 8px;min-height:210px}.ble-element-options{flex-wrap:wrap}.ble-element-options .btn{width:100%}}
 `;
 document.head.appendChild(style);
}
const labelDeepCopy=t=>JSON.parse(JSON.stringify(t));
function labelClamp(v,lo,hi){return Math.min(hi,Math.max(lo,v));}
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
 ${el.type==='logo'?`<label class="ble-field ble-upload">Enviar logotipo ou imagem (PNG/JPEG, até 180 KB)<input type="file" id="bleImageUpload" accept="image/png,image/jpeg"></label>${el.image?'<button type="button" id="bleImageRemove" class="btn btn-ghost" style="margin-top:8px">Remover imagem</button>':''}`:''}
 <p class="ble-hint">Arraste o elemento na prévia para posicioná-lo. As medidas são em milímetros e serão respeitadas no PDF.</p>`;
 panel.querySelector('#bleRemove').onclick=()=>{editing.elements.splice(selectedElement,1);selectedElement=Math.max(0,Math.min(selectedElement,editing.elements.length-1));drawElements()};
 panel.querySelectorAll('[data-lprop]').forEach(input=>{const change=()=>{
 const key=input.dataset.lprop;el[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;
 if(['x','y','w','h'].includes(key)){labelNormalize(el);panel.querySelectorAll('[data-lprop]').forEach(f=>{if(['x','y','w','h'].includes(f.dataset.lprop))f.value=el[f.dataset.lprop]});}
 renderPreview();if(['x','y','w','h'].includes(key))labelElementList();
 };input.addEventListener(input.type==='checkbox'||input.tagName==='SELECT'?'change':'input',change)});
 const imgUpload=panel.querySelector('#bleImageUpload');if(imgUpload)imgUpload.onchange=()=>{
 const file=imgUpload.files?.[0];if(!file)return;
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>180000){toast('Selecione PNG ou JPEG de até 180 KB.');imgUpload.value='';return;}
 const reader=new FileReader();reader.onload=()=>{if(typeof reader.result==='string'){el.image=reader.result;renderPreview();labelProperties();}};reader.readAsDataURL(file);
 };
 const removeImg=panel.querySelector('#bleImageRemove');if(removeImg)removeImg.onclick=()=>{delete el.image;renderPreview();labelProperties()};
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
const prior=renderPage;renderPage=function(){if(!['bling-integrations','bling-entries','bling-labels'].includes(currentPage))return prior();if(currentUser?.role==='support_agent'){currentPage='overview';return prior();}if(currentPage==='bling-integrations')integrations();else if(currentPage==='bling-entries')stock();else models();};
if(location.search.includes('bling=connected')){history.replaceState({},'',location.pathname);setTimeout(()=>toast('Conta Bling conectada.'),800)}
})();
