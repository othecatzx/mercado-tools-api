'use strict';
const assert=require('node:assert/strict');
const {prepareClone,normalizeItemId,register}=require('../ml-bulk-tools');
assert.equal(normalizeItemId('1209378674'),'MLB1209378674');
assert.equal(normalizeItemId('mlb1209378674'),'MLB1209378674');
assert.equal(normalizeItemId('MLB1209378674'),'MLB1209378674');
const photos=[
 {id:'12345-MLB1000',secure_url:'https://example.com/black.jpg'},
 {id:'12346-MLB1001',secure_url:'https://example.com/white.jpg'}
];
const sourceItem={id:'MLB1209378674',seller_id:'271180532',status:'active',
 category_id:'MLB1234',title:'Camisa com variações',price:120,listing_type_id:'gold_special',
 pictures:photos,attributes:[{id:'BRAND',value_name:'Teste'}],
 variations:[
  {id:111,price:120,available_quantity:30,attribute_combinations:[{id:'COLOR',value_id:'52049',value_name:'Preto'}],
   picture_ids:['12345-MLB1000'],seller_custom_field:'BLACK-SKU',attributes:[{id:'SELLER_SKU',value_name:'BLACK-SKU'}]},
  {id:112,price:130,available_quantity:4,attribute_combinations:[{id:'COLOR',value_id:'52055',value_name:'Branco'}],
   picture_ids:['12346-MLB1001'],seller_custom_field:'WHITE-SKU'}
 ]};
const prepared=prepareClone(sourceItem,2);
assert.equal(prepared.variations.length,2);
assert.deepEqual(prepared.variations.map(v=>v.picture_ids),[['https://example.com/black.jpg'],['https://example.com/white.jpg']]);
assert.deepEqual(prepared.variations.map(v=>v.available_quantity),[2,2]);
assert.deepEqual(prepared.variations.map(v=>v.price),[120,130]);
assert.deepEqual(prepared.variations.map(v=>v.seller_custom_field),['BLACK-SKU','WHITE-SKU']);
assert.deepEqual(prepared.variations[0].attributes,[{id:'SELLER_SKU',value_name:'BLACK-SKU'}]);
assert.equal(prepared.variations[0].id,undefined);
assert.equal(prepared.variations[1].id,undefined);
assert.equal(prepared.variations[0].sold_quantity,undefined);
const priceEdit=prepareClone(sourceItem,3,'Nome personalizado',{price:155});
assert.deepEqual(priceEdit.variations.map(v=>v.price),[155,155]);
assert.deepEqual(priceEdit.variations.map(v=>v.available_quantity),[3,3]);
assert.throws(()=>prepareClone(sourceItem,1,null,{pictures:[{source:photos[0].secure_url}]}),/fotos ausentes/);
assert.throws(()=>prepareClone({...sourceItem,variations:[sourceItem.variations[0],sourceItem.variations[0]]},1),/duplicadas/);
const app={};
register({get(k,...fn){app[k]=fn},post(k,...fn){app[k]=fn}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
 getShippingAccounts:async()=>[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE'}],
 ensureMlToken:async()=> 'TOKEN',shippingFreeFetchItem:async()=>sourceItem
});
const calls=[];
const original=global.fetch;
global.fetch=async(url,opts)=>{
 calls.push({url,body:opts.body?JSON.parse(opts.body):null});
 if(url.endsWith('/items/validate'))return {ok:true,status:204,json:async()=>({})};
 if(url.endsWith('/items'))return {ok:true,status:201,json:async()=>({id:'MLB999999900'})};
 if(url.endsWith('/description'))return {ok:true,status:200,json:async()=>({plain_text:'Descrição'})};
 throw Error(url);
};
async function request(url,body){
 let code=200,response;
 await app[url][2]({body},{status(status){code=status;return this},json(data){response=data;return this}});
 return {code,response};
}
(async()=>{
 try{
  const body={source_id:'271180532',target_id:'220712533',item_id:'1209378674',stock:2};
  const pre=await request('/api/portal/bulk-tools/clone/preview',body);
  assert.equal(pre.code,200,JSON.stringify(pre.response));
  assert.equal(pre.response.preview.item_id,'MLB1209378674');
  assert.equal(pre.response.preview.variations_count,2);
  assert.equal(pre.response.preview.variations_summary[0].sku,'BLACK-SKU');
  assert.equal(calls.filter(x=>x.url.endsWith('/items')).length,0);
  const applied=await request('/api/portal/bulk-tools/clone/apply',{...body,confirm:true});
  assert.equal(applied.code,200,JSON.stringify(applied.response));
  const post=calls.filter(x=>x.url.endsWith('/items'));
  assert.equal(post.length,1);
  assert.equal(post[0].body.variations.length,2);
  assert.equal(post[0].body.variations[0].id,undefined);
  console.log('PASS: numeric MLB normalization, variant price/stock/SKU/combinations, photo relinking, read-only preview and publish');
 }finally{global.fetch=original}
})().catch(e=>{console.error(e);process.exitCode=1});
