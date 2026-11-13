begin;
set local role service_role;
do $$
declare owner_id uuid:=gen_random_uuid(); plan_id uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid();
 v_license_id uuid; first_expiry timestamptz; second_expiry timestamptz; result jsonb;
 checkout_id text:='test_checkout_'||gen_random_uuid(); pay_id text:='test_pay_'||gen_random_uuid();
 sub_id text:='test_sub_'||gen_random_uuid(); value jsonb; event_id text:='test_evt_'||gen_random_uuid();
begin
 insert into public.portal_users(id,nome,email,senha_hash,status) values(owner_id,'Billing integration test',owner_id||'@example.invalid','not-a-login-hash','active');
 insert into public.plans(id,nome,preco,limite_dispositivos,limite_usuarios,duracao_dias) values(plan_id,'test_'||plan_id,100,2,2,30);
 insert into public.checkout_sessions(id,checkout_id,portal_user_id,plan_id,company_name,expected_value,duration_days,environment,nome,email,cpf_cnpj)
 values(session_id,checkout_id,owner_id,plan_id,'TEST COMPANY',100,30,'sandbox','Test',owner_id||'@example.invalid','');
 value:=jsonb_build_object('id',pay_id,'status','CONFIRMED','value',100,'checkoutSession',checkout_id,'customer','test_customer','subscription',sub_id,'billingType','CREDIT_CARD');
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(event_id,'sandbox','PAYMENT_CONFIRMED',pay_id);
 result:=public.mlsh_apply_verified_payment(event_id,'sandbox',value);
 if result->>'status'<>'processed' then raise exception 'First payment failed: %',result; end if;
 v_license_id:=(result->>'license_id')::uuid;
 select vencimento into first_expiry from public.licenses where id=v_license_id;
 if first_expiry<=now() or not exists(select 1 from public.portal_user_licenses where user_id=owner_id and portal_user_licenses.license_id=v_license_id) then raise exception 'Entitlement not linked'; end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(event_id||'_received','sandbox','PAYMENT_RECEIVED',pay_id);
 result:=public.mlsh_apply_verified_payment(event_id||'_received','sandbox',value||'{"status":"RECEIVED"}'::jsonb);
 if (select vencimento from public.licenses where id=v_license_id)<>first_expiry or result->>'duplicate'<>'true' then raise exception 'Duplicate extended license'; end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(event_id||'_next','sandbox','PAYMENT_RECEIVED',pay_id||'_next');
 result:=public.mlsh_apply_verified_payment(event_id||'_next','sandbox',(value-'checkoutSession')||jsonb_build_object('id',pay_id||'_next','status','RECEIVED'));
 select vencimento into second_expiry from public.licenses where id=v_license_id;
 if result->>'status'<>'processed' or second_expiry<=first_expiry then raise exception 'Recurring renewal failed'; end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(event_id||'_wrong','sandbox','PAYMENT_RECEIVED',pay_id||'_wrong');
 result:=public.mlsh_apply_verified_payment(event_id||'_wrong','sandbox',value||jsonb_build_object('id',pay_id||'_wrong','value',1));
 if result->>'status'<>'review' or (select vencimento from public.licenses where id=v_license_id)<>second_expiry then raise exception 'Wrong amount accepted'; end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(event_id||'_refund','sandbox','PAYMENT_REFUNDED',pay_id);
 result:=public.mlsh_apply_verified_payment(event_id||'_refund','sandbox',value||'{"status":"REFUNDED"}'::jsonb);
 if result->>'status'<>'review' then raise exception 'Refund review missing'; end if;
 insert into public.billing_webhook_events(id,environment,event,payment_id) values(event_id||'_unknown','sandbox','PAYMENT_RECEIVED',pay_id||'_unknown');
 result:=public.mlsh_apply_verified_payment(event_id||'_unknown','sandbox',jsonb_build_object('id',pay_id||'_unknown','status','RECEIVED','value',100));
 if result->>'status'<>'ignored' then raise exception 'Unlinked payment accepted'; end if;
 if (select count(*) from public.payments where payments.license_id=v_license_id)<>2 then raise exception 'Payment count mismatch'; end if;
 if has_function_privilege('anon','public.mlsh_apply_verified_payment(text,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.mlsh_apply_verified_payment(text,text,jsonb)','EXECUTE') then raise exception 'RPC accessible to clients'; end if;
end $$;
rollback;
