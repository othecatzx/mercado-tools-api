/* ML SH Support — prévia e clonagem de lote, sem retentativas automáticas. */
(function(){
'use strict';
const q=id=>document.getElementById(id);
function init({api}){
 const root=document.querySelector('.mlsh-bulk-tools[data-tool="clone"]');
 if(!root||typeof api!=='function')return;
 const preview=q('mlbtClonePreview'),apply=q('mlbtCloneApply'),list=q('mlbtCloneList');
 const consent=q('mlbtCloneConsent'),consentLine=q('mlbtCloneConsentWrap');
 let approved=null,running=false;
 const text=(value,error=false)=>{
   const node=q('mlbtCloneStatus');
   if(node){node.textContent=value;node.dataset.error=String(error)}
 };
 const reset=()=>{
   if(running)return;
   approved=null;list.replaceChildren();list.hidden=true;
   consent.checked=false;consentLine.hidden=true;apply.hidden=true;apply.disabled=true;
   text('');
 };
 ['mlbtSource','mlbtTarget','mlbtItem','mlbtStock'].forEach(id=>q(id).addEventListener('input',reset));
 const current=()=>({
   source_id:q('mlbtSource').value,
   target_id:q('mlbtTarget').value,
   stock:Number(q('mlbtStock').value)
 });
 const ids=()=>[...new Set(String(q('mlbtItem').value||'').toUpperCase().split(/[\s,;]+/).filter(Boolean))];
 function addResult(title,details,checkable,error=false){
   const row=document.createElement('label');
   row.className='mlsh-tools-item'+(error?' mlsh-tools-error':'');
   if(checkable){
     const cb=document.createElement('input');
     cb.type='checkbox';cb.className='mlbtBatchSelected';cb.value=title;cb.checked=true;
     row.append(cb);
   }
   const span=document.createElement('span');span.textContent=details;row.append(span);list.append(row);
   list.hidden=false;
 }
 preview.onclick=async()=>{
   if(running)return;reset();
   const request=current(),items=ids();
   if(!request.source_id||!request.target_id||request.source_id===request.target_id){
     text('Escolha duas contas diferentes: origem e destino.',true);return;
   }
   if(!items.length||items.length>20||items.some(id=>!/^MLB\d{6,15}$/.test(id))){
     text('Informe de 1 a 20 códigos MLB válidos, separados por linha, vírgula ou espaço.',true);return;
   }
   if(!Number.isSafeInteger(request.stock)||request.stock<1||request.stock>99999){
     text('Estoque inicial inválido (mínimo 1, máximo 99999).',true);return;
   }
   running=true;preview.disabled=true;
   const eligible=[],failed=[];
   try{
     for(const [index,item_id] of items.entries()){
       preview.textContent='Consultando '+(index+1)+' de '+items.length;
       try{
         const data=await api('/api/portal/bulk-tools/clone/preview',{
           method:'POST',body:JSON.stringify({...request,item_id})
         });
         if(!root.isConnected)return;
         const p=data.preview;
         eligible.push({item_id,catalog_product_id:p.catalog_product_id||null,family_name:p.family_name||null});
         const kind=p.clone_type==='catalog'
           ?'CATÁLOGO '+p.catalog_product_id+' · Confirme que é exatamente o mesmo produto'
           :p.clone_type==='user_product'?'FAMÍLIA '+p.family_name+' · Título gerado pelo Mercado Livre':'Anúncio independente';
         const removed=Array.isArray(p.removed_attributes)?p.removed_attributes:[];
         const cleanup=removed.length?' · '+removed.length+' atributo(s) interno(s) excluído(s) do envio: '+removed.join(', '):'';
         addResult(item_id,item_id+' · '+p.title+' · '+kind+' · R$ '+Number(p.price).toFixed(2)+' · '+p.pictures+' foto(s)'+cleanup+' · '+p.warning,true);
       }catch(error){
         if(!root.isConnected)return;
         failed.push({item_id,error:String(error?.message||error)});
         addResult(item_id,item_id+' · '+String(error?.message||error),false,true);
       }
       if(!root.isConnected)return;
       text(eligible.length+' apto(s), '+failed.length+' com erro. '+(index+1)+' de '+items.length+' consultado(s).',failed.length>0);
     }
     if(eligible.length){
       approved={...request,eligible};
       consent.checked=false;consentLine.hidden=false;apply.hidden=false;apply.disabled=true;
       text(eligible.length+' anúncio(s) apto(s) para publicação. Revise os selecionados e confirme. '+failed.length+' não elegível(is).');
     }else text('Nenhum anúncio apto para clonagem. Revise os erros e as contas.',true);
   }finally{
     running=false;
     if(root.isConnected){preview.disabled=false;preview.textContent='Consultar e revisar'}
   }
 };
 consent.addEventListener('change',()=>{apply.disabled=!approved||!consent.checked});
 apply.onclick=async()=>{
   if(running||!approved||!consent.checked)return;
   const selected=[...list.querySelectorAll('.mlbtBatchSelected:checked')].map(cb=>cb.value);
   if(!selected.length){text('Selecione pelo menos um anúncio.',true);return}
   const request=approved;approved=null;
   const expectedCatalog=new Map(request.eligible.map(x=>[x.item_id,x.catalog_product_id]));
   const expectedFamily=new Map(request.eligible.map(x=>[x.item_id,x.family_name]));
   running=true;preview.disabled=true;apply.disabled=true;
   const successful=[],errors=[];
   list.replaceChildren();list.hidden=false;
   // Falhas de rede são ambíguas; não repetir automaticamente uma publicação.
   try{
     for(const [index,item_id] of selected.entries()){
       apply.textContent='Publicando '+(index+1)+' de '+selected.length;
       try{
         const result=await api('/api/portal/bulk-tools/clone/apply',{
           method:'POST',body:JSON.stringify({
             source_id:request.source_id,target_id:request.target_id,stock:request.stock,
             item_id,expected_catalog_product_id:expectedCatalog.get(item_id)||null,
             expected_family_name:expectedFamily.get(item_id)||null,confirm:true
           })
         });
         if(!root.isConnected)return;
         successful.push({item_id,new_id:String(result.created_id||''),description:result.description_status||''});
         addResult(item_id,'Criado: '+item_id+' → '+result.created_id+' · Descrição: '+result.description_status,false);
       }catch(error){
         if(!root.isConnected)return;
         errors.push({item_id,error:String(error?.message||error)});
         addResult(item_id,'Verificar manualmente: '+item_id+' · '+String(error?.message||error),false,true);
       }
       if(!root.isConnected)return;
       text(successful.length+' criado(s), '+errors.length+' falha(s), '+(selected.length-index-1)+' restante(s).',errors.length>0);
     }
     if(root.isConnected){
       text(successful.length+' anúncio(s) criado(s), '+errors.length+' falha(s). Antes de repetir qualquer falha, verifique se o anúncio já foi criado na conta de destino.',errors.length>0);
       consent.checked=false;consentLine.hidden=true;apply.hidden=true;
     }
   }finally{
     running=false;
     if(root.isConnected){preview.disabled=false;apply.textContent='Confirmar clonagem'}
   }
 };
}
window.mlshCloneBatch={init};
})();