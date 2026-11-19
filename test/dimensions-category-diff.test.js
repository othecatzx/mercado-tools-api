'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const routes={};
const dims=(h,w,l,kg)=>[
 {id:'SELLER_PACKAGE_HEIGHT',value_name:h+' cm'},
 {id:'SELLER_PACKAGE_WIDTH',value_name:w+' cm'},
 {id:'SELLER_PACKAGE_LENGTH',value_name:l+' cm'},
 {id:'SELLER_PACKAGE_WEIGHT',value_name:kg+' g'}
];
const base={seller_id:'11',category_id:'MLB1055',status:'active',title:'Celular'};
const items={
 MLB100000001:{...base,id:'MLB100000001',attributes:dims(30,10,20,500)},
 MLB100000002:{...base,id:'MLB100000002',attributes:dims(10,20,30,600),seller_custom_field:'SKU2'},
 MLB100000003:{...base,id:'MLB100000003',attributes:[]},
 MLB100000004:{...base,id:'MLB100000004',attributes:[],shipping:{logistic_type:'fulfillment'}}
};
register({get(path,...handlers){routes[path]=handlers},post(path,...handlers){routes[path]=handlers}},
 {authPortalOrAgent:()=>{},scopedMenuAllowed:()=>true,getShippingAccounts:async()=>[{ml_user_id:'11',nickname:'TEST'}],
 ensureMlToken:async()=> 'TOKEN',shippingFreeFetchItem:async id=>items[id]});
const call=async(path,body={},query={})=>{
 let code=200,result;
 await routes[path][2]({body,query},{status(n){code=n;return this},json(data){result=data;return this}});
 return {code,result};
};
(async()=>{
 const oldFetch=global.fetch,puts=[];
 global.fetch=async(url,options={})=>{
  const method=options.method||'GET';
  if(url.includes('/sites/MLB/domain_discovery/search'))return {ok:true,json:async()=>[
   {category_id:'MLB1055',category_name:'Celulares e Smartphones',domain_name:'Celulares'},
   {category_id:'MLB1055',category_name:'Celulares e Smartphones',domain_name:'Celulares'}
  ]};
  if(url.endsWith('/sites/MLB/categories'))return {ok:true,json:async()=>[{id:'MLB1000',name:'Eletrônicos'}]};
  if(url.endsWith('/categories/MLB1000'))return {ok:true,json:async()=>({children_categories:[{id:'MLB1055',name:'Celulares'}]})};
  if(url.includes('/items/search'))return {ok:true,json:async()=>({results:Object.keys(items)})};
  if(method==='PUT'){
   const id=url.match(/\/items\/(MLB\d+)/)?.[1];puts.push(id);
   if(id)items[id]={...items[id],attributes:JSON.parse(options.body).attributes};
   return {ok:true,json:async()=>({})};
  }
  throw new Error('Unexpected '+method+' '+url);
 };
 try{
  const suggestions=await call('/api/portal/bulk-tools/dimensions/category-search',{}, {account_id:'11',q:'celular'});
  assert.equal(suggestions.code,200,JSON.stringify(suggestions.result));
  assert.deepEqual(suggestions.result.categories.map(c=>c.id),['MLB1055']);
  assert.equal(suggestions.result.categories[0].name,'Celulares e Smartphones');
  const root=await call('/api/portal/bulk-tools/dimensions/categories',{}, {account_id:'11'});
  assert.equal(root.code,200);assert.equal(root.result.categories[0].name,'Eletrônicos');
  const nested=await call('/api/portal/bulk-tools/dimensions/categories',{}, {account_id:'11',parent_id:'MLB1000'});
  assert.equal(nested.code,200);assert.equal(nested.result.categories[0].name,'Celulares');
  const request={account_id:'11',category_id:'MLB1055',dimensions:{height:10,width:20,length:30,weight:500},limit:20};
  const preview=await call('/api/portal/bulk-tools/dimensions/preview',request);
  assert.equal(preview.code,200,JSON.stringify(preview.result));
  assert.deepEqual(preview.result.items.map(i=>i.id),['MLB100000002','MLB100000003']);
  assert.equal(preview.result.alreadyMatching,1);
  assert.equal(preview.result.skipped.length,1);
  assert.equal(puts.length,0,'Preview must never write');
  const applied=await call('/api/portal/bulk-tools/dimensions/apply',{
   ...request,item_ids:['MLB100000001','MLB100000002'],confirm:true
  });
  assert.equal(applied.code,200,JSON.stringify(applied.result));
  assert.deepEqual(puts,['MLB100000002'],'matching item must not be changed');
  assert.deepEqual(applied.result.unchanged.map(x=>x.id),['MLB100000001']);
  assert.deepEqual(applied.result.success.map(x=>x.id),['MLB100000002']);
  console.log('PASS: names in category tree, unordered dimension comparison, different-only preview, selected-only apply');
 }finally{global.fetch=oldFetch}
})().catch(error=>{console.error(error);process.exitCode=1});
