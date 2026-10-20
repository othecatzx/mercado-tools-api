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
      const { data: user, error } = await supabase.from('portal_users').select('*').eq('email', email).maybeSingle();
      if (error) throw error;
      if (!user || user.status !== 'active' || !(await bcrypt.compare(senha, user.senha_hash))) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'E-mail ou senha incorretos.' });
      }
      const token = jwt.sign({ type: 'portal', portal_user_id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
      return res.json({ ok: true, token, user: { id: user.id, nome: user.nome, email: user.email, status: user.status, created_at: user.created_at } });
    } catch (error) {
      console.error('Portal login error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível entrar agora.' });
    }
  });

  app.get('/api/portal/me', authPortal, async (req, res) => {
    try {
      const user = await getPortalUser(req.portalUserId);
      if (!user || user.status !== 'active') return res.status(401).json({ ok: false, error: 'account_unavailable' });
      return res.json({ ok: true, user });
    } catch (error) {
      console.error('Portal me error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/portal/licenses', authPortal, async (req, res) => {
    try {
      const { data, error } = await supabase.from('portal_user_licenses')
        .select('id,created_at,licenses(id,chave,status,inicio,vencimento,company_id,companies(id,nome,documento,status))')
        .eq('user_id', req.portalUserId).order('created_at', { ascending: false });
      if (error) throw error;
      const licenses = (data || []).map(row => {
        const l = row.licenses || {};
        const c = l.companies || {};
        return { link_id: row.id, added_at: row.created_at, id: l.id, chave: l.chave, status: l.status,
          inicio: l.inicio, vencimento: l.vencimento, company_id: l.company_id,
          company: { id: c.id, nome: c.nome || 'Empresa não identificada', documento: c.documento || null, status: c.status || 'unknown' } };
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
        .select('id,nome,documento,status').eq('id', license.company_id).maybeSingle();
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

  app.get('/api/portal/dashboard', authPortal, async (req, res) => {
    try {
      const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
        .select('licenses(id,chave,status,vencimento,company_id,companies(id,nome,status))').eq('user_id', req.portalUserId);
      if (linkError) throw linkError;
      const licenses = (links || []).map(x => x.licenses).filter(Boolean);
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
      return res.json({ ok: true, summary: { licenses: licenses.length, active_licenses: activeLicenses, companies: companyIds.length, devices: devices.length, active_devices: devices.filter(d => d.status === 'active').length }, licenses: licenses.map(l => ({ id: l.id, chave: l.chave, status: l.status, vencimento: l.vencimento, company: l.companies?.nome || 'Empresa não identificada' })), devices });
    } catch (error) {
      console.error('Portal dashboard error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar o painel.' });
    }
  });
};
