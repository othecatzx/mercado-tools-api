'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'..','portal','bulk-tools.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','portal','index.html'),'utf8');
assert.doesNotMatch(code,/id="mlbtLimit"|value\('mlbtLimit'\)/,'search limit selector must be removed');
assert.match(code,/scroll_id:scrollId/,'scan pagination should pass cursor');
assert.match(code,/response\.scanned\+=/,'scan should accumulate progress');
assert.match(code,/id="mlbtDimReport"/,'report must be present');
assert.match(code,/id="mlbtDimReportItems"/,'report must list per-item results');
assert.match(code,/for\(let i=0;i<item_ids\.length;i\+=5\)/,'apply should use short batches');
for(const kind of ['success','unchanged','pending','failed','unattempted'])
 assert.match(code,new RegExp('addEntries\\('+kind+','));
assert.match(html,/\/portal\/bulk-tools\.js\?v=20261119-[a-z0-9-]+/,'script caches should refresh');
console.log('PASS: no search cap, scrolling progress, short confirmation batches, per-item result report');
