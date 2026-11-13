const crypto=require('node:crypto');
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const ID=/^[a-zA-Z0-9_&-]{1,160}$/;
const digest=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const equalToken=(value,hash)=>typeof value==='string'&&value.length>=32&&value.length<=255&&typeof hash==='string'&&hash.length===64&&crypto.timingSafeEqual(Buffer.from(digest(value)),Buffer.from(hash));
function parseEvent(body){
 let event=body;
 if(typeof body?.data==='string')event=JSON.parse(body.data);
 if(!event||typeof event!=='object'||!ID.test(event.id||'')||!/^[A-Z_]{3,80}$/.test(event.event||''))throw Error('invalid_event');
 return event;
}
function apiSettings(env){
 const base=String(env.ASAAS_API_URL||'').replace(/\/$/,'');
 if(!['https://api-sandbox.asaas.com/v3','https://api.asaas.com/v3','https://www.asaas.com/api/v3'].includes(base))return {environment:'unconfigured',base:null};
 return {base,environment:base.includes('sandbox')?'sandbox':'production'};
}
module.exports=function registerBilling(app,{supabase,jwt,verificarAdmin,env=process.env,fetchImpl=fetch,rateLimiter}){
 const settings=apiSettings(env),mode=settings.environment;
 const safe=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){console.error('Billing:',e.code||e.name||'error');if(!res.headersSent)res.status(e.httpStatus||503).json({ok:false,message:e.publicMessage||'O pagamento não pôde ser processado agora. Tente novamente ou entre em contato com o suporte.'});}};
 const fail=(message,status=400)=>{const e=new Error('billing_validation');e.publicMessage=message;e.httpStatus=status;throw e;};
 async function authOwner(req,res,next){
  try{
   const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];if(!bearer)return res.status(401).json({ok:false,error:'auth_required',message:'Entre na sua conta para continuar.'});
   const decoded=jwt.verify(bearer,env.JWT_SECRET);
   if(decoded.type!=='portal'||!decoded.portal_user_id)return res.status(403).json({ok:false,error:'permission_denied',message:'Somente o titular gerencia pagamentos.'});
   const {data:user,error}=await supabase.from('portal_users').select('id,nome,email,status,access_revoked,session_version').eq('id',decoded.portal_user_id).maybeSingle();if(error)throw error;
   if(!user||user.status!=='active'||user.access_revoked||Number(user.session_version||0)!==Number(decoded.session_version||0))return res.status(401).json({ok:false,error:'invalid_session'});
   req.billingUser=user;next();
  }catch(e){if(['JsonWebTokenError','TokenExpiredError'].includes(e.name))return res.status(401).json({ok:false,error:'invalid_session'});return res.status(503).json({ok:false,message:'Não foi possível validar a conta.'});}
 }
 async function runtime(){
  if(mode==='unconfigured')return null;
  const {data,error}=await supabase.from('billing_runtime').select('environment,enabled,webhook_token_hash').eq('environment',mode).maybeSingle();if(error)throw error;return data;
 }
 const authHash=config=>env.ASAAS_WEBHOOK_TOKEN?digest(env.ASAAS_WEBHOOK_TOKEN):config?.webhook_token_hash;
 async function provider(path,options={}){
  if(!settings.base||!env.ASAAS_API_KEY)fail('Integração de pagamento não configurada.',503);
  const response=await fetchImpl(settings.base+path,{...options,signal:AbortSignal.timeout(8000),headers:{access_token:env.ASAAS_API_KEY,'Content-Type':'application/json',...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));if(!response.ok){const e=new Error('provider_error');e.httpStatus=503;e.providerStatus=response.status;throw e;}return data;
 }
 async function persistEvent(event,paymentId=null,suffix=''){
  const id=mode+':'+event.id+suffix;
  const {error}=await supabase.from('billing_webhook_events').upsert({id,environment:mode,event:event.event,payment_id:paymentId,resource_id:event.checkout?.id||null},{onConflict:'id',ignoreDuplicates:true});if(error)throw error;
  return id;
 }
 async function applyPayment(event,paymentId,suffix=''){
  if(!ID.test(paymentId||''))fail('Identificador da cobrança inválido.');
  const id=await persistEvent(event,paymentId,suffix);
  const {data:existing,error:lookupError}=await supabase.from('billing_webhook_events').select('status').eq('id',id).single();if(lookupError)throw lookupError;
  if(['processed','ignored','review'].includes(existing.status))return;
  const payment=await provider('/payments/'+encodeURIComponent(paymentId));
  if(payment.id!==paymentId)throw Error('provider_identity_mismatch');
  // Apenas os campos necessários atravessam a transação; dados de cartão e cliente não são persistidos no evento.
  const verified=Object.fromEntries(['id','status','value','customer','subscription','checkoutSession','externalReference','billingType'].map(k=>[k,payment[k]??null]));
  const {error}=await supabase.rpc('mlsh_apply_verified_payment',{p_event_id:id,p_environment:mode,p_payment:verified});if(error)throw error;
 }
 const checkout=safe(async(req,res)=>{
  const config=await runtime();
  if(!config?.enabled||!authHash(config)||!env.ASAAS_API_KEY)fail('Novas compras estão temporariamente indisponíveis. Entre em contato com o suporte.',503);
  // Não vender uma licença real com pagamento fictício de Sandbox.
  if(mode!=='production')fail('O pagamento está em ambiente de testes. Compras de clientes ainda não foram liberadas.',503);
  const b=req.body||{},user=req.billingUser;
  if(!UUID.test(b.plan_id||'')||!UUID.test(b.request_key||''))fail('Escolha um plano e tente novamente.');
  const text=(value,max=150)=>String(value||'').trim().slice(0,max);
  const {data:plan,error:planError}=await supabase.from('plans').select('id,nome,descricao,preco,duracao_dias,status').eq('id',b.plan_id).eq('status','active').maybeSingle();if(planError)throw planError;
  if(!plan||!Number.isFinite(Number(plan.preco))||Number(plan.preco)<=0)fail('Plano indisponível.');
  let license=null,companyName=text(b.company_name);
  if(b.license_id){
   if(!UUID.test(b.license_id))fail('Licença inválida.');
   const {data:link,error}=await supabase.from('portal_user_licenses').select('licenses(id,company_id,plan_id,status,vencimento,asaas_subscription_id,companies(nome,status))').eq('user_id',user.id).eq('license_id',b.license_id).maybeSingle();if(error)throw error;
   license=link?.licenses;
   if(!license||license.status==='blocked'||license.companies?.status!=='active'||!license.vencimento)fail('Essa licença não está disponível para renovação.');
   if(license.asaas_subscription_id)fail('Esta licença já possui assinatura. Consulte o suporte para alterar a cobrança.');
   if(license.plan_id&&license.plan_id!==plan.id)fail('A troca de plano deve ser feita pelo suporte.');
   companyName=license.companies.nome;
  }else if(companyName.length<2)fail('Informe o nome da empresa.');
  const id=crypto.randomUUID();
  const {error:insertError}=await supabase.from('checkout_sessions').upsert({id,checkout_id:'pending_'+id,portal_user_id:user.id,request_key:b.request_key,plan_id:plan.id,company_name:companyName,company_id:license?.company_id||null,license_id:license?.id||null,expected_value:Number(plan.preco),duration_days:plan.duracao_dias,environment:mode,nome:user.nome||companyName,email:user.email,cpf_cnpj:'',telefone:null,status:'pending'},{onConflict:'portal_user_id,request_key',ignoreDuplicates:true});if(insertError)throw insertError;
  const {data:session,error:sessionError}=await supabase.from('checkout_sessions').select('id,checkout_id,checkout_url,status,creation_error').eq('portal_user_id',user.id).eq('request_key',b.request_key).single();if(sessionError)throw sessionError;
  if(session.id!==id){if(session.checkout_url&&session.status==='pending')return res.json({ok:true,checkout_url:session.checkout_url,session_id:session.id});fail('Esta solicitação já foi recebida. Confira o histórico antes de tentar novamente.',409);}
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let result;
  try{
   result=await provider('/checkouts',{method:'POST',body:JSON.stringify({billingTypes:['CREDIT_CARD'],chargeTypes:['RECURRENT'],minutesToExpire:60,externalReference:'mlsh_'+id,callback:{successUrl:'https://app.caickrigato.com.br/portal/?billing_return=success',cancelUrl:'https://app.caickrigato.com.br/portal/?billing_return=cancelled',expiredUrl:'https://app.caickrigato.com.br/portal/?billing_return=expired'},items:[{name:plan.nome,description:plan.descricao||'Assinatura ML SH Support',quantity:1,value:Number(plan.preco)}],subscription:{cycle:'MONTHLY',nextDueDate:today}})});
   if(!ID.test(result.id||''))throw Error('invalid_checkout_response');
  }catch(e){await supabase.from('checkout_sessions').update({creation_error:'Não foi possível confirmar a criação. Consulte o suporte antes de repetir a compra.',...([400,401,403,404,422,429].includes(e.providerStatus)?{status:'cancelled'}:{})}).eq('id',id);throw e;}
  const url='https://asaas.com/checkoutSession/show?id='+encodeURIComponent(result.id);
  const {error:saveError}=await supabase.from('checkout_sessions').update({checkout_id:result.id,checkout_url:url,updated_at:new Date().toISOString()}).eq('id',id);if(saveError)throw saveError;
  return res.json({ok:true,checkout_url:url,session_id:id});
 });
 const checkoutLimiter=(rateLimiter||require('express-rate-limit'))({windowMs:15*60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false});
 app.post('/api/portal/billing/checkout',authOwner,checkoutLimiter,checkout);
 app.post('/api/checkout',authOwner,checkoutLimiter,checkout);
 app.get('/api/portal/billing',authOwner,safe(async(req,res)=>{
  const {data:plans,error}=await supabase.from('plans').select('id,nome,descricao,preco,duracao_dias').eq('status','active').order('preco');if(error)throw error;
  const {data:checkouts,error:historyError}=await supabase.from('checkout_sessions').select('id,plan_id,company_name,license_id,status,expected_value,environment,checkout_url,creation_error,created_at').eq('portal_user_id',req.billingUser.id).order('created_at',{ascending:false}).limit(50);if(historyError)throw historyError;
  const ids=(checkouts||[]).map(c=>c.id);
  const {data:events,error:eventError}=ids.length?await supabase.from('billing_webhook_events').select('id,event,status,reason,checkout_session_id,created_at').in('checkout_session_id',ids).eq('status','review').order('created_at',{ascending:false}).limit(30):{data:[]};if(eventError)throw eventError;
  const {data:links,error:linksError}=await supabase.from('portal_user_licenses').select('licenses(id,plan_id,status,vencimento,asaas_subscription_id,companies(nome,status))').eq('user_id',req.billingUser.id);if(linksError)throw linksError;
  const licenses=(links||[]).map(r=>r.licenses).filter(l=>l&&l.status!=='blocked'&&l.vencimento&&l.companies?.status==='active').map(l=>({id:l.id,plan_id:l.plan_id,company_name:l.companies.nome,expires_at:l.vencimento,has_subscription:Boolean(l.asaas_subscription_id)}));
  const config=await runtime();
  res.json({ok:true,licenses,plans:plans||[],checkouts:checkouts||[],reviews:events||[],environment:mode,purchases_enabled:mode==='production'&&Boolean(config?.enabled&&authHash(config)&&env.ASAAS_API_KEY)});
 }));
 app.get('/api/billing/status',safe(async(req,res)=>{const config=await runtime();res.json({ok:true,environment:mode,purchases_enabled:mode==='production'&&Boolean(config?.enabled&&authHash(config)&&env.ASAAS_API_KEY)});}));
 app.get('/api/asaas-status',verificarAdmin,safe(async(req,res)=>res.json({ok:true,status:await provider('/myAccount/status/')})));
 app.get('/api/admin/billing/events',verificarAdmin,safe(async(req,res)=>{const {data,error}=await supabase.from('billing_webhook_events').select('id,environment,event,status,reason,checkout_session_id,created_at,processed_at').order('created_at',{ascending:false}).limit(100);if(error)throw error;res.json({ok:true,events:data});}));
 app.post('/api/webhooks/asaas',safe(async(req,res)=>{
  const config=await runtime(),hash=authHash(config);
  if(!hash)return res.status(503).json({ok:false,message:'Webhook não configurado.'});
  if(!equalToken(req.headers['asaas-access-token'],hash))return res.status(401).json({ok:false});
  let event;try{event=parseEvent(req.body);}catch(e){return res.status(400).json({ok:false});}
  if(event.event.startsWith('PAYMENT_')&&event.payment?.id){await applyPayment(event,event.payment.id);return res.json({ok:true});}
  const id=await persistEvent(event);
  if(event.event==='CHECKOUT_PAID'&&ID.test(event.checkout?.id||'')){
   const payments=await provider('/payments?checkoutSession='+encodeURIComponent(event.checkout.id)+'&limit=100');
   if(payments.hasMore||!payments.data?.some(p=>['CONFIRMED','RECEIVED'].includes(p.status)))throw Error('checkout_reconciliation_pending');
   for(const payment of payments.data)await applyPayment(event,payment.id,':'+payment.id);
  }else if(['CHECKOUT_CANCELED','CHECKOUT_EXPIRED'].includes(event.event)&&ID.test(event.checkout?.id||'')){
   const {error}=await supabase.from('checkout_sessions').update({status:event.event==='CHECKOUT_CANCELED'?'cancelled':'expired',updated_at:new Date().toISOString()}).eq('checkout_id',event.checkout.id).eq('environment',mode).eq('status','pending');if(error)throw error;
  }
  const {error}=await supabase.from('billing_webhook_events').update({status:event.event.startsWith('CHECKOUT_')?'processed':'ignored',processed_at:new Date().toISOString()}).eq('id',id);if(error)throw error;
  return res.json({ok:true});
 }));
};
module.exports.parseEvent=parseEvent;
module.exports.apiSettings=apiSettings;
module.exports.equalToken=equalToken;
