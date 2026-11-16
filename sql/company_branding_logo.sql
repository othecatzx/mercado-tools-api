-- Migration já aplicada no Supabase MercadoLivre Utils.
alter table public.companies add column if not exists logo_url text;

-- Imagens públicas para exibição dos logos; o upload ocorre exclusivamente no backend com service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-logos', 'company-logos', true, 1048576, array['image/webp'])
on conflict (id) do update set public=true, file_size_limit=1048576, allowed_mime_types=array['image/webp'];
