'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const js=fs.readFileSync(path.resolve(__dirname,'../portal/bulk-clone-batch.js'),'utf8');
const nodes=new Map(),listeners=new Map();
function node(id){
 if(!nodes.has(id))nodes.set(id,{
  id,value:'',textContent:'',dataset:{},hidden:false,disabled:false,checked:false,children:[],
  classList:{remove(){}},
  append(...kids){this.children.push(...kids)},
  prepend(...kids){this.children.unshift(...kids)},
  replaceChildren(){this.children=[]},
  addEventListener(name,handler){listeners.set(id+':'+name,handler)},
  querySelector(sel){if(sel==='.mlbtBatchSelected')return this.children.find(x=>x.className==='mlbtBatchSelected')||null;
   if(sel==='.mlbt-result-copy')return this.children.find(x=>x.className==='mlbt-result-copy')||null;
   return null}
 });
 return nodes.get(id);
}
node('mlbtSource').value='100';node('mlbtTarget').value='200';
node('mlbtStock').value='1';node('mlbtItem').value='MLB4797008543';
const list=node('mlbtCloneList');
list.querySelectorAll=sel=>{
 assert.equal(sel,'.mlbtBatchSelected:checked');
 return list.children.flatMap(row=>row.children.filter(x=>x.className==='mlbtBatchSelected'&&x.checked));
};
const root={isConnected:true,querySelectorAll:sel=>list.querySelectorAll(sel)};
const requests=[],editorCalls=[];
const overrides={title:'Família exclusiva DAPHIE',price:2200.50,
 description_text:'Descrição exclusiva e personalizada',
 pictures:[{source:'https://example.com/custom.jpg'}]};
const api=async(path,options)=>{
 const req=JSON.parse(options.body);requests.push({path,req});
 if(path.endsWith('/preview')){
  if(!req.title)throw Error('family_name já existe');
  return {preview:{item_id:req.item_id,title:req.title,price:req.price,pictures:req.pictures.length,
   clone_type:'user_product',family_name:req.title,catalog_product_id:null,warning:'Validado'}};
 }
 if(path.endsWith('/apply')){
  assert.equal(req.title,overrides.title);
  assert.equal(req.expected_family_name,overrides.title);
  assert.equal(req.description_text,overrides.description_text);
  assert.equal(req.price,overrides.price);
  assert.equal(req.pictures.length,1);
  return {created_id:'MLB888888888',description_status:'personalizada'};
 }
 throw Error('unexpected path '+path);
};
const window={mlshCloneEditor:{open:async({item_id,previous,onSave})=>{
 editorCalls.push({item_id,previous});
 await onSave(overrides);
}}};
const doc={getElementById:node,querySelector:sel=>sel==='.mlsh-bulk-tools[data-tool="clone"]'?root:null,
 createElement:tag=>node('dynamic-'+(nodes.size)+'-'+tag)};
vm.runInNewContext(js,{document:doc,window});
window.mlshCloneBatch.init({api});
(async()=>{
 await node('mlbtClonePreview').onclick();
 assert.equal(list.children.length,1);
 assert.equal(node('mlbtCloneConsentWrap').hidden,true);
 const entry=list.children[0];
 assert.equal(entry.children.filter(x=>x.className==='mlbtBatchSelected').length,0,'invalid preview not eligible');
 const editButton=entry.children.find(x=>x.className==='mlbt-result-edit');
 await editButton.onclick();
 assert.equal(editorCalls.length,1);
 assert.equal(entry.children.filter(x=>x.className==='mlbtBatchSelected').length,1,'edited preview eligible');
 assert.equal(node('mlbtCloneConsentWrap').hidden,false);
 assert.equal(node('mlbtCloneApply').disabled,true,'editing revokes old consent');
 node('mlbtCloneConsent').checked=true;listeners.get('mlbtCloneConsent:change')();
 await node('mlbtCloneApply').onclick();
 const applied=requests.filter(x=>x.path.endsWith('/apply'));
 assert.equal(applied.length,1);
 assert.equal(node('mlbtCloneApply').hidden,true);
 console.log('PASS: blocked preview -> per-MLB edit -> revalidation -> fresh consent -> customized publication');
})().catch(error=>{console.error(error);process.exitCode=1});
