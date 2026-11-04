-- Contrato de la OS (decisión de los product owners, 29/10/2026):
--   * Al confirmar precios de una OS se arma la glosa del recibo por honorarios (editable).
--   * Logística genera el contrato (100 % del monto), lo envía al proveedor con la glosa y sube el
--     contrato firmado. Sin contrato firmado la OS no pasa a Tesorería.
--   * La OS nace con el precio del presupuesto: Logística solo confirma.

alter table public.ordenes_compra
  add column glosa_rhe text,
  add column contrato_enviado_at timestamptz;

create or replace function public.glosa_rhe_defecto(p_obra_id bigint, p_numero text)
returns text
language sql
stable
set search_path = public
as $$
  select format('Servicio de %s en la obra %s, según OS %s de %s',
                lower(string_agg(i.descripcion, ', ' order by l.id)), ob.nombre, o.numero, e.nombre)
    from ordenes_compra o
    join obras ob on ob.id = o.obra_id
    join empresas e on e.id = ob.empresa_id
    join oc_items l on l.obra_id = o.obra_id and l.numero_oc = o.numero
    join partidas p on p.id = l.partida_id
    join items i on i.id = p.item_id
   where o.obra_id = p_obra_id and o.numero = p_numero
   group by ob.nombre, o.numero, e.nombre;
$$;

CREATE OR REPLACE FUNCTION public.crear_orden(p_obra_id bigint, p_numero text, p_proveedor_id bigint, p_tipo tipo_orden, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_numero text;
  v_p record;
  r record;
  v_comp numeric;
begin
  if not exists (select 1 from obras where id = p_obra_id) then
    raise exception 'La obra % no existe', p_obra_id;
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id) then
    raise exception 'El proveedor % no existe', p_proveedor_id;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La orden debe tener al menos un ítem';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) x(partida_id bigint, cantidad numeric)
              where x.partida_id is null or x.cantidad is null or x.cantidad <= 0) then
    raise exception 'Cada ítem requiere partida_id y una cantidad mayor que cero';
  end if;

  v_numero := nullif(btrim(p_numero), '');
  if v_numero is null then
    v_numero := siguiente_numero_oc(p_obra_id);
  end if;
  if exists (select 1 from ordenes_compra where obra_id = p_obra_id and numero = v_numero) then
    raise exception 'Ya existe la orden % en esta obra', v_numero;
  end if;

  -- valida saldo de cada partida (bloqueadas en orden de id para evitar deadlocks)
  for r in
    select x.partida_id, sum(x.cantidad) as cantidad
      from jsonb_to_recordset(p_items) x(partida_id bigint, cantidad numeric)
     group by x.partida_id
     order by x.partida_id
  loop
    select p.obra_id, p.cantidad, p.codigo into v_p
      from partidas p where p.id = r.partida_id for update;
    if not found then
      raise exception 'La partida % no existe', r.partida_id;
    end if;
    if v_p.obra_id <> p_obra_id then
      raise exception 'La partida % no pertenece a la obra de la orden', v_p.codigo;
    end if;
    -- Si la entrega de una orden se cerró incompleta, lo que no llegó vuelve al saldo.
    select coalesce(sum(case when o.entrega_cerrada_at is null then l.cantidad
                             else coalesce((select sum(en.cantidad) from entregas en where en.oc_item_id = l.id), 0) end), 0) into v_comp
      from oc_items l
      join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
     where l.partida_id = r.partida_id
       and o.estado not in ('ANULADA', 'BORRADOR');
    if r.cantidad > v_p.cantidad - v_comp then
      raise exception 'La cantidad solicitada (%) de la partida % excede su saldo disponible (%)',
        trim_scale(r.cantidad), v_p.codigo, trim_scale(v_p.cantidad - v_comp);
    end if;
  end loop;

  insert into ordenes_compra (obra_id, numero, tipo, proveedor_id, fecha, estado)
  values (p_obra_id, v_numero, coalesce(p_tipo, 'OC'), p_proveedor_id, current_date, 'EMITIDA');

  -- En la OS el precio de partida es el del presupuesto: Logística solo confirma lo que no cambie.
  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado)
  select p_obra_id, v_numero, x.partida_id, x.cantidad, case when coalesce(p_tipo, 'OC') = 'OS' then p.pu end
    from rows from (jsonb_to_recordset(p_items) as (partida_id bigint, cantidad numeric))
         with ordinality as x(partida_id, cantidad, n)
    join partidas p on p.id = x.partida_id
   order by x.n;

  return v_numero;
