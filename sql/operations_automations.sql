-- Somente o backend acessa estes objetos; contas do portal usam JWT próprio.
create table public.portal_automation_rules (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.portal_users(id) on delete cascade,
 kind text not null default 'daily_sales' check(kind='daily_sales'),
 enabled boolean not null default false,
 run_time time not null default '08:00',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,kind)
);
create table public.portal_automation_runs (
 id uuid primary key default gen_random_uuid(),
 rule_id uuid not null references public.portal_automation_rules(id) on delete cascade,
 owner_id uuid not null references public.portal_users(id) on delete cascade,
 report_day date not null,
 status text not null default 'queued' check(status in ('queued','running','completed','partial','failed')),
 attempts integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 retry_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 result jsonb,
 error text,
 created_at timestamptz not null default now(),
 unique(rule_id,report_day)
);
create index portal_automation_runs_owner_created on public.portal_automation_runs(owner_id,created_at desc);
create index portal_automation_runs_queue on public.portal_automation_runs(status,retry_at);
create table public.portal_automation_runtime (
 id boolean primary key default true check(id),
 token_hash text not null
);
alter table public.portal_automation_rules enable row level security;
alter table public.portal_automation_runs enable row level security;
alter table public.portal_automation_runtime enable row level security;
revoke all on public.portal_automation_rules,public.portal_automation_runs,public.portal_automation_runtime from public,anon,authenticated;
grant all on public.portal_automation_rules,public.portal_automation_runs,public.portal_automation_runtime to service_role;

create function public.mlsh_claim_automation_run()
returns setof public.portal_automation_runs
language sql volatile security invoker set search_path='' as $$
 with candidate as (
  select id from public.portal_automation_runs
  where (status='queued' and retry_at<=now()) or (status='running' and lease_until<now())
  order by created_at for update skip locked limit 1
 ) update public.portal_automation_runs r
 set status='running',attempts=r.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes',started_at=now(),error=null
 from candidate c where r.id=c.id returning r.*;
$$;
revoke all on function public.mlsh_claim_automation_run() from public,anon,authenticated;
grant execute on function public.mlsh_claim_automation_run() to service_role;

create extension if not exists pg_net with schema extensions;
create schema if not exists mlsh_internal;
revoke all on schema mlsh_internal from public,anon,authenticated;
do $$ declare token text; begin
 token:=gen_random_uuid()::text||gen_random_uuid()::text;
 perform vault.create_secret(token,'mlsh_automation_tick','Autenticação do agendador ML SH Support');
 insert into public.portal_automation_runtime(id,token_hash) values(true,encode(sha256(convert_to(token,'UTF8')),'hex'));
end $$;

create function mlsh_internal.enqueue_daily_reports()
returns void language plpgsql security invoker set search_path='' as $$
declare token text;
begin
 insert into public.portal_automation_runs(rule_id,owner_id,report_day)
 select r.id,r.owner_id,(now() at time zone 'America/Sao_Paulo')::date-1
 from public.portal_automation_rules r join public.portal_users u on u.id=r.owner_id
 where r.enabled and u.status='active' and not coalesce(u.access_revoked,false)
 and (now() at time zone 'America/Sao_Paulo')::time>=r.run_time
 on conflict(rule_id,report_day) do nothing;
 if exists(select 1 from public.portal_automation_runs where (status='queued' and retry_at<=now()) or (status='running' and lease_until<now())) then
  select decrypted_secret into token from vault.decrypted_secrets where name='mlsh_automation_tick';
  perform net.http_post(url:='https://app.caickrigato.com.br/api/internal/automations/tick',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),body:='{}'::jsonb,timeout_milliseconds:=10000);
 end if;
end $$;
revoke all on function mlsh_internal.enqueue_daily_reports() from public,anon,authenticated;
select cron.schedule('mlsh-daily-reports','* * * * *','select mlsh_internal.enqueue_daily_reports()');
