-- Prod 1: el link del proveedor vence 15 días después del pago y, mientras vale, muestra sus pagos con el voucher y
-- (en una OS) el contrato. Solo para ver: nada se sube desde el link.

-- Cuándo se pagó la orden (el último pago aplicado a ella o a sus comprobantes).
create or replace function public.link_pagada_at(p_obra bigint, p_numero text)
  returns timestamptz language sql stable security definer set search_path = public, pg_temp
as $$
  select max(p.created_at)
    from pagos p
    join pago_aplicaciones a on a.pago_id = p.id
   where (a.obra_id = p_obra and a.numero_oc = p_numero)
      or a.comprobante_id in (select l.comprobante_id from oc_items l
                               where l.obra_id = p_obra and l.numero_oc = p_numero and l.comprobante_id is not null)
$$;

-- La orden de un link, si todavía vale: cotizando (con el link compartido), con precios confirmados o en pago, y
-- pagada hasta 15 días después del pago. Anulada, en borrador o vencida: nada.
create or replace function public.link_vigente(p_token uuid)
  returns ordenes_compra language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v ordenes_compra%rowtype;
  v_pagado timestamptz;
begin
  select * into v from ordenes_compra where token_cotizacion = p_token;
  if not found or v.cotizacion_estado = 'SIN_ENVIAR'
     or v.estado not in ('EMITIDA', 'PRECIOS_CONFIRMADOS', 'FACTURADA', 'EN_TESORERIA', 'PAGADA', 'EN_ENTREGA', 'RECIBIDA') then
    return null;
  end if;
  if v.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA') then
    v_pagado := link_pagada_at(v.obra_id, v.numero);
    if v_pagado is null or v_pagado + interval '15 days' < now() then
      return null;
    end if;
  end if;
  return v;
end;
$$;

revoke execute on function public.link_pagada_at(bigint, text), public.link_vigente(uuid) from public, anon, authenticated;

create or replace function public.get_cotizacion(p_token uuid)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
  v_orden boolean;
  v_pagado timestamptz;
  v jsonb;
begin
  perform fn_cotizacion_limite(p_token);
  v_o := link_vigente(p_token);
  if v_o.obra_id is null then
    insert into cotizacion_accesos (token, accion, ok) values (p_token, 'VER', false);
    return jsonb_build_object('disponible', false);
  end if;
  insert into cotizacion_accesos (token, obra_id, numero, accion, ok) values (p_token, v_o.obra_id, v_o.numero, 'VER', true);
  v_orden := v_o.estado <> 'EMITIDA';
  v_pagado := case when v_o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA') then link_pagada_at(v_o.obra_id, v_o.numero) end;

  -- Lo que el proveedor ve de su orden: los ítems con sus precios, sus descuentos, sus pagos (con el voucher) y el
  -- contrato de la OS. Nada del presupuesto, de la revisión interna ni de otras órdenes.
  with comps as (
    select distinct c.id, c.retencion, c.detraccion
      from comprobantes c
      join oc_items l on l.comprobante_id = c.id
     where l.obra_id = v_o.obra_id and l.numero_oc = v_o.numero and c.anulado_at is null
  ), apl as (
    select distinct a.id, a.pago_id, a.monto
      from pago_aplicaciones a
     where (a.obra_id = v_o.obra_id and a.numero_oc = v_o.numero) or a.comprobante_id in (select id from comps)
  )
  select jsonb_build_object(
           'disponible', true,
           'modo', case when v_orden then 'orden' else 'cotizar' end,
           'estado', case
             when v_o.estado in ('PRECIOS_CONFIRMADOS', 'FACTURADA') then 'CONFIRMADA'
             when v_o.estado = 'EN_TESORERIA' then 'EN_PAGO'
             when v_o.estado = 'PAGADA' then 'PAGADA'
             when v_o.estado in ('EN_ENTREGA', 'RECIBIDA') then 'ENVIADA'
             else null end,
           'vence', case when v_pagado is not null then ((v_pagado + interval '15 days') at time zone 'America/Lima')::date end,
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
                      -- Cotizando: solo los precios que mandó el proveedor. En la orden: el precio confirmado.
                      'pu_cotizado', case when v_orden then l.pu_efectivo when v_o.cotizacion_estado = 'RECIBIDA' then l.pu_cotizado end)
                    order by l.id)
               from v_oc_items_calc l
              where l.obra_id = v_o.obra_id and l.numero_oc = v_o.numero), '[]'::jsonb),
           'retencion', case when v_orden then (select coalesce(sum(retencion), 0) from comps) end,
           'detraccion', case when v_orden then (select coalesce(sum(detraccion), 0) from comps) end,
           'pagos', case when v_orden then coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', p.id,
                      'fecha', p.fecha,
                      'monto', x.monto,
                      'banco', p.banco,
                      'operacion', p.numero_operacion,
                      'vouchers', coalesce((select jsonb_agg(ad.id order by ad.id) from adjuntos ad where ad.pago_id = p.id and ad.tipo = 'VOUCHER'), '[]'::jsonb))
                    order by p.fecha, p.id)
               from (select pago_id, sum(monto) monto from apl group by pago_id) x
               join pagos p on p.id = x.pago_id), '[]'::jsonb) end,
           -- OS (no la de retención ni de valorización): el contrato, firmado si Logística ya lo subió.
           'contrato', case when v_orden and v_o.tipo = 'OS' and not v_o.es_retencion and v_o.valorizacion_id is null then
             jsonb_build_object('firmado', exists (select 1 from adjuntos ad where ad.tipo = 'CONTRATO' and ad.obra_id = v_o.obra_id and ad.numero_oc = v_o.numero))
           end)
    into v
    from obras ob
    join empresas e on e.id = ob.empresa_id
    join proveedores pr on pr.id = v_o.proveedor_id
   where ob.id = v_o.obra_id;
  return v;
