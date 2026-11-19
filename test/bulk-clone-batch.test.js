'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../portal/bulk-clone-batch.js'),'utf8');
const nodes=new Map(),calls=[],listeners=new Map();
function node(id){
 if(!nodes.has(id))nodes.set(id,{
  id,value:'',textContent:'',dataset:{},hidden:false,disabled:false,checked:false,
  children:[],
  replaceChildren(){this.children=[]},
  append(...items){this.children.push(...items)},
  addEventListener(event,handler){listeners.set(id+':'+event,handler)}
 });
 return nodes.get(id);
}
node('mlbtSource').value='100';
node('mlbtTarget').value='200';
node('mlbtStock').value='2';
node('mlbtItem').value='MLB123456789\nMLB123456780\nMLB123456789\nMLB123456781';
const list=node('mlbtCloneList');
list.querySelectorAll=selector=>{
 assert.equal(selector,'.mlbtBatchSelected:checked');
 return list.children.filter(row=>row.children?.some(ch=>ch.className==='mlbtBatchSelected'&&ch.checked))
  .map(row=>row.children.find(ch=>ch.className==='mlbtBatchSelected'));
};
const root={isConnected:true,querySelectorAll(selector){
 assert.equal(selector,'.mlbtBatchSelected:checked');
 return list.children.filter(row=>row.children?.some(ch=>ch.className==='mlbtBatchSelected'&&ch.checked))
  .map(row=>row.children.find(ch=>ch.className==='mlbtBatchSelected'));
}};
const document={
 getElementById:node,
 querySelector:selector=>selector==='.mlsh-bulk-tools[data-tool="clone"]'?root:null,
 createElement:tag=>node('dynamic'+Math.random()+':'+tag)
};
const window={};
vm.runInNewContext(source,{document,window});
const api=async (route,opt)=>{
 const body=JSON.parse(opt.body);
 calls.push({route,body});
 if(route.endsWith('/preview')){
  if(body.item_id==='MLB123456781')throw Error('Anúncio com variações');
  return {preview:{item_id:body.item_id,title:'Produto '+body.item_id,price:100,pictures:3,clone_type:body.item_id==='MLB123456789'?'catalog':'standard',catalog_product_id:body.item_id==='MLB123456789'?'MLB987654':null,warning:'Conferir produto'}};
 }
 if(route.endsWith('/apply')){
  if(body.item_id==='MLB123456780')throw Error('Falha de publicação (verificar destino)');
  return {created_id:'MLB99887766',description_status:'copiada'};
 }
 throw Error('Unrecognized '+route);
};
window.mlshCloneBatch.init({api});
(async()=>{
 await node('mlbtClonePreview').onclick();
 assert.equal(calls.length,3,'duplicate MLB must be removed');
 assert.ok(calls.every(x=>x.route.endsWith('/preview')),'preview never publishes');
 assert.equal(root.isConnected,true);
 assert.equal(node('mlbtCloneConsentWrap').hidden,false);
 assert.equal(node('mlbtCloneApply').disabled,true);
 assert.equal(list.children.length,3,'two eligible previews, one skipped');
 node('mlbtCloneConsent').checked=true;
 listeners.get('mlbtCloneConsent:change')();
 assert.equal(node('mlbtCloneApply').disabled,false);
 await node('mlbtCloneApply').onclick();
 const applied=calls.filter(x=>x.route.endsWith('/apply'));
 assert.equal(applied.length,2,'only eligible selected get one apply attempt');
 assert.equal(applied[0].body.confirm,true);
 assert.equal(applied[0].body.expected_catalog_product_id,'MLB987654','catalog product ID from preview must be repeated at confirmation');
 assert.equal(applied[1].body.confirm,true);
 assert.equal(applied[1].body.expected_catalog_product_id,null,'regular item must not pretend to belong to catalog');
 assert.equal(node('mlbtCloneApply').hidden,true,'batch cannot be repeated blindly');
 assert.match(node('mlbtCloneStatus').textContent,/1 anúncio\(s\) criado\(s\), 1 falha\(s\)/);
 assert.match(node('mlbtCloneStatus').textContent,/verifique/i);
 console.log('PASS: deduplicated 20-max batch, preview, consent, individual results, no automatic retries');
})().catch(e=>{console.error(e);process.exitCode=1});
