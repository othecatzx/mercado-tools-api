-- Migração: períodos configuráveis (1 a 36 meses).
-- Executada no banco em 16/11/2026. Mantida aqui para reprodução em novos ambientes.
begin;
create table if not exists public.billing_periods (
 months integer primary key check(months between 1 and 36),
 label text not null check(length(trim(label)) between 2 and 40),
 price numeric(12,2) not null check(price>0 and price<=999999),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.billing_periods enable row level security;
revoke all on public.billing_periods from public,anon,authenticated;
grant all on public.billing_periods to service_role;
insert into public.billing_periods(months,label,price)
select x.months,x.label,x.price
from public.billing_product p
cross join lateral (values (1,'Mensal',p.monthly_price),(6,'Semestral',p.semiannual_price),(12,'Anual',p.annual_price)) x(months,label,price)
where p.id=true and x.price is not null
on conflict(months) do nothing;
alter table public.billing_signups drop constraint if exists billing_signups_period_check;
alter table public.billing_signups add constraint billing_signups_period_check check(period between 1 and 36);
do $migration$
declare s text; fn text;
begin
 for fn in select unnest(array['mlsh_batch_quote','mlsh_signup_quote']) loop
  select pg_get_functiondef(p.oid) into s
  from pg_proc p
  where p.pronamespace='public'::regnamespace and p.proname=fn;
  if s is null
   or position('p_period not in (1,6,12)' in s)=0
   or position('price:=case p_period when 1 then product.monthly_price when 6 then product.semiannual_price when 12 then product.annual_price end;' in s)=0
  then raise exception 'Unexpected function definition: %',fn; end if;
  s:=replace(s,'p_period not in (1,6,12)','(p_period not between 1 and 36)');
  s:=replace(s,'price:=case p_period when 1 then product.monthly_price when 6 then product.semiannual_price when 12 then product.annual_price end;',
   'select bp.price into price from public.billing_periods bp where bp.months=p_period and bp.enabled=true;');
  execute s;
 end loop;
end $migration$;
commit;
