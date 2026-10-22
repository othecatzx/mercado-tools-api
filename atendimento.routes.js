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

  const menuKeys = new Set(['overview','licenses','devices','sales','codes','team','chat']);
  function validateMenuPermissions(input) {
    if (!Array.isArray(input)) return null;
    const values = [...new Set(input.map(v => String(v)))];
    return values.every(v => menuKeys.has(v)) ? values : null;
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
        .select('id,license_id,nome,email,status,permissions,menu_permissions,allowed_company_ids,allowed_license_ids,created_at,updated_at,created_by_portal_user_id')
        .eq('created_by_portal_user_id', req.portalUserId).order('created_at', { ascending: false });
      if (error) throw error;
      const agents = (data || []).filter(a => (Array.isArray(a.allowed_license_ids) && a.allowed_license_ids.length ? a.allowed_license_ids.map(String) : [String(a.license_id)]).includes(String(licenseId))).map(({ created_by_portal_user_id, ...a }) => a);
      return res.json({ ok: true, agents });
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
      const menu_permissions = req.body?.menu_permissions === undefined ? ['chat'] : validateMenuPermissions(req.body.menu_permissions);
      if (!licenseId || !nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || senha.length < 8 || !permissions || !menu_permissions) {
        return res.status(400).json({ ok: false, error: 'invalid_fields', message: 'Informe nome, e-mail válido, senha com pelo menos 8 caracteres e permissões válidas.' });
      }
      const license = await getOwnedLicense(req.portalUserId, licenseId);
      if (!license) return res.status(404).json({ ok: false, error: 'license_not_found' });
      const requestedLicenseIds = Array.isArray(req.body?.allowed_license_ids) ? [...new Set(req.body.allowed_license_ids.map(String))] : [licenseId];
      if (!requestedLicenseIds.includes(licenseId)) requestedLicenseIds.unshift(licenseId);
      if (!requestedLicenseIds.length || requestedLicenseIds.length > 100) return res.status(400).json({ ok:false, error:'invalid_store_scope', message:'Selecione pelo menos uma loja.' });
      const allowedLicenses = [];
      for (const id of requestedLicenseIds) { const owned = await getOwnedLicense(req.portalUserId, id); if (!owned) return res.status(400).json({ ok:false, error:'license_out_of_scope', message:'Uma das lojas selecionadas não pertence à sua conta ou está inativa.' }); allowedLicenses.push(owned); }
      const allowedCompanyIds = [...new Set(allowedLicenses.map(l => String(l.company_id)).filter(Boolean))];
      const { data: mainUser, error: mainUserError } = await supabase.from('portal_users').select('id').ilike('email', email).maybeSingle();
      if (mainUserError) throw mainUserError;
      if (mainUser) return res.status(409).json({ ok: false, error: 'email_exists', message: 'Este e-mail já pertence a uma conta principal do portal. Use outro e-mail para o subusuário.' });
      const { data: existingAgent, error: existingAgentError } = await supabase.from('support_agents').select('id').ilike('email', email).limit(1).maybeSingle();
      if (existingAgentError) throw existingAgentError;
      if (existingAgent) return res.status(409).json({ ok: false, error: 'agent_email_exists', message: 'Este e-mail já está cadastrado em outra equipe. Use um e-mail exclusivo para o subusuário.' });
      const senha_hash = await bcrypt.hash(senha, 12);
      const { data, error } = await supabase.from('support_agents').insert({
        license_id: licenseId, nome, email, senha_hash, status: 'active',
        permissions, menu_permissions, allowed_company_ids: allowedCompanyIds, allowed_license_ids: requestedLicenseIds, created_by_portal_user_id: req.portalUserId
      }).select('id,license_id,nome,email,status,permissions,menu_permissions,allowed_company_ids,allowed_license_ids,created_at,updated_at').single();
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
        .select('id,license_id,nome,email,status,permissions,allowed_company_ids,allowed_license_ids')
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
      if (req.body?.menu_permissions !== undefined) {
        const menu_permissions = validateMenuPermissions(req.body.menu_permissions);
        if (!menu_permissions) return res.status(400).json({ ok: false, error: 'invalid_menu_permissions', message: 'Seleção de menus inválida.' });
        updates.menu_permissions = menu_permissions;
      }
      if (req.body?.allowed_company_ids !== undefined) {
        const ids = Array.isArray(req.body.allowed_company_ids) ? [...new Set(req.body.allowed_company_ids.map(String))] : [];
        updates.allowed_company_ids = ids;
      }
      if (req.body?.allowed_license_ids !== undefined) {
        const ids = Array.isArray(req.body.allowed_license_ids) ? [...new Set(req.body.allowed_license_ids.map(String))] : [];
        if (!ids.includes(String(existing.license_id))) ids.unshift(String(existing.license_id));
        if (!ids.length || ids.length > 100) return res.status(400).json({ ok:false, error:'invalid_store_scope', message:'Selecione pelo menos uma loja.' });
        const ownedLicenses = [];
        for (const id of ids) { const owned = await getOwnedLicense(req.portalUserId, id); if (!owned) return res.status(400).json({ ok:false, error:'license_out_of_scope', message:'Uma das lojas selecionadas não pertence à sua conta ou está inativa.' }); ownedLicenses.push(owned); }
        updates.allowed_license_ids = ids;
        updates.allowed_company_ids = [...new Set(ownedLicenses.map(l => String(l.company_id)).filter(Boolean))];
      }
      if (req.body?.senha !== undefined) {
        const senha = String(req.body.senha);
        if (senha.length < 8) return res.status(400).json({ ok: false, error: 'weak_password' });
        updates.senha_hash = await bcrypt.hash(senha, 12);
      }
      if (!Object.keys(updates).length) return res.status(400).json({ ok: false, error: 'nothing_to_update' });
      updates.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('support_agents').update(updates).eq('id', agentId)
        .select('id,license_id,nome,email,status,permissions,menu_permissions,allowed_company_ids,allowed_license_ids,created_at,updated_at').single();
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
  // Atendimento de mensagens pós-venda do Mercado Livre.
  function authChat(req, res, next) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ ok: false, message: 'Faça login para continuar.' });
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.type === 'portal' && decoded.portal_user_id) {
        req.actor = { type: 'portal', id: decoded.portal_user_id };
        return next();
      }
      if (decoded.type === 'support_agent' && decoded.support_agent_id && decoded.license_id) {
        req.actor = { type: 'agent', id: decoded.support_agent_id, licenseId: decoded.license_id };
        return next();
      }
      return res.status(401).json({ ok: false, message: 'Sessão inválida.' });
    } catch (_) { return res.status(401).json({ ok: false, message: 'Sessão expirada. Entre novamente.' }); }
  }
  async function chatActor(req, res, permission, licenseId) {
    if (req.actor.type === 'portal') {
      const license = await getOwnedLicense(req.actor.id, licenseId);
      if (!license) { res.status(404).json({ ok: false, message: 'Licença não encontrada ou sem acesso.' }); return null; }
      return { owner: true, license, agent: null };
    }
    const { data: agent, error } = await supabase.from('support_agents')
      .select('id,license_id,nome,email,status,permissions,allowed_company_ids,allowed_license_ids,created_by_portal_user_id')
      .eq('id', req.actor.id).maybeSingle();
    if (error) throw error;
    if (!agent || agent.status !== 'active') { res.status(401).json({ ok: false, message: 'Atendente desativado.' }); return null; }
    const allowedLicenseIds = Array.isArray(agent.allowed_license_ids) && agent.allowed_license_ids.length ? agent.allowed_license_ids.map(String) : [String(agent.license_id)];
    if (!allowedLicenseIds.includes(String(licenseId))) { res.status(403).json({ ok: false, message: 'Este atendente não tem acesso a esta loja.' }); return null; }
    const targetLicense = await getOwnedLicense(agent.created_by_portal_user_id, licenseId);
    if (!targetLicense) { res.status(403).json({ ok: false, message: 'A licença desta loja não está mais vinculada à conta administradora.' }); return null; }
    if (permission && !(agent.permissions || []).includes(permission)) { res.status(403).json({ ok: false, message: 'Você não tem permissão para realizar esta ação.' }); return null; }
    return { owner: false, license: targetLicense, agent };
  }
  async function mlAccountForLicense(license) {
    const { data: account, error } = await supabase.from('mercadolivre_accounts').select('*').eq('company_id', license.company_id).maybeSingle();
    if (error) throw error;
    if (!account) throw new Error('A conta do Mercado Livre desta empresa não está conectada. Conecte-a pelo fluxo de autorização existente.');
    let accessToken = account.access_token;
    const expires = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
    if (!accessToken || !expires || expires <= Date.now() + 120000) {
      if (!account.refresh_token || !process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET) throw new Error('O token do Mercado Livre expirou. Reconecte a conta.');
      const response = await fetch('https://api.mercadolibre.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: process.env.ML_CLIENT_ID, client_secret: process.env.ML_CLIENT_SECRET, refresh_token: account.refresh_token }) });
      const refreshed = await response.json().catch(() => ({}));
      if (!response.ok || !refreshed.access_token) throw new Error('Não foi possível renovar o token do Mercado Livre. Reconecte a conta.');
      accessToken = refreshed.access_token;
      const { error: saveError } = await supabase.from('mercadolivre_accounts').update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || account.refresh_token, token_expires_at: new Date(Date.now() + Number(refreshed.expires_in || 21600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('company_id', license.company_id);
      if (saveError) throw new Error('Token renovado, mas não foi possível salvar a sessão da conta Mercado Livre.');
    }
    return { account, accessToken, sellerId: String(account.ml_user_id), siteId: account.site_id || account.site || 'MLB' };
  }
  async function mlRequest(accessToken, path, options = {}) {
    const response = await fetch('https://api.mercadolibre.com' + path, { ...options, headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = body.message || body.error || `Mercado Livre respondeu HTTP ${response.status}`;
      const e = new Error(String(msg).slice(0, 450)); e.status = response.status; throw e;
    }
    return body;
  }
  function normalizeMlMessage(m, sellerId) {
    const from = String(m.from?.user_id ?? '');
    const text = typeof m.text === 'string' ? m.text : (m.text?.plain || '');
    const dt = m.message_date?.created || m.message_date?.received || m.date_created || m.date || new Date().toISOString();
    return { external_message_id: String(m.id || m.message_id || `${from}-${dt}-${text.slice(0,20)}`), sender_id: from, sender_role: [String(sellerId), '3037675074', '3020819166', '3037674934', '3037204279', '3037204123', '3037204685'].includes(from) ? 'seller' : 'buyer', text, created_at: new Date(dt).toISOString(), status: m.status || 'available', attachments: (Array.isArray(m.message_attachments) ? m.message_attachments : (Array.isArray(m.attachments) ? m.attachments : [])).map(a => typeof a === 'string' ? { id: a, filename: a } : a), raw: m };
  }
  async function persistMlConversation(license, accountInfo, packId, messagesPayload, order = null) {
    const messages = (messagesPayload.messages || []).map(m => normalizeMlMessage(m, accountInfo.sellerId)).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    const last = messages[messages.length - 1];
    const currentStatus = messagesPayload.conversation_status || {};
    const { data: previous } = await supabase.from('support_conversations').select('order_id,buyer_id,buyer_name,item_title,closed_at,assigned_agent_id').eq('license_id', license.id).eq('pack_id', String(packId)).eq('seller_id', accountInfo.sellerId).maybeSingle();
    const buyerId = messages.find(m => m.sender_role === 'buyer')?.sender_id || (order?.buyer?.id ? String(order.buyer.id) : null) || previous?.buyer_id || null;
    const buyerName = order?.buyer?.nickname || order?.buyer?.first_name || previous?.buyer_name || null;
    const itemTitle = order?.order_items?.[0]?.item?.title || previous?.item_title || null;
    const row = { license_id: license.id, company_id: license.company_id, pack_id: String(packId), seller_id: accountInfo.sellerId, order_id: String(order?.id || previous?.order_id || packId), buyer_id: buyerId, buyer_name: buyerName, item_title: itemTitle, site_id: accountInfo.siteId, ml_status: currentStatus.status || 'unknown', ml_substatus: currentStatus.substatus || null, last_message: last?.text || null, last_message_at: last?.created_at || null, updated_at: new Date().toISOString() };
    const { data: conv, error } = await supabase.from('support_conversations').upsert(row, { onConflict: 'license_id,pack_id,seller_id' }).select('*').single();
    if (error) throw error;
    if (messages.length) {
      const rows = messages.map(m => ({ license_id: license.id, conversation_id: conv.id, external_message_id: m.external_message_id, sender_id: m.sender_id, sender_role: m.sender_role, text: m.text, status: m.status, attachments: m.attachments, raw: m.raw, created_at: m.created_at }));
      const { error: msgError } = await supabase.from('support_messages').upsert(rows, { onConflict: 'license_id,external_message_id', ignoreDuplicates: true });
      if (msgError) throw msgError;
    }
    return conv;
  }
  async function refreshConversationFromMl(license, conversation, markRead = false) {
    const info = await mlAccountForLicense(license);
    const path = `/messages/packs/${encodeURIComponent(conversation.pack_id)}/sellers/${encodeURIComponent(info.sellerId)}?tag=post_sale&limit=50&offset=0&mark_as_read=${markRead ? 'true' : 'false'}`;
    const payload = await mlRequest(info.accessToken, path);
    const conv = await persistMlConversation(license, info, conversation.pack_id, payload, { id: conversation.order_id, buyer: { nickname: conversation.buyer_name }, order_items: [{ item: { title: conversation.item_title } }] });
    return { info, payload, conv };
  }
  async function syncLicenseConversations(license, includeRecent = true) {
    const info = await mlAccountForLicense(license);
    const discovered = new Map();
    try {
      const unread = await mlRequest(info.accessToken, '/messages/unread?role=seller&tag=post_sale');
      for (const result of unread.results || []) {
        const match = String(result.resource || '').match(/\/packs\/(\d+)\/sellers\/(\d+)/);
        if (match) discovered.set(match[1], null);
      }
    } catch (e) { console.warn('Unread ML messages sync:', e.message); }
    // Busca pedidos recentes apenas na sincronização manual inicial; o polling periódico usa só unread.
    if (includeRecent) try {
      const now = new Date(); const from = new Date(Date.now() - 30*86400000);
      const params = new URLSearchParams({ seller: info.sellerId, 'order.date_created.from': from.toISOString(), 'order.date_created.to': now.toISOString(), limit: '50', offset: '0', sort: 'date_desc' });
      const orders = await mlRequest(info.accessToken, '/orders/search?' + params.toString());
      for (const order of (orders.results || []).slice(0, 25)) discovered.set(String(order.pack_id || order.id), order);
    } catch (e) { console.warn('Recent orders sync:', e.message); }
    let synced = 0, failures = 0;
    for (const [packId, order] of [...discovered.entries()].slice(0, 35)) {
      try {
        const payload = await mlRequest(info.accessToken, `/messages/packs/${encodeURIComponent(packId)}/sellers/${encodeURIComponent(info.sellerId)}?tag=post_sale&limit=50&offset=0&mark_as_read=false`);
        if (!(payload.messages || []).length) continue;
        await persistMlConversation(license, info, packId, payload, order);
        synced++;
      } catch (e) { failures++; console.warn('Conversation sync failed', packId, e.message); }
    }
    return { synced, failures };
  }
  async function getConversationScoped(req, res, conversationId, permission) {
    const { data: conversation, error } = await supabase.from('support_conversations').select('*').eq('id', conversationId).maybeSingle();
    if (error) throw error;
    if (!conversation) { res.status(404).json({ ok: false, message: 'Conversa não encontrada.' }); return null; }
    const actor = await chatActor(req, res, permission, conversation.license_id);
    if (!actor) return null;
    if (!actor.owner && conversation.assigned_agent_id && conversation.assigned_agent_id !== actor.agent.id && !(actor.agent.permissions || []).includes('conversations.view')) { res.status(403).json({ ok: false, message: 'Conversa atribuída a outro atendente.' }); return null; }
    return { conversation, actor };
  }
  function csvCell(value) { const s = String(value ?? ''); return '"' + s.replace(/"/g, '""') + '"'; }

  app.get('/api/portal/atendimento/chat/conversations', authChat, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || req.actor.licenseId || '');
      if (!licenseId) return res.status(400).json({ ok: false, message: 'Selecione uma licença.' });
      const actor = await chatActor(req, res, 'conversations.view', licenseId); if (!actor) return;
      let sync = { synced: 0, failures: 0 };
      if (req.query.sync === '1' || req.query.sync === 'unread') {
        try { sync = await syncLicenseConversations(actor.license, req.query.sync === '1'); }
        catch (e) { return res.status(502).json({ ok: false, message: e.message || 'Não foi possível sincronizar com o Mercado Livre.' }); }
      }
      let query = supabase.from('support_conversations').select('*,licenses(company_id,companies(nome))').eq('license_id', licenseId).order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
      const { data, error } = await query; if (error) throw error;
      const assignedIds = [...new Set((data || []).map(c => c.assigned_agent_id).filter(Boolean))]; let assigned = new Map(); if (assignedIds.length) { const { data: agents, error: agentsError } = await supabase.from('support_agents').select('id,nome,email').in('id', assignedIds); if (agentsError) throw agentsError; assigned = new Map((agents || []).map(a => [a.id, a])); } const conversations = (data || []).map(c => ({ ...c, company_name: c.licenses?.companies?.nome || actor.license?.companies?.nome || 'Empresa', assigned_agent_name: assigned.get(c.assigned_agent_id)?.nome || null, assigned_agent_email: assigned.get(c.assigned_agent_id)?.email || null, licenses: undefined }));
      return res.json({ ok: true, conversations, sync });
    } catch (e) { console.error('Chat conversation list:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível carregar as conversas.' }); }
  });
  app.get('/api/portal/atendimento/chat/conversations/:id/messages', authChat, async (req, res) => {
    try {
      const scope = await getConversationScoped(req, res, req.params.id, 'conversations.view'); if (!scope) return;
      const { conversation, actor } = scope;
      let result = null;
      try { result = await refreshConversationFromMl(actor.license, conversation, false); }
      catch (e) { console.warn('Refresh messages failed:', e.message); }
      const { data, error } = await supabase.from('support_messages').select('id,external_message_id,sender_id,sender_role,text,status,attachments,raw,created_at').eq('license_id', conversation.license_id).eq('conversation_id', conversation.id).order('created_at', { ascending: true }).limit(500);
      if (error) throw error;
      const messages = (data || []).map(m => ({ ...m, sender_name: m.sender_role === 'seller' ? 'Sua loja' : (conversation.buyer_name || 'Comprador') }));
      return res.json({ ok: true, messages, ml_status: result?.payload?.conversation_status?.status || conversation.ml_status });
    } catch (e) { console.error('Chat messages list:', e.code || e.message); return res.status(500).json({ ok: false, message: e.message || 'Não foi possível carregar as mensagens.' }); }
  });
  app.post('/api/portal/atendimento/chat/conversations/:id/messages', authChat, async (req, res) => {
    try {
      const scope = await getConversationScoped(req, res, req.params.id, 'conversations.reply'); if (!scope) return;
      const { conversation, actor } = scope;
      if (conversation.closed_at) return res.status(409).json({ ok: false, message: 'Este atendimento está encerrado. Reabra-o antes de responder.' });
      if (conversation.ml_status === 'blocked') return res.status(409).json({ ok: false, message: 'O Mercado Livre bloqueou esta conversa.' });
      const text = String(req.body?.text || '').replace(/[\r\n]+/g, ' ').trim();
      const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments.map(String).slice(0, 25) : [];
      if (!text && !attachments.length) return res.status(400).json({ ok: false, message: 'Escreva uma mensagem ou anexe um arquivo.' });
      if (text.length > 350) return res.status(400).json({ ok: false, message: 'A mensagem pode ter no máximo 350 caracteres.' });
      const info = await mlAccountForLicense(actor.license);
      const toUserId = info.siteId === 'MLB' ? '3037675074' : (info.siteId === 'MLC' ? '3020819166' : info.siteId === 'MLA' ? '3037674934' : info.siteId === 'MLM' ? '3037204279' : info.siteId === 'MCO' ? '3037204123' : '3037204685');
      const body = { from: { user_id: String(info.sellerId) }, to: { user_id: toUserId } };
      if (text || attachments.length) body.text = text || 'Segue o anexo.';
      if (attachments.length) body.attachments = attachments;
      const sent = await mlRequest(info.accessToken, `/messages/packs/${encodeURIComponent(conversation.pack_id)}/sellers/${encodeURIComponent(info.sellerId)}?tag=post_sale`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await writeAudit(conversation.license_id, actor.owner ? actor.agent?.id || req.actor.id : null, 'conversation.message_sent', { conversation_id: conversation.id, agent_id: actor.agent?.id || null, message_id: sent.id || sent.message_id || null });
      try { await refreshConversationFromMl(actor.license, conversation, false); } catch (_) {}
      return res.status(201).json({ ok: true, message: 'Mensagem enviada ao Mercado Livre.', result: sent });
    } catch (e) { console.error('Chat send message:', e.message); return res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 502).json({ ok: false, message: e.message || 'Não foi possível enviar a mensagem ao Mercado Livre.' }); }
  });
  app.post('/api/portal/atendimento/chat/attachments', authChat, express.raw({ type: 'application/octet-stream', limit: '25mb' }), async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || ''); const conversationId = String(req.query.conversation_id || '');
      const scope = await getConversationScoped(req, res, conversationId, 'attachments.send'); if (!scope) return;
      if (String(scope.conversation.license_id) !== licenseId) return res.status(403).json({ ok: false, message: 'Licença da conversa inválida.' });
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, message: 'Arquivo vazio.' });
      if (req.body.length > 25 * 1024 * 1024) return res.status(413).json({ ok: false, message: 'O arquivo excede 25 MB.' });
      const filename = decodeURIComponent(String(req.headers['x-file-name'] || 'arquivo').replace(/[\\/]/g, '_')).slice(0, 180);
      const type = String(req.headers['x-file-type'] || 'application/octet-stream');
      const ext = filename.split('.').pop().toLowerCase();
      if (!['jpg','jpeg','png','pdf','txt'].includes(ext) || !['image/jpeg','image/png','application/pdf','text/plain'].includes(type)) return res.status(400).json({ ok: false, message: 'Formato não permitido. Use JPG, PNG, PDF ou TXT.' });
      const info = await mlAccountForLicense(scope.actor.license);
      const form = new FormData(); form.append('file', new Blob([req.body], { type }), filename);
      const response = await fetch(`https://api.mercadolibre.com/messages/attachments?tag=post_sale&site_id=${encodeURIComponent(info.siteId)}`, { method: 'POST', headers: { Authorization: `Bearer ${info.accessToken}` }, body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.id) return res.status(response.status || 502).json({ ok: false, message: data.message || 'O Mercado Livre não aceitou o anexo.' });
      await writeAudit(scope.conversation.license_id, scope.actor.owner ? req.actor.id : null, 'conversation.attachment_uploaded', { conversation_id: conversationId, agent_id: scope.actor.agent?.id || null, filename, attachment_id: data.id });
      return res.json({ ok: true, attachment_id: data.id, filename });
    } catch (e) { console.error('Chat attachment:', e.message); return res.status(e.status || 502).json({ ok: false, message: e.message || 'Falha ao carregar anexo.' }); }
  });
  app.patch('/api/portal/atendimento/chat/conversations/:id/status', authChat, async (req, res) => {
    try {
      const scope = await getConversationScoped(req, res, req.params.id, 'conversations.close'); if (!scope) return; const { conversation, actor } = scope;
      const closed = req.body?.closed === true;
      const updates = { closed_at: closed ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('support_conversations').update(updates).eq('id', conversation.id); if (error) throw error;
      await writeAudit(conversation.license_id, actor.owner ? req.actor.id : null, closed ? 'conversation.closed' : 'conversation.reopened', { conversation_id: conversation.id, agent_id: actor.agent?.id || null });
      return res.json({ ok: true, closed });
    } catch (e) { console.error('Chat status:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível atualizar o atendimento.' }); }
  });
  app.get('/api/portal/atendimento/chat/assignable-agents', authChat, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || req.actor.licenseId || '');
      const actor = await chatActor(req, res, 'conversations.assign', licenseId); if (!actor) return;
      const ownerId = actor.owner ? req.actor.id : actor.agent.created_by_portal_user_id;
      const { data, error } = await supabase.from('support_agents')
        .select('id,license_id,nome,email,status,allowed_license_ids,created_by_portal_user_id')
        .eq('created_by_portal_user_id', ownerId).eq('status', 'active').order('nome', { ascending: true });
      if (error) throw error;
      const agents = (data || []).filter(a => (Array.isArray(a.allowed_license_ids) && a.allowed_license_ids.length ? a.allowed_license_ids.map(String) : [String(a.license_id)]).includes(String(licenseId))).map(({ created_by_portal_user_id, allowed_license_ids, license_id, ...a }) => a);
      return res.json({ ok: true, agents });
    } catch (e) { console.error('Chat assignable agents:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível carregar os atendentes disponíveis.' }); }
  });

  app.patch('/api/portal/atendimento/chat/conversations/:id/assign', authChat, async (req, res) => {
    try {
      const scope = await getConversationScoped(req, res, req.params.id, 'conversations.assign'); if (!scope) return; const { conversation, actor } = scope;
      const email = String(req.body?.email || '').trim().toLowerCase(); let agentId = null;
      if (email) {
        const ownerId = actor.owner ? req.actor.id : actor.agent.created_by_portal_user_id;
        const { data: candidates, error } = await supabase.from('support_agents').select('id,email,status,license_id,allowed_license_ids,created_by_portal_user_id').eq('created_by_portal_user_id', ownerId).eq('email', email).limit(10);
        if (error) throw error;
        const agent = (candidates || []).find(a => a.status === 'active' && (Array.isArray(a.allowed_license_ids) && a.allowed_license_ids.length ? a.allowed_license_ids.map(String) : [String(a.license_id)]).includes(String(conversation.license_id)));
        if (!agent) return res.status(404).json({ ok: false, message: 'Atendente ativo não encontrado ou sem acesso a esta loja.' }); agentId = agent.id;
      }
      const { error } = await supabase.from('support_conversations').update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() }).eq('id', conversation.id); if (error) throw error;
      await writeAudit(conversation.license_id, actor.owner ? req.actor.id : null, 'conversation.assigned', { conversation_id: conversation.id, assigned_agent_id: agentId, agent_id: actor.agent?.id || null });
      return res.json({ ok: true, assigned_agent_id: agentId });
    } catch (e) { console.error('Chat assign:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível atribuir o atendimento.' }); }
  });
  app.get('/api/portal/atendimento/chat/attachments/:attachmentId', authChat, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || req.actor.licenseId || '');
      const actor = await chatActor(req, res, 'conversations.view', licenseId); if (!actor) return;
      const attachmentId = String(req.params.attachmentId || '');
      if (!/^[a-zA-Z0-9_.-]{1,220}$/.test(attachmentId)) return res.status(400).json({ ok: false, message: 'Identificador de anexo inválido.' });
      const info = await mlAccountForLicense(actor.license);
      const url = `https://api.mercadolibre.com/messages/attachments/${encodeURIComponent(attachmentId)}?tag=post_sale&site_id=${encodeURIComponent(info.siteId)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${info.accessToken}` } });
      if (!response.ok) { const body = await response.json().catch(() => ({})); return res.status(response.status).json({ ok: false, message: body.message || 'Não foi possível obter o anexo.' }); }
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'inline; filename="anexo"');
      return res.send(Buffer.from(await response.arrayBuffer()));
    } catch (e) { console.error('Chat attachment download:', e.message); return res.status(e.status || 502).json({ ok: false, message: e.message || 'Não foi possível obter o anexo.' }); }
  });
  app.get('/api/portal/atendimento/chat/quick-replies', authChat, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || req.actor.licenseId || ''); const actor = await chatActor(req, res, null, licenseId); if (!actor) return; if (!actor.owner && !(actor.agent.permissions || []).some(p => ['quick_replies.use','quick_replies.manage'].includes(p))) return res.status(403).json({ ok: false, message: 'Você não tem permissão para consultar respostas rápidas.' });
      const { data, error } = await supabase.from('support_quick_replies').select('id,title,body,created_at,updated_at').eq('license_id', licenseId).order('title'); if (error) throw error;
      return res.json({ ok: true, quick_replies: data || [] });
    } catch (e) { console.error('Quick replies list:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível carregar respostas rápidas.' }); }
  });
  app.post('/api/portal/atendimento/chat/quick-replies', authChat, async (req, res) => {
    try {
      const licenseId = String(req.body?.license_id || req.actor.licenseId || ''); const actor = await chatActor(req, res, 'quick_replies.manage', licenseId); if (!actor) return;
      const title = String(req.body?.title || '').trim().slice(0, 80), body = String(req.body?.body || '').trim().slice(0, 350);
      if (!title || !body) return res.status(400).json({ ok: false, message: 'Informe título e texto (até 350 caracteres).' });
      const { data, error } = await supabase.from('support_quick_replies').insert({ license_id: licenseId, title, body, created_by_agent_id: actor.agent?.id || null, created_by_portal_user_id: actor.owner ? req.actor.id : null }).select('id,title,body,created_at').single(); if (error) throw error;
      await writeAudit(licenseId, actor.owner ? req.actor.id : null, 'quick_reply.created', { quick_reply_id: data.id, agent_id: actor.agent?.id || null }); return res.status(201).json({ ok: true, quick_reply: data });
    } catch (e) { console.error('Quick replies create:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível criar resposta rápida.' }); }
  });
  app.patch('/api/portal/atendimento/chat/quick-replies/:id', authChat, async (req, res) => {
    try {
      const { data: existing, error: findError } = await supabase.from('support_quick_replies').select('id,license_id').eq('id', req.params.id).maybeSingle(); if (findError) throw findError; if (!existing) return res.status(404).json({ ok: false, message: 'Resposta rápida não encontrada.' });
      const actor = await chatActor(req, res, 'quick_replies.manage', existing.license_id); if (!actor) return;
      const updates = { updated_at: new Date().toISOString() };
      if (req.body?.title !== undefined) { updates.title = String(req.body.title).trim().slice(0,80); if (!updates.title) return res.status(400).json({ ok:false, message:'Informe um título.' }); }
      if (req.body?.body !== undefined) { updates.body = String(req.body.body).trim().slice(0,350); if (!updates.body) return res.status(400).json({ ok:false, message:'Informe o texto.' }); }
      const { data, error } = await supabase.from('support_quick_replies').update(updates).eq('id', existing.id).select('id,title,body,updated_at').single(); if (error) throw error;
      await writeAudit(existing.license_id, actor.owner ? req.actor.id : null, 'quick_reply.updated', { quick_reply_id: existing.id, agent_id: actor.agent?.id || null }); return res.json({ ok:true, quick_reply:data });
    } catch (e) { console.error('Quick replies update:', e.code || e.message); return res.status(500).json({ ok:false, message:'Não foi possível atualizar resposta rápida.' }); }
  });
  app.delete('/api/portal/atendimento/chat/quick-replies/:id', authChat, async (req, res) => {
    try {
      const { data: existing, error: findError } = await supabase.from('support_quick_replies').select('id,license_id').eq('id', req.params.id).maybeSingle(); if (findError) throw findError; if (!existing) return res.status(404).json({ ok: false, message: 'Resposta rápida não encontrada.' });
      const actor = await chatActor(req, res, 'quick_replies.manage', existing.license_id); if (!actor) return;
      const { error } = await supabase.from('support_quick_replies').delete().eq('id', existing.id); if (error) throw error;
      await writeAudit(existing.license_id, actor.owner ? req.actor.id : null, 'quick_reply.deleted', { quick_reply_id: existing.id, agent_id: actor.agent?.id || null }); return res.json({ ok: true });
    } catch (e) { console.error('Quick replies delete:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível remover resposta rápida.' }); }
  });
  app.get('/api/portal/atendimento/chat/history.csv', authChat, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || req.actor.licenseId || ''); const actor = await chatActor(req, res, 'history.view', licenseId); if (!actor) return;
      let q = supabase.from('support_messages').select('external_message_id,sender_role,sender_id,text,status,created_at,conversation_id,support_conversations(pack_id,order_id,buyer_name)').eq('license_id', licenseId).order('created_at', { ascending: true }).limit(10000);
      if (req.query.conversation_id) q = q.eq('conversation_id', String(req.query.conversation_id));
      const { data, error } = await q; if (error) throw error;
      const lines = [['Data','Pedido','Comprador','Tipo','Remetente ID','Mensagem','Status'], ...(data || []).map(m => [m.created_at,m.support_conversations?.order_id || m.support_conversations?.pack_id,m.support_conversations?.buyer_name,m.sender_role,m.sender_id,m.text,m.status])];
      const csv = '\uFEFF' + lines.map(row => row.map(csvCell).join(';')).join('\r\n');
      await writeAudit(licenseId, actor.owner ? req.actor.id : null, 'history.exported_csv', { conversation_id: req.query.conversation_id || null, rows: (data || []).length, agent_id: actor.agent?.id || null });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="historico-atendimento.csv"'); return res.send(csv);
    } catch (e) { console.error('Chat history export:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível exportar o histórico.' }); }
  });
  app.get('/api/portal/atendimento/chat/audit', authChat, async (req, res) => {
    try {
      const licenseId = String(req.query.license_id || req.actor.licenseId || ''); const actor = await chatActor(req, res, 'history.view', licenseId); if (!actor) return;
      const { data, error } = await supabase.from('support_audit_logs').select('id,action,details,created_at,actor_portal_user_id').eq('license_id', licenseId).order('created_at', { ascending: false }).limit(500); if (error) throw error;
      return res.json({ ok: true, logs: data || [] });
    } catch (e) { console.error('Chat audit:', e.code || e.message); return res.status(500).json({ ok: false, message: 'Não foi possível consultar a auditoria.' }); }
  });

};
