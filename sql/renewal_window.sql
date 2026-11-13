create or replace function public.mlsh_batch_quote(p_owner uuid,p_ids uuid[],p_period integer)
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
 if anchor>today+15 then raise exception 'renewal_too_early'; end if;
 target:=(anchor+make_interval(months=>p_period))::date;reference_days:=target-anchor;
 select jsonb_agg(jsonb_build_object('license_id',l.id,'company_id',c.id,'company_name',c.nome,'base_expiry',l.vencimento,
  'days',target-greatest(today,(l.vencimento at time zone 'America/Sao_Paulo')::date),
  'amount',round(price*(target-greatest(today,(l.vencimento at time zone 'America/Sao_Paulo')::date))/reference_days,2)) order by l.id) into items
 from public.licenses l join public.companies c on c.id=l.company_id where l.id=any(p_ids);
 return jsonb_build_object('product',product.name,'version',product.version,'period',p_period,'period_price',price,'anchor_date',anchor,'target_date',target,'reference_days',reference_days,'items',items,'total',(select sum((x->>'amount')::numeric) from jsonb_array_elements(items) x));
end $$;
