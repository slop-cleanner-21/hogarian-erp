-- Tesorería recibe un aviso cuando le llega una orden nueva por pagar (antes, solo cuando volvía corregida tras un
-- rechazo) (06/11/2026).
CREATE OR REPLACE FUNCTION public.enviar_a_tesoreria(p_obra_id bigint, p_numero text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_o ordenes_compra%rowtype;
  v_sobre int;
  v_bajo int;
begin
  perform exigir_rol('LOGISTICA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística envía órdenes a Tesorería';
  end if;
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe', p_numero;
  end if;
  if v_o.estado <> 'FACTURADA' then
    raise exception 'La orden % no está lista para enviar (estado %): todas sus líneas deben tener comprobante', p_numero, v_o.estado;
  end if;
  if v_o.tipo = 'OS' and not v_o.es_retencion and not v_o.historico and not exists (
       select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero) then
    raise exception 'Falta el contrato firmado de la OS %', p_numero;
  end if;
  if v_o.tipo = 'OC' and v_o.requiere_guia and not v_o.historico and not exists (
       select 1 from guias where obra_id = p_obra_id and numero_oc = p_numero and estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then
    raise exception 'Falta registrar la guía de remisión de la OC %', p_numero;
  end if;
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = p_obra_id and numero = p_numero;
  update rechazos set reenviado_at = now(), reenviado_by = auth.uid()
   where obra_id = p_obra_id and numero = p_numero and reenviado_at is null;
  if found then
    perform notificar('TESORERIA', 'REENVIO', format('Logística reenvió la %s %s corregida', v_o.tipo, p_numero),
      (select nota_reenvio from rechazos where obra_id = p_obra_id and numero = p_numero order by created_at desc limit 1),
      format('/tesoreria/pago/%s/%s', p_obra_id, p_numero));
  else
    -- Una orden nueva por pagar (la primera vez que llega).
    perform notificar('TESORERIA', 'POR_PAGAR',
      format('Nueva %s %s por pagar · %s', v_o.tipo, p_numero, (select nombre from obras where id = p_obra_id)),
      (select razon_social from proveedores where id = v_o.proveedor_id),
      format('/tesoreria/pago/%s/%s', p_obra_id, p_numero));
  end if;

  if v_o.tipo = 'OS' then
    select count(*) filter (where pu_efectivo > pu_partida + 0.0001), count(*) filter (where pu_efectivo < pu_partida - 0.0001)
      into v_sobre, v_bajo
      from v_oc_items_calc where obra_id = p_obra_id and numero_oc = p_numero;
    if v_sobre + v_bajo > 0 then
      perform notificar('TESORERIA', 'OS_PRECIO',
        format('OS %s con precios distintos al presupuesto', p_numero),
        concat_ws(', ',
          case when v_sobre > 0 then format('%s sobre el presupuesto', v_sobre) end,
          case when v_bajo > 0 then format('%s por debajo (ahorro)', v_bajo) end),
        format('/tesoreria/pago/%s/%s', p_obra_id, p_numero));
    end if;
  end if;
end;
$function$;
