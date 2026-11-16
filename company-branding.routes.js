'use strict';
const express=require('express');
module.exports=function registerCompanyBranding(app,{supabase,authPortal}){
  app.put('/api/portal/company-logo/:companyId',authPortal,express.raw({type:'image/webp',limit:'1mb'}),async(req,res)=>{
    try{
      const companyId=String(req.params.companyId||'');
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(companyId))return res.status(400).json({ok:false,error:'invalid_company'});
      const image=req.body;
      if(!Buffer.isBuffer(image)||image.length<16||image.length>1048576||image.toString('ascii',0,4)!=='RIFF'||image.toString('ascii',8,12)!=='WEBP')return res.status(400).json({ok:false,error:'invalid_image',message:'Envie uma imagem WebP válida de até 1 MB.'});
      const {data:links,error:linkError}=await supabase.from('portal_user_licenses').select('licenses!inner(company_id)').eq('user_id',req.portalUserId);
      if(linkError)throw linkError;
      if(!(links||[]).some(row=>String(row.licenses?.company_id)===companyId))return res.status(403).json({ok:false,error:'not_company_owner',message:'Você não possui uma licença desta empresa.'});
      const objectPath=companyId+'/logo.webp';
      const {error:uploadError}=await supabase.storage.from('company-logos').upload(objectPath,image,{contentType:'image/webp',cacheControl:'60',upsert:true});
      if(uploadError)throw uploadError;
      const {data:publicUrl}=supabase.storage.from('company-logos').getPublicUrl(objectPath);
      const logo_url=publicUrl.publicUrl+'?v='+Date.now();
      const {error:updateError}=await supabase.from('companies').update({logo_url}).eq('id',companyId);
      if(updateError)throw updateError;
      res.json({ok:true,company_id:companyId,logo_url});
    }catch(error){console.error('Company logo:',error.message);res.status(500).json({ok:false,error:'upload_failed',message:'Não foi possível salvar a imagem.'});}
  });
};
