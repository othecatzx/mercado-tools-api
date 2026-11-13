// Manual integration test. Only api-sandbox.asaas.com is allowed; never enables Sandbox in production.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..'),root=path.resolve(repo,'..','..','ML_SH_Support_Backups');
const file=path.join(root,'billing-sandbox-test.json');
const raw=fs.readFileSync(path.join(repo,'.env'),'utf8');
const env=Object.fromEntries(raw.split(/\r?\n/).flatMap(l=>{const m=l.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/);return m?[[m[1],m[2].trim().replace(/^['"]|['"]$/g,'')]]:[]}));
if(env.ASAAS_API_URL!=='https://api-sandbox.asaas.com/v3'||!env.SUPABASE_URL.includes('mjtyrzmpnpumhbkfetsm.supabase.co'))throw Error('Expected isolated Sandbox credentials');
const {createClient}=require(path.join(process.env.LOCALAPPDATA,'npm-cache','_npx','4b4c857f6efdfb61','node_modules','@supabase','supabase-js'));
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const assert=(x,msg)=>{if(!x)throw Error(msg)};
const checked=async q=>{const r=await q;if(r.error)throw r.error;return r.data};
const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const checkpoint=m=>{fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file,JSON.stringify(m,null,2));};
async function provider(route,options={}){assert(route.startsWith('/'),'Invalid Sandbox route');const r=await fetch(env.ASAAS_API_URL+route,{...options,signal:AbortSignal.timeout(20000),headers:{access_token:env.ASAAS_API_KEY,'Content-Type':'application/json','User-Agent':'MLSHSupport-Sandbox-Test/1.0'}});const d=await r.json();if(!r.ok)throw Error('Sandbox '+r.status+' '+JSON.stringify(d.errors));return d;}
async function prepare(){
 assert(!fs.existsSync(file),'A test already exists; use verify or inspect the existing manifest');
 const m={marker:'SANDBOX_TEST_'+crypto.randomUUID(),created_at:new Date().toISOString(),environment:'sandbox'};checkpoint(m);
 const u=await checked(db.from('portal_users').insert({nome:m.marker,email:crypto.randomUUID()+'@example.invalid',senha_hash:'disabled-sandbox-test-account',status:'active'}).select('id').single());m.owner=u.id;checkpoint(m);
 m.license_ids=[];m.company_ids=[];
 for(const days of [5,15]){const c=await checked(db.from('companies').insert({nome:m.marker+' '+days,status:'active'}).select('id').single());m.company_ids.push(c.id);checkpoint(m);const expires=new Date(day(new Date())+'T12:00:00-03:00');expires.setUTCDate(expires.getUTCDate()+days);const l=await checked(db.from('licenses').insert({company_id:c.id,chave:m.marker+'-'+days,vencimento:expires.toISOString(),status:'active'}).select('id').single());m.license_ids.push(l.id);checkpoint(m);await checked(db.from('portal_user_licenses').insert({user_id:m.owner,license_id:l.id}));}
 const reserved=await checked(db.rpc('mlsh_reserve_batch',{p_owner:m.owner,p_ids:m.license_ids,p_period:1,p_key:crypto.randomUUID(),p_environment:'sandbox'}));m.batch=reserved.batch;checkpoint(m);
 const checkout=await provider('/checkouts',{method:'POST',body:JSON.stringify({billingTypes:['CREDIT_CARD'],chargeTypes:['DETACHED'],minutesToExpire:120,externalReference:'mlsh_batch_'+m.batch.id,callback:{successUrl:'https://app.caickrigato.com.br/api/billing/status',cancelUrl:'https://app.caickrigato.com.br/api/billing/status',expiredUrl:'https://app.caickrigato.com.br/api/billing/status'},items:m.batch.quote.items.map((i,n)=>({name:'TESTE Sandbox Empresa '+(n+1),description:'Teste sem valor real. Renovacao ate '+m.batch.target_date,quantity:1,value:Number(i.amount)}))})});
 assert(checkout.id,'No Sandbox checkout id');m.checkout_id=checkout.id;m.url='https://sandbox.asaas.com/checkoutSession/show?id='+encodeURIComponent(checkout.id);checkpoint(m);
 await checked(db.from('billing_batches').update({asaas_checkout_id:checkout.id,checkout_url:m.url}).eq('id',m.batch.id));
 console.log(JSON.stringify({sandbox:true,url:m.url,total:m.batch.expected_total,licenses:m.license_ids.length,target_date:m.batch.target_date,manifest:file}));
}
async function verify(){
 const m=JSON.parse(fs.readFileSync(file,'utf8'));assert(m.environment==='sandbox'&&m.marker.startsWith('SANDBOX_TEST_'),'Not a Sandbox manifest');
 const list=await provider('/payments?checkoutSession='+encodeURIComponent(m.checkout_id)+'&limit=100');assert(!list.hasMore,'Unexpected pagination');
 const payment=list.data?.find(p=>['CONFIRMED','RECEIVED'].includes(p.status));assert(payment,'Sandbox payment not confirmed yet');assert(payment.checkoutSession===m.checkout_id,'Payment is not from this test checkout');
 const token=crypto.randomBytes(40).toString('base64url'),routes=new Map();
 require(path.join(repo,'billing.routes.js'))({get(p,...h){routes.set(p,h)},post(p,...h){routes.set(p,h)},put(p,...h){routes.set(p,h)}},{supabase:db,jwt:{},verificarAdmin(){},env:{...env,ASAAS_WEBHOOK_TOKEN:token},rateLimiter:()=>()=>{}});
 const before=await checked(db.from('licenses').select('id,vencimento').in('id',m.license_ids));
 async function deliver(id){let code=200,body;const res={headersSent:false,set(){return this},status(c){code=c;return this},json(v){body=v;return this}};await routes.get('/api/webhooks/asaas').at(-1)({headers:{'asaas-access-token':token},body:{id,event:'PAYMENT_CONFIRMED',payment:{id:payment.id,value:0.01,status:'PENDING'}}},res);assert(code===200&&body?.ok,'Webhook processing failed');}
 const event='evt_sbtest_'+crypto.randomUUID();await deliver(event);
 const after=await checked(db.from('licenses').select('id,vencimento').in('id',m.license_ids));
 assert(after.length===m.license_ids.length&&after.every(l=>day(new Date(l.vencimento))===m.batch.target_date),'Expiration did not align');
 if(!m.verified)assert(before.some(l=>l.vencimento!==after.find(a=>a.id===l.id).vencimento),'No renewal applied');
 await deliver(event);await deliver(event+'_duplicate');
 const last=await checked(db.from('licenses').select('id,vencimento').in('id',m.license_ids));assert(last.every(l=>l.vencimento===after.find(a=>a.id===l.id).vencimento),'Duplicate webhook extended expiry');
 const payments=await checked(db.from('payments').select('asaas_payment_id').eq('batch_id',m.batch.id));assert(payments.length===1,'Payment applied more than once');
 const prod=await(await fetch('https://app.caickrigato.com.br/api/billing/status')).json();assert(prod.environment==='production'&&prod.purchases_enabled,'Production settings changed');
 m.verified={at:new Date().toISOString(),payment_id:payment.id,aligned:true,duplicate_safe:true,verified_provider_amount:true,production_unchanged:true,webhook_delivery:'Local replay through real handler; official Sandbox payment fetched by handler'};checkpoint(m);
 await checked(db.from('licenses').update({status:'blocked'}).in('id',m.license_ids));await checked(db.from('companies').update({status:'inactive'}).in('id',m.company_ids));await checked(db.from('portal_users').update({status:'blocked',access_revoked:true}).eq('id',m.owner));
 console.log(JSON.stringify({sandbox:true,...m.verified,test_records_deactivated:true}));
}
(async()=>{if(process.argv[2]==='prepare')await prepare();else if(process.argv[2]==='verify')await verify();else throw Error('Use prepare or verify');})().catch(e=>{console.error(e.message||e.code||e.name);process.exitCode=1});
