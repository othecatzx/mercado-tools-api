"use strict";
// Dimensões isoladas por empresa. O company_id sempre vem de vínculo validado no servidor.
module.exports = function registerDimensionRoutes(app, { supabase, jwt }) {
  const table = 'bling_dimension_presets';
  const fail = (res, e) => {
    console.error('Dimensões:', e);
    return res.status(500).json({message:'Falha no gerenciamento de dimensões. Confirme a migração SQL.'});
  };
  const normalize = v => {
    const nome = String(v?.nome ?? '').trim();
    const ns = ['peso','largura','altura','profundidade'].map(k => Number(v?.[k]));
    if (!nome || nome.length > 100 || ns.some(n => !Number.isFinite(n) || n <= 0 || n > 10000)) return null;
    return {nome,peso:ns[0],largura:ns[1],altura:ns[2],profundidade:ns[3]};
  };
  const getToken = req => /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
  async function getPortalOwner(req,res,next) {
    try {
      const payload = jwt.verify(getToken(req),process.env.JWT_SECRET);
      if(payload.type === 'support_agent' && payload.support_agent_id) {
        const {data:agent,error:agentError}=await supabase.from('support_agents').select('id,status,license_id,created_by_portal_user_id,menu_permissions,bling_permissions,allowed_license_ids,allowed_company_ids').eq('id',payload.support_agent_id).maybeSingle();
        if(agentError)throw agentError;
        if(!agent||agent.status!=='active')return res.status(403).json({message:'Usuário não autorizado.'});
        const perms=agent.bling_permissions||[];
        if(!(agent.menu_permissions||[]).includes('bling-dimensions')||!perms.some(x=>['bling.dimensions.view','bling.dimensions.manage'].includes(x)))return res.status(403).json({message:'Sem permissão para dimensões.'});
        req.dimAgent=agent;req.ownerId=agent.created_by_portal_user_id;
        if(!req.ownerId)return res.status(403).json({message:'Conta sem titular.'});
        return next();
      }
      if(payload.type !== 'portal' || !payload.portal_user_id) return res.status(403).json({message:'Acesso negado.'});
      const {data:user,error} = await supabase.from('portal_users').select('id,status').eq('id',payload.portal_user_id).maybeSingle();
      if(error) throw error;
      if(!user || user.status !== 'active') return res.status(403).json({message:'Conta indisponível'});
      req.ownerId = user.id;
      next();
    } catch(e) {
      if(e.name === 'JsonWebTokenError'||e.name === 'TokenExpiredError'||e.name === 'TypeError') return res.status(401).json({message:'Entre novamente no portal.'});
      return fail(res,e);
    }
  }
  async function ownedCompanies(ownerId) {
    const {data,error} = await supabase.from('portal_user_licenses')
      .select('licenses(id,status,vencimento,company_id,companies(id,nome,status))').eq('user_id',ownerId);
    if(error) throw error;
    const companies = new Map();
    for(const link of data||[]) {
      const lic=link.licenses,co=lic?.companies;
      if(!lic||!co || lic.status !== 'active'|| co.status !== 'active'||(lic.vencimento&&new Date(lic.vencimento).getTime()<Date.now()))continue;
      companies.set(String(co.id),{id:co.id,nome:co.nome});
    }
    return [...companies.values()];
  }
  app.get('/api/portal/dimensoes/empresas',getPortalOwner,async(req,res)=>{
    try {res.json({companies:await scopedDimensionCompanies(req)});} catch(e){fail(res,e)}
  });
  async function scopedDimensionCompanies(req){
    const owned=await ownedCompanies(req.ownerId);
    if(!req.dimAgent)return owned;
    const agent=req.dimAgent;
    const licenseIds=[...new Set((agent.allowed_license_ids?.length?agent.allowed_license_ids:[agent.license_id]).map(String))];
    if(!licenseIds.length)return [];
    const {data,error}=await supabase.from('licenses').select('id,company_id,status,vencimento').in('id',licenseIds);
    if(error)throw error;
    const permitted=new Set((data||[]).filter(l=>l.status==='active'&&(!l.vencimento||new Date(l.vencimento).getTime()>=Date.now())).map(l=>String(l.company_id)));
    if(Array.isArray(agent.allowed_company_ids)&&agent.allowed_company_ids.length){const allow=new Set(agent.allowed_company_ids.map(String));return owned.filter(c=>permitted.has(String(c.id))&&allow.has(String(c.id)))}
    return owned.filter(c=>permitted.has(String(c.id)));
  }
  function mayWrite(req,res,next){if(req.dimAgent&&!(req.dimAgent.bling_permissions||[]).includes('bling.dimensions.manage'))return res.status(403).json({message:'Permissão para editar dimensões não concedida.'});next()}
  async function companyScope(req,res,next) {
    try {
      const companyId=req.params.companyId;
      if(!(await scopedDimensionCompanies(req)).some(c=>String(c.id)===String(companyId)))
        return res.status(403).json({message:'Empresa não autorizada ou sem licença ativa.'});
      req.dimCompanyId=companyId;next();
    }catch(e){fail(res,e)}
  }
  const ownerAccess=[getPortalOwner,companyScope];
  app.get('/api/portal/dimensoes/:companyId',...ownerAccess,async(req,res)=>{
    try {
      const {data,error}=await supabase.from(table).select('id,nome,peso,largura,altura,profundidade,ordem')
        .eq('company_id',req.dimCompanyId).order('ordem',{ascending:true}).order('nome',{ascending:true});
      if(error)throw error;res.json({items:data||[]});
    }catch(e){fail(res,e)}
  });
  app.post('/api/portal/dimensoes/:companyId',...ownerAccess,mayWrite,async(req,res)=>{
    const value=normalize(req.body);if(!value)return res.status(400).json({message:'Nome e dimensões precisam ser positivos e válidos.'});
    try {
      const {data,error}=await supabase.from(table).insert({...value,company_id:req.dimCompanyId,ordem:100}).select().single();
      if(error){if(error.code==='23505')return res.status(409).json({message:'Já existe este nome nesta empresa.'});throw error;}
      res.status(201).json({item:data});
    }catch(e){fail(res,e)}
  });
  app.put('/api/portal/dimensoes/:companyId/:id',...ownerAccess,mayWrite,async(req,res)=>{
    const value=normalize(req.body);if(!value)return res.status(400).json({message:'Nome e dimensões precisam ser positivos e válidos.'});
    try {
      const {data,error}=await supabase.from(table).update(value)
        .eq('company_id',req.dimCompanyId).eq('id',req.params.id).select().maybeSingle();
      if(error){if(error.code==='23505')return res.status(409).json({message:'Já existe este nome nesta empresa.'});throw error;}
      if(!data)return res.status(404).json({message:'Modelo não encontrado nesta empresa.'});res.json({item:data});
    }catch(e){fail(res,e)}
  });
  app.delete('/api/portal/dimensoes/:companyId/:id',...ownerAccess,mayWrite,async(req,res)=>{
    try {
      const {data,error}=await supabase.from(table).delete().eq('company_id',req.dimCompanyId).eq('id',req.params.id).select('id').maybeSingle();
      if(error)throw error;if(!data)return res.status(404).json({message:'Modelo não encontrado nesta empresa.'});res.json({ok:true});
    }catch(e){fail(res,e)}
  });
  // Bloqueia a API administrativa global antiga; nenhum administrador altera modelos entre empresas por acidente.
  app.all(/^\/api\/admin\/dimensoes(?:\/.*)?$/,(_req,res)=>res.status(410).json({message:'As dimensões são gerenciadas na aba do portal e isoladas por empresa.'}));
  app.post('/api/bling/dimensoes',async(req,res)=>{
    try {
      const {chave,device_id}=req.body||{};
      if(typeof chave!=='string'||typeof device_id!=='string'||!chave.trim()||!device_id.trim())
        return res.status(401).json({message:'Licença e dispositivo obrigatórios'});
      const {data:lic,error:lerr}=await supabase.from('licenses').select('company_id,status,vencimento').eq('chave',chave).maybeSingle();
      if(lerr)throw lerr;
      if(!lic||lic.status!=='active'||(lic.vencimento&&new Date(lic.vencimento).getTime()<Date.now()))return res.status(403).json({message:'Licença não ativa'});
      const [{data:company,error:cerr},{data:device,error:derr}]=await Promise.all([
        supabase.from('companies').select('status').eq('id',lic.company_id).maybeSingle(),
        supabase.from('devices').select('status').eq('company_id',lic.company_id).eq('device_id',device_id).maybeSingle()
      ]);
      if(cerr||derr)throw cerr||derr;
      if(company?.status!=='active'||device?.status!=='active')return res.status(403).json({message:'Dispositivo não autorizado'});
      const {data,error}=await supabase.from(table).select('id,nome,peso,largura,altura,profundidade,ordem')
        .eq('company_id',lic.company_id).order('ordem',{ascending:true}).order('nome',{ascending:true});
      if(error)throw error;
      res.json({items:data||[],company_id:lic.company_id});
    }catch(e){fail(res,e)}
  });
};
