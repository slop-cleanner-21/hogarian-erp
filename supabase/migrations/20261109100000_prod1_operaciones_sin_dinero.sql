-- Prod 1: Operaciones (Jefe e Ingeniero) no ve nada de dinero ni contable: ni en pantalla ni por la API.
--   · Ya no lee las tablas con precios, montos o datos contables: órdenes y sus líneas, partidas (P.U.), ítems (tolerancia y cuenta
--     contable), proveedores, parámetros, adjuntos (facturas, vouchers) ni valorizaciones.
--   · Su seguimiento lo lee de dos vistas que corren con los permisos de su dueño (no del que consulta) y que filtran por rol:
--     v_seguimiento_partida (cantidades, sin P.U. ni retención para Operaciones) y v_entregas_partida (lo que llegó, por partida).

create or replace view public.v_seguimiento_partida with (security_invoker = false) as
WITH lineas AS (
         SELECT l.obra_id,
            l.partida_id,
            l.cantidad,
            o.estado,
            o.entrega_cerrada_at,
            COALESCE(( SELECT sum(en.cantidad) AS sum
                   FROM entregas en
                  WHERE en.oc_item_id = l.id), 0::numeric) AS entregado
           FROM oc_items l
             JOIN ordenes_compra o ON o.obra_id = l.obra_id AND o.numero = l.numero_oc
          WHERE (o.estado <> ALL (ARRAY['ANULADA'::estado_oc, 'BORRADOR'::estado_oc])) AND o.valorizacion_id IS NULL AND NOT o.es_retencion
        ), x AS (
         SELECT lineas.obra_id,
            lineas.partida_id,
            sum(
                CASE
                    WHEN lineas.estado = ANY (ARRAY['EMITIDA'::estado_oc, 'PRECIOS_CONFIRMADOS'::estado_oc, 'FACTURADA'::estado_oc]) THEN lineas.cantidad
                    ELSE 0::numeric
                END) AS en_logistica,
            sum(
                CASE
                    WHEN lineas.estado = 'EN_TESORERIA'::estado_oc THEN lineas.cantidad
                    ELSE 0::numeric
                END) AS en_tesoreria,
            sum(
                CASE
                    WHEN (lineas.estado = ANY (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc])) AND lineas.entrega_cerrada_at IS NULL THEN GREATEST(lineas.cantidad - lineas.entregado, 0::numeric)
                    ELSE 0::numeric
                END) AS por_recibir,
            sum(lineas.entregado) AS recibido
           FROM lineas
          GROUP BY lineas.obra_id, lineas.partida_id
        )
 SELECT p.id AS partida_id,
    p.obra_id,
    p.etapa,
    p.requerimiento,
    p.item_id,
    i.descripcion,
    i.unidad,
    i.rubro,
        CASE
            WHEN i.rubro = 'MATERIAL'::rubro THEN 'MATERIALES'::text
            WHEN i.rubro = 'MANO OBRA'::rubro THEN 'MANO_OBRA'::text
            ELSE 'SUBCONTRATOS'::text
        END AS grupo,
    p.cantidad AS presupuestado,
    (CASE WHEN (SELECT rol_actual()) = 'JEFE_OPERACIONES' THEN NULL ELSE p.pu END)::numeric(12,4) AS pu,
    COALESCE(x.en_logistica, 0::numeric) AS en_logistica,
    COALESCE(x.en_tesoreria, 0::numeric) AS en_tesoreria,
    COALESCE(x.por_recibir, 0::numeric) AS por_recibir,
    COALESCE(x.recibido, 0::numeric) AS recibido,
    GREATEST(ef.efectivo - COALESCE(x.en_logistica, 0::numeric) - COALESCE(x.en_tesoreria, 0::numeric) - COALESCE(x.por_recibir, 0::numeric) - COALESCE(x.recibido, 0::numeric), 0::numeric) AS por_pedir,
    ef.efectivo AS presupuesto_efectivo,
    ef.recibido AS adelanto_recibido,
    ef.dado AS adelanto_dado,
    COALESCE(( SELECT sum(ri.cantidad) AS sum
           FROM requerimientos_obra_items ri
             JOIN requerimientos_obra rq ON rq.id = ri.requerimiento_id
          WHERE ri.partida_id = p.id AND rq.estado = 'VIGENTE'::text), 0::numeric) AS requerido,
    COALESCE(oe.orden, 100000 + COALESCE(et.orden, 0)) AS orden_etapa,
    COALESCE(( SELECT sum(a.cantidad) AS sum
           FROM avances a
          WHERE a.partida_id = p.id AND a.estado = 'REGISTRADO'::text), 0::numeric) AS ejecutado_sin_valorizar,
    COALESCE(( SELECT sum(vp.cantidad) AS sum
           FROM valorizacion_partidas vp
             JOIN valorizaciones v ON v.id = vp.valorizacion_id
             LEFT JOIN ordenes_compra o ON o.obra_id = v.obra_id AND o.numero = v.numero_oc
          WHERE vp.partida_id = p.id AND (o.estado IS NULL OR (o.estado <> ALL (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc])))), 0::numeric) AS valorizado_sin_pagar,
    COALESCE(( SELECT sum(vp.cantidad) AS sum
           FROM valorizacion_partidas vp
             JOIN valorizaciones v ON v.id = vp.valorizacion_id
             JOIN ordenes_compra o ON o.obra_id = v.obra_id AND o.numero = v.numero_oc
          WHERE vp.partida_id = p.id AND (o.estado = ANY (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc]))), 0::numeric) AS valorizado_pagado,
    CASE WHEN (SELECT rol_actual()) = 'JEFE_OPERACIONES' THEN 0::numeric ELSE COALESCE(( SELECT sum(vp.retencion) AS sum
           FROM valorizacion_partidas vp
          WHERE vp.partida_id = p.id), 0::numeric) END AS retencion_acumulada
   FROM partidas p
     JOIN items i ON i.id = p.item_id
     -- Como v_presupuesto_efectivo, pero dentro: esa vista corre con los permisos de quien consulta.
     CROSS JOIN LATERAL ( SELECT COALESCE(( SELECT sum(a.cantidad) AS sum
                   FROM adelantos a
                     JOIN requerimientos_obra q ON q.id = a.requerimiento_id
                  WHERE a.partida_destino_id = p.id AND q.estado = 'VIGENTE'::text), 0::numeric) AS recibido,
            COALESCE(( SELECT sum(a.cantidad) AS sum
                   FROM adelantos a
                     JOIN requerimientos_obra q ON q.id = a.requerimiento_id
                  WHERE a.partida_origen_id = p.id AND q.estado = 'VIGENTE'::text), 0::numeric) AS dado) ad
     CROSS JOIN LATERAL ( SELECT p.cantidad + ad.recibido - ad.dado AS efectivo, ad.recibido, ad.dado) ef
     LEFT JOIN x ON x.partida_id = p.id AND x.obra_id = p.obra_id
     LEFT JOIN obra_etapas oe ON oe.obra_id = p.obra_id AND oe.etapa = p.etapa
     LEFT JOIN etapas et ON et.codigo = p.etapa
  WHERE p.dada_de_baja_at IS NULL
    AND (SELECT rol_actual()) = ANY (ARRAY['LOGISTICA', 'TESORERIA', 'GERENCIA', 'JEFE_OPERACIONES', 'ADMIN']);
