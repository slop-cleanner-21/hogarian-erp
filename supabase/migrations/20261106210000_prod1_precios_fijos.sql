-- Cambiar el presupuesto no mueve una orden con precios aprobados (06/11/2026). Antes cada línea se comparaba en vivo con el
-- P.U. de la partida: si Gerencia lo bajaba por debajo de lo cotizado, una orden ya pagada perdía esa línea y bajaba su total.
--   · En cotización (EMITIDA) la orden sigue al presupuesto.
--   · Desde que se aprueban los precios queda fijo con qué presupuesto y tolerancia se comparó; si Tesorería la rechaza por
--     precios y vuelve a cotización, vuelve a seguirlo.
--   · En los dos casos Logística recibe un aviso en esa orden.

alter table public.oc_items
  add column precio_fijado_at timestamptz,
  add column pu_fijado numeric(12, 4),
  add column tol_fijada numeric(6, 4);

-- Las órdenes ya aprobadas: con el presupuesto de hoy (sus totales no cambian).
do $$
begin
  perform set_config('app.skip_audit', 'on', true);
  update public.oc_items l
     set precio_fijado_at = now(), pu_fijado = p.pu,
         tol_fijada = case when o.tipo = 'OS' then 0 else i.tolerancia_pct end
    from public.ordenes_compra o, public.partidas p, public.items i
   where o.obra_id = l.obra_id and o.numero = l.numero_oc and p.id = l.partida_id and i.id = p.item_id
     and o.estado <> 'EMITIDA';
  perform set_config('app.skip_audit', '', true);
end $$;

-- Una línea agregada a una orden ya aprobada (las cargas del Excel entran así) nace fija.
create or replace function public.fn_oc_item_fijar()
  returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tipo tipo_orden;
  v_estado estado_oc;
begin
  select tipo, estado into v_tipo, v_estado from ordenes_compra where obra_id = new.obra_id and numero = new.numero_oc;
  if v_estado is not null and v_estado <> 'EMITIDA' then
    select now(), p.pu, case when v_tipo = 'OS' then 0 else i.tolerancia_pct end
      into new.precio_fijado_at, new.pu_fijado, new.tol_fijada
      from partidas p join items i on i.id = p.item_id where p.id = new.partida_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_oc_item_fijar() from public, anon, authenticated;
create trigger oc_item_fijar before insert on public.oc_items for each row execute function public.fn_oc_item_fijar();

-- Al aprobarse los precios se fija; al volver a cotización se suelta. Va en la base: cubre todos los caminos.
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
           tol_fijada = case when new.tipo = 'OS' then 0 else i.tolerancia_pct end
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
revoke execute on function public.fn_orden_fijar_precios() from public, anon, authenticated;
create trigger orden_fijar_precios after update of estado on public.ordenes_compra
  for each row when (old.estado is distinct from new.estado) execute function public.fn_orden_fijar_precios();

-- El cálculo de cada línea: con lo fijado o, en cotización, con el presupuesto de hoy.
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
                    WHEN o.tipo = 'OS'::tipo_orden THEN 0::numeric(6,4)
                    ELSE i.tolerancia_pct
                END AS tol,
                CASE
                    WHEN l.precio_fijado_at IS NOT NULL THEN l.pu_fijado
                    ELSE p.pu
                END AS pu) t
     CROSS JOIN LATERAL ( SELECT fn_pu_efectivo(l.pu_cotizado, l.pu_aprobado, t.pu, t.tol) AS pu_efectivo) e;

-- Gerencia cambia un P.U.: Logística recibe un aviso en cada orden con esa partida (uno por orden, con lo que cambió).
create or replace function public.guardar_partidas(p_obra_id bigint, p_partidas jsonb, p_eliminar bigint[])
  returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rol text := rol_actual();
  v_estado text;
  r record;
  v_comprado numeric;
  v_n integer := 0;
  v_antes numeric;
  v_cambios jsonb := '{}'::jsonb;
  v_o record;
