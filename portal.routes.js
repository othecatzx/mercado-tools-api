// Portal do Cliente ML SH Support — rotas isoladas do painel administrativo.
// Requer tabelas portal_users e portal_user_licenses (migration.sql).
const path = require('path');

module.exports = function registerPortalRoutes(app, { supabase, jwt, bcrypt }) {
  app.use('/portal', require('express').static(path.join(__dirname, 'portal')));

  function authPortal(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ ok: false, error: 'auth_required' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type !== 'portal' || !decoded.portal_user_id) throw new Error('wrong_token_type');
      req.portalUserId = decoded.portal_user_id;
      next();
    } catch (_) {
      return res.status(401).json({ ok: false, error: 'invalid_session' });
    }
  }

  async function getPortalUser(id) {
    const { data, error } = await supabase.from('portal_users')
      .select('id,nome,email,status,created_at').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  // Auth para telas de leitura compartilhadas com subusuários; sempre limita o escopo às licenças autorizadas.
  async function authPortalOrAgent(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ ok: false, error: 'auth_required' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type === 'portal' && decoded.portal_user_id) {
        req.portalUserId = decoded.portal_user_id;
        req.portalRole = 'portal_user';
        return next();
      }
      if (decoded.type !== 'support_agent' || !decoded.support_agent_id) return res.status(401).json({ ok: false, error: 'invalid_session' });
      const { data: agent, error } = await supabase.from('support_agents')
        .select('id,license_id,status,menu_permissions,allowed_license_ids,created_by_portal_user_id,licenses(status)')
        .eq('id', decoded.support_agent_id).maybeSingle();
      if (error) throw error;
      if (!agent || agent.status !== 'active' || agent.licenses?.status !== 'active') return res.status(401).json({ ok: false, error: 'account_unavailable', message: 'Este subusuário ou sua licença está desativado.' });
      const allowed = await getAgentAllowedLicenses(agent);
      if (!allowed.some(l => String(l.id) === String(agent.license_id))) return res.status(401).json({ ok: false, error: 'account_unavailable' });
      req.portalRole = 'support_agent';
      req.supportAgent = agent;
      req.agentAllowedLicenses = allowed;
      req.portalUserId = agent.created_by_portal_user_id;
      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ ok: false, error: 'invalid_session' });
      console.error('Portal scoped auth error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  }

  function scopedMenuAllowed(req, menu) {
    if (req.portalRole !== 'support_agent') return true;
    const menus = Array.isArray(req.supportAgent?.menu_permissions) ? req.supportAgent.menu_permissions : [];
    // Compatibilidade com atendentes criados antes da permissão separada de Pedidos.
    return menus.includes(menu) || (menu === 'orders' && menus.includes('sales'));
  }

  async function getAgentAllowedLicenses(agent) {
    const ids = Array.isArray(agent.allowed_license_ids) && agent.allowed_license_ids.length
      ? [...new Set(agent.allowed_license_ids.map(String))] : [String(agent.license_id)];
    const { data, error } = await supabase.from('licenses')
      .select('id,status,company_id,companies(nome,status)')
      .in('id', ids);
    if (error) throw error;
    const byId = new Map((data || []).map(l => [String(l.id), l]));
    const allowed = [];
    for (const id of ids) {
      const l = byId.get(id);
      if (!l || l.status !== 'active') continue;
      const { data: ownership, error: ownershipError } = await supabase.from('portal_user_licenses')
        .select('license_id').eq('user_id', agent.created_by_portal_user_id).eq('license_id', id).maybeSingle();
      if (ownershipError) throw ownershipError;
      if (ownership) allowed.push({ id: l.id, company_id: l.company_id, company_name: l.companies?.nome || 'Empresa' });
    }
    return allowed;
  }

  app.post('/api/portal/register', async (req, res) => {
    try {
      const nome = String(req.body?.nome || '').trim().slice(0, 100);
      const email = String(req.body?.email || '').trim().toLowerCase();
      const senha = String(req.body?.senha || '');
      if (!nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || senha.length < 8) {
        return res.status(400).json({ ok: false, error: 'invalid_fields', message: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.' });
      }
      const { data: existing, error: lookupError } = await supabase.from('portal_users').select('id').eq('email', email).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) return res.status(409).json({ ok: false, error: 'email_exists', message: 'Já existe uma conta com este e-mail.' });
      const senha_hash = await bcrypt.hash(senha, 12);
      const { data: user, error } = await supabase.from('portal_users')
        .insert({ nome, email, senha_hash, status: 'active' })
        .select('id,nome,email,status,created_at').single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ ok: false, error: 'email_exists', message: 'Já existe uma conta com este e-mail.' });
        throw error;
      }
      const token = jwt.sign({ type: 'portal', portal_user_id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.status(201).json({ ok: true, token, user });
    } catch (error) {
      console.error('Portal register error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível criar a conta agora.' });
    }
  });

  app.post('/api/portal/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const senha = String(req.body?.senha || '');
      if (!email || !senha) return res.status(400).json({ ok: false, error: 'missing_credentials', message: 'Informe e-mail e senha.' });

      // Primeiro preserva o login normal de cliente/administrador do portal.
      const { data: user, error } = await supabase.from('portal_users').select('*').eq('email', email).maybeSingle();
      if (error) throw error;
      if (user) {
        if (user.status !== 'active' || !(await bcrypt.compare(senha, user.senha_hash))) {
          return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'E-mail ou senha incorretos.' });
        }
        const token = jwt.sign({ type: 'portal', portal_user_id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.json({ ok: true, token, user: { id: user.id, nome: user.nome, email: user.email, status: user.status, created_at: user.created_at, role: 'portal_user' } });
      }

      // Se não existir conta principal com esse e-mail, tenta o subusuário cadastrado na equipe.
      const { data: candidates, error: agentError } = await supabase.from('support_agents')
        .select('id,license_id,nome,email,senha_hash,status,permissions,user_management_permissions,menu_permissions,allowed_company_ids,allowed_license_ids,created_by_portal_user_id,licenses(id,status,company_id,companies(nome))')
        .eq('email', email);
      if (agentError) throw agentError;
      const matching = [];
      for (const agent of (candidates || [])) {
        if (agent.status === 'active' && agent.licenses?.status === 'active' && await bcrypt.compare(senha, agent.senha_hash)) matching.push(agent);
      }
      if (matching.length > 1) {
        return res.status(409).json({ ok: false, error: 'agent_email_ambiguous', message: 'Este e-mail está cadastrado em mais de uma equipe. Peça ao administrador para usar um e-mail exclusivo para este subusuário.' });
      }
      const agent = matching[0];
      if (!agent) return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'E-mail ou senha incorretos.' });
      const allowed_licenses = await getAgentAllowedLicenses(agent);
      if (!allowed_licenses.some(l => String(l.id) === String(agent.license_id))) return res.status(401).json({ ok:false, error:'account_unavailable', message:'A licença principal deste atendente não está mais vinculada ao administrador.' });
      const token = jwt.sign({ type: 'support_agent', support_agent_id: agent.id, license_id: agent.license_id, email: agent.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({ ok: true, token, user: { id: agent.id, nome: agent.nome, email: agent.email, status: agent.status, role: 'support_agent', license_id: agent.license_id, permissions: agent.permissions || [], user_management_permissions: agent.user_management_permissions || [], menu_permissions: Array.isArray(agent.menu_permissions) ? agent.menu_permissions : ['chat'], allowed_company_ids: agent.allowed_company_ids || [], allowed_license_ids: allowed_licenses.map(l=>l.id), allowed_licenses, company_name: agent.licenses?.companies?.nome || 'Empresa' } });
    } catch (error) {
      console.error('Portal login error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível entrar agora.' });
    }
  });

  // /me aceita os dois tipos de sessão; os endpoints administrativos continuam exigindo token type=portal.
  app.get('/api/portal/me', async (req, res) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ ok: false, error: 'auth_required' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type === 'support_agent' && decoded.support_agent_id) {
        const { data: agent, error } = await supabase.from('support_agents')
          .select('id,license_id,nome,email,status,permissions,user_management_permissions,menu_permissions,allowed_company_ids,allowed_license_ids,created_by_portal_user_id,licenses(id,status,companies(nome))')
          .eq('id', decoded.support_agent_id).maybeSingle();
        if (error) throw error;
        if (!agent || agent.status !== 'active' || agent.licenses?.status !== 'active') return res.status(401).json({ ok: false, error: 'account_unavailable', message: 'Este subusuário ou sua licença está desativado.' });
        const allowed_licenses = await getAgentAllowedLicenses(agent);
        if (!allowed_licenses.some(l => String(l.id) === String(agent.license_id))) return res.status(401).json({ ok:false, error:'account_unavailable', message:'A licença principal deste atendente não está mais vinculada ao administrador.' });
        return res.json({ ok: true, user: { id: agent.id, nome: agent.nome, email: agent.email, status: agent.status, role: 'support_agent', license_id: agent.license_id, permissions: agent.permissions || [], user_management_permissions: agent.user_management_permissions || [], menu_permissions: Array.isArray(agent.menu_permissions) ? agent.menu_permissions : ['chat'], allowed_company_ids: agent.allowed_company_ids || [], allowed_license_ids: allowed_licenses.map(l=>l.id), allowed_licenses, company_name: agent.licenses?.companies?.nome || 'Empresa' } });
      }
      if (decoded.type !== 'portal' || !decoded.portal_user_id) return res.status(401).json({ ok: false, error: 'invalid_session' });
      const user = await getPortalUser(decoded.portal_user_id);
      if (!user || user.status !== 'active') return res.status(401).json({ ok: false, error: 'account_unavailable' });
      return res.json({ ok: true, user: { ...user, role: 'portal_user' } });
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ ok: false, error: 'invalid_session' });
      console.error('Portal me error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/portal/licenses', authPortalOrAgent, async (req, res) => {
    try {
      if (!scopedMenuAllowed(req, 'licenses')) return res.status(403).json({ ok: false, error: 'menu_not_allowed', message: 'O administrador não liberou Minhas licenças para esta conta.' });
      if (req.portalRole === 'support_agent') {
        const ids = req.agentAllowedLicenses.map(l => String(l.id));
        if (!ids.length) return res.json({ ok: true, licenses: [] });
        const { data, error } = await supabase.from('licenses')
          .select('id,chave,status,inicio,vencimento,company_id,created_at,companies(id,nome,documento,status,codigo_ml)')
          .in('id', ids).order('created_at', { ascending: false });
        if (error) throw error;
        return res.json({ ok: true, licenses: (data || []).map(l => ({ id:l.id, chave:l.chave, status:l.status, inicio:l.inicio, vencimento:l.vencimento, company_id:l.company_id, added_at:l.created_at, company:{ id:l.companies?.id, nome:l.companies?.nome || 'Empresa', documento:l.companies?.documento || null, status:l.companies?.status || 'unknown', codigo_ml:l.companies?.codigo_ml || null } })) });
      }
      const { data, error } = await supabase.from('portal_user_licenses')
        .select('id,created_at,licenses(id,chave,status,inicio,vencimento,company_id,companies(id,nome,documento,status))')
        .eq('user_id', req.portalUserId).order('created_at', { ascending: false });
      if (error) throw error;
      const licenses = (data || []).map(row => {
        const l = row.licenses || {};
        const c = l.companies || {};
        return { link_id: row.id, added_at: row.created_at, id: l.id, chave: l.chave, status: l.status,
          inicio: l.inicio, vencimento: l.vencimento, company_id: l.company_id,
          company: { id: c.id, nome: c.nome || 'Empresa não identificada', documento: c.documento || null, status: c.status || 'unknown', codigo_ml: c.codigo_ml || null } };
      });
      return res.json({ ok: true, licenses });
    } catch (error) {
      console.error('Portal licenses error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar as licenças.' });
    }
  });

  app.post('/api/portal/licenses', authPortal, async (req, res) => {
    try {
      const chave = String(req.body?.chave || '').trim();
      if (!chave || chave.length > 200) return res.status(400).json({ ok: false, error: 'invalid_license', message: 'Informe uma chave de licença válida.' });
      const { data: license, error: licenseError } = await supabase.from('licenses')
        .select('id,chave,status,inicio,vencimento,company_id').eq('chave', chave).maybeSingle();
      if (licenseError) throw licenseError;
      if (!license) return res.status(404).json({ ok: false, error: 'license_not_found', message: 'Não encontramos essa licença. Confira a chave e tente novamente.' });
      const { data: company, error: companyError } = await supabase.from('companies')
        .select('id,nome,documento,status,codigo_ml').eq('id', license.company_id).maybeSingle();
      if (companyError) throw companyError;
      if (!company) return res.status(404).json({ ok: false, error: 'company_not_found', message: 'A empresa desta licença não foi encontrada.' });
      const { data: currentLink, error: currentError } = await supabase.from('portal_user_licenses')
        .select('id,user_id').eq('license_id', license.id).maybeSingle();
      if (currentError) throw currentError;
      if (currentLink?.user_id === req.portalUserId) return res.status(409).json({ ok: false, error: 'license_already_added', message: 'Essa licença já está na sua conta.' });
      if (currentLink && currentLink.user_id !== req.portalUserId) return res.status(409).json({ ok: false, error: 'license_claimed', message: 'Essa licença já está vinculada a outra conta. Entre em contato com o suporte se acredita que isso é um erro.' });
      const { error: insertError } = await supabase.from('portal_user_licenses').insert({ user_id: req.portalUserId, license_id: license.id });
      if (insertError) {
        if (insertError.code === '23505') return res.status(409).json({ ok: false, error: 'license_claimed', message: 'Essa licença já está vinculada a uma conta.' });
        throw insertError;
      }
      return res.status(201).json({ ok: true, license: { id: license.id, chave: license.chave, status: license.status, inicio: license.inicio, vencimento: license.vencimento, company } });
    } catch (error) {
      console.error('Portal add license error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível cadastrar a licença.' });
    }
  });

  // Códigos da Agência: mostra todas as empresas vinculadas à conta do portal,
  // buscando primeiro o código capturado diariamente em company_ml_codes.
  app.get('/api/portal/codes', async (req, res) => {
    try {
      const header = req.headers.authorization || '';
      const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!bearer) return res.status(401).json({ ok: false, error: 'auth_required' });
      let decoded;
      try { decoded = jwt.verify(bearer, process.env.JWT_SECRET); }
      catch (_) { return res.status(401).json({ ok: false, error: 'invalid_session' }); }

      let companies = new Map();
      if (decoded.type === 'portal' && decoded.portal_user_id) {
        const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
          .select('licenses(company_id,companies(id,nome,codigo_ml,status))')
          .eq('user_id', decoded.portal_user_id);
        if (linkError) throw linkError;
        for (const row of links || []) {
          const company = row.licenses?.companies;
          if (company?.id && !companies.has(String(company.id))) companies.set(String(company.id), company);
        }
      } else if (decoded.type === 'support_agent' && decoded.support_agent_id) {
        const { data: agent, error: agentError } = await supabase.from('support_agents')
          .select('id,license_id,status,menu_permissions,allowed_license_ids,created_by_portal_user_id')
          .eq('id', decoded.support_agent_id).maybeSingle();
        if (agentError) throw agentError;
        if (!agent || agent.status !== 'active') return res.status(403).json({ ok: false, error: 'agent_inactive' });
        if (!Array.isArray(agent.menu_permissions) || !agent.menu_permissions.includes('codes')) return res.status(403).json({ ok: false, error: 'menu_not_allowed', message: 'O administrador não liberou Códigos ML para esta conta.' });
        const ids = Array.isArray(agent.allowed_license_ids) && agent.allowed_license_ids.length ? [...new Set(agent.allowed_license_ids.map(String))] : [String(agent.license_id)];
        const { data: ownedLinks, error: ownedError } = await supabase.from('portal_user_licenses')
          .select('license_id').eq('user_id', agent.created_by_portal_user_id).in('license_id', ids);
        if (ownedError) throw ownedError;
        const ownedIds = [...new Set((ownedLinks || []).map(x => String(x.license_id)))];
        if (!ownedIds.length) return res.json({ ok: true, codes: [] });
        const { data: licenses, error: licensesError } = await supabase.from('licenses')
          .select('id,status,company_id,companies(id,nome,codigo_ml,status)')
          .in('id', ownedIds).eq('status', 'active');
        if (licensesError) throw licensesError;
        for (const license of licenses || []) {
          const company = license.companies;
          if (company?.id && !companies.has(String(company.id))) companies.set(String(company.id), company);
        }
      } else {
        return res.status(401).json({ ok: false, error: 'invalid_session' });
      }
      const companyIds = [...companies.keys()];
      if (!companyIds.length) return res.json({ ok: true, codes: [] });

      const { data: capturedRows, error: capturedError } = await supabase
        .from('company_ml_codes')
        .select('company_id,code,code_date,updated_at')
        .in('company_id', companyIds)
        .order('code_date', { ascending: false })
        .order('updated_at', { ascending: false });
      if (capturedError) throw capturedError;

      const latestCodeByCompany = new Map();

for (const row of capturedRows || []) {
  const key = String(row.company_id);

  if (!latestCodeByCompany.has(key) && String(row.code || '').trim()) {
    latestCodeByCompany.set(key, {
      code: String(row.code).trim(),
      updated_at: row.updated_at || row.code_date || null
    });
  }
}

const codes = [...companies.entries()].map(([companyId, company]) => {
  const latest = latestCodeByCompany.get(companyId);

  return {
    company_id: company.id,
    name: company.nome || 'Empresa',
    code: latest?.code || String(company.codigo_ml || '').trim() || null,
    updated_at: latest?.updated_at || null,
    status: company.status || 'unknown'
  };
});


      return res.json({ ok: true, codes });
    } catch (error) {
      console.error('Portal codes error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar os códigos das lojas.' });
    }
  });

  // Anúncios de baixo valor com frete grátis opcional: permite transferir o custo ao comprador.
  async function getShippingAccounts(req) {
    const companies = new Map();
    if (req.portalRole === 'support_agent') {
      const ids = req.agentAllowedLicenses.map(l => String(l.id));
      if (ids.length) {
        const { data, error } = await supabase.from('licenses')
          .select('id,company_id,companies(id,nome,status)').in('id', ids).eq('status', 'active');
        if (error) throw error;
        for (const l of data || []) if (l.companies?.id) companies.set(String(l.company_id), l.companies);
      }
    } else {
      const { data, error } = await supabase.from('portal_user_licenses')
        .select('licenses(company_id,companies(id,nome,status))').eq('user_id', req.portalUserId);
      if (error) throw error;
      for (const row of data || []) { const c = row.licenses?.companies; if (c?.id) companies.set(String(row.licenses.company_id), c); }
    }
    const ids = [...companies.keys()];
    if (!ids.length) return [];
    const { data: accounts, error } = await supabase.from('mercadolivre_accounts')
      .select('company_id,ml_user_id,nickname,access_token,refresh_token,token_expires_at')
      .in('company_id', ids);
    if (error) throw error;
    return (accounts || []).map(a => ({ ...a, company_name: companies.get(String(a.company_id))?.nome || 'Empresa' }));
  }

  async function ensureMlToken(account) {
    let accessToken = account.access_token;
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
    if (expiresAt && expiresAt <= Date.now() + 120000) {
      if (!account.refresh_token || !process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET) throw new Error('Token expirado; reconecte a conta Mercado Livre.');
      const response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID, client_secret: process.env.ML_CLIENT_SECRET, refresh_token: account.refresh_token })
      });
      const refreshed = await response.json();
      if (!response.ok) throw new Error(refreshed.message || 'Não foi possível renovar o token do Mercado Livre.');
      accessToken = refreshed.access_token;
      await supabase.from('mercadolivre_accounts').update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || account.refresh_token, token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 0) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('company_id', account.company_id);
    }
    if (!accessToken) throw new Error('Conta sem token de acesso.');
    return accessToken;
  }

  app.get('/api/portal/shipping-items', authPortalOrAgent, async (req, res) => {
    try {
      if (!scopedMenuAllowed(req, 'shipping')) return res.status(403).json({ ok: false, error: 'menu_not_allowed', message: 'O administrador não liberou esta ferramenta para sua conta.' });
      const accounts = await getShippingAccounts(req);
      const items = [], stores = [];
      // Cada loja tem prazo total; nenhuma paginação pode prender a tela indefinidamente.
      for (const account of accounts) {
        const storeStartedAt = Date.now();
        const storeDeadline = storeStartedAt + 90000;
        const requestMl = (url, options = {}) => {
          const remaining = storeDeadline - Date.now();
          if (remaining <= 0) throw new Error('Tempo limite de 90 segundos atingido nesta loja; consulta parcial interrompida.');
          return fetch(url, { ...options, signal: AbortSignal.timeout(Math.min(18000, remaining)) });
        };
        try {
          const accessToken = await ensureMlToken(account);
          const allIds = new Set();
          let pagesScanned = 0;
          let scanTruncated = false;
          for (const status of ['active']) {
            let scrollId = null;
            const seenPageSignatures = new Set();
            let statusPages = 0;
            while (statusPages < 60) {
              const url = new URL(`https://api.mercadolibre.com/users/${encodeURIComponent(account.ml_user_id)}/items/search`);
              const params = new URLSearchParams({ status, search_type: 'scan', limit: '100' });
              if (scrollId) params.set('scroll_id', scrollId);
              url.search = params.toString();
              const response = await requestMl(url, { headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' } });
              const data = await response.json();
              if (!response.ok) throw new Error(data.message || `Falha ao consultar anúncios ${status} (HTTP ${response.status}).`);
              const page = Array.isArray(data.results) ? data.results : [];
              if (!page.length) break;
              // Alguns retornos mantêm o mesmo scroll_id; a assinatura evita repetir uma página sem interromper a paginação válida.
              const signature = page.join(',');
              if (seenPageSignatures.has(signature)) break;
              seenPageSignatures.add(signature);
              for (const id of page) allIds.add(id);
              pagesScanned++;
              statusPages++;
              const nextScroll = data.scroll_id || null;
              if (!nextScroll) break;
              scrollId = nextScroll;
            }
            if (statusPages >= 60) scanTruncated = true;
          }

          const ids = [...allIds];
          // Detalhes em grupos pequenos e paralelos, evitando dezenas de chamadas sequenciais.
          const batches = [];
          for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20));
          for (let i = 0; i < batches.length; i += 4) {
            const responses = await Promise.all(batches.slice(i, i + 4).map(async batch => {
              const response = await requestMl('https://api.mercadolibre.com/items?ids=' + encodeURIComponent(batch.join(',')), {
                headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.message || `Falha ao carregar detalhes dos anúncios (HTTP ${response.status}).`);
              return data;
            }));
            for (const data of responses) {
              for (const entry of data || []) {
                const item = entry.body;
                if (entry.code !== 200 || !item || Number(item.price) > 78.99 || Number(item.price) <= 0) continue;
                if (item.status !== 'active' || item.shipping?.free_shipping !== true) continue;
                const tags = item.shipping?.tags || [];
                const catalogFamily = Boolean(item.catalog_product_id || item.catalog_listing || item.family_name || item.parent_item_id);
                items.push({
                  id: item.id, title: item.title, price: item.price, currency_id: item.currency_id || 'BRL',
                  permalink: item.permalink, thumbnail: item.thumbnail, status: item.status,
                  company_id: account.company_id, company_name: account.company_name, seller_id: account.ml_user_id,
                  shipping_mode: item.shipping?.mode || '', logistic_type: item.shipping?.logistic_type || '',
                  mandatory_free_shipping: tags.includes('mandatory_free_shipping'),
                  catalog_product_id: item.catalog_product_id || null, catalog_listing: Boolean(item.catalog_listing),
                  family_name: item.family_name || null, parent_item_id: item.parent_item_id || null,
                  catalog_family: catalogFamily
                });
              }
            }
          }
          stores.push({ company_id: account.company_id, company_name: account.company_name, nickname: account.nickname || 'Conta Mercado Livre', connected: true, total_scanned: ids.length, pages_scanned: pagesScanned, eligible_count: items.filter(x => String(x.company_id) === String(account.company_id)).length, scan_truncated: scanTruncated, duration_ms: Date.now() - storeStartedAt, warning: scanTruncated ? 'Limite de 6.000 anúncios por status atingido; consulta parcial.' : null });
        } catch (e) {
          stores.push({ company_id: account.company_id, company_name: account.company_name, nickname: account.nickname || 'Conta Mercado Livre', connected: false, error: e.name === 'TimeoutError' ? 'O Mercado Livre demorou demais para responder. Tente atualizar novamente.' : e.message, duration_ms: Date.now() - storeStartedAt });
        }
      }
      return res.json({ ok: true, items, stores, max_price: 78.99, included_statuses: ['active'], partial: stores.some(s => !s.connected || s.scan_truncated) });
    } catch (error) {
      console.error('Portal shipping items error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: error.message || 'Não foi possível carregar os anúncios.' });
    }
  });

  // Diagnóstico individual, incluindo estado pausado e dados de catálogo/família.
  app.get('/api/portal/shipping-items/diagnose/:id', authPortalOrAgent, async (req, res) => {
    try {
      if (!scopedMenuAllowed(req, 'shipping')) return res.status(403).json({ ok: false, error: 'menu_not_allowed', message: 'O administrador não liberou esta ferramenta para sua conta.' });
      const id = String(req.params.id || '').trim().toUpperCase();
      if (!/^MLB\d+$/.test(id)) return res.status(400).json({ ok: false, error: 'invalid_item', message: 'Informe um MLB válido.' });
      const accounts = await getShippingAccounts(req);
      const checked = [];
      for (const account of accounts) {
        try {
          const accessToken = await ensureMlToken(account);
          const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' } });
          const item = await response.json();
          if (response.status === 404) continue;
          if (!response.ok) { checked.push({ company_name: account.company_name, error: item.message || `HTTP ${response.status}` }); continue; }
          if (String(item.seller_id) !== String(account.ml_user_id)) continue;
          const reasons = [];
          if (item.status !== 'active') reasons.push(`Status não suportado para alteração (${item.status || 'desconhecido'}).`);
          if (!(Number(item.price) > 0 && Number(item.price) <= 78.99)) reasons.push(`Preço fora do limite (R$ ${Number(item.price || 0).toFixed(2)}; máximo R$ 78,99).`);
          if (item.shipping?.free_shipping !== true) reasons.push('O campo shipping.free_shipping não está true.');
          if ((item.shipping?.tags || []).includes('mandatory_free_shipping')) reasons.push('O Mercado Livre marca este anúncio com frete grátis obrigatório.');
          const catalogFamily = Boolean(item.catalog_product_id || item.catalog_listing || item.family_name || item.parent_item_id);
          checked.push({
            found: true, id: item.id, title: item.title, price: item.price, status: item.status,
            free_shipping: item.shipping?.free_shipping, mode: item.shipping?.mode || null,
            logistic_type: item.shipping?.logistic_type || null, tags: item.shipping?.tags || [],
            seller_id: item.seller_id, company_id: account.company_id, company_name: account.company_name,
            catalog_family: catalogFamily, catalog_product_id: item.catalog_product_id || null,
            catalog_listing: Boolean(item.catalog_listing), family_name: item.family_name || null,
            parent_item_id: item.parent_item_id || null,
            eligible: reasons.length === 0, reasons: reasons.length ? reasons : ['O anúncio atende aos filtros de preço, status e frete. A alteração ainda depende da validação do Mercado Livre.'],
            permalink: item.permalink
          });
        } catch (e) { checked.push({ company_name: account.company_name, error: e.message }); }
      }
      const found = checked.find(x => x.found);
      return res.json({ ok: true, id, result: found || null, checked_accounts: checked.length, accounts: checked.filter(x => x.error) });
    } catch (error) {
      console.error('Portal shipping diagnose error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: error.message || 'Não foi possível diagnosticar o anúncio.' });
    }
  });

  app.post('/api/portal/shipping-items/buyer-pays', authPortalOrAgent, async (req, res) => {
    try {
      if (!scopedMenuAllowed(req, 'shipping')) return res.status(403).json({ ok: false, error: 'menu_not_allowed', message: 'O administrador não liberou esta ferramenta para sua conta.' });
      const requested = (Array.isArray(req.body?.items) ? req.body.items : []).map(x => ({ id: String(x?.id || '').trim(), company_id: String(x?.company_id || '').trim() })).filter(x => /^MLB\d+$/.test(x.id) && x.company_id).filter((x, i, a) => a.findIndex(y => y.id === x.id && y.company_id === x.company_id) === i).slice(0, 200);
      if (!requested.length) return res.status(400).json({ ok: false, error: 'empty_selection', message: 'Selecione pelo menos um anúncio válido.' });
      const accounts = await getShippingAccounts(req);
      const result = { success: [], failed: [], skipped: [] };
      for (const account of accounts) {
        const assigned = requested.filter(item => String(item.company_id) === String(account.company_id));
        if (!assigned.length) continue;
        let accessToken;
        try { accessToken = await ensureMlToken(account); } catch (e) { for (const item of assigned) result.failed.push({ id: item.id, error: e.message }); continue; }
        for (const selected of assigned) {
          const id = selected.id;
          try {
            const check = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' } });
            const item = await check.json();
            if (!check.ok || String(item.seller_id) !== String(account.ml_user_id)) continue;
            if (Number(item.price) > 78.99 || item.shipping?.free_shipping !== true || item.status !== 'active') { result.skipped.push({ id, reason: 'O anúncio não atende aos filtros de preço, status ativo ou frete.' }); continue; }
            if ((item.shipping?.tags || []).includes('mandatory_free_shipping')) { result.skipped.push({ id, reason: 'O Mercado Livre exige frete grátis neste anúncio.' }); continue; }
            const update = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ shipping: { free_shipping: false } }) });
            const updated = await update.json();
            if (!update.ok) throw new Error(updated.message || updated.error || 'O Mercado Livre recusou a alteração.');
            result.success.push({ id, title: item.title, status: item.status, catalog_family: Boolean(item.catalog_product_id || item.catalog_listing || item.family_name || item.parent_item_id), note: item.status === 'paused' ? 'Frete alterado sem reativar o anúncio.' : undefined });
          } catch (e) { result.failed.push({ id, error: e.message }); }
        }
      }
      const processed = new Set([...result.success.map(x => x.id), ...result.failed.map(x => x.id), ...result.skipped.map(x => x.id)]);
      for (const item of requested) if (!processed.has(item.id)) result.failed.push({ id: item.id, error: 'Não foi possível identificar a conta Mercado Livre proprietária deste anúncio.' });
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error('Portal shipping update error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: error.message || 'Não foi possível alterar os anúncios.' });
    }
  });

  // Vendas reais das contas do Mercado Livre conectadas às empresas licenciadas.
  app.get('/api/portal/sales', authPortalOrAgent, async (req, res) => {
    try {
      const todayOnly = req.query.today === '1';
      const days = Math.max(1, Math.min(90, Number.parseInt(req.query.days, 10) || 30));
      const offsetDays = Math.max(0, Math.min(180, Number.parseInt(req.query.offsetDays, 10) || 0));
      const summaryOnly = req.query.summaryOnly === '1';
      if (!scopedMenuAllowed(req, todayOnly ? 'orders' : 'sales')) return res.status(403).json({ ok: false, error: 'menu_not_allowed', message: todayOnly ? 'O administrador não liberou Pedidos para esta conta.' : 'O administrador não liberou Analytics de Vendas para esta conta.' });
      const companies = new Map();
      if (req.portalRole === 'support_agent') {
        const ids = req.agentAllowedLicenses.map(l => String(l.id));
        if (ids.length) {
          const { data: allowedLicenses, error: allowedError } = await supabase.from('licenses')
            .select('id,company_id,companies(id,nome,status)').in('id', ids).eq('status', 'active');
          if (allowedError) throw allowedError;
          for (const license of allowedLicenses || []) { const c = license.companies; if (c?.id) companies.set(c.id, c); }
        }
      } else {
        const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
          .select('licenses(company_id,companies(id,nome,status))').eq('user_id', req.portalUserId);
        if (linkError) throw linkError;
        for (const row of links || []) { const c = row.licenses?.companies; if (c?.id) companies.set(c.id, c); }
      }
      const companyIds = [...companies.keys()];
      if (!companyIds.length) return res.json({ ok: true, days, connected: 0, totals: { orders: 0, revenue: 0 }, stores: [] });

      const { data: accounts, error: accountError } = await supabase.from('mercadolivre_accounts')
        .select('company_id,ml_user_id,nickname,access_token,refresh_token,token_expires_at')
        .in('company_id', companyIds);
      if (accountError) throw accountError;

      const stores = [];
      const allProducts = [];
      const allOrders = [];
      let totalUnits = 0;
      const connectedCompanyIds = new Set((accounts || []).map(a => String(a.company_id)));
      for (const [companyId, company] of companies.entries()) {
        if (!connectedCompanyIds.has(String(companyId))) {
          stores.push({
            company_id: companyId,
            company_name: company.nome || 'Empresa',
            nickname: 'Conta não conectada',
            connected: false,
            error: 'Conecte a conta Mercado Livre desta empresa pelo fluxo de autorização já existente.',
            orders: 0,
            revenue: 0
          });
        }
      }
      const now = Date.now();
      let to, from, todayLocalDate = null;
      if (todayOnly) {
        // Esta tela é uma FILA OPERACIONAL, não um relatório de vendas criadas hoje.
        // A página do Mercado Livre considera vendas dos últimos 2 meses. Buscamos
        // uma janela de 4 dias para limitar o volume consultado. A situação é determinada pelo envio atual.
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
        const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]));
        todayLocalDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
        from = new Date(now - 4 * 86400000).toISOString();
        to = new Date(now).toISOString();
      } else {
        to = new Date(now - offsetDays * 86400000).toISOString();
        from = new Date(now - (offsetDays + days) * 86400000).toISOString();
      }

      for (const account of accounts || []) {
        const company = companies.get(account.company_id);
        let accessToken = account.access_token;
        try {
          if (!accessToken) throw new Error('Conta sem token de acesso');
          const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
          if (expiresAt && expiresAt <= now + 120000) {
            if (!account.refresh_token || !process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET) throw new Error('Token expirado; reconecte a conta Mercado Livre');
            const refreshResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
              body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID, client_secret: process.env.ML_CLIENT_SECRET, refresh_token: account.refresh_token })
            });
            const refreshed = await refreshResponse.json();
            if (!refreshResponse.ok) throw new Error('Não foi possível renovar o token do Mercado Livre');
            accessToken = refreshed.access_token;
            await supabase.from('mercadolivre_accounts').update({
              access_token: refreshed.access_token,
              refresh_token: refreshed.refresh_token || account.refresh_token,
              token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 0) * 1000).toISOString(),
              updated_at: new Date().toISOString()
            }).eq('company_id', account.company_id);
          }

          // Busca todos os pedidos do período. A API limita o offset; quando
          // uma faixa excede 10.000 resultados, dividimos o período em janelas menores.
          const pageSize = 50;
          const maxOffsetRange = 10000;
          const orderMap = new Map();
          const fetchOrdersRange = async (rangeFrom, rangeTo, depth = 0, dateFilter = 'order.date_created') => {
            const fetchPage = async (offset) => {
              const params = new URLSearchParams({
                seller: String(account.ml_user_id),
                [`${dateFilter}.from`]: rangeFrom,
                [`${dateFilter}.to`]: rangeTo,
                limit: String(pageSize),
                offset: String(offset),
                sort: 'date_desc'
              });
              const response = await fetch('https://api.mercadolibre.com/orders/search?' + params.toString(), {
                headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.message || 'Falha ao consultar pedidos');
              return result;
            };

            const firstPage = await fetchPage(0);
            const rangeTotal = Number(firstPage.paging?.total || 0);
            const startMs = new Date(rangeFrom).getTime();
            const endMs = new Date(rangeTo).getTime();
            if (rangeTotal > maxOffsetRange && depth < 16 && endMs - startMs > 1000) {
              const middle = new Date(Math.floor((startMs + endMs) / 2)).toISOString();
              await fetchOrdersRange(rangeFrom, middle, depth + 1, dateFilter);
              await fetchOrdersRange(middle, rangeTo, depth + 1, dateFilter);
              return;
            }

            const addResults = (results) => {
              for (const order of results || []) {
                const id = order.id ?? `${order.date_created || ''}:${order.total_amount || 0}`;
                orderMap.set(String(id), order);
              }
            };
            addResults(firstPage.results);
            for (let offset = pageSize; offset < Math.min(rangeTotal, maxOffsetRange); offset += pageSize) {
              const page = await fetchPage(offset);
              addResults(page.results);
              if ((page.results || []).length < pageSize) break;
            }
          };
          // Busca por data de criação em uma janela histórica para localizar
          // pedidos ainda abertos, mesmo que a venda tenha sido feita em outro dia.
          // A data da venda NÃO define se precisa separar: isso vem do envio atual.
          await fetchOrdersRange(from, to, 0, 'order.date_created');
          let orders = [...orderMap.values()];
          const localDay = value => {
            if (!value) return '';
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
            const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
            return `${values.year}-${values.month}-${values.day}`;
          };
          if (!summaryOnly) {
            // O /orders/search frequentemente retorna apenas o ID do envio. Consultamos
            // /shipments/{id} para obter status e substatus reais da etiqueta.
            const shipmentIds = [...new Set(orders.map(order => String(order.shipping?.id || '')).filter(Boolean))];
            const shipmentDetails = new Map();
            let shipmentIndex = 0;
            const shipmentWorker = async () => {
              while (shipmentIndex < shipmentIds.length) {
                const shipmentId = shipmentIds[shipmentIndex++];
                try {
                  const shipmentResponse = await fetch('https://api.mercadolibre.com/shipments/' + encodeURIComponent(shipmentId), {
                    headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
                  });
                  if (shipmentResponse.ok) shipmentDetails.set(shipmentId, await shipmentResponse.json());
                } catch (_) { /* Mantém os dados do pedido quando o detalhe do envio falhar. */ }
              }
            };
            await Promise.all(Array.from({ length: Math.min(6, shipmentIds.length) }, () => shipmentWorker()));

            // Na fila operacional, considera também o prazo oficial de despacho do SLA.
            // Pedidos com expected_date em dias futuros não entram na fila de hoje.
            // Se o endpoint de SLA falhar ou não retornar expected_date, preservamos
            // o comportamento anterior para não esconder pedidos por falha temporária da API.
            const shipmentSlas = new Map();
            if (todayOnly) {
              let slaIndex = 0;
              const slaWorker = async () => {
                while (slaIndex < shipmentIds.length) {
                  const shipmentId = shipmentIds[slaIndex++];
                  try {
                    const slaResponse = await fetch('https://api.mercadolibre.com/shipments/' + encodeURIComponent(shipmentId) + '/sla', {
                      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
                    });
                    if (slaResponse.ok) {
                      const sla = await slaResponse.json();
                      if (sla && typeof sla === 'object') shipmentSlas.set(shipmentId, sla);
                    }
                  } catch (_) { /* SLA indisponível: mantém a regra anterior para este envio. */ }
                }
              };
              await Promise.all(Array.from({ length: Math.min(6, shipmentIds.length) }, () => slaWorker()));
            }

            // Carrega título, SKU e foto dos anúncios exibidos na fila operacional.
            const queueItemIds = [...new Set(orders
              .filter(order => ['paid', 'confirmed', 'cancelled'].includes(String(order.status || '').toLowerCase()))
              .flatMap(order => (order.order_items || []).map(line => String(line.item?.id || line.item_id || '').trim()))
              .filter(Boolean))];
            const itemDetails = new Map();
            let itemIndex = 0;
            const itemWorker = async () => {
              while (itemIndex < queueItemIds.length) {
                const itemId = queueItemIds[itemIndex++];
                try {
                  const itemResponse = await fetch('https://api.mercadolibre.com/items/' + encodeURIComponent(itemId), {
                    headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
                  });
                  if (itemResponse.ok) itemDetails.set(itemId, await itemResponse.json());
                } catch (_) { /* Os dados do pedido continuam disponíveis sem os detalhes do anúncio. */ }
              }
            };
            await Promise.all(Array.from({ length: Math.min(8, queueItemIds.length) }, () => itemWorker()));

            // Histórico persistente da fila: só um pedido que já apareceu em
            // 'Precisa separar' ou 'Já separados' pode entrar em 'Cancelados'.
            // Consultamos o histórico antes de classificar o status atual.
            const queueHistoryByOrder = new Map();
            const historyOrderIds = [...new Set(orders.map(order => String(order.id || '')).filter(Boolean))];
            for (let i = 0; i < historyOrderIds.length; i += 500) {
              const batch = historyOrderIds.slice(i, i + 500);
              const { data: historyRows, error: historyError } = await supabase
                .from('ml_order_queue_history')
                .select('order_id,was_in_queue,last_order_status,cancelled_at')
                .eq('company_id', account.company_id)
                .in('order_id', batch);
              if (historyError) throw new Error('Falha ao consultar histórico da fila. Execute a migration ml_order_queue_history.sql no Supabase. ' + historyError.message);
              for (const row of historyRows || []) queueHistoryByOrder.set(String(row.order_id), row);
            }
            const queueHistoryUpserts = [];

            for (const order of orders) {
              const orderShipping = order.shipping || {};
              const shipmentId = String(orderShipping.id || '');
              const shipment = shipmentDetails.get(shipmentId) || {};
              const shipping = { ...orderShipping, ...shipment };
              const shipmentSla = shipmentSlas.get(shipmentId) || {};
              const dispatchDeadline = shipmentSla.expected_date || null;
              const dispatchDeadlineDay = dispatchDeadline ? localDay(dispatchDeadline) : '';
              // Mostra hoje e prazos vencidos. Se o SLA informa uma data futura,
              // o pedido fica fora da fila operacional até chegar o dia do despacho.
              const dispatchDateAllowsQueue = !todayOnly || !dispatchDeadlineDay
                || !todayLocalDate || dispatchDeadlineDay <= todayLocalDate;
              const orderStatus = String(order.status || '').toLowerCase();
              const shippingStatus = String(shipping.status || '').toLowerCase();
              const shippingSubstatus = String(shipping.substatus || '').toLowerCase();
              const shipmentType = String(shipping.type || '').toLowerCase();
              const orderTags = [
                ...(Array.isArray(order.tags) ? order.tags : []),
                ...(Array.isArray(shipping.tags) ? shipping.tags : [])
              ].map(tag => String(tag || '').toLowerCase());
              const shippingLogisticType = String(shipping.logistic_type || orderShipping.logistic_type || '').toLowerCase();
              const shippingMode = String(shipping.mode || orderShipping.mode || '').toLowerCase();
              const printedSubstatuses = new Set([
                'printed', 'label_printed', 'printed_label', 'label_printed_by_seller',
                'label_printed_by_seller', 'printed_by_seller',
                'ready_to_pickup', 'ready_for_pickup', 'waiting_for_pickup', 'ready_to_collect'
              ]);
              const blockedShippingStates = new Set(['in_hub', 'buffered']);
              const cancellationStatuses = new Set(['cancelled', 'canceled']);
              const cancellationSubstatuses = new Set(['cancelled_by_seller', 'cancelled_by_buyer']);
              // in_packing_list significa que o pacote já está em preparação/a caminho;
              // nunca deve aparecer como 'Precisa separar'.
              const alreadyInPackingList = shippingStatus === 'in_packing_list' || shippingSubstatus === 'in_packing_list';
              const returnOrClaimTags = new Set([
                'return', 'returned', 'returning', 'return_in_process', 'returning_to_seller',
                'refund', 'refunded', 'partially_refunded', 'claim', 'has_claim', 'claim_opened', 'dispute'
              ]);
              const hasReturnOrClaim = shipmentType === 'return' || orderTags.some(tag => returnOrClaimTags.has(tag));
              const delivered = shippingStatus === 'delivered' || shippingSubstatus === 'delivered'
                || Boolean(shipping.date_delivered || shipment.date_delivered || shipping.status_history?.date_delivered || shipment.status_history?.date_delivered);
              const dispatched =
  ['picked_up', 'shipped', 'in_transit'].includes(shippingStatus) ||
  ['picked_up', 'shipped', 'in_transit'].includes(shippingSubstatus);
              const isForwardShipment = shipmentType !== 'return';
              // Cancelado operacional é uma mudança de status: o pedido precisa
              // ter sido visto anteriormente em uma das duas filas ativas.
              // Não dependemos de substatus/data do envio, que frequentemente não
              // vêm preenchidos pela API do Mercado Livre.
              const previousQueueHistory = queueHistoryByOrder.get(String(order.id || ''));
              const wasPreviouslyInQueue = previousQueueHistory?.was_in_queue === true
                && !cancellationStatuses.has(String(previousQueueHistory.last_order_status || '').toLowerCase());
              const cancellationAlreadyRecorded = previousQueueHistory?.was_in_queue === true
                && Boolean(previousQueueHistory.cancelled_at);
              const isCancelled = cancellationStatuses.has(orderStatus)
                && (wasPreviouslyInQueue || cancellationAlreadyRecorded)
                && !hasReturnOrClaim && !delivered && !dispatched;
              const isBlockedShipping = !isForwardShipment || hasReturnOrClaim || blockedShippingStates.has(shippingSubstatus) || delivered || dispatched
                || cancellationStatuses.has(shippingStatus);
              const eligibleOrder = ['paid', 'confirmed'].includes(orderStatus);
              // Etiquetas impressas permanecem na fila até o envio ser despachado.
              // Isso inclui Agência e Flex (logistic_type=self_service), sem depender
              // de o pedido ter sido atualizado exatamente hoje.
              const preparationStatus = (['pending', 'handling', 'ready_to_ship'].includes(shippingStatus) || printedSubstatuses.has(shippingSubstatus)) && !alreadyInPackingList;
              const hasPrintedLabel = printedSubstatuses.has(shippingSubstatus)
                || orderTags.some(tag => printedSubstatuses.has(tag));
              const alreadySeparated = !isCancelled && eligibleOrder && isForwardShipment && preparationStatus
                && !isBlockedShipping && hasPrintedLabel && dispatchDateAllowsQueue;
              const needsSeparation = !isCancelled && eligibleOrder && isForwardShipment && Boolean(orderShipping.id)
                && preparationStatus && !isBlockedShipping && !alreadySeparated && dispatchDateAllowsQueue;
              // A fila operacional consulta somente os últimos 4 dias.
              // Etiquetas impressas continuam visíveis enquanto não forem coletadas/despachadas.
              const cancelledInWindow = isCancelled;
              const showInOperationsQueue = !todayOnly || needsSeparation || alreadySeparated || cancelledInWindow;
              // Guarda o histórico somente quando o pedido realmente entrou na
              // fila de separação. Ao cancelar, preserva o registro e marca o status.
              if (needsSeparation || alreadySeparated || isCancelled) {
                queueHistoryUpserts.push({
                  company_id: account.company_id,
                  order_id: String(order.id),
                  was_in_queue: true,
                  last_order_status: orderStatus,
                  last_seen_at: new Date().toISOString(),
                  cancelled_at: isCancelled ? (previousQueueHistory?.cancelled_at || new Date().toISOString()) : null
                });
              }
              const statusLabels = { paid: 'Pago', confirmed: 'Confirmado', payment_required: 'Pagamento pendente', payment_in_process: 'Pagamento em análise', cancelled: 'Cancelado' };
              const separationLabel = isCancelled ? 'Cancelado' : alreadySeparated ? 'Separado — etiqueta impressa' : needsSeparation ? 'Precisa separar' : (statusLabels[orderStatus] || order.status || 'Em andamento');
              const shipmentSubstatusLabels = { ready_to_print: 'Etiqueta pronta para impressão', invoice_pending: 'Pronta para emitir NF-e da venda', printed: 'Etiqueta impressa', waiting_for_label_generation: 'Aguardando geração da etiqueta', ready_to_ship: 'Pronto para envio' };
              if (showInOperationsQueue) {
                const orderProducts = (order.order_items || []).map(line => {
                  const item = line.item || {};
                  const itemId = String(item.id || line.item_id || '').trim();
                  const detail = itemDetails.get(itemId) || {};
                  const attrs = detail.attributes || [];
                  const skuAttr = attrs.find(attribute => ['SELLER_SKU', 'SELLER_CUSTOM_FIELD'].includes(String(attribute.id || '').toUpperCase()));
                  const variation = (detail.variations || []).find(v => String(v.id || '') === String(item.variation_id || line.variation_id || '')) || {};
                  const variationSku = (variation.attributes || []).find(attribute => String(attribute.id || '').toUpperCase() === 'SELLER_SKU');
                  return {
                    item_id: itemId,
                    title: item.title || detail.title || 'Produto sem título',
                    sku: item.seller_sku || line.seller_sku || detail.seller_custom_field || detail.seller_sku || skuAttr?.value_name || variation.seller_custom_field || variationSku?.value_name || '',
                    image: detail.secure_thumbnail || detail.thumbnail || detail.pictures?.[0]?.secure_url || detail.pictures?.[0]?.url || '',
                    quantity: Math.max(0, Number(line.quantity || 0))
                  };
                });
                allOrders.push({
                  id: String(order.id || ''), company_id: account.company_id,
                  company_name: company?.nome || 'Empresa', nickname: account.nickname || 'Conta Mercado Livre',
                  date_created: order.date_created || null, date_last_updated: order.date_last_updated || null, status: order.status || '',
                  status_detail: order.status_detail || '', status_group: isCancelled ? 'cancelled' : 'other',
                  status_label: separationLabel,
                  total_amount: Number(order.total_amount || 0), currency_id: order.currency_id || 'BRL',
                  shipping_id: orderShipping.id ? String(orderShipping.id) : '', shipping_status: shippingStatus,
                  shipping_substatus: shippingSubstatus,
                  dispatch_deadline: dispatchDeadline,
                  dispatch_sla_status: shipmentSla.status || '',
                  shipping_logistic_type: shippingLogisticType, shipping_mode: shippingMode,
                  shipping_tags: orderTags,
                  needs_separation: needsSeparation,
                  already_separated: alreadySeparated,
                  shipping_status_label: shipmentSubstatusLabels[shippingSubstatus] || shippingSubstatus,
                  products: orderProducts,
                  units: orderProducts.reduce((sum, product) => sum + product.quantity, 0)
                });
              }
            }
            if (queueHistoryUpserts.length) {
              const { error: historyUpsertError } = await supabase
                .from('ml_order_queue_history')
                .upsert(queueHistoryUpserts, { onConflict: 'company_id,order_id' });
              if (historyUpsertError) throw new Error('Falha ao salvar histórico da fila. Confira a migration ml_order_queue_history.sql no Supabase. ' + historyUpsertError.message);
            }
          }
          const accountQueueOrders = todayOnly ? allOrders.filter(order => String(order.company_id) === String(account.company_id)) : orders;
          const revenue = accountQueueOrders.reduce((sum, order) => sum + (order.status_group === 'cancelled' ? 0 : Number(order.total_amount || 0)), 0);
          const productMap = new Map();
          for (const order of orders) {
            for (const line of (order.order_items || [])) {
              const item = line.item || {};
              const itemId = String(item.id || line.item_id || '').trim();
              if (!itemId) continue;
              const quantity = Math.max(0, Number(line.quantity || 0));
              const unitPrice = Number(line.unit_price ?? line.full_unit_price ?? 0);
              const key = itemId;
              let product = productMap.get(key);
              if (!product) {
                product = { company_id: account.company_id, company_name: company?.nome || 'Empresa', nickname: account.nickname || 'Conta Mercado Livre', item_id: itemId, title: item.title || '', sku: item.seller_sku || item.seller_custom_field || line.seller_sku || '', quantity_sold: 0, revenue: 0, orders: 0, _orderIds: new Set(), current_price: null, stock: null, status: '', image: '', permalink: '' };
                productMap.set(key, product);
              }
              product.quantity_sold += quantity;
              product.revenue += quantity * unitPrice;
              product._orderIds.add(String(order.id));
              if (!product.title && item.title) product.title = item.title;
            }
          }
          const storeProducts = [...productMap.values()];
          for (const product of storeProducts) {
            product.orders = product._orderIds.size;
            delete product._orderIds;
          }
          totalUnits += storeProducts.reduce((sum, product) => sum + product.quantity_sold, 0);
          // Enrich the best-selling listings with photos, current price, stock and direct link.
          // Limit detail lookups to the top 100 per account to keep the endpoint responsive.
          const enrichmentTargets = (summaryOnly || todayOnly) ? [] : storeProducts.slice().sort((a, b) => b.quantity_sold - a.quantity_sold).slice(0, 100);
          let enrichIndex = 0;
          const enrichWorker = async () => {
            while (enrichIndex < enrichmentTargets.length) {
              const product = enrichmentTargets[enrichIndex++];
              try {
                const itemResponse = await fetch('https://api.mercadolibre.com/items/' + encodeURIComponent(product.item_id), {
                  headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
                });
                if (!itemResponse.ok) continue;
                const detail = await itemResponse.json();
                product.title = detail.title || product.title;
                product.image = detail.secure_thumbnail || detail.thumbnail || detail.pictures?.[0]?.secure_url || detail.pictures?.[0]?.url || '';
                product.permalink = detail.permalink || '';
                product.current_price = detail.price == null ? null : Number(detail.price);
                product.stock = detail.available_quantity == null ? null : Number(detail.available_quantity);
                product.status = detail.status || '';
                const skuAttribute = (detail.attributes || []).find(attribute => ['SELLER_SKU', 'SELLER_CUSTOM_FIELD'].includes(String(attribute.id || '').toUpperCase()));
                const variation = (detail.variations || []).find(v => v.seller_custom_field || (v.attributes || []).some(a => String(a.id || '').toUpperCase() === 'SELLER_SKU'));
                const variationSkuAttribute = (variation?.attributes || []).find(attribute => String(attribute.id || '').toUpperCase() === 'SELLER_SKU');
                product.sku = detail.seller_custom_field || detail.seller_sku || skuAttribute?.value_name || variation?.seller_custom_field || variationSkuAttribute?.value_name || product.sku || '';
                product.seller_sku = product.sku;
              } catch (_) { /* Product details are optional; preserve order-derived metrics. */ }
            }
          };
          await Promise.all(Array.from({ length: Math.min(5, enrichmentTargets.length) }, () => enrichWorker()));
          allProducts.push(...storeProducts);
          stores.push({
            company_id: account.company_id,
            company_name: company?.nome || 'Empresa',
            nickname: account.nickname || 'Conta Mercado Livre',
            ml_user_id: account.ml_user_id,
            connected: true,
            orders: accountQueueOrders.length,
            revenue,
            orders_sampled: accountQueueOrders.length,
            truncated: false,
            units: storeProducts.reduce((sum, product) => sum + product.quantity_sold, 0),
            products: storeProducts.length
          });
        } catch (error) {
          stores.push({
            company_id: account.company_id,
            company_name: company?.nome || 'Empresa',
            nickname: account.nickname || 'Conta Mercado Livre',
            ml_user_id: account.ml_user_id,
            connected: false,
            error: error.message || 'Não foi possível consultar esta conta',
            orders: 0,
            revenue: 0
          });
        }
      }
      allProducts.sort((a, b) => Number(b.quantity_sold || 0) - Number(a.quantity_sold || 0));
      allOrders.sort((a, b) => new Date(b.date_created || 0).getTime() - new Date(a.date_created || 0).getTime());
      return res.json({
        ok: true, days: todayOnly ? 1 : days, today: todayOnly, connected: stores.filter(s => s.connected).length,
        totals: {
          orders: stores.reduce((sum, s) => sum + (s.orders || 0), 0),
          revenue: stores.reduce((sum, s) => sum + (s.revenue || 0), 0),
          units: totalUnits,
          products: allProducts.length
        },
        stores,
        orders: summaryOnly ? [] : allOrders,
        products: allProducts
      });
    } catch (error) {
      console.error('Portal sales error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar as vendas.' });
    }
  });

  // Equipe: subusuários podem visualizar somente os atendentes ativos/inativos das lojas que lhes foram autorizadas; não podem administrar contas.
  app.get('/api/portal/agent-team', authPortalOrAgent, async (req, res) => {
    try {
      if (req.portalRole !== 'support_agent' || !scopedMenuAllowed(req, 'team')) return res.status(403).json({ ok: false, error: 'menu_not_allowed' });
      const ids = req.agentAllowedLicenses.map(l => String(l.id));
      if (!ids.length) return res.json({ ok: true, agents: [], stores: req.agentAllowedLicenses });
      const { data, error } = await supabase.from('support_agents')
        .select('id,license_id,nome,email,status,permissions,menu_permissions,allowed_license_ids')
        .eq('created_by_portal_user_id', req.supportAgent.created_by_portal_user_id).in('license_id', ids).order('nome', { ascending: true });
      if (error) throw error;
      const visible = (data || []).filter(a => ids.includes(String(a.license_id)) || (a.allowed_license_ids || []).some(id => ids.includes(String(id))));
      return res.json({ ok: true, agents: visible.map(a => ({ id:a.id, license_id:a.license_id, nome:a.nome, email:a.email, status:a.status, permissions:a.permissions || [], menu_permissions:a.menu_permissions || [] })), stores: req.agentAllowedLicenses });
    } catch (error) {
      console.error('Portal agent team error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar a equipe.' });
    }
  });

  app.get('/api/portal/dashboard', authPortalOrAgent, async (req, res) => {
    try {
      let licenses = [];
      if (req.portalRole === 'support_agent') {
        const ids = req.agentAllowedLicenses.map(l => String(l.id));
        if (ids.length) {
          const { data, error } = await supabase.from('licenses')
            .select('id,chave,status,vencimento,company_id,created_at,companies(id,nome,status,codigo_ml)')
            .in('id', ids).eq('status', 'active');
          if (error) throw error;
          licenses = data || [];
        }
      } else {
        const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
          .select('licenses(id,chave,status,vencimento,company_id,companies(id,nome,status,codigo_ml))').eq('user_id', req.portalUserId);
        if (linkError) throw linkError;
        licenses = (links || []).map(x => x.licenses).filter(Boolean);
      }
      const companyMap = new Map();
      licenses.forEach(l => { if (l.companies?.id) companyMap.set(l.companies.id, l.companies); });
      const companyIds = [...companyMap.keys()];
      let devices = [];
      if (companyIds.length) {
        const { data, error } = await supabase.from('devices').select('id,company_id,device_id,nome,status,ultimo_acesso').in('company_id', companyIds).order('ultimo_acesso', { ascending: false });
        if (error) throw error;
        devices = (data || []).map(d => ({ ...d, company_name: companyMap.get(d.company_id)?.nome || 'Empresa' }));
      }
      const activeLicenses = licenses.filter(l => l.status === 'active' && (!l.vencimento || new Date(l.vencimento).getTime() >= Date.now())).length;
      const agentMenus = req.portalRole === 'support_agent' ? (req.supportAgent.menu_permissions || []) : null;
      const visibleLicenses = req.portalRole !== 'support_agent' || agentMenus.includes('licenses') ? licenses.map(l => ({ id: l.id, chave: l.chave, status: l.status, vencimento: l.vencimento, company_id: l.company_id, company: l.companies?.nome || 'Empresa não identificada', codigo_ml: l.companies?.codigo_ml || null })) : [];
      const visibleDevices = req.portalRole !== 'support_agent' || agentMenus.includes('devices') ? devices : [];
      const summary = req.portalRole === 'support_agent' && !agentMenus.includes('overview') ? { licenses: agentMenus.includes('licenses') ? visibleLicenses.length : 0, active_licenses: 0, companies: 0, devices: agentMenus.includes('devices') ? visibleDevices.length : 0, active_devices: 0 } : { licenses: licenses.length, active_licenses: activeLicenses, companies: companyIds.length, devices: devices.length, active_devices: devices.filter(d => d.status === 'active').length };
      return res.json({ ok: true, summary, licenses: visibleLicenses, devices: visibleDevices });
    } catch (error) {
      console.error('Portal dashboard error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar o painel.' });
    }
  });
};
