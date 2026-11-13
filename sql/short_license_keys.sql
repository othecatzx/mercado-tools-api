create function public.mlsh_license_key() returns text language plpgsql volatile security invoker set search_path='' as $$
declare result text:='MLSH-'; bytes bytea; n integer; i integer;
begin
 while length(result)<18 loop
  bytes:=extensions.gen_random_bytes(16);
  for i in 0..15 loop
   n:=get_byte(bytes,i);
   if n<250 then result:=result||(n%10)::text;end if;
   exit when length(result)=18;
  end loop;
 end loop;
 return result;
end $$;
create function public.mlsh_issue_license(p_company uuid,p_start timestamptz,p_expiry timestamptz,p_plan uuid,p_subscription text)
returns public.licenses language plpgsql volatile security invoker set search_path='' as $$
declare issued public.licenses; attempt integer;
begin
 for attempt in 1..20 loop
  insert into public.licenses(company_id,chave,status,inicio,vencimento,plan_id,asaas_subscription_id)
  values(p_company,public.mlsh_license_key(),'active',p_start,p_expiry,p_plan,p_subscription)
  on conflict(chave) do nothing returning * into issued;
  if found then return issued;end if;
 end loop;
 raise exception 'license_key_generation_unavailable';
end $$;
revoke all on function public.mlsh_license_key(),public.mlsh_issue_license(uuid,timestamptz,timestamptz,uuid,text) from public,anon,authenticated;
grant execute on function public.mlsh_license_key(),public.mlsh_issue_license(uuid,timestamptz,timestamptz,uuid,text) to service_role;
do $patch$
declare source text; old text;
begin
 select pg_get_functiondef('public.mlsh_apply_signup_payment(text,text,jsonb)'::regprocedure) into source;
 old:=$old$ key:='MLSH-'||upper(replace(gen_random_uuid()::text,'-',''));
 insert into public.licenses(company_id,chave,status,inicio,vencimento) values(cid,key,'active',now(),target) returning id into lid;$old$;
 if strpos(source,old)=0 then raise exception 'Unexpected signup generator';end if;
 execute replace(source,old,' select id into lid from public.mlsh_issue_license(cid,now(),target,null,null);');
 select pg_get_functiondef('public.mlsh_apply_verified_payment(text,text,jsonb)'::regprocedure) into source;
 old:=$old$  insert into public.licenses(company_id,chave,status,plan_id,vencimento,asaas_subscription_id)
   values(session.company_id,'MLSH-'||replace(gen_random_uuid()::text,'-',''),'active',session.plan_id,expiry,v_subscription_id) returning * into lic;$old$;
 if strpos(source,old)=0 then raise exception 'Unexpected legacy generator';end if;
 execute replace(source,old,'  select * into lic from public.mlsh_issue_license(session.company_id,now(),expiry,session.plan_id,v_subscription_id);');
end $patch$;
