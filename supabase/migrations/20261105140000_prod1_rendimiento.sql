-- Auditoría de rendimiento (05/11/2026). Propio de prod 1.

-- ── Seguimiento: v_seguimiento_partida sin fn_orden_etapa por fila ──
-- La función (con SET search_path, no se inlinea) corría por cada partida y reevaluaba la RLS de obra_etapas y
-- etapas: 864 llamadas = ~250 ms como authenticated. Con joins (claves únicas: no duplican filas) y obra_id en
-- el agregado (el filtro por obra llega adentro), las mismas filas en ~40 ms. Mismas columnas, mismo orden.
create or replace view public.v_seguimiento_partida with (security_invoker = true) as
 WITH lineas AS (
         SELECT l.obra_id,
            l.partida_id,
            l.cantidad,
            o.estado,
            o.entrega_cerrada_at,
            COALESCE(( SELECT sum(en.cantidad) AS sum
                   FROM entregas en
                  WHERE (en.oc_item_id = l.id)), (0)::numeric) AS entregado
           FROM (oc_items l
             JOIN ordenes_compra o ON (((o.obra_id = l.obra_id) AND (o.numero = l.numero_oc))))
          WHERE ((o.estado <> ALL (ARRAY['ANULADA'::estado_oc, 'BORRADOR'::estado_oc])) AND (o.valorizacion_id IS NULL) AND (NOT o.es_retencion))
        ), x AS (
         SELECT lineas.obra_id,
            lineas.partida_id,
            sum(
                CASE
                    WHEN (lineas.estado = ANY (ARRAY['EMITIDA'::estado_oc, 'PRECIOS_CONFIRMADOS'::estado_oc, 'FACTURADA'::estado_oc])) THEN lineas.cantidad
                    ELSE (0)::numeric
                END) AS en_logistica,
            sum(
                CASE
                    WHEN (lineas.estado = 'EN_TESORERIA'::estado_oc) THEN lineas.cantidad
                    ELSE (0)::numeric
                END) AS en_tesoreria,
            sum(
                CASE
                    WHEN ((lineas.estado = ANY (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc])) AND (lineas.entrega_cerrada_at IS NULL)) THEN GREATEST((lineas.cantidad - lineas.entregado), (0)::numeric)
                    ELSE (0)::numeric
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
            WHEN (i.rubro = 'MATERIAL'::rubro) THEN 'MATERIALES'::text
            WHEN (i.rubro = 'MANO OBRA'::rubro) THEN 'MANO_OBRA'::text
            ELSE 'SUBCONTRATOS'::text
        END AS grupo,
    p.cantidad AS presupuestado,
    p.pu,
    COALESCE(x.en_logistica, (0)::numeric) AS en_logistica,
    COALESCE(x.en_tesoreria, (0)::numeric) AS en_tesoreria,
    COALESCE(x.por_recibir, (0)::numeric) AS por_recibir,
    COALESCE(x.recibido, (0)::numeric) AS recibido,
    GREATEST(((((ef.efectivo - COALESCE(x.en_logistica, (0)::numeric)) - COALESCE(x.en_tesoreria, (0)::numeric)) - COALESCE(x.por_recibir, (0)::numeric)) - COALESCE(x.recibido, (0)::numeric)), (0)::numeric) AS por_pedir,
    ef.efectivo AS presupuesto_efectivo,
    ef.recibido AS adelanto_recibido,
    ef.dado AS adelanto_dado,
    COALESCE(( SELECT sum(ri.cantidad) AS sum
           FROM (requerimientos_obra_items ri
             JOIN requerimientos_obra rq ON ((rq.id = ri.requerimiento_id)))
          WHERE ((ri.partida_id = p.id) AND (rq.estado = 'VIGENTE'::text))), (0)::numeric) AS requerido,
    COALESCE(oe.orden, 100000 + COALESCE(et.orden, 0)) AS orden_etapa,
    COALESCE(( SELECT sum(a.cantidad) AS sum
           FROM avances a
          WHERE ((a.partida_id = p.id) AND (a.estado = 'REGISTRADO'::text))), (0)::numeric) AS ejecutado_sin_valorizar,
    COALESCE(( SELECT sum(vp.cantidad) AS sum
           FROM ((valorizacion_partidas vp
             JOIN valorizaciones v ON ((v.id = vp.valorizacion_id)))
             LEFT JOIN ordenes_compra o ON (((o.obra_id = v.obra_id) AND (o.numero = v.numero_oc))))
          WHERE ((vp.partida_id = p.id) AND ((o.estado IS NULL) OR (o.estado <> ALL (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc]))))), (0)::numeric) AS valorizado_sin_pagar,
    COALESCE(( SELECT sum(vp.cantidad) AS sum
           FROM ((valorizacion_partidas vp
             JOIN valorizaciones v ON ((v.id = vp.valorizacion_id)))
             JOIN ordenes_compra o ON (((o.obra_id = v.obra_id) AND (o.numero = v.numero_oc))))
          WHERE ((vp.partida_id = p.id) AND (o.estado = ANY (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc])))), (0)::numeric) AS valorizado_pagado,
    COALESCE(( SELECT sum(vp.retencion) AS sum
           FROM valorizacion_partidas vp
          WHERE (vp.partida_id = p.id)), (0)::numeric) AS retencion_acumulada
   FROM (((((partidas p
     JOIN items i ON ((i.id = p.item_id)))
     JOIN v_presupuesto_efectivo ef ON ((ef.partida_id = p.id)))
     LEFT JOIN x ON (((x.partida_id = p.id) AND (x.obra_id = p.obra_id))))
     LEFT JOIN obra_etapas oe ON (((oe.obra_id = p.obra_id) AND (oe.etapa = p.etapa))))
     LEFT JOIN etapas et ON ((et.codigo = p.etapa)))
  WHERE (p.dada_de_baja_at IS NULL);

-- audit_log tenía dos índices iguales en created_at (ASC y DESC): uno sobra (cada escritura los mantiene a los dos).
drop index if exists public.audit_log_creado_idx;

-- ── Gerencia › Obras: el resumen de cada obra en la base ──
-- La lista bajaba todas las partidas (~6000, 6 páginas en serie) para contar y sumar en el navegador del servidor.
create or replace view public.v_resumen_obra with (security_invoker = true) as
  select p.obra_id,
         count(*)::int as partidas,
         coalesce(array_agg(distinct p.requerimiento) filter (where p.requerimiento <> 'REGULAR'), '{}') as adicionales,
         coalesce(sum(p.cantidad * coalesce(p.pu, 0)), 0) as monto
    from public.partidas p
   group by p.obra_id;
grant select on public.v_resumen_obra to authenticated;
