-- Cada ítem se imputa a su cuenta de clase 9 (centro de costo de la obra); el asiento de compra la lleva al Debe
-- y desde ahí salen los amarres a las clases 6 y 7. Una cuenta de otra clase dejaría el gasto sin amarre.
create or replace function public.asignar_cuenta_item(p_item_id bigint, p_cuenta text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cuenta text := nullif(btrim(p_cuenta), '');
begin
  perform exigir_rol('CONTABILIDAD');
  if v_cuenta is not null and not exists (select 1 from cuentas_contables where codigo = v_cuenta) then
    raise exception 'La cuenta contable % no existe', v_cuenta;
  end if;
  if v_cuenta is not null and v_cuenta not like '9%' then
    raise exception 'Los ítems van a una cuenta de clase 9';
  end if;
  update items set cuenta_contable = v_cuenta where id = p_item_id;
  if not found then
    raise exception 'El ítem % no existe', p_item_id;
  end if;
end;
$$;

create or replace function public.asignar_cuenta_items(p_ids bigint[], p_cuenta text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  perform exigir_rol('CONTABILIDAD');
  if not exists (select 1 from cuentas_contables where codigo = p_cuenta) then
    raise exception 'La cuenta % no existe', p_cuenta;
  end if;
  if p_cuenta not like '9%' then
    raise exception 'Los ítems van a una cuenta de clase 9';
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
