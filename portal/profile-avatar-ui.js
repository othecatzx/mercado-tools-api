(() => {
 'use strict';
 let latestUrl=null;
 function paint(url){
  latestUrl=url||null;
  const node=document.getElementById('sideAvatar');
  if(!node)return;
  node.textContent='';
  node.style.backgroundImage='';
  node.style.backgroundSize='';
  node.style.backgroundPosition='';
  if(url){
   node.style.backgroundImage='url("'+String(url).replace(/["\\]/g,'')+'")';
   node.style.backgroundSize='cover';node.style.backgroundPosition='center';
  }else node.textContent=String(currentUser?.nome||'C').trim().charAt(0).toUpperCase();
 }
 async function refresh(){
  if(!token||!currentUser)return;
  try{
   const response=await api('/api/portal/profile-avatar');
   if(currentUser)paint(response.avatar_url);
  }catch(error){console.error('Não foi possível obter a foto do perfil:',error.message);}
 }
 async function selectPhoto(){
  if(currentUser?.role==='support_agent')return;
  const picker=document.createElement('input');
  picker.type='file';picker.accept='image/jpeg,image/png,image/webp';picker.hidden=true;
  document.body.appendChild(picker);
  picker.onchange=async()=>{
   const file=picker.files?.[0];picker.remove();
   if(!file)return;
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){toast('Escolha uma foto JPG, PNG ou WebP de até 10 MB.');return;}
   const status=document.getElementById('mlshProfilePhotoStatus');
   if(status)status.textContent='Enviando e atualizando a foto da equipe…';
   const button=document.getElementById('mlshProfilePhotoButton');
   if(button)button.disabled=true;
   try{
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,480/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));
    canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close?.();
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error('Falha ao preparar foto.')),'image/webp',0.82));
    if(blob.size>1024*1024)throw new Error('A imagem excedeu 1 MB.');
    const response=await fetch('/api/portal/profile-avatar',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'image/webp'},body:blob});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||'Falha ao salvar foto.');
    paint(data.avatar_url);
    if(status)status.textContent='Foto salva! Ela aparecerá para todos os subusuários quando atualizarem o portal.';
    toast('Foto atualizada para toda a equipe!');
   }catch(e){if(status)status.textContent=e.message;toast(e.message);}
   finally{if(button)button.disabled=false;}
  };
  picker.click();
 }
 function mount(){
  if(currentPage!=='settings'||currentUser?.role==='support_agent')return;
  const panel=document.querySelector('.settings-box');
  if(!panel||document.getElementById('mlshProfilePhotoPanel'))return;
  const section=document.createElement('section');
  section.id='mlshProfilePhotoPanel';
  section.innerHTML='<div class="settings-row" style="align-items:center"><div><b>Foto da conta e da equipe</b><p>Esta foto será exibida na barra lateral para o proprietário e <strong>todos os subusuários</strong> vinculados à sua conta.</p><small class="muted">Somente o proprietário pode alterar. Formatos JPG, PNG e WebP.</small><p id="mlshProfilePhotoStatus" role="status" aria-live="polite"></p></div><button class="btn btn-primary" type="button" id="mlshProfilePhotoButton">Escolher foto</button></div>';
  panel.prepend(section);
  section.querySelector('#mlshProfilePhotoButton').onclick=selectPhoto;
 }
 function bindSidebar(){
  const avatar=document.getElementById('sideAvatar');
  if(!avatar)return;
  avatar.title=currentUser?.role==='support_agent'?'Foto definida pelo titular':'Clique para alterar a foto da conta e de todos os subusuários';
  avatar.style.cursor=currentUser?.role==='support_agent'?'default':'pointer';
  avatar.onclick=()=>{if(currentUser?.role!=='support_agent')navigate('settings');};
 }
 window.mlshProfileAvatar={refresh,mount,bindSidebar,paint};
})();
