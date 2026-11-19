'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decodeMlMessageJson, isBrokenEncoding, shouldRepairMessageText } =
  require('../atendimento-encoding');

const message = { messages: [
  {id:'m1',text:'Sentimos muito pela situação. Ele é de exposição, conforme o anúncio.'},
  {id:'m2',text:'Câmera, carregador e verificação: ação concluída 👍'}
]};
const utf8 = Buffer.from(JSON.stringify(message),'utf8');
assert.deepEqual(decodeMlMessageJson(utf8),message,'valid UTF-8 must not change');

// Simula um servidor legado que envia JSON com bytes CP1252 sem indicar charset.
const cp1252 = Buffer.from(JSON.stringify({
  messages:[{id:'m3',text:'Sentimos muito pela situação. Você consegue testar com outro carregador?'}]
}),'latin1');
const legacy=decodeMlMessageJson(cp1252);
assert.equal(legacy.messages[0].text,'Sentimos muito pela situação. Você consegue testar com outro carregador?');
assert.equal(isBrokenEncoding('situa��o'),true);
assert.equal(isBrokenEncoding('situação'),false);
assert.equal(shouldRepairMessageText('situa��o','situação'),true);
assert.equal(shouldRepairMessageText('situa��o','situa��o'),false);
assert.equal(shouldRepairMessageText('situação','situaçao'),false,'never overwrite already good text');
assert.equal(shouldRepairMessageText('situa��o',null),false);
assert.throws(()=>decodeMlMessageJson(Buffer.from('{bad json','utf8')),SyntaxError);

const backend=fs.readFileSync(path.join(__dirname,'..','atendimento.routes.js'),'utf8');
assert.match(backend,/response\.arrayBuffer\(\)\.then\(decodeMlMessageJson\)/);
assert.match(backend,/shouldRepairMessageText\(stored\.text, fresh\)/);
assert.match(backend,/\.eq\('license_id', conversation\.license_id\)/);
assert.match(backend,/\.eq\('conversation_id', conversation\.id\)/);
assert.match(backend,/\.eq\('text', stored\.text\)/);
console.log('PASS: UTF-8, legacy CP1252, conservative re-fetch repair, scoped database update');
