-- Prod 1: la retención de 4ta se hace al pagar el recibo. Antes se calculaba una sola vez, al registrarlo, con su fecha de
-- emisión: si Logística subía la suspensión después, Tesorería igual descontaba la retención (OS 100356 de RAYMONDI).
-- Ahora, mientras el recibo no tenga pagos (ni asiento), se revisa con la fecha de hoy si la suspensión ya rige: si rige, sin
-- retención; si se quitó, vuelve. Un cambio de % no mueve la retención de un recibo ya registrado. Se revisa:
--   - al guardar o cambiar la suspensión del proveedor (disparador);
--   - al abrir la orden para pagarla (refrescar_retencion_orden), porque la suspensión rige desde el día siguiente;
--   - y una vez ahora, para los recibos que ya esperan su pago.
-- Los históricos (del Excel) no se tocan.

create or replace function public.fn_recalcular_retencion_4ta(p_proveedor_id bigint, p_comprobante_ids bigint[] default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_n integer;
begin
  update comprobantes c
     set retencion = fn_retencion_4ta(c.proveedor_id, c.tipo, greatest(c.fecha_emision, v_hoy), c.total)
   where c.tipo = 'RXH'
     and c.anulado_at is null
     and not c.historico
     and (p_proveedor_id is null or c.proveedor_id = p_proveedor_id)
     and (p_comprobante_ids is null or c.id = any (p_comprobante_ids))
     and not exists (select 1 from pago_aplicaciones a where a.comprobante_id = c.id)
     and not exists (select 1 from asientos s where s.comprobante_id = c.id)
     -- Solo si la suspensión cambia el resultado (con o sin retención), no por otro %.
     and (c.retencion = 0) is distinct from (fn_retencion_4ta(c.proveedor_id, c.tipo, greatest(c.fecha_emision, v_hoy), c.total) = 0);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.fn_recalcular_retencion_4ta(bigint, bigint[]) from public, anon, authenticated;

create or replace function public.fn_proveedor_recalcula_retencion() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform fn_recalcular_retencion_4ta(new.id);
  return null;
end;
$$;
revoke execute on function public.fn_proveedor_recalcula_retencion() from public, anon, authenticated;

create trigger proveedor_recalcula_retencion
  after update of suspension_4ta_fecha, suspension_4ta_path, suspension_4ta_operacion on public.proveedores
  for each row execute function public.fn_proveedor_recalcula_retencion();

-- Al abrir una orden para pagarla (o verla): sus recibos aún sin pagar, con la retención de hoy. Solo recalcula; no deja
-- poner otra.
create or replace function public.refrescar_retencion_orden(p_obra_id bigint, p_numero text) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  perform exigir_rol('TESORERIA', 'LOGISTICA', 'GERENCIA');
  select array_agg(distinct comprobante_id) into v_ids
    from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is not null;
  if v_ids is null then
    return 0;
  end if;
  return fn_recalcular_retencion_4ta(null, v_ids);
end;
$$;
revoke execute on function public.refrescar_retencion_orden(bigint, text) from public, anon;
grant execute on function public.refrescar_retencion_orden(bigint, text) to authenticated, service_role;

-- Los recibos que ya esperan su pago.
select public.fn_recalcular_retencion_4ta(null);
