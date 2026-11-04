-- Contabilidad asigna la misma cuenta a varios ítems a la vez (grilla tipo Excel / selección en grupo).
create or replace function public.asignar_cuenta_items(p_ids bigint[], p_cuenta text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from cuentas_contables where codigo = p_cuenta) then
    raise exception 'La cuenta % no existe', p_cuenta;
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Selecciona al menos un ítem';
  end if;
  update items set cuenta_contable = p_cuenta
   where id = any (p_ids) and cuenta_contable is distinct from p_cuenta;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.asignar_cuenta_items(bigint[], text) from public, anon;
grant execute on function public.asignar_cuenta_items(bigint[], text) to authenticated, service_role;
