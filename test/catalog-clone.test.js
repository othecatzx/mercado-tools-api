'use strict';
const assert=require('node:assert/strict');
const {register,prepareClone}=require('../ml-bulk-tools');
const accounts=[
 {ml_user_id:'271180532',company_id:'a',nickname:'4SHOW',company_name:'4SHOW'},
 {ml_user_id:'220712533',company_id:'b',nickname:'DAPHIE STORE',company_name:'DAPHIE'}
];
const base={
 seller_id:'271180532',id:'MLB4797008543',title:'Produto em catálogo',
 status:'active',price:99,category_id:'MLB1234',
 listing_type_id:'gold_special',condition:'new',currency_id:'BRL',
 attributes:[{id:'BRAND',value_name:'Exemplo'}],pictures:[],variations:[]
};
async function run(item,expectType){
 const handlers={};
 const calls=[];
 const oldFetch=global.fetch;
 global.fetch=async(url,options)=>{
   calls.push({url,body:options?.body&&JSON.parse(options.body),method:options?.method});
   return {ok:true,json:async()=>({id:'MLB888887777'})};
 };
 try{
  register({get(path,...fns){handlers[path]=fns},post(path,...fns){handlers[path]=fns}},{
   authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
   getShippingAccounts:async()=>accounts,
   ensureMlToken:async(a)=>'token-'+a.ml_user_id,
   shippingFreeFetchItem:async()=>item
  });
  async function req(route,body){
   let status=200,result;
   await handlers[route][2]({body},{status(x){status=x;return this},json(data){result=data;return this}});
   return {status,result};
  }
  const request={source_id:'271180532',target_id:'220712533',item_id:'MLB4797008543',stock:1};
  const preview=await req('/api/portal/bulk-tools/clone/preview',request);
  assert.equal(preview.status,200);
  assert.equal(preview.result.preview.clone_type,expectType);
  assert.equal(calls.length,0,'preview read only');
  if(expectType==='catalog'){
   assert.equal(preview.result.preview.catalog_product_id,'MLB987654');
   assert.match(preview.result.preview.warning,/confirme que o item físico/);
   const missing=await req('/api/portal/bulk-tools/clone/apply',{...request,confirm:true});
   assert.equal(missing.status,409,'must match catalog product that appeared at preview');
   assert.equal(calls.length,0);
  }
  const confirmation={...request,confirm:true,expected_catalog_product_id:preview.result.preview.catalog_product_id};
  const applied=await req('/api/portal/bulk-tools/clone/apply',confirmation);
  assert.equal(applied.status,200);
  assert.equal(applied.result.created_id,'MLB888887777');
  const post=calls.find(c=>c.method==='POST'&&c.url.endsWith('/items'));
  assert.ok(post,'item must be created in destination');
  assert.equal(post.body.catalog_listing,expectType==='catalog'?true:undefined);
  assert.equal(post.body.catalog_product_id,expectType==='catalog'?'MLB987654':undefined);
  assert.equal(post.body.user_product_id,undefined);
  assert.equal(post.body.family_name,undefined);
  if(expectType==='catalog')assert.equal(applied.result.description_status,'gerenciada pelo catálogo');
 }finally{global.fetch=oldFetch}
}
(async()=>{
 await run({...base,catalog_listing:true,catalog_product_id:'MLB987654',
   user_product_id:'MLBU321',family_name:'Família compartilhada'},'catalog');
 await run({...base,catalog_listing:false,catalog_product_id:'MLB987654',
   pictures:[{secure_url:'https://example.com/photo.jpg'}],
   user_product_id:'MLBU321',family_name:'Família do vendedor'},'standard');
 assert.throws(()=>prepareClone({...base,catalog_listing:true},1),/catalog_product_id/);
 console.log('PASS: catalog direct listing, family standalone, explicit catalog confirmation and no writes during preview');
})().catch(e=>{console.error(e);process.exitCode=1});
