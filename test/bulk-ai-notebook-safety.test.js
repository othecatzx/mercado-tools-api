'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../portal/bulk-editor.js'),'utf8');
const code=src.slice(src.indexOf('function productSpecs('),src.indexOf('// Desktop:'));
const {productSpecs,matchingTableItems}=vm.runInNewContext(code+';({productSpecs,matchingTableItems})');
const cases=[
 ['Notebook Lenovo Thinkpad T14 G1 Core I7 10a 16gb 256gb Ssd','16GB RAM / SSD SATA 240GB SATA 256GB M2',true],
 ['Notebook Lenovo Thinkpad T14 G1 Core I7 10a 16gb 512gb Ssd','16GB RAM / SSD 512GB M2',true],
 ['Notebook 16gb 1tb SSD','16GB RAM / SSD 1000GB M2',true],
 ['Notebook 8gb 512gb SSD','16GB RAM / SSD 512GB M2',false],
 ['Notebook 16gb 512gb SSD','16GB RAM / SSD 960GB SATA',false],
 ['Notebook 16gb 256gb SSD','16GB RAM / SSD 256GB M2',true],
 ['Notebook 16gb 256gb SSD','16GB RAM / SSD 240GB 256GB M2',true],
 ['Notebook 16gb 240gb SSD 256gb SSD','16GB RAM / SSD 240GB SATA 256GB M2',false],
 ['Notebook 4gb 500gb HDD 120gb SSD','4GB RAM / HDD 500GB / SSD 120GB',false],
 ['Notebook 4gb 120gb SSD','4GB RAM / HDD 500GB / SSD 120GB',true],
 ['Notebook 16gb 1tb HD','16GB RAM / SSD 1TB',false],
 ['Notebook 16gb 512gb SSD','16GB RAM / SSD SATA 512GB',true],
 ['Notebook 16gb 512gb SSD','16GB RAM / SSD SATA 480GB',false],
 ['Notebook 32gb 256gb SSD','16GB RAM / SSD 256GB M2',false],
 ['Notebook 16gb 512gb SSD M2','16GB RAM / SSD SATA 512GB',false],
 ['Notebook 16gb 512gb SSD M2','16GB RAM / SSD 512GB M2',true],
 ['Notebook 16gb 512gb SSD','16GB RAM / SSD 512GB M2',true],
 ['Notebook 8gb 480gb SSD','8GB RAM / SSD SATA 480GB',true],
 ['Notebook 16gb 480gb SSD','16GB RAM / SSD SATA 480GB',true],
 ['Notebook 4gb 480gb SSD','4GB RAM / SSD SATA 480GB',true],
 ['Notebook 8gb 960gb SSD','8GB RAM / SSD SATA 960GB',true],
 ['Notebook 8gb 1tb SSD','8GB RAM / SSD 1000GB M2',true],
 ['Notebook 16gb 240gb SSD','16GB RAM / SSD 240GB 256GB M2',true],
];
for(const [title,configuration,wanted] of cases){
 const match=matchingTableItems({title,sku:''},[{configuration,prices:[3320]}]).length===1;
 assert.equal(match,wanted,title+' vs '+configuration);
}
assert.equal(productSpecs('Notebook 16gb 1tb'),null); // nao inferir tipo do armazenamento
const ambiguous=matchingTableItems({title:'Notebook 16gb 512gb SSD',sku:''},[
 {configuration:'16GB RAM / SSD SATA 512GB',prices:[3000]},
 {configuration:'16GB RAM / SSD 512GB M2',prices:[3300]}
]);
assert.equal(ambiguous.length,2);
console.log('PASS: '+cases.length+' casos de notebook, multiplos discos e variantes ambiguas');
