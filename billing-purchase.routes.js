const crypto=require('node:crypto');
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const hash=q=>crypto.createHash('sha256').update(JSON.stringify(q)).digest('hex');
function validDocument(doc){if(!/^(\d{11}|\d{14})$/.test(doc)||/^(\d)\1+$/.test(doc))return false;const check=(base,weights)=>{const n=base.split('').reduce((sum,d,i)=>sum+Number(d)*weights[i],0)%11;return n<2?0:11-n;};if(doc.length===11){for(let n=9;n<=10;n++)if(check(doc.slice(0,n),Array.from({length:n},(_,i)=>n+1-i))!==Number(doc[n]))return false;}else{for(let n=12;n<=13;n++){const w=n===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];if(check(doc.slice(0,n),w)!==Number(doc[n]))return false;}}return true;}
module.exports=function(app,{supabase,jwt,env,mode,authOwner,verificarAdmin,safe,fail,provider,runtime,authHash,checkoutLimiter,applyPayment,rateLimiter}){
 const errors={price_not_configured:'O preço deste período ainda não foi configurado.',invalid_company:'Confira o nome e o CPF/CNPJ da empresa.',company_already_registered:'Este documento já possui uma empresa cadastrada. Use a licença existente ou entre em contato com o suporte.',signup_already_pending:'Já existe uma contratação pendente para este documento. Retome o pagamento na lista abaixo.'};
 async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);if(error){const k=Object.keys(errors).find(k=>String(error.message).includes(k));if(k)fail(errors[k],409);throw error;}return data;}
 async function available(){const c=await runtime();return mode==='production'&&!!c?.enabled&&!!authHash(c)&&!!env.ASAAS_API_KEY;}
 const resultLimiter=(rateLimiter||require('express-rate-limit'))({windowMs:60000,limit:30,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/portal/billing/signup/options',authOwner,safe(async(req,res)=>{const {data,error}=await supabase.from('billing_product').select('*').eq('id',true).single();if(error)throw error;res.json({ok:true,name:data.name,purchases_enabled:await available(),periods:[{months:1,label:'Mensal',price:data.monthly_price},{months:6,label:'Semestral',price:data.semiannual_price},{months:12,label:'Anual',price:data.annual_price}]});}));
 app.get('/api/portal/billing/signups',authOwner,safe(async(req,res)=>{const {data,error}=await supabase.from('billing_signups').select('id,quote,period,expected_total,status,checkout_url,license_id,created_at').eq('owner_id',req.billingUser.id).eq('environment',mode).order('created_at',{ascending:false}).limit(20);if(error)throw error;res.json({ok:true,orders:(data||[]).map(o=>({id:o.id,company_name:o.quote.company.nome,period:o.period,total:o.expected_total,status:o.status,checkout_url:o.checkout_url,created_at:o.created_at}))});}));
 app.post('/api/portal/billing/signup/quote',authOwner,safe(async(req,res)=>{
  const raw=req.body?.company||{},company={nome:String(raw.nome||'').trim(),documento:String(raw.documento||'').replace(/\D/g,''),codigo_ml:''},period=Number(req.body?.period);
  if(company.nome.length<2||company.nome.length>150||!validDocument(company.documento)||![1,6,12].includes(period))fail('Informe o nome da empresa e um CPF/CNPJ válido.');
  const quote=await rpc('mlsh_signup_quote',{p_owner:req.billingUser.id,p_company:company,p_period:period});
  res.json({ok:true,quote,quote_token:jwt.sign({type:'billing_signup_quote',owner:req.billingUser.id,company:quote.company,period,hash:hash(quote)},env.JWT_SECRET,{expiresIn:'10m'})});
 }));
 app.post('/api/portal/billing/signup/checkout',authOwner,checkoutLimiter,safe(async(req,res)=>{
  if(!await available())fail('Os pagamentos não estão disponíveis agora.',503);
  if(!UUID.test(req.body?.request_key||''))fail('Atualize a cotação.');
  const {data:previous,error:lookupError}=await supabase.from('billing_signups').select('id,status,checkout_url').eq('owner_id',req.billingUser.id).eq('request_key',req.body.request_key).maybeSingle();if(lookupError)throw lookupError;
  if(previous){if(previous.status==='pending'&&previous.checkout_url)return res.json({ok:true,order_id:previous.id,checkout_url:previous.checkout_url});fail('Esta solicitação já foi recebida. Confira o andamento da contratação.',409);}
  let signed;try{signed=jwt.verify(req.body?.quote_token||'',env.JWT_SECRET);}catch(e){fail('A cotação expirou. Confira os dados novamente.',409);}
  if(signed.type!=='billing_signup_quote'||signed.owner!==req.billingUser.id)fail('Cotação inválida.',403);
  const pix=await provider('/pix/addressKeys?status=ACTIVE&limit=1'),billingTypes=pix.data?.some(k=>k.status==='ACTIVE')?['PIX','CREDIT_CARD']:['CREDIT_CARD'];
  const reserved=await rpc('mlsh_reserve_signup',{p_owner:req.billingUser.id,p_company:signed.company,p_period:signed.period,p_key:req.body.request_key,p_environment:mode}),order=reserved.order;
  if(!reserved.created){if(order.status==='pending'&&order.checkout_url)return res.json({ok:true,order_id:order.id,checkout_url:order.checkout_url});fail('O pagamento já está sendo preparado.',409);}
  if(hash(order.quote)!==signed.hash){const {error}=await supabase.from('billing_signups').update({status:'cancelled'}).eq('id',order.id).eq('status','pending');if(error)throw error;fail('O preço mudou. Confira o resumo novamente antes de pagar.',409);}
  const target='https://app.caickrigato.com.br/portal/pagamento.html?kind=signup&id='+order.id;
  let checkout;
  try{checkout=await provider('/checkouts',{method:'POST',body:JSON.stringify({billingTypes,chargeTypes:['DETACHED'],minutesToExpire:60,externalReference:'mlsh_signup_'+order.id,callback:{successUrl:target+'&result=success',cancelUrl:target+'&result=cancelled',expiredUrl:target+'&result=expired'},items:[{name:order.quote.company.nome.slice(0,30),description:'ML SH Support — primeira licença, '+order.period+' mês(es)',quantity:1,value:Number(order.expected_total)}]})});if(!/^[a-zA-Z0-9_-]{1,160}$/.test(checkout.id||''))throw Error('invalid_provider_id');}
  catch(e){const patch={creation_error:'Não foi possível confirmar a criação do checkout. Consulte o suporte.'};if([400,401,403,404,422,429].includes(e.providerStatus))patch.status='cancelled';await supabase.from('billing_signups').update(patch).eq('id',order.id).eq('status','pending');throw e;}
  const checkout_url='https://asaas.com/checkoutSession/show?id='+encodeURIComponent(checkout.id);
  const {error}=await supabase.from('billing_signups').update({asaas_checkout_id:checkout.id,checkout_url}).eq('id',order.id);if(error)throw error;
  res.json({ok:true,order_id:order.id,checkout_url});
 }));
 async function findOrder(req){if(!['signup','renewal'].includes(req.params.kind)||!UUID.test(req.params.id||''))fail('Pagamento não encontrado.',404);const table=req.params.kind==='signup'?'billing_signups':'billing_batches';const {data,error}=await supabase.from(table).select('*').eq('id',req.params.id).eq('owner_id',req.billingUser.id).in('environment',mode==='production'&&req.params.kind==='signup'?['production','sandbox']:[mode]).maybeSingle();if(error)throw error;if(!data)fail('Pagamento não encontrado.',404);return data;}
 app.post('/api/portal/billing/result/:kind/:id/reconcile',authOwner,resultLimiter,safe(async(req,res)=>{
  const order=await findOrder(req);if(order.environment===mode&&order.status==='pending'&&order.asaas_checkout_id){const list=await provider('/payments?checkoutSession='+encodeURIComponent(order.asaas_checkout_id)+'&limit=100');if(list.hasMore)fail('O pagamento ainda está sendo conferido.',503);for(const payment of list.data||[]){if(['CONFIRMED','RECEIVED'].includes(payment.status))await applyPayment({id:'return_'+crypto.createHash('sha256').update(mode+':'+order.id+':'+payment.id).digest('hex'),event:'PAYMENT_CONFIRMED'},payment.id);}}res.json({ok:true});
 }));
 app.get('/api/portal/billing/result/:kind/:id',authOwner,safe(async(req,res)=>{
  const order=await findOrder(req);let licenses=[];
  if(order.status==='paid'){
   const ids=req.params.kind==='signup'?[order.license_id]:order.quote.items.map(i=>i.license_id);
   const {data,error}=await supabase.from('portal_user_licenses').select('licenses(id,chave,status,vencimento,companies(nome))').eq('user_id',req.billingUser.id).in('license_id',ids);if(error)throw error;
   licenses=(data||[]).map(x=>x.licenses).filter(Boolean).map(l=>({id:l.id,key:l.chave,status:l.status,expires_at:l.vencimento,company_name:l.companies?.nome||'Empresa'}));
  }
  const {data:reviews,error}=await supabase.from('billing_webhook_events').select('id').eq(req.params.kind==='signup'?'signup_id':'batch_id',order.id).eq('status','review').limit(1);if(error)throw error;
  const needsReview=!!reviews?.length||order.status==='review';
  res.json({ok:true,kind:req.params.kind,id:order.id,sandbox:order.environment==='sandbox',status:needsReview?'review':order.status,total:order.expected_total,company_name:order.quote.company?.nome||null,paid_at:order.paid_at,licenses:needsReview?[]:licenses});
 }));
 app.get('/api/admin/billing/signups',verificarAdmin,safe(async(req,res)=>{const {data,error}=await supabase.from('billing_signups').select('id,quote,period,expected_total,status,environment,created_at,paid_at,creation_error,license_id,portal_users(nome,email)').order('created_at',{ascending:false}).limit(100);if(error)throw error;res.json({ok:true,orders:data||[]});}));
};
module.exports.validDocument=validDocument;