end;
$$;

-- Un archivo del link (el voucher de uno de sus pagos o el contrato firmado de la OS): su ruta en Storage, si el
-- link vale. Solo la llama el servidor (clave secreta), que lo entrega sin mostrar el almacenamiento.
alter table public.cotizacion_accesos drop constraint if exists cotizacion_accesos_accion_check;
alter table public.cotizacion_accesos add constraint cotizacion_accesos_accion_check check (accion in ('VER', 'ENVIAR', 'ARCHIVO'));

create or replace function public.archivo_link(p_token uuid, p_tipo text, p_id bigint)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
  v_path text;
begin
  perform fn_cotizacion_limite(p_token);
  v_o := link_vigente(p_token);
  if v_o.obra_id is null or v_o.estado = 'EMITIDA' then
    insert into cotizacion_accesos (token, accion, ok) values (p_token, 'ARCHIVO', false);
    return null;
  end if;
  if p_tipo = 'VOUCHER' then
    select ad.path into v_path
      from adjuntos ad
     where ad.id = p_id and ad.tipo = 'VOUCHER'
       and ad.pago_id in (select a.pago_id from pago_aplicaciones a
                           where (a.obra_id = v_o.obra_id and a.numero_oc = v_o.numero)
                              or a.comprobante_id in (select l.comprobante_id from oc_items l
                                                       where l.obra_id = v_o.obra_id and l.numero_oc = v_o.numero and l.comprobante_id is not null));
  elsif p_tipo = 'CONTRATO' and v_o.tipo = 'OS' then
    select ad.path into v_path from adjuntos ad
     where ad.tipo = 'CONTRATO' and ad.obra_id = v_o.obra_id and ad.numero_oc = v_o.numero
     order by ad.created_at desc limit 1;
  end if;
  insert into cotizacion_accesos (token, obra_id, numero, accion, ok) values (p_token, v_o.obra_id, v_o.numero, 'ARCHIVO', true);
  return jsonb_build_object('obra_id', v_o.obra_id, 'numero', v_o.numero, 'tipo', v_o.tipo, 'path', v_path);
end;
$$;
revoke execute on function public.archivo_link(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.archivo_link(uuid, text, bigint) to service_role;
