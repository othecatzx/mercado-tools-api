'use strict';
const API='https://api.mercadolibre.com';
const validItem = value => /^MLB\d{6,15}$/i.test(String(value||'').trim());
const validCategory = value => /^MLB\d{2,12}$/i.test(String(value||'').trim());
const validDims = d => {
 const height=Number(d?.height),width=Number(d?.width),length=Number(d?.length),weight=Number(d?.weight);
 if (![height,width,length,weight].every(x=>Number.isFinite(x)&&x>0))return null;
 if ([height,width,length].some(x=>x>300||!Number.isSafeInteger(x))||weight>100000||!Number.isSafeInteger(weight))return null;
 return {height:Math.round(height),width:Math.round(width),length:Math.round(length),weight:Math.round(weight)};
};
function packageAttributes(dimensions){
 const d=validDims(dimensions);
 if(!d)throw new Error('Informe medidas em cm (até 300) e peso em gramas (até 100000).');
 return Object.entries({SELLER_PACKAGE_HEIGHT:d.height,SELLER_PACKAGE_WIDTH:d.width,SELLER_PACKAGE_LENGTH:d.length,SELLER_PACKAGE_WEIGHT:d.weight})
  .map(([id,value_name])=>({id,value_name:String(value_name)+(id.endsWith('WEIGHT')?' g':' cm')}));
}
const packageKeys=new Set(['SELLER_PACKAGE_HEIGHT','SELLER_PACKAGE_WIDTH','SELLER_PACKAGE_LENGTH','SELLER_PACKAGE_WEIGHT']);
function buildDimensionUpdate(item,dimensions){
 const attrs=packageAttributes(dimensions);
 if(item.shipping?.logistic_type==='fulfillment')throw new Error('Anúncio Full: dimensões controladas pela logística.');
 if(item.shipping?.mode==='me1')throw new Error('Mercado Envios 1: edição automática de shipping.dimensions ainda não suportada nesta versão.');
 return {attributes:attrs};
}
function prepareClone(item,stock,title){
 const qty=Number(stock);
 if(!Number.isSafeInteger(qty)||qty<1||qty>99999)throw new Error('Estoque inicial deve estar entre 1 e 99999.');
 // IDs de família / User Products identificam o agrupamento do vendedor e não
 // devem ser enviados à conta de destino. Sozinhos, não indicam catálogo.
 // O catálogo verdadeiro exige catalog_product_id e catalog_listing=true.
 if(item.parent_item_id)throw new Error('Anúncio vinculado a anúncio-pai: fluxo de clonagem específico necessário.');
 if(item.catalog_listing===true && !/^MLB\d+$/.test(String(item.catalog_product_id||'')))throw new Error('Anúncio de catálogo sem catalog_product_id válido; revise o produto de catálogo antes de publicar.');
 if(item.variations?.length)throw new Error('Anúncio com variações precisa de revisão das variações e fotos; clonagem automática bloqueada.');
 if(!['active','paused'].includes(item.status))throw new Error('Status do anúncio de origem não permitido.');
 const name=String(title||item.title||'').trim();
 if(!name||name.length>60)throw new Error('Informe título de 1 a 60 caracteres.');
 if(!Number.isFinite(Number(item.price))||Number(item.price)<=0)throw new Error('Preço de origem inválido.');
 if(!/^MLB\d+$/.test(String(item.category_id)))throw new Error('Categoria inválida.');
 const sourcePictures=(item.pictures||[]).map(p=>p.secure_url||p.url).filter(s=>typeof s==='string'&&/^https:\/\//.test(s)).slice(0,12);
 if(!sourcePictures.length&&item.catalog_listing!==true)throw new Error('Anúncio sem fotos reutilizáveis.');
 const attrs=(item.attributes||[]).filter(a=>a&&typeof a.id==='string'&&!packageKeys.has(a.id))
  .map(a=>({id:a.id,...(a.value_id?{value_id:a.value_id}:a.value_name?{value_name:a.value_name}:{})}))
  .filter(a=>a.value_id||a.value_name);
 const payload={
  title:name,category_id:item.category_id,price:Number(item.price),currency_id:item.currency_id||'BRL',
  available_quantity:qty,buying_mode:item.buying_mode||'buy_it_now',
  listing_type_id:item.listing_type_id||'gold_special',
  condition:item.condition||'new',pictures:sourcePictures.map(source=>({source})),
  attributes:attrs
 };
 if(/^MLB\d+$/.test(String(item.catalog_product_id||''))){
  // Mesmo anúncios tradicionais podem precisar do catalog_product_id quando
  // a categoria é productizada. Preservar a identificação do produto original.
  // Isso NÃO transforma o anúncio em catálogo sem catalog_listing=true.
  payload.catalog_product_id=String(item.catalog_product_id);
 }
 if(item.catalog_listing===true){
  // Publicação direta em catálogo. Não transfere os vínculos de família
  // exclusivos do vendedor original para a conta de destino.
  payload.catalog_listing=true;
 }
 if(item.seller_custom_field)payload.seller_custom_field=String(item.seller_custom_field).slice(0,255);
 if(item.warranty)payload.warranty=item.warranty;
 if(item.shipping?.local_pick_up===true)payload.shipping={local_pick_up:true};
 return payload;
}
module.exports={validItem,validCategory,validDims,packageAttributes,buildDimensionUpdate,prepareClone,
 register(app,{authPortalOrAgent,scopedMenuAllowed,getShippingAccounts,ensureMlToken,shippingFreeFetchItem}){
 const gate = name => (req,res,next)=>scopedMenuAllowed(req,name)?next():res.status(403).json({ok:false,message:'Permissão não liberada para esta ferramenta.'});
 const guardAccounts = (req,res,next)=>(scopedMenuAllowed(req,'clone-listings')||scopedMenuAllowed(req,'bulk-dimensions'))?next():res.status(403).json({ok:false,message:'Sem permissão para consultar contas.'});
 // Preserve as causas devolvidas pelo ML, inclusive campos faltantes.
 // Não expor cabeçalhos, tokens, payloads nem respostas inteiras ao cliente.
 function mlErrorMessage(data,status){
  const causes=Array.isArray(data?.cause)?data.cause:[];
  const messages=causes.slice(0,8).map(c=>{
   const code=String(c?.code||'').slice(0,90);
   const message=String(c?.message||'').slice(0,300);
   const refs=Array.isArray(c?.references)?c.references.filter(x=>typeof x==='string').slice(0,5).join(', ').slice(0,160):'';
   return [code,message,refs?'Campos: '+refs:''].filter(Boolean).join(' — ');
  }).filter(Boolean);
  return (messages.length?messages.join(' | '):String(data?.message||data?.error||'Erro HTTP '+status)).slice(0,1400);
 }
 async function ml(token,path,method='GET',body){
  const r=await fetch(API+path,{method,headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
   const err=new Error(mlErrorMessage(data,r.status));
   err.status=r.status;
   err.code=String(data?.error||'').slice(0,70);
   throw err;
  }
  return data;
 }
 async function validateBeforePublish(token,payload){
  try{
   await ml(token,'/items/validate','POST',payload);
  }catch(e){
   throw new Error('Validação de publicação: '+String(e.message).slice(0,1400));
  }
 }
 // Algumas contas usam o novo modelo User Products, que exige
 // family_name em vez de title. Só adaptar após a validação indicar
 // explicitamente essa regra; não vincular IDs de família entre vendedores.
 async function validateCloneCandidate(token,item,initial){
  try{
   await validateBeforePublish(token,initial);
   return initial;
  }catch(firstError){
   const msg=String(firstError?.message||'');
   if(!/body\.required_fields/i.test(msg)||!/family_name/i.test(msg))throw firstError;
   const family=String(item.family_name||initial.title||item.title||'').trim();
   if(!family||family.length>60)throw new Error('Nome da família obrigatório e inválido; revise o produto de origem.');
   const adapted={...initial,family_name:family};
   delete adapted.title; // Novo modelo UP gera o título automaticamente.
   await validateBeforePublish(token,adapted);
   return adapted;
  }
 }
 async function selectedAccount(req,id){
  const matches=(await getShippingAccounts(req)).filter(a=>String(a.ml_user_id)===String(id));
  if(matches.length!==1)throw new Error('Selecione uma conta conectada e autorizada.');
  return matches[0];
 }
 app.get('/api/portal/bulk-tools/accounts',authPortalOrAgent,guardAccounts,async(req,res)=>{
  try{
   const accounts=await getShippingAccounts(req);
   res.json({ok:true,accounts:accounts.map(a=>({ml_user_id:String(a.ml_user_id),company_id:a.company_id,name:a.nickname||a.company_name,company_name:a.company_name}))});
  }catch(e){res.status(500).json({ok:false,message:'Não foi possível carregar as contas.'})}
 });
 app.post('/api/portal/bulk-tools/clone/preview',authPortalOrAgent,gate('clone-listings'),async(req,res)=>{
  try{
   const id=String(req.body?.item_id||'').toUpperCase().trim();
   if(!validItem(id))return res.status(400).json({ok:false,message:'Informe um MLB válido.'});
   if(String(req.body?.source_id)===String(req.body?.target_id))return res.status(400).json({ok:false,message:'Origem e destino devem ser diferentes.'});
   const source=await selectedAccount(req,req.body?.source_id),target=await selectedAccount(req,req.body?.target_id);
   const token=await ensureMlToken(source);
   const item=await shippingFreeFetchItem(id,token);
   if(String(item.seller_id)!==String(source.ml_user_id))return res.status(403).json({ok:false,message:'Anúncio não pertence à conta de origem.'});
   const targetToken=await ensureMlToken(target);
   const stock=Number(req.body?.stock),title=String(req.body?.title||item.title||'');
   const candidate=await validateCloneCandidate(targetToken,item,prepareClone(item,stock,title));
   res.json({ok:true,preview:{item_id:id,source_name:source.nickname||source.company_name,
    target_name:target.nickname||target.company_name,title:candidate.title||item.title,category_id:candidate.category_id,
    price:candidate.price,stock:candidate.available_quantity,pictures:candidate.pictures.length,
    listing_type_id:candidate.listing_type_id,
    clone_type:candidate.catalog_listing===true?'catalog':candidate.family_name?'user_product':'standard',
    family_name:candidate.family_name||null,
    catalog_product_id:candidate.catalog_product_id||null,
    description:candidate.catalog_listing===true?'Descrição definida pelo catálogo quando aplicável.':'Descrição será copiada quando disponível.',
    warning:candidate.catalog_listing===true?
      'CATÁLOGO: confirme que o item físico corresponde exatamente ao produto '+candidate.catalog_product_id+'. O Mercado Livre controla a ficha técnica e pode recusar a publicação.':
      candidate.family_name?
      'NOVO MODELO: será enviado family_name='+candidate.family_name+'. O Mercado Livre gera o título automaticamente; não serão transferidos IDs de famílias da origem.':
      'Anúncio independente: título, preço, fotos e atributos serão enviados; vínculos de família do vendedor original não são transferidos.'}});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 app.post('/api/portal/bulk-tools/clone/apply',authPortalOrAgent,gate('clone-listings'),async(req,res)=>{
  try{
   if(req.body?.confirm!==true)return res.status(400).json({ok:false,message:'Confirmação obrigatória.'});
   const id=String(req.body?.item_id||'').toUpperCase().trim();
   if(!validItem(id)||String(req.body?.source_id)===String(req.body?.target_id))return res.status(400).json({ok:false,message:'Origem ou destino inválidos.'});
   const source=await selectedAccount(req,req.body?.source_id),target=await selectedAccount(req,req.body?.target_id);
   const sourceToken=await ensureMlToken(source),targetToken=await ensureMlToken(target);
   const item=await shippingFreeFetchItem(id,sourceToken);
   if(String(item.seller_id)!==String(source.ml_user_id))return res.status(403).json({ok:false,message:'Conta de origem não é proprietária do anúncio.'});
   const payload=await validateCloneCandidate(targetToken,item,prepareClone(item,req.body?.stock,req.body?.title));
   // Reexamina os dados sempre antes da escrita para não usar preview obsoleto.
   if(payload.family_name && String(req.body?.expected_family_name||'')!==payload.family_name){
     return res.status(409).json({ok:false,message:'O nome da família deve ser confirmado novamente na prévia.'});
   }
   // Produtos de catálogo precisam coincidir exatamente com o item físico.
   if(payload.catalog_listing===true &&
      String(req.body?.expected_catalog_product_id||'')!==String(payload.catalog_product_id)){
     return res.status(409).json({ok:false,message:'Confirme novamente o produto de catálogo na prévia antes de publicar.'});
   }
   // validateCloneCandidate já validou o payload exato antes da escrita.
   // A operação é explícita, limitada a um anúncio por requisição e só após confirmação.
   const created=await ml(targetToken,'/items','POST',payload);
   const newId=String(created.id||'');
   let descriptionStatus='não disponível';
   if(/^MLB\d+$/.test(newId)&&payload.catalog_listing!==true){
    try {
     const description=await ml(sourceToken,'/items/'+encodeURIComponent(id)+'/description');
     const text=String(description.plain_text||description.text||'');
     if(text) {await ml(targetToken,'/items/'+encodeURIComponent(newId)+'/description','POST',{plain_text:text});descriptionStatus='copiada';}
    }catch{descriptionStatus='falhou: confira manualmente';}
   }
   if(payload.catalog_listing===true)descriptionStatus='gerenciada pelo catálogo';
   res.json({ok:true,created_id:newId,description_status:descriptionStatus,
    message:'Anúncio criado. Confira os atributos e as condições de publicação no Mercado Livre.'});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 app.post('/api/portal/bulk-tools/dimensions/preview',authPortalOrAgent,gate('bulk-dimensions'),async(req,res)=>{
  try{
   const category=String(req.body?.category_id||'').toUpperCase().trim();
   if(!validCategory(category))return res.status(400).json({ok:false,message:'Categoria MLB inválida.'});
   if(!validDims(req.body?.dimensions))return res.status(400).json({ok:false,message:'Informe altura, largura, comprimento em cm e peso em g antes da prévia.'});
   const account=await selectedAccount(req,req.body?.account_id),token=await ensureMlToken(account);
   const limit=Math.max(1,Math.min(100,Number(req.body?.limit)||50));
   let ids=[];
   for(let offset=0;offset<limit;offset+=50){
    const url='/users/'+encodeURIComponent(account.ml_user_id)+'/items/search?category='+encodeURIComponent(category)+'&limit='+Math.min(50,limit-offset)+'&offset='+offset;
    const batch=await ml(token,url);
    ids.push(...(batch.results||[]));
    if((batch.results||[]).length<Math.min(50,limit-offset))break;
   }
   ids=[...new Set(ids)].slice(0,limit);
   const items=[],skipped=[];
   for(const id of ids){
    try {
     const item=await shippingFreeFetchItem(id,token);
     if(String(item.seller_id)!==String(account.ml_user_id)||String(item.category_id)!==category)continue;
     if(!['active','paused'].includes(item.status)){skipped.push({id,reason:'Status não suportado'});continue;}
     if(item.shipping?.logistic_type==='fulfillment'){skipped.push({id,reason:'Full gerenciado pelo ML'});continue;}
     if(item.shipping?.mode==='me1'){skipped.push({id,reason:'Envios 1 exige fluxo próprio de dimensões'});continue;}
     items.push({id:item.id,title:item.title,category_id:item.category_id,status:item.status,
      mode:item.shipping?.mode||'',dimensions:item.shipping?.dimensions||null});
    }catch(e){skipped.push({id,reason:e.message.slice(0,130)})}
   }
   res.json({ok:true,category_id:category,account_name:account.nickname||account.company_name,items,skipped,limitReached:ids.length===limit});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 app.post('/api/portal/bulk-tools/dimensions/apply',authPortalOrAgent,gate('bulk-dimensions'),async(req,res)=>{
  try{
   if(req.body?.confirm!==true)return res.status(400).json({ok:false,message:'Confirmação obrigatória.'});
   const category=String(req.body?.category_id||'').toUpperCase().trim();
   const ids=Array.isArray(req.body?.item_ids)?[...new Set(req.body.item_ids.map(v=>String(v).toUpperCase().trim()))]:[];
   const dimensions=validDims(req.body?.dimensions);
   if(!validCategory(category)||!ids.length||ids.length>50||ids.some(id=>!validItem(id))||!dimensions)
    return res.status(400).json({ok:false,message:'Categoria, dimensões ou seleção inválidas (máx. 50 anúncios).'});
   const account=await selectedAccount(req,req.body?.account_id),token=await ensureMlToken(account);
   const success=[],failed=[],pending=[];
   for(const id of ids){
    try {
     const item=await shippingFreeFetchItem(id,token);
     if(String(item.seller_id)!==String(account.ml_user_id)||item.category_id!==category)throw new Error('Anúncio não pertence à conta/categoria.');
     if(!['active','paused'].includes(item.status))throw new Error('Status não permite edição.');
     const body=buildDimensionUpdate(item,dimensions);
     await ml(token,'/items/'+encodeURIComponent(id),'PUT',body);
     try {
      const current=await shippingFreeFetchItem(id,token);
      const values=new Map((current.attributes||[]).map(a=>[String(a.id),String(a.value_name||'')]));
      const matches=body.attributes.every(a=>values.get(a.id)===a.value_name);
      if(matches)success.push({id});
      else pending.push({id,reason:'A API aceitou a alteração, mas ainda não confirmou os atributos no anúncio.'});
     } catch {pending.push({id,reason:'A API aceitou a alteração; leitura de confirmação indisponível.'});}
    }catch(e){failed.push({id,error:e.message})}
   }
   res.json({ok:true,success,pending,failed,message:'Revise as dimensões no Mercado Livre: algumas modalidades podem rejeitar ou substituir medidas.'});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 }
};
