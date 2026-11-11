/* MLSH - complementos da central de atendimento, sem bibliotecas externas */
(() => {
  const labels = ['Urgente','Garantia','Defeito','Atraso','Devolução','Dúvida técnica'];
  const baseline = new Map();
  let lastLicense = '';
  let selectedLabel = '';
  let soundEnabled = localStorage.getItem('mlsh_chat_sound') === '1';
  let unread = 0;
  const originalTitle = document.title;
  const safe = v => esc(String(v ?? ''));
  const conversationUrl = id => '/api/portal/atendimento/chat/conversations/' + encodeURIComponent(id);
  const duration = date => {
    if (!date || !Number.isFinite(new Date(date).getTime())) return '';
    const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime())/60000));
    if (mins < 1) return 'há menos de 1 min';
    if (mins < 60) return 'há ' + mins + ' min';
    const hrs = Math.floor(mins / 60);
    return hrs < 24 ? 'há ' + hrs + ' h ' + (mins%60) + ' min' : 'há ' + Math.floor(hrs/24) + ' d ' + (hrs%24) + ' h';
  };
  function ring() {
    if (!soundEnabled) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';osc.frequency.value=740;
      gain.gain.setValueAtTime(0.0001,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09,ctx.currentTime+0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.23);
      osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.25);
      osc.onended=()=>ctx.close().catch(()=>{});
    }catch(_){}
  }
  function updateNotifications() {
    const license = String(document.querySelector('#chatLicense')?.value || '');
    if (!license) return;
    if (lastLicense !== license) { lastLicense = license; unread = 0; }
    let newMessages = 0;
    for (const c of chatConversations || []) {
      const key = license + ':' + String(c.id);
      const stamp = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
      const previous = baseline.get(key);
      if (previous !== undefined && stamp > previous && c.has_unread_buyer && c.last_sender_role === 'buyer') {
        newMessages++;
        if (typeof toast === 'function') toast('Nova mensagem: ' + (c.buyer_name || 'comprador') + ' · ' + (c.company_name || 'Loja'));
        if ('Notification' in window && Notification.permission === 'granted') {
          try { new Notification('Nova mensagem de comprador', {body: (c.buyer_name || 'Comprador') + ' · ' + (c.company_name || 'Loja'), tag: 'mlsh-' + c.id}); } catch (_) {}
        }
      }
      baseline.set(key, Math.max(stamp, previous || 0));
    }
    if (newMessages) ring();
    unread = (chatConversations || []).filter(c=>c.has_unread_buyer).length;
    document.title = unread ? '(' + unread + ') ' + originalTitle : originalTitle;
    let btn = document.getElementById('chatAlerts');
    const count = document.getElementById('chatAlertCount');
    if (count) count.textContent = unread ? ' • ' + unread + ' nova(s)' : '';
    if (btn) btn.setAttribute('aria-label', 'Som de notificações: ' + (soundEnabled?'ligado':'desligado'));
  }
  function ensureToolbar() {
    const heading = document.querySelector('.wa-sidebar-top');
    if (!heading || heading.querySelector('#chatAlerts')) return;
    const button=document.createElement('button');button.type='button';button.id='chatAlerts';
    button.className='btn btn-ghost';button.textContent=soundEnabled?'🔔':'🔕';
    button.title='Ativar ou desativar som de novas mensagens';button.onclick=()=>{
      soundEnabled=!soundEnabled;localStorage.setItem('mlsh_chat_sound',soundEnabled?'1':'0');button.textContent=soundEnabled?'🔔':'🔕';
      if(soundEnabled && 'Notification' in window && Notification.permission==='default') Notification.requestPermission().catch(()=>{});
      button.title=soundEnabled?'Desligar som':'Ligar som';
      if(soundEnabled) ring();
    };
    const tag=document.createElement('small');tag.id='chatAlertCount';tag.className='muted';
    heading.append(button,tag);
    const filterRoot=document.querySelector('.chat-list');
    if (filterRoot && !filterRoot.querySelector('#chatLabelFilter')) {
      const sel=document.createElement('select');sel.id='chatLabelFilter';sel.className='chat-label-filter';
      sel.innerHTML='<option value="">Todas as etiquetas</option>'+labels.map(l=>'<option value="'+safe(l)+'">'+safe(l)+'</option>').join('');
      sel.onchange=()=>{selectedLabel=sel.value;renderChatConversations()};
      const list=document.querySelector('#chatConversationList');if(list)filterRoot.insertBefore(sel,list);
    }
  }
  const baseRender=renderChatConversations;
  renderChatConversations=function(...args) {
    baseRender.apply(this,args);
    ensureToolbar();
    updateNotifications();
    const root=document.querySelector('#chatConversationList');if(!root)return;
    let visibleRows=0;
    for(const row of root.querySelectorAll('[data-chat-id]')){
      const c=chatConversations.find(v=>String(v.id)===row.dataset.chatId);if(!c)continue;
      if(selectedLabel && !(c.labels||[]).includes(selectedLabel)){row.hidden=true;continue}
      visibleRows++;
      const bottom=row.querySelector('.wa-conv-bottom');
      if(!bottom)continue;
      if(c.has_unread_buyer){
        const dot=document.createElement('span');dot.className='chat-unread-dot';dot.title='Nova mensagem do comprador';dot.setAttribute('aria-label','Nova mensagem do comprador');
        const top=row.querySelector('.wa-conv-top');if(top)top.append(dot);
      }
      if(c.waiting_since) {
        const time=document.createElement('small');time.className='chat-wait-time';time.textContent='Cliente aguardando '+duration(c.waiting_since);bottom.append(time);
      }
      for(const label of c.labels||[]){
        const chip=document.createElement('span');chip.className='chat-label-chip';chip.textContent=label;bottom.append(chip);
      }
    }
    if(selectedLabel){const count=document.querySelector('#chatCount');if(count)count.textContent=visibleRows+' conversa(s) com esta etiqueta'}
  };
  function noteHtml(notes) {
    return notes.length ? notes.map(n=>'<div class="chat-note"><strong>'+safe(n.author_name)+'</strong> · <small>'+safe(new Date(n.created_at).toLocaleString('pt-BR'))+'</small><p>'+safe(n.note)+'</p></div>').join('') : '<p class="muted small">Ainda não há notas internas.</p>';
  }
  const baseOpen=openChatConversation;
  openChatConversation=async function(c,...rest) {
    await baseOpen.call(this,c,...rest);
    if(!c || String(activeConversation?.id)!==String(c.id))return;
    const head=document.querySelector('#chatThread .chat-thread-head');
    if(!head)return;
    const actions=head.querySelector('.actions') || head;
    const closeButton=document.createElement('button');
    closeButton.type='button';
    closeButton.id='chatCloseViewBtn';
    closeButton.className='btn btn-ghost chat-close-view-btn';
    closeButton.textContent='✕ Fechar visualização';
    closeButton.title='Voltar à lista sem encerrar o atendimento';
    closeButton.onclick=()=>{
      activeConversation=null;
      document.querySelector('.chat-layout')?.classList.remove('chat-mobile-open');
      document.querySelector('#chatThread')?.classList.add('hidden');
      document.querySelector('#chatEmpty')?.classList.remove('hidden');
      renderChatConversations();
    };
    actions.append(closeButton);
    // A abertura foi concluída no backend, e o marcador é compartilhado.
    c.has_unread_buyer=false;c.waiting_since=null;
    const stored=chatConversations.find(x=>String(x.id)===String(c.id));
    if(stored){stored.has_unread_buyer=false;stored.waiting_since=null}
    const license=String(document.querySelector('#chatLicense')?.value || '');
    baseline.set(license+':'+String(c.id),new Date(c.last_message_at||0).getTime());
    renderChatConversations();
    loadChatConversations(false).catch(()=>{});
    const details=document.createElement('details');details.className='chat-extra-details';details.open=false;details.removeAttribute('open');
    details.innerHTML='<summary>Informações do atendimento e notas internas</summary><div class="chat-extra-grid"><section><h4>Etiquetas</h4><div id="chatTagChecks">'+labels.map(l=>'<label><input type="checkbox" value="'+safe(l)+'" '+((c.labels||[]).includes(l)?'checked':'')+'> '+safe(l)+'</label>').join('')+'</div><button class="mini-btn" id="chatSaveLabels">Salvar etiquetas</button><h4>Pedido</h4><div id="chatOrderSummary" class="small muted">Consultando pedido…</div></section><section><h4>Notas internas <span class="muted small">(não enviadas ao comprador)</span></h4><div id="chatInternalNotes" class="chat-notes-list small">Carregando notas…</div><textarea id="chatInternalNoteText" maxlength="3000" rows="2" placeholder="Escreva uma observação só para a equipe…"></textarea><button class="mini-btn" id="chatAddInternalNote">Adicionar nota interna</button></section></div>';
    head.after(details);
    const valid=()=>String(activeConversation?.id)===String(c.id)&&details.isConnected;
    const showError=(id,e)=>{const el=details.querySelector(id);if(el)el.textContent=e.message||'Falha na consulta'};
    details.querySelector('#chatSaveLabels').onclick=async ev=>{
      const btn=ev.currentTarget;btn.disabled=true;
      try{
        const values=[...details.querySelectorAll('#chatTagChecks input:checked')].map(v=>v.value);
        const r=await api(conversationUrl(c.id)+'/labels',{method:'PATCH',body:JSON.stringify({labels:values})});
        c.labels=r.labels;
        const existing=chatConversations.find(v=>String(v.id)===String(c.id));if(existing)existing.labels=r.labels;
        renderChatConversations();toast('Etiquetas atualizadas.');
      }catch(e){toast(e.message)}finally{btn.disabled=false}
    };
    details.querySelector('#chatAddInternalNote').onclick=async ev=>{
      const input=details.querySelector('#chatInternalNoteText');const note=input.value.trim();if(!note)return;
      const btn=ev.currentTarget;btn.disabled=true;
      try{
        await api(conversationUrl(c.id)+'/notes',{method:'POST',body:JSON.stringify({note})});
        input.value='';
        const r=await api(conversationUrl(c.id)+'/notes');if(valid())details.querySelector('#chatInternalNotes').innerHTML=noteHtml(r.notes||[]);
        toast('Nota interna salva.');
      }catch(e){toast(e.message)}finally{btn.disabled=false}
    };
    api(conversationUrl(c.id)+'/notes').then(r=>{
      if(valid())details.querySelector('#chatInternalNotes').innerHTML=noteHtml(r.notes||[]);
    }).catch(e=>{if(valid())showError('#chatInternalNotes',e)});
    api(conversationUrl(c.id)+'/order-summary').then(r=>{
      if(!valid())return;
      const o=r.order;const container=details.querySelector('#chatOrderSummary');
      const products=(o.products||[]).map(item=>'<div class="chat-order-item">'+(item.image?'<img loading="lazy" src="'+safe(item.image)+'" alt="">':'')+'<div><strong>'+safe(item.title)+'</strong><small>SKU: '+safe(item.sku||'—')+' · '+safe(item.quantity)+' un.</small></div></div>').join('');
      container.innerHTML='<p><strong>Pedido #'+safe(o.id)+'</strong> · '+safe(o.status)+'</p><p>Valor: '+Number(o.total||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})+'</p><p>Envio: '+safe(o.shipping_id||'—')+' '+safe(o.shipping_status||'')+' · '+safe(o.logistic_type||'')+'</p>'+products;
    }).catch(e=>{if(valid())showError('#chatOrderSummary',e)});
  };
  setInterval(()=>{if(currentPage==='chat'&&document.querySelector('#chatConversationList'))renderChatConversations()},60000);
})();