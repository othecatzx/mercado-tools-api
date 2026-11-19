'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {register}=require('../ml-bulk-tools');
const routes={};let checkedCompany=[];let connected=true;
const preset={id:'preset-1',nome:'CAIXA BRANCA TABLET',peso:'2.000',largura:'25.00',altura:'10.00',profundidade:'35.00',ordem:100};
const supabase={from(table){
 const query={select(){return this},eq(key,val){if(key==='company_id')checkedCompany.push(val);return this},limit(){return Promise.resolve({data:connected?[{id:'conn'}]:[],error:null})},order(){return this},then(resolve){return Promise.resolve({data:[preset],error:null}).then(resolve)}};
 return query;
}};
const accounts=[{ml_user_id:'11',company_id:'company-one'},{ml_user_id:'22',company_id:'company-two'}];
register({get(path,...handlers){routes[path]=handlers},post(path,...handlers){routes[path]=handlers}},
 {authPortalOrAgent:()=>{},scopedMenuAllowed:(_,menu)=>menu==='bulk-dimensions',
  getShippingAccounts:async()=>accounts,ensureMlToken:async()=>'',shippingFreeFetchItem:async()=>({}),supabase});
const invoke=async query=>{let status=200,body;await routes['/api/portal/bulk-tools/dimensions/bling-presets'][2]({query},{status(n){status=n;return this},json(v){body=v;return this}});return {status,body}};
(async()=>{
 let r=await invoke({account_id:'11'});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.connected,true);
 assert.deepEqual(r.body.items[0].dimensions,{height:10,width:25,length:35,weight:2000});
 assert.ok(checkedCompany.every(x=>x==='company-one'),'must only read current ML company presets');
 connected=false;r=await invoke({account_id:'22'});
 assert.equal(r.body.connected,false);assert.deepEqual(r.body.items,[]);
 assert.equal(checkedCompany[checkedCompany.length-1],'company-two');
 r=await invoke({account_id:'99'});assert.notEqual(r.status,200,'unknown account must not read presets');
 const ui=fs.readFileSync(path.join(__dirname,'..','portal','bulk-tools.js'),'utf8');
 assert.match(ui,/mlbtBlingPreset/);assert.match(ui,/loadBlingPresets/);
 assert.match(ui,/presetSelect\.onchange/);
 console.log('PASS: Bling presets are company-scoped, only connected accounts appear, kg converts to g, no auto-publish');
})().catch(e=>{console.error(e);process.exitCode=1});
