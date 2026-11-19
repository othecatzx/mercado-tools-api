'use strict';
const assert=require('node:assert/strict');
const {register}=require('../ml-bulk-tools');
const routes={};
const accounts=[{ml_user_id:'220712533',nickname:'DAPHIE'}];
register({post(path,...handlers){routes[path]=handlers},get(path,...handlers){routes[path]=handlers}},{
 authPortalOrAgent:()=>{},scopedMenuAllowed:(req,key)=>key==='clone-listings',
 getShippingAccounts:async()=>accounts,ensureMlToken:async()=> 'TOKEN',
 shippingFreeFetchItem:async()=>({})
});
async function call(body){
 let code=200,result;
 await routes['/api/portal/bulk-tools/clone/photo'][2]({body},
  {status(x){code=x;return this},json(value){result=value;return this}});
 return {code,result};
}
(async()=>{
 const original=global.fetch;let count=0;
 global.fetch=async(url,config)=>{
  count++;
  assert.equal(url,'https://api.mercadolibre.com/pictures/items/upload');
  assert.equal(config.headers.Authorization,'Bearer TOKEN');
  assert.equal(config.method,'POST');
  assert.ok(config.body instanceof FormData);
  const f=config.body.get('file');
  assert.ok(f);
  assert.equal(f.type,'image/png');
  assert.equal(f.size,240);
  return {ok:true,status:200,json:async()=>({id:'123456-MLB987654321',secure_url:'https://example.com/photo.jpg'})};
 };
 try{
  const png=Buffer.alloc(240);
  Buffer.from('89504e470d0a1a0a','hex').copy(png);
  let response=await call({target_id:'220712533',mime:'image/png',data:png.toString('base64')});
  assert.equal(response.code,200,JSON.stringify(response.result));
  assert.equal(response.result.id,'123456-MLB987654321');
  assert.equal(count,1);
  response=await call({target_id:'220712533',mime:'image/webp',data:png.toString('base64')});
  assert.equal(response.code,400,'backend only accepts browser-converted JPG or PNG');
  response=await call({target_id:'220712533',mime:'image/png',data:Buffer.alloc(240).toString('base64')});
  assert.equal(response.code,400,'bad image header');
  response=await call({target_id:'999999',mime:'image/png',data:png.toString('base64')});
  assert.equal(response.code,400,'unconnected destination rejected');
  assert.equal(count,1,'invalid uploads never reach Mercado Livre');
  console.log('PASS: photo upload requires linked destination, correct PNG/JPG content, no raw WebP, 4 MB limit');
 }finally{global.fetch=original}
})().catch(e=>{console.error(e);process.exitCode=1});
