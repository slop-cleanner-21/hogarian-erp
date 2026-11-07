-- Prod 1: correcciones de la revisión de la retención por garantía.
--   · La OS de retenciones no cuenta como precio de un ítem: su P.U. es un monto, no un precio.
--   · Su monto no se cambia: es lo retenido, al céntimo (un rechazo por precios la devuelve a cotización).
--   · Una OS histórica con `pu_bruto` que vuelve a cotización pasa a llevar su retención como una nueva (P.U. al 100 % y el %): si no,
--     al cambiarle el precio, lo retenido sería la diferencia contra un P.U. que ya no vale.

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
    l.pu_bruto,
    o.es_retencion,
    o.retenida_en
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
          WHERE hh.item_id = c.item_id AND hh.estado <> 'ANULADA'::estado_oc AND hh.pu_efectivo IS NOT NULL AND NOT hh.es_retencion AND (hh.obra_id IS DISTINCT FROM c.obra_id OR hh.numero_oc IS DISTINCT FROM c.numero_oc)
          ORDER BY hh.fecha DESC, hh.id DESC
         LIMIT 1) h ON true;

create or replace view public.v_precio_historico_item with (security_invoker = true) as
 SELECT item_id,
    (array_agg(COALESCE(pu_bruto, pu_efectivo) ORDER BY fecha DESC, id DESC))[1] AS ultimo_pu,
    max(fecha) AS ultima_fecha,
    round(avg(COALESCE(pu_bruto, pu_efectivo)), 4) AS pu_promedio,
    min(COALESCE(pu_bruto, pu_efectivo)) AS pu_min,
    max(COALESCE(pu_bruto, pu_efectivo)) AS pu_max_hist,
    count(*) AS n_compras
   FROM v_oc_items_calc c
  WHERE estado <> 'ANULADA'::estado_oc AND pu_efectivo IS NOT NULL AND NOT es_retencion
  GROUP BY item_id;

create or replace function public.fn_retencion_monto_fijo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from ordenes_compra o where o.obra_id = new.obra_id and o.numero = new.numero_oc and o.es_retencion) then
    raise exception 'El monto de una OS de retenciones no se cambia';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_retencion_monto_fijo() from public, anon, authenticated;
create trigger oc_item_retencion_fija before update of cantidad, pu_cotizado, pu_aprobado on public.oc_items
  for each row
  when (new.cantidad is distinct from old.cantidad or new.pu_cotizado is distinct from old.pu_cotizado or new.pu_aprobado is distinct from old.pu_aprobado)
  execute function public.fn_retencion_monto_fijo();

create or replace function public.fn_soltar_pu_bruto() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update oc_items
     set pu_cotizado = pu_bruto, pu_aprobado = case when pu_aprobado is not null then pu_bruto end, pu_bruto = null
   where obra_id = new.obra_id and numero_oc = new.numero and pu_bruto is not null;
  return null;
end;
$$;
revoke all on function public.fn_soltar_pu_bruto() from public, anon, authenticated;
create trigger orden_soltar_pu_bruto after update of estado on public.ordenes_compra
  for each row when (new.estado = 'EMITIDA' and old.estado <> 'EMITIDA')
  execute function public.fn_soltar_pu_bruto();
