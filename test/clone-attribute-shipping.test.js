'use strict';
const assert=require('node:assert/strict');
const {register,prepareClone}=require('../ml-bulk-tools');
const accounts=[{ml_user_id:'271180532',nickname:'4SHOW'},{ml_user_id:'220712533',nickname:'DAPHIE'}];
const source={
 seller_id:'271180532',status:'active',title:'Notebook 16GB',category_id:'MLB1234',
 price:2500,listing_type_id:'gold_special',pictures:[{secure_url:'https://images.example.com/notebook.jpg'}],
 attributes:[{id:'BRAND',value_id:'123',value_name:'Exemplo'},
  {id:'PROCESSOR_MODEL',value_id:'890'},
  {id:'DEDICATED_GRAPHIC_CARD_MODEL',value_id:'789',values:[{id:'789',name:'RTX de teste'}]},
  {id:'SELLER_PACKAGE_HEIGHT',value_name:'10 cm'},{id:'SELLER_PACKAGE_WIDTH',value_name:'30 cm'},
  {id:'SELLER_PACKAGE_LENGTH',value_name:'50 cm'},{id:'SELLER_PACKAGE_WEIGHT',value_name:'3000 g'}]
};
const endpoints={};
register({post(path,...handlers){endpoints[path]=handlers},get(path,...handlers){endpoints[path]=handlers}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,
 getShippingAccounts:async()=>accounts,ensureMlToken:async()=> 'TOKEN',shippingFreeFetchItem:async()=>source
});
const request=async(path,body)=>{
 let status=200,result;
 await endpoints[path][2]({body},{status(n){status=n;return this},json(v){result=v;return this}});
 return {status,result};
};
const data={item_id:'MLB4797008543',source_id:'271180532',target_id:'220712533',stock:1};
(async()=>{
 const previous=global.fetch,requests=[];
 global.fetch=async(url,config)=>{
  const body=config.body?JSON.parse(config.body):null;
  requests.push({url,body,method:config.method||'GET'});
  if(url.endsWith('/categories/MLB1234/attributes'))return {ok:true,json:async()=>[
   {id:'PROCESSOR_MODEL',values:[{id:'890',name:'Core i7'}]}
  ]};
  if(url.endsWith('/users/220712533/shipping_preferences'))return {ok:true,json:async()=>({modes:['me2','custom','not_specified']})};
  if(url.endsWith('/items/validate')){
   const problems=[];
   const processor=body.attributes.find(a=>a.id==='PROCESSOR_MODEL');
   if(!processor.value_name)problems.push({code:'item.attribute.invalid',message:"Value name of attribute PROCESSOR_MODEL was not provided and couldn't be resolved from attributes database."});
   if(body.shipping?.mode!=='me2')problems.push({code:'shipping.lost_me1_by_user',message:'User has not mode me1'});
   if(problems.length)return {ok:false,status:400,json:async()=>({cause:problems})};
   assert.equal(processor.value_id,'890');
   assert.equal(processor.value_name,'Core i7');
   assert.equal(body.attributes.find(a=>a.id==='DEDICATED_GRAPHIC_CARD_MODEL').value_name,'RTX de teste');
   assert.equal(body.attributes.find(a=>a.id==='BRAND').value_name,'Exemplo');
   return {ok:true,status:204,json:async()=>({})};
  }
  if(url.endsWith('/items'))return {ok:true,status:201,json:async()=>({id:'MLB999888777'})};
  if(url.endsWith('/description'))return {ok:true,json:async()=>({plain_text:'Descrição do produto'})};
  throw Error('Unexpected url '+url);
 };
 try{
  const preview=await request('/api/portal/bulk-tools/clone/preview',data);
  assert.equal(preview.status,200,JSON.stringify(preview.result));
  assert.equal(preview.result.preview.shipping_mode,'me2');
  assert.equal(preview.result.preview.package_dimensions.weight,3000);
  assert.equal(requests.filter(x=>x.url.endsWith('/items')).length,0);
  const publish=await request('/api/portal/bulk-tools/clone/apply',{...data,confirm:true});
  assert.equal(publish.status,200,JSON.stringify(publish.result));
  const itemPosts=requests.filter(x=>x.url.endsWith('/items')&&x.method==='POST');
  assert.equal(itemPosts.length,1);
  assert.equal(itemPosts[0].body.shipping.mode,'me2');
  assert.equal(itemPosts[0].body.attributes.find(a=>a.id==='PROCESSOR_MODEL').value_name,'Core i7');
  console.log('PASS: resolve attribute value_name from source and category; target shipping ME2; read-only preview and single confirmed publication');
 }finally{global.fetch=previous}
})().catch(error=>{console.error(error);process.exitCode=1});
