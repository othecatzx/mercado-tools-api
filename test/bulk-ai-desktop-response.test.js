'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../portal.routes.js'),'utf8');
const start=src.indexOf('  function parseDesktopVisionPayload(payload){');
const end=src.indexOf('  const bulkVisionUsage = new Map();',start);
assert.ok(start>=0&&end>start);
const parse=vm.runInNewContext(src.slice(start,end)+';parseDesktopVisionPayload');
const data={columns:['MOSTRUARIO'],items:[{configuration:'8GB RAM / SSD SATA 480GB',prices:[2309]}]};
const raw=JSON.stringify(data);
const variants=[
 {result:{response:raw}},
 {result:raw},
 {result:{text:'```json\n'+raw+'\n```'}},
 {result:{output:'Texto introdutorio:\n'+raw+'\nfim.'}},
 {result:{generated_text:raw}},
 {result:{message:{content:raw}}},
 {result:{choices:[{message:{content:raw}}]}},
 {result:data},
 {response:raw}
];
for(const variant of variants){
 const parsed=parse(variant);
 assert.equal(parsed?.items?.[0]?.prices?.[0],2309);
}
assert.equal(parse({result:{response:'Nao consegui ler a tabela'}}),null);
assert.equal(parse({result:{response:'{"items":[{"configuration":"8GB"'}}),null);
console.log('PASS: '+variants.length+' formatos validos da resposta de desktop e rejeicao segura de texto incompleto');
