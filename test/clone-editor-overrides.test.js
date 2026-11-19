'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {register,prepareClone}=require('../ml-bulk-tools');
const base={seller_id:'271180532',id:'MLB4797008543',title:'Notebook original',
 status:'active',category_id:'MLB1234',family_name:'Família original',
 user_product_id:'MLBU456',price:3500,listing_type_id:'gold_special',
 pictures:[{secure_url:'https://images.example.com/original.jpg'}],
 attributes:[{id:'BRAND',value_name:'Marca teste'}]};
const accounts=[{ml_user_id:'271180532',company_id:'A',nickname:'4SHOW'},
 {ml_user_id:'220712533',company_id:'B',nickname:'DAPHIE'}];
const routes={};
register({get(name,...handlers){routes[name]=handlers},post(name,...handlers){routes[name]=handlers}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:(req,key)=>key==='clone-listings',
 getShippingAccounts:async()=>accounts,
 ensureMlToken:async account=>'TOKEN-'+account.ml_user_id,
 shippingFreeFetchItem:async()=>base
});
const call=async(name,body,query)=>{
 let status=200,data;
 await routes[name][2]({body,query},{status(code){status=code;return this},json(value){data=value;return this}});
 return {status,data};
};
const userRequest={source_id:'271180532',target_id:'220712533',item_id:'MLB4797008543',stock:2};
const newPictures=[{source:'https://images.example.com/new-cover.jpg'}, {id:'123456-MLB987654321'}];
const custom={title:'Família nova para Daphie',price:3299.90,
 pictures:newPictures,description_text:'Descrição personalizada, com informações claras sobre o produto.'};
(async()=>{
 const orig=global.fetch,requests=[];
 global.fetch=async(url,options)=>{
  const method=options?.method||'GET';
  const body=options?.body&&typeof options.body==='string'?JSON.parse(options.body):null;
  requests.push({url,method,body});
  if(url.endsWith('/items/validate')){
   if(!body.family_name)return {ok:false,status:400,json:async()=>({cause:[
    {code:'body.required_fields',message:'The body does not contains some or none of the following properties [family_name]'}]})};
   assert.equal(body.title,undefined);
   assert.equal(body.family_name,'Família nova para Daphie');
   assert.equal(body.price,3299.90);
   assert.deepEqual(body.pictures,newPictures);
   return {ok:true,status:204,json:async()=>({})};
  }
  if(url.endsWith('/items')&&method==='POST'){
   assert.equal(options.headers.Authorization,'Bearer TOKEN-220712533');
   assert.equal(body.family_name,custom.title);
   return {ok:true,status:201,json:async()=>({id:'MLB998877665'})};
  }
  if(url.endsWith('/items/MLB998877665/description')&&method==='POST'){
   assert.deepEqual(body,{plain_text:custom.description_text});
   return {ok:true,status:200,json:async()=>({})};
  }
  if(url.endsWith('/items/MLB4797008543/description'))return {ok:true,status:200,json:async()=>({plain_text:'Descrição da origem'})};
  throw Error('Unsupported endpoint '+url);
 };
 try{
  const source=await call('/api/portal/bulk-tools/clone/source',null,{source_id:userRequest.source_id,item_id:userRequest.item_id});
  assert.equal(source.status,200,JSON.stringify(source.data));
  assert.equal(source.data.title,'Notebook original');
  assert.equal(source.data.family_name,'Família original');
  assert.equal(source.data.price,3500);
  assert.equal(source.data.description_text,'Descrição da origem');
  assert.equal(source.data.pictures.length,1);
  const preview=await call('/api/portal/bulk-tools/clone/preview',{...userRequest,...custom});
  assert.equal(preview.status,200,JSON.stringify(preview.data));
  assert.equal(preview.data.preview.family_name,'Família nova para Daphie');
  assert.equal(preview.data.preview.price,3299.9);
  assert.equal(preview.data.preview.pictures,2);
  assert.equal(requests.filter(x=>x.url.endsWith('/items')&&x.method==='POST').length,0);
  const blocked=await call('/api/portal/bulk-tools/clone/apply',{...userRequest,...custom,confirm:true,expected_family_name:'Família original'});
  assert.equal(blocked.status,409,'edited family requires latest preview confirmation');
  assert.equal(requests.filter(x=>x.url.endsWith('/items')&&x.method==='POST').length,0);
  const applied=await call('/api/portal/bulk-tools/clone/apply',{
   ...userRequest,...custom,confirm:true,expected_family_name:'Família nova para Daphie'
  });
  assert.equal(applied.status,200,JSON.stringify(applied.data));
  assert.equal(applied.data.description_status,'personalizada');
  assert.equal(requests.filter(x=>x.url.endsWith('/items')&&x.method==='POST').length,1);
  assert.equal(requests.filter(x=>x.url.endsWith('/description')&&x.method==='POST').length,1);
  const invalid=prepareClone({...base,family_name:null},1,'Outra família',{pictures:[{id:'invalid'}]});
  assert.fail('Should not accept '+JSON.stringify(invalid));
 }catch(error){
  if(!/Foto inválida/.test(error.message))throw error;
 }finally{global.fetch=orig}
 const editor=fs.readFileSync(path.resolve(__dirname,'../portal/clone-editor.js'),'utf8');
 assert.match(editor,/image\/webp/);
 assert.match(editor,/canvas\.toBlob\(resolve,'image\/jpeg'/);
 assert.match(editor,/Editar|Personalizar anúncio/);
 const batch=fs.readFileSync(path.resolve(__dirname,'../portal/bulk-clone-batch.js'),'utf8');
 assert.match(batch,/batchEdits\.get\(item_id\)/);
 assert.match(batch,/mlshCloneEditor\.open/);
 const page=fs.readFileSync(path.resolve(__dirname,'../portal/index.html'),'utf8');
 assert.match(page,/clone-editor\.js/);
 console.log('PASS: source editor data, family override, custom price/photos/description, consent, WebP conversion and batch integration');
})().catch(e=>{console.error(e);process.exitCode=1});
