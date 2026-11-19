(function(){
'use strict';
const $=id=>document.getElementById(id);
const html=[
'<div class="mlbt-modal-card" role="dialog" aria-modal="true" aria-labelledby="mlbtEditHeading">',
'<div class="mlbt-modal-header"><div><span class="mlbt-kicker">ML SH SUPPORT · CLONAGEM</span><h3 id="mlbtEditHeading">Editar anúncio</h3><p id="mlbtEditSub">As alterações serão feitas apenas na cópia.</p></div><button type="button" id="mlbtEditClose" aria-label="Fechar">✕</button></div>',
'<div class="mlbt-modal-body"><div id="mlbtEditHint" class="mlbt-edit-hint">Nenhum dado do anúncio original será modificado.</div>',
'<div class="mlbt-edit-grid"><label><span id="mlbtEditNameLabel">Título do anúncio</span><input id="mlbtEditName" maxlength="60"><small id="mlbtEditNameHelp">Até 60 caracteres.</small></label>',
'<label>Preço no destino (R$)<input id="mlbtEditPrice" type="number" min="0.01" max="100000000" step="0.01"><small>O preço original não é alterado.</small></label></div>',
'<div class="mlbt-edit-section"><div><h4>Fotos</h4><p>Reorganize pelas setas, remova ou envie JPG, PNG e WebP. A primeira imagem é a capa.</p></div><span id="mlbtEditPhotoCount">0 / 12</span></div>',
'<div id="mlbtEditPhotos" class="mlbt-edit-photos"></div>',
'<div class="mlbt-edit-upload"><label class="mlbt-edit-file"><input id="mlbtEditFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>＋ Enviar fotos</label>',
'<div class="mlbt-edit-url"><input id="mlbtEditUrl" type="url" placeholder="https://exemplo.com/imagem.jpg"><button id="mlbtEditAddUrl" type="button">Adicionar URL</button></div></div>',
'<div class="mlbt-edit-section"><div><h4>Descrição</h4><p>Texto simples, editável antes da publicação.</p></div><span id="mlbtEditChars">0 / 50.000</span></div>',
'<textarea id="mlbtEditDescription" rows="11" maxlength="50000" placeholder="Descrição do produto..."></textarea>',
'<div id="mlbtEditStatus" class="mlbt-edit-status" aria-live="polite"></div></div>',
'<div class="mlbt-modal-footer"><button type="button" id="mlbtEditCancel" class="mlbt-quiet">Cancelar</button>',
'<button type="button" id="mlbtEditReset" class="mlbt-quiet">Restaurar original</button>',
'<button type="button" id="mlbtEditSave" class="mlbt-primary">Salvar e validar</button></div></div>'
].join('');
function ensure(){
 let x=$('mlbtEditOverlay');if(x)return x;
 x=document.createElement('div');x.id='mlbtEditOverlay';x.className='mlbt-edit-overlay';x.hidden=true;x.innerHTML=html;
 document.body.append(x);return x;
}
const fileBase64=file=>new Promise((resolve,reject)=>{
 const reader=new FileReader();reader.onerror=()=>reject(Error('Erro ao ler imagem'));
 reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);
});
async function convertWebp(file){
 if(file.type!=='image/webp')return file;
 const bitmap=await createImageBitmap(file);
 try{
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  canvas.getContext('2d').drawImage(bitmap,0,0);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.9));
  if(!blob)throw Error('Falha na conversão do WebP.');
  return new File([blob],file.name.replace(/\.webp$/i,'.jpg'),{type:'image/jpeg'});
 }finally{bitmap.close?.()}
}
async function open({api,item_id,source_id,target_id,previous,onSave}){
 const overlay=ensure(),title=$('mlbtEditName'),price=$('mlbtEditPrice');
 const desc=$('mlbtEditDescription'),save=$('mlbtEditSave');
 let pictures=[],original=null,busy=false,closed=false;
 const focusBack=document.activeElement;
 const status=(msg,error=false)=>{const el=$('mlbtEditStatus');el.textContent=msg||'';el.dataset.error=String(error)};
 const close=()=>{if(busy)return;closed=true;overlay.hidden=true;focusBack?.focus?.()};
 overlay.hidden=false;status('Consultando anúncio original...');
 $('mlbtEditClose').onclick=close;$('mlbtEditCancel').onclick=close;
 overlay.onclick=e=>{if(e.target===overlay)close()};
 function renderPictures(){
  const root=$('mlbtEditPhotos');root.replaceChildren();$('mlbtEditPhotoCount').textContent=pictures.length+' / 12';
  pictures.forEach((pic,i)=>{
   const tile=document.createElement('div');tile.className='mlbt-photo-card';
   const src=pic.preview_url||pic.source;
   if(src){const image=document.createElement('img');image.src=src;image.alt='Foto '+(i+1);image.loading='lazy';tile.append(image)}
   else{const label=document.createElement('span');label.textContent='Foto adicionada';tile.append(label)}
   const badge=document.createElement('span');badge.className='mlbt-photo-badge';badge.textContent=i===0?'Capa':String(i+1);tile.append(badge);
   const controls=document.createElement('div');controls.className='mlbt-photo-actions';
   const actions=[
    ['←',i===0,()=>{[pictures[i-1],pictures[i]]=[pictures[i],pictures[i-1]];renderPictures()}],
    ['→',i===pictures.length-1,()=>{[pictures[i+1],pictures[i]]=[pictures[i],pictures[i+1]];renderPictures()}],
    ['✕',false,()=>{pictures.splice(i,1);renderPictures()}]
   ];
   actions.forEach(([label,disabled,fn])=>{
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.disabled=disabled;button.onclick=fn;controls.append(button);
   });
   tile.append(controls);root.append(tile);
  });
 }
 function fill(data){
  const familyMode=data.clone_type==='user_product'||!!data.family_name;
  $('mlbtEditNameLabel').textContent=familyMode?'Novo nome da família':'Novo título';
  $('mlbtEditNameHelp').textContent=familyMode?'O Mercado Livre gera o título a partir da família e dos atributos.':'Até 60 caracteres.';
  $('mlbtEditHint').textContent=data.clone_type==='catalog'?'Anúncio de catálogo: algumas alterações podem ser limitadas. Descrição gerenciada pelo catálogo.':data.variations_count?'Anúncio com '+data.variations_count+' variação(ões): mantenha as fotos vinculadas às opções (cor/tamanho). Remover fotos de uma variação impede a validação.':'Alterações exclusivas do novo anúncio. Não modifica a origem.';
  title.value=familyMode?(data.family_name||data.title||''):(data.title||'');price.value=String(data.price||'');
  desc.disabled=data.clone_type==='catalog';
  desc.value=data.description_text||'';$('mlbtEditChars').textContent=desc.value.length+' / 50.000';
  pictures=(Array.isArray(data.pictures)?data.pictures:[]).map(x=>({...x}));renderPictures();
 }
 try{
  const loaded=await api('/api/portal/bulk-tools/clone/source?source_id='+encodeURIComponent(source_id)+'&item_id='+encodeURIComponent(item_id));
  if(closed)return;
  original={...loaded,clone_type:previous?.clone_type||'standard'};
  if(previous){for(const key of ['title','price','description_text','clone_type','variations_count'])if(Object.prototype.hasOwnProperty.call(previous,key))original[key]=previous[key];
   if(Array.isArray(previous.pictures))original.pictures=previous.pictures;}
  fill(original);
  $('mlbtEditSub').textContent=item_id+' · Personalize antes da publicação.';
  status(loaded.description_error||'');
 }catch(e){status('Não foi possível carregar: '+e.message,true);return}
 $('mlbtEditReset').onclick=()=>{if(busy)return;fill(original);status('Dados restaurados.')};
 desc.oninput=()=>$('mlbtEditChars').textContent=desc.value.length+' / 50.000';
 $('mlbtEditAddUrl').onclick=()=>{
  const input=$('mlbtEditUrl'),url=input.value.trim();
  if(!/^https:\/\/\S+$/i.test(url)||url.length>2000){status('Informe uma URL HTTPS válida.',true);return}
  if(pictures.length>=12){status('Máximo de 12 fotos.',true);return}
  pictures.push({source:url});input.value='';renderPictures();status('');
 };
 $('mlbtEditFiles').onchange=async e=>{
  const files=[...(e.target.files||[])];e.target.value='';
  if(files.length+pictures.length>12){status('Máximo de 12 fotos.',true);return}
  busy=true;save.disabled=true;
  try{
   for(const f of files){
    if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>4*1024*1024)throw Error('Use JPG, PNG ou WebP de até 4 MB.');
    status('Enviando '+f.name+'...');
    const converted=await convertWebp(f);
    if(converted.size>4*1024*1024)throw Error('A imagem convertida excede 4 MB.');
    const result=await api('/api/portal/bulk-tools/clone/photo',{method:'POST',
     body:JSON.stringify({target_id,mime:converted.type,data:await fileBase64(converted)})});
    if(closed)return;
    pictures.push({id:result.id,preview_url:result.preview_url||''});renderPictures();
   }
   status('Fotos preparadas para a nova publicação.');
  }catch(error){status(error.message,true)}
  finally{busy=false;save.disabled=false}
 };
 save.onclick=async()=>{
  if(busy||closed)return;
  const name=title.value.trim(),newPrice=Number(price.value);
  if(!name||name.length>60){status('Informe o título ou nome da família com até 60 caracteres.',true);return}
  if(!Number.isFinite(newPrice)||newPrice<=0||newPrice>100000000){status('Preço inválido.',true);return}
  if(!pictures.length||pictures.length>12){status('É necessário manter entre 1 e 12 fotos.',true);return}
  busy=true;save.disabled=true;save.textContent='Validando...';
  try{
   await onSave({title:name,price:newPrice,
    ...(desc.disabled?{}:{description_text:desc.value}),
    pictures:pictures.map(p=>p.id?{id:p.id}:{source:p.source})});
   busy=false;close();
  }catch(error){status('Não foi possível salvar: '+error.message,true)}
  finally{busy=false;save.disabled=false;save.textContent='Salvar e validar'}
 };
 title.focus();
}
window.mlshCloneEditor={open};
})();