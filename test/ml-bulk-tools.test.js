'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const tools=require('../ml-bulk-tools');
assert.equal(tools.validItem('MLB123456789'),true);
assert.equal(tools.validItem('MLBU123456789'),false);
assert.equal(tools.validCategory('MLB1055'),true);
assert.equal(tools.validCategory('INVALID'),false);
assert.deepEqual(tools.validDims({height:10,width:20,length:30,weight:500}),{height:10,width:20,length:30,weight:500});
assert.equal(tools.validDims({height:0,width:20,length:30,weight:500}),null);
assert.equal(tools.validDims({height:1.2,width:20,length:30,weight:500}),null);
assert.deepEqual(tools.packageAttributes({height:10,width:20,length:30,weight:500}).map(x=>x.value_name),['10 cm','20 cm','30 cm','500 g']);
assert.throws(()=>tools.buildDimensionUpdate({shipping:{logistic_type:'fulfillment'}},{height:1,width:2,length:3,weight:4}),/Full/);
assert.throws(()=>tools.buildDimensionUpdate({shipping:{mode:'me1'}},{height:1,width:2,length:3,weight:4}),/Envios 1/);
const dims=tools.buildDimensionUpdate({shipping:{mode:'me2'}},{height:10,width:20,length:30,weight:500});
assert.equal(dims.attributes.length,4);
const item={id:'MLB123456789',status:'active',category_id:'MLB1055',title:'Produto teste',price:95,
 currency_id:'BRL',pictures:[{secure_url:'https://example.com/image.jpg'}],attributes:[{id:'BRAND',value_name:'Exemplo'}],
 seller_custom_field:'TEST-SKU',variations:[],listing_type_id:'gold_special'};
const payload=tools.prepareClone(item,1);
assert.equal(payload.available_quantity,1);
assert.equal(payload.seller_custom_field,'TEST-SKU');
assert.deepEqual(payload.pictures,[{source:'https://example.com/image.jpg'}]);
assert.equal(payload.attributes.find(a=>a.id==='BRAND').value_name,'Exemplo');
assert.equal(payload.price,95);
assert.throws(()=>tools.prepareClone({...item,variations:[{id:1}]},1),/Variação 1.*atributos/);
// User Products / família sem catálogo: publicar de forma independente, sem
// reaproveitar IDs exclusivos do vendedor de origem.
const family=tools.prepareClone({...item,user_product_id:'MLBU555',family_name:'Minha família',catalog_product_id:'MLB123456'},1);
assert.equal(family.catalog_listing,undefined);
assert.equal(family.user_product_id,undefined);
assert.equal(family.family_name,undefined);
const catalog=tools.prepareClone({...item,catalog_listing:true,catalog_product_id:'MLB123456'},1);
assert.equal(catalog.catalog_listing,true);
assert.equal(catalog.catalog_product_id,'MLB123456');
assert.equal(catalog.price,95);
assert.equal(catalog.available_quantity,1);
const catalogWithoutPics=tools.prepareClone({...item,catalog_listing:true,catalog_product_id:'MLB123456',pictures:[]},1);
assert.deepEqual(catalogWithoutPics.pictures,[]);
assert.throws(()=>tools.prepareClone({...item,catalog_listing:true,catalog_product_id:null},1),/catalog_product_id/);
assert.throws(()=>tools.prepareClone(item,0),/Estoque/);
const routes={},auth=()=>{},guard=()=>{};
tools.register({get(route,...fns){routes[route]=fns},post(route,...fns){routes[route]=fns}},
 {authPortalOrAgent:auth,scopedMenuAllowed:()=>false,
  getShippingAccounts:async()=>[],ensureMlToken:async()=>'',shippingFreeFetchItem:async()=>({})});
for(const ep of ['/api/portal/bulk-tools/accounts','/api/portal/bulk-tools/clone/preview',
 '/api/portal/bulk-tools/clone/apply','/api/portal/bulk-tools/dimensions/preview',
 '/api/portal/bulk-tools/dimensions/apply']){
 assert.ok(routes[ep],ep);
 assert.equal(routes[ep][0],auth);
 let status;
 routes[ep][1]({}, {status(n){status=n;return this},json(){}},()=>{throw Error('Unauthorized request was allowed')});
 assert.equal(status,403,'bulk-editor permission required for '+ep);
}
const ui=fs.readFileSync(path.join(root,'portal','bulk-tools.js'),'utf8');
const ctx={window:{},document:{}};
vm.runInNewContext(ui,ctx);
const html=ctx.window.mlshBulkTools.markup('clone');
assert.match(html,/data-tool="clone"/);
assert.match(ctx.window.mlshBulkTools.markup('dimensions'),/data-tool="dimensions"/);
for(const id of ['mlbtSource','mlbtTarget','mlbtClonePreview','mlbtCloneConsent','mlbtDimAccount','mlbtCategory','mlbtDimPreview','mlbtDimConsent'])
 assert.ok(html.includes('id="'+id+'"'),id);
