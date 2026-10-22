-- ML SH Support: equipe, permissões, conversas, mensagens, respostas rápidas e auditoria.
-- Execute o arquivo completo no SQL Editor do Supabase antes de publicar a API.

create table if not exists public.support_agents (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 100),
  email text not null,
  senha_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  permissions jsonb not null default '[]'::jsonb,
  allowed_company_ids text[] not null default '{}',
  created_by_portal_user_id uuid not null references public.portal_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_agents_email_per_license unique (license_id, email)
);

create index if not exists support_agents_license_status_idx
  on public.support_agents (license_id, status);

-- Permite que um atendente acesse várias licenças/lojas do mesmo administrador.
alter table public.support_agents add column if not exists allowed_license_ids uuid[] not null default '{}';
update public.support_agents set allowed_license_ids = array[license_id] where cardinality(allowed_license_ids) = 0;

create table if not exists public.support_audit_logs (
  id bigint generated always as identity primary key,
  license_id uuid not null references public.licenses(id) on delete cascade,
  actor_portal_user_id uuid references public.portal_users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_audit_logs_license_created_idx
  on public.support_audit_logs (license_id, created_at desc);

-- As consultas são feitas pela API usando a service role; bloquear acesso direto por clientes.
alter table public.support_agents enable row level security;
alter table public.support_audit_logs enable row level security;

-- Sem políticas para anon/authenticated: acesso somente pela API confiável.

-- Caixa de entrada, histórico, atribuição e respostas rápidas.
create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  pack_id text not null,
  seller_id text not null,
  order_id text,
  buyer_id text,
  buyer_name text,
  item_title text,
  site_id text not null default 'MLB',
  ml_status text not null default 'unknown',
  ml_substatus text,
  last_message text,
  last_message_at timestamptz,
  assigned_agent_id uuid references public.support_agents(id) on delete set null,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint support_conversations_pack_unique unique (license_id, pack_id, seller_id)
);
create index if not exists support_conversations_license_last_idx
  on public.support_conversations (license_id, last_message_at desc);
create index if not exists support_conversations_assigned_idx
  on public.support_conversations (assigned_agent_id, last_message_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  external_message_id text not null,
  sender_id text,
  sender_role text not null check (sender_role in ('buyer','seller','system','unknown')),
  text text not null default '',
  status text,
  attachments jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_messages_external_unique unique (license_id, external_message_id)
);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages (conversation_id, created_at asc);

create table if not exists public.support_quick_replies (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  body text not null check (char_length(body) between 1 and 350),
  created_by_portal_user_id uuid references public.portal_users(id) on delete set null,
  created_by_agent_id uuid references public.support_agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_quick_replies_license_idx
  on public.support_quick_replies (license_id, title);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_quick_replies enable row level security;
