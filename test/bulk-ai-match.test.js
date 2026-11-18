'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'../portal/bulk-editor.js'),'utf8');
const body=src.slice(src.indexOf('function productSpecs('),src.indexOf('function conditionConflict('));
const matching=vm.runInNewContext(body+'; ({productSpecs,matchingTableItems})');
const samples=[
 {configuration:'16GB RAM / SSD SATA 240GB SATA 256GB M2',prices:[3320]},
 {configuration:'16GB RAM / SSD SATA 480GB',prices:[3630]},
 {configuration:'16GB RAM / SSD 512GB M2',prices:[3630]},
 {configuration:'16GB RAM / SSD 1000GB M2 (1TB)',prices:[4110]},
 {configuration:'8GB RAM / SSD SATA 480GB',prices:[3310]}
];
const cases=[
 ['Notebook Lenovo Thinkpad T14 G1 Core I7 10a 16gb 256gb Ssd',null],
 ['Notebook Lenovo Thinkpad T14 G1 Core I7 10a 16gb 512gb Ssd',3630],
 ['Notebook Thinkpad T14 I7-10610u 16gb 256gb Fhd 14 W11',null],
 ['Notebook Thinkpad T14 I7-10610u 16gb 256gb SSD FHD 14 W11',null],
 ['Notebook Lenovo Thinkpad T14 G1 Core I7 10a 16gb 1tb Ssd',4110]
];
for(const [title,price] of cases){
 const matches=matching.matchingTableItems({title,sku:''},samples);
 const found=matches.length===1?matches[0].prices[0]:null;
 assert.equal(found,price,'Falha: '+title+' -> '+found);
}
assert.equal(matching.matchingTableItems({title:'Notebook 16GB 512GB SSD',sku:''},
 [...samples,{configuration:'16GB RAM / SSD SATA 512GB',prices:[3500]}]).length,2);
console.log('PASS: cinco titulos testados; configuracoes multiplo-SSD nao sao tratadas como SSD unico');
