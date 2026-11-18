'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync(require('node:path').join(__dirname,'../portal/bulk-editor.js'),'utf8');
const code=src.slice(src.indexOf('function desktopSpecs('),src.indexOf('function conditionConflict('));
const {desktopSpecs,desktopCompatible}=vm.runInNewContext(code+';({desktopSpecs,desktopCompatible})');
const table=[
 ['RAM 8GB / SSD 240GB SATA 256GB M2/ 1TB HDD (500hdd)',2549],
 ['8GB RAM / SSD SATA 480GB',2809],
 ['16GB RAM / SSD SATA 240GB SATA 256GB M2',2729],
 ['16GB RAM / SSD SATA 480GB',2989],
 ['4GB RAM / HDD 500GB /SSD 120GB',2284]
];
for(const [configuration,price] of table){
 const s=desktopSpecs(configuration);assert.ok(s,'Nao extraiu configuracao: '+configuration);
 assert.equal(desktopCompatible(configuration,configuration),true,'Autoassociacao falhou: '+configuration);
}
assert.ok(desktopCompatible('Desktop 16GB RAM SSD SATA 240GB SSD M2 256GB','16GB RAM / SSD SATA 240GB SATA 256GB M2'));
assert.ok(!desktopCompatible('Desktop 8GB RAM SSD SATA 480GB','16GB RAM / SSD SATA 480GB'));
assert.ok(!desktopCompatible('Desktop 8GB RAM SSD SATA 480GB','8GB RAM / SSD SATA 960GB'));
assert.ok(!desktopCompatible('Desktop 4GB RAM SSD 120GB','4GB RAM / HDD 500GB /SSD 120GB'));
assert.ok(desktopCompatible('Computador com monitor 8GB RAM SSD SATA 480GB','8GB RAM / SSD SATA 480GB'));
assert.ok(desktopCompatible('Computador sem monitor 8GB RAM SSD SATA 480GB','8GB RAM / SSD SATA 480GB'));
const actualTitles=[
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 240gb 16gb Win 11 Bivolt',null],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 480gb 16gb Win 11 Bivolt',2489],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 1tb Ssd 16gb Win 11 Bivolt',3159],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 1tb Hd 8gb Win 10 Bivolt',null],
 ['Mini Desktop Cpu Lenovo Tiny M70q I3 10a 240gb 8gb Win 10 Bivolt',null]
];
const croppedTable=[
 {configuration:'RAM 8GB / SSD 240GB SATA 256GB M2/ 1TB HDD (500hdd)',prices:[2049]},
 {configuration:'8GB RAM / SSD SATA 480GB',prices:[2309]},
 {configuration:'16GB RAM / SSD SATA 240GB SATA 256GB M2',prices:[2229]},
 {configuration:'16GB RAM / SSD SATA 480GB',prices:[2489]},
 {configuration:'16GB RAM / SSD 1000GB M2',prices:[3159]}
];
for(const [title,expected] of actualTitles){
 const hits=croppedTable.filter(x=>desktopCompatible(title,x.configuration));
 const actual=hits.length===1?hits[0].prices[0]:null;
 assert.equal(actual,expected,'Titulo real: '+title);
}
assert.ok(desktopCompatible('Mini Desktop Lenovo Tiny 480gb 16gb','16GB RAM / SSD SATA 480GB'));
assert.ok(desktopCompatible('Mini Desktop Lenovo Tiny 16gb 480gb','16GB RAM / SSD SATA 480GB'));
console.log('PASS: configuracoes e titulos reais do portal (inclui 240GB e 1TB HD sem correspondencia segura)');
