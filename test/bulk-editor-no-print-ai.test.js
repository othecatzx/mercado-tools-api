'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'portal/bulk-editor.js'),'utf8');
const css=fs.readFileSync(path.join(root,'portal/bulk-editor.css'),'utf8');
const routes=fs.readFileSync(path.join(root,'portal.routes.js'),'utf8');
assert.doesNotMatch(js,/bulkScan|bulkAi|scanImage|autoFillScan|aiImported/);
assert.doesNotMatch(css,/bulk-scan|bulk-ai|bulkAi|bulkScan/);
assert.doesNotMatch(routes,/bulk-editor\/scan-image|bulkVisionUsage|parseDesktopVisionPayload/);
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,addEventListener(){},focus(){},classList:{toggle(){},add(){},remove(){}}});
 return elements.get(id);
}
const window={};
vm.runInNewContext(js,{window,pageHead:()=>'',document:{getElementById:element,body:{classList:{add(){},remove(){}}}},location:{origin:'https://example.com'},URL,console});
const markup=window.mlshBulkEditor.markup();
for(const id of ['bulkOpen','bulkClear','bulkExport','bulkImport','bulkImportFile','bulkApply'])assert.ok(markup.includes('id="'+id+'"'),id+' missing');
assert.doesNotMatch(markup,/Importar print com IA|bulkScan|bulkAi/);
window.mlshBulkEditor.init();
console.log('PASS: print AI removed; editor, Excel and bulk actions remain usable');
