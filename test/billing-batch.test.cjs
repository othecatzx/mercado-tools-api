const test=require('node:test'),assert=require('node:assert/strict');
const register=require('../billing-batch.routes');
const owner='owner',ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const quote={product:'ML SH Support',version:1,period:1,period_price:100,target_date:'2026-12-30',reference_days:30,items:[{license_id:ids[0],company_name:'Empresa com nome maior do que trinta caracteres',amount:100},{license_id:ids[1],company_name:'B',amount:150}],total:250};
function res(){return {code:200,set(){return this},status(c){this.code=c;return this},json(b){this.body=b;return this}};}
function fixture({signedOwner=owner,changed=false,available=true,environment='production',pixActive=true}={}){
 const routes=new Map(),provider=[],rpcs=[],writes=[];let signed;
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
 const admin=()=>{},auth=()=>{};
 const db={from(table){const q={select(){return q},eq(){return q},update(patch){writes.push({table,patch});return q},maybeSingle:async()=>({data:null,error:null}),then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q;},rpc:async(name,args)=>{rpcs.push({name,args});return {data:name==='mlsh_batch_quote'?quote:name==='mlsh_reserve_batch'?{created:true,batch:{id:'batch',quote:changed?{...quote,total:300}:quote,target_date:quote.target_date}}:null,error:null}}};
 register({get(p,...h){routes.set(p,h)},post(p,...h){routes.set(p,h)},put(p,...h){routes.set(p,h)}},{supabase:db,jwt:{sign(claims){signed=claims;return 'signed-quote'},verify(){return {...signed,owner:signedOwner}}},env:{JWT_SECRET:'secret',ASAAS_API_KEY:'key'},mode:environment,authOwner:auth,verificarAdmin:admin,safe:fn=>async(req,response)=>{try{await fn(req,response)}catch(e){response.status(e.status||503).json({ok:false,message:e.message})}},fail,provider:async(path,options)=>{if(path.startsWith('/pix/addressKeys'))return {data:pixActive?[{status:'ACTIVE'}]:[]};provider.push({path,body:JSON.parse(options.body)});return {id:'checkout_batch'}},runtime:async()=>({enabled:available,webhook_token_hash:'hash'}),authHash:c=>c?.webhook_token_hash,checkoutLimiter:()=>{}});
 return {routes,provider,rpcs,writes,admin,auth};
}
async function requestQuote(f){const response=res();await f.routes.get('/api/portal/billing/quote').at(-1)({billingUser:{id:owner},body:{license_ids:ids,period:1}},response);assert.equal(response.code,200);return response;}
test('Cotação considera apenas licenças do titular e assina o total calculado pelo servidor',async()=>{
 const f=fixture(),r=await requestQuote(f);assert.equal(r.body.quote.total,250);assert.equal(r.body.quote_token,'signed-quote');assert.equal(f.rpcs[0].args.p_owner,owner);assert.deepEqual(f.rpcs[0].args.p_ids,ids);
});
test('Um único checkout recebe os itens de todas as empresas, ignorando preço do cliente',async()=>{
 const f=fixture();await requestQuote(f);const r=res();await f.routes.get('/api/portal/billing/checkout').at(-1)({billingUser:{id:owner},body:{request_key:'33333333-3333-4333-8333-333333333333',quote_token:'signed-quote',total:0.01}},r);
 assert.equal(r.code,200);assert.equal(f.provider.length,1);assert.deepEqual(f.provider[0].body.chargeTypes,['DETACHED']);assert.deepEqual(f.provider[0].body.billingTypes,['PIX','CREDIT_CARD']);assert.equal(f.provider[0].body.items.length,2);assert(f.provider[0].body.items.every(i=>i.name.length<=30));assert.equal(f.provider[0].body.items.reduce((n,i)=>n+i.value,0),250);assert.equal(f.rpcs[1].args.p_owner,owner);
});
test('Mudança na cotação cancela a reserva antes de gerar pagamento',async()=>{
 const f=fixture({changed:true});await requestQuote(f);const r=res();await f.routes.get('/api/portal/billing/checkout').at(-1)({billingUser:{id:owner},body:{request_key:'33333333-3333-4333-8333-333333333333',quote_token:'signed-quote'}},r);assert.equal(r.code,409);assert.equal(f.provider.length,0);assert(f.rpcs.some(x=>x.name==='mlsh_close_unpaid_batch'));
});
test('Cotação de outro titular e ambiente de testes não criam cobranças',async()=>{
 const f=fixture({signedOwner:'other'});await requestQuote(f);let r=res();await f.routes.get('/api/portal/billing/checkout').at(-1)({billingUser:{id:owner},body:{request_key:'33333333-3333-4333-8333-333333333333',quote_token:'signed-quote'}},r);assert.equal(r.code,403);assert.equal(f.provider.length,0);
 const g=fixture({environment:'sandbox'});r=res();await g.routes.get('/api/portal/billing/checkout').at(-1)({billingUser:{id:owner},body:{}},r);assert.equal(r.code,503);assert.equal(g.provider.length,0);
});
test('Administração é protegida e não existe mais contratação avulsa pelo portal',async()=>{
 const f=fixture();assert.equal(f.routes.get('/api/admin/billing')[0],f.admin);assert.equal(f.routes.get('/api/admin/billing/product')[0],f.admin);assert.equal(f.routes.get('/api/admin/billing/availability')[0],f.admin);const r=res();await f.routes.get('/api/checkout').at(-1)({},r);assert.equal(r.code,410);
});

test('Janela abre no décimo quinto dia em São Paulo e aceita licença expirada',()=>{
 const w=register.renewalWindow,now=new Date('2026-11-13T15:00:00Z');
 assert.equal(w('2026-11-28T23:59:59-03:00',now).in_renewal_window,true);
 assert.deepEqual(w('2026-11-29T23:59:59-03:00',now),{renewal_opens_on:'2026-11-14',in_renewal_window:false});
 assert.equal(w('2026-11-12T23:59:59-03:00',now).in_renewal_window,true);
 assert.equal(w(null,now).in_renewal_window,false);
 assert.equal(w('2026-11-29T23:59:59-03:00',new Date('2026-11-14T02:59:59Z')).in_renewal_window,false);
 assert.equal(w('2026-11-29T23:59:59-03:00',new Date('2026-11-14T03:00:00Z')).in_renewal_window,true);
});
test('Sem chave Pix ativa, o checkout oferece cartão sem provocar rejeição do Asaas',async()=>{
 const f=fixture({pixActive:false});await requestQuote(f);const r=res();await f.routes.get('/api/portal/billing/checkout').at(-1)({billingUser:{id:owner},body:{request_key:'33333333-3333-4333-8333-333333333333',quote_token:'signed-quote'}},r);assert.equal(r.code,200);assert.deepEqual(f.provider[0].body.billingTypes,['CREDIT_CARD']);
});
