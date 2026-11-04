-- Prod 1: el proveedor vuelve a su mismo link y ve su orden de compra (o de servicio) con los precios confirmados.
-- Antes el link se anulaba al confirmar los precios («Este link ya no está disponible»). Ahora el token dura hasta
-- que se anula la orden; cotizar sigue pudiéndose solo mientras está «Cotizando» (enviar_cotizacion lo exige).

create or replace function public.fn_vencer_cotizacion()
  returns trigger language plpgsql
as $$
begin
  if new.estado = 'ANULADA' and old.estado <> 'ANULADA' then
    new.token_cotizacion := null;
  end if;
  return new;
end;
$$;

create or replace function public.get_cotizacion(p_token uuid)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
  v_orden boolean;
  v jsonb;
begin
  perform fn_cotizacion_limite(p_token);
  select * into v_o from ordenes_compra where token_cotizacion = p_token;
  -- Cotizando (link compartido) o ya con precios confirmados: la orden. Borrador, anulada o sin compartir: nada.
  v_orden := found and v_o.estado in ('PRECIOS_CONFIRMADOS', 'FACTURADA', 'EN_TESORERIA', 'PAGADA', 'EN_ENTREGA', 'RECIBIDA');
  if not found or (v_o.estado <> 'EMITIDA' and not v_orden) or v_o.cotizacion_estado = 'SIN_ENVIAR' then
    insert into cotizacion_accesos (token, accion, ok) values (p_token, 'VER', false);
    return jsonb_build_object('disponible', false);
  end if;
  insert into cotizacion_accesos (token, obra_id, numero, accion, ok) values (p_token, v_o.obra_id, v_o.numero, 'VER', true);

  select jsonb_build_object(
           'disponible', true,
           'modo', case when v_orden then 'orden' else 'cotizar' end,
           -- Lo que ve el proveedor de su orden: confirmada, en pago, pagada o enviada.
           'estado', case
             when v_o.estado in ('PRECIOS_CONFIRMADOS', 'FACTURADA') then 'CONFIRMADA'
             when v_o.estado = 'EN_TESORERIA' then 'EN_PAGO'
             when v_o.estado = 'PAGADA' then 'PAGADA'
             when v_o.estado in ('EN_ENTREGA', 'RECIBIDA') then 'ENVIADA'
             else null end,
           'numero', v_o.numero,
           'tipo', v_o.tipo,
           'obra', ob.nombre,
           'empresa', e.nombre,
           'empresa_ruc', e.ruc,
           'proveedor', pr.razon_social,
           'fecha', v_o.fecha,
           'cotizacion_estado', v_o.cotizacion_estado,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', l.id,
                      'descripcion', l.descripcion,
                      'unidad', l.unidad,
                      'cantidad', l.cantidad,
                      -- Cotizando: solo los precios que mandó el proveedor (el de presupuesto no se le muestra).
                      -- En la orden: el precio confirmado.
                      'pu_cotizado', case when v_orden then l.pu_efectivo when v_o.cotizacion_estado = 'RECIBIDA' then l.pu_cotizado end)
                    order by l.id)
               from v_oc_items_calc l
              where l.obra_id = v_o.obra_id and l.numero_oc = v_o.numero), '[]'::jsonb))
    into v
    from obras ob
    join empresas e on e.id = ob.empresa_id
    join proveedores pr on pr.id = v_o.proveedor_id
   where ob.id = v_o.obra_id;
  return v;
end;
$$;
