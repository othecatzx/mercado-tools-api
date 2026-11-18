'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../portal/bulk-editor.js'),'utf8');
const segment=src.slice(src.indexOf('function desktopSpecs('),src.indexOf('function conditionConflict('));
const {desktopSpecs,desktopMatches}=vm.runInNewContext(segment+';({desktopSpecs,desktopMatches})');
const entries=[
 {configuration:'8GB RAM / SSD SATA 480GB',prices:[2309]},
 {configuration:'16GB RAM / SSD SATA 480GB',prices:[2489]},
 {configuration:'16GB RAM / SSD 1000GB M2',prices:[3159]},
 {configuration:'8GB RAM / SSD SATA 240GB SATA 256GB M2 / 1TB HDD',prices:[2549]}
];
function matched(title){return desktopMatches({title,sku:''},entries).map(x=>x.prices[0])}
assert.deepEqual(Array.from(matched('Mini Desktop Cpu Lenovo M70q I3 10a 480gb 16gb Bivolt')),[2489]);
assert.deepEqual(Array.from(matched('Mini Desktop Lenovo M70q 8gb 480gb Win 10')),[2309]);
assert.deepEqual(Array.from(matched('Mini Desktop Lenovo M70q 16gb 1tb SSD')),[3159]);
assert.deepEqual(Array.from(matched('Mini Desktop Lenovo M70q 16gb 240gb Win 10')),[]);
assert.deepEqual(Array.from(matched('Mini Desktop Lenovo M70q 8gb 1tb HD')),[]);
assert.deepEqual(Array.from(matched('Mini Desktop Lenovo M70q 8gb 240gb Win 10')),[]);
console.log('PASS desktop: titulos abreviados e configuracoes incompletas bloqueadas');
