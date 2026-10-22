// Primeira etapa do módulo de atendimento: equipe, escopo por licença e permissões.
// As conversas/mensagens serão adicionadas nas próximas etapas usando o mesmo escopo.
module.exports = function registerAtendimentoRoutes(app, { supabase, jwt, bcrypt }) {
  const express = require('express');

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

  async function getOwnedLicense(portalUserId, licenseId) {
    const { data, error } = await supabase.from('portal_user_licenses')
      .select('license_id,licenses(id,chave,status,company_id,companies(id,nome,status))')
      .eq('user_id', portalUserId).eq('license_id', licenseId).maybeSingle();
    if (error) throw error;
    if (!data?.licenses) return null;
    const license = data.licenses;
    if (license.status !== 'active') return null;
    return license;
  }

  const permissionKeys = new Set([
    'conversations.view', 'conversations.reply', 'conversations.assign',
    'conversations.close', 'attachments.send', 'quick_replies.use',
    'quick_replies.manage', 'history.view'
  ]);

  function validatePermissions(input) {
    if (!Array.isArray(input)) return null;
    const values = [...new Set(input.map(v => String(v)))];
    return values.every(v => permissionKeys.has(v)) ? values : null;
  }

  async function writeAudit(licenseId, actorId, action, details = {}) {
    const { error } = await supabase.from('support_audit_logs').insert({
      license_id: licenseId, actor_portal_user_id: actorId, action, details
    });
    if (error) console.error('Atendimento audit log failed:', error.code || error.message);
  }

  app.get('/api/portal/atendimento/licenses', authPortal, async (req, res) => {
    try {
      const { data, error } = await supabase.from('portal_user_licenses')
        .select('licenses(id,status,company_id,companies(id,nome,status))')
        .eq('user_id', req.portalUserId);
      if (error) throw error;
      const licenses = (data || []).map(row => row.licenses).filter(l => l && l.status === 'active')
        .map(l => ({ id: l.id, company_id: l.company_id, company_name: l.companies?.nome || 'Empresa', company_status: l.companies?.status || 'unknown' }));
      return res.json({ ok: true, licenses });
    } catch (error) {
      console.error('Atendimento licenses error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar as licenças.' });
    }
  });

  app.get('/api/portal/atendimento/agents', authPortal, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || '');
      if (!licenseId) return res.status(400).json({ ok: false, error: 'license_required' });
      const license = await getOwnedLicense(req.portalUserId, licenseId);
      if (!license) return res.status(404).json({ ok: false, error: 'license_not_found' });
      const { data, error } = await supabase.from('support_agents')
        .select('id,license_id,nome,email,status,permissions,allowed_company_ids,created_at,updated_at')
        .eq('license_id', licenseId).order('created_at', { ascending: false });
      if (error) throw error;
      return res.json({ ok: true, agents: data || [] });
    } catch (error) {
      console.error('Atendimento agents list error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar a equipe.' });
    }
  });

  app.post('/api/portal/atendimento/agents', authPortal, async (req, res) => {
    try {
      const licenseId = String(req.body?.license_id || '');
      const nome = String(req.body?.nome || '').trim().slice(0, 100);
      const email = String(req.body?.email || '').trim().toLowerCase();
      const senha = String(req.body?.senha || '');
      const permissions = validatePermissions(req.body?.permissions);
      if (!licenseId || !nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || senha.length < 8 || !permissions) {
        return res.status(400).json({ ok: false, error: 'invalid_fields', message: 'Informe nome, e-mail válido, senha com pelo menos 8 caracteres e permissões válidas.' });
      }
      const license = await getOwnedLicense(req.portalUserId, licenseId);
      if (!license) return res.status(404).json({ ok: false, error: 'license_not_found' });
      const allowedCompanyIds = Array.isArray(req.body?.allowed_company_ids) ? [...new Set(req.body.allowed_company_ids.map(String))] : [String(license.company_id)];
      // Nesta primeira versão, o subusuário só pode receber acesso à empresa da licença selecionada.
      if (allowedCompanyIds.some(id => id !== String(license.company_id))) {
        return res.status(400).json({ ok: false, error: 'company_out_of_scope', message: 'A empresa selecionada não pertence a esta licença.' });
      }
      const senha_hash = await bcrypt.hash(senha, 12);
      const { data, error } = await supabase.from('support_agents').insert({
        license_id: licenseId, nome, email, senha_hash, status: 'active',
        permissions, allowed_company_ids: allowedCompanyIds, created_by_portal_user_id: req.portalUserId
      }).select('id,license_id,nome,email,status,permissions,allowed_company_ids,created_at,updated_at').single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ ok: false, error: 'agent_email_exists', message: 'Este e-mail já está cadastrado nesta licença.' });
        throw error;
      }
      await writeAudit(licenseId, req.portalUserId, 'agent.created', { agent_id: data.id, email: data.email });
      return res.status(201).json({ ok: true, agent: data });
    } catch (error) {
      console.error('Atendimento agent create error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível criar o subusuário.' });
    }
  });

  app.patch('/api/portal/atendimento/agents/:id', authPortal, async (req, res) => {
    try {
      const agentId = String(req.params.id || '');
      const { data: existing, error: findError } = await supabase.from('support_agents')
        .select('id,license_id,nome,email,status,permissions,allowed_company_ids')
        .eq('id', agentId).maybeSingle();
      if (findError) throw findError;
      if (!existing) return res.status(404).json({ ok: false, error: 'agent_not_found' });
      const license = await getOwnedLicense(req.portalUserId, existing.license_id);
      if (!license) return res.status(404).json({ ok: false, error: 'agent_not_found' });
      const updates = {};
      if (req.body?.nome !== undefined) {
        const nome = String(req.body.nome).trim().slice(0, 100);
        if (!nome) return res.status(400).json({ ok: false, error: 'invalid_name' });
        updates.nome = nome;
      }
      if (req.body?.status !== undefined) {
        if (!['active', 'disabled'].includes(req.body.status)) return res.status(400).json({ ok: false, error: 'invalid_status' });
        updates.status = req.body.status;
      }
      if (req.body?.permissions !== undefined) {
        const permissions = validatePermissions(req.body.permissions);
        if (!permissions) return res.status(400).json({ ok: false, error: 'invalid_permissions' });
        updates.permissions = permissions;
      }
      if (req.body?.allowed_company_ids !== undefined) {
        const ids = Array.isArray(req.body.allowed_company_ids) ? [...new Set(req.body.allowed_company_ids.map(String))] : [];
        if (ids.some(id => id !== String(license.company_id))) return res.status(400).json({ ok: false, error: 'company_out_of_scope' });
        updates.allowed_company_ids = ids;
      }
      if (req.body?.senha !== undefined) {
        const senha = String(req.body.senha);
        if (senha.length < 8) return res.status(400).json({ ok: false, error: 'weak_password' });
        updates.senha_hash = await bcrypt.hash(senha, 12);
      }
      if (!Object.keys(updates).length) return res.status(400).json({ ok: false, error: 'nothing_to_update' });
      updates.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('support_agents').update(updates).eq('id', agentId)
        .select('id,license_id,nome,email,status,permissions,allowed_company_ids,created_at,updated_at').single();
      if (error) throw error;
      await writeAudit(existing.license_id, req.portalUserId, 'agent.updated', { agent_id: agentId, fields: Object.keys(updates).filter(k => k !== 'senha_hash') });
      return res.json({ ok: true, agent: data });
    } catch (error) {
      console.error('Atendimento agent update error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível atualizar o subusuário.' });
    }
  });

  app.delete('/api/portal/atendimento/agents/:id', authPortal, async (req, res) => {
    try {
      const agentId = String(req.params.id || '');
      const { data: existing, error: findError } = await supabase.from('support_agents')
        .select('id,license_id,email').eq('id', agentId).maybeSingle();
      if (findError) throw findError;
      if (!existing || !(await getOwnedLicense(req.portalUserId, existing.license_id))) return res.status(404).json({ ok: false, error: 'agent_not_found' });
      const { error } = await supabase.from('support_agents').delete().eq('id', agentId);
      if (error) throw error;
      await writeAudit(existing.license_id, req.portalUserId, 'agent.deleted', { agent_id: agentId, email: existing.email });
      return res.json({ ok: true });
    } catch (error) {
      console.error('Atendimento agent delete error:', error.code || error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível remover o subusuário.' });
    }
  });
};
