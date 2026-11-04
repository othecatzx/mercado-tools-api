'use strict';
// Integração aditiva: não altera os fluxos existentes da extensão.
const crypto = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const BASE = 'https://api.bling.com.br/Api/v3';
const AUTHORIZE = 'https://www.bling.com.br/Api/v3/oauth/authorize';
const safe = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
module.exports = function registerBlingMulti(app,{supabase,jwt}) {
  const clientId=()=>process.env.BLING_CLIENT_ID;
  const secret=()=>process.env.BLING_CLIENT_SECRET;
  const key=()=>{const hex=process.env.BLING_TOKEN_ENCRYPTION_KEY||''; if(!/^[0-9a-f]{64}$/i.test(hex))throw Error('BLING_TOKEN_ENCRYPTION_KEY precisa ter 64 caracteres hexadecimais'); return Buffer.from(hex,'hex');};
  const encrypt=s=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);const enc=Buffer.concat([cipher.update(s,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),enc].map(b=>b.toString('base64url')).join('.');};
  const decrypt=s=>{const [i,t,d]=s.split('.').map(v=>Buffer.from(v,'base64url'));const c=crypto.createDecipheriv('aes-256-gcm',key(),i);c.setAuthTag(t);return Buffer.concat([c.update(d),c.final()]).toString();};
  function auth(req,res,next){try{const decoded=jwt.verify((req.headers.authorization||'').replace(/^Bearer /,''),process.env.JWT_SECRET);if(decoded.type!=='portal'||!decoded.portal_user_id)return res.status(403).json({message:'Somente o titular do portal pode gerenciar Bling'});req.owner=decoded.portal_user_id;next();}catch{return res.status(401).json({message:'Sessão inválida'});}}
  async function db(q){const {data,error}=await q;if(error)throw error;return data;}
  const list=owner=>db(supabase.from('bling_connections').select('id,name,company_id,webhook_company_id,status,last_sync_at,created_at,expires_at').eq('portal_user_id',owner).order('created_at',{ascending:true}));
  async function conn(owner,id){const c=await db(supabase.from('bling_connections').select('*').eq('portal_user_id',owner).eq('id',id).maybeSingle());if(!c)throw Error('Conexão não encontrada');return c;}
  const tokenRequest=async params=>{const r=await axios.post(BASE+'/oauth/token',new URLSearchParams(params).toString(),{headers:{Authorization:'Basic '+Buffer.from(clientId()+':'+secret()).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded','Accept':'1.0'},timeout:10000});return r.data;};
  async function refresh(c){if(new Date(c.expires_at).getTime()>Date.now()+90000)return decrypt(c.access_token_enc);const t=await tokenRequest({grant_type:'refresh_token',refresh_token:decrypt(c.refresh_token_enc)});const update={access_token_enc:encrypt(t.access_token),refresh_token_enc:encrypt(t.refresh_token),expires_at:new Date(Date.now()+(t.expires_in||21600)*1000).toISOString(),status:'connected'};await db(supabase.from('bling_connections').update(update).eq('id',c.id).eq('refresh_token_enc',c.refresh_token_enc));const latest=await db(supabase.from('bling_connections').select('*').eq('id',c.id).single());return decrypt(latest.access_token_enc);}
  const blingGet=async(c,path)=>{const token=await refresh(c);return (await axios.get(BASE+path,{headers:{Authorization:'Bearer '+token},timeout:15000})).data?.data;};
  app.get('/api/portal/bling/connections',auth,safe(async(req,res)=>res.json({connections:await list(req.owner)})));
  app.post('/api/portal/bling/connect',auth,safe(async(req,res)=>{if(!clientId()||!secret())return res.status(503).json({message:'OAuth Bling não configurado no servidor'});const id=req.body?.id||null;if(id)await conn(req.owner,id);const state=crypto.randomBytes(24).toString('hex');await db(supabase.from('bling_oauth_states').insert({state_hash:crypto.createHash('sha256').update(state).digest('hex'),portal_user_id:req.owner,connection_id:id,expires_at:new Date(Date.now()+5*60*1000).toISOString()}));res.json({url:AUTHORIZE+'?'+new URLSearchParams({response_type:'code',client_id:clientId(),state})});}));
  app.get('/api/portal/bling/callback',safe(async(req,res)=>{const hash=crypto.createHash('sha256').update(String(req.query.state||'')).digest('hex');const st=await db(supabase.from('bling_oauth_states').delete().eq('state_hash',hash).select('*').maybeSingle());if(!st||new Date(st.expires_at)<new Date()||!req.query.code)return res.status(400).send('Autorização inválida ou expirada.');const t=await tokenRequest({grant_type:'authorization_code',code:String(req.query.code)});// A conexão é identificada por UUID local, sem consultar dados cadastrais da empresa.
    // O vínculo companyId para webhooks pode ser definido posteriormente pelo administrador.
    const payload={portal_user_id:st.portal_user_id,access_token_enc:encrypt(t.access_token),refresh_token_enc:encrypt(t.refresh_token),expires_at:new Date(Date.now()+(t.expires_in||21600)*1000).toISOString(),status:'connected'};
    if(st.connection_id){
      const old=await conn(st.portal_user_id,st.connection_id);
      await db(supabase.from('bling_connections').update(payload).eq('id',old.id));
    }else{
      await db(supabase.from('bling_connections').insert({...payload,company_id:null,name:'Nova conexão Bling'}));
    }res.redirect('/portal/?bling=connected');}));
  app.patch('/api/portal/bling/connections/:id',auth,safe(async(req,res)=>{await conn(req.owner,req.params.id);const name=String(req.body.name||'').trim();if(!name||name.length>100)return res.status(400).json({message:'Nome inválido'});const webhook_company_id=req.body.webhook_company_id===undefined?undefined:String(req.body.webhook_company_id||'').trim()||null;if(webhook_company_id&& !/^[a-z0-9-]{1,128}$/i.test(webhook_company_id))return res.status(400).json({message:'ID de webhook inválido'});await db(supabase.from('bling_connections').update({name,...(webhook_company_id!==undefined?{webhook_company_id}:{})}).eq('id',req.params.id));res.json({ok:true});}));
  app.delete('/api/portal/bling/connections/:id',auth,safe(async(req,res)=>{await conn(req.owner,req.params.id);await db(supabase.from('bling_connections').update({status:'disconnected',access_token_enc:null,refresh_token_enc:null}).eq('id',req.params.id));res.json({ok:true});}));
  app.get('/api/portal/bling/entries',auth,safe(async(req,res)=>{let q=supabase.from('bling_stock_entries').select('id,bling_connection_id,sku,product_name,image_url,quantity,occurred_at,bling_connections!inner(name,portal_user_id)').eq('bling_connections.portal_user_id',req.owner).order('occurred_at',{ascending:false}).limit(40);if(req.query.connection_id){await conn(req.owner,req.query.connection_id);q=q.eq('bling_connection_id',req.query.connection_id);}if(req.query.search){const s=String(req.query.search).slice(0,100).replace(/[%_,()]/g,'');q=q.or('sku.ilike.%'+s+'%,product_name.ilike.%'+s+'%');}res.json({entries:await db(q)});}));
  app.get('/api/portal/bling/templates',auth,safe(async(req,res)=>res.json({templates:await db(supabase.from('bling_label_templates').select('*').eq('portal_user_id',req.owner).order('created_at'))})));
  function validateTemplate(b){const w=Number(b.width_mm),h=Number(b.height_mm);if(!(w>=15&&w<=300&&h>=15&&h<=300)||!Array.isArray(b.elements)||b.elements.length>40)throw Error('Dimensões ou elementos inválidos');for(const e of b.elements){if(!['text','sku','name','quantity','date','time','qr','logo'].includes(e.type)||![e.x,e.y,e.w,e.h].every(v=>Number.isFinite(Number(v))&&Number(v)>=0)||e.x+e.w>w||e.y+e.h>h)throw Error('Elemento fora dos limites');}return {name:String(b.name||'Modelo').slice(0,100),width_mm:w,height_mm:h,elements:b.elements,is_default:!!b.is_default};}
  app.post('/api/portal/bling/templates',auth,safe(async(req,res)=>{const t=validateTemplate(req.body);if(t.is_default)await db(supabase.from('bling_label_templates').update({is_default:false}).eq('portal_user_id',req.owner));const r=await db(supabase.from('bling_label_templates').insert({...t,portal_user_id:req.owner}).select('*').single());res.json({template:r});}));
  app.put('/api/portal/bling/templates/:id',auth,safe(async(req,res)=>{const old=await db(supabase.from('bling_label_templates').select('id').eq('portal_user_id',req.owner).eq('id',req.params.id).maybeSingle());if(!old)return res.status(404).json({message:'Modelo não encontrado'});const t=validateTemplate(req.body);if(t.is_default)await db(supabase.from('bling_label_templates').update({is_default:false}).eq('portal_user_id',req.owner));res.json({template:await db(supabase.from('bling_label_templates').update(t).eq('id',old.id).select('*').single())});}));
  app.delete('/api/portal/bling/templates/:id',auth,safe(async(req,res)=>{await db(supabase.from('bling_label_templates').delete().eq('portal_user_id',req.owner).eq('id',req.params.id));res.json({ok:true});}));
  app.post('/api/portal/bling/labels/pdf',auth,safe(async(req,res)=>{const selections=req.body.entries;if(!Array.isArray(selections)||!selections.length||selections.length>50)return res.status(400).json({message:'Selecione de 1 a 50 entradas'});const template=await db(supabase.from('bling_label_templates').select('*').eq('portal_user_id',req.owner).eq('id',req.body.template_id).maybeSingle());if(!template)return res.status(404).json({message:'Modelo não encontrado'});const ids=[...new Set(selections.map(x=>x.id))];const entries=await db(supabase.from('bling_stock_entries').select('*,bling_connections!inner(portal_user_id)').in('id',ids).eq('bling_connections.portal_user_id',req.owner));if(entries.length!==ids.length)return res.status(403).json({message:'Seleção inválida'});const points=72/25.4, w=template.width_mm*points,h=template.height_mm*points;const doc=new PDFDocument({autoFirstPage:false,margin:0,compress:true});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="etiquetas.pdf"');doc.pipe(res);let count=0;for(const selected of selections){const e=entries.find(v=>v.id===selected.id);const qty=Number(selected.count);if(!Number.isInteger(qty)||qty<1||qty>500||count+qty>1000)throw Error('Quantidade de etiquetas inválida');for(let i=0;i<qty;i++){doc.addPage({size:[w,h],margin:0});for(const el of template.elements){const x=el.x*points,y=el.y*points,ew=el.w*points,eh=el.h*points;const date=new Date(e.occurred_at);const value=({sku:e.sku,name:e.product_name,quantity:String(e.quantity),date:date.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}),time:date.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}),text:String(el.text||'')})[el.type];if(el.type==='qr'){if(!e.sku)continue;const svg=await QRCode.toBuffer(e.sku,{type:'png',margin:0,errorCorrectionLevel:'M',width:300});doc.image(svg,x,y,{fit:[ew,eh]});}else if(el.type==='logo'&&typeof el.image==='string'&&/^data:image\/(png|jpeg);base64,/.test(el.image)){const image=Buffer.from(el.image.split(',')[1],'base64');if(image.length<=200000)doc.image(image,x,y,{fit:[ew,eh]});}else if(value!=null){doc.font(el.bold?'Helvetica-Bold':'Helvetica').fontSize(Math.max(5,Math.min(40,Number(el.fontSize)||10))).text(String(value),x,y,{width:ew,height:eh,align:['left','right','center'].includes(el.align)?el.align:'left',ellipsis:true});}}count++;}}doc.end();}));
  // Raw body is captured before Express JSON parsing via JSON.stringify? The server uses express.json first;
  // express.json verify is configured at server entry to preserve the exact bytes.
  app.post('/api/webhooks/bling/stock',safe(async(req,res)=>{const raw=req.rawBody;if(!Buffer.isBuffer(raw))return res.status(503).json({message:'Assinatura indisponível'});const sig=String(req.headers['x-bling-signature-256']||'');const expected='sha256='+crypto.createHmac('sha256',secret()).update(raw).digest('hex');if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return res.status(401).json({message:'Assinatura inválida'});const event=req.body;if(!event.eventId||!event.companyId)return res.status(400).json({message:'Evento incompleto'});const matches=await db(supabase.from('bling_connections').select('id,portal_user_id,status').or('webhook_company_id.eq.'+String(event.companyId)+',and(webhook_company_id.is.null,company_id.eq.'+String(event.companyId)+')').eq('status','connected'));if(!matches.length)return res.status(202).json({ok:true,ignored:'empresa não conectada'});if(!/^stock\.(created|updated)$/.test(String(event.event))||event.data?.operacao!=='E')return res.json({ok:true,ignored:true});const p=event.data;const productId=p.produto?.id;if(!productId||!(Number(p.quantidade)>0))return res.json({ok:true,ignored:true});for(const c of matches){const record={bling_connection_id:c.id,event_id:String(event.eventId),product_id:String(productId),quantity:Number(p.quantidade),occurred_at:event.date||new Date().toISOString(),payload:event};await db(supabase.from('bling_stock_entries').upsert(record,{onConflict:'bling_connection_id,event_id',ignoreDuplicates:true}));}res.json({ok:true});}));
  // Enriquecimento explícito, controlado pelo titular, para não atrasar confirmação dos webhooks.
  // Enriquecimento explícito: busca dados cadastrais somente de produtos, nunca da empresa.
  // O webhook de estoque não envia SKU nem nome. Não inventamos esses campos.
  app.post('/api/portal/bling/entries/enrich',auth,safe(async(req,res)=>{
    const id=String(req.body?.connection_id||'');
    const c=await conn(req.owner,id);
    if(c.status!=='connected')return res.status(409).json({message:'Conexão Bling desconectada'});
    const rows=await db(supabase.from('bling_stock_entries')
      .select('id,product_id').eq('bling_connection_id',id).is('sku',null)
      .order('occurred_at',{ascending:false}).limit(40));
    let enriched=0,missingSku=0;
    const failures=[];
    for(const row of rows){
      try{
        const p=await blingGet(c,'/produtos/'+encodeURIComponent(row.product_id));
        if(!p){failures.push({product_id:row.product_id,reason:'Produto não encontrado na resposta'});continue;}
        const sku=String(p.codigo||'').trim();
        const imageUrl=typeof p.imagemURL==='string'?p.imagemURL:null;
        // Retornar a linha alterada: UPDATE sem .select() pode retornar sucesso
        // mesmo quando nenhuma linha foi modificada (por exemplo, por RLS).
        const updated=await db(supabase.from('bling_stock_entries').update({
          sku:sku||null,
          product_name:p.nome||null,
          image_url:imageUrl
        }).eq('id',row.id).eq('bling_connection_id',id)
          .select('id,sku,product_name,image_url').maybeSingle());
        if(!updated){
          failures.push({product_id:row.product_id,reason:'UPDATE no Supabase não retornou registro; verifique RLS, permissões e filtros'});
          continue;
        }
        if(sku && updated.sku===sku) enriched++;
        else if(!sku) missingSku++;
        else failures.push({product_id:row.product_id,reason:'SKU retornado pelo Bling não foi persistido no Supabase'});
      }catch(e){
        const status=e.response?.status||null;
        const reason=e.response?.data?.error?.description||e.response?.data?.error?.message||e.message;
        failures.push({product_id:row.product_id,status,reason:String(reason).slice(0,180)});
        console.error('Bling produto:',{status,productId:row.product_id,reason:String(reason).slice(0,180)});
      }
    }
    await db(supabase.from('bling_connections').update({last_sync_at:new Date().toISOString()}).eq('id',id));
    res.json({enriched,missingSku,attempted:rows.length,failures:failures.slice(0,5)});
  }));
  app.use((err,req,res,next)=>{if(!req.path.includes('/bling/'))return next(err);console.error('Bling multi:',err.response?.status||err.message);if(!res.headersSent)res.status(500).json({message:'Falha na operação Bling. Verifique configuração e logs do servidor.'});else res.end();});
};
