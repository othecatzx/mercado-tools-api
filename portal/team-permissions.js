/* ML Support — tela de permissões de subusuários (aditiva).
 * Usa a API /api/portal/atendimento/agents já existente.
 * O backend continua sendo a autoridade para todas as permissões.
 */
(() => {
  'use strict';
  const style = document.createElement('style');
  style.textContent = `
    .ml-perm-modal{width:min(96vw,960px)!important;max-width:960px!important;max-height:min(92dvh,920px)!important;display:flex;flex-direction:column;overflow:hidden!important}
    .ml-perm-modal .ml-perm-body{overflow-y:auto;min-height:0;overscroll-behavior:contain;padding:18px 22px 8px}
    .ml-perm-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
    .ml-perm-section{min-width:0;border:1px solid var(--line);background:var(--panel);border-radius:14px;padding:15px;margin-bottom:14px}
    .ml-perm-section h3{font-size:14px;font-weight:750;margin:0 0 5px;color:var(--ink)}
    .ml-perm-section p{margin:0 0 12px;font-size:12px;color:var(--muted)}
    .ml-perm-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .ml-perm-choice{display:flex;align-items:center;gap:9px;min-width:0;border:1px solid var(--line);border-radius:10px;padding:11px;background:var(--panel-2);cursor:pointer;font-size:12px;color:var(--ink);transition:border-color .15s}
    .ml-perm-choice:has(input:checked){border-color:var(--purple);background:color-mix(in srgb,var(--purple) 7%,var(--panel))}
    .ml-perm-choice input{accent-color:var(--purple);flex-shrink:0;width:16px;height:16px;margin:0}
    .ml-perm-choice span{overflow-wrap:anywhere;line-height:1.35}
    .ml-perm-choice:has(input:disabled){opacity:.65;cursor:default}
    .ml-perm-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;padding:12px 22px 16px;background:var(--panel);border-top:1px solid var(--line)}
    .ml-perm-head-actions{display:flex;gap:8px;align-items:center}
    .ml-perm-link{border:0;background:none;color:var(--purple);font-size:12px;cursor:pointer;font-weight:650;padding:4px}
    .ml-perm-headline{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
    .ml-perm-note{background:var(--panel-2);border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-size:12px;color:var(--muted);margin-bottom:14px}
    .ml-perm-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .ml-perm-fields .field{min-width:0}
    .ml-perm-fields .field input{width:100%;min-width:0}
    .ml-perm-modal input:focus-visible,.ml-perm-modal button:focus-visible{outline:2px solid var(--purple);outline-offset:2px}
    @media(max-width:760px){.ml-perm-layout{grid-template-columns:1fr}.ml-perm-modal{width:min(100vw,680px)!important;max-height:94dvh!important}.ml-perm-modal .ml-perm-body{padding:14px}.ml-perm-actions{padding:12px 14px}.ml-perm-fields{grid-template-columns:1fr}}
    @media(max-width:420px){.ml-perm-grid{grid-template-columns:1fr}.ml-perm-section{padding:12px}.ml-perm-actions .btn{flex:1}}
  `;
  document.head.appendChild(style);

  // BLING_USER_UI_V1 — permissões granulares e conexão selecionada pelo titular.
  const blingLabels={'bling.entries.view':'Visualizar entradas de estoque','bling.products.sync':'Sincronizar dados dos produtos','bling.labels.print':'Gerar e imprimir etiquetas','bling.templates.manage':'Gerenciar modelos de etiquetas','bling.connections.manage':'Gerenciar conexões existentes'};
  // Esta função substitui apenas o formulário de criação/edição, sem substituir o restante do portal.
  window.openAgentModal = async function openAgentModal(agent = null) {
    if (typeof teamCan !== 'function' || typeof api !== 'function') return;
    const editing = !!agent;
    if (!teamCan(editing ? 'users.edit' : 'users.create')) { toast('Você não tem permissão para esta operação.'); return; }
    const manager = currentUser?.role !== 'support_agent' || teamCan('users.manage_permissions');
    const selectedChat = new Set(agent?.permissions || (editing ? [] : ['conversations.view','conversations.reply','attachments.send','quick_replies.use']));
    const selectedMenus = new Set(agent?.menu_permissions || ['chat']);
    const selectedManagement = new Set(agent?.user_management_permissions || []);
    const selectedBling = new Set(agent?.bling_permissions||[]);
    const selectedBlingConnections = new Set(agent?.bling_connection_ids||[]);
    const mainLicense = String(agent?.license_id || selectedTeamLicense);
    const selectedStores = new Set((agent?.allowed_license_ids || [mainLicense]).map(String));
    selectedStores.add(mainLicense);
    const host = document.getElementById('agentModalRoot');
    if (!host) return;
    const options = (labels, name, set, disabled = false) => Object.entries(labels).map(([key, label]) =>
      `<label class="ml-perm-choice"><input type="checkbox" name="${name}" value="${esc(key)}" ${set.has(key)?'checked':''} ${disabled?'disabled':''}><span>${esc(label)}</span></label>`
    ).join('');
    const stores = (teamLicenses || []).map(l => {
      const id = String(l.id), primary = id === mainLicense;
      return `<label class="ml-perm-choice"><input type="checkbox" name="agentStore" value="${esc(id)}" ${selectedStores.has(id)?'checked':''} ${primary||!manager?'disabled':''}><span>${esc(l.company_name||'Loja')}${primary?' · principal':''}</span></label>`;
    }).join('');
    let availableBling=[];
    if(currentUser?.role!=='support_agent'){
      try{const r=await api('/api/portal/bling/connections');availableBling=r.connections||[];}catch(e){console.warn('Conexões Bling indisponíveis:',e.message);}
    }
    host.innerHTML = `<div class="modal-backdrop" id="agentBackdrop"><section class="modal ml-perm-modal" role="dialog" aria-modal="true" aria-labelledby="mlAgentHeading">
      <div class="modal-head"><div><h2 id="mlAgentHeading">${editing?'Editar subusuário':'Novo subusuário'}</h2><div class="small muted">Configure o acesso de forma simples e segura</div></div><button type="button" class="modal-close" id="agentClose" aria-label="Fechar">×</button></div>
      <form id="agentForm" style="display:contents"><div class="ml-perm-body">
        <section class="ml-perm-section"><h3>Dados de acesso</h3><p>Informações utilizadas para entrar no portal.</p><div class="ml-perm-fields">
          <div class="field"><label for="agentName">Nome</label><input id="agentName" maxlength="100" required value="${esc(agent?.nome||'')}"></div>
          <div class="field"><label for="agentEmail">E-mail</label><input id="agentEmail" type="email" required ${editing?'readonly':''} autocomplete="email" value="${esc(agent?.email||'')}"></div>
          <div class="field"><label for="agentPassword">${editing?'Nova senha (opcional)':'Senha inicial (mínimo 8 caracteres)'}</label><input id="agentPassword" type="password" minlength="8" ${editing?'':'required'} autocomplete="new-password"></div>
        </div></section>
        <section class="ml-perm-section"><h3>Lojas permitidas</h3><p>Escolha as lojas acessíveis. A principal é obrigatória.</p><div class="ml-perm-grid">${stores}</div></section>
        ${manager?`<div class="ml-perm-layout">
          <section class="ml-perm-section"><div class="ml-perm-headline"><div><h3>Menus do portal</h3><p>Áreas visíveis no menu lateral.</p></div><div class="ml-perm-head-actions"><button type="button" class="ml-perm-link" data-check-group="agentMenuPermission">Todos</button><button type="button" class="ml-perm-link" data-uncheck-group="agentMenuPermission">Limpar</button></div></div><div class="ml-perm-grid">${options(agentMenuLabels,'agentMenuPermission',selectedMenus)}</div></section>
          <section class="ml-perm-section"><div class="ml-perm-headline"><div><h3>Atendimento</h3><p>Ações permitidas dentro do chat.</p></div><button type="button" class="ml-perm-link" data-uncheck-group="agentPermission">Limpar</button></div><div class="ml-perm-grid">${options(supportPermissionLabels,'agentPermission',selectedChat)}</div></section>
        </div>
        <section class="ml-perm-section"><h3>Gerenciamento de usuários</h3><p>Permissões administrativas. Ao habilitar uma destas ações, a visualização da equipe e o menu Equipe serão liberados automaticamente.</p><div class="ml-perm-grid">${options(userManagementLabels,'agentUserManagementPermission',selectedManagement)}</div></section>
        ${currentUser?.role!=='support_agent'?`<section class="ml-perm-section"><h3>Bling e etiquetas</h3><p>Conceda somente as ações necessárias. O acesso também fica limitado às conexões selecionadas.</p><div class="ml-perm-grid">${options(blingLabels,'agentBlingPermission',selectedBling)}</div><h3 style="margin-top:18px">Contas Bling autorizadas</h3><div class="ml-perm-grid">${availableBling.map(c=>`<label class="ml-perm-choice"><input type="checkbox" name="agentBlingConnection" value="${esc(c.id)}" ${selectedBlingConnections.has(c.id)?'checked':''}><span>${esc(c.name)}</span></label>`).join('')||'<div class="small muted">Nenhuma conexão disponível.</div>'}</div><div class="ml-perm-note" style="margin-top:12px">Uma conta Bling pode reunir várias lojas. O limite é por conexão; não separa produtos de lojas que compartilham a mesma conta.</div></section>`:'<div class="ml-perm-note">Somente o titular pode conceder permissões Bling.</div>'}
        `:`<div class="ml-perm-note">Suas permissões não permitem alterar o acesso dos demais usuários. O novo usuário receberá apenas permissões autorizadas pelo servidor.</div>`}
        <div id="agentFormError" aria-live="polite"></div>
      </div><div class="ml-perm-actions"><button type="button" class="btn btn-ghost" id="agentCancel">Cancelar</button><button type="submit" class="btn btn-primary">${editing?'Salvar alterações':'Criar subusuário'}</button></div></form>
    </section></div>`;
    const $ = id => host.querySelector('#'+id);
    const close = () => { host.innerHTML = ''; };
    $('agentClose').onclick = close;
    $('agentCancel').onclick = close;
    $('agentBackdrop').onclick = e => { if(e.target === $('agentBackdrop')) close(); };
    const checked = name => [...host.querySelectorAll(`input[name="${name}"]:checked`)].map(e => e.value);
    const error = message => { $('agentFormError').innerHTML = `<div class="alert error">${esc(message)}</div>`; };
    const synchronizeDependencies = () => {
      if(!manager) return;
      const mgmt = checked('agentUserManagementPermission');
      if(mgmt.some(p => p !== 'users.view')){
        host.querySelector('input[name="agentUserManagementPermission"][value="users.view"]').checked = true;
      }
      if(checked('agentUserManagementPermission').length) {
        host.querySelector('input[name="agentMenuPermission"][value="team"]').checked = true;
      }
      if(host.querySelector('input[name="agentMenuPermission"][value="team"]').checked) {
        host.querySelector('input[name="agentUserManagementPermission"][value="users.view"]').checked = true;
      }
      const chatPermissions = checked('agentPermission');
      if(chatPermissions.length) host.querySelector('input[name="agentMenuPermission"][value="chat"]').checked = true;
      if(chatPermissions.some(p => p !== 'conversations.view')) host.querySelector('input[name="agentPermission"][value="conversations.view"]').checked = true;
    };
    host.querySelectorAll('input[type="checkbox"]').forEach(c => c.addEventListener('change', synchronizeDependencies));
    host.querySelectorAll('[data-check-group]').forEach(b => b.onclick=()=>{host.querySelectorAll(`input[name="${b.dataset.checkGroup}"]:not(:disabled)`).forEach(x=>x.checked=true);synchronizeDependencies();});
    host.querySelectorAll('[data-uncheck-group]').forEach(b => b.onclick=()=>{
      const name=b.dataset.uncheckGroup;
      host.querySelectorAll(`input[name="${name}"]:not(:disabled)`).forEach(x=>x.checked=false);
      if(name==='agentMenuPermission') host.querySelectorAll('input[name="agentUserManagementPermission"],input[name="agentPermission"]').forEach(x=>x.checked=false);
      synchronizeDependencies();
    });
    synchronizeDependencies();
    $('agentForm').onsubmit = async e => {
      e.preventDefault();
      const submit = $('agentForm').querySelector('button[type="submit"]');
      const permissionMenus = checked('agentMenuPermission');
      if(manager && !permissionMenus.length) return error('Selecione pelo menos um menu para este usuário.');
      const allowed_license_ids=[...new Set([...checked('agentStore'), mainLicense])];
      const payload={nome:$('agentName').value.trim()};
      if(!payload.nome) return error('Informe o nome do usuário.');
      if(currentUser?.role!=='support_agent'){
        payload.bling_permissions=checked('agentBlingPermission');
        if(payload.bling_permissions.some(p=>['bling.products.sync','bling.labels.print'].includes(p))&&!payload.bling_permissions.includes('bling.entries.view'))payload.bling_permissions.push('bling.entries.view');
        payload.bling_connection_ids=checked('agentBlingConnection');
        const menus=new Set(permissionMenus);
        if(payload.bling_permissions.some(p=>['bling.entries.view','bling.products.sync','bling.labels.print'].includes(p)))menus.add('bling-entries');
        if(payload.bling_permissions.includes('bling.templates.manage'))menus.add('bling-labels');
        if(payload.bling_permissions.includes('bling.connections.manage'))menus.add('bling-integrations');
        permissionMenus.splice(0,permissionMenus.length,...menus);
        if(payload.bling_permissions.length&&!payload.bling_connection_ids.length)return error('Selecione ao menos uma conexão Bling autorizada.');
      }
      if(manager){
        payload.permissions=checked('agentPermission');
        payload.menu_permissions=permissionMenus;
        payload.user_management_permissions=checked('agentUserManagementPermission');
        payload.allowed_license_ids=allowed_license_ids;
      } else if(!editing){
        // Na criação sem permissão administrativa, o backend valida e limita o acesso.
        payload.allowed_license_ids=allowed_license_ids;
      }
      if(!editing){
        payload.license_id=mainLicense;
        payload.email=$('agentEmail').value.trim().toLowerCase();
        payload.senha=$('agentPassword').value;
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))return error('Informe um e-mail válido.');
      }else if($('agentPassword').value) payload.senha=$('agentPassword').value;
      submit.disabled=true;
      try{
        await api(editing?'/api/portal/atendimento/agents/'+encodeURIComponent(agent.id):'/api/portal/atendimento/agents',{
          method: editing?'PATCH':'POST',body:JSON.stringify(payload)
        });
        close();await loadTeamAgents();toast(editing?'Subusuário atualizado.':'Subusuário criado.');
      }catch(err){error(err.message)}finally{submit.disabled=false;}
    };
    $('agentName').focus();
  };
})();
