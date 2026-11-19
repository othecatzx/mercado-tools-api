'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const routes={};
const item={id:'MLB1209378674',seller_id:'271180532',status:'active',
 title:'Camisa básica',family_name:'Camisa básica',price:100,
 category_id:'MLB1234',listing_type_id:'gold_special',
 pictures:[{id:'PIC-A',secure_url:'https://example.com/main.jpg'}],
 attributes:[{id:'BRAND',value_name:'Marca Teste'}],
 variations:[
  {id:301,user_product_id:'MLBU11111',seller_custom_field:'RED',price:115,attribute_combinations:[],picture_ids:['PIC-A']},
  {id:302,user_product_id:'MLBU22222',seller_custom_field:'BLUE',price:120,attribute_combinations:[],picture_ids:['PIC-A']}
 ]};
const accounts=[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE'}];
register({get(name,...f){routes[name]=f},post(name,...f){routes[name]=f}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
 getShippingAccounts:async()=>accounts,ensureMlToken:async a=>'TOKEN-'+a.ml_user_id,
 shippingFreeFetchItem:async()=>item
});
async function req(path,body){
 let code=200,result;
 await routes[path][2]({body},{status(x){code=x;return this},json(x){result=x;return this}});
 return {code,result};
}
const base={item_id:'1209378674',source_id:'271180532',target_id:'220712533',stock:2};
(async()=>{
 const oldFetch=global.fetch,seen=[];
 let validationFail=false,creationFail=false,sameAttributes=false;
 let created=0;
 global.fetch=async(url,options)=>{
  const method=options.method||'GET';
  const body=options.body&&typeof options.body==='string'?JSON.parse(options.body):undefined;
  seen.push({url,method,body});
  if(url.includes('/variations/'))throw Error('User Products must not depend on legacy variation endpoint');
  if(url.includes('/user-products/MLBU')){
   const red=url.includes('MLBU11111');
   return {ok:true,status:200,json:async()=>({
    id:red?'MLBU11111':'MLBU22222',name:red?'Camiseta vermelha':'Camiseta azul',
    attributes:[{id:'BRAND',values:[{name:'Marca Teste'}]},
     {id:'COLOR',values:[{id:red||sameAttributes?'52049':'52055',name:red||sameAttributes?'Vermelho':'Azul'}]}],
    pictures:[{secure_url:red?'https://example.com/red.jpg':'https://example.com/blue.jpg'}]
   })};
  }
  if(url.endsWith('/items/validate')){
   assert.ok(body.family_name);
   assert.equal(body.title,undefined);
   assert.equal(body.user_product_id,undefined);
   assert.equal(body.variations,undefined);
   assert.equal(body.available_quantity,2);
   assert.equal(body.attributes.find(a=>a.id==='COLOR')?.value_name,
     body.pictures[0].source.includes('red')||sameAttributes?'Vermelho':'Azul');
   if(validationFail&&body.pictures[0].source.includes('blue'))
    return {ok:false,status:400,json:async()=>({message:'missing product metadata',
      cause:[{code:'body.required_fields',type:'error',message:'Missing GTIN'}]})};
   return {ok:true,status:204,json:async()=>({})};
  }
  if(url.endsWith('/items')&&method==='POST'){
   created++;
   if(creationFail&&created===2)
    return {ok:false,status:400,json:async()=>({message:'Second variant failed'})};
   return {ok:true,status:201,json:async()=>({id:'MLB90000000'+created})};
  }
  if(url.endsWith('/items/MLB1209378674/description'))
   return {ok:true,status:200,json:async()=>({plain_text:'Descrição da origem'})};
  if(url.includes('/description')&&method==='POST')
   return {ok:true,status:201,json:async()=>({})};
  throw Error('Unexpected '+url);
 };
 try{
  const preview=await req('/api/portal/bulk-tools/clone/preview',base);
  assert.equal(preview.code,200,JSON.stringify(preview.result));
  assert.equal(preview.result.preview.clone_type,'user_product_family');
  assert.equal(preview.result.preview.publication_count,2);
  assert.equal(preview.result.preview.variations_summary[0].sku,'RED');
  assert.equal(preview.result.preview.variations_summary[1].price,120);
  assert.equal(seen.filter(x=>x.url.endsWith('/items')&&x.method==='POST').length,0);
  sameAttributes=true;
  const equivalent=await req('/api/portal/bulk-tools/clone/preview',base);
  assert.equal(equivalent.code,200,JSON.stringify(equivalent.result));
  assert.equal(equivalent.result.preview.publication_count,2,'Different UP ids may have identical technical attributes');
  sameAttributes=false;
  validationFail=true;
  const failedPreview=await req('/api/portal/bulk-tools/clone/preview',base);
  assert.equal(failedPreview.code,400);
  assert.match(failedPreview.result.message,/Opção 2/);
  assert.equal(created,0,'Preflight failure must not create any listings');
  validationFail=false;
  const wrongCount=await req('/api/portal/bulk-tools/clone/apply',{
   ...base,expected_family_name:'Camisa básica',expected_publication_count:1,confirm:true
  });
  assert.equal(wrongCount.code,409);
  assert.equal(created,0);
  const publish=await req('/api/portal/bulk-tools/clone/apply',{
   ...base,expected_family_name:'Camisa básica',expected_publication_count:2,confirm:true
  });
  assert.equal(publish.code,200,JSON.stringify(publish.result));
  assert.equal(publish.result.created_ids.length,2);
  assert.equal(publish.result.partial,false);
  assert.equal(created,2);
  created=0;creationFail=true;
  const partial=await req('/api/portal/bulk-tools/clone/apply',{
   ...base,expected_family_name:'Camisa básica',expected_publication_count:2,confirm:true
  });
  assert.equal(partial.code,200);
  assert.equal(partial.result.partial,true);
  assert.equal(partial.result.created_ids.length,1);
  assert.match(partial.result.issues[0],/Opção 2/);
  assert.equal(created,2);
  console.log('PASS: UP family preflight, two independent item posts, SKU/photo/price variants, count confirmation and partial result IDs');
 }finally{global.fetch=oldFetch}
})().catch(error=>{console.error(error);process.exitCode=1});