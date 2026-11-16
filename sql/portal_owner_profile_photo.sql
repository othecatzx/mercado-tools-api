-- Migration already applied to Supabase MercadoLivre Utils.
alter table public.portal_users add column if not exists avatar_url text;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('portal-avatars','portal-avatars',true,1048576,array['image/webp'])
on conflict (id) do update set public=true,file_size_limit=1048576,allowed_mime_types=array['image/webp'];
