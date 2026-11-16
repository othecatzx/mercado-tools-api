from pathlib import Path
import shutil
p=Path(__file__).parent/'bling-multi.routes.js'
s=p.read_text(encoding='utf-8')
shutil.copy2(p,str(p)+'.before-cooldown.bak')
def swap(a,b):
 global s
 assert a in s, 'missing '+a[:70]
 s=s.replace(a,b,1)
swap("""  const blingQueues=new Map(), refreshFlights=new Map();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));""","""  const blingQueues=new Map(), refreshFlights=new Map(), cooldowns=new Map(), enrichFlights=new Map();
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const limitedError=(remaining,key)=>{
    const err=new Error('Bling temporariamente limitado. Aguarde '+Math.ceil(remaining/1000)+' segundos antes de tentar novamente.');
    err.response={status:429,headers:{'retry-after':String(Math.ceil(remaining/1000))}};
    err.blingCooldown=true;
    return err;
  };
  function checkCooldown(key){
    const until=cooldowns.get(key)||0;
    if(Date.now()<until)throw limitedError(until-Date.now(),key);
    if(until)cooldowns.delete(key);
  }
  function setCooldown(key,error,minMs){
    const header=error.response?.headers?.['retry-after'];
    const numeric=Number(header);
    const date=header&&!Number.isFinite(numeric)?Date.parse(header):NaN;
    const retryMs=Number.isFinite(numeric)&&numeric>=0?numeric*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):0;
    const duration=Math.min(3600000,Math.max(minMs,retryMs));
    cooldowns.set(key,Math.max(cooldowns.get(key)||0,Date.now()+duration));
    console.warn('Bling cooldown ativado',{scope:key,seconds:Math.ceil(duration/1000)});
  }""")
start=s.index('  function queueBling(key,operation){')
end=s.index('  async function refresh(c){',start)
s=s[:start]+"""  // Serializa e espaca chamadas de TODAS as contas neste processo; evita rajadas
  // entre diferentes contas e operacoes de OAuth no mesmo IP do Render.
  let nextBlingRequestAt=0;
  function queueBling(key,operation){
    const previous=blingQueues.get('global')||Promise.resolve();
    const running=previous.catch(()=>{}).then(async()=>{
      checkCooldown(key);
      const delay=Math.max(0,nextBlingRequestAt-Date.now());
      nextBlingRequestAt=Math.max(nextBlingRequestAt,Date.now())+750;
      if(delay)await sleep(delay);
      checkCooldown(key);
      return operation();
    });
    const tail=running.catch(()=>{});
    blingQueues.set('global',tail);
    void tail.then(()=>{if(blingQueues.get('global')===tail)blingQueues.delete('global');});
    return running;
  }
  async function blingRetry(operation,label,{attempts=2,cooldownKey='api'}={}){
    checkCooldown(cooldownKey);
    for(let i=0;i<attempts;i++){
      try{return await operation();}
      catch(error){
        if(error.blingCooldown)throw error;
        if(error.response?.status!==429)throw error;
        // Evita insistir no IP enquanto o provedor recusa as requisicoes.
        setCooldown(cooldownKey,error,cooldownKey==='oauth'?60*60*1000:60*1000);
        console.warn('Bling 429',{operation:label,attempt:i+1});
        throw error;
      }
    }
  }
  // Nunca repetir automaticamente o mesmo authorization_code: e de uso unico
  // e expira rapidamente. A proxima tentativa exige uma nova autorizacao.
  const tokenRequest=async params=>blingRetry(()=>queueBling('oauth',async()=>{
    const r=await axios.post(BASE+'/oauth/token',new URLSearchParams(params).toString(),{headers:{Authorization:'Basic '+Buffer.from(clientId()+':'+secret()).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded','Accept':'1.0'},timeout:10000});
    return r.data;
  }), 'oauth/token',{attempts:1,cooldownKey:'oauth'});
""" +s[end:]
swap("""  const blingGet=async(c,path)=>blingRetry(()=>queueBling('connection:'+c.id,async()=>{
    const token=await refresh(c);
    return (await axios.get(BASE+path,{headers:{Authorization:'Bearer '+token},timeout:15000})).data?.data;
  }), 'GET '+path,{attempts:3});""","""  const blingGet=async(c,path)=>blingRetry(()=>queueBling('api',async()=>{
    const token=await refresh(c);
    return (await axios.get(BASE+path,{headers:{Authorization:'Bearer '+token},timeout:15000})).data?.data;
  }), 'GET '+path,{attempts:1,cooldownKey:'api'});""")
# fail fast on connect while OAuth is cooling down
swap("""app.post('/api/portal/bling/connect',auth,safe(async(req,res)=>{if(!clientId()||!secret())""","""app.post('/api/portal/bling/connect',auth,safe(async(req,res)=>{try{checkCooldown('oauth')}catch(e){return res.status(429).json({message:e.message})}if(!clientId()||!secret())""")
# callback checks cooldown before consuming authorization code
swap("""    let t;
    try{t=await tokenRequest({grant_type:'authorization_code',code:String(req.query.code)});}""","""    let t;
    try{checkCooldown('oauth');t=await tokenRequest({grant_type:'authorization_code',code:String(req.query.code)});}""")
swap("""return res.status(429).send('O Bling limitou temporariamente as solicitações (429). Aguarde alguns minutos e inicie uma nova reconexão no portal. A conexão anterior não foi removida.');""","""return res.status(429).send('O Bling limitou a autenticação (429). O sistema interrompeu as novas tentativas por até 60 minutos para proteger a integração. A conexão anterior foi preservada.');""")
# stop same-connection concurrent enrichment and fast fail while rate limited
swap("""  app.post('/api/portal/bling/entries/enrich',auth,safe(async(req,res)=>{
    const id=String(req.body?.connection_id||'');
    const c=await conn(req.owner,id);""","""  app.post('/api/portal/bling/entries/enrich',auth,safe(async(req,res)=>{
    const id=String(req.body?.connection_id||'');
    if(!id)return res.status(400).json({message:'Informe a conexão Bling.'});
    try{checkCooldown('api');checkCooldown('oauth')}catch(e){return res.status(429).json({message:e.message})}
    const flightKey=req.owner+':'+id;
    if(enrichFlights.has(flightKey))return res.status(409).json({message:'A sincronização desta conta já está em andamento.'});
    enrichFlights.set(flightKey,true);
    try{
    const c=await conn(req.owner,id);""")
swap("""    res.json({enriched,missingSku,attempted:rows.length,uniqueProducts:groups.size,failures:failures.slice(0,5)});
  }));""","""    res.json({enriched,missingSku,attempted:rows.length,uniqueProducts:groups.size,failures:failures.slice(0,5)});
    }finally{enrichFlights.delete(flightKey);}
  }));""")
# cleanup unnecessary retryWait dead code
a=s.index('  function retryWait(error,attempt){')
b=s.index('  // Serializa e espaca chamadas',a)
s=s[:a]+s[b:]
p.write_text(s,encoding='utf8')
print('cooldown changes applied')
