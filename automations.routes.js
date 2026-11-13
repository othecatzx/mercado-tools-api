const crypto = require('node:crypto');

const localDay = value => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
function previousDay(now=Date.now()) {
 const date=new Date(localDay(now)+'T12:00:00-03:00');date.setUTCDate(date.getUTCDate()-1);
 return localDay(date);
}
function reportRange(day) {
 const from=new Date(day+'T00:00:00-03:00');
 if(!Number.isFinite(from.getTime()))throw new Error('Data inválida.');
 return {from:from.toISOString(),to:new Date(from.getTime()+86400000-1).toISOString()};
}
function summarize(payload,day) {
 const rows=(payload.orders||[]).filter(o=>localDay(o.date_created)===day);
 const valid=rows.filter(o=>!['cancelled','canceled'].includes(String(o.status).toLowerCase()));
 const count=orders=>({orders:orders.length,revenue:orders.reduce((n,o)=>n+Math.round(Number(o.total_amount||0)*100),0)/100,units:orders.reduce((n,o)=>n+Number(o.units||0),0)});
 const stores=(payload.stores||[]).map(s=>({company_id:s.company_id,name:s.company_name,nickname:s.nickname,connected:s.connected===true,error:s.connected===true?null:'Não foi possível consultar esta conta. Reconecte ou tente novamente.',...count(valid.filter(o=>String(o.company_id)===String(s.company_id)))}));
 return {day,timezone:'America/Sao_Paulo',generated_at:new Date().toISOString(),...count(valid),cancelled:rows.length-valid.length,partial:stores.some(s=>!s.connected),stores,definition:'Pedidos não cancelados criados na data, com status da consulta. Valores brutos, sem descontar taxas ou fretes.'};
}

module.exports=function registerAutomations(app,{supabase,authPortal,readSales}) {
 let working=false;
 const guard=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){console.error('Automations:',e.code||e.message);if(!res.headersSent)res.status(500).json({ok:false,message:'Não foi possível concluir a automação. Tente novamente.'});}};
 async function validOwner(id) {
  const {data,error}=await supabase.from('portal_users').select('id,status,access_revoked').eq('id',id).maybeSingle();
  if(error)throw error;
  if(!data||data.status!=='active'||data.access_revoked)throw new Error('Conta indisponível.');
 }
 async function getRule(owner) {
  const {data,error}=await supabase.from('portal_automation_rules').select('*').eq('owner_id',owner).eq('kind','daily_sales').maybeSingle();
  if(error)throw error;return data;
 }
 async function work() {
  if(working)return;working=true;
  try {
   for(let i=0;i<5;i++) {
    const {data,error}=await supabase.rpc('mlsh_claim_automation_run');if(error)throw error;
    const run=data?.[0];if(!run)break;
    const heartbeat=setInterval(()=>{supabase.from('portal_automation_runs').update({lease_until:new Date(Date.now()+600000).toISOString()}).eq('id',run.id).eq('lease_token',run.lease_token).then(({error})=>{if(error)console.error('Automation lease:',error.code);}).catch(()=>{});},30000);
    heartbeat.unref?.();
    try {
     if(run.attempts>3)throw new Error('Limite de tentativas atingido.');
     await validOwner(run.owner_id);
     const payload=await readSales(run.owner_id,reportRange(run.report_day));
     const result=summarize(payload,run.report_day);
     if(!result.stores.length)throw new Error('Nenhuma loja ativa e autorizada para consultar.');
     if(result.stores.every(s=>!s.connected))throw new Error('Nenhuma loja pôde ser consultada. Confira as conexões.');
     const {error:saveError}=await supabase.from('portal_automation_runs').update({status:result.partial?'partial':'completed',result,error:null,finished_at:new Date().toISOString(),lease_until:null}).eq('id',run.id).eq('lease_token',run.lease_token);
     if(saveError)throw saveError;
    } catch(e) {
     // Não armazena respostas brutas, tokens ou dados pessoais de compradores.
     const message=e.message?.startsWith('Nenhuma')?e.message:'A consulta não foi concluída. Verifique as integrações e tente novamente.';
     const {error:saveError}=await supabase.from('portal_automation_runs').update({status:run.attempts<3?'queued':'failed',error:message,finished_at:run.attempts<3?null:new Date().toISOString(),retry_at:new Date(Date.now()+300000).toISOString(),lease_until:null}).eq('id',run.id).eq('lease_token',run.lease_token);
     if(saveError)console.error('Automation result save:',saveError.code);
    } finally {clearInterval(heartbeat);}
   }
  } catch(e) {console.error('Automation worker:',e.code||e.message);}
  finally {working=false;}
 }
 app.post('/api/internal/automations/tick',guard(async(req,res)=>{
  const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  if(!token||token.length>256)return res.status(401).json({ok:false});
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  const {data,error}=await supabase.from('portal_automation_runtime').select('token_hash').eq('id',true).maybeSingle();if(error)throw error;
  if(!data||data.token_hash.length!==hash.length||!crypto.timingSafeEqual(Buffer.from(data.token_hash),Buffer.from(hash)))return res.status(401).json({ok:false});
  res.status(202).json({ok:true});void work();
 }));
 app.get('/api/portal/automations',authPortal,guard(async(req,res)=>{
  const rule=await getRule(req.portalUserId);
  const {data:runs,error}=await supabase.from('portal_automation_runs').select('id,rule_id,report_day,status,attempts,created_at,started_at,finished_at,result,error,retry_at').eq('owner_id',req.portalUserId).order('created_at',{ascending:false}).limit(30);
  if(error)throw error;res.json({ok:true,rule,runs:runs||[],timezone:'America/Sao_Paulo'});
 }));
 app.put('/api/portal/automations/daily-sales',authPortal,guard(async(req,res)=>{
  const time=String(req.body?.run_time||'');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||typeof req.body?.enabled!=='boolean')return res.status(400).json({ok:false,message:'Informe um horário válido e o estado da automação.'});
  const {data,error}=await supabase.from('portal_automation_rules').upsert({owner_id:req.portalUserId,kind:'daily_sales',enabled:req.body.enabled,run_time:time,updated_at:new Date().toISOString()},{onConflict:'owner_id,kind'}).select('*').single();
  if(error)throw error;res.json({ok:true,rule:data});
 }));
 app.post('/api/portal/automations/daily-sales/run',authPortal,guard(async(req,res)=>{
  let rule=await getRule(req.portalUserId);
  if(!rule) {
   const {data,error}=await supabase.from('portal_automation_rules').upsert({owner_id:req.portalUserId,kind:'daily_sales'},{onConflict:'owner_id,kind',ignoreDuplicates:true});if(error)throw error;
   rule=await getRule(req.portalUserId);
  }
  const {error}=await supabase.from('portal_automation_runs').upsert({rule_id:rule.id,owner_id:req.portalUserId,report_day:previousDay()},{onConflict:'rule_id,report_day',ignoreDuplicates:true});if(error)throw error;
  const {error:retryError}=await supabase.from('portal_automation_runs').update({status:'queued',attempts:0,error:null,retry_at:new Date().toISOString(),finished_at:null}).eq('rule_id',rule.id).eq('report_day',previousDay()).in('status',['failed','partial']);if(retryError)throw retryError;
  res.status(202).json({ok:true,message:'Resumo de ontem solicitado. Acompanhe o histórico.'});void work();
 }));
 return {work};
};
module.exports.previousDay=previousDay;
module.exports.reportRange=reportRange;
module.exports.summarize=summarize;
