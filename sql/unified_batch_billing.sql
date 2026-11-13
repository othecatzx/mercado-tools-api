create table public.billing_product (
 id boolean primary key default true check(id),
 name text not null default 'ML SH Support',
 monthly_price numeric(12,2) check(monthly_price>0),
 semiannual_price numeric(12,2) check(semiannual_price>0),
 annual_price numeric(12,2) check(annual_price>0),
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.billing_product(id) values(true);
alter table public.billing_product enable row level security;
revoke all on public.billing_product from public,anon,authenticated;
grant all on public.billing_product to service_role;
-- Mantém os registros históricos; as três categorias antigas não são mais ofertadas.
update public.plans set status='inactive',updated_at=now() where nome in ('Básico','Profissional','Empresa');
create table public.billing_batches (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.portal_users(id),
 request_key uuid not null,
 environment text not null check(environment in ('sandbox','production')),
 quote jsonb not null,
 target_date date not null,
 expected_total numeric(12,2) not null check(expected_total>0),
 status text not null default 'pending' check(status in ('pending','paid','cancelled','expired','review')),
 asaas_checkout_id text unique,
 checkout_url text,
 provider_customer_id text,
 creation_error text,
 created_at timestamptz not null default now(),
 paid_at timestamptz,
 unique(owner_id,request_key)
);
create index billing_batches_owner on public.billing_batches(owner_id,created_at desc);
create table public.billing_batch_items (
 batch_id uuid not null references public.billing_batches(id) on delete cascade,
 license_id uuid not null references public.licenses(id),
 base_expiry timestamptz not null,
 amount numeric(12,2) not null check(amount>0),
 state text not null default 'pending' check(state in ('pending','paid','cancelled','expired','review')),
 primary key(batch_id,license_id)
);
create unique index billing_pending_license on public.billing_batch_items(license_id) where state in ('pending','review');
alter table public.billing_batches enable row level security;
alter table public.billing_batch_items enable row level security;
revoke all on public.billing_batches,public.billing_batch_items from public,anon,authenticated;
grant all on public.billing_batches,public.billing_batch_items to service_role;
alter table public.payments add column batch_id uuid references public.billing_batches(id);
alter table public.billing_webhook_events add column batch_id uuid references public.billing_batches(id);

create function public.mlsh_batch_quote(p_owner uuid,p_ids uuid[],p_period integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare product public.billing_product; anchor date; target date; price numeric; reference_days integer; items jsonb; today date:=(now() at time zone 'America/Sao_Paulo')::date; count_ids integer;
begin
 if p_period not in (1,6,12) or coalesce(cardinality(p_ids),0)<1 or cardinality(p_ids)>100 or array_position(p_ids,null) is not null then raise exception 'invalid_selection'; end if;
 if cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) then raise exception 'duplicate_license'; end if;
 if not exists(select 1 from public.portal_users where id=p_owner and status='active' and not access_revoked) then raise exception 'owner_unavailable'; end if;
 select * into product from public.billing_product where id=true;
 price:=case p_period when 1 then product.monthly_price when 6 then product.semiannual_price when 12 then product.annual_price end;
 if price is null then raise exception 'price_not_configured'; end if;
 select count(distinct l.id),greatest(today,max((l.vencimento at time zone 'America/Sao_Paulo')::date)) into count_ids,anchor
 from public.licenses l join public.portal_user_licenses ul on ul.license_id=l.id join public.companies c on c.id=l.company_id
 where l.id=any(p_ids) and ul.user_id=p_owner and l.status in ('active','expired') and l.vencimento is not null and l.asaas_subscription_id is null and c.status='active';
 if count_ids<>cardinality(p_ids) then raise exception 'license_unavailable'; end if;
 target:=(anchor+make_interval(months=>p_period))::date;reference_days:=target-anchor;
 select jsonb_agg(jsonb_build_object('license_id',l.id,'company_id',c.id,'company_name',c.nome,'base_expiry',l.vencimento,
  'days',target-greatest(today,(l.vencimento at time zone 'America/Sao_Paulo')::date),
  'amount',round(price*(target-greatest(today,(l.vencimento at time zone 'America/Sao_Paulo')::date))/reference_days,2)) order by l.id) into items
 from public.licenses l join public.companies c on c.id=l.company_id where l.id=any(p_ids);
 return jsonb_build_object('product',product.name,'version',product.version,'period',p_period,'period_price',price,'anchor_date',anchor,'target_date',target,'reference_days',reference_days,'items',items,'total',(select sum((x->>'amount')::numeric) from jsonb_array_elements(items) x));
end $$;

create function public.mlsh_reserve_batch(p_owner uuid,p_ids uuid[],p_period integer,p_key uuid,p_environment text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare batch public.billing_batches; q jsonb;
begin
 if p_environment not in ('sandbox','production') then raise exception 'invalid_environment'; end if;
 select * into batch from public.billing_batches where owner_id=p_owner and request_key=p_key for update;
 if found then return jsonb_build_object('created',false,'batch',to_jsonb(batch)); end if;
 perform id from public.licenses where id=any(p_ids) order by id for update;
 select * into batch from public.billing_batches where owner_id=p_owner and request_key=p_key;
 if found then return jsonb_build_object('created',false,'batch',to_jsonb(batch)); end if;
 perform id from public.billing_product where id=true for share;
 q:=public.mlsh_batch_quote(p_owner,p_ids,p_period);
 if exists(select 1 from public.billing_batch_items where license_id=any(p_ids) and state in ('pending','review')) then raise exception 'license_reserved'; end if;
 insert into public.billing_batches(owner_id,request_key,environment,quote,target_date,expected_total)
 values(p_owner,p_key,p_environment,q,(q->>'target_date')::date,(q->>'total')::numeric) returning * into batch;
 insert into public.billing_batch_items(batch_id,license_id,base_expiry,amount)
 select batch.id,(x->>'license_id')::uuid,(x->>'base_expiry')::timestamptz,(x->>'amount')::numeric from jsonb_array_elements(q->'items') x;
 return jsonb_build_object('created',true,'batch',to_jsonb(batch));
end $$;

create function public.mlsh_close_unpaid_batch(p_batch uuid,p_status text)
returns void language plpgsql volatile security invoker set search_path='' as $$
begin
 if p_status not in ('cancelled','expired','review') then raise exception 'invalid_status'; end if;
 perform id from public.billing_batches where id=p_batch for update;
 update public.billing_batches set status=p_status where id=p_batch and status='pending';
 if found then update public.billing_batch_items set state=p_status where batch_id=p_batch and state='pending'; end if;
end $$;

create function public.mlsh_apply_batch_payment(p_event_id text,p_environment text,p_payment jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare ev public.billing_webhook_events; batch public.billing_batches; existing public.payments; problem text; target timestamptz;
begin
 select * into ev from public.billing_webhook_events where id=p_event_id and environment=p_environment for update;
 if not found or ev.payment_id is distinct from p_payment->>'id' then raise exception 'event_mismatch'; end if;
 if ev.status in ('processed','ignored','review') then return jsonb_build_object('status',ev.status,'duplicate',true); end if;
 select * into batch from public.billing_batches b where b.environment=p_environment and
  (b.asaas_checkout_id=p_payment->>'checkoutSession' or 'mlsh_batch_'||b.id::text=p_payment->>'externalReference') for update;
 if not found then
  update public.billing_webhook_events set status='ignored',reason='Lote não encontrado.',processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','ignored');
 end if;
 update public.billing_webhook_events set batch_id=batch.id where id=p_event_id;
 if round((p_payment->>'value')::numeric,2) is distinct from batch.expected_total then problem:='Valor diferente da cotação do lote.';
 elsif not exists(select 1 from public.portal_users where id=batch.owner_id and status='active' and not access_revoked) then problem:='Titular indisponível.';
 elsif batch.asaas_checkout_id is not null and p_payment->>'checkoutSession' is not null and batch.asaas_checkout_id<>p_payment->>'checkoutSession' then problem:='Checkout divergente.';
 elsif batch.provider_customer_id is not null and batch.provider_customer_id is distinct from p_payment->>'customer' then problem:='Cliente do provedor divergente.';
 elsif ev.event in ('PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_REFUND_IN_PROGRESS') or p_payment->>'status' in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL') then problem:='Estorno ou contestação do lote requer revisão.';
 end if;
 if problem is not null then
  update public.billing_webhook_events set status='review',reason=problem,processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','review');
 end if;
 if coalesce(p_payment->>'status','') not in ('CONFIRMED','RECEIVED') then
  update public.billing_webhook_events set status='ignored',reason='Pagamento ainda não confirmado.',processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','ignored');
 end if;
 select * into existing from public.payments where asaas_payment_id=p_payment->>'id' for update;
 if found and existing.billing_applied_at is not null then
  if existing.batch_id is distinct from batch.id then raise exception 'payment_batch_mismatch'; end if;
  update public.billing_webhook_events set status='processed',processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','processed','duplicate',true);
 end if;
 if batch.status<>'pending' then problem:='O lote não está mais pendente. Verifique eventual cobrança adicional.';
 else
  perform l.id from public.licenses l join public.billing_batch_items i on i.license_id=l.id where i.batch_id=batch.id order by l.id for update of l;
  if exists(select 1 from public.billing_batch_items i join public.licenses l on l.id=i.license_id join public.companies c on c.id=l.company_id where i.batch_id=batch.id and
   (l.vencimento is distinct from i.base_expiry or l.status='blocked' or c.status<>'active' or l.asaas_subscription_id is not null or not exists(select 1 from public.portal_user_licenses ul where ul.user_id=batch.owner_id and ul.license_id=l.id))) then problem:='Uma licença mudou desde a cotação. O lote exige revisão sem alterar vencimentos.'; end if;
 end if;
 if problem is not null then
  update public.billing_webhook_events set status='review',reason=problem,processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','review');
 end if;
 target:=((batch.target_date+1)::timestamp at time zone 'America/Sao_Paulo')-interval '1 millisecond';
 update public.licenses l set vencimento=target,status='active',plan_id=null,updated_at=now() from public.billing_batch_items i where i.batch_id=batch.id and l.id=i.license_id;
 insert into public.payments(asaas_payment_id,valor,status,tipo,evento,billing_applied_at,billing_environment,billing_period_end,batch_id)
 values(p_payment->>'id',batch.expected_total,lower(p_payment->>'status'),p_payment->>'billingType',ev.event,now(),p_environment,target,batch.id);
 update public.billing_batches set status='paid',paid_at=now(),provider_customer_id=p_payment->>'customer',asaas_checkout_id=coalesce(asaas_checkout_id,p_payment->>'checkoutSession') where id=batch.id;
 update public.billing_batch_items set state='paid' where batch_id=batch.id;
 update public.billing_webhook_events set status='processed',processed_at=now() where id=p_event_id;
 return jsonb_build_object('status','processed','batch_id',batch.id,'expires_at',target);
end $$;

revoke all on function public.mlsh_batch_quote(uuid,uuid[],integer),public.mlsh_reserve_batch(uuid,uuid[],integer,uuid,text),public.mlsh_close_unpaid_batch(uuid,text),public.mlsh_apply_batch_payment(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mlsh_batch_quote(uuid,uuid[],integer),public.mlsh_reserve_batch(uuid,uuid[],integer,uuid,text),public.mlsh_close_unpaid_batch(uuid,text),public.mlsh_apply_batch_payment(text,text,jsonb) to service_role;
