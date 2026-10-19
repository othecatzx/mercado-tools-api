-- ML SH Support: integração Google Chat para códigos de autorização de postagem.
-- Execute este script no SQL Editor do Supabase antes de publicar a API.

create table if not exists public.google_chat_settings (
    company_id uuid primary key references public.companies(id) on delete cascade,
    webhook_url text,
    enabled boolean not null default false,
    updated_by_device_id text,
    updated_at timestamptz not null default now()
);

create table if not exists public.google_chat_sent_codes (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    code text not null,
    code_date date not null,
    source_device_id text,
    sent_at timestamptz not null default now(),
    constraint google_chat_sent_codes_company_code_date_unique
        unique (company_id, code, code_date)
);

alter table public.google_chat_settings enable row level security;
alter table public.google_chat_sent_codes enable row level security;

-- A API acessa essas tabelas com a chave service_role no servidor.
-- Não crie policies públicas/anon para ler ou alterar URLs de webhook.
