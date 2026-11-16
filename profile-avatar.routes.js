'use strict';
const express=require('express');
module.exports=function registerProfileAvatar(app,{supabase,authPortal,authPortalOrAgent}){
 app.get('/api/portal/profile-avatar',authPortalOrAgent,async(req,res)=>{
  try{
   const {data,error}=await supabase.from('portal_users').select('avatar_url').eq('id',req.portalUserId).maybeSingle();
   if(error)throw error;
   res.set('Cache-Control','no-store').json({ok:true,avatar_url:data?.avatar_url||null});
  }catch(error){console.error('Profile avatar read:',error.message);res.status(500).json({ok:false,error:'avatar_read_failed'});}
 });
 app.put('/api/portal/profile-avatar',authPortal,express.raw({type:'image/webp',limit:'1mb'}),async(req,res)=>{
  try{
   const image=req.body;
   if(!Buffer.isBuffer(image)||image.length<16||image.length>1048576||image.toString('ascii',0,4)!=='RIFF'||image.toString('ascii',8,12)!=='WEBP'){
    return res.status(400).json({ok:false,error:'invalid_image',message:'Escolha uma imagem WebP válida de até 1 MB.'});
   }
   const objectPath=req.portalUserId+'/avatar.webp';
   const {error:uploadError}=await supabase.storage.from('portal-avatars').upload(objectPath,image,{contentType:'image/webp',cacheControl:'60',upsert:true});
   if(uploadError)throw uploadError;
   const {data:link}=supabase.storage.from('portal-avatars').getPublicUrl(objectPath);
   const avatar_url=link.publicUrl+'?v='+Date.now();
   const {error:updateError}=await supabase.from('portal_users').update({avatar_url}).eq('id',req.portalUserId);
   if(updateError)throw updateError;
   res.json({ok:true,avatar_url});
  }catch(error){console.error('Profile avatar upload:',error.message);res.status(500).json({ok:false,error:'avatar_upload_failed',message:'Não foi possível salvar a foto.'});}
 });
};
