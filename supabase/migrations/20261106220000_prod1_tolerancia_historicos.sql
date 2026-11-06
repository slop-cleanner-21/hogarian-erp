-- Las OS históricas usan la tolerancia del ítem, como el Excel (06/11/2026). La app no le da tolerancia a una OS, pero el
-- Excel sí: dos OS ya facturadas y pagadas quedaban en S/ 0 y la OS 100560 valía distinto. Las OS nuevas siguen sin tolerancia.

do $$
begin
  perform set_config('app.skip_audit', 'on', true);
  update public.oc_items l
     set tol_fijada = i.tolerancia_pct
    from public.ordenes_compra o, public.partidas p, public.items i
   where o.obra_id = l.obra_id and o.numero = l.numero_oc and p.id = l.partida_id and i.id = p.item_id
     and o.tipo = 'OS' and o.historico and l.precio_fijado_at is not null;
  perform set_config('app.skip_audit', '', true);
end $$;

create or replace function public.fn_oc_item_fijar()
  returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tipo tipo_orden;
  v_estado estado_oc;
  v_historico boolean;
begin
  select tipo, estado, historico into v_tipo, v_estado, v_historico from ordenes_compra where obra_id = new.obra_id and numero = new.numero_oc;
  if v_estado is not null and v_estado <> 'EMITIDA' then
    select now(), p.pu, case when v_tipo = 'OS' and not v_historico then 0 else i.tolerancia_pct end
      into new.precio_fijado_at, new.pu_fijado, new.tol_fijada
      from partidas p join items i on i.id = p.item_id where p.id = new.partida_id;
  end if;
  return new;
end;
$$;

create or replace function public.fn_orden_fijar_precios()
  returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_audit text := coalesce(current_setting('app.skip_audit', true), '');
begin
  -- No es un cambio de nadie: no ensucia la auditoría (el cambio de estado de la orden sí queda).
  perform set_config('app.skip_audit', 'on', true);
  if old.estado = 'EMITIDA' and new.estado <> 'EMITIDA' then
    update oc_items l
       set precio_fijado_at = now(), pu_fijado = p.pu,
           tol_fijada = case when new.tipo = 'OS' and not new.historico then 0 else i.tolerancia_pct end
      from partidas p join items i on i.id = p.item_id
     where l.obra_id = new.obra_id and l.numero_oc = new.numero and p.id = l.partida_id and l.precio_fijado_at is null;
  elsif new.estado = 'EMITIDA' and old.estado <> 'EMITIDA' then
    update oc_items set precio_fijado_at = null, pu_fijado = null, tol_fijada = null
     where obra_id = new.obra_id and numero_oc = new.numero;
  end if;
  perform set_config('app.skip_audit', v_audit, true);
  return null;
end;
$$;

-- Una histórica que vuelve a cotización (rechazo por precios) también conserva su tolerancia.
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
    round(l.cantidad * e.pu_efectivo, 2) AS parcial,
    COALESCE(l.pu_cotizado > fn_pu_max(t.pu, t.tol) AND l.pu_aprobado IS NULL, false) AS sobreprecio
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
     CROSS JOIN LATERAL ( SELECT fn_pu_efectivo(l.pu_cotizado, l.pu_aprobado, t.pu, t.tol) AS pu_efectivo) e;
