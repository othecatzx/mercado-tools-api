/* ML SH Support - notificacoes e confirmacoes personalizadas */
(function(){
  'use strict';
  if(window.showConfirmModal && window.showToast)return;
  const style=document.createElement('style');
  style.textContent=`
  .mlsh-toast-stack{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;max-width:min(400px,calc(100vw - 32px));pointer-events:none}
  .mlsh-toast{display:flex;gap:12px;align-items:flex-start;background:#14213d;color:#fff;padding:15px 16px;border-radius:15px;box-shadow:0 18px 50px #0004;border:1px solid #ffffff25;pointer-events:auto;animation:mlsh-in .22s ease;font:500 13px/1.5 system-ui,sans-serif;white-space:pre-line;overflow-wrap:anywhere}
  .mlsh-toast strong{display:block;font-size:13px;margin-bottom:2px}.mlsh-toast span{flex:1}.mlsh-toast .mlsh-symbol{font-size:17px;color:#fca311}
  .mlsh-toast button{border:0;background:transparent;color:#fff;opacity:.7;font-size:20px;cursor:pointer;line-height:1}
  .mlsh-toast[data-kind=error]{border-left:4px solid #ef4444}.mlsh-toast[data-kind=success]{border-left:4px solid #22c55e}
  .mlsh-overlay{position:fixed;inset:0;z-index:2147483001;display:grid;place-items:center;padding:20px;background:#050a16ab;backdrop-filter:blur(5px)}
  .mlsh-dialog{width:min(100%,460px);background:#fff;color:#14213d;border-radius:22px;box-shadow:0 24px 90px #0005;padding:28px;animation:mlsh-in .2s ease;font:14px/1.6 system-ui,sans-serif}
  .mlsh-dialog-icon{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:#fff3df;color:#ba6900;font-size:24px;margin-bottom:15px}
  .mlsh-dialog h2{margin:0 0 8px;font-size:21px;line-height:1.3;letter-spacing:-.5px;color:#14213d}
  .mlsh-dialog p{margin:0;color:#52617a;white-space:pre-line;overflow-wrap:anywhere}
  .mlsh-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:26px;flex-wrap:wrap}
  .mlsh-dialog-actions button{border-radius:11px;padding:11px 18px;border:1px solid #dbe1ea;background:#f7f8fa;color:#14213d;font-weight:750;cursor:pointer;font:700 13px system-ui,sans-serif}
  .mlsh-dialog-actions button.mlsh-primary{background:#fca311;border-color:#fca311;color:#14213d}
  .mlsh-dialog-actions button.mlsh-danger{background:#dc3545;border-color:#dc3545;color:white}
  .mlsh-dialog-actions button:focus-visible,.mlsh-toast button:focus-visible{outline:3px solid #fca311;outline-offset:3px}
  @keyframes mlsh-in{from{opacity:0;transform:translateY(9px) scale(.98)}to{opacity:1;transform:none}}
  @media(prefers-reduced-motion:reduce){.mlsh-toast,.mlsh-dialog{animation:none}}
  `;
  document.head.appendChild(style);
  function ensureStack(){let el=document.querySelector('.mlsh-toast-stack');if(!el){el=document.createElement('div');el.className='mlsh-toast-stack';document.body.appendChild(el)}return el}
  let lastToastAt=0;
  window.showToast=function(message,kind='info'){
    lastToastAt=Date.now();
    const msg=String(message?.message||message||'Operação concluída.');
    kind=['success','error','info','warning'].includes(kind)?kind:/erro|falha|não foi possível|inválid|negad/i.test(msg)?'error':/sucesso|removid|alterad|salv|atualizad|criad|gerad/i.test(msg)?'success':'info';
    const el=document.createElement('div');el.className='mlsh-toast';el.dataset.kind=kind;el.setAttribute('role',kind==='error'?'alert':'status');
    const ico=document.createElement('div');ico.className='mlsh-symbol';ico.textContent=kind==='success'?'✓':kind==='error'?'!':'●';
    const body=document.createElement('span');const title=document.createElement('strong');title.textContent=kind==='success'?'Concluído':kind==='error'?'Não foi possível':'ML SH Support';
    const description=document.createElement('div');description.textContent=msg;body.append(title,description);
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Fechar notificação');
    const dismiss=()=>{clearTimeout(timer);el.remove()};close.onclick=dismiss;el.append(ico,body,close);ensureStack().appendChild(el);
    const timer=setTimeout(dismiss,kind==='error'?7500:4500);return el;
  };
  // Indicador compartilhado das alterações no admin. Usa somente respostas confirmadas da API.
  window.adminSaveFeedback={
    start(){
      const focused=document.activeElement;
      const button=focused?.closest?.('button[type=submit],button')||(focused?.form?.querySelector?.('button[type=submit]')||null);
      if(!button||button.disabled||button.dataset.adminSaving==='1')return null;
      const oldHtml=button.innerHTML;
      button.dataset.adminSaving='1';
      button.disabled=true;
      button.setAttribute('aria-busy','true');
      const spinner=document.createElement('span');spinner.className='mlsh-saving-spinner';spinner.setAttribute('aria-hidden','true');
      button.replaceChildren(spinner,document.createTextNode(' Salvando…'));
      return ()=>{if(!button.isConnected)return;button.innerHTML=oldHtml;button.disabled=false;button.removeAttribute('aria-busy');delete button.dataset.adminSaving};
    },
    result(ok,info=''){
      const stamped=Date.now();
      setTimeout(()=>{
        if(lastToastAt>stamped)return;
        window.showToast(ok?'Alterações salvas com sucesso.':info||'Não foi possível salvar. Tente novamente.',ok?'success':'error');
      },650);
    }
  };
  style.textContent+='.mlsh-saving-spinner{display:inline-block;width:13px;height:13px;vertical-align:-2px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:mlsh-save-spin .65s linear infinite}@keyframes mlsh-save-spin{to{transform:rotate(360deg)}}';
  window.showConfirmModal=function(message,options={}){
    return new Promise(resolve=>{
      const settings=typeof message==='object'&&message!==null?message:{...options,message};
      const overlay=document.createElement('div');overlay.className='mlsh-overlay';
      const dialog=document.createElement('div');dialog.className='mlsh-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
      dialog.setAttribute('aria-label',settings.title||'Confirmar ação');
      const icon=document.createElement('div');icon.className='mlsh-dialog-icon';icon.textContent=settings.danger?'!':'?';
      const title=document.createElement('h2');title.textContent=settings.title||'Confirmar ação';
      const description=document.createElement('p');description.textContent=String(settings.message||'Deseja continuar?');
      const actions=document.createElement('div');actions.className='mlsh-dialog-actions';
      const cancel=document.createElement('button');cancel.type='button';cancel.textContent=settings.cancelText||'Cancelar';
      const proceed=document.createElement('button');proceed.type='button';proceed.textContent=settings.confirmText||'Confirmar';
      proceed.className=settings.danger?'mlsh-danger':'mlsh-primary';actions.append(cancel,proceed);dialog.append(icon,title,description,actions);overlay.appendChild(dialog);
      const previousFocus=document.activeElement;
      function finish(value){document.removeEventListener('keydown',onKey,true);overlay.remove();if(previousFocus&&previousFocus.isConnected&&previousFocus.focus)previousFocus.focus();resolve(value)}
      function onKey(e){if(e.key==='Escape'){e.preventDefault();finish(false)}else if(e.key==='Tab'){const target=document.activeElement===cancel?proceed:cancel;e.preventDefault();target.focus()}}
      cancel.onclick=()=>finish(false);proceed.onclick=()=>finish(true);
      overlay.onclick=e=>{if(e.target===overlay)finish(false)};
      document.body.appendChild(overlay);document.addEventListener('keydown',onKey,true);cancel.focus();
    });
  };
})();
