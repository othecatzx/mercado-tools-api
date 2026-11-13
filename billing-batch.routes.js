const crypto=require('node:crypto');
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const dayKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function renewalWindow(expires,now=new Date()){if(!expires)return {renewal_opens_on:null,in_renewal_window:false};const expiry=new Date(expires);if(!Number.isFinite(expiry.getTime()))return {renewal_opens_on:null,in_renewal_window:false};const expiryDay=dayKey(expiry),today=dayKey(now),opens=new Date(expiryDay+'T12:00:00Z');opens.setUTCDate(opens.getUTCDate()-15);const renewal_opens_on=opens.toISOString().slice(0,10);return {renewal_opens_on,in_renewal_window:today>=renewal_opens_on};}
const quoteHash=q=>crypto.createHash('sha256').update(JSON.stringify(q)).digest('hex');
module.exports=function registerBatchBilling(app,{supabase,jwt,env,mode,authOwner,verificarAdmin,safe,fail,provider,runtime,authHash,checkoutLimiter}){
 const messages={renewal_too_early:'A renovação fica disponível somente nos 15 dias anteriores ao vencimento.',price_not_configured:'O administrador ainda não definiu o preço deste período.',license_unavailable:'Uma licença está bloqueada, sem vencimento, com assinatura anterior ou não pertence à sua conta.',license_reserved:'Uma das licenças já está em um pagamento pendente. Confira com o suporte.',invalid_selection:'Selecione as empresas e um período válido.',duplicate_license:'Selecione cada licença apenas uma vez.'};
 async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error){const key=Object.keys(messages).find(k=>String(error.message).includes(k));if(key)fail(messages[key],409);throw error;}return data;}
 async function ownedLicenses(owner){
  const {data,error}=await supabase.from('portal_user_licenses').select('licenses(id,status,vencimento,asaas_subscription_id,companies(id,nome,status))').eq('user_id',owner);if(error)throw error;
  return (data||[]).map(x=>x.licenses).filter(Boolean).map(l=>({id:l.id,company_id:l.companies?.id,company_name:l.companies?.nome||'Empresa',status:l.status,expires_at:l.vencimento,...renewalWindow(l.vencimento),can_renew:['active','expired'].includes(l.status)&&l.companies?.status==='active'&&!l.asaas_subscription_id&&renewalWindow(l.vencimento).in_renewal_window}));
 }
 async function available(){const config=await runtime();return mode==='production'&&!!config?.enabled&&!!authHash(config)&&!!env.ASAAS_API_KEY;}
 app.get('/api/portal/billing',authOwner,safe(async(req,res)=>{
  const {data:product,error}=await supabase.from('billing_product').select('name,monthly_price,semiannual_price,annual_price').eq('id',true).single();if(error)throw error;
  res.json({ok:true,product:product.name,periods:[{months:1,label:'Mensal',configured:product.monthly_price!==null},{months:6,label:'Semestral',configured:product.semiannual_price!==null},{months:12,label:'Anual',configured:product.annual_price!==null}],licenses:await ownedLicenses(req.billingUser.id),purchases_enabled:await available()});
 }));
 app.post('/api/portal/billing/quote',authOwner,safe(async(req,res)=>{
  const ids=req.body?.license_ids,period=Number(req.body?.period);
  if(!Array.isArray(ids)||ids.length<1||ids.length>100||ids.some(id=>!UUID.test(id))||![1,6,12].includes(period))fail('Selecione empresas e período válidos.');
  const quote=await rpc('mlsh_batch_quote',{p_owner:req.billingUser.id,p_ids:ids,p_period:period});
  const signed=jwt.sign({type:'billing_quote',owner:req.billingUser.id,license_ids:ids,period,hash:quoteHash(quote)},env.JWT_SECRET,{expiresIn:'10m'});
  res.json({ok:true,quote,quote_token:signed});
 }));
 app.post('/api/portal/billing/checkout',authOwner,checkoutLimiter,safe(async(req,res)=>{
  if(!await available())fail('Os pagamentos ainda não foram liberados pelo administrador.',503);
  if(!UUID.test(req.body?.request_key||''))fail('Solicitação inválida. Atualize a cotação.');
  const {data:previous,error:previousError}=await supabase.from('billing_batches').select('id,status,checkout_url').eq('owner_id',req.billingUser.id).eq('request_key',req.body.request_key).maybeSingle();if(previousError)throw previousError;
  if(previous){if(previous.status==='pending'&&previous.checkout_url)return res.json({ok:true,batch_id:previous.id,checkout_url:previous.checkout_url});fail('Esta solicitação já foi recebida. Atualize a situação ou fale com o suporte.',409);}
  let signed;try{signed=jwt.verify(req.body?.quote_token||'',env.JWT_SECRET);}catch(e){fail('A cotação expirou. Calcule novamente.',409);}
  if(signed.type!=='billing_quote'||signed.owner!==req.billingUser.id)fail('Cotação inválida.',403);
  const pix=await provider('/pix/addressKeys?status=ACTIVE&limit=1');
  const billingTypes=pix.data?.some(k=>k.status==='ACTIVE')?['PIX','CREDIT_CARD']:['CREDIT_CARD'];
  const reserved=await rpc('mlsh_reserve_batch',{p_owner:req.billingUser.id,p_ids:signed.license_ids,p_period:signed.period,p_key:req.body.request_key,p_environment:mode});
  const batch=reserved.batch;
  if(!reserved.created){if(batch.checkout_url&&batch.status==='pending')return res.json({ok:true,batch_id:batch.id,checkout_url:batch.checkout_url});fail('O pagamento já está sendo preparado.',409);}
  if(quoteHash(batch.quote)!==signed.hash){await rpc('mlsh_close_unpaid_batch',{p_batch:batch.id,p_status:'cancelled'});fail('Preços ou vencimentos mudaram. Calcule novamente antes de pagar.',409);}
  const callbackTarget='https://app.caickrigato.com.br/portal/pagamento.html?kind=renewal&id='+batch.id;
  let result;
  try{
   result=await provider('/checkouts',{method:'POST',body:JSON.stringify({billingTypes,chargeTypes:['DETACHED'],minutesToExpire:60,externalReference:'mlsh_batch_'+batch.id,callback:{successUrl:callbackTarget+'&result=success',cancelUrl:callbackTarget+'&result=cancelled',expiredUrl:callbackTarget+'&result=expired'},items:batch.quote.items.map(i=>({name:String(i.company_name).slice(0,30),description:'ML SH Support — renovação até '+batch.target_date,quantity:1,value:Number(i.amount)}))})});
   if(!/^[a-zA-Z0-9_-]{1,160}$/.test(result.id||''))throw Error('invalid_provider_id');
  }catch(e){if([400,401,403,404,422,429].includes(e.providerStatus))await rpc('mlsh_close_unpaid_batch',{p_batch:batch.id,p_status:'cancelled'});await supabase.from('billing_batches').update({creation_error:'Criação não confirmada. Consulte o administrador antes de repetir.'}).eq('id',batch.id);throw e;}
  const url='https://asaas.com/checkoutSession/show?id='+encodeURIComponent(result.id);
  const {error}=await supabase.from('billing_batches').update({asaas_checkout_id:result.id,checkout_url:url}).eq('id',batch.id);if(error)throw error;
  res.json({ok:true,batch_id:batch.id,checkout_url:url});
 }));
 app.post('/api/checkout',authOwner,safe(async(req,res)=>res.status(410).json({ok:false,message:'Use a renovação de licenças em lote no portal.'})));
 app.get('/api/admin/billing',verificarAdmin,safe(async(req,res)=>{
  const [{data:product,error:a},{data:batches,error:b},{data:reviews,error:c}]=await Promise.all([
   supabase.from('billing_product').select('*').eq('id',true).single(),
   supabase.from('billing_batches').select('id,owner_id,quote,target_date,expected_total,status,environment,created_at,paid_at,creation_error,portal_users(nome,email)').order('created_at',{ascending:false}).limit(100),
   supabase.from('billing_webhook_events').select('id,event,status,reason,batch_id,created_at').eq('status','review').order('created_at',{ascending:false}).limit(50)
  ]);if(a||b||c)throw a||b||c;
  const config=await runtime();res.json({ok:true,product,batches:batches||[],reviews:reviews||[],environment:mode,purchases_enabled:!!config?.enabled,production_ready:mode==='production'&&!!authHash(config)&&!!env.ASAAS_API_KEY});
 }));
 app.put('/api/admin/billing/product',verificarAdmin,safe(async(req,res)=>{
  const fields=['monthly_price','semiannual_price','annual_price'],updates={};
  for(const key of fields){const raw=req.body?.[key];if(raw===null||raw===''){updates[key]=null;continue;}const n=Number(raw);if(!Number.isFinite(n)||n<=0||n>999999||Math.abs(n*100-Math.round(n*100))>0.00001)fail('Informe preços positivos com até duas casas decimais.');updates[key]=n;}
  const {data:current,error}=await supabase.from('billing_product').select('version').eq('id',true).single();if(error)throw error;
  const {data,error:saveError}=await supabase.from('billing_product').update({...updates,version:current.version+1,updated_at:new Date().toISOString()}).eq('id',true).eq('version',current.version).select('*').maybeSingle();if(saveError)throw saveError;if(!data)fail('A configuração mudou. Atualize a página e salve novamente.',409);
  res.json({ok:true,product:data});
 }));
 app.put('/api/admin/billing/availability',verificarAdmin,safe(async(req,res)=>{
  if(typeof req.body?.enabled!=='boolean')fail('Configuração inválida.');
  if(req.body.enabled&&(mode!=='production'||!authHash(await runtime())||!env.ASAAS_API_KEY))fail('Configure e valide o Asaas de produção antes de liberar pagamentos.',409);
  const {error}=await supabase.from('billing_runtime').update({enabled:req.body.enabled,updated_at:new Date().toISOString()}).eq('environment',mode);if(error)throw error;
  res.json({ok:true});
 }));
};
module.exports.quoteHash=quoteHash;

module.exports.renewalWindow=renewalWindow;
