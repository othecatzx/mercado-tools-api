-- Supabase: aplicado em 11/11/2026. Mantido no repositório para referência.
-- As únicas rotas de acesso são as rotas autenticadas do backend usando chave de serviço.
alter table public.support_conversations
  add column if not exists labels text[] not null default '{}'::text[];

create table if not exists public.support_internal_notes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  license_id uuid not null,
  author_id uuid not null,
  author_name text not null,
  note text not null check (char_length(note) between 1 and 3000),
  created_at timestamptz not null default now()
);
create index if not exists idx_support_internal_notes_conversation
  on public.support_internal_notes(conversation_id, created_at desc);
alter table public.support_internal_notes enable row level security;
revoke all on public.support_internal_notes from anon, authenticated;
comment on table public.support_internal_notes is
  'Internal support notes accessed exclusively through authenticated server routes and service role';

-- Leitura compartilhada: ao abrir um chat, todos da equipe deixam de vê-lo como novo.
alter table public.support_conversations
  add column if not exists last_viewed_buyer_at timestamptz;

-- Na implantação, mensagens antigas já são consideradas visualizadas; somente
-- mensagens recebidas após a implantação serão indicadas como novas.
update public.support_conversations as c
set last_viewed_buyer_at = (
  select max(m.created_at)
  from public.support_messages m
  where m.conversation_id = c.id
    and m.license_id = c.license_id
    and m.sender_role = 'buyer'
)
where c.last_viewed_buyer_at is null
  and exists (
    select 1 from public.support_messages m
    where m.conversation_id = c.id
      and m.license_id = c.license_id
      and m.sender_role = 'buyer'
  );
comment on column public.support_conversations.last_viewed_buyer_at is
  'Most recent buyer message seen by any authorized support user; shared unread marker across team';
