'use strict';
const attempts = new Map();
const now = () => Date.now();
module.exports = function createTeamAdminGate(app, {supabase,jwt,bcrypt,getAgentAllowedLicenses}) {
  async function getConfig(ownerId) {
    const {data,error}=await supabase.from('portal_admin_passwords').select('password_hash,updated_at').eq('portal_user_id',ownerId).maybeSingle();
    if(error)throw error;return data;
  }
  function ownerOnly(req,res,next) {
    try {
      const bearer=String(req.headers.authorization||'');
      const decoded=jwt.verify(bearer.startsWith('Bearer ')?bearer.slice(7):'',process.env.JWT_SECRET);
      if(decoded.type!=='portal'||!decoded.portal_user_id)return res.status(401).json({ok:false,error:'invalid_session'});
      req.ownerId=decoded.portal_user_id;next();
    }catch(_){res.status(401).json({ok:false,error:'invalid_session'});}
  }
  app.get('/api/portal/team-admin-password',ownerOnly,async(req,res)=>{
    try{const config=await getConfig(req.ownerId);res.json({ok:true,enabled:!!config,updated_at:config?.updated_at||null});}
    catch(e){console.error('Team admin status:',e.message);res.status(500).json({ok:false,error:'server_error'});}
  });
  app.put('/api/portal/team-admin-password',ownerOnly,async(req,res)=>{
    try {
      const ownerPassword=String(req.body?.owner_password||''),password=String(req.body?.admin_password||'');
      if(password.length<8||password.length>128)return res.status(400).json({ok:false,error:'invalid_password',message:'Use uma senha de 8 a 128 caracteres.'});
      const {data:owner,error:ownerError}=await supabase.from('portal_users').select('senha_hash,status').eq('id',req.ownerId).single();
      if(ownerError)throw ownerError;
      if(owner.status!=='active'||!await bcrypt.compare(ownerPassword,owner.senha_hash))return res.status(403).json({ok:false,error:'owner_password_invalid',message:'Senha do titular incorreta.'});
      const password_hash=await bcrypt.hash(password,12);
      const {error}=await supabase.from('portal_admin_passwords').upsert({portal_user_id:req.ownerId,password_hash,updated_at:new Date().toISOString()},{onConflict:'portal_user_id'});
      if(error)throw error;
      res.json({ok:true,enabled:true});
    }catch(e){console.error('Team admin setup:',e.message);res.status(500).json({ok:false,error:'server_error',message:'Não foi possível configurar a senha.'});}
  });
  app.post('/api/portal/team-admin-authorize',async(req,res)=>{
    try{
      let pending;
      try{pending=jwt.verify(String(req.body?.challenge||''),process.env.JWT_SECRET);}catch(_){return res.status(401).json({ok:false,error:'challenge_expired',message:'Autorização expirada. Faça login novamente.'});}
      if(pending.type!=='support_agent_pending'||!pending.support_agent_id||!pending.portal_user_id)return res.status(401).json({ok:false,error:'invalid_challenge'});
      const key=pending.support_agent_id+':'+req.ip,entry=attempts.get(key);
      if(entry?.blockedUntil>now())return res.status(429).json({ok:false,error:'locked',message:'Muitas tentativas. Aguarde 15 minutos.'});
      const {data:agent,error:agentError}=await supabase.from('support_agents').select('id,nome,email,license_id,status,permissions,user_management_permissions,menu_permissions,bling_permissions,bling_connection_ids,allowed_company_ids,allowed_license_ids,created_by_portal_user_id,session_version,access_revoked,licenses(status,companies(nome))').eq('id',pending.support_agent_id).maybeSingle();
      if(agentError)throw agentError;
      if(!agent||agent.status!=='active'||agent.access_revoked===true||agent.licenses?.status!=='active'||String(agent.created_by_portal_user_id)!==String(pending.portal_user_id)||Number(agent.session_version||0)!==Number(pending.session_version||0))return res.status(401).json({ok:false,error:'account_unavailable'});
      const config=await getConfig(pending.portal_user_id);
      if(!config)return res.status(403).json({ok:false,error:'not_configured',message:'O titular ainda não configurou esta proteção.'});
      if(!await bcrypt.compare(String(req.body?.admin_password||''),config.password_hash)){
        const n=entry?.expires>now()?entry.count+1:1;
        attempts.set(key,{count:n,expires:now()+900000,blockedUntil:n>=5?now()+900000:0});
        return res.status(401).json({ok:false,error:'incorrect_admin_password',message:'Senha administrativa incorreta.'});
      }
      attempts.delete(key);
      const allowedLicenses=await getAgentAllowedLicenses(agent);
      const allowedIds=allowedLicenses.map(x=>String(x.id));
      if(!allowedIds.includes(String(agent.license_id)))return res.status(401).json({ok:false,error:'account_unavailable'});
      const token=jwt.sign({type:'support_agent',support_agent_id:agent.id,license_id:agent.license_id,email:agent.email,session_version:Number(agent.session_version||0)},process.env.JWT_SECRET,{expiresIn:'7d'});
      res.json({ok:true,token,user:{id:agent.id,nome:agent.nome,email:agent.email,status:agent.status,role:'support_agent',license_id:agent.license_id,permissions:agent.permissions||[],user_management_permissions:agent.user_management_permissions||[],menu_permissions:Array.isArray(agent.menu_permissions)?agent.menu_permissions:['chat'],bling_permissions:agent.bling_permissions||[],bling_connection_ids:agent.bling_connection_ids||[],allowed_company_ids:agent.allowed_company_ids||[],allowed_license_ids:allowedIds,allowed_licenses:allowedLicenses,company_name:agent.licenses?.companies?.nome||'Empresa'}});
    }catch(e){console.error('Team admin authorization:',e.message);res.status(500).json({ok:false,error:'server_error',message:'Não foi possível autorizar o acesso.'});}
  });
  return {
    async challengeIfRequired(agent) {
      const config=await getConfig(agent.created_by_portal_user_id);
      if(!config)return null;
      return jwt.sign({type:'support_agent_pending',support_agent_id:agent.id,portal_user_id:agent.created_by_portal_user_id,session_version:Number(agent.session_version||0)},process.env.JWT_SECRET,{expiresIn:'5m'});
    }
  };
};