begin
  select presupuesto_estado into v_estado from obras where id = p_obra_id for update;
  if not found then
    raise exception 'La obra no existe';
  end if;
  if v_rol not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia carga y modifica el presupuesto';
  end if;

  -- Bajas: solo partidas sin órdenes.
  if p_eliminar is not null and cardinality(p_eliminar) > 0 then
    if exists (select 1 from oc_items where partida_id = any (p_eliminar)) then
      raise exception 'No se puede quitar una partida que ya tiene órdenes';
    end if;
    if exists (select 1 from requerimientos_obra_items where partida_id = any (p_eliminar))
       or exists (select 1 from adelantos where partida_origen_id = any (p_eliminar) or partida_destino_id = any (p_eliminar)) then
      raise exception 'No se puede quitar una partida que ya tiene requerimientos o adelantos';
    end if;
    delete from partidas where obra_id = p_obra_id and id = any (p_eliminar);
    get diagnostics v_n = row_count;
  end if;

  for r in select * from jsonb_to_recordset(coalesce(p_partidas, '[]'::jsonb))
                        x(id bigint, etapa text, requerimiento text, item_id bigint, cantidad numeric, pu numeric) loop
    if r.etapa is null or r.item_id is null or r.cantidad is null or r.cantidad < 0 or (r.pu is not null and r.pu < 0) then
      raise exception 'Cada partida necesita etapa, ítem, cantidad y P.U. válidos';
    end if;
    if r.id is null then
      insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu)
      values (p_obra_id, r.etapa, coalesce(r.requerimiento, 'REGULAR'), r.item_id, r.cantidad, r.pu);
    else
      select coalesce(sum(l.cantidad), 0) into v_comprado
        from v_oc_items_calc l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
       where l.partida_id = r.id and l.estado <> 'ANULADA' and not o.es_retencion;
      -- En mano de obra cuenta también lo avanzado que aún no tiene OS.
      v_comprado := v_comprado + coalesce((select sum(cantidad) from avances where partida_id = r.id and estado = 'REGISTRADO'), 0)
                  + coalesce((select sum(vp.cantidad) from valorizacion_partidas vp join valorizaciones v on v.id = vp.valorizacion_id
                               where vp.partida_id = r.id
                                 and not exists (select 1 from ordenes_compra o where o.obra_id = v.obra_id and o.numero = v.numero_oc and o.estado <> 'ANULADA')), 0);
      -- Con adelantos, lo que cuenta es el presupuesto efectivo (cantidad + recibido - dado).
      if r.cantidad + fn_presupuesto_efectivo(r.id) - (select cantidad from partidas where id = r.id) < v_comprado - 0.0001 then
        raise exception 'La cantidad de una partida no puede quedar debajo de lo ya comprado (%), contando sus adelantos', v_comprado;
      end if;
      select pu into v_antes from partidas where id = r.id and obra_id = p_obra_id;
      if found and round(v_antes, 4) is distinct from round(r.pu, 4) then
        v_cambios := v_cambios || jsonb_build_object(r.id::text, jsonb_build_array(v_antes, r.pu));
      end if;
      update partidas set etapa = r.etapa, requerimiento = coalesce(r.requerimiento, 'REGULAR'), item_id = r.item_id,
                          cantidad = r.cantidad, pu = r.pu
       where id = r.id and obra_id = p_obra_id;
    end if;
    v_n := v_n + 1;
  end loop;

  for v_o in
    select o.obra_id, o.numero, o.tipo, o.estado, ob.nombre as obra,
           string_agg(distinct i.descripcion || ': ' ||
             coalesce(fn_soles((v_cambios -> l.partida_id::text ->> 0)::numeric), 'sin precio') || ' → ' ||
             coalesce(fn_soles((v_cambios -> l.partida_id::text ->> 1)::numeric), 'sin precio'), '; ') as detalle
      from oc_items l
      join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
      join obras ob on ob.id = o.obra_id
      join partidas p on p.id = l.partida_id
      join items i on i.id = p.item_id
     where v_cambios ? l.partida_id::text and o.estado <> 'ANULADA' and not o.es_retencion
     group by o.obra_id, o.numero, o.tipo, o.estado, ob.nombre
     order by o.obra_id, o.numero
  loop
    perform notificar('LOGISTICA', 'PRECIO_PRESUPUESTO',
      case when v_o.estado = 'EMITIDA'
           then format('Cambió el presupuesto de la %s %s: rige para su cotización', v_o.tipo, v_o.numero)
           else format('Cambió el presupuesto de la %s %s: sus precios no cambian', v_o.tipo, v_o.numero) end,
      v_o.obra || ' · ' || v_o.detalle,
      format('/logistica/ordenes/%s/%s?tipo=%s', v_o.obra_id, v_o.numero, v_o.tipo));
  end loop;
  return v_n;
end;
$$;
