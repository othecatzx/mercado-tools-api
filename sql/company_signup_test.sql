begin;
set local role service_role;
do $$
<<signup_test>>
declare owner uuid:=gen_random_uuid(); company jsonb; q jsonb; r jsonb; ord public.billing_signups; lid uuid; cid uuid; pay jsonb; e text:='signup_test_'||gen_random_uuid(); pid text:='pay_test_'||gen_random_uuid(); k uuid:=gen_random_uuid(); actual text; expiry timestamptz;
begin
 insert into public.portal_users(id,nome,email,senha_hash,status) values(owner,'Signup test',owner||'@example.invalid','disabled','active');
 company:=jsonb_build_object('nome','EMPRESA TESTE TRANSACAO','documento',substring(replace(gen_random_uuid()::text,'-','') from 1 for 14),'codigo_ml','TEST-ML');
 company:=company||jsonb_build_object('documento',lpad((floor(random()*90000000000000)+10000000000000)::bigint::text,14,'0'));
 q:=public.mlsh_signup_quote(owner,company,1);
 r:=public.mlsh_reserve_signup(owner,company,1,k,'sandbox');select * into ord from public.billing_signups where id=(r->'order'->>'id')::uuid;
 if ord.license_id is not null or exists(select 1 from public.companies where documento=ord.documento) then raise exception 'Created company/license before payment';end if;
 if public.mlsh_reserve_signup(owner,company,1,k,'sandbox')->>'created'<>'false' then raise exception 'Duplicate reservation';end if;
 begin perform public.mlsh_reserve_signup(owner,company,1,gen_random_uuid(),'sandbox');raise exception 'Duplicate document allowed';exception when others then if sqlerrm not like '%signup_already_pending%' then raise;end if;end;
 pay:=jsonb_build_object('id',pid,'value',ord.expected_total,'status','PENDING','externalReference','mlsh_signup_'||ord.id,'checkoutSession','test_checkout_'||ord.id,'customer','test_customer','billingType','CREDIT_CARD');
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(e||'_pending','sandbox','PAYMENT_CREATED',pid);
 perform public.mlsh_apply_signup_payment(e||'_pending','sandbox',pay);
 if (select license_id from public.billing_signups where id=ord.id) is not null then raise exception 'Pending generated license';end if;
 pay:=pay||jsonb_build_object('status','CONFIRMED');
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(e||'_wrong','sandbox','PAYMENT_CONFIRMED',pid);
 r:=public.mlsh_apply_signup_payment(e||'_wrong','sandbox',pay||jsonb_build_object('value',0.01));if r->>'status'<>'review' then raise exception 'Wrong price accepted';end if;
 if exists(select 1 from public.companies where documento=ord.documento) then raise exception 'Company created with wrong amount';end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(e,'sandbox','PAYMENT_CONFIRMED',pid);
 r:=public.mlsh_apply_signup_payment(e,'sandbox',pay);if r->>'status'<>'processed' then raise exception 'Fulfillment failed: %',r;end if;
 select license_id,company_id into lid,cid from public.billing_signups where id=ord.id;
 if lid is null or cid is null or not exists(select 1 from public.portal_user_licenses where user_id=owner and license_id=lid) then raise exception 'Ownership not linked';end if;
 select chave,vencimento into actual,expiry from public.licenses where id=lid;
 if actual !~ '^MLSH-[A-F0-9]{32}$' then raise exception 'Invalid license key';end if;
 if (expiry at time zone 'America/Sao_Paulo')::date<>((now() at time zone 'America/Sao_Paulo')::date+interval '1 month')::date then raise exception 'Wrong first license validity';end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(e||'_duplicate','sandbox','PAYMENT_RECEIVED',pid);
 r:=public.mlsh_apply_signup_payment(e||'_duplicate','sandbox',pay);
 if r->>'duplicate'<>'true' or (select count(*) from public.payments where signup_id=ord.id)<>1 or (select vencimento from public.licenses where id=lid)<>expiry then raise exception 'Double fulfillment';end if;
 if (select count(*) from public.companies where documento=ord.documento)<>1 then raise exception 'Duplicate company';end if;
 begin perform public.mlsh_signup_quote(owner,company,6);raise exception 'Existing company allowed';exception when others then if sqlerrm not like '%company_already_registered%' then raise;end if;end;
 if has_function_privilege('anon','public.mlsh_apply_signup_payment(text,text,jsonb)','execute') or has_function_privilege('authenticated','public.mlsh_reserve_signup(uuid,jsonb,integer,uuid,text)','execute') then raise exception 'Public signup function';end if;
end $$;
rollback;
