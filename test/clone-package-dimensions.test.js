'use strict';
const assert=require('node:assert/strict');
const {prepareClone,register}=require('../ml-bulk-tools');
const dims={height:12,width:22,length:32,weight:750};
const source={id:'MLB4797008543',seller_id:'271180532',title:'Produto teste',status:'active',
 category_id:'MLB1234',price:99,listing_type_id:'gold_special',condition:'new',
 pictures:[{secure_url:'https://images.example.com/p.jpg'}],
 warranty:'12 meses',sale_terms:[{id:'WARRANTY_TYPE',value_name:'Garantia do vendedor'},{id:'WARRANTY_TIME',value_name:'12 meses'}],
 attributes:[{id:'BRAND',value_name:'Exemplo'},...Object.entries({
 SELLER_PACKAGE_HEIGHT:'12 cm',SELLER_PACKAGE_WIDTH:'22 cm',
 SELLER_PACKAGE_LENGTH:'32 cm',SELLER_PACKAGE_WEIGHT:'750 g'
 }).map(([id,value_name])=>({id,value_name}))]};
const original=prepareClone(source,1);
assert.equal(original.warranty,undefined,'deprecated warranty never forwarded');
assert.deepEqual(original.sale_terms.map(t=>t.id),['WARRANTY_TYPE','WARRANTY_TIME']);
assert.deepEqual(original.attributes.filter(a=>a.id.startsWith('SELLER_PACKAGE_')).map(a=>a.value_name),['12 cm','22 cm','32 cm','750 g']);
assert.deepEqual(prepareClone({...source,attributes:[{id:'BRAND',value_name:'Exemplo'}],shipping:{dimensions:'12x22x32,750'}},1).attributes.filter(a=>a.id.startsWith('SELLER_PACKAGE_')).map(a=>a.value_name),['12 cm','22 cm','32 cm','750 g']);
const accounts=[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE'}];
const endpoints={};let currentSource=source;
register({get(path,...handlers){endpoints[path]=handlers},post(path,...handlers){endpoints[path]=handlers}},
 {authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,getShippingAccounts:async()=>accounts,
 ensureMlToken:async()=> 'TOKEN',shippingFreeFetchItem:async()=>currentSource});
const request=async(path,body)=>{
 let status=200,json;
 await endpoints[path][2]({body},{status(s){status=s;return this},json(data){json=data;return this}});
 return {status,json};
};
(async()=>{
 const previous=global.fetch,calls=[];
 global.fetch=async(url,opt)=>{
  const body=JSON.parse(opt.body);calls.push({url,body});
  if(url.endsWith('/items/validate')){
   const attrs=body.attributes||[];
   const hasDims=['SELLER_PACKAGE_HEIGHT','SELLER_PACKAGE_WIDTH','SELLER_PACKAGE_LENGTH','SELLER_PACKAGE_WEIGHT'].every(id=>attrs.some(a=>a.id===id));
   if(!hasDims)return {ok:false,status:400,json:async()=>({cause:[
    {code:'item.attribute.missing.seller.package.dimensions',message:'The attributes [seller_package_height, seller_package_width, seller_package_length, seller_package_weight] are all required',references:['item.attributes']},
    {code:'item.warranty.not_updatable',message:'Warranty field is deprecated and cannot be updated',references:['item.warranty']}
   ]})};
   assert.equal(body.warranty,undefined);
   assert.equal(attrs.find(a=>a.id==='SELLER_PACKAGE_WEIGHT').value_name,'750 g');
   return {ok:true,status:204,json:async()=>({})};
  }
  if(url.endsWith('/items'))return {ok:true,status:201,json:async()=>({id:'MLB987654321'})};
  if(url.endsWith('/description'))return {ok:true,status:200,json:async()=>({plain_text:'Descrição'})};
  throw Error('URL inesperada '+url);
 };
 try{
  const req={item_id:'MLB4797008543',source_id:'271180532',target_id:'220712533',stock:1};
  const ok=await request('/api/portal/bulk-tools/clone/preview',req);
  assert.equal(ok.status,200,JSON.stringify(ok.json));
  assert.deepEqual(ok.json.preview.package_dimensions,dims);
  const publish=await request('/api/portal/bulk-tools/clone/apply',{...req,confirm:true});
  assert.equal(publish.status,200,JSON.stringify(publish.json));
  assert.equal(calls.filter(c=>c.url.endsWith('/items')).length,1);
  const missing={...source,attributes:source.attributes.filter(a=>!a.id.startsWith('SELLER_PACKAGE_'))};
  currentSource=missing;
  const incomplete=await request('/api/portal/bulk-tools/clone/preview',req);
  assert.equal(incomplete.status,400);
  assert.match(incomplete.json.message,/exige dimensões da embalagem/);
  assert.equal(calls.filter(c=>c.url.endsWith('/items')).length,1,'missing dimensions must not create a new item');
  currentSource={...missing,shipping:{dimensions:'12x22x32,750'}};
  const fallback=await request('/api/portal/bulk-tools/clone/preview',req);
  assert.equal(fallback.status,200,JSON.stringify(fallback.json));
  assert.equal(fallback.json.preview.package_dimensions_source,'origem');
  assert.deepEqual(fallback.json.preview.package_dimensions,dims);
  const noDims=prepareClone(missing,1);
  assert.equal(noDims.attributes.some(a=>a.id.startsWith('SELLER_PACKAGE_')),false);
  console.log('PASS: source dimensions automatically copied, shipping fallback, unit suffixes, no invented values, warranty omitted');
 }finally{global.fetch=previous}
})().catch(e=>{console.error(e);process.exitCode=1});
