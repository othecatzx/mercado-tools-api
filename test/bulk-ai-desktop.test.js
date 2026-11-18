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
console.log('PASS: cinco configuracoes desktop, armazenamento multiplo e prints recortados sem selecao de monitor');