assert.ok(html.includes('ficha técnica do catálogo'));
assert.ok(html.includes('Confirmo as medidas'));
assert.ok(!html.includes('Copiar diagnóstico'));
const bulk=fs.readFileSync(path.join(root,'portal','bulk-editor.js'),'utf8');
assert.doesNotMatch(bulk,/mlshBulkTools\?\.markup\(\)/);
assert.doesNotMatch(bulk,/mlshBulkTools\?\.init\(\{api\}\)/);
const portal=fs.readFileSync(path.join(root,'portal','index.html'),'utf8');
assert.ok(portal.indexOf('bulk-tools.js')<portal.indexOf('bulk-editor.js'));
assert.match(portal,/case'clone-listings'/);
assert.match(portal,/case'bulk-dimensions'/);
assert.match(portal,/mlshCloneBatch\.init\(\{api\}\)/);
assert.match(portal,/data-page="clone-listings"/);
assert.match(portal,/data-page="bulk-dimensions"/);
const batch=fs.readFileSync(path.join(root,'portal','bulk-clone-batch.js'),'utf8');
assert.match(batch,/items\.length>20/);
assert.match(batch,/\.split\(\/\[\\s,;\]\+\//);
assert.match(batch,/\.mlbtBatchSelected:checked/);
assert.match(batch,/confirm:true/);
assert.match(batch,/não repita|não repetir|não repetir|verifique/i);
assert.match(portal,/bulk-tools\.css/);
console.log('PASS: validation, clone payload, seller package dimensions, permissions, confirmation UI, integration');

(async()=>{
 const endpoints={};
 const accounts=[
  {ml_user_id:'11',company_id:'c1',nickname:'Origem'},
  {ml_user_id:'22',company_id:'c2',nickname:'Destino'}
 ];
 const sourceItem={...item,seller_id:'11'};
 const events=[];
 const previousFetch=global.fetch;
 global.fetch=async (url,options)=>{
  events.push({url,method:options?.method||'GET',body:options?.body});
  if(url.endsWith('/items')&&options.method==='POST')return {ok:true,json:async()=>({id:'MLB999123456'})};
  if(url.endsWith('/items/MLB999123456/description')&&options.method==='POST')return {ok:true,json:async()=>({})};
  if(url.endsWith('/items/MLB123456789/description'))return {ok:true,json:async()=>({plain_text:'Descrição de teste'})};
  return {ok:true,json:async()=>({results:['MLB123456789'],paging:{total:1}})};
 };
 try{
  tools.register({get(route,...fns){endpoints[route]=fns},post(route,...fns){endpoints[route]=fns}},
   {authPortalOrAgent:auth,scopedMenuAllowed:()=>true,getShippingAccounts:async()=>accounts,
    ensureMlToken:async a=>'test-token-'+a.ml_user_id,
    shippingFreeFetchItem:async()=>sourceItem});
  const call=async (path,body)=>{
   let response={},status=200;
   await endpoints[path][2]({body},{status(n){status=n;return this},json(data){response=data;return this}});
   return {status,response};
  };
  const denied=await call('/api/portal/bulk-tools/clone/apply',{item_id:'MLB123456789',source_id:'11',target_id:'22',stock:1});
  assert.equal(denied.status,400);
  assert.equal(events.length,0,'no publication without explicit confirmation');
  const preview=await call('/api/portal/bulk-tools/clone/preview',{item_id:'MLB123456789',source_id:'11',target_id:'22',stock:1});
  assert.equal(preview.response.preview.stock,1);
  assert.equal(events.filter(e=>e.url.endsWith('/items')).length,0,'preview must not publish');
  assert.equal(events.filter(e=>e.url.endsWith('/items/validate')).length,1,'preview must validate publication');
  const cloned=await call('/api/portal/bulk-tools/clone/apply',{item_id:'MLB123456789',source_id:'11',target_id:'22',stock:1,confirm:true});
  assert.equal(cloned.response.created_id,'MLB999123456');
  assert.equal(events.filter(e=>e.url.endsWith('/items')&&e.method==='POST').length,1);
  const noDims=await call('/api/portal/bulk-tools/dimensions/apply',{category_id:'MLB1055',account_id:'11',
    item_ids:['MLB123456789'],dimensions:{height:10,width:20,length:30,weight:500}});
  assert.equal(noDims.status,400,'must confirm bulk dimensions');
 }finally{global.fetch=previousFetch}
 console.log('PASS: clone preview read-only, target publication requires consent, dimension write requires consent');
})().catch(e=>{console.error(e);process.exitCode=1});

const separated={};
tools.register({get(route,...handlers){separated[route]=handlers},post(route,...handlers){separated[route]=handlers}},
 {authPortalOrAgent:auth,scopedMenuAllowed:(_,menu)=>menu==='clone-listings',
 getShippingAccounts:async()=>[],ensureMlToken:async()=>'',shippingFreeFetchItem:async()=>({})});
let granted=false,blockedCode=0;
separated['/api/portal/bulk-tools/clone/preview'][1]({}, {status(n){blockedCode=n;return this},json(){}},()=>{granted=true});
assert.equal(granted,true,'clone permission independently granted');
separated['/api/portal/bulk-tools/dimensions/apply'][1]({}, {status(n){blockedCode=n;return this},json(){}},()=>{throw Error('dimension escalation')});
assert.equal(blockedCode,403,'dimension permission independent of cloning');
const attendance=fs.readFileSync(path.join(root,'atendimento.routes.js'),'utf8');
assert.match(attendance,/menuKeys = new Set\(\[[^\]]*'clone-listings'[^\]]*'bulk-dimensions'/);
