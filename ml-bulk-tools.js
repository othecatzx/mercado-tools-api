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
function sourcePackageDimensions(item){
 const values={};
 const parts={SELLER_PACKAGE_HEIGHT:'height',SELLER_PACKAGE_WIDTH:'width',SELLER_PACKAGE_LENGTH:'length',SELLER_PACKAGE_WEIGHT:'weight'};
 for(const a of item?.attributes||[]){
  const field=parts[String(a?.id||'').toUpperCase()];
  if(!field)continue;
  const raw=a?.value_struct?.number??a?.value_name??a?.values?.[0]?.name;
  // Não inferir unidades desconhecidas. Os atributos seller_package são cm/g.
  const match=String(raw??'').trim().match(/^(\d+(?:[.,]\d+)?)(?:\s*(?:cm|g))?$/i);
  if(match)values[field]=Number(match[1].replace(',','.'));
 }
 const direct=validDims(values);
 if(direct)return direct;
 // Algumas publicações antigas guardam o pacote em shipping.dimensions.
 // Formato documentado: altura x largura x comprimento, peso (cm/g).
 const shipping=item?.shipping?.dimensions;
 if(typeof shipping==='string'){
  const match=shipping.trim().match(/^(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*[,;]\s*(\d+)$/i);
  if(match)return validDims({height:Number(match[1]),width:Number(match[2]),length:Number(match[3]),weight:Number(match[4])});
 }
 if(shipping&&typeof shipping==='object'){
  const parsed=validDims({
   height:shipping.height,width:shipping.width,length:shipping.length,
   weight:shipping.weight
  });
  if(parsed)return parsed;
 }
 return null;
}
function clonePackageAttributes(dims){
 const validated=validDims(dims);
 if(!validated)return null;
 // A API exige unidade explícita (ex.: 10 cm, 3000 g). Usar as
 // dimensões reais do anúncio original, nunca estimativas de categoria.
 return Object.entries({SELLER_PACKAGE_HEIGHT:validated.height,SELLER_PACKAGE_WIDTH:validated.width,SELLER_PACKAGE_LENGTH:validated.length,SELLER_PACKAGE_WEIGHT:validated.weight})
  .map(([id,value_name])=>({id,value_name:String(value_name)+(id.endsWith('WEIGHT')?' g':' cm')}));
}
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
 const dims=sourcePackageDimensions(item);
 const attrs=(item.attributes||[]).filter(a=>a&&typeof a.id==='string'&&!packageKeys.has(a.id))
  .map(a=>{
   const valueId=a.value_id??a.values?.[0]?.id;
   const valueName=a.value_name||a.values?.[0]?.name||a.value_struct?.number?.toString();
   return {id:a.id,...(valueId!=null&&String(valueId)!=='-1'?{value_id:String(valueId)}:{}),
     ...(typeof valueName==='string'&&valueName.trim()?{value_name:valueName.trim()}:{})};
  })
  .filter(a=>a.value_id||a.value_name);
 const payload={
  title:name,category_id:item.category_id,price:Number(item.price),currency_id:item.currency_id||'BRL',
  available_quantity:qty,buying_mode:item.buying_mode||'buy_it_now',
  listing_type_id:item.listing_type_id||'gold_special',
  condition:item.condition||'new',pictures:sourcePictures.map(source=>({source})),
  attributes:[...attrs,...(dims?clonePackageAttributes(dims):[])]
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
 // item.warranty é legado e rejeitado nas publicações atuais.
 // Termos de garantia compatíveis são enviados exclusivamente em sale_terms.
 const warrantyTerms=(item.sale_terms||[]).filter(t=>['WARRANTY_TYPE','WARRANTY_TIME'].includes(t?.id)&&((t.value_id!=null)||(typeof t.value_name==='string'&&t.value_name.trim())))
  .map(t=>({id:t.id,...(t.value_id!=null?{value_id:String(t.value_id)}:{value_name:String(t.value_name)})}));
 if(warrantyTerms.length)payload.sale_terms=warrantyTerms;
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
   err.validationCauses=Array.isArray(data?.cause)?data.cause.map(c=>({
     code:String(c?.code||'').slice(0,120),
     message:String(c?.message||'').slice(0,400)
   })): [];
   throw err;
  }
  return data;
 }
 async function validateBeforePublish(token,payload){
  try{
   await ml(token,'/items/validate','POST',payload);
  }catch(e){
   const err=new Error('Validação de publicação: '+String(e.message).slice(0,1400));
   err.validationCauses=e.validationCauses||[];
   throw err;
  }
 }
 // Um anúncio existente traz atributos inferidos e de uso interno que não
 // devem ser enviados a /items. Corrigir somente IDs que a API identificou
 // explicitamente como "ignored/not modifiable", sem retirar os demais.
 function ignoredAttributeIds(error){
  const found=new Set();
  for(const cause of error?.validationCauses||[]){
   if(cause.code!=='item.attributes.ignored')continue;
   const match=cause.message.match(/Attribute\s*\[([A-Z0-9_]+)\]\s*ignored\s+because\s+it\s+is\s+not\s+modifiable/i);
   if(match)found.add(match[1].toUpperCase());
  }
  return found;
 }
 function invalidValueNameIds(error){
  const ids=new Set();
  for(const cause of error?.validationCauses||[]){
   if(cause.code!=='item.attribute.invalid')continue;
   const match=cause.message.match(/Value name of attribute ([A-Z0-9_]+) was not provided/i);
   if(match)ids.add(match[1]);
  }
  return ids;
 }
 async function resolveAttributeNames(token,item,candidate,invalidIds){
  // Somente consultar a ficha da categoria quando o ML rejeitar os IDs
  // sem value_name; nunca fabricar nomes nem remover atributos obrigatórios.
  let definitions=[];
  try{
   const response=await ml(token,'/categories/'+encodeURIComponent(item.category_id)+'/attributes');
   definitions=Array.isArray(response)?response:response?.attributes||[];
  }catch{/* Reportaremos os IDs que não puderam ser resolvidos. */}
  const schemas=new Map(definitions.map(a=>[a.id,a]));
  const unresolved=[];
  const attributes=candidate.attributes.map(a=>{
   if(!invalidIds.has(a.id))return a;
   const fromSource=(item.attributes||[]).find(x=>x.id===a.id);
   let name=a.value_name||fromSource?.value_name||fromSource?.values?.[0]?.name;
   if(!name&&a.value_id){
    const option=(schemas.get(a.id)?.values||[]).find(v=>String(v.id)===String(a.value_id));
    name=option?.name;
   }
   if(typeof name!=='string'||!name.trim()){
    unresolved.push(a.id);
    return a;
   }
   return {...a,value_name:name.trim()};
  });
  if(unresolved.length){
   throw new Error('O Mercado Livre exige os nomes dos valores destes atributos, mas a origem e a categoria não os forneceram: '+unresolved.join(', ')+'. Não é seguro publicar uma cópia sem esses dados.');
  }
  return {...candidate,attributes};
 }
 async function selectTargetShipping(token,targetId,candidate){
  const preferences=await ml(token,'/users/'+encodeURIComponent(targetId)+'/shipping_preferences');
  const modes=Array.isArray(preferences?.modes)?preferences.modes:[];
  if(!modes.includes('me2'))throw new Error('A conta de destino não possui Mercado Envios 2 habilitado. Confira as preferências de envio antes de clonar.');
  return {...candidate,shipping:{...(candidate.shipping||{}),mode:'me2'}};
 }
 // Algumas contas usam User Products com family_name obrigatório.
 // Adaptar de maneira conservadora a cada validação, sem pular outras falhas.
 async function validateCloneCandidate(token,item,initial,targetId){
  let candidate={...initial,attributes:[...(initial.attributes||[])]};
  const ignored=new Set();
  for(let attempt=0;attempt<5;attempt++){
   try{
    await validateBeforePublish(token,candidate);
    if(ignored.size)Object.defineProperty(candidate,'_removedCloneAttributes',{value:[...ignored],enumerable:false});
    return candidate;
   }catch(error){
    let changed=false;
    const rejected=ignoredAttributeIds(error);
    if(rejected.size){
     const remaining=candidate.attributes.filter(a=>!rejected.has(a.id));
     if(remaining.length<candidate.attributes.length){
      for(const attr of candidate.attributes)if(rejected.has(attr.id))ignored.add(attr.id);
      candidate={...candidate,attributes:remaining};
      changed=true;
     }
    }
    const ids=invalidValueNameIds(error);
    if(ids.size){
     const repaired=await resolveAttributeNames(token,item,candidate,ids);
     if(repaired.attributes.some((a,i)=>a.value_name!==candidate.attributes[i]?.value_name)){
      candidate=repaired;
      changed=true;
     }
    }
    const shippingCause=(error.validationCauses||[]).some(c=>c.code==='shipping.lost_me1_by_user');
    if(shippingCause&&candidate.shipping?.mode!=='me2'){
     candidate=await selectTargetShipping(token,targetId,candidate);
     changed=true;
    }
    const details=String(error?.message||'');
    if(!candidate.family_name&&/body\.required_fields/i.test(details)&&/\[family_name\]/i.test(details)){
     const family=String(item.family_name||candidate.title||item.title||'').trim();
     if(!family||family.length>60)throw new Error('Nome da família obrigatório e inválido; revise o produto de origem.');
     candidate={...candidate,family_name:family};
     delete candidate.title;
     changed=true;
    }
    if(!changed){
     if(/item\.attribute\.missing\.seller\.package\.dimensions/i.test(details)){
      throw new Error('O Mercado Livre exige dimensões da embalagem, mas não foi possível obtê-las completas do anúncio de origem. Verifique os dados de embalagem do anúncio original no Mercado Livre antes de clonar. Detalhes: '+details.slice(0,350));
     }
     throw error;
    }
   }
  }
  throw new Error('A validação retornou alterações sucessivas não resolvidas; revise os atributos obrigatórios antes de publicar.');
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
   const candidate=await validateCloneCandidate(targetToken,item,prepareClone(item,stock,title),target.ml_user_id);
   res.json({ok:true,preview:{item_id:id,source_name:source.nickname||source.company_name,
    target_name:target.nickname||target.company_name,title:candidate.title||item.title,category_id:candidate.category_id,
    price:candidate.price,stock:candidate.available_quantity,pictures:candidate.pictures.length,
    listing_type_id:candidate.listing_type_id,
    clone_type:candidate.catalog_listing===true?'catalog':candidate.family_name?'user_product':'standard',
    family_name:candidate.family_name||null,
    package_dimensions:sourcePackageDimensions({attributes:candidate.attributes})||null,
    package_dimensions_source:'origem',
    shipping_mode:candidate.shipping?.mode||'automático',
    removed_attributes:candidate._removedCloneAttributes||[],
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
   const payload=await validateCloneCandidate(targetToken,item,prepareClone(item,req.body?.stock,req.body?.title),target.ml_user_id);
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
