-- Rechazo de Tesorería con factura nueva: si el proveedor ya facturó, emite nota de crédito y una factura
-- nueva. Al rechazar, Tesorería puede anular las facturas de la orden: quedan registradas (anuladas, con
-- el motivo) y las líneas vuelven a estar sin comprobante para que Logística registre la nueva.
-- Cada rechazo guarda qué comprobantes anuló, para el historial de la orden.

alter table public.comprobantes add column if not exists anulado_at timestamptz;
alter table public.comprobantes add column if not exists anulado_motivo text;
alter table public.rechazos add column if not exists comprobantes_anulados text[];

drop function if exists public.rechazar_documento(bigint, text, bigint, text);
create or replace function public.rechazar_documento(
  p_obra_id bigint, p_numero text, p_orden_pago_id bigint, p_motivo text, p_factura_nueva boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_o ordenes_compra%rowtype;
  v_op ordenes_pago%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_ids bigint[];
  v_anuladas text[];
begin
  perform exigir_rol('TESORERIA');
  if p_orden_pago_id is not null then
    select * into v_op from ordenes_pago where id = p_orden_pago_id for update;
    if not found or v_op.estado <> 'EN_TESORERIA' then
      raise exception 'La orden de pago no está en Tesorería';
    end if;
    update ordenes_pago set estado = 'BORRADOR' where id = p_orden_pago_id;
    insert into rechazos (doc, orden_pago_id, motivo, estado_previo, estado_destino)
    values ('OP', p_orden_pago_id, v_motivo, 'EN_TESORERIA', 'BORRADOR');
    perform notificar('CONTABILIDAD', 'RECHAZO', format('Tesorería rechazó la %s', v_op.numero), v_motivo,
                      format('/contabilidad/op/%s', p_orden_pago_id));
    return;
  end if;

  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found or v_o.estado <> 'EN_TESORERIA' then
    raise exception 'La orden % no está en Tesorería', p_numero;
  end if;

  if p_factura_nueva then
    select array_agg(distinct comprobante_id) into v_ids
      from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is not null;
    if v_ids is null then
      raise exception 'La orden no tiene comprobantes que anular';
    end if;
    if exists (select 1 from pago_aplicaciones where comprobante_id = any (v_ids)) then
      raise exception 'El comprobante ya tiene pagos: no se puede anular';
    end if;
    if exists (select 1 from asientos where comprobante_id = any (v_ids)) then
      raise exception 'El comprobante ya está contabilizado: no se puede anular';
    end if;
    if exists (select 1 from oc_items where comprobante_id = any (v_ids) and (obra_id, numero_oc) <> (p_obra_id, p_numero)) then
      raise exception 'El comprobante también es de otras órdenes: no se puede anular desde esta';
    end if;
    select array_agg(tipo::text || ' ' || serie || '-' || numero order by id) into v_anuladas from comprobantes where id = any (v_ids);
    update oc_items set comprobante_id = null where comprobante_id = any (v_ids);
    update comprobantes set anulado_at = now(), anulado_motivo = coalesce(v_motivo, 'Rechazo de Tesorería') where id = any (v_ids);
  end if;

  -- Vuelve a cotización: los precios quedan registrados para corregirlos. El link se renueva (muestra la
  -- cotización recibida; "Reenviar" lo abre para que el proveedor corrija).
  update ordenes_compra
     set estado = 'EMITIDA', token_cotizacion = gen_random_uuid(),
         cotizacion_estado = case when cotizacion_estado = 'SIN_ENVIAR' then 'SIN_ENVIAR'::cotizacion_estado else 'RECIBIDA'::cotizacion_estado end
   where obra_id = p_obra_id and numero = p_numero;
  insert into rechazos (doc, obra_id, numero, motivo, estado_previo, estado_destino, comprobantes_anulados)
  values (v_o.tipo::text, p_obra_id, p_numero, v_motivo, 'EN_TESORERIA', 'EMITIDA', v_anuladas);
  perform notificar('LOGISTICA', 'RECHAZO',
                    format('Tesorería rechazó la %s %s: %s', v_o.tipo, p_numero,
                           case when v_anuladas is null then 'vuelve a cotización' else 'el proveedor emite factura nueva' end),
                    v_motivo, format('/logistica/ordenes/%s/%s', p_obra_id, p_numero));
end;
$$;
revoke execute on function public.rechazar_documento(bigint, text, bigint, text, boolean) from public, anon;
grant execute on function public.rechazar_documento(bigint, text, bigint, text, boolean) to authenticated;

-- El registro de compras (y el TXT del SIRE) no lleva los comprobantes anulados.
do $$
declare
  v_def text := rtrim(btrim(pg_get_viewdef('public.v_registro_compras'::regclass)), ';');
begin
  if v_def ~* '\mwhere\s+c\.anulado_at' then
    return;
  end if;
  execute format('create or replace view public.v_registro_compras with (security_invoker = on) as %s WHERE c.anulado_at IS NULL', v_def);
end $$;
