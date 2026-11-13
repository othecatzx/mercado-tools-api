alter table public.checkout_sessions
 add column portal_user_id uuid references public.portal_users(id),
 add column company_name text,
 add column company_id uuid references public.companies(id),
 add column license_id uuid references public.licenses(id),
 add column expected_value numeric(12,2),
 add column duration_days integer check(duration_days>0),
 add column environment text check(environment in ('sandbox','production')),
 add column checkout_url text,
 add column request_key uuid,
 add column creation_error text;
create unique index checkout_owner_request_key on public.checkout_sessions(portal_user_id,request_key);
create unique index checkout_one_pending_license on public.checkout_sessions(license_id) where license_id is not null and status='pending';
create unique index if not exists checkout_pending_company on public.checkout_sessions(portal_user_id,lower(trim(company_name))) where license_id is null and status='pending';
create index checkout_owner_created on public.checkout_sessions(portal_user_id,created_at desc);
create unique index checkout_subscription_unique on public.checkout_sessions(asaas_subscription_id) where asaas_subscription_id is not null;
alter table public.payments add column billing_applied_at timestamptz,add column billing_environment text,add column billing_period_end timestamptz;
create table public.billing_runtime (
 environment text primary key check(environment in ('sandbox','production')),
 enabled boolean not null default false,
 webhook_token_hash text,
 updated_at timestamptz not null default now()
);
insert into public.billing_runtime(environment) values('sandbox'),('production');
create table public.billing_webhook_events (
 id text primary key,
 environment text not null check(environment in ('sandbox','production')),
 event text not null,
 payment_id text,
 resource_id text,
 status text not null default 'received' check(status in ('received','processed','ignored','review')),
 reason text,
 checkout_session_id uuid references public.checkout_sessions(id),
 created_at timestamptz not null default now(),
 processed_at timestamptz
);
create index billing_events_state on public.billing_webhook_events(status,created_at desc);
alter table public.billing_runtime enable row level security;
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_runtime,public.billing_webhook_events from public,anon,authenticated;
grant all on public.billing_runtime,public.billing_webhook_events to service_role;

