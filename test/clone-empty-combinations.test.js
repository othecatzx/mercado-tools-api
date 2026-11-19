'use strict';
const assert=require('node:assert/strict');
const {prepareClone,register}=require('../ml-bulk-tools');
const pic={id:'12345-MLB778',secure_url:'https://example.com/p.jpg'};
const item={id:'MLB1209378674',seller_id:'271180532',status:'active',
 title:'Produto original',price:85,category_id:'MLB1234',listing_type_id:'gold_special',
 pictures:[pic],attributes:[{id:'BRAND',value_name:'Teste'}],variations:[{
 id:101,attribute_combinations:[],seller_custom_field:'SKU-V1',available_quantity:15,
 price:99,attributes:[{id:'SELLER_SKU',value_name:'SKU-V1'},{id:'COLOR',value_name:'Azul'}],
 picture_ids:['12345-MLB778']}]};
const single=prepareClone(item,2);
assert.equal(single.variations,undefined,'Single technical entry must not become invented variation');
assert.equal(single.available_quantity,2);
assert.equal(single.price,99,'Original variation price preserved');
assert.equal(single.seller_custom_field,'SKU-V1');
assert.equal(single.attributes.find(a=>a.id==='SELLER_SKU').value_name,'SKU-V1');
assert.equal(single.attributes.find(a=>a.id==='COLOR').value_name,'Azul');
const mixed={...item,variations:[
 {...item.variations[0],id:101,attributes:[{id:'COLOR',value_name:'Azul'}]},
 {...item.variations[0],id:102,seller_custom_field:'SKU-V2',attributes:[{id:'COLOR',value_name:'Verde'}]}
]};
const routes={};
register({get(path,...f){routes[path]=f},post(path,...f){routes[path]=f}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
 getShippingAccounts:async()=>[{ml_user_id:'271180532'},{ml_user_id:'220712533'}],
 ensureMlToken:async()=> 'TOKEN',shippingFreeFetchItem:async()=>mixed
});
async function request(body){
 let status=200,response;
 await routes['/api/portal/bulk-tools/clone/preview'][2]({body},{
 status(x){status=x;return this},json(d){response=d;return this}});
 return {status,response};
}
(async()=>{
 let calls=[];
 const previous=global.fetch;
 global.fetch=async(url,opts)=>{
  calls.push({url,method:opts.method||'GET'});
  if(url.includes('/variations/'))return {ok:true,status:200,json:async()=>({
   attributes:[{id:'COLOR',value_name:url.endsWith('101')?'Azul':'Verde'}]
  })};
  if(url.endsWith('/categories/MLB1234/attributes'))return {ok:true,status:200,json:async()=>[
   {id:'COLOR',tags:{allow_variations:true}}
  ]};
  if(url.endsWith('/items/validate')){
   const data=JSON.parse(opts.body);
   assert.equal(data.variations.length,2);
   assert.deepEqual(data.variations.map(v=>v.attribute_combinations[0].value_name),['Azul','Verde']);
   return {ok:true,status:204,json:async()=>({})};
  }
  throw Error('unexpected '+url);
 };
 try{
  let result=await request({source_id:'271180532',target_id:'220712533',item_id:'1209378674',stock:2});
  assert.equal(result.status,200,JSON.stringify(result.response));
  assert.equal(result.response.preview.variations_count,2);
  assert.equal(calls.filter(x=>x.url.endsWith('/items/validate')).length,1);
  assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,0,'preview must not create');
  calls=[];
  global.fetch=async(url,opts)=>{
   calls.push({url});
   if(url.includes('/variations/'))return {ok:true,status:200,json:async()=>({attributes:[{id:'SELLER_SKU',value_name:'Same'}],user_product_id:'MLBU1234'})};
   if(url.endsWith('/categories/MLB1234/attributes'))return {ok:true,status:200,json:async()=>[{id:'COLOR',tags:{allow_variations:true}}]};
   throw Error('Unexpected URL '+url);
  };
  result=await request({source_id:'271180532',target_id:'220712533',item_id:'MLB1209378674',stock:2});
  assert.equal(result.status,400);
  assert.match(result.response.message,/User Product/);
  assert.equal(calls.some(x=>x.url.endsWith('/items/validate')),false,'unresolved User Products blocked');
  console.log('PASS: single technical variant flattened; multiple source variants enriched by category-allowed attributes; unresolved UP blocked');
 }finally{global.fetch=previous}
})().catch(e=>{console.error(e);process.exitCode=1});