exception
  when unique_violation then
    raise exception 'Ya existe la orden % en esta obra', v_numero;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_precios(p_obra_id bigint, p_numero text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_estado estado_oc;
  v_n int;
  v_sin int;
  v_sobre int;
begin
  select estado into v_estado from ordenes_compra
   where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe en la obra', p_numero;
  end if;
  if v_estado <> 'EMITIDA' then
    raise exception 'Solo se pueden confirmar precios de órdenes EMITIDAS (la orden % está %)', p_numero, v_estado;
  end if;
  select count(*), count(*) filter (where pu_cotizado is null), count(*) filter (where sobreprecio)
    into v_n, v_sin, v_sobre
    from v_oc_items_calc where obra_id = p_obra_id and numero_oc = p_numero;
  if v_n = 0 then
    raise exception 'La orden % no tiene ítems', p_numero;
  end if;
  if v_sin > 0 then
    raise exception 'Faltan precios en % ítem(s) de la orden %', v_sin, p_numero;
  end if;
  if v_sobre > 0 then
    raise exception '% ítem(s) de la orden % superan el precio máximo y no tienen sobreprecio aprobado', v_sobre, p_numero;
  end if;
  -- Si vuelve de un rechazo con su comprobante ya registrado, pasa directo a "Por enviar".
  update ordenes_compra
     set estado = case when exists (select 1 from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is null)
                       then 'PRECIOS_CONFIRMADOS'::estado_oc else 'FACTURADA'::estado_oc end
   where obra_id = p_obra_id and numero = p_numero;
  -- OS: glosa por defecto del recibo por honorarios (va en el contrato y se envía al proveedor).
  update ordenes_compra set glosa_rhe = glosa_rhe_defecto(p_obra_id, p_numero)
   where obra_id = p_obra_id and numero = p_numero and tipo = 'OS' and glosa_rhe is null;
end;
$function$;

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
  if v_o.tipo = 'OS' and not exists (
       select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero) then
    raise exception 'Falta el contrato firmado de la OS %', p_numero;
  end if;
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = p_obra_id and numero = p_numero;

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

CREATE OR REPLACE FUNCTION public.get_cotizacion(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_o ordenes_compra%rowtype;
  v jsonb;
begin
  perform fn_cotizacion_limite(p_token);
  select * into v_o from ordenes_compra where token_cotizacion = p_token;
  if not found or v_o.estado <> 'EMITIDA' or v_o.cotizacion_estado = 'SIN_ENVIAR' then
    insert into cotizacion_accesos (token, accion, ok) values (p_token, 'VER', false);
    return jsonb_build_object('disponible', false);
  end if;
  insert into cotizacion_accesos (token, obra_id, numero, accion, ok) values (p_token, v_o.obra_id, v_o.numero, 'VER', true);

  select jsonb_build_object(
           'disponible', true,
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
                      'descripcion', i.descripcion,
                      'unidad', i.unidad,
                      'cantidad', l.cantidad,
                      -- Solo los precios que mandó el proveedor: el de presupuesto (OS) no se le muestra.
                      'pu_cotizado', case when v_o.cotizacion_estado = 'RECIBIDA' then l.pu_cotizado end) order by l.id)
               from oc_items l
               join partidas p on p.id = l.partida_id
               join items i on i.id = p.item_id
              where l.obra_id = v_o.obra_id and l.numero_oc = v_o.numero), '[]'::jsonb))
    into v
    from obras ob
    join empresas e on e.id = ob.empresa_id
    join proveedores pr on pr.id = v_o.proveedor_id
   where ob.id = v_o.obra_id;
  return v;
end;
$function$;

