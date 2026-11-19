'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const accounts=[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE STORE'}];
const item={seller_id:'271180532',status:'active',title:'Fonte alimentação Lenovo 210W',family_name:'Fonte Lenovo ThinkCentre',
 user_product_id:'MLBU12345',category_id:'MLB1234',price:109.90,listing_type_id:'gold_special',
 pictures:[{secure_url:'https://images.example.com/p.jpg'}],attributes:[{id:'BRAND',value_name:'Lenovo'}]};
const handlers={};
register({get(p,...f){handlers[p]=f},post(p,...f){handlers[p]=f}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
 getShippingAccounts:async()=>accounts,ensureMlToken:async()=> 'TOKEN',
 shippingFreeFetchItem:async()=>item
});
const call=async (path,body)=>{
 let status=200,response={};
 await handlers[path][2]({body},{status(x){status=x;return this},json(x){response=x}});
 return {status,response};
};
const request={source_id:'271180532',target_id:'220712533',item_id:'MLB4797008543',stock:1};
(async()=>{
 const previous=global.fetch,calls=[];
 global.fetch=async(url,config)=>{
  const body=JSON.parse(config.body);
  calls.push({url,body});
  if(url.endsWith('/items/validate')){
   if(!body.family_name)return {ok:false,status:400,json:async()=>({
     cause:[{code:'body.required_fields',message:'The body does not contains some or none of the following properties [family_name]',references:['body']}]
   })};
   if(body.title)return {ok:false,status:400,json:async()=>({message:'title is not allowed in this User Products flow'})};
   return {ok:true,status:204,json:async()=>({})};
  }
  if(url.endsWith('/items')&&config.method==='POST')return {ok:true,status:201,json:async()=>({id:'MLB999987777'})};
  if(url.endsWith('/description'))return {ok:true,status:200,json:async()=>({plain_text:'Descrição'})};
  throw Error('unexpected '+url);
 };
 try{
  const preview=await call('/api/portal/bulk-tools/clone/preview',request);
  assert.equal(preview.status,200,JSON.stringify(preview.response));
  assert.equal(preview.response.preview.clone_type,'user_product');
  assert.equal(preview.response.preview.family_name,'Fonte Lenovo ThinkCentre');
  assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,0);
  const unconfirmed=await call('/api/portal/bulk-tools/clone/apply',{...request,confirm:true});
  assert.equal(unconfirmed.status,409);
  assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,0);
  const success=await call('/api/portal/bulk-tools/clone/apply',{
   ...request,expected_family_name:'Fonte Lenovo ThinkCentre',confirm:true
  });
  assert.equal(success.status,200,JSON.stringify(success.response));
  const created=calls.filter(x=>x.url.endsWith('/items'));
  assert.equal(created.length,1);
  assert.equal(created[0].body.family_name,'Fonte Lenovo ThinkCentre');
  assert.equal(created[0].body.title,undefined);
  assert.equal(created[0].body.user_product_id,undefined);
  console.log('PASS: required family_name triggers compatible payload, preview confirms family and posting skips seller-specific ID');
 }finally{global.fetch=previous;}
})().catch(e=>{console.error(e);process.exitCode=1});
