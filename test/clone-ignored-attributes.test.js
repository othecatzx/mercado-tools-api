'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const accounts=[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE'}];
const ignoredIds=['DESIGN_CREATION','FILTRABLE_USE','GAMING','HAZMAT_TRANSPORTABILITY','HOME_DAILY_USE','IS_GAMER','OPTIMIZED_FOR_AI','WORK_STUDY'];
const item={seller_id:'271180532',status:'active',title:'Notebook completo',family_name:'Notebook completo',
 user_product_id:'MLBU12345',category_id:'MLB1234',price:119.90,listing_type_id:'gold_special',
 pictures:[{secure_url:'https://images.example.com/p.jpg'}],
 attributes:[{id:'BRAND',value_name:'Lenovo'},{id:'SELLER_SKU',value_name:'SKU-123'},
 ...ignoredIds.map(id=>({id,value_name:'No'}))]};
const handlers={};
register({get(p,...f){handlers[p]=f},post(p,...f){handlers[p]=f}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,getShippingAccounts:async()=>accounts,
 ensureMlToken:async()=> 'TOKEN',shippingFreeFetchItem:async()=>item
});
async function call(endpoint,body){
 let status=200,result={};
 await handlers[endpoint][2]({body},{status(s){status=s;return this},json(x){result=x;return this}});
 return {status,result};
}
const request={source_id:'271180532',target_id:'220712533',item_id:'MLB4797008543',stock:1};
(async()=>{
 const original=global.fetch,calls=[];
 global.fetch=async(url,config)=>{
  const body=JSON.parse(config.body);calls.push({url,body});
  if(url.endsWith('/items/validate')){
   const rejected=ignoredIds.filter(id=>body.attributes?.some(attr=>attr.id===id));
   const cause=rejected.map(id=>({code:'item.attributes.ignored',message:'Attribute ['+id+'] ignored because it is not modifiable.',references:['item.attributes']}));
   if(!body.family_name)cause.push({code:'body.required_fields',message:'The body does not contains some or none of the following properties [family_name]',references:['body']});
   if(cause.length)return {ok:false,status:400,json:async()=>({error:'validation_error',cause})};
   assert.equal(body.title,undefined);
   assert.deepEqual(body.attributes.map(a=>a.id),['BRAND','SELLER_SKU']);
   assert.equal(body._removedCloneAttributes,undefined,'no internal metadata may go to API');
   return {ok:true,status:204,json:async()=>({})};
  }
  if(url.endsWith('/items'))return {ok:true,status:201,json:async()=>({id:'MLB999887766'})};
  if(url.endsWith('/description'))return {ok:true,status:200,json:async()=>({plain_text:'Descrição'})};
  throw Error('unexpected '+url);
 };
 try{
  const preview=await call('/api/portal/bulk-tools/clone/preview',request);
  assert.equal(preview.status,200,JSON.stringify(preview.result));
  assert.deepEqual(preview.result.preview.removed_attributes,ignoredIds);
  assert.equal(preview.result.preview.family_name,'Notebook completo');
  assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,0);
  const denied=await call('/api/portal/bulk-tools/clone/apply',{...request,confirm:true});
  assert.equal(denied.status,409);
  const result=await call('/api/portal/bulk-tools/clone/apply',{...request,expected_family_name:'Notebook completo',confirm:true});
  assert.equal(result.status,200,JSON.stringify(result.result));
  assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,1);
  const posted=calls.find(x=>x.url.endsWith('/items')).body;
  assert.deepEqual(posted.attributes.map(a=>a.id),['BRAND','SELLER_SKU']);
  assert.equal(posted.family_name,'Notebook completo');
  assert.ok(calls.filter(x=>x.url.endsWith('/items/validate')).length>=4);
  console.log('PASS: auto-remove ignored attributes, preserve BRAND and SKU, family adaptation, prevent writes before confirmation');
 }finally{global.fetch=original}
})().catch(e=>{console.error(e);process.exitCode=1});