create or replace function public.guardar_glosa_rhe(p_obra_id bigint, p_numero text, p_glosa text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(mi_rol(), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística edita la glosa del recibo';
  end if;
  if nullif(btrim(p_glosa), '') is null then
    raise exception 'La glosa no puede quedar vacía';
  end if;
  update ordenes_compra set glosa_rhe = btrim(p_glosa)
   where obra_id = p_obra_id and numero = p_numero and tipo = 'OS'
     and estado in ('PRECIOS_CONFIRMADOS', 'FACTURADA');
  if not found then
    raise exception 'La glosa solo se edita en una OS por facturar o por enviar';
  end if;
end;
$$;

create or replace function public.enviar_contrato(p_obra_id bigint, p_numero text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(mi_rol(), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística envía el contrato';
  end if;
  update ordenes_compra set contrato_enviado_at = now()
   where obra_id = p_obra_id and numero = p_numero and tipo = 'OS' and estado not in ('EMITIDA', 'ANULADA', 'BORRADOR');
  if not found then
    raise exception 'El contrato se envía después de confirmar los precios de la OS';
  end if;
end;
$$;

grant execute on function public.glosa_rhe_defecto(bigint, text) to authenticated;
grant execute on function public.guardar_glosa_rhe(bigint, text, text) to authenticated;
grant execute on function public.enviar_contrato(bigint, text) to authenticated;

-- OS ya emitidas sin precio: el del presupuesto.
update public.oc_items l
   set pu_cotizado = p.pu
  from public.partidas p, public.ordenes_compra o
 where p.id = l.partida_id
   and o.obra_id = l.obra_id and o.numero = l.numero_oc
   and o.tipo = 'OS' and o.estado = 'EMITIDA' and l.pu_cotizado is null;

-- OS con precios ya confirmados: su glosa por defecto.
update public.ordenes_compra o
   set glosa_rhe = public.glosa_rhe_defecto(o.obra_id, o.numero)
 where o.tipo = 'OS' and o.estado not in ('EMITIDA', 'BORRADOR', 'ANULADA') and o.glosa_rhe is null;

create or replace view public.v_ordenes with (security_invoker = true) as
SELECT o.obra_id,
    o.numero,
    ob.nombre AS obra,
    ob.empresa_id,
    e.nombre AS empresa,
    e.ruc AS empresa_ruc,
    o.proveedor_id,
    pr.razon_social AS proveedor,
    pr.ruc_o_cod AS proveedor_ruc,
    o.tipo,
    o.fecha,
    o.estado,
    o.token_cotizacion,
    COALESCE(t.n_items, (0)::bigint) AS n_items,
    COALESCE(t.total, (0)::numeric) AS total,
    COALESCE(t.facturado, (0)::numeric) AS facturado,
    round((COALESCE(t.pagado_cpe, (0)::numeric) + COALESCE(d.pagado, (0)::numeric)), 2) AS pagado,
    COALESCE(t.has_alertas, false) AS has_alertas,
    o.created_at,
    o.motivo_anulacion,
    o.updated_at,
    ( SELECT array_agg(DISTINCT p.etapa) AS array_agg
           FROM (oc_items l
             JOIN partidas p ON ((p.id = l.partida_id)))
          WHERE ((l.obra_id = o.obra_id) AND (l.numero_oc = o.numero))) AS etapas,
    ( SELECT array_agg(DISTINCT i.tipo_material) FILTER (WHERE (i.tipo_material IS NOT NULL)) AS array_agg
           FROM ((oc_items l
             JOIN partidas p ON ((p.id = l.partida_id)))
             JOIN items i ON ((i.id = p.item_id)))
          WHERE ((l.obra_id = o.obra_id) AND (l.numero_oc = o.numero))) AS tipos_material,
    o.glosa_rhe,
    o.contrato_enviado_at
   FROM (((((ordenes_compra o
     JOIN obras ob ON ((ob.id = o.obra_id)))
     JOIN empresas e ON ((e.id = ob.empresa_id)))
     JOIN proveedores pr ON ((pr.id = o.proveedor_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS n_items,
            sum(COALESCE(c.parcial, (0)::numeric)) AS total,
            sum(COALESCE(c.parcial, (0)::numeric)) FILTER (WHERE (c.comprobante_id IS NOT NULL)) AS facturado,
            sum((COALESCE(c.parcial, (0)::numeric) * COALESCE(f.factor, (0)::numeric))) AS pagado_cpe,
            bool_or(c.sobreprecio) AS has_alertas
           FROM (v_oc_items_calc c
             LEFT JOIN LATERAL ( SELECT
                        CASE
                            WHEN ((cp.total - cp.retencion) > (0)::numeric) THEN LEAST((1)::numeric, (COALESCE(sum(ap.monto), (0)::numeric) / (cp.total - cp.retencion)))
                            ELSE (1)::numeric
                        END AS factor
                   FROM (comprobantes cp
                     LEFT JOIN pago_aplicaciones ap ON ((ap.comprobante_id = cp.id)))
                  WHERE (cp.id = c.comprobante_id)
                  GROUP BY cp.id) f ON (true))
          WHERE ((c.obra_id = o.obra_id) AND (c.numero_oc = o.numero))) t ON (true))
     LEFT JOIN LATERAL ( SELECT sum(ap.monto) AS pagado
           FROM pago_aplicaciones ap
          WHERE ((ap.obra_id = o.obra_id) AND (ap.numero_oc = o.numero))) d ON (true));
