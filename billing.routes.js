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
  let isSignup=String(payment.externalReference||'').startsWith('mlsh_signup_');
  if(!isSignup&&payment.checkoutSession){const {data:order,error}=await supabase.from('billing_signups').select('id').eq('asaas_checkout_id',payment.checkoutSession).eq('environment',mode).maybeSingle();if(error)throw error;isSignup=!!order;}
  let isBatch=String(payment.externalReference||'').startsWith('mlsh_batch_');
  if(!isBatch&&payment.checkoutSession){const {data:batch,error}=await supabase.from('billing_batches').select('id').eq('asaas_checkout_id',payment.checkoutSession).eq('environment',mode).maybeSingle();if(error)throw error;isBatch=!!batch;}
  const {error}=await supabase.rpc(isSignup?'mlsh_apply_signup_payment':isBatch?'mlsh_apply_batch_payment':'mlsh_apply_verified_payment',{p_event_id:id,p_environment:mode,p_payment:verified});if(error)throw error;
 }
 const checkoutLimiter=(rateLimiter||require('express-rate-limit'))({windowMs:15*60000,limit:10,standardHeaders:'draft-7',legacyHeaders:false});
 require('./billing-batch.routes')(app,{supabase,jwt,env,mode,authOwner,verificarAdmin,safe,fail,provider,runtime,authHash,checkoutLimiter});
 require('./billing-purchase.routes')(app,{supabase,jwt,env,mode,authOwner,verificarAdmin,safe,fail,provider,runtime,authHash,checkoutLimiter,applyPayment,rateLimiter});
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
   const {error:signupCloseError}=await supabase.from('billing_signups').update({status:event.event==='CHECKOUT_CANCELED'?'cancelled':'expired'}).eq('asaas_checkout_id',event.checkout.id).eq('environment',mode).eq('status','pending');if(signupCloseError)throw signupCloseError;
   const {data:batch,error:batchError}=await supabase.from('billing_batches').select('id').eq('asaas_checkout_id',event.checkout.id).eq('environment',mode).maybeSingle();if(batchError)throw batchError;if(batch){const {error:closeError}=await supabase.rpc('mlsh_close_unpaid_batch',{p_batch:batch.id,p_status:event.event==='CHECKOUT_CANCELED'?'cancelled':'expired'});if(closeError)throw closeError;}
  }
  const {error}=await supabase.from('billing_webhook_events').update({status:event.event.startsWith('CHECKOUT_')?'processed':'ignored',processed_at:new Date().toISOString()}).eq('id',id);if(error)throw error;
  return res.json({ok:true});
 }));
};
module.exports.parseEvent=parseEvent;
module.exports.apiSettings=apiSettings;
module.exports.equalToken=equalToken;
