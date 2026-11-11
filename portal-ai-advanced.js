'use strict';
/* Intenções determinísticas de Analytics ML SH: nenhum dado de comprador ou token no modelo. */
const basic=require('./portal-ai-metrics');
const n=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const day=s=>Math.floor(Date.parse(s+'T00:00:00Z')/86400000);
const iso=v=>new Date(v*86400000).toISOString().slice(0,10);
const short=s=>s.split('-').reverse().join('/');
const safeDate=(d,m,y)=>{
 const result=new Date(Date.UTC(y,m-1,d));
 return result.getUTCDate()===d&&result.getUTCMonth()===m-1&&result.getUTCFullYear()===y?iso(day(result.toISOString().slice(0,10))):null;
};
function parse(question,context={},now=new Date()){
 const raw=n(question).trim(),today=basic.localDate(now);
 if(basic.isDateQuestion(question))return {type:'date'};
 if(!raw)return null;
 const previous=typeof context?.lastQuestion==='string'?context.lastQuestion.slice(0,300):'';
 const rememberedPeriod=context?.period;
 const validContext=rememberedPeriod&&['begin','end'].every(k=>/^\d{4}-\d{2}-\d{2}$/.test(String(rememberedPeriod[k]||''))&&Number.isFinite(Date.parse(rememberedPeriod[k]+'T00:00:00Z')));
 const p=previous?n(previous):'';
 const follow=/^(e |e ontem|e hoje|e na |e no |e os |e as |qual (a )?diferenca|quanto mudou|e comparado)/.test(raw);
 const prevStore=p.match(/\b(4show|daphie|dmais|ols|recitek)\b/);
 const namedStore=raw.match(/\b(4show|daphie|dmais|ols|recitek)\b/);
 const store=namedStore?namedStore[1]:(follow?(prevStore?.[1]||(['4show','daphie','dmais','ols','recitek'].includes(context?.store)?context.store:null)):null);
 const combined=raw+(store&&!namedStore?' '+store:'');
 const hasMetric=/vend|fatur|pedido|produto|item|ranking|loja|receita|unidade|ticket|grafico|desempenho|tendencia/.test(combined);
 const comparison=/compar|diferenca|variacao|versus| vs |em relacao|quanto mudou/.test(raw);
 const insights=/recomend|sugest|merece|atencao|o que melhorar|analise|insight|destaque/.test(raw);
 const chart=/grafico|evolucao|por dia|diario|dia a dia|visualiz/.test(raw);
 const followsMetric=follow&&/vend|fatur|pedido|produto|loja|receita|grafico/.test(p);
 if(!hasMetric&&!insights&&!followsMetric&&!comparison)return null;
 const dates=[...raw.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)];
 if(dates.length>4)return {error:'Informe no máximo quatro datas (dois períodos).'};
 const year=Number(today.slice(0,4));
 const parsed=dates.map(m=>safeDate(+m[1],+m[2],m[3]?+m[3]:year));
 if(parsed.some(x=>!x))return {error:'Uma data informada é inválida. Use DD/MM/AAAA.'};
 let begin,end,other=null;
 if(comparison&&dates.length===4){
  begin=parsed[0];end=parsed[1];other={begin:parsed[2],end:parsed[3]};
 }else if(comparison&&/\b(hoje|hj)\b/.test(raw)&&/\bontem\b/.test(raw)){
  begin=end=today;other={begin:iso(day(today)-1),end:iso(day(today)-1)};
 }else if(comparison&&/7 dias|semana/.test(raw)&&/anterior|passad/.test(raw)){
  begin=iso(day(today)-6);end=today;other={begin:iso(day(today)-13),end:iso(day(today)-7)};
 }else if(comparison&&dates.length===2){
  begin=end=parsed[0];other={begin:parsed[1],end:parsed[1]};
 }else if(dates.length===1||dates.length===2){
  begin=parsed[0];end=parsed[1]||today;
 }else{
  const periodText=raw+(follow?' '+p:'');
  const customDays=raw.match(/\b(?:ultimos?|ultimas?)\s+(\d{1,2})\s+dias?\b/);
  if(/\bontem\b/.test(raw)){begin=end=iso(day(today)-1);}
  else if(/\bhoje\b|\bhj\b/.test(raw)){begin=end=today;}
  else if(customDays){begin=iso(day(today)-Math.min(89,Math.max(1,Number(customDays[1])))+1);end=today;}
  else if(/\b30 dias\b|\bmes\b|\bmensal\b/.test(raw)){begin=iso(day(today)-29);end=today;}
  else if(follow&&validContext&&/qual a diferenca|quanto mudou/.test(raw)){
   begin=context.period.begin;end=context.period.end;
   const len=day(end)-day(begin)+1;other={begin:iso(day(begin)-len),end:iso(day(begin)-1)};
  }else if(follow&&validContext){
   begin=context.period.begin;end=context.period.end;
  }else {begin=iso(day(today)-6);end=today;}
 }
 if(comparison&&!other){
  const count=day(end)-day(begin)+1;
  other={begin:iso(day(begin)-count),end:iso(day(begin)-1)};
 }
 const range=[{begin,end},...(other?[other]:[])];
 if(range.some(r=>day(r.end)<day(r.begin)))return {error:'A data inicial deve ser anterior à final.'};
 if(range.some(r=>day(r.end)>day(today)))return {error:'Não é possível consultar datas futuras.'};
 const earliest=range.reduce((v,r)=>day(r.begin)<day(v)?r.begin:v,begin);
 const days=day(today)-day(earliest)+2;
 if(days>90)return {error:'O intervalo começa muito longe. Consulte um período dentro dos últimos 89 dias.'};
 let productTerms=[];
 const productMatchers=['notebook','monitor','teclado','mouse','ssd','cooler','carregador','cabo','hd','memoria','placa','fonte','impressora','celular','dell','lenovo','vaio','acer','asus','samsung','hp'];
 for(const word of productMatchers)if(new RegExp('\\b'+word+'s?\\b').test(raw))productTerms.push(word);
 const price=raw.match(/(?:acima de|maior(?:es)? que|mais de|a partir de)\s*(?:r\$\s*)?([\d.,]+)/);
 const minPrice=price?Number(price[1].replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.')):null;
 return {
  begin,end,other,days,store,
  chart,insights,comparison:!!other,
  products:/produto|item|sku|mais vend|ranking/.test(raw)||productTerms.length>0,
  productTerms, minPrice:Number.isFinite(minPrice)?minPrice:null,
  label:short(begin)+' a '+short(end),q:combined,
  context:{lastQuestion:(followsMetric?previous:question).slice(0,300),period:{begin,end},store:store||null}
 };
}
function analyze(payload,intent){
 const stores=Array.isArray(payload.stores)?payload.stores:[];
 const names=new Map(stores.map(s=>[String(s.company_id),String(s.company_name||'Loja')]));
 const target=intent.store?stores.find(s=>n(s.company_name).includes(intent.store)):null;
 if(intent.store&&!target)return {answer:'A loja '+intent.store+' não está vinculada às suas licenças autorizadas.',real_time_data:false};
 const failures=stores.filter(s=>!s.connected&&(!target||String(s.company_id)===String(target.company_id)));
 const source=Array.isArray(payload.orders)?payload.orders:[];
 const orders=source.filter(o=>!target||String(o.company_id)===String(target.company_id));
 const validOrders=orders.filter(o=>!['cancelled','canceled'].includes(String(o.status||'').toLowerCase()));
 const money=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const percent=v=>(v>0?'+':'')+v.toFixed(1).replace('.',',')+'%';
 const hasFilter=intent.productTerms.length>0||intent.minPrice!==null;
 const matches=it=>{
  const title=n(it.title||'')+' '+n(it.sku||'');
  return intent.productTerms.every(w=>new RegExp('\\b'+w+'\\b').test(title)) &&
   (intent.minPrice===null||Number(it.unit_price||0)>=intent.minPrice);
 };
 function period(begin,end){
  const selected=validOrders.filter(o=>o.date_created&&basic.localDate(o.date_created)>=begin&&basic.localDate(o.date_created)<=end);
  const lines=selected.flatMap(o=>(o.products||[]).filter(matches).map(it=>({
   item_id:String(it.item_id||''),title:String(it.title||'Produto').slice(0,100),
   sku:String(it.sku||''),quantity:Number(it.quantity||0),unit_price:Number(it.unit_price||0),
   date:basic.localDate(o.date_created),company_name:String(o.company_name||'Loja')
  })));
  const filteredOrders=hasFilter?selected.filter(o=>(o.products||[]).some(matches)):selected;
  const value=hasFilter?lines.reduce((s,it)=>s+it.quantity*it.unit_price,0):filteredOrders.reduce((s,o)=>s+Number(o.total_amount||0),0);
  const units=lines.reduce((s,it)=>s+it.quantity,0);
  const daily=new Map();
  for(let d=day(begin);d<=day(end);d++)daily.set(iso(d),0);
  if(hasFilter)for(const line of lines)daily.set(line.date,(daily.get(line.date)||0)+line.quantity*line.unit_price);
  else for(const order of filteredOrders){
   const date=basic.localDate(order.date_created);
   daily.set(date,(daily.get(date)||0)+Number(order.total_amount||0));
  }
  return {orders:filteredOrders,lines,value,units,daily};
 }
 const cur=period(intent.begin,intent.end);
 const lines=['Consulta Mercado Livre · '+intent.label+(target?' · '+target.company_name:' · lojas autorizadas'),'',
  hasFilter?'Pedidos com itens correspondentes: '+cur.orders.length:'Pedidos não cancelados: '+cur.orders.length,
  (hasFilter?'Valor estimado dos itens filtrados: ':'Valor dos pedidos: ')+money(cur.value),
  'Unidades: '+cur.units];
 if(hasFilter){
  lines.push('Filtro: '+(intent.productTerms.join(' + ')||'todos os produtos')+
   (intent.minPrice!==null?', preço unitário a partir de '+money(intent.minPrice):''));
  if(cur.lines.some(it=>!it.unit_price))lines.push('Atenção: alguns itens não têm preço unitário na consulta; valor de itens pode estar subestimado.');
 }
 let comparison=null;
 if(intent.other){
  const prev=period(intent.other.begin,intent.other.end);
  const change=prev.value?((cur.value-prev.value)/prev.value*100):null;
  lines.push('', 'Comparação com '+short(intent.other.begin)+' a '+short(intent.other.end)+':',
   'Período anterior: '+money(prev.value)+' · '+prev.orders.length+' pedidos',
   'Diferença: '+money(cur.value-prev.value)+(change===null?' (percentual indisponível: base zero)':' ('+percent(change)+')'));
  comparison={revenue:cur.value,previous:prev.value,change_percent:change,orders:cur.orders.length,previous_orders:prev.orders.length};
 }
 if(intent.products){
  const top=new Map();
  for(const it of cur.lines){
   const key=it.item_id||it.sku||it.title,row=top.get(key)||{title:it.title,units:0};
   row.units+=it.quantity;top.set(key,row);
  }
  lines.push('','Produtos mais vendidos por unidade:');
  const ranked=[...top.values()].sort((a,b)=>b.units-a.units).slice(0,10);
  if(!ranked.length)lines.push('Nenhum produto encontrado para o filtro.');
  else ranked.forEach((it,i)=>lines.push((i+1)+'. '+it.title+' — '+it.units+' un.'));
 }
 if(/lojas?|compar/.test(intent.q)&&!target){
  const grouped=new Map();
  for(const o of cur.orders){
   const key=names.get(String(o.company_id))||String(o.company_name||'Loja');
   const r=grouped.get(key)||{orders:0,revenue:0};r.orders++;
   r.revenue+=Number(o.total_amount||0);grouped.set(key,r);
  }
  lines.push('','Por loja:');
  for(const [name,v] of [...grouped].sort((a,b)=>b[1].revenue-a[1].revenue))lines.push(name+': '+v.orders+' pedidos · '+money(v.revenue));
 }
 const recommendations=[];
 if(intent.insights){
  if(failures.length)recommendations.push('Priorize a reconexão das lojas indisponíveis antes de tomar decisões sobre o total.');
  if(comparison&&comparison.change_percent!==null){
   recommendations.push('O valor de pedidos '+(comparison.change_percent<0?'caiu':'subiu')+' '+Math.abs(comparison.change_percent).toFixed(1).replace('.',',')+
    '% em relação ao intervalo comparado. Verifique mix de produtos e volume de pedidos; a variação não revela a causa.');
  }else{
   const daily=[...cur.daily.values()];
   if(daily.length>=4){
    const half=Math.floor(daily.length/2);
    const first=daily.slice(0,half).reduce((a,b)=>a+b,0)/half;
    const last=daily.slice(half).reduce((a,b)=>a+b,0)/(daily.length-half);
    if(first>0&&Math.abs(last/first-1)>=.2)recommendations.push('A média diária na segunda metade do período está '+(last>first?'acima':'abaixo')+' da primeira metade; confira se houve mudança de volume ou preços.');
   }
   if(cur.orders.length)recommendations.push('Use uma comparação com o período anterior para distinguir oscilação pontual de tendência.');
  }
  if(cur.orders.length>0&&cur.lines.length>0){
   const top=cur.lines.reduce((m,v)=>{m.set(v.item_id,(m.get(v.item_id)||0)+v.quantity);return m;},new Map());
   const total=cur.units,maximum=Math.max(...top.values());
   if(total&&maximum/total>.4)recommendations.push('Um único anúncio concentra mais de 40% das unidades deste recorte; confira a dependência desse produto.');
  }
  lines.push('','Pontos de atenção baseados nos dados:');
  (recommendations.length?recommendations:['Não encontrei uma variação suficiente neste recorte para recomendar uma ação específica.']).forEach((x,i)=>lines.push((i+1)+'. '+x));
  lines.push('São hipóteses para análise, não causas comprovadas.');
 }
 if(failures.length){
  lines.push('','ATENÇÃO — DADOS PARCIAIS. Falharam '+failures.length+' loja(s):');
  failures.forEach(x=>lines.push('• '+String(x.company_name||'Loja')+': '+String(x.error||'indisponível').slice(0,120)));
  lines.push('Os valores NÃO são o total de todas as lojas.');
 }
 lines.push('','Fonte: pedidos do Mercado Livre consultados agora, data de criação em São Paulo. Status de cancelamento atual.');
 const daily=[...cur.daily].map(([date,value])=>({date,value:Number(value.toFixed(2))}));
 const chart=intent.chart?{title:'Valor de pedidos por dia',unit:'BRL',points:daily.slice(-30)}:null;
 return {answer:lines.join('\n'),real_time_data:true,chart,comparison,context:intent.context};
}
module.exports={parse,analyze};
