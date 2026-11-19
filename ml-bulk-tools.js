'use strict';
const API='https://api.mercadolibre.com';
const normalizeItemId = value => {const raw=String(value||'').trim().toUpperCase();return /^\d{6,15}$/.test(raw)?'MLB'+raw:raw};
const validItem = value => /^MLB\d{6,15}$/.test(normalizeItemId(value));
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
function samePackageDimensions(actual,desired){
 const a=validDims(actual),b=validDims(desired);
 if(!a||!b)return false;
 const sorted=d=>[d.height,d.width,d.length].sort((x,y)=>x-y);
 return a.weight===b.weight&&sorted(a).every((v,i)=>v===sorted(b)[i]);
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
function parseClonePictures(pictures){
 if(!Array.isArray(pictures)||pictures.length<1||pictures.length>12)throw new Error('Selecione entre 1 e 12 fotos para clonar.');
 return pictures.map(photo=>{
  if(photo&&typeof photo==='object'&&typeof photo.source==='string'&&/^https:\/\//i.test(photo.source)&&photo.source.length<2000)
   return {source:photo.source};
  if(photo&&typeof photo==='object'&&typeof photo.id==='string'&&/^[0-9]{4,20}-[A-Z0-9_-]+$/i.test(photo.id))
   return {id:photo.id};
  throw new Error('Foto inválida. Selecione uma imagem original ou envie uma imagem nova.');
 });
}
function cloneVariationAttributes(attributes){
 return (Array.isArray(attributes)?attributes:[]).filter(a=>a&&typeof a.id==='string')
  .map(a=>{
   const valueId=a.value_id??a.values?.[0]?.id;
   const valueName=a.value_name||a.values?.[0]?.name;
   return {id:a.id,...(valueId!=null&&String(valueId)!=='-1'?{value_id:String(valueId)}:{}),
    ...(typeof valueName==='string'&&valueName.trim()?{value_name:valueName.trim()}:{})};
  }).filter(a=>a.value_id||a.value_name);
}
function cloneVariations(item,initialStock,priceOverride,pictures){
 const source=Array.isArray(item.variations)?item.variations:[];
 if(!source.length)return [];
 if(source.length>100)throw new Error('Anúncio com mais de 100 variações: divida a operação ou revise no Mercado Livre.');
 const originalPictures=new Map((item.pictures||[]).filter(p=>p&&p.id)
  .map(p=>[String(p.id),p.secure_url||p.url]));
 // Referências de imagens na variação devem corresponder às fotos ENVIADAS
 // no mesmo anúncio, jamais copiar o ID exclusivo do anúncio de origem.
 const available=new Map(pictures.filter(p=>p.source).map(p=>[p.source,p.source]));
 for(const p of pictures)if(p.id)available.set(String(p.id),String(p.id));
 const seen=new Set();
 const mapped=source.map((v,index)=>{
  const combinations=cloneVariationAttributes(v.attribute_combinations);
  if(!combinations.length)throw new Error('Variação '+(index+1)+' não possui atributos que a diferenciem.');
  const key=combinations.map(x=>x.id+'='+(x.value_id||x.value_name)).sort().join('|');
  if(seen.has(key))throw new Error('Há variações com combinações duplicadas. Revise o anúncio de origem.');
  seen.add(key);
  const ids=Array.isArray(v.picture_ids)?v.picture_ids:[];
  const pictureIds=ids.map(id=>{
   const url=originalPictures.get(String(id))||String(id);
   return available.get(url)||available.get(String(id))||null;
  });
  if(!pictureIds.length||pictureIds.some(x=>!x))
   throw new Error('A variação '+(index+1)+' possui fotos ausentes ou removidas. Mantenha as fotos originais vinculadas a cada variação.');
  const variationPrice=priceOverride!==undefined?Number(priceOverride):Number(v.price??item.price);
  if(!Number.isFinite(variationPrice)||variationPrice<=0)
   throw new Error('Preço inválido na variação '+(index+1)+'.');
  const entry={
   attribute_combinations:combinations,
   available_quantity:initialStock,price:variationPrice,
   picture_ids:[...new Set(pictureIds)]
  };
  const more=cloneVariationAttributes(v.attributes);
  if(more.length)entry.attributes=more;
  if(typeof v.seller_custom_field==='string'&&v.seller_custom_field.trim())
   entry.seller_custom_field=v.seller_custom_field.trim().slice(0,255);
  return entry;
 });
 const names=mapped.map(v=>v.attribute_combinations.map(x=>x.id).sort().join('|'));
 if(new Set(names).size!==1)
  throw new Error('As variações da origem não possuem os mesmos tipos de atributos (cor, tamanho etc.). Revise antes de clonar.');
 return mapped;
}
function singleTechnicalVariation(item){
 const v=Array.isArray(item.variations)&&item.variations.length===1?item.variations[0]:null;
 return v&&cloneVariationAttributes(v.attribute_combinations).length===0?v:null;
}
function mergedItemForTechnicalVariation(item){
 const v=singleTechnicalVariation(item);
 if(!v)return item;
 // Para uma única entrada sem atributo diferenciador, não criar
 // uma "variação" artificial. Preservar os atributos próprios do produto.
 const known=new Set((item.attributes||[]).map(a=>a.id));
 const attributes=[...(item.attributes||[])];
 for(const a of v.attributes||[])if(a?.id&&!known.has(a.id)){attributes.push(a);known.add(a.id)}
 return {...item,attributes,
  seller_custom_field:item.seller_custom_field||v.seller_custom_field,
  price:Number(v.price)>0?Number(v.price):item.price,
  variations:[]};
}
function prepareClone(item,stock,title,overrides){
 item=mergedItemForTechnicalVariation(item);
 const qty=Number(stock);
 if(!Number.isSafeInteger(qty)||qty<1||qty>99999)throw new Error('Estoque inicial deve estar entre 1 e 99999.');
 // IDs de família / User Products identificam o agrupamento do vendedor e não
 // devem ser enviados à conta de destino. Sozinhos, não indicam catálogo.
 // O catálogo verdadeiro exige catalog_product_id e catalog_listing=true.
 if(item.parent_item_id)throw new Error('Anúncio vinculado a anúncio-pai: fluxo de clonagem específico necessário.');
 if(item.catalog_listing===true && !/^MLB\d+$/.test(String(item.catalog_product_id||'')))throw new Error('Anúncio de catálogo sem catalog_product_id válido; revise o produto de catálogo antes de publicar.');
 // Variações são clonadas como novas combinações. Nunca transferir IDs de variações da origem.
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
 const newPrice=overrides&&Object.prototype.hasOwnProperty.call(overrides,'price')?Number(overrides.price):Number(item.price);
 if(!Number.isFinite(newPrice)||newPrice<=0||newPrice>100000000)throw new Error('Preço inválido. Informe valor positivo.');
 const pictures=overrides&&Object.prototype.hasOwnProperty.call(overrides,'pictures')?parseClonePictures(overrides.pictures):sourcePictures.map(source=>({source}));
 if(!pictures.length&&item.catalog_listing!==true)throw new Error('O anúncio precisa ter pelo menos uma foto válida.');
 const payload={
  title:name,category_id:item.category_id,price:newPrice,currency_id:item.currency_id||'BRL',
  available_quantity:qty,buying_mode:item.buying_mode||'buy_it_now',
  listing_type_id:item.listing_type_id||'gold_special',
  condition:item.condition||'new',pictures,
  attributes:[...attrs,...(dims?clonePackageAttributes(dims):[])]
 };
 if(item.variations?.length)payload.variations=cloneVariations(item,qty,overrides?.price,pictures);
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
module.exports={validItem,normalizeItemId,validCategory,validDims,packageAttributes,buildDimensionUpdate,prepareClone,
 register(app,{authPortalOrAgent,scopedMenuAllowed,getShippingAccounts,ensureMlToken,shippingFreeFetchItem,supabase}){
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
     type:String(c?.type||'').toLowerCase(),
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
 const isExplicitWarningOnly=error=>{
  const causes=error?.validationCauses;
  return Array.isArray(causes)&&causes.length>0&&causes.every(c=>c.type==='warning');
 };
 const nonBlockingMessages=error=>(error?.validationCauses||[])
  .filter(c=>c.type==='warning')
  .map(c=>String(c.code||'')+(c.code==='item.shipping.mandatory_free_shipping'?' (frete grátis obrigatório)':''))
  .slice(0,10);
 // Algumas contas usam User Products com family_name obrigatório.
 // Adaptar de maneira conservadora a cada validação, sem pular outras falhas.
 async function validateCloneCandidate(token,item,initial,targetId,overrideTitle){
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
    const causes=error.validationCauses||[];
    const shippingCause=causes.some(c=>c.code==='shipping.lost_me1_by_user');
    const mandatoryFreeShipping=causes.some(c=>c.code==='item.shipping.mandatory_free_shipping');
    if(shippingCause&&candidate.shipping?.mode!=='me2'){
     candidate=await selectTargetShipping(token,targetId,candidate);
     changed=true;
    }
    if(mandatoryFreeShipping&&candidate.shipping?.mode!=='me2'){
     candidate=await selectTargetShipping(token,targetId,candidate);
     changed=true;
    }
    if(mandatoryFreeShipping&&candidate.shipping?.mode==='me2'&&candidate.shipping.free_shipping!==true){
     candidate={...candidate,shipping:{...candidate.shipping,free_shipping:true}};
     changed=true;
    }
    const details=String(error?.message||'');
    if(!candidate.family_name&&/body\.required_fields/i.test(details)&&/\[family_name\]/i.test(details)){
     const family=String(overrideTitle||item.family_name||candidate.title||item.title||'').trim();
     if(!family||family.length>60)throw new Error('Nome da família obrigatório e inválido; revise o produto de origem.');
     candidate={...candidate,family_name:family};
     delete candidate.title;
     changed=true;
    }
    if(!changed){
     // Somente 'type: warning' explícito é não bloqueante. Nunca ignorar
     // causas 'error', sem type ou respostas de transporte/autorização.
     if(isExplicitWarningOnly(error)){
      if(ignored.size)Object.defineProperty(candidate,'_removedCloneAttributes',{value:[...ignored],enumerable:false});
      Object.defineProperty(candidate,'_validationWarnings',{value:nonBlockingMessages(error),enumerable:false});
      return candidate;
     }
     if(/item\.attribute\.missing\.seller\.package\.dimensions/i.test(details)){
      throw new Error('O Mercado Livre exige dimensões da embalagem, mas não foi possível obtê-las completas do anúncio de origem. Verifique os dados de embalagem do anúncio original no Mercado Livre antes de clonar. Detalhes: '+details.slice(0,350));
     }
     throw error;
    }
   }
  }
  throw new Error('A validação retornou alterações sucessivas não resolvidas; revise os atributos obrigatórios antes de publicar.');
 }
 async function hydrateSourceVariations(token,item){
  const variations=Array.isArray(item.variations)?item.variations:[];
  if(!variations.length||variations.every(v=>cloneVariationAttributes(v.attribute_combinations).length))return item;
  if(variations.length===1)return item; // Uma variação sem combinação pode ser apenas técnica.
  const fresh=[];
  // Buscar informações próprias de cada variação usando acesso à origem.
  // Nunca usar id da variação do vendedor original na publicação nova.
  for(const v of variations){
   if(cloneVariationAttributes(v.attribute_combinations).length){fresh.push(v);continue}
   // UP ja identifica a variante: /items/{id}/variations/{id} e um endpoint legado.
   // Evitar depender dele quando o Mercado Livre ja retornou o User Product.
   if(/^ML[A-Z]U\d+$/i.test(String(v.user_product_id||''))){fresh.push(v);continue}
   if(!v.id)throw new Error('Há múltiplas variações sem identificadores; a origem não disponibilizou as opções.');
   try{
    const full=await ml(token,'/items/'+encodeURIComponent(item.id||'')+'/variations/'+encodeURIComponent(v.id));
    fresh.push({...v,...full});
   }catch(e){
    throw new Error('Não foi possível consultar os detalhes da variação '+String(v.id)+': '+e.message);
   }
  }
  // Quando a origem é uma família UP, a publicação nova deve ser
  // composta por itens independentes, mesmo que o modelo legado contenha
  // atributos adicionais recuperáveis pela API.
  if(fresh.length>1&&fresh.every(v=>/^ML[A-Z]U\d+$/i.test(String(v.user_product_id||''))))
   return {...item,variations:fresh,_cloneUserProductFamily:true};
  // Apenas atributos marcados como allow_variations pelo Mercado Livre
  // podem diferenciar combinações; jamais inferir de SKU ou posição.
  const needsMapping=fresh.some(v=>!cloneVariationAttributes(v.attribute_combinations).length);
  if(needsMapping){
   let definitions;
   try{definitions=await ml(token,'/categories/'+encodeURIComponent(item.category_id)+'/attributes')}
   catch(e){throw new Error('A categoria não forneceu os atributos de variação: '+e.message)}
   const allowed=new Set((Array.isArray(definitions)?definitions:definitions?.attributes||[])
    .filter(a=>a?.tags?.allow_variations===true).map(a=>a.id));
   for(let index=0;index<fresh.length;index++){
    const v=fresh[index];
    if(cloneVariationAttributes(v.attribute_combinations).length)continue;
    const found=cloneVariationAttributes(v.attributes).filter(a=>allowed.has(a.id));
    if(found.length)fresh[index]={...v,attribute_combinations:found,
     attributes:(v.attributes||[]).filter(a=>!allowed.has(a.id))};
   }
  }
  if(fresh.some(v=>!cloneVariationAttributes(v.attribute_combinations).length)){
   const hasUserProducts=fresh.every(v=>/^ML[A-Z]U\d+$/i.test(String(v.user_product_id||'')));
   if(!hasUserProducts)
    throw new Error('Este anúncio possui várias opções sem atributos diferenciadores. Não foram fornecidos todos os IDs de User Products para consultar a família com segurança.');
   return {...item,variations:fresh,_cloneUserProductFamily:true};
  }
  return {...item,variations:fresh};
 }
 // Na modalidade User Products cada variante é um item novo, e não uma
 // entrada de variations. Não enviar IDs de UP/família do vendedor original.
 async function prepareUserProductFamily(sourceToken,targetToken,targetId,item,stock,overrides){
  const parts=item.variations||[];
  if(!item._cloneUserProductFamily||parts.length<2||parts.length>30)
   throw new Error('Família de User Products inválida ou com mais de 30 opções.');
  const familyName=String(overrides?.title||item.family_name||item.title||'').trim();
  if(!familyName||familyName.length>60)throw new Error('Nome de família obrigatório (máximo 60 caracteres).');
  const copies=[],signatures=new Set();
  for(let index=0;index<parts.length;index++){
   const variation=parts[index];
   const upId=String(variation.user_product_id||'');
   if(!/^ML[A-Z]U\d+$/i.test(upId))throw new Error('A opção '+(index+1)+' não possui ID User Products válido.');
   let up;
   try{up=await ml(sourceToken,'/user-products/'+encodeURIComponent(upId))}
   catch(e){throw new Error('Falha ao consultar User Product da opção '+(index+1)+': '+e.message)}
   if(!Array.isArray(up.attributes)||!up.attributes.length)
    throw new Error('A opção '+(index+1)+' não possui atributos disponíveis no User Product.');
   const commonAttrs=new Map((item.attributes||[]).filter(a=>a?.id).map(a=>[a.id,a]));
   const variantAttrs=[...(up.attributes||[]),...(variation.attributes||[])];
   for(const attribute of variantAttrs)if(attribute?.id)commonAttrs.set(attribute.id,attribute);
   // IDs de User Products distintos podem compartilhar caracteristicas tecnicas.
   // O diferencial tambem pode ser uma condicao de venda (preco, modalidade etc.).
   // Nao bloquear pela igualdade de atributos: /items/validate e a autoridade.
   // Impedir apenas a clonagem acidental do mesmo UP duas vezes no lote.
   if(signatures.has(upId))throw new Error('User Product repetido na origem: '+upId+'. Revise as opcoes antes de publicar.');
   signatures.add(upId);
   const photos=(up.pictures||[]).map(x=>x?.secure_url||x?.url)
    .filter(x=>typeof x==='string'&&/^https:\/\//i.test(x));
   if(!photos.length){
    const indices=new Set((variation.picture_ids||[]).map(String));
    for(const pic of item.pictures||[])if(indices.has(String(pic.id))){
     const url=pic.secure_url||pic.url;
     if(/^https:\/\//i.test(String(url)))photos.push(url);
    }
   }
   if(!photos.length)throw new Error('Não foi possível consultar as fotos da opção '+(index+1)+'.');
   const sourcePrice=Number(variation.price)>0?Number(variation.price):Number(item.price);
   const variantItem={...item,variations:[],user_product_id:undefined,
    attributes:[...commonAttrs.values()],pictures:photos.slice(0,12).map(secure_url=>({secure_url})),
    price:sourcePrice,catalog_product_id:up.catalog_product_id||null,
    seller_custom_field:variation.seller_custom_field||item.seller_custom_field};
   const changes={...overrides};
   // Fotos informadas no editor são globais ao anúncio de origem, não
   // substituem fotos específicas de cada variante automaticamente.
   if(Object.prototype.hasOwnProperty.call(changes,'pictures'))
    throw new Error('Nesta família as fotos pertencem a cada opção. Não é possível substituir todas por uma lista única no editor.');
   const payload=prepareClone(variantItem,stock,familyName,changes);
   payload.family_name=familyName;delete payload.title;
   const validated=await validateCloneCandidate(targetToken,variantItem,payload,targetId,familyName)
    .catch(e=>{throw new Error('Opção '+(index+1)+' ('+upId+'): '+e.message)});
   copies.push({source_up_id:upId,source_sku:variation.seller_custom_field||'',
    label:up.name||variation.seller_custom_field||'Opção '+(index+1),payload:validated});
  }
  return {family_name:familyName,copies};
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
 // Upload pontual para conta de destino. Nunca salva base64 no banco.
 app.post('/api/portal/bulk-tools/clone/photo',authPortalOrAgent,gate('clone-listings'),async(req,res)=>{
  try{
   const account=await selectedAccount(req,req.body?.target_id);
   const mime=String(req.body?.mime||'');
   const base64=String(req.body?.data||'');
   if(!['image/jpeg','image/png'].includes(mime)||base64.length<100||base64.length>5500000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    return res.status(400).json({ok:false,message:'Envie uma imagem JPG ou PNG válida de até 4 MB.'});
   const bytes=Buffer.from(base64,'base64');
   if(bytes.length>4*1024*1024||bytes.length<100||
      !(mime==='image/jpeg'&&bytes[0]===0xff&&bytes[1]===0xd8||
        mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))))
    return res.status(400).json({ok:false,message:'Formato ou tamanho da imagem inválido.'});
   const token=await ensureMlToken(account);
   const form=new FormData();
   form.append('file',new Blob([bytes],{type:mime}),mime==='image/jpeg'?'image.jpg':'image.png');
   const response=await fetch(API+'/pictures/items/upload',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});
   const data=await response.json().catch(()=>({}));
   if(!response.ok||!data.id)throw new Error('Mercado Livre não aceitou a imagem: '+String(data.message||data.error||response.status).slice(0,180));
   res.json({ok:true,id:String(data.id),preview_url:typeof data.secure_url==='string'?data.secure_url:null});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 // Dados originais para o editor individual. A descrição nunca é
 // enviada à conta destino até a confirmação explícita da clonagem.
 app.get('/api/portal/bulk-tools/clone/source',authPortalOrAgent,gate('clone-listings'),async(req,res)=>{
  try{
   const id=normalizeItemId(req.query?.item_id);
   if(!validItem(id))return res.status(400).json({ok:false,message:'Informe um MLB válido.'});
   const account=await selectedAccount(req,req.query?.source_id);
   const token=await ensureMlToken(account);
   const item=await hydrateSourceVariations(token,await shippingFreeFetchItem(id,token));
   if(String(item.seller_id)!==String(account.ml_user_id))return res.status(403).json({ok:false,message:'O anúncio não pertence à conta selecionada.'});
   let description_text='',description_available=false,description_error=null;
   try{
    const description=await ml(token,'/items/'+encodeURIComponent(id)+'/description');
    description_text=String(description.plain_text||description.text||'').slice(0,50000);
    description_available=true;
   }catch(e){
    description_error='Não foi possível consultar a descrição original. Você pode informar uma nova descrição, mas confira a origem antes de salvar.';
   }
   return res.json({ok:true,item_id:id,title:String(item.title||'').slice(0,60),
    clone_type:item._cloneUserProductFamily?'user_product_family':item.family_name?'user_product':'standard',
    variations_count:(item.variations||[]).length,
    family_name:String(item.family_name||'').slice(0,60),
    pictures:(item.pictures||[]).map(x=>({source:x.secure_url||x.url||''})).filter(x=>/^https:\/\//i.test(x.source)).slice(0,12),
    price:Number(item.price)||0,
    description_text,description_available,description_error});
  }catch(e){return res.status(400).json({ok:false,message:e.message})}
 });
 app.post('/api/portal/bulk-tools/clone/preview',authPortalOrAgent,gate('clone-listings'),async(req,res)=>{
  try{
   if(Object.prototype.hasOwnProperty.call(req.body||{},'description_text')&&
      (typeof req.body.description_text!=='string'||req.body.description_text.length>50000))
    return res.status(400).json({ok:false,message:'Descrição inválida: texto simples com até 50.000 caracteres.'});
   const id=normalizeItemId(req.body?.item_id);
   if(!validItem(id))return res.status(400).json({ok:false,message:'Informe um MLB válido.'});
   if(String(req.body?.source_id)===String(req.body?.target_id))return res.status(400).json({ok:false,message:'Origem e destino devem ser diferentes.'});
   const source=await selectedAccount(req,req.body?.source_id),target=await selectedAccount(req,req.body?.target_id);
   const token=await ensureMlToken(source);
   const item=await hydrateSourceVariations(token,await shippingFreeFetchItem(id,token));
   if(String(item.seller_id)!==String(source.ml_user_id))return res.status(403).json({ok:false,message:'Anúncio não pertence à conta de origem.'});
   const targetToken=await ensureMlToken(target);
   const stock=Number(req.body?.stock),title=String(req.body?.title||item.title||'');
   if(item._cloneUserProductFamily){
    const family=await prepareUserProductFamily(token,targetToken,target.ml_user_id,item,stock,req.body);
    return res.json({ok:true,preview:{
     item_id:id,source_name:source.nickname||source.company_name,
     target_name:target.nickname||target.company_name,
     title:family.family_name,family_name:family.family_name,
     clone_type:'user_product_family',category_id:item.category_id,
     price:family.copies[0].payload.price,stock,
     pictures:family.copies.reduce((sum,v)=>sum+v.payload.pictures.length,0),
     variations_count:family.copies.length,publication_count:family.copies.length,
     variations_summary:family.copies.map(v=>({
      attributes:v.label,sku:v.source_sku,stock:v.payload.available_quantity,
      price:v.payload.price,photos:v.payload.pictures.length
     })),
     catalog_product_id:null,
     free_shipping:family.copies.some(v=>v.payload.shipping?.free_shipping),
     shipping_mode:family.copies.some(v=>v.payload.shipping?.mode==='me2')?'me2':'automático',
     warning:'FAMÍLIA USER PRODUCTS: serão criados '+family.copies.length+' MLBs novos, um por opção, usando o mesmo nome de família. Confira todos antes de confirmar. Se houver falha durante a criação, confira os IDs já criados antes de repetir.',
     description:'A descrição será copiada para cada novo MLB quando permitido.'
    }});
   }
   const candidate=await validateCloneCandidate(targetToken,item,prepareClone(item,stock,title,req.body),target.ml_user_id,req.body?.title);
   res.json({ok:true,preview:{item_id:id,source_name:source.nickname||source.company_name,
    target_name:target.nickname||target.company_name,title:candidate.title||item.title,category_id:candidate.category_id,
    price:candidate.price,stock:candidate.available_quantity,pictures:candidate.pictures.length,
    variations_count:candidate.variations?.length||0,
    variations_summary:(candidate.variations||[]).map(v=>({attributes:v.attribute_combinations.map(a=>a.value_name||a.value_id).join(' · '),sku:v.seller_custom_field||'',stock:v.available_quantity,price:v.price,photos:v.picture_ids.length})),
    listing_type_id:candidate.listing_type_id,
    clone_type:candidate.catalog_listing===true?'catalog':candidate.family_name?'user_product':'standard',
    family_name:candidate.family_name||null,
    package_dimensions:sourcePackageDimensions({attributes:candidate.attributes})||null,
    package_dimensions_source:'origem',
    shipping_mode:candidate.shipping?.mode||'automático',
    free_shipping:candidate.shipping?.free_shipping===true,
    validation_warnings:candidate._validationWarnings||[],
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
   const editedDescription=Object.prototype.hasOwnProperty.call(req.body||{},'description_text');
   if(editedDescription&&(typeof req.body.description_text!=='string'||req.body.description_text.length>50000))return res.status(400).json({ok:false,message:'Descrição inválida: texto simples com até 50.000 caracteres.'});
   const id=normalizeItemId(req.body?.item_id);
   if(!validItem(id)||String(req.body?.source_id)===String(req.body?.target_id))return res.status(400).json({ok:false,message:'Origem ou destino inválidos.'});
   const source=await selectedAccount(req,req.body?.source_id),target=await selectedAccount(req,req.body?.target_id);
   const sourceToken=await ensureMlToken(source),targetToken=await ensureMlToken(target);
   const item=await hydrateSourceVariations(sourceToken,await shippingFreeFetchItem(id,sourceToken));
   if(String(item.seller_id)!==String(source.ml_user_id))return res.status(403).json({ok:false,message:'Conta de origem não é proprietária do anúncio.'});
   if(item._cloneUserProductFamily){
    if(String(req.body?.expected_family_name||'')!==String(req.body?.title||item.family_name||item.title||'').trim())
     return res.status(409).json({ok:false,message:'Confirme novamente o nome da família e todas as opções na prévia antes de publicar.'});
    const family=await prepareUserProductFamily(sourceToken,targetToken,target.ml_user_id,item,req.body?.stock,req.body);
    if(Number(req.body?.expected_publication_count)!==family.copies.length)
     return res.status(409).json({ok:false,message:'A quantidade de opções mudou. Consulte novamente a prévia antes de publicar.'});
    // Todas as opções foram validadas ANTES da primeira publicação.
    // A API não fornece transação atômica; em falhas parciais, jamais repetir
    // automaticamente, e retornar os IDs criados para conferência manual.
    const createdIds=[],issues=[];
    let descriptionText='';
    if(editedDescription)descriptionText=req.body.description_text;
    else{
     try{
      const description=await ml(sourceToken,'/items/'+encodeURIComponent(id)+'/description');
      descriptionText=String(description.plain_text||description.text||'');
     }catch{issues.push('Não foi possível consultar a descrição original.')}
    }
    for(let index=0;index<family.copies.length;index++){
     const part=family.copies[index];
     let created;
     try{created=await ml(targetToken,'/items','POST',part.payload)}
     catch(e){
      issues.push('Opção '+(index+1)+' ('+part.label+'): '+e.message);
      break; // Nunca tentar os demais após uma falha potencialmente ambígua.
     }
     const newId=String(created?.id||'');
     if(!/^MLB\d+$/.test(newId)){
      issues.push('Opção '+(index+1)+': o Mercado Livre não retornou um ID confirmado. Verifique o destino.');
      break;
     }
     createdIds.push({id:newId,label:part.label,sku:part.source_sku});
     if(descriptionText){
      try{await ml(targetToken,'/items/'+encodeURIComponent(newId)+'/description','POST',{plain_text:descriptionText})}
      catch{issues.push('Descrição do '+newId+' não foi aplicada; o anúncio já foi criado.')}
     }
    }
    return res.json({ok:issues.length===0,partial:issues.length>0,
     created_ids:createdIds,created_id:createdIds.map(v=>v.id).join(', '),
     expected_count:family.copies.length,issues,description_status:issues.length?'verificar detalhes':'copiada',
     message:issues.length?'Clonagem parcial. Confira os MLBs criados; não repita automaticamente.':'Família de User Products criada. Confira os MLBs na conta de destino.'});
   }
   const payload=await validateCloneCandidate(targetToken,item,prepareClone(item,req.body?.stock,req.body?.title,req.body),target.ml_user_id,req.body?.title);
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
     let descriptionText='';
     if(editedDescription)descriptionText=req.body.description_text;
     else {
      const description=await ml(sourceToken,'/items/'+encodeURIComponent(id)+'/description');
      descriptionText=String(description.plain_text||description.text||'');
     }
     if(descriptionText){
      await ml(targetToken,'/items/'+encodeURIComponent(newId)+'/description','POST',{plain_text:descriptionText});
      descriptionStatus=editedDescription?'personalizada':'copiada';
     }else descriptionStatus=editedDescription?'sem descrição por escolha do usuário':'origem sem descrição';
    }catch{descriptionStatus='falhou: confira manualmente (o anúncio já foi criado)';}
   }
   if(payload.catalog_listing===true)descriptionStatus=editedDescription?'catálogo: descrição personalizada não suportada':'gerenciada pelo catálogo';
   res.json({ok:true,created_id:newId,description_status:descriptionStatus,
    validation_warnings:payload._validationWarnings||[],
    message:'Anúncio criado. Confira os atributos e as condições de publicação no Mercado Livre.'});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 // Modelos de embalagem existentes no Bling, apenas da empresa dona da conta ML.
 app.get('/api/portal/bulk-tools/dimensions/bling-presets',authPortalOrAgent,gate('bulk-dimensions'),async(req,res)=>{
  try{
   const account=await selectedAccount(req,req.query?.account_id);
   const companyId=String(account.company_id||'');
   if(!companyId||!supabase)return res.json({ok:true,connected:false,items:[]});
   const {data:links,error:linkError}=await supabase.from('bling_connections')
    .select('id').eq('company_id',companyId).eq('status','connected').limit(1);
   if(linkError)throw linkError;
   if(!links?.length)return res.json({ok:true,connected:false,items:[]});
   const {data:presets,error:presetError}=await supabase.from('bling_dimension_presets')
    .select('id,nome,peso,largura,altura,profundidade,ordem').eq('company_id',companyId)
    .order('ordem',{ascending:true}).order('nome',{ascending:true});
   if(presetError)throw presetError;
   const items=(presets||[]).map(p=>({
    id:String(p.id),name:String(p.nome||'').slice(0,100),
    dimensions:validDims({height:Number(p.altura),width:Number(p.largura),
     length:Number(p.profundidade),weight:Math.round(Number(p.peso)*1000)})
   })).filter(p=>p.name&&p.dimensions);
   res.json({ok:true,connected:true,items});
  }catch(e){res.status(500).json({ok:false,message:'Não foi possível carregar as embalagens cadastradas no Bling.'})}
 });
 // Sugestoes de categorias por texto, usando o preditor oficial de dominios.
 app.get('/api/portal/bulk-tools/dimensions/category-search',authPortalOrAgent,gate('bulk-dimensions'),async(req,res)=>{
  try{
   const query=String(req.query?.q||'').trim();
   if(query.length<2||query.length>100)return res.status(400).json({ok:false,message:'Digite de 2 a 100 caracteres para buscar.'});
   const token=await ensureMlToken(await selectedAccount(req,req.query?.account_id));
   const data=await ml(token,'/sites/MLB/domain_discovery/search?limit=8&q='+encodeURIComponent(query));
   if(!Array.isArray(data))throw new Error('Resposta inesperada da pesquisa de categorias.');
   const seen=new Set();
   const categories=data.filter(v=>validCategory(v?.category_id)).map(v=>({
    id:v.category_id,name:String(v.category_name||v.category_id).slice(0,140),
    domain_name:String(v.domain_name||'').slice(0,140)
   })).filter(v=>{if(seen.has(v.id))return false;seen.add(v.id);return true});
   res.json({ok:true,categories});
  }catch(e){res.status(400).json({ok:false,message:'Falha ao sugerir categorias: '+e.message})}
 });
 // Navegacao por nomes da arvore oficial de categorias do Mercado Livre.
 app.get('/api/portal/bulk-tools/dimensions/categories',authPortalOrAgent,gate('bulk-dimensions'),async(req,res)=>{
  try{
   const parent=String(req.query?.parent_id||'').toUpperCase().trim();
   if(parent&&!validCategory(parent))return res.status(400).json({ok:false,message:'Categoria invalida.'});
   const token=await ensureMlToken(await selectedAccount(req,req.query?.account_id));
   const data=parent?await ml(token,'/categories/'+encodeURIComponent(parent)):await ml(token,'/sites/MLB/categories');
   const source=parent?data.children_categories:data;
   if(!Array.isArray(source))throw new Error('Categorias indisponiveis para esta conta.');
   const categories=source.filter(c=>validCategory(c?.id)).map(c=>({id:c.id,name:String(c.name||c.id).slice(0,140)}))
    .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
   res.json({ok:true,parent_id:parent||null,categories});
  }catch(e){res.status(400).json({ok:false,message:'Falha ao buscar categorias: '+e.message})}
 });
 app.post('/api/portal/bulk-tools/dimensions/preview',authPortalOrAgent,gate('bulk-dimensions'),async(req,res)=>{
  try{
   const category=String(req.body?.category_id||'').toUpperCase().trim();
   if(!validCategory(category))return res.status(400).json({ok:false,message:'Categoria MLB inválida.'});
   if(!validDims(req.body?.dimensions))return res.status(400).json({ok:false,message:'Informe altura, largura, comprimento em cm e peso em g antes da prévia.'});
   const account=await selectedAccount(req,req.body?.account_id),token=await ensureMlToken(account);
   // Uma pagina por chamada evita timeout e permite buscar mais de 1000 anuncios.
   // O cursor de scan pertence a esta busca e nao deve ser usado em outra conta.
   const scrollId=String(req.body?.scroll_id||'');
   if(scrollId.length>3000)return res.status(400).json({ok:false,message:'Cursor de busca invalido.'});
   const base='/users/'+encodeURIComponent(account.ml_user_id)+'/items/search?search_type=scan&limit=50';
   const batch=await ml(token,base+(scrollId?'&scroll_id='+encodeURIComponent(scrollId):''));
   const ids=[...new Set((Array.isArray(batch.results)?batch.results:[]).map(String))];
   const nextScrollId=ids.length?String(batch.scroll_id||''):'';
   const items=[],skipped=[];let alreadyMatching=0;
   for(let i=0;i<ids.length;i+=10){
    await Promise.all(ids.slice(i,i+10).map(async id=>{
    try {
     const item=await shippingFreeFetchItem(id,token);
     if(String(item.seller_id)!==String(account.ml_user_id)||String(item.category_id)!==category)return;
     if(!['active','paused'].includes(item.status)){skipped.push({id,reason:'Status não suportado'});return;}
     if(item.shipping?.logistic_type==='fulfillment'){skipped.push({id,reason:'Full gerenciado pelo ML'});return;}
     if(item.shipping?.mode==='me1'){skipped.push({id,reason:'Envios 1 exige fluxo próprio de dimensões'});return;}
     const actual=sourcePackageDimensions(item);
     if(samePackageDimensions(actual,req.body.dimensions)){alreadyMatching++;return;}
     items.push({id:item.id,title:item.title,sku:item.seller_custom_field||'',
      category_id:item.category_id,status:item.status,
      mode:item.shipping?.mode||'',dimensions:actual});
    }catch(e){skipped.push({id,reason:e.message.slice(0,130)})}
    }));
   }
   res.json({ok:true,category_id:category,account_name:account.nickname||account.company_name,items,skipped,alreadyMatching,scanned:ids.length,next_scroll_id:nextScrollId,has_more:!!nextScrollId});
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
   const success=[],failed=[],pending=[],unchanged=[];
   for(const id of ids){
    try {
     const item=await shippingFreeFetchItem(id,token);
     if(String(item.seller_id)!==String(account.ml_user_id)||item.category_id!==category)throw new Error('Anúncio não pertence à conta/categoria.');
     if(!['active','paused'].includes(item.status))throw new Error('Status não permite edição.');
     if(samePackageDimensions(sourcePackageDimensions(item),dimensions)){
      unchanged.push({id,reason:'As medidas ja correspondem, independentemente da ordem.'});continue;
     }
     const body=buildDimensionUpdate(item,dimensions);
     await ml(token,'/items/'+encodeURIComponent(id),'PUT',body);
     try {
      const current=await shippingFreeFetchItem(id,token);
      const matches=samePackageDimensions(sourcePackageDimensions(current),dimensions);
      if(matches)success.push({id});
      else pending.push({id,reason:'A API aceitou a alteração, mas ainda não confirmou os atributos no anúncio.'});
     } catch {pending.push({id,reason:'A API aceitou a alteração; leitura de confirmação indisponível.'});}
    }catch(e){failed.push({id,error:e.message})}
   }
   res.json({ok:true,success,pending,failed,unchanged,message:'Revise as dimensões no Mercado Livre: algumas modalidades podem rejeitar ou substituir medidas.'});
  }catch(e){res.status(400).json({ok:false,message:e.message})}
 });
 }
};
