// Consultas de leitura: não exige alteração do banco de dados.
async function latestMessages(supabase,ids){
 const latest=new Map();
 for(let start=0;start<ids.length;start+=50){
  const batch=ids.slice(start,start+50);let offset=0;
  while(true){
   const {data,error}=await supabase.from('support_messages').select('conversation_id,sender_role,created_at,id').in('conversation_id',batch).order('created_at',{ascending:false,nullsFirst:false}).order('id',{ascending:false}).range(offset,offset+999);
   if(error)throw error;
   for(const m of data||[])if(!latest.has(String(m.conversation_id)))latest.set(String(m.conversation_id),m);
   if((data||[]).length<1000||batch.every(id=>latest.has(String(id))))break;
   offset+=1000;if(offset>=100000)throw new Error('Histórico muito grande para esta consulta.');
  }
 }
 return latest;
}
module.exports=function registerChatOperations(app,{supabase,authChat}) {
 app.get('/api/portal/atendimento/chat/summary',authChat,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
   let owner=req.actor.id,allowed=null;
   if(req.actor.type==='agent') {
    const {data:agent,error}=await supabase.from('support_agents').select('id,license_id,status,permissions,menu_permissions,allowed_license_ids,created_by_portal_user_id').eq('id',req.actor.id).maybeSingle();
    if(error)throw error;
    if(!agent||agent.status!=='active')return res.status(401).json({ok:false,error:'account_unavailable'});
    if(!(agent.menu_permissions||[]).includes('chat')||!(agent.permissions||[]).includes('conversations.view'))return res.status(403).json({ok:false,error:'permission_denied',message:'Sem permissão para visualizar o atendimento.'});
    owner=agent.created_by_portal_user_id;
    allowed=new Set((agent.allowed_license_ids?.length?agent.allowed_license_ids:[agent.license_id]).map(String));
   }
   const {data:links,error}=await supabase.from('portal_user_licenses').select('licenses(id,status,vencimento,company_id,companies(nome,status))').eq('user_id',owner);
   if(error)throw error;
   const licenses=(links||[]).map(l=>l.licenses).filter(l=>l&&l.status==='active'&&(!l.vencimento||new Date(l.vencimento).getTime()>Date.now())&&l.companies?.status==='active'&&(!allowed||allowed.has(String(l.id))));
   const stores=licenses.map(l=>({license_id:l.id,company_id:l.company_id,company_name:l.companies?.nome||'Loja',waiting:0,unassigned:0,open:0,unknown_sender:0,oldest_waiting_at:null,last_synced_at:null}));
   const byId=new Map(stores.map(s=>[String(s.license_id),s]));
   const conversations=[];
   for(let start=0;start<licenses.length;start+=50){
    const batch=licenses.slice(start,start+50).map(l=>l.id);let offset=0;
    while(true){
     const {data,error}=await supabase.from('support_conversations').select('id,license_id,closed_at,ml_status,assigned_agent_id,updated_at').in('license_id',batch).order('id').range(offset,offset+999);
     if(error)throw error;conversations.push(...data||[]);
     if((data||[]).length<1000)break;offset+=1000;
     if(offset>=50000)throw new Error('Muitas conversas para esta consulta.');
    }
   }
   const open=conversations.filter(c=>!c.closed_at&&c.ml_status!=='blocked');
   const latest=await latestMessages(supabase,open.map(c=>c.id));
   for(const c of conversations){
    const store=byId.get(String(c.license_id));if(!store)continue;
    if(c.updated_at&&(!store.last_synced_at||c.updated_at>store.last_synced_at))store.last_synced_at=c.updated_at;
    if(c.closed_at||c.ml_status==='blocked')continue;
    store.open++;if(!c.assigned_agent_id)store.unassigned++;
    const message=latest.get(String(c.id));
    if(!message?.sender_role)store.unknown_sender++;
    if(message?.sender_role==='buyer'){store.waiting++;if(message.created_at&&(!store.oldest_waiting_at||message.created_at<store.oldest_waiting_at))store.oldest_waiting_at=message.created_at;}
   }
   return res.json({ok:true,stores,checked_at:new Date().toISOString(),source:'synced_messages'});
  } catch(e) {console.error('Chat operations summary:',e.code||e.message);return res.status(500).json({ok:false,message:'Não foi possível consultar as pendências de atendimento.'});}
 });
};
module.exports.latestMessages=latestMessages;
