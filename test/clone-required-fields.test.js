'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const item={seller_id:'271180532',id:'MLB4797008543',title:'Equipamento',
 status:'active',price:179.90,category_id:'MLB1234',listing_type_id:'gold_special',
 pictures:[{secure_url:'https://example.com/foto.jpg'}],attributes:[],
 catalog_product_id:'MLB111222',catalog_listing:false,variations:[]};
const accounts=[
 {ml_user_id:'271180532',company_id:'a',nickname:'4SHOW'},
 {ml_user_id:'220712533',company_id:'b',nickname:'DAPHIE STORE'}
];
(async()=>{
 const endpoints={};
 register({post(url,...fns){endpoints[url]=fns},get(url,...fns){endpoints[url]=fns}},{
  authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
  getShippingAccounts:async()=>accounts,
  ensureMlToken:async a=>'TOKEN-'+a.ml_user_id,
  shippingFreeFetchItem:async()=>item
 });
 const orig=global.fetch,seen=[];
 const missing={
  message:'Validation error',error:'validation_error',
  cause:[{code:'body.required_fields',message:'The payload is missing the following properties: [sale_terms]',references:['body.sale_terms']}]
 };
 let invalid=true;
 global.fetch=async (url,options)=>{
  seen.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
  if(url.endsWith('/items/validate')){
   return invalid?{ok:false,status:400,json:async()=>missing}:{ok:true,status:204,json:async()=>{throw Error('No Content')}};
  }
  if(url.endsWith('/items'))return {ok:true,status:201,json:async()=>({id:'MLB999999999'})};
  if(url.endsWith('/description'))return {ok:true,status:200,json:async()=>({plain_text:'Texto'})};
  throw Error('Unexpected URL '+url);
 };
 const req=async (endpoint,body)=>{
  let code=200,data;
  await endpoints[endpoint][2]({body},{status(value){code=value;return this},json(value){data=value;return this}});
  return {code,data};
 };
 const payload={item_id:'MLB4797008543',source_id:'271180532',target_id:'220712533',stock:1};
 try{
  const invalidPreview=await req('/api/portal/bulk-tools/clone/preview',payload);
  assert.equal(invalidPreview.code,400);
  assert.match(invalidPreview.data.message,/body\.required_fields/);
  assert.match(invalidPreview.data.message,/sale_terms/);
  assert.equal(seen.filter(e=>e.url.endsWith('/items')).length,0,'preview never publishes');
  assert.equal(seen[0].body.catalog_product_id,'MLB111222','traditional product association preserved');
  const invalidApply=await req('/api/portal/bulk-tools/clone/apply',{...payload,confirm:true});
  assert.equal(invalidApply.code,400);
  assert.equal(seen.filter(e=>e.url.endsWith('/items')).length,0,'invalid item never created');
  invalid=false;
  const preview=await req('/api/portal/bulk-tools/clone/preview',payload);
  assert.equal(preview.code,200);
  const result=await req('/api/portal/bulk-tools/clone/apply',{...payload,confirm:true});
  assert.equal(result.code,200);
  assert.equal(result.data.created_id,'MLB999999999');
  assert.equal(seen.filter(e=>e.url.endsWith('/items')).length,1,'one explicit publication after valid preview');
  assert.ok(seen.filter(e=>e.url.endsWith('/items/validate')).length>=4);
  console.log('PASS: required field cause visible, validator in preview & apply, preserves catalog id, no incomplete posting');
 }finally{global.fetch=orig;}
})().catch(e=>{console.error(e);process.exitCode=1});
