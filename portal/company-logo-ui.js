(() => {
  'use strict';
  document.addEventListener('click', async event => {
    const btn=event.target.closest('[data-company-logo]');
    if(!btn || btn.disabled)return;
    const companyId=btn.dataset.companyLogo;
    const chooser=document.createElement('input');
    chooser.type='file';chooser.accept='image/png,image/jpeg,image/webp';chooser.hidden=true;
    document.body.appendChild(chooser);
    chooser.addEventListener('change',async()=>{
      const file=chooser.files?.[0];chooser.remove();
      if(!file)return;
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('Selecione uma foto JPG, PNG ou WebP.');return;}
      if(file.size>10*1024*1024){toast('Escolha uma imagem com menos de 10 MB.');return;}
      const original=btn.textContent;btn.disabled=true;btn.textContent='Enviando foto…';
      try {
        const image=await createImageBitmap(file);
        const side=Math.min(480,Math.max(image.width,image.height));
        const scale=side/Math.max(image.width,image.height);
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        image.close?.();
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Não foi possível preparar a foto.')),'image/webp',0.84));
        if(blob.size>1024*1024)throw new Error('A imagem ficou muito grande.');
        const response=await fetch('/api/portal/company-logo/'+encodeURIComponent(companyId),{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'image/webp'},body:blob});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.message||'Não foi possível enviar a foto.');
        for(const license of dashboard.licenses||[]){
          if(String(license.company_id)===String(companyId)){license.logo_url=data.logo_url;if(license.company&&typeof license.company==='object')license.company.logo_url=data.logo_url;}
        }
        renderPage();toast('Foto da empresa salva com sucesso!');
      }catch(error){toast(error.message||'Falha ao salvar a foto.');if(btn.isConnected){btn.disabled=false;btn.textContent=original;}}
    },{once:true});
    chooser.click();
    window.addEventListener('focus',()=>setTimeout(()=>chooser.remove(),60000),{once:true});
  });
})();
