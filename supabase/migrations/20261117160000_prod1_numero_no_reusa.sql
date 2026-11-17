-- La serie de una empresa no vuelve a dar un N° que una orden dejó al cambiar de número (`ordenes_renumeradas`): sus links
-- viejos redirigen a esa orden, y una orden nueva con ese N° los capturaría. Caso: la OS de Raymondi pasó de 100361 a 100368 y
-- volvió a 100361 (su recibo por honorarios ya citaba la OS 100361); el 100368 quedó libre y era el siguiente de Ariant.

create or replace function public.siguiente_numero_oc(p_obra_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_emp bigint;
  v_n bigint;
begin
  select empresa_id into v_emp from obras where id = p_obra_id;
  if v_emp is null then
    return '100001';
  end if;
  -- Serializa la numeración de la empresa (se suelta al terminar la transacción que crea la orden).
  perform pg_advisory_xact_lock(hashtext('numero_orden'), v_emp::integer);
  with nums as (
    select distinct o.numero::bigint as n
      from ordenes_compra o join obras b on b.id = o.obra_id
     where b.empresa_id = v_emp and o.numero ~ '^\d{6}$'
  ), s as (
    select n, lead(n) over (order by n) as sig from nums
  )
  select min(n) into v_n from s where sig is null or sig - n > 100;
  v_n := coalesce(v_n, 100000) + 1;
  -- Se saltan los que ya existen en la empresa (anuladas incluidas) y los que una orden dejó al cambiar de N°.
  while exists (select 1 from ordenes_compra o join obras b on b.id = o.obra_id
                 where b.empresa_id = v_emp and o.numero = v_n::text)
     or exists (select 1 from ordenes_renumeradas r join obras b on b.id = r.obra_id
                 where b.empresa_id = v_emp and r.anterior = v_n::text) loop
    v_n := v_n + 1;
  end loop;
  return v_n::text;
end;
$$;
revoke execute on function public.siguiente_numero_oc(bigint) from public, anon;
grant execute on function public.siguiente_numero_oc(bigint) to authenticated, service_role;
