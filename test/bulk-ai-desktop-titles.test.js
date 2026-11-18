'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../portal/bulk-editor.js'),'utf8');
const segment=src.slice(src.indexOf('function desktopSpecs('),src.indexOf('function conditionConflict('));
const {desktopSpecs,desktopMatches}=vm.runInNewContext(segment+';({desktopSpecs,desktopMatches})');
const entries=[
 {configuration:'RAM 8GB / SSD 240GB SATA 256GB M2/ 1TB HDD (500hdd)',parsedPrice:2049},
 {configuration:'8GB RAM / SSD SATA 480GB',parsedPrice:2309},
 {configuration:'8GB RAM / SSD SATA 960GB',parsedPrice:2919},
 {configuration:'16GB RAM / SSD SATA 240GB SATA 256GB M2',parsedPrice:2229},
 {configuration:'16GB RAM / SSD SATA 480GB',parsedPrice:2489},
 {configuration:'16GB RAM / SSD 1000GB M2',parsedPrice:3159}
];
const examples=[
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 240gb 16gb Win 11 Bivolt',2229],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 480gb 16gb Win 11 Bivolt',2489],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 1tb Ssd 16gb Win 11 127/220v',3159],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 1tb Ssd 16gb Bivolt',3159],
 ['Mini Desktop Lenovo Tiny M70q Core I3 10a 240gb 16gb Win10 Bivolt',2229],
 ['Mini Desktop Lenovo Tiny M70q Core I3 10a 240gb 8gb Win10 Bivolt',2049],
 ['Mini Desktop Lenovo Tiny M70q Core I3 10ª 240gb 8gb Win 10 Bivolt',2049],
 ['Mini Desktop Lenovo Tiny M70q Core I3 10ª 1tb Hd 8gb Win 10 Bivolt',2049],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 480gb 16gb Win 11 Bivolt',2489],
 ['Mini Desktop Cpu Desk Lenovo M70q Core I3 10a 1tb 8gb Bivolt',null],
 ['Mini Desktop Lenovo Tiny M70q Core I3 10a 1tb 8gb Win 10 Bivolt',null],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 240gb 8gb Win10 Bivolt',2049]
];
for(const [title,price] of examples){
 const hits=desktopMatches({title,sku:'4SM70Qi310a_'},entries);
 const actual=hits.length===1?hits[0].parsedPrice:null;
 assert.equal(actual,price,title+' -> '+actual+' expected '+price);
}
const same=[
 {configuration:'8GB RAM / SSD SATA 480GB',parsedPrice:2309},
 {configuration:'RAM 8GB / SSD SATA 480GB',parsedPrice:2309}
];
assert.equal(desktopMatches({title:'Mini Desktop 480gb 8gb',sku:''},same).length,1);
same[1].parsedPrice=2319;
assert.equal(desktopMatches({title:'Mini Desktop 480gb 8gb',sku:''},same).length,2);
assert.equal(desktopMatches({title:'Mini Desktop 8gb 1tb SSD',sku:''},entries).length,0);
assert.equal(desktopMatches({title:'Mini Desktop 8gb 240gb SSD 1tb HDD',sku:''},entries).length,0);
console.log('PASS: '+examples.length+' desktops reais, alternativas de armazenamento e duplicatas');
