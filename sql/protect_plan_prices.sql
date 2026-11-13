-- Preços são consultáveis, mas somente o backend pode administrá-los.
alter table public.plans enable row level security;
create policy plans_read_active on public.plans for select to anon,authenticated using(status='active');
revoke insert,update,delete,truncate,references,trigger on public.plans from public,anon,authenticated;
grant select on public.plans to anon,authenticated;
grant all on public.plans to service_role;
