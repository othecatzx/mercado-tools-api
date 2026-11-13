const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const billing=require('../billing.routes');
const token='test-only-token-that-is-longer-than-32-characters';
const env={ASAAS_API_URL:'https://api.asaas.com/v3',ASAAS_API_KEY:'test-key',JWT_SECRET:'test-secret'};
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function response(){return {code:200,headersSent:false,set(){return this},status(n){this.code=n;return this},json(body){this.body=body;this.headersSent=true;return this}};}
function fixture({status='received',rpcError=null,environment='production',enabled=false}={}){
 const routes=new Map(),calls=[],writes=[],rpcs=[];
 const db={from(table){let value;const q={select(){return q},eq(){return q},upsert(v){value=v;writes.push({table,value});return q},update(v){value=v;writes.push({table,value});return q},single(){if(table==='billing_webhook_events')return Promise.resolve({data:{status},error:null});return Promise.resolve({data:null,error:null})},maybeSingle(){return Promise.resolve({data:table==='billing_runtime'?{enabled,webhook_token_hash:sha(token)}:null,error:null})},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q;},rpc:async(name,args)=>{rpcs.push({name,args});return {data:{status:'processed'},error:rpcError}}};
 billing({post(p,...h){routes.set(p,h)},get(p,...h){routes.set(p,h)}},{supabase:db,jwt:{verify(){throw Object.assign(Error(),{name:'JsonWebTokenError'})}},verificarAdmin(){},env:{...env,ASAAS_API_URL:environment==='sandbox'?'https://api-sandbox.asaas.com/v3':env.ASAAS_API_URL},rateLimiter:()=>()=>{},fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({id:'pay_test',status:'RECEIVED',value:100,customer:'verified_customer',checkoutSession:'verified_checkout'})}}});
 return {routes,calls,writes,rpcs};
}
test('Aceita o JSON nativo e o formato legado, rejeitando eventos inválidos',()=>{
 const event={id:'evt_test',event:'PAYMENT_RECEIVED'};assert.deepEqual(billing.parseEvent(event),event);assert.deepEqual(billing.parseEvent({data:JSON.stringify(event)}),event);assert.throws(()=>billing.parseEvent({event:'invalid'}));
});
test('Segredo do webhook e destino da API são validados',()=>{
 assert(billing.equalToken(token,sha(token)));assert(!billing.equalToken('incorrect-token',sha(token)));assert.equal(billing.apiSettings({ASAAS_API_URL:'https://attacker.invalid/v3'}).base,null);assert.equal(billing.apiSettings({ASAAS_API_URL:'https://api-sandbox.asaas.com/v3/'}).environment,'sandbox');
});
test('Webhook sem token não grava eventos nem consulta o Asaas',async()=>{
 const f=fixture(),res=response();await f.routes.get('/api/webhooks/asaas').at(-1)({headers:{},body:{}},res);assert.equal(res.code,401);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
});
test('Confirmação consulta o provedor e não confia no valor ou cliente do payload',async()=>{
 const f=fixture(),res=response();await f.routes.get('/api/webhooks/asaas').at(-1)({headers:{'asaas-access-token':token},body:{id:'evt_test',event:'PAYMENT_RECEIVED',payment:{id:'pay_test',value:0.01,customer:'untrusted'}}},res);
 assert.equal(res.code,200);assert.equal(f.calls.length,1);assert.equal(f.rpcs[0].args.p_payment.value,100);assert.equal(f.rpcs[0].args.p_payment.customer,'verified_customer');assert.equal(f.calls[0].url,'https://api.asaas.com/v3/payments/pay_test');
});
test('Falha transacional responde erro para permitir reenvio do provedor',async()=>{
 const f=fixture({rpcError:{code:'database_failure'}}),res=response();await f.routes.get('/api/webhooks/asaas').at(-1)({headers:{'asaas-access-token':token},body:{id:'evt_test',event:'PAYMENT_RECEIVED',payment:{id:'pay_test'}}},res);assert.equal(res.code,503);assert.equal(res.body.ok,false);
});
test('Evento já processado não consulta novamente o provedor',async()=>{
 const f=fixture({status:'processed'}),res=response();await f.routes.get('/api/webhooks/asaas').at(-1)({headers:{'asaas-access-token':token},body:{id:'evt_test',event:'PAYMENT_RECEIVED',payment:{id:'pay_test'}}},res);assert.equal(res.code,200);assert.equal(f.calls.length,0);assert.equal(f.rpcs.length,0);
});
test('Compra exige autenticação; compras em Sandbox ou pausadas não geram checkout',async()=>{
 const f=fixture(),res=response();let next=false;await f.routes.get('/api/checkout')[0]({headers:{}},res,()=>next=true);assert.equal(res.code,401);assert.equal(next,false);
 for(const options of [{environment:'sandbox',enabled:true},{environment:'production',enabled:false}]){const g=fixture(options),r=response();await g.routes.get('/api/checkout').at(-1)({body:{},billingUser:{id:'owner'}},r);assert.equal(r.code,503);assert.equal(g.calls.length,0);assert.equal(g.writes.length,0);}
});
function checkoutFixture({saveError=false}={}){
 let session=null;const providerCalls=[],routes=new Map();
 const planId='11111111-1111-4111-8111-111111111111';
 const db={from(table){let patch=null;const q={select(){return q},eq(){return q},upsert(value){if(!session)session={...value};return q},update(value){patch=value;if(!saveError)session={...session,...value};return q},single:async()=>({data:session,error:null}),maybeSingle:async()=>({data:table==='billing_runtime'?{enabled:true,webhook_token_hash:sha(token)}:table==='plans'?{id:planId,nome:'Test',preco:100,duracao_dias:30,status:'active'}:null,error:null}),then(resolve){return Promise.resolve({error:saveError&&patch?{code:'save_failed'}:null}).then(resolve)}};return q;}};
 billing({post(p,...h){routes.set(p,h)},get(){}},{supabase:db,jwt:{},verificarAdmin(){},env,rateLimiter:()=>()=>{},fetchImpl:async(url,options)=>{providerCalls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({id:'checkout_test'})}}});
 return {providerCalls,routes,planId,getSession:()=>session};
}
test('Checkout usa preço do banco e titular autenticado; repetição não cria outra cobrança',async()=>{
 const f=checkoutFixture(),request={billingUser:{id:'owner',nome:'Owner',email:'qa@example.invalid'},body:{plan_id:f.planId,request_key:'22222222-2222-4222-8222-222222222222',company_name:'Empresa',price:1,portal_user_id:'attacker'}};
 let res=response();await f.routes.get('/api/checkout').at(-1)(request,res);assert.equal(res.code,200);assert.equal(f.getSession().portal_user_id,'owner');assert.equal(f.getSession().expected_value,100);assert.equal(f.providerCalls[0].body.items[0].value,100);assert.equal(f.providerCalls[0].body.customerData,undefined);assert(f.providerCalls[0].body.callback.successUrl.startsWith('https://app.caickrigato.com.br/portal/'));
 res=response();await f.routes.get('/api/checkout').at(-1)(request,res);assert.equal(res.code,200);assert.equal(f.providerCalls.length,1);
});
test('Falha ao salvar checkout não devolve sucesso; licença de outro titular é rejeitada',async()=>{
 const f=checkoutFixture({saveError:true}),body={plan_id:f.planId,request_key:'22222222-2222-4222-8222-222222222222',company_name:'Empresa'},res=response();await f.routes.get('/api/checkout').at(-1)({billingUser:{id:'owner',nome:'Owner',email:'qa@example.invalid'},body},res);assert.equal(res.code,503);assert.equal(res.body.ok,false);
 const g=checkoutFixture(),r=response();await g.routes.get('/api/checkout').at(-1)({billingUser:{id:'owner'},body:{...body,license_id:'33333333-3333-4333-8333-333333333333'}},r);assert.equal(r.code,400);assert.equal(g.providerCalls.length,0);
});
