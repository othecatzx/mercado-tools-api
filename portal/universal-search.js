/* Busca Universal + Assistente ML SH — funciona sem serviços adicionais de busca. */
(function(){
 let opened=false,mode='search',results=[],selected=0,aiConfigured=false,busy=false;
 const sections=[
  ['Visão geral','overview','workspace'],['Vendas e separação','vendas','workspace'],
  ['Analytics de Vendas','sales','workspace'],['Relatório operacional','operational-report','workspace'],
  ['Minhas licenças','licenses','workspace'],['Dispositivos','devices','workspace'],
  ['Frete comprador','shipping','workspace'],['Códigos ML','codes','ferramentas'],
  ['Equipe de atendimento','team','ferramentas'],['Atendimento','chat','ferramentas'],
  ['Entradas de Estoque','bling-entries','bling'],['Integrações Bling','bling-integrations','bling'],
  ['Modelos de Etiquetas','bling-labels','bling'],['Dimensões de Embalagens','bling-dimensions','bling'],
  ['Suporte','support','conta'],['Configurações','settings','conta']
 ];
 const $s=id=>document.getElementById(id);
 const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function allowed(page){
  if(typeof currentUser==='undefined'||!currentUser)return false;
  const nav=document.querySelector('.sidebar .nav-item[data-page="'+page+'"]');
  return !!nav&&!nav.classList.contains('hidden');
 }
 function getResults(term){
  const q=norm(term.trim()),list=[];
  for(const [label,page,group] of sections)if(allowed(page)&&(!q||norm(label+' '+group).includes(q)))list.push({label,detail:'Página · '+group,page});
  if(!q)return list.slice(0,12);
  const orders=[...(typeof salesData!=='undefined'&&Array.isArray(salesData?.orders)?salesData.orders:[]),
   ...(typeof overviewOrdersData!=='undefined'&&Array.isArray(overviewOrdersData?.orders)?overviewOrdersData.orders:[])];
  const seen=new Set();
  if(allowed('vendas'))for(const o of orders){
   if(seen.has(String(o.id)))continue;seen.add(String(o.id));
   const items=Array.isArray(o.products)?o.products:[];
   const match=norm([o.id,o.company_name,...items.flatMap(p=>[p.sku,p.title])].join(' ')).includes(q);
   if(match)list.push({label:'Pedido #'+o.id,detail:(o.company_name||'Loja')+' · '+(o.status_label||'Pedido'),page:'vendas'});
   if(list.length>=30)break;
  }
  if(allowed('sales')){
   for(const item of (salesData?.products||[])){
    if(norm([item.title,item.sku,item.company_name,item.item_id].join(' ')).includes(q))
     list.push({label:item.title||item.sku||'Anúncio',detail:'Produto · '+(item.company_name||'Loja')+' · '+(item.sku||'Sem SKU'),page:'sales'});
    if(list.length>=40)break;
   }
  }
  return list.slice(0,30);
 }
 function ensure(){
  let root=$s('mlshCommandRoot');if(root)return root;
  root=document.createElement('div');root.id='mlshCommandRoot';root.className='mlsh-command-backdrop';root.hidden=true;
  root.innerHTML='<div class="mlsh-command-box" role="dialog" aria-modal="true" aria-label="Busca universal e Assistente ML SH">'+
   '<div class="mlsh-command-header"><div><b>Buscar no ML SH</b><small>Ctrl + K · Esc para fechar</small></div><button type="button" id="mlshCommandClose" aria-label="Fechar">✕</button></div>'+
   '<div class="mlsh-command-tabs"><button type="button" data-mlsh-tab="search">⌕ Busca universal</button><button type="button" data-mlsh-tab="ai">✦ Assistente IA</button></div>'+
   '<div id="mlshCommandSearch"><input id="mlshCommandInput" autocomplete="off" maxlength="120" placeholder="Buscar páginas, pedidos ou SKUs já carregados…"><div id="mlshCommandResults" role="listbox"></div><p class="mlsh-command-hint">Busca instantânea nas informações já carregadas. Para dados novos, abra a página correspondente.</p></div>'+
   '<div id="mlshCommandAi" hidden><div class="mlsh-ai-status" id="mlshAiStatus">Verificando disponibilidade…</div><div id="mlshAiMessages" class="mlsh-ai-messages"><div class="mlsh-ai-msg bot">Olá! Posso explicar recursos do portal e ajudar com orientações. Ainda não consulto números reais de vendas.</div></div><form id="mlshAiForm"><textarea id="mlshAiQuestion" maxlength="500" rows="2" placeholder="Faça uma pergunta sobre o ML SH Support…"></textarea><button class="btn btn-primary" id="mlshAiSend" type="submit">Perguntar ↗</button></form></div>'+
   '</div>';
  document.body.appendChild(root);
  root.addEventListener('click',e=>{if(e.target===root)close();const row=e.target.closest('[data-mlsh-result]');if(row)choose(Number(row.dataset.mlshResult));const tab=e.target.closest('[data-mlsh-tab]');if(tab)setMode(tab.dataset.mlshTab);});
  $s('mlshCommandClose').onclick=close;
  $s('mlshCommandInput').addEventListener('input',update);
  $s('mlshCommandInput').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();selected=Math.min(selected+1,results.length-1);paint();}else if(e.key==='ArrowUp'){e.preventDefault();selected=Math.max(selected-1,0);paint();}else if(e.key==='Enter'){e.preventDefault();choose(selected);}});
  $s('mlshAiForm').onsubmit=e=>{e.preventDefault();ask();};
  return root;
 }
 function paint(){
  const target=$s('mlshCommandResults');if(!target)return;
  target.innerHTML=results.length?results.map((r,i)=>'<button type="button" role="option" aria-selected="'+(i===selected)+'" data-mlsh-result="'+i+'" class="'+(i===selected?'selected':'')+'"><span><b>'+safe(r.label)+'</b><small>'+safe(r.detail)+'</small></span><span>↵</span></button>').join(''):'<div class="mlsh-command-empty">Nenhum resultado entre os dados carregados.</div>';
 }
 function update(){results=getResults($s('mlshCommandInput')?.value||'');selected=0;paint();}
 function choose(index){const r=results[index];if(!r||!allowed(r.page))return;close();navigate(r.page);}
 function setMode(next){
  mode=next==='ai'?'ai':'search';
  document.querySelectorAll('[data-mlsh-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.mlshTab===mode));
  $s('mlshCommandSearch').hidden=mode!=='search';
  $s('mlshCommandAi').hidden=mode!=='ai';
  if(mode==='ai'){refreshAiStatus();$s('mlshAiQuestion').focus();}else{$s('mlshCommandInput').focus();update();}
 }
 async function refreshAiStatus(){
  const el=$s('mlshAiStatus');if(!el)return;
  try{
   const state=await api('/api/portal/ai/status');
   aiConfigured=!!state.enabled;
   if(opened&&$s('mlshAiStatus'))$s('mlshAiStatus').textContent=aiConfigured?'● Cloudflare Workers AI · Somente leitura · Sem dados de vendas em tempo real':'IA não configurada: adicione as credenciais Cloudflare no Render.';
  }catch(err){aiConfigured=false;if(opened&&$s('mlshAiStatus'))$s('mlshAiStatus').textContent='Não foi possível verificar a IA: '+err.message;}
 }
 function appendAi(text,kind){
  const area=$s('mlshAiMessages'),msg=document.createElement('div');msg.className='mlsh-ai-msg '+kind;msg.textContent=text;area.appendChild(msg);area.scrollTop=area.scrollHeight;return msg;
 }
 async function ask(){
  const field=$s('mlshAiQuestion'),send=$s('mlshAiSend');
  if(busy||!field)return;
  const question=field.value.trim();if(question.length<3)return;
  if(!aiConfigured){appendAi('A IA ainda precisa ser ativada no Render. Use a Busca Universal enquanto isso.','bot');return;}
  busy=true;send.disabled=true;field.value='';
  appendAi(question,'user');const msg=appendAi('Consultando a IA…','bot');
  try{
   const answer=await api('/api/portal/ai/ask',{method:'POST',body:JSON.stringify({question})});
   msg.textContent=answer.answer||'Não recebi uma resposta.';
  }catch(err){msg.textContent=err.message||'Não foi possível consultar a IA.';}
  finally{busy=false;send.disabled=false;field.focus();}
 }
 function open(next='search'){
  if(!token||!currentUser||$s('appView')?.classList.contains('hidden'))return;
  const root=ensure();opened=true;root.hidden=false;setMode(next);
 }
 function close(){const root=$s('mlshCommandRoot');if(root)root.hidden=true;opened=false;}
 document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(opened)close();else open('search');}
  else if(e.key==='Escape'&&opened){e.preventDefault();close();}
 });
 window.mlshOpenCommand=open;window.mlshCloseCommand=close;
})();
