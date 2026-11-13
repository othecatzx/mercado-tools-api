create table public.billing_signups (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.portal_users(id),request_key uuid not null,
 environment text not null check(environment in ('sandbox','production')),quote jsonb not null,documento text not null,
 period integer not null check(period in (1,6,12)),expected_total numeric(12,2) not null check(expected_total>0),
 status text not null default 'pending' check(status in ('pending','paid','cancelled','expired','review')),
 asaas_checkout_id text unique,checkout_url text,provider_customer_id text,creation_error text,
 company_id uuid references public.companies(id),license_id uuid references public.licenses(id),
 created_at timestamptz not null default now(),paid_at timestamptz,unique(owner_id,request_key)
);
create unique index billing_signup_document on public.billing_signups(documento) where status in ('pending','paid','review');
create index billing_signups_owner on public.billing_signups(owner_id,created_at desc);
alter table public.billing_signups enable row level security;
revoke all on public.billing_signups from public,anon,authenticated;
grant all on public.billing_signups to service_role;
alter table public.payments add column signup_id uuid references public.billing_signups(id);
alter table public.billing_webhook_events add column signup_id uuid references public.billing_signups(id);

create function public.mlsh_signup_quote(p_owner uuid,p_company jsonb,p_period integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare product public.billing_product; price numeric; doc text:=p_company->>'documento';
begin
 if not exists(select 1 from public.portal_users where id=p_owner and status='active' and not access_revoked) then raise exception 'owner_unavailable'; end if;
 if p_period is null or p_period not in (1,6,12) or p_company is null or coalesce(length(trim(p_company->>'nome')),0) not between 2 and 150 or coalesce(doc,'') !~ '^([0-9]{11}|[0-9]{14})$' or coalesce(length(p_company->>'codigo_ml'),0)>100 then raise exception 'invalid_company'; end if;
 select * into product from public.billing_product where id=true;
 price:=case p_period when 1 then product.monthly_price when 6 then product.semiannual_price when 12 then product.annual_price end;
 if price is null then raise exception 'price_not_configured'; end if;
 if exists(select 1 from public.companies where regexp_replace(documento,'[^0-9]','','g')=doc) then raise exception 'company_already_registered'; end if;
 return jsonb_build_object('product',product.name,'version',product.version,'company',jsonb_build_object('nome',trim(p_company->>'nome'),'documento',doc,'codigo_ml',nullif(trim(p_company->>'codigo_ml'),'')),'period',p_period,'total',price);
end $$;

create function public.mlsh_reserve_signup(p_owner uuid,p_company jsonb,p_period integer,p_key uuid,p_environment text)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare ord public.billing_signups; q jsonb;
begin
 if p_key is null or p_environment is null or p_environment not in ('sandbox','production') then raise exception 'invalid_request'; end if;
 select * into ord from public.billing_signups where owner_id=p_owner and request_key=p_key for update;
 if found then return jsonb_build_object('created',false,'order',to_jsonb(ord)); end if;
 perform pg_advisory_xact_lock(hashtextextended('signup:'||coalesce(p_company->>'documento',''),0));
 select * into ord from public.billing_signups where owner_id=p_owner and request_key=p_key;
 if found then return jsonb_build_object('created',false,'order',to_jsonb(ord)); end if;
 perform id from public.billing_product where id=true for share;
 q:=public.mlsh_signup_quote(p_owner,p_company,p_period);
 if exists(select 1 from public.billing_signups where documento=q->'company'->>'documento' and status in ('pending','paid','review')) then raise exception 'signup_already_pending'; end if;
 insert into public.billing_signups(owner_id,request_key,environment,quote,documento,period,expected_total) values(p_owner,p_key,p_environment,q,q->'company'->>'documento',p_period,(q->>'total')::numeric) returning * into ord;
 return jsonb_build_object('created',true,'order',to_jsonb(ord));
end $$;

create function public.mlsh_apply_signup_payment(p_event_id text,p_environment text,p_payment jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare ev public.billing_webhook_events; ord public.billing_signups; existing public.payments; problem text; cid uuid; lid uuid; target timestamptz; key text;
begin
 select * into ev from public.billing_webhook_events where id=p_event_id and environment=p_environment for update;
 if not found or ev.payment_id is distinct from p_payment->>'id' then raise exception 'event_mismatch'; end if;
 if ev.status in ('processed','ignored','review') then return jsonb_build_object('status',ev.status,'duplicate',true); end if;
 select * into ord from public.billing_signups where environment=p_environment and (asaas_checkout_id=p_payment->>'checkoutSession' or 'mlsh_signup_'||id::text=p_payment->>'externalReference') for update;
 if not found then update public.billing_webhook_events set status='ignored',reason='Contratação não encontrada.',processed_at=now() where id=p_event_id;return jsonb_build_object('status','ignored');end if;
 update public.billing_webhook_events set signup_id=ord.id where id=p_event_id;
 if round((p_payment->>'value')::numeric,2) is distinct from ord.expected_total then problem:='Valor diferente da contratação.';
 elsif ord.asaas_checkout_id is not null and p_payment->>'checkoutSession' is not null and ord.asaas_checkout_id<>p_payment->>'checkoutSession' then problem:='Checkout divergente.';
 elsif p_payment->>'externalReference' is not null and p_payment->>'externalReference'<>'mlsh_signup_'||ord.id::text then problem:='Referência divergente.';
 elsif p_payment->>'subscription' is not null then problem:='Assinatura inesperada.';
 elsif ord.provider_customer_id is not null and ord.provider_customer_id is distinct from p_payment->>'customer' then problem:='Cliente divergente.';
 elsif ev.event in ('PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_REFUND_IN_PROGRESS') or p_payment->>'status' in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL') then problem:='Estorno ou contestação requer revisão.';
 end if;
 if problem is not null then update public.billing_webhook_events set status='review',reason=problem,processed_at=now() where id=p_event_id;return jsonb_build_object('status','review');end if;
 if coalesce(p_payment->>'status','') not in ('CONFIRMED','RECEIVED') then update public.billing_webhook_events set status='ignored',reason='Pagamento ainda não confirmado.',processed_at=now() where id=p_event_id;return jsonb_build_object('status','ignored');end if;
 select * into existing from public.payments where asaas_payment_id=p_payment->>'id' for update;
 if found and existing.billing_applied_at is not null then
  if existing.signup_id is distinct from ord.id then raise exception 'payment_signup_mismatch';end if;
  update public.billing_webhook_events set status='processed',processed_at=now() where id=p_event_id;return jsonb_build_object('status','processed','duplicate',true);
 end if;
 if ord.status<>'pending' then problem:='Contratação não está mais pendente. Verifique eventual cobrança adicional.';
 elsif not exists(select 1 from public.portal_users where id=ord.owner_id and status='active' and not access_revoked) then problem:='Titular indisponível.';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('signup:'||ord.documento,0));
 if exists(select 1 from public.companies where regexp_replace(documento,'[^0-9]','','g')=ord.documento) then problem:='Empresa já cadastrada. Verificação administrativa necessária.';end if;
 if problem is not null then update public.billing_signups set status='review' where id=ord.id and status='pending';update public.billing_webhook_events set status='review',reason=problem,processed_at=now() where id=p_event_id;return jsonb_build_object('status','review');end if;
 target:=((((now() at time zone 'America/Sao_Paulo')::date+make_interval(months=>ord.period))::date+1)::timestamp at time zone 'America/Sao_Paulo')-interval '1 millisecond';
 insert into public.companies(nome,documento,codigo_ml,status) values(ord.quote->'company'->>'nome',ord.documento,ord.quote->'company'->>'codigo_ml','active') returning id into cid;
 key:='MLSH-'||upper(replace(gen_random_uuid()::text,'-',''));
 insert into public.licenses(company_id,chave,status,inicio,vencimento) values(cid,key,'active',now(),target) returning id into lid;
 insert into public.portal_user_licenses(user_id,license_id) values(ord.owner_id,lid);
 insert into public.payments(asaas_payment_id,company_id,license_id,valor,status,tipo,evento,billing_applied_at,billing_environment,billing_period_end,signup_id)
 values(p_payment->>'id',cid,lid,ord.expected_total,lower(p_payment->>'status'),p_payment->>'billingType',ev.event,now(),p_environment,target,ord.id);
 update public.billing_signups set status='paid',company_id=cid,license_id=lid,provider_customer_id=p_payment->>'customer',paid_at=now(),asaas_checkout_id=coalesce(asaas_checkout_id,p_payment->>'checkoutSession') where id=ord.id;
 update public.billing_webhook_events set status='processed',processed_at=now() where id=p_event_id;
 return jsonb_build_object('status','processed','license_id',lid,'expires_at',target);
end $$;
revoke all on function public.mlsh_signup_quote(uuid,jsonb,integer),public.mlsh_reserve_signup(uuid,jsonb,integer,uuid,text),public.mlsh_apply_signup_payment(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mlsh_signup_quote(uuid,jsonb,integer),public.mlsh_reserve_signup(uuid,jsonb,integer,uuid,text),public.mlsh_apply_signup_payment(text,text,jsonb) to service_role;
