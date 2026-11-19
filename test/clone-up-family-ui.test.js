'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../portal/bulk-clone-batch.js'),'utf8');
const nodes=new Map(),events=new Map(),calls=[];
function node(id){
 if(!nodes.has(id))nodes.set(id,{
  id,dataset:{},children:[],hidden:false,disabled:false,checked:false,value:'',textContent:'',
  append(...items){this.children.push(...items)},
  prepend(...items){this.children.unshift(...items)},
  replaceChildren(){this.children=[]},
  addEventListener(name,fn){events.set(id+':'+name,fn)}
 });
 return nodes.get(id);
}
node('mlbtSource').value='271180532';
node('mlbtTarget').value='220712533';
node('mlbtStock').value='3';
node('mlbtItem').value='1209378674';
const list=node('mlbtCloneList');
list.querySelectorAll=selector=>{
 assert.equal(selector,'.mlbtBatchSelected:checked');
 return list.children.flatMap(row=>row.children.filter(c=>c.className==='mlbtBatchSelected'&&c.checked));
};
const root={isConnected:true,querySelectorAll:selector=>list.querySelectorAll(selector)};
const api=async(endpoint,opts)=>{
 const data=JSON.parse(opts.body);calls.push({endpoint,data});
 if(endpoint.endsWith('/preview'))return {preview:{
  item_id:data.item_id,title:'Família UP',family_name:'Família UP',clone_type:'user_product_family',
  publication_count:3,variations_count:3,variations_summary:[
   {attributes:'Azul',sku:'A',price:100},{attributes:'Verde',sku:'B',price:100},{attributes:'Vermelho',sku:'C',price:100}],
  price:100,pictures:5,warning:'Três anúncios serão publicados'
 }};
 if(endpoint.endsWith('/apply')){
  assert.equal(data.expected_family_name,'Família UP');
  assert.equal(data.expected_publication_count,3);
  return {ok:true,created_ids:[
   {id:'MLB901',label:'Azul'},{id:'MLB902',label:'Verde'},{id:'MLB903',label:'Vermelho'}
  ],description_status:'copiada'};
 }
 throw Error('unexpected endpoint');
};
const doc={
 getElementById:node,
 querySelector:s=>s==='.mlsh-bulk-tools[data-tool="clone"]'?root:null,
 createElement:tag=>node('dynamic'+nodes.size+':'+tag)
};
const win={};
vm.runInNewContext(source,{window:win,document:doc});
win.mlshCloneBatch.init({api});
(async()=>{
 await node('mlbtClonePreview').onclick();
 assert.equal(calls.length,1);
 assert.equal(calls[0].data.item_id,'MLB1209378674');
 assert.equal(list.children.length,1);
 assert.match(list.children[0].children.find(x=>x.className==='mlbt-result-copy').textContent,/3 anúncios novos/);
 assert.equal(node('mlbtCloneConsentWrap').hidden,false);
 node('mlbtCloneConsent').checked=true;
 events.get('mlbtCloneConsent:change')();
 await node('mlbtCloneApply').onclick();
 assert.equal(calls.length,2);
 assert.equal(node('mlbtCloneApply').hidden,true);
 assert.match(node('mlbtCloneStatus').textContent,/3 anúncio\(s\) criado\(s\)/);
 assert.match(list.children[0].children.find(x=>x.className==='mlbt-result-copy').textContent,/MLB903/);
 console.log('PASS: one source UP family -> three destination MLBs, explicit count confirmation and result display');
})().catch(e=>{console.error(e);process.exitCode=1});