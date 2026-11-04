-- Tesorería filtra los documentos por pagar por etapa de obra (etapas de sus líneas).
create or replace view public.v_por_pagar with (security_invoker = true) as
WITH lin AS (
         SELECT c.obra_id,
            c.numero_oc,
            COALESCE(sum(COALESCE(c.parcial, 0::numeric)) FILTER (WHERE c.comprobante_id IS NULL), 0::numeric) AS sin_comp,
            bool_or(c.comprobante_id IS NULL) AS falta,
            array_agg(DISTINCT c.etapa) AS etapas
           FROM v_oc_items_calc c
          GROUP BY c.obra_id, c.numero_oc
        ), cp AS (
         SELECT x.obra_id,
            x.numero_oc,
            count(*) AS n,
            sum(x.neto_orden) AS neto,
            sum(x.saldo_orden) AS saldo
           FROM v_orden_comprobantes x
          GROUP BY x.obra_id, x.numero_oc
        ), dir AS (
         SELECT ap.obra_id,
            ap.numero_oc,
            sum(ap.monto) AS pagado
           FROM pago_aplicaciones ap
          WHERE ap.obra_id IS NOT NULL
          GROUP BY ap.obra_id, ap.numero_oc
        ), ctr AS (
         SELECT DISTINCT a.obra_id,
            a.numero_oc
           FROM adjuntos a
          WHERE a.tipo = 'CONTRATO'::tipo_adjunto
        ), ord AS (
         SELECT o.obra_id,
            o.numero,
            o.tipo,
            o.proveedor_id,
            o.fecha,
            o.estado,
            o.token_cotizacion,
            o.motivo_anulacion,
            o.created_by,
            o.updated_by,
            o.created_at,
            o.updated_at,
            COALESCE(cp.neto, 0::numeric) + COALESCE(lin.sin_comp, 0::numeric) AS total,
            GREATEST(0::numeric, COALESCE(cp.saldo, 0::numeric) + COALESCE(lin.sin_comp, 0::numeric) - COALESCE(dir.pagado, 0::numeric)) AS saldo,
            COALESCE(cp.n, 0::bigint)::integer AS n_comprobantes,
            ctr.obra_id IS NOT NULL AS tiene_contrato,
            COALESCE(lin.falta, false) AS falta_comprobante,
            lin.etapas
           FROM ordenes_compra o
             LEFT JOIN lin ON lin.obra_id = o.obra_id AND lin.numero_oc = o.numero
             LEFT JOIN cp ON cp.obra_id = o.obra_id AND cp.numero_oc = o.numero
             LEFT JOIN dir ON dir.obra_id = o.obra_id AND dir.numero_oc = o.numero
             LEFT JOIN ctr ON ctr.obra_id = o.obra_id AND ctr.numero_oc = o.numero
          WHERE o.estado = ANY (ARRAY['EN_TESORERIA'::estado_oc, 'PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc])
        )
 SELECT o.tipo::text AS doc,
    o.obra_id,
    o.numero,
    NULL::bigint AS orden_pago_id,
    ob.empresa_id,
    e.nombre AS empresa,
    ob.nombre AS obra,
    o.proveedor_id,
    pr.razon_social AS proveedor,
    pr.ruc_o_cod AS ruc,
    pr.banco,
    pr.cuenta_bancaria,
    o.fecha,
    o.total,
    o.total - o.saldo AS pagado,
    o.saldo,
    o.n_comprobantes,
    o.tiene_contrato,
    o.falta_comprobante,
        CASE
            WHEN o.estado = 'EN_TESORERIA'::estado_oc AND o.saldo > 0.005 THEN 'PENDIENTE'::text
            ELSE 'PAGADO'::text
        END AS estado,
    o.etapas
   FROM ord o
     JOIN obras ob ON ob.id = o.obra_id
     JOIN empresas e ON e.id = ob.empresa_id
     JOIN proveedores pr ON pr.id = o.proveedor_id
  WHERE o.estado <> 'EN_TESORERIA'::estado_oc OR o.saldo > 0.005 OR o.total > 0.005
UNION ALL
 SELECT 'OP'::text AS doc,
    op.obra_id,
    op.numero,
    op.id AS orden_pago_id,
    ob.empresa_id,
    e.nombre AS empresa,
    ob.nombre AS obra,
    op.proveedor_id,
    pr.razon_social AS proveedor,
    pr.ruc_o_cod AS ruc,
    pr.banco,
    pr.cuenta_bancaria,
    op.fecha,
    op.monto AS total,
    COALESCE(pa.pagado, 0::numeric) AS pagado,
    GREATEST(0::numeric, op.monto - COALESCE(pa.pagado, 0::numeric)) AS saldo,
    0 AS n_comprobantes,
    false AS tiene_contrato,
    false AS falta_comprobante,
        CASE
            WHEN op.estado = 'PAGADA'::text THEN 'PAGADO'::text
            ELSE 'PENDIENTE'::text
        END AS estado,
    NULL::text[] AS etapas
   FROM ordenes_pago op
     JOIN obras ob ON ob.id = op.obra_id
     JOIN empresas e ON e.id = ob.empresa_id
     JOIN proveedores pr ON pr.id = op.proveedor_id
     LEFT JOIN ( SELECT ap.orden_pago_id,
            sum(ap.monto) AS pagado
           FROM pago_aplicaciones ap
          WHERE ap.orden_pago_id IS NOT NULL
          GROUP BY ap.orden_pago_id) pa ON pa.orden_pago_id = op.id
  WHERE op.estado = ANY (ARRAY['EN_TESORERIA'::text, 'PAGADA'::text]);;
