'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../portal.routes.js'),'utf8');
const start=src.indexOf('  function chooseDesktopVisionColumn('),end=src.indexOf('  const bulkVisionUsage = new Map();',start);
assert.ok(start>=0&&end>start);
const choose=vm.runInNewContext(src.slice(start,end)+';chooseDesktopVisionColumn');
const cases=[
 [['MOSTRUÁRIO','COM MARCAS','ADICIONAL'],'mostruario',0],
 [['CONFIGURAÇÃO','MOSTRUÁRIO','COM MARCAS','ADICIONAL'],'mostruario',1],
 [['Mostruário'],'mostruario',0],
 [['MOSTRUARIO'],'mostruario',0],
 [['Preço'],'mostruario',0],
 [['VALOR'],'mostruario',0],
 [['PREÇO MOSTRUÁRIO'],'mostruario',0],
 [['COM MARCAS'],'mostruario',-1],
 [['ADICIONAL'],'mostruario',-1],
 [['PREÇO','ADICIONAL'],'mostruario',-1],
 [['MOSTRUÁRIO','COM MARCAS'],'com_marcas',1],
 [['MOSTRUÁRIO','COM MARCAS'],'caixa_aberta',-1]
];
for(const [columns,condition,wanted] of cases)assert.equal(choose(columns,condition),wanted,columns.join(',')+' '+condition);
console.log('PASS: '+cases.length+' cabecalhos de Desktop, sem confundir outras condicoes ou Adicional');
