-- Prod 1: la retención por garantía de las OS históricas. En el Excel la mano de obra está a su neto (P.U. 10.00 → 9.50). No se
-- tocan el precio ni el parcial, para que comprobantes, pagos y Excel sigan iguales al céntimo: `pu_bruto` guarda el P.U. acordado y
-- lo retenido es la diferencia. Las nuevas no lo usan: su neto sale del %.

alter table public.oc_items add column pu_bruto numeric(12,4);
grant select (pu_bruto) on public.oc_items to authenticated;

create or replace view public.v_oc_items_calc with (security_invoker = true) as
 SELECT l.id,
    l.obra_id,
    l.numero_oc,
    l.partida_id,
    l.cantidad,
    l.pu_cotizado,
    l.pu_aprobado,
    l.aprobado_por,
    l.comprobante_id,
    l.created_at,
    o.estado,
    o.fecha,
    o.tipo,
    o.proveedor_id,
    p.codigo AS partida_codigo,
    p.etapa,
    p.requerimiento,
    p.item_id,
    i.descripcion,
    i.unidad,
    i.rubro,
    i.cuenta_contable,
    i.tipo_material,
    t.tol AS tolerancia_pct,
    t.pu AS pu_partida,
    round(fn_pu_max(t.pu, t.tol), 4) AS pu_max,
    e.pu_efectivo,
    n.parcial,
    COALESCE(l.pu_cotizado > fn_pu_max(t.pu, t.tol) AND l.pu_aprobado IS NULL, false) AS sobreprecio,
    l.ret_garantia_pct,
    round(l.cantidad * COALESCE(l.pu_bruto, e.pu_efectivo), 2) - n.parcial AS retenido,
    l.pu_bruto
   FROM oc_items l
     JOIN ordenes_compra o ON o.obra_id = l.obra_id AND o.numero = l.numero_oc
     JOIN partidas p ON p.id = l.partida_id
     JOIN items i ON i.id = p.item_id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN l.precio_fijado_at IS NOT NULL THEN l.tol_fijada
                    WHEN o.tipo = 'OS'::tipo_orden AND NOT o.historico THEN 0::numeric(6,4)
                    ELSE i.tolerancia_pct
                END AS tol,
                CASE
                    WHEN l.precio_fijado_at IS NOT NULL THEN l.pu_fijado
                    ELSE p.pu
                END AS pu) t
     CROSS JOIN LATERAL ( SELECT fn_pu_efectivo(l.pu_cotizado, l.pu_aprobado, t.pu, t.tol) AS pu_efectivo) e
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN l.pu_bruto IS NOT NULL THEN round(l.cantidad * e.pu_efectivo, 2)
                    ELSE round(l.cantidad * e.pu_efectivo * (1 - l.ret_garantia_pct / 100), 2)
                END AS parcial) n;

-- El último precio de un ítem es el acordado, no el neto de una retención.
create or replace view public.v_oc_items with (security_invoker = true) as
 SELECT c.id,
    c.obra_id,
    c.numero_oc,
    c.partida_id,
    c.cantidad,
    c.pu_cotizado,
    c.pu_aprobado,
    c.aprobado_por,
    c.comprobante_id,
    c.partida_codigo,
    c.etapa,
    c.requerimiento,
    c.item_id,
    c.descripcion,
    c.unidad,
    c.rubro,
    c.pu_partida,
    c.pu_max,
    c.pu_efectivo,
    c.parcial,
        CASE
            WHEN c.sobreprecio THEN 'SOBREPRECIO'::text
            ELSE NULL::text
        END AS alerta,
    c.pu_cotizado - c.pu_partida AS dif,
    h.pu_hist,
    (cp.serie || '-'::text) || cp.numero AS comprobante,
    c.estado,
    c.fecha,
    c.cuenta_contable,
    c.tipo_material,
    c.ret_garantia_pct,
    c.retenido,
    c.pu_bruto
   FROM v_oc_items_calc c
     LEFT JOIN comprobantes cp ON cp.id = c.comprobante_id
     LEFT JOIN LATERAL ( SELECT COALESCE(hh.pu_bruto, hh.pu_efectivo) AS pu_hist
           FROM v_oc_items_calc hh
          WHERE hh.item_id = c.item_id AND hh.estado <> 'ANULADA'::estado_oc AND hh.pu_efectivo IS NOT NULL AND (hh.obra_id IS DISTINCT FROM c.obra_id OR hh.numero_oc IS DISTINCT FROM c.numero_oc)
          ORDER BY hh.fecha DESC, hh.id DESC
         LIMIT 1) h ON true;

-- Marca la retención de las OS históricas. Va como función porque la usan esta migración (datos ya cargados) y el seed (al recargar).
--   · Mano de obra al 95 % del presupuesto: su P.U. acordado es el del presupuesto. El ítem «RETENCION 5%» no: es la devolución.
--   · Excepción: en una obra donde ya se pagó ese ítem, la devolución ya se hizo (a un proveedor por la cuadrilla), así que
--     todas sus OS quedan como devueltas en esa orden: no se vuelven a pagar.
create or replace function public.fn_garantia_historica() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('app.skip_audit', 'on', true);

  update oc_items l set pu_bruto = x.pu_partida, ret_garantia_pct = 5
    from (select c.id, c.pu_partida
            from v_oc_items_calc c join ordenes_compra o on o.obra_id = c.obra_id and o.numero = c.numero_oc
           where o.historico and o.tipo = 'OS' and not o.es_retencion and o.estado <> 'ANULADA'
             and c.rubro = 'MANO OBRA' and c.descripcion not ilike 'RETENCION%'
             and c.pu_bruto is null and c.pu_partida > 0 and c.pu_efectivo > 0
             and round(c.pu_efectivo / c.pu_partida, 4) between 0.9490 and 0.9510) x
   where l.id = x.id;

  update ordenes_compra o set retenida_en = d.numero
    from (select distinct on (c.obra_id) c.obra_id, c.numero_oc as numero
            from v_oc_items_calc c join ordenes_compra r on r.obra_id = c.obra_id and r.numero = c.numero_oc
           where r.historico and c.descripcion ilike 'RETENCION%' and r.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA')
           order by c.obra_id, c.numero_oc) d
   where o.obra_id = d.obra_id and o.numero <> d.numero and o.historico and o.retenida_en is null
     and exists (select 1 from oc_items l where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.pu_bruto is not null);

  perform set_config('app.skip_audit', '', true);
end;
$$;
revoke all on function public.fn_garantia_historica() from public, anon, authenticated;

select public.fn_garantia_historica();
