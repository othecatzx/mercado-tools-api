const test=require('node:test'),assert=require('node:assert/strict');
const registerChat=require('../chat-operations');
const automations=require('../automations.routes');
function database(tables){
 const calls=[];
 return {calls,from(table){
  const query={table,filters:[],orders:[],offset:0,end:Infinity};calls.push(query);
  const q={select(){return q},eq(k,v){query.filters.push(r=>r[k]===v);return q},in(k,values){query.filters.push(r=>values.includes(r[k]));return q},order(k,{ascending=true}={}){query.orders.push([k,ascending]);return q},range(a,b){query.offset=a;query.end=b;return q},maybeSingle(){query.single=true;return q},then(resolve,reject){try{let data=(tables[table]||[]).filter(r=>query.filters.every(f=>f(r)));data.sort((a,b)=>{for(const [k,asc] of query.orders){if(a[k]!==b[k])return (a[k]>b[k]?1:-1)*(asc?1:-1)}return 0});data=data.slice(query.offset,query.end+1);return Promise.resolve({data:query.single?data[0]||null:data,error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q;
 }};
}
function response(){return {statusCode:200,headersSent:false,set(){return this},status(n){this.statusCode=n;return this},json(body){this.body=body;return this}};}
const license=(id,company,status='active')=>({id,status,company_id:company,companies:{nome:company,status:'active'}});
test('Atendimento conta cliente já lido, exclui encerradas/bloqueadas e respeita lojas do agente',async()=>{
 const conversations=[{id:'a',license_id:'l1',ml_status:'open',last_viewed_buyer_at:'2099-01-01'},{id:'b',license_id:'l1',ml_status:'open',assigned_agent_id:'agent'},{id:'c',license_id:'l1',closed_at:'2026-11-13'},{id:'d',license_id:'l1',ml_status:'blocked'},{id:'e',license_id:'l2',ml_status:'open'},{id:'x',license_id:'outsider',ml_status:'open'}];
 const messages=conversations.map(c=>({id:c.id,conversation_id:c.id,sender_role:c.id==='b'?'seller':'buyer',created_at:'2026-11-13'}));
 const db=database({support_agents:[{id:'agent',status:'active',license_id:'l1',created_by_portal_user_id:'owner',menu_permissions:['chat'],permissions:['conversations.view']}],portal_user_licenses:[{user_id:'owner',licenses:license('l1','A')},{user_id:'owner',licenses:license('l2','B')},{user_id:'owner',licenses:{...license('expired','C'),vencimento:'2000-01-01'}}],support_conversations:conversations,support_messages:messages});
 let handler;registerChat({get(path,...handlers){handler=handlers.at(-1)}},{supabase:db,authChat(){}});
 let res=response();await handler({actor:{type:'portal',id:'owner'}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.stores.length,2);assert.equal(res.body.stores[0].waiting,1);assert.equal(res.body.stores[0].unassigned,1);assert.equal(res.body.stores[0].open,2);
 res=response();await handler({actor:{type:'agent',id:'agent'}},res);assert.equal(res.body.stores.length,1);assert.equal(res.body.stores[0].license_id,'l1');
});
test('Remetente mais recente não fica limitado às primeiras 3000 mensagens',async()=>{
 const messages=Array.from({length:3500},(_,i)=>({id:String(i).padStart(4,'0'),conversation_id:'busy',sender_role:'seller',created_at:'2026-11-13'}));
 messages.push({id:'old',conversation_id:'quiet',sender_role:'buyer',created_at:'2026-11-12'});
 const db=database({support_messages:messages}),latest=await registerChat.latestMessages(db,['busy','quiet']);
 assert.equal(latest.get('quiet').sender_role,'buyer');assert.equal(db.calls.length,4);
});
test('Sem permissão de atendimento não consulta conversas',async()=>{
 const db=database({support_agents:[{id:'agent',status:'active',menu_permissions:['overview'],permissions:[]}]});let handler;
 registerChat({get(path,...handlers){handler=handlers.at(-1)}},{supabase:db,authChat(){}});
 const res=response();await handler({actor:{type:'agent',id:'agent'}},res);assert.equal(res.statusCode,403);assert.equal(db.calls.length,1);
});
test('Resumo fecha o dia anterior em São Paulo, incluindo viradas de mês/ano',()=>{
 assert.equal(automations.previousDay('2026-01-01T04:00:00Z'),'2025-12-31');
 assert.equal(automations.previousDay('2026-11-13T01:00:00Z'),'2026-11-11');
 assert.deepEqual(automations.reportRange('2026-11-12'),{from:'2026-11-12T03:00:00.000Z',to:'2026-11-13T02:59:59.999Z'});
});
test('Resumo não conta cancelamentos, não mistura datas e identifica consulta parcial',()=>{
 const result=automations.summarize({stores:[{company_id:'a',connected:true},{company_id:'b',connected:false}],orders:[{company_id:'a',status:'paid',date_created:'2026-11-12T03:00:00Z',total_amount:100,units:2},{company_id:'a',status:'cancelled',date_created:'2026-11-13T02:00:00Z',total_amount:500,units:3},{company_id:'a',status:'paid',date_created:'2026-11-13T03:00:00Z',total_amount:1000,units:10}]},'2026-11-12');
 assert.equal(result.revenue,100);assert.equal(result.orders,1);assert.equal(result.units,2);assert.equal(result.cancelled,1);assert.equal(result.partial,true);
 const cents=automations.summarize({stores:[],orders:[{status:'paid',date_created:'2026-11-12T12:00:00Z',total_amount:0.1},{status:'paid',date_created:'2026-11-12T12:00:00Z',total_amount:0.2}]},'2026-11-12');
 assert.equal(cents.revenue,0.3);
});
test('Agendador rejeita chamada sem autenticação e horários inválidos',async()=>{
 const routes=new Map();automations({post(p,...h){routes.set(p,h.at(-1))},get(){},put(p,...h){routes.set(p,h.at(-1))}},{supabase:{},authPortal(){},readSales(){throw Error('Should not execute')}});
 let res=response();await routes.get('/api/internal/automations/tick')({headers:{}},res);assert.equal(res.statusCode,401);
 res=response();await routes.get('/api/portal/automations/daily-sales')({body:{enabled:true,run_time:'25:00'}},res);assert.equal(res.statusCode,400);
});
test('Worker gera o resumo no servidor, isola o titular e salva usando a concessão da fila',async()=>{
 const updates=[];let claimed=false,ownerSeen;
 const run={id:'run',owner_id:'owner',report_day:'2026-11-12',attempts:1,lease_token:'lease'};
 const db={rpc:async()=>({data:claimed?[]:(claimed=true,[run])}),from(table){
  let patch,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle:async()=>({data:{id:'owner',status:'active',access_revoked:false}}),update(value){patch=value;return q},then(resolve){updates.push({table,patch,filters});return Promise.resolve({error:null}).then(resolve)}};return q;
 }};
 const worker=automations({post(){},get(){},put(){}},{supabase:db,authPortal(){},readSales:async(owner,range)=>{ownerSeen=owner;assert.equal(range.from,'2026-11-12T03:00:00.000Z');return {stores:[{company_id:'1',connected:true}],orders:[{company_id:'1',status:'paid',date_created:'2026-11-12T12:00:00Z',total_amount:25,units:1}]};}});
 await worker.work();assert.equal(ownerSeen,'owner');assert.equal(updates[0].patch.status,'completed');assert.equal(updates[0].patch.result.revenue,25);assert(updates[0].filters.some(([k,v])=>k==='lease_token'&&v==='lease'));
});
test('Worker não consulta Mercado Livre se o titular foi desativado e registra falha final',async()=>{
 let claimed=false,patch;
 const db={rpc:async()=>({data:claimed?[]:(claimed=true,[{id:'run',owner_id:'revoked',report_day:'2026-11-12',attempts:3,lease_token:'lease'}])}),from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{status:'inactive'}}),update(value){patch=value;return q},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q;}};
 const worker=automations({post(){},get(){},put(){}},{supabase:db,authPortal(){},readSales(){throw Error('Não deve executar');}});
 await worker.work();assert.equal(patch.status,'failed');assert.equal(patch.result,undefined);assert(!patch.error.includes('revoked'));
});
