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
  app.get('/api/portal/codes', authPortal, async (req, res) => {
    try {
      const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
        .select('licenses(company_id,companies(id,nome,codigo_ml,status))')
        .eq('user_id', req.portalUserId);
      if (linkError) throw linkError;

      const companies = new Map();
      for (const row of links || []) {
        const company = row.licenses?.companies;
        if (company?.id && !companies.has(String(company.id))) {
          companies.set(String(company.id), company);
        }
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
          latestCodeByCompany.set(key, String(row.code).trim());
        }
      }

      const codes = [...companies.entries()].map(([companyId, company]) => ({
        company_id: company.id,
        name: company.nome || 'Empresa',
        code: latestCodeByCompany.get(companyId) || String(company.codigo_ml || '').trim() || null,
        status: company.status || 'unknown'
      }));
      return res.json({ ok: true, codes });
    } catch (error) {
      console.error('Portal codes error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar os códigos das lojas.' });
    }
  });

  // Vendas reais das contas do Mercado Livre conectadas às empresas licenciadas.
  app.get('/api/portal/sales', authPortal, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(90, Number.parseInt(req.query.days, 10) || 30));
      const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
        .select('licenses(company_id,companies(id,nome,status))').eq('user_id', req.portalUserId);
      if (linkError) throw linkError;
      const companies = new Map();
      for (const row of links || []) {
        const c = row.licenses?.companies;
        if (c?.id) companies.set(c.id, c);
      }
      const companyIds = [...companies.keys()];
      if (!companyIds.length) return res.json({ ok: true, days, connected: 0, totals: { orders: 0, revenue: 0 }, stores: [] });

      const { data: accounts, error: accountError } = await supabase.from('mercadolivre_accounts')
        .select('company_id,ml_user_id,nickname,access_token,refresh_token,token_expires_at')
        .in('company_id', companyIds);
      if (accountError) throw accountError;

      const stores = [];
      const allProducts = [];
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
      const from = new Date(now - days * 86400000).toISOString();
      const to = new Date(now).toISOString();

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
          const fetchOrdersRange = async (rangeFrom, rangeTo, depth = 0) => {
            const fetchPage = async (offset) => {
              const params = new URLSearchParams({
                seller: String(account.ml_user_id),
                'order.date_created.from': rangeFrom,
                'order.date_created.to': rangeTo,
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
              await fetchOrdersRange(rangeFrom, middle, depth + 1);
              await fetchOrdersRange(middle, rangeTo, depth + 1);
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
          await fetchOrdersRange(from, to);
          const orders = [...orderMap.values()];
          const revenue = orders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
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
          const enrichmentTargets = storeProducts.slice().sort((a, b) => b.quantity_sold - a.quantity_sold).slice(0, 100);
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
            orders: orders.length,
            revenue,
            orders_sampled: orders.length,
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
      return res.json({
        ok: true, days, connected: stores.filter(s => s.connected).length,
        totals: {
          orders: stores.reduce((sum, s) => sum + (s.orders || 0), 0),
          revenue: stores.reduce((sum, s) => sum + (s.revenue || 0), 0),
          units: totalUnits,
          products: allProducts.length
        },
        stores,
        products: allProducts
      });
    } catch (error) {
      console.error('Portal sales error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar as vendas.' });
    }
  });

  app.get('/api/portal/dashboard', authPortal, async (req, res) => {
    try {
      const { data: links, error: linkError } = await supabase.from('portal_user_licenses')
        .select('licenses(id,chave,status,vencimento,company_id,companies(id,nome,status,codigo_ml))').eq('user_id', req.portalUserId);
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
      return res.json({ ok: true, summary: { licenses: licenses.length, active_licenses: activeLicenses, companies: companyIds.length, devices: devices.length, active_devices: devices.filter(d => d.status === 'active').length }, licenses: licenses.map(l => ({ id: l.id, chave: l.chave, status: l.status, vencimento: l.vencimento, company_id: l.company_id, company: l.companies?.nome || 'Empresa não identificada', codigo_ml: l.companies?.codigo_ml || null })), devices });
    } catch (error) {
      console.error('Portal dashboard error:', error.message);
      return res.status(500).json({ ok: false, error: 'server_error', message: 'Não foi possível carregar o painel.' });
    }
  });
};
