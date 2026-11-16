(() => {
  'use strict';
  const escapeText = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function showGate(challenge) {
    document.querySelector('#mlshAdminGate')?.remove();
    const root=document.createElement('div');
    root.className='modal-backdrop';
    root.id='mlshAdminGate';
    root.style.zIndex='999999';
    root.innerHTML='<section class="modal" role="dialog" aria-modal="true" aria-labelledby="adminGateTitle"><div class="modal-head"><h2 id="adminGateTitle">Autorização do supervisor</h2></div><div class="modal-body"><p class="small muted">Seu login foi reconhecido. Solicite ao gerente ou supervisor que digite a senha administrativa para liberar o acesso.</p><form id="mlshAdminGateForm"><div class="field"><label for="mlshGatePassword">Senha administrativa</label><input id="mlshGatePassword" type="password" autocomplete="off" required></div><div id="mlshGateError" role="alert" aria-live="polite"></div><div class="modal-actions"><button class="btn btn-ghost" type="button" id="mlshGateCancel">Cancelar</button><button class="btn btn-primary" type="submit">Autorizar acesso</button></div></form></div></section>';
    document.body.appendChild(root);
    const field=root.querySelector('#mlshGatePassword');
    field.focus();
    root.querySelector('#mlshGateCancel').onclick=()=>{root.remove();document.querySelector('#loginPassword')?.focus();};
    root.querySelector('form').onsubmit=async event=>{
      event.preventDefault();
      const button=root.querySelector('button[type="submit"]');
      button.disabled=true;root.querySelector('#mlshGateError').textContent='';
      try {
        const result=await api('/api/portal/team-admin-authorize',{method:'POST',body:JSON.stringify({challenge,admin_password:field.value})});
        root.remove();
        token=result.token;localStorage.setItem('mlsh_portal_token',token);
        currentUser=result.user;
        await refreshDashboard();showApp();
      } catch (error) {
        root.querySelector('#mlshGateError').innerHTML='<div class="alert error">'+escapeText(error.message)+'</div>';
        field.value='';field.focus();
      } finally {button.disabled=false;}
    };
  }
  async function mountTeamSettings() {
    const container=document.querySelector('#agentModalRoot');
    if(!container || currentUser?.role==='support_agent'||document.querySelector('#mlshTeamAdminSettings'))return;
    const section=document.createElement('section');
    section.className='panel';
    section.id='mlshTeamAdminSettings';
    section.style.marginTop='20px';
    section.innerHTML='<div class="panel-head"><div><h3>Senha administrativa</h3><p class="small muted">Após entrar com e-mail e senha, o funcionário precisará da autorização do gerente ou supervisor. O titular não precisa dessa autorização.</p></div></div><div id="mlshAdminStatus" class="small muted">Verificando proteção…</div><form id="mlshAdminSettingsForm" style="max-width:440px;margin-top:16px"><div class="field"><label for="mlshOwnerPass">Senha atual da conta titular</label><input id="mlshOwnerPass" type="password" autocomplete="current-password" required></div><div class="field"><label for="mlshNewAdminPass">Nova senha administrativa</label><input id="mlshNewAdminPass" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div class="field"><label for="mlshConfirmAdminPass">Confirme a senha administrativa</label><input id="mlshConfirmAdminPass" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div><div id="mlshAdminSettingsError" role="alert" aria-live="polite"></div><button class="btn btn-primary" type="submit">Salvar senha administrativa</button></form>';
    container.insertAdjacentElement('afterend',section);
    const status=section.querySelector('#mlshAdminStatus');
    try {const result=await api('/api/portal/team-admin-password');status.textContent=result.enabled?'Proteção ativada — novos logins dos funcionários exigem autorização.':'Proteção desativada — defina a senha para ativar.';}
    catch(e){status.textContent='Não foi possível verificar a proteção: '+e.message;}
    section.querySelector('form').onsubmit=async e=>{
      e.preventDefault();
      const password=section.querySelector('#mlshNewAdminPass').value;
      const confirm=section.querySelector('#mlshConfirmAdminPass').value;
      const errorBox=section.querySelector('#mlshAdminSettingsError');
      errorBox.textContent='';
      if(password!==confirm){errorBox.textContent='As senhas administrativas não coincidem.';return;}
      const button=section.querySelector('button[type="submit"]');button.disabled=true;
      try {
        await api('/api/portal/team-admin-password',{method:'PUT',body:JSON.stringify({owner_password:section.querySelector('#mlshOwnerPass').value,admin_password:password})});
        section.querySelector('form').reset();
        status.textContent='Proteção ativada — novos logins dos funcionários exigem autorização.';
        toast('Senha administrativa salva com sucesso.');
      }catch(err){errorBox.textContent=err.message;}
      finally{button.disabled=false;}
    };
  }
  window.mlshAdminGate={open:showGate,mountTeamSettings};
})();
