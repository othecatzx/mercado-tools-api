function activeLicense(license,now=Date.now()) {return !!license&&license.status==='active'&&license.companies?.status==='active'&&(!license.vencimento||(Number.isFinite(Date.parse(license.vencimento))&&Date.parse(license.vencimento)>now));}
function enforceCompanyMap(req,companies){if(req.portalLicenseAccess){const ids=new Set(req.portalLicenseAccess.company_ids);for(const id of companies.keys())if(!ids.has(String(id)))companies.delete(id);}return companies;}
function metadataPath(path){return ['/me','/dashboard','/licenses','/license-access'].includes(path)||path==='/billing'||path.startsWith('/billing/');}
async function entitlements(supabase,principal){
 let owner=principal.portal_user_id,agent=null;
 if(principal.type==='support_agent'){
  const {data,error}=await supabase.from('support_agents').select('id,license_id,status,created_by_portal_user_id,allowed_license_ids').eq('id',principal.support_agent_id).maybeSingle();if(error)throw error;agent=data;owner=agent?.created_by_portal_user_id;
  if(!agent||agent.status!=='active'||!owner)return {operational_access:false,has_licenses:false,license_ids:[],company_ids:[]};
  const {data:account,error:ownerError}=await supabase.from('portal_users').select('status,access_revoked').eq('id',owner).maybeSingle();if(ownerError)throw ownerError;if(!account||account.status!=='active'||account.access_revoked)return {operational_access:false,has_licenses:false,license_ids:[],company_ids:[]};
 }
 const {data,error}=await supabase.from('portal_user_licenses').select('license_id,licenses(id,status,vencimento,company_id,companies(id,status))').eq('user_id',owner);if(error)throw error;
 const all=(data||[]).map(x=>x.licenses).filter(Boolean);let active=all.filter(l=>activeLicense(l));
 if(agent){const allowed=new Set((agent.allowed_license_ids?.length?agent.allowed_license_ids:[agent.license_id]).map(String));active=active.filter(l=>allowed.has(String(l.id)));if(!active.some(l=>String(l.id)===String(agent.license_id)))active=[];}
 return {operational_access:active.length>0,has_licenses:all.length>0,license_ids:active.map(l=>String(l.id)).sort(),company_ids:[...new Set(active.map(l=>String(l.company_id)))].sort()};
}
module.exports=function registerPortalLicenseAccess(app,{supabase}){
 app.use('/api/portal',async(req,res,next)=>{
  if(['/login','/register','/bling/callback'].includes(req.path))return next();
  if(!req.portalPrincipal)return res.status(401).json({ok:false,error:'auth_required',message:'Entre na sua conta para continuar.'});
  try{
   const access=await entitlements(supabase,req.portalPrincipal);req.portalLicenseAccess=access;
   if(metadataPath(req.path))return next();
   if(!access.operational_access)return res.status(403).json({ok:false,error:'license_required',message:access.has_licenses?'Sua licença está expirada, bloqueada ou vinculada a uma empresa inativa. Consulte suas licenças para renovar ou falar com o suporte.':'Cadastre uma empresa e contrate uma licença para acessar as ferramentas.'});
   const check=(value,ids)=>value==null||value===''||value==='all'||(Array.isArray(value)?value.every(v=>ids.includes(String(v))):ids.includes(String(value)));
   for(const source of [req.query||{},req.body||{}]){
    for(const field of ['license_id','licenseId','license_ids'])if(!check(source[field],access.license_ids))return res.status(403).json({ok:false,error:'license_scope_denied',message:'Esta licença está bloqueada, expirada ou fora dos seus acessos.'});
    for(const field of ['company_id','companyId','company_ids'])if(!check(source[field],access.company_ids))return res.status(403).json({ok:false,error:'license_scope_denied',message:'Esta empresa não possui uma licença válida nos seus acessos.'});
   }
   return next();
  }catch(error){console.error('Portal license validation:',error.code||error.name);return res.status(503).json({ok:false,error:'license_check_unavailable',message:'Não foi possível validar a licença agora. Tente novamente.'});}
 });
 app.get('/api/portal/license-access',(req,res)=>{res.set('Cache-Control','no-store');res.json({ok:true,...req.portalLicenseAccess});});
};
module.exports.activeLicense=activeLicense;module.exports.enforceCompanyMap=enforceCompanyMap;module.exports.entitlements=entitlements;module.exports.metadataPath=metadataPath;
