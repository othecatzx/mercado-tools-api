'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const source={seller_id:'271180532',title:'Notebook Lenovo',status:'active',
 category_id:'MLB1234',price:2999,listing_type_id:'gold_special',
 pictures:[{secure_url:'https://example.com/p.jpg'}],
 attributes:[
 {id:'BRAND',value_name:'Lenovo'},
 {id:'SELLER_PACKAGE_HEIGHT',value_name:'10 cm'},
 {id:'SELLER_PACKAGE_WIDTH',value_name:'30 cm'},
 {id:'SELLER_PACKAGE_LENGTH',value_name:'50 cm'},
 {id:'SELLER_PACKAGE_WEIGHT',value_name:'3000 g'}]
};
const accounts=[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE'}];
const routes={};
register({get(path,...f){routes[path]=f},post(path,...f){routes[path]=f}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
 getShippingAccounts:async()=>accounts,
 ensureMlToken:async()=> 'TOKEN',
 shippingFreeFetchItem:async()=>source
});
const base={source_id:'271180532',target_id:'220712533',item_id:'MLB4797008543',stock:1};
async function call(path,body){
 let status=200,json;
 await routes[path][2]({body},{status(s){status=s;return this},json(data){json=data;return this}});
 return {status,json};
}
(async()=>{
 const originalFetch=global.fetch;
 const seen=[];
 let type='warning';
 const warningCauses=[
   {type:'warning',code:'shipping.lost_me1_by_user',message:'User has not mode me1'},
   {type:'warning',code:'item.shipping.mandatory_free_shipping',message:'Mandatory free shipping added'}
 ];
 global.fetch=async(url,opt)=>{
  if(url.endsWith('/shipping_preferences'))return {ok:true,status:200,json:async()=>({modes:['me2','not_specified']})};
  if(url.endsWith('/items/validate')){
   const body=JSON.parse(opt.body);seen.push({url,body});
   if(type==='mixed')return {ok:false,status:400,json:async()=>({cause:[
    ...warningCauses,{type:'error',code:'body.required_fields',message:'[some_attribute] required'}]})};
   if(type==='absent')return {ok:false,status:400,json:async()=>({cause:warningCauses.map(({type,...rest})=>rest)})};
   if(type==='error')return {ok:false,status:400,json:async()=>({cause:warningCauses.map(c=>({...c,type:'error'}))})};
   // The validation service may report non-blocking warnings even after ME2
   // and free_shipping:true; no errors should be ignored.
   return {ok:false,status:400,json:async()=>({cause:warningCauses})};
  }
  if(url.endsWith('/items')&&opt.method==='POST'){
   const body=JSON.parse(opt.body);seen.push({url,body});
   assert.equal(body.shipping.mode,'me2');
   assert.equal(body.shipping.free_shipping,true);
   return {ok:true,status:201,json:async()=>({id:'MLB998877665'})};
  }
  if(url.endsWith('/description'))return {ok:true,status:200,json:async()=>({plain_text:'Teste'})};
  throw Error('Unexpected '+url);
 };
 try{
  let preview=await call('/api/portal/bulk-tools/clone/preview',base);
  assert.equal(preview.status,200,JSON.stringify(preview.json));
  assert.equal(preview.json.preview.shipping_mode,'me2');
  assert.equal(preview.json.preview.free_shipping,true);
  assert.deepEqual(preview.json.preview.validation_warnings,
   ['shipping.lost_me1_by_user','item.shipping.mandatory_free_shipping (frete grátis obrigatório)']);
  assert.equal(seen.filter(c=>c.url.endsWith('/items')).length,0,'preview must never publish');
  const published=await call('/api/portal/bulk-tools/clone/apply',{...base,confirm:true});
  assert.equal(published.status,200,JSON.stringify(published.json));
  assert.equal(seen.filter(c=>c.url.endsWith('/items')).length,1);

  for(const state of ['mixed','absent','error']){
   type=state;
   const before=seen.filter(c=>c.url.endsWith('/items')).length;
   preview=await call('/api/portal/bulk-tools/clone/preview',base);
   assert.equal(preview.status,400,state+' cannot be considered validated');
   assert.equal(seen.filter(c=>c.url.endsWith('/items')).length,before);
  }
  console.log('PASS: shipping warnings (type explicit), free shipping and ME2, mixed/error/missing-type causes remain blocking');
 }finally{global.fetch=originalFetch}
})().catch(e=>{console.error(e);process.exitCode=1});
