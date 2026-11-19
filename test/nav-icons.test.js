'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'portal/index.html'),'utf8');
const code=fs.readFileSync(path.join(root,'portal/nav-icons.js'),'utf8');
const pages=[...html.matchAll(/<button class="nav-item[^"]*" data-page="([^"]+)"/g)].map(m=>m[1]);
const elements=pages.map(page=>{
 const target={dataset:{},innerHTML:''};
 return {dataset:{page},target,querySelector(){return target}};
});
const document={readyState:'complete',querySelectorAll:()=>elements};
vm.runInNewContext(code,{document});
assert.ok(pages.length>=20,'expected at least 20 menu entries');
for(const entry of elements){
 assert.match(entry.target.innerHTML,/<svg class="mlsh-nav-svg"/,entry.dataset.page);
 assert.equal(entry.target.dataset.mlshVector,'1');
}
assert.match(html,/nav-icons\.js\?v=/);
assert.match(html,/nav-icons\.css\?v=/);
console.log('PASS: '+pages.length+' sidebar entries get consistent vector icons');
