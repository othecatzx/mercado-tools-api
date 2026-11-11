/* Extensões do Assistente: contexto de sessão, favoritos locais por usuário e gráfico SVG. */
(function(){
 let user='',context=null,lastQuestion='';
 const $=id=>document.getElementById(id);
 function scope(){const x=typeof currentUser==='undefined'?null:currentUser;return x?String(x.id||x.email||x.portal_user_id||''):'';}
 function refreshScope(){
  const key=scope();
  if(!key||key===user)return;
  user=key;context=null;lastQuestion='';
  try{const found=JSON.parse(sessionStorage.getItem('mlsh_ai_context_'+user)||'null');if(found&&typeof found==='object')context=found;}catch(_){}
  const messages=$('mlshAiMessages');
  if(messages)messages.innerHTML='<div class="mlsh-ai-msg bot">Olá! Pergunte sobre vendas, gráficos, comparações e produtos. As consultas respeitam suas permissões.</div>';
  listFavorites();
 }
 function favorites(){
  if(!user)return[];
  try{const f=JSON.parse(localStorage.getItem('mlsh_ai_favorites_'+user)||'[]');return Array.isArray(f)?f.filter(x=>typeof x==='string').slice(0,12):[];}catch(_){return[];}
 }
 function save(list){if(user)try{localStorage.setItem('mlsh_ai_favorites_'+user,JSON.stringify(list.slice(0,12)));}catch(_){}}
 function listFavorites(){
  const target=$('mlshAiFavorites');if(!target)return;
  target.replaceChildren();const items=favorites();
  if(!items.length){target.textContent='Nenhuma pergunta favorita salva.';return;}
  items.forEach((question,index)=>{
   const row=document.createElement('div');row.className='mlsh-ai-favorite';
   const btn=document.createElement('button');btn.type='button';btn.textContent=question;
   btn.addEventListener('click',()=>{$('mlshAiQuestion').value=question;$('mlshAiQuestion').focus();});
   const remove=document.createElement('button');remove.type='button';remove.textContent='✕';remove.title='Remover favorito';
   remove.addEventListener('click',()=>{const next=favorites();next.splice(index,1);save(next);listFavorites();});
   row.append(btn,remove);target.append(row);
  });
 }
 function ensure(){
  const pane=$('mlshCommandAi');
  if(!pane||$('mlshAiFavoriteSave'))return;
  const tools=document.createElement('div');tools.className='mlsh-ai-tools';
  const add=document.createElement('button');add.id='mlshAiFavoriteSave';add.type='button';add.textContent='☆ Salvar pergunta';
  const toggle=document.createElement('button');toggle.id='mlshAiFavoriteToggle';toggle.type='button';toggle.textContent='★ Favoritas';
  tools.append(add,toggle);
  const list=document.createElement('div');list.id='mlshAiFavorites';list.hidden=true;
  const messages=$('mlshAiMessages');pane.insertBefore(tools,messages);pane.insertBefore(list,messages);
  add.addEventListener('click',()=>{
   refreshScope();const question=($('mlshAiQuestion').value||lastQuestion||'').trim();if(question.length<3)return;
   const f=favorites();if(!f.includes(question)){f.unshift(question);save(f);}
   list.hidden=false;listFavorites();
  });
  toggle.addEventListener('click',()=>{refreshScope();list.hidden=!list.hidden;listFavorites();});
  refreshScope();
 }
 function chart(data){
  if(!data||!Array.isArray(data.points))return null;
  const pts=data.points.slice(-30).filter(p=>Number.isFinite(Number(p.value)));if(!pts.length)return null;
  const wrap=document.createElement('div');wrap.className='mlsh-ai-chart';
  const title=document.createElement('b');title.textContent=data.title||'Evolução diária';wrap.append(title);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 520 190');svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Evolução diária de vendas, com valores acessíveis nas barras');
  const max=Math.max(1,...pts.map(p=>Number(p.value))),step=490/pts.length;
  pts.forEach((p,i)=>{
   const h=Number(p.value)/max*130,r=document.createElementNS('http://www.w3.org/2000/svg','rect');
   r.setAttribute('x',String(16+i*step));r.setAttribute('y',String(155-h));
   r.setAttribute('width',String(Math.max(2,step-3)));r.setAttribute('height',String(Math.max(1,h)));
   r.setAttribute('rx','3');r.setAttribute('fill','#7468f5');
   const tip=document.createElementNS('http://www.w3.org/2000/svg','title');
   tip.textContent=p.date+': '+Number(p.value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
   r.append(tip);svg.append(r);
  });
  wrap.append(svg);
  const note=document.createElement('small');
  note.textContent='Período: '+pts[0].date+' a '+pts[pts.length-1].date+' · Passe o mouse nas barras para ver valores.';
  wrap.append(note);return wrap;
 }
 window.mlshAIExtras={
  init(){ensure();refreshScope();},
  prepare(question){ensure();refreshScope();lastQuestion=question;return context;},
  received(result,message){
   if(result?.context&&result.real_time_data){context=result.context;try{sessionStorage.setItem('mlsh_ai_context_'+user,JSON.stringify(context));}catch(_){}}
   const plot=chart(result?.chart);if(plot&&message)message.append(plot);
  },
  reset(){user='';context=null;lastQuestion='';}
 };
})();