-- Aceita somente dados da cobrança recuperados na API do provedor pelo backend.
-- Chamada de serviço exclusiva: não exposta aos JWTs próprios dos clientes.
create function public.mlsh_apply_verified_payment(p_event_id text,p_environment text,p_payment jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ev public.billing_webhook_events; session public.checkout_sessions; lic public.licenses; pay public.payments;
 owner public.portal_users; payment_id text:=p_payment->>'id';
 payment_status text:=upper(coalesce(p_payment->>'status','')); customer_id text:=p_payment->>'customer';
 v_subscription_id text:=nullif(p_payment->>'subscription',''); v_checkout_id text:=nullif(p_payment->>'checkoutSession','');
 reference text:=coalesce(p_payment->>'externalReference',''); paid_value numeric; expiry timestamptz; issue text;
begin
 select * into ev from public.billing_webhook_events where id=p_event_id and environment=p_environment for update;
 if not found then raise exception 'Event not persisted'; end if;
 if ev.status in ('processed','ignored','review') then return jsonb_build_object('status',ev.status,'duplicate',true); end if;
 if ev.payment_id is distinct from payment_id then raise exception 'Payment identity mismatch'; end if;
 select * into session from public.checkout_sessions c where c.environment=p_environment and
  ((v_checkout_id is not null and c.checkout_id=v_checkout_id) or
   (reference='mlsh_'||c.id::text) or
   (v_subscription_id is not null and c.asaas_subscription_id=v_subscription_id))
 order by c.created_at limit 1 for update;
 if not found or session.portal_user_id is null then
  update public.billing_webhook_events set status='ignored',reason='Cobrança sem checkout vinculado ao portal.',processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','ignored');
 end if;
 update public.billing_webhook_events set checkout_session_id=session.id where id=p_event_id;
 if session.checkout_id='pending_'||session.id::text and reference='mlsh_'||session.id::text and v_checkout_id is not null then
  update public.checkout_sessions set checkout_id=p_payment->>'checkoutSession' where id=session.id;
  session.checkout_id:=v_checkout_id;
 end if;
 paid_value:=round((p_payment->>'value')::numeric,2);
 select * into owner from public.portal_users where id=session.portal_user_id;
 if owner.status is distinct from 'active' or coalesce(owner.access_revoked,true) then issue:='Titular indisponível.';
 elsif session.expected_value is null or session.duration_days is null then issue:='Checkout sem preço ou duração registrados.';
 elsif paid_value is null or paid_value<>session.expected_value then issue:='Valor diferente do preço contratado.';
 elsif v_checkout_id is not null and v_checkout_id<>session.checkout_id then issue:='Checkout divergente.';
 elsif session.asaas_customer_id is not null and customer_id is distinct from session.asaas_customer_id then issue:='Cliente do provedor divergente.';
 elsif session.asaas_subscription_id is not null and v_subscription_id is distinct from session.asaas_subscription_id then issue:='Assinatura divergente.';
 elsif ev.event in ('PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_REFUND_IN_PROGRESS') or payment_status in ('REFUNDED','REFUND_REQUESTED','REFUND_IN_PROGRESS','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE','AWAITING_CHARGEBACK_REVERSAL') then issue:='Estorno ou contestação requer revisão administrativa.';
 end if;
 if issue is not null then
  update public.billing_webhook_events set status='review',reason=issue,processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','review','reason',issue);
 end if;
 if payment_status not in ('CONFIRMED','RECEIVED') then
  update public.billing_webhook_events set status='ignored',reason='Cobrança ainda não confirmada.',processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','ignored');
 end if;
 -- Uma única sessão trava as confirmações concorrentes da mesma assinatura.
 select * into pay from public.payments where asaas_payment_id=payment_id for update;
 if found and pay.billing_applied_at is not null then
  if pay.billing_environment is distinct from p_environment or pay.license_id is distinct from session.license_id then raise exception 'Payment already belongs to another license'; end if;
  update public.payments set status=lower(payment_status),evento=ev.event,updated_at=now() where id=pay.id;
  update public.billing_webhook_events set status='processed',processed_at=now() where id=p_event_id;
  return jsonb_build_object('status','processed','duplicate',true,'license_id',pay.license_id);
 end if;
 if session.license_id is not null then
  select l.* into lic from public.licenses l join public.portal_user_licenses ul on ul.license_id=l.id
   where l.id=session.license_id and ul.user_id=session.portal_user_id for update of l;
  if not found or lic.status='blocked' or lic.vencimento is null or
   not exists(select 1 from public.companies where id=lic.company_id and status='active') then
   update public.billing_webhook_events set status='review',reason='Licença bloqueada, permanente ou sem vínculo ativo.',processed_at=now() where id=p_event_id;
   return jsonb_build_object('status','review');
  end if;
  if lic.plan_id is not null and lic.plan_id<>session.plan_id then
   update public.billing_webhook_events set status='review',reason='Troca de plano exige revisão administrativa.',processed_at=now() where id=p_event_id;
   return jsonb_build_object('status','review');
  end if;
  expiry:=greatest(now(),lic.vencimento)+case when v_subscription_id is not null then interval '1 month' else make_interval(days=>session.duration_days) end;
  update public.licenses set vencimento=expiry,status='active',plan_id=session.plan_id,
   asaas_subscription_id=coalesce(v_subscription_id,asaas_subscription_id),updated_at=now() where id=lic.id returning * into lic;
 else
  if session.company_name is null or length(trim(session.company_name))<2 then raise exception 'Company name required'; end if;
  insert into public.companies(nome,documento,status) values(session.company_name,nullif(session.cpf_cnpj,''),'active') returning id into session.company_id;
  expiry:=now()+case when v_subscription_id is not null then interval '1 month' else make_interval(days=>session.duration_days) end;
  insert into public.licenses(company_id,chave,status,plan_id,vencimento,asaas_subscription_id)
   values(session.company_id,'MLSH-'||replace(gen_random_uuid()::text,'-',''),'active',session.plan_id,expiry,v_subscription_id) returning * into lic;
  insert into public.portal_user_licenses(user_id,license_id) values(session.portal_user_id,lic.id);
 end if;
 insert into public.payments(company_id,license_id,plan_id,asaas_payment_id,asaas_subscription_id,valor,status,tipo,evento,billing_applied_at,billing_environment,billing_period_end)
 values(lic.company_id,lic.id,session.plan_id,payment_id,v_subscription_id,paid_value,lower(payment_status),p_payment->>'billingType',ev.event,now(),p_environment,expiry)
 on conflict(asaas_payment_id) do update set company_id=excluded.company_id,license_id=excluded.license_id,plan_id=excluded.plan_id,
  asaas_subscription_id=excluded.asaas_subscription_id,valor=excluded.valor,status=excluded.status,tipo=excluded.tipo,evento=excluded.evento,
  billing_applied_at=excluded.billing_applied_at,billing_environment=excluded.billing_environment,billing_period_end=excluded.billing_period_end,updated_at=now();
 update public.checkout_sessions set company_id=lic.company_id,license_id=lic.id,status='paid',asaas_customer_id=customer_id,
  asaas_subscription_id=coalesce(v_subscription_id,asaas_subscription_id),updated_at=now() where id=session.id;
 update public.billing_webhook_events set status='processed',processed_at=now() where id=p_event_id;
 return jsonb_build_object('status','processed','license_id',lic.id,'expires_at',expiry);
end $$;
revoke all on function public.mlsh_apply_verified_payment(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.mlsh_apply_verified_payment(text,text,jsonb) to service_role;
