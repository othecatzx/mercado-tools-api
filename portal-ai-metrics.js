'use strict';
// Query parsing and private analytics aggregation; no buyer data leaves the server.
const TZ='America/Sao_Paulo';
const localDate = value => {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const obj=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 return obj.year+'-'+obj.month+'-'+obj.day;
};
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const dayNumber=ymd=>Math.floor(Date.parse(ymd+'T00:00:00Z')/86400000);
const toDate=n=>new Date(n*86400000).toISOString().slice(0,10);
function validDate(day,month,year){
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day
 ?[year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-'):null;
}
function isDateQuestion(question){
 const q=norm(question).trim();
 return /^(qual|que|q)\s+(dia|data)\s+(e|eh|estamos|hoje)|^hoje\s+(e|eh)\s+que\s+dia|^data\s+de\s+hoje/.test(q);
}
function answerDate(now=new Date()){
 return 'Hoje é '+new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now)+' (horário de Brasília).';
}
function parseSalesIntent(question,now=new Date()){
 const q=norm(question),today=localDate(now);
 if(!/vend|fatur|pedido|produto|item|ranking|loja|receita|unidade/.test(q)||
    !/quanto|quantos|quantas|quais|qual |mais vend|total|mostr|list|ranking|compar|resum|hoje|hj|ontem|ultim|semana|mes|de \d/.test(q))return null;
 const matches=[...q.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)];
 if(matches.length>2)return {error:'Informe no máximo duas datas por consulta.'};
 let begin,end;
 if(matches.length){
  const yr=Number(today.slice(0,4));
  const parse=m=>validDate(Number(m[1]),Number(m[2]),m[3]?Number(m[3]):yr);
  begin=parse(matches[0]);end=matches.length===2?parse(matches[1]):today;
  if(!begin||!end)return {error:'Data inválida. Use o formato DD/MM/AAAA.'};
 }else if(/\bontem\b/.test(q)){
  begin=end=toDate(dayNumber(today)-1);
 }else if(/\bhoje\b|\bhj\b/.test(q)){
  begin=end=today;
 }else{
  const n=/\b30 dias\b|\bmes\b|\bmensal\b/.test(q)?30:7;
  begin=toDate(dayNumber(today)-n+1);end=today;
 }
 const diff=dayNumber(end)-dayNumber(begin)+1;
 if(diff<1)return {error:'A data inicial deve ser anterior ou igual à data final.'};
 if(dayNumber(end)>dayNumber(today))return {error:'Não é possível consultar vendas de datas futuras.'};
 const days=dayNumber(today)-dayNumber(begin)+2;
 if(days>90)return {error:'Nesta versão, o período não pode começar há mais de 88 dias.'};
 return {begin,end,days,label:begin.split('-').reverse().join('/')+' a '+end.split('-').reverse().join('/'),
  wantsProducts:/produto|item|sku|mais vend|ranking/.test(q),q};
}
function summarize(payload,intent){
 const companies=Array.isArray(payload.stores)?payload.stores:[];
 const failures=companies.filter(x=>!x.connected);
 const allOrders=Array.isArray(payload.orders)?payload.orders:[];
 const words=intent.q.split(/[^a-z0-9]+/);
 const company=companies.find(x=>{
  const name=norm(x.company_name),first=name.split(/\s+/)[0];
  return (first.length>=3&&words.includes(first))||(name.length>=4&&intent.q.includes(name));
 });
 const matched=company?allOrders.filter(o=>String(o.company_id)===String(company.company_id)):allOrders;
 const filtered=matched.filter(o=>{
  if(!o.date_created)return false;
  const date=localDate(o.date_created);
  return date>=intent.begin&&date<=intent.end;
 });
 const valid=filtered.filter(o=>!['cancelled','canceled'].includes(String(o.status||'').toLowerCase()));
 const money=n=>n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const sum=(arr,key)=>arr.reduce((n,o)=>n+Number(o[key]||0),0);
 const label=company?String(company.company_name):'todas as lojas autorizadas';
 const lines=['Consulta de pedidos do Mercado Livre · '+intent.label+' · '+label,'',
  'Pedidos não cancelados: '+valid.length,'Valor desses pedidos: '+money(sum(valid,'total_amount')),
  'Unidades: '+sum(valid,'units'),'Pedidos atualmente cancelados: '+(filtered.length-valid.length)];
 if(!company&&/lojas?|compar/.test(intent.q)){
  const breakdown=new Map();
  for(const order of valid){
   const name=String(order.company_name||'Loja'),row=breakdown.get(name)||{count:0,revenue:0};
   row.count++;row.revenue+=Number(order.total_amount||0);breakdown.set(name,row);
  }
  lines.push('','Resultado por loja:');
  for(const [name,row] of [...breakdown.entries()].sort((a,b)=>b[1].revenue-a[1].revenue))
   lines.push(name+': '+row.count+' pedidos · '+money(row.revenue));
 }
 if(intent.wantsProducts){
  const products=new Map();
  for(const order of valid)for(const item of order.products||[]){
   const key=String(item.item_id||item.sku||item.title||'').trim();
   if(!key)continue;
   const row=products.get(key)||{title:String(item.title||item.sku||'Produto').slice(0,90),units:0};
   row.units+=Math.max(0,Number(item.quantity||0));products.set(key,row);
  }
  lines.push('','Produtos mais vendidos (por unidades):');
  const top=[...products.values()].sort((a,b)=>b.units-a.units).slice(0,10);
  top.forEach((item,i)=>lines.push((i+1)+'. '+item.title+' — '+item.units+' un.'));
  if(!top.length)lines.push('Nenhum produto no período.');
 }
 if(failures.length){
  lines.push('','ATENÇÃO — resultado parcial: '+failures.length+' conta(s) não consultada(s):');
  for(const store of failures)lines.push('• '+String(store.company_name||'Loja')+': '+String(store.error||'conexão indisponível').slice(0,140));
  lines.push('O valor acima NÃO representa o total de todas as lojas.');
 }
 lines.push('','Base: data de criação do pedido em São Paulo. Cancelamentos consideram o status atual.');
 return {answer:lines.join('\n'),available:true};
}
module.exports={localDate,isDateQuestion,answerDate,parseSalesIntent,summarize};