revoke all on public.v_seguimiento_partida from anon;
grant select on public.v_seguimiento_partida to authenticated;

create or replace view public.v_entregas_partida with (security_invoker = false) as
select e.id, e.obra_id, l.partida_id, e.cantidad, e.created_at, e.rol, e.observacion
  from public.entregas e
  join public.oc_items l on l.id = e.oc_item_id
 where (select public.rol_actual()) = any (array['LOGISTICA', 'TESORERIA', 'GERENCIA', 'JEFE_OPERACIONES', 'ADMIN']);
revoke all on public.v_entregas_partida from anon;
grant select on public.v_entregas_partida to authenticated;

do $m$
declare t text;
begin
  foreach t in array array['oc_items', 'ordenes_compra', 'partidas', 'items', 'proveedores', 'proveedor_contactos', 'proveedor_cuentas',
                           'proveedor_tipos_material', 'parametros', 'adjuntos', 'valorizaciones', 'valorizacion_partidas', 'adelantos'] loop
    execute format('drop policy if exists operaciones_sin_dinero on public.%I', t);
    execute format('create policy operaciones_sin_dinero on public.%I as restrictive for select to authenticated
                      using ((select public.rol_actual()) is distinct from %L)', t, 'JEFE_OPERACIONES');
  end loop;
end;
$m$;
