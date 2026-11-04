-- Detracciones (SPOT). Gerencia marca, al armar el presupuesto, qué ítems de la obra llevan detracción y
-- con qué porcentaje (5 % al marcarlo; se puede cambiar). Sin fila, el ítem no lleva detracción.
-- Al registrar una factura, la detracción se calcula sobre el total según sus líneas (Logística la ajusta
-- a lo que diga la factura). Tesorería paga al proveedor el total menos retención y detracción; la
-- detracción la paga Contabilidad (por ahora solo queda registrada).

create table if not exists public.detracciones (
  obra_id bigint not null references public.obras (id) on delete cascade,
  item_id bigint not null references public.items (id),
  porcentaje numeric(5, 2) not null default 5 check (porcentaje > 0 and porcentaje < 100),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (obra_id, item_id)
);

alter table public.detracciones enable row level security;
revoke all on public.detracciones from anon, authenticated;
grant select on public.detracciones to authenticated;
create policy detracciones_select on public.detracciones for select to authenticated
  using (not (select public.es_residente()));
create policy con_perfil on public.detracciones as restrictive for all to authenticated
  using ((select public.rol_actual()) <> '') with check ((select public.rol_actual()) <> '');
create policy rrhh_sin_select on public.detracciones as restrictive for select to authenticated
  using ((select public.rol_actual()) is distinct from 'RRHH');

-- Gerencia marca o quita la detracción de ítems de la obra: porcentaje null = sin detracción.
create or replace function public.guardar_detracciones(p_obra_id bigint, p_detracciones jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_n integer := 0;
begin
  perform exigir_rol('GERENCIA');
  for r in select * from jsonb_to_recordset(coalesce(p_detracciones, '[]'::jsonb)) x(item_id bigint, porcentaje numeric) loop
    if not exists (select 1 from partidas where obra_id = p_obra_id and item_id = r.item_id) then
      raise exception 'El ítem no está en el presupuesto de la obra';
    end if;
    if r.porcentaje is null then
      delete from detracciones where obra_id = p_obra_id and item_id = r.item_id;
    elsif r.porcentaje <= 0 or r.porcentaje >= 100 then
      raise exception 'La detracción debe estar entre 0.01 y 99.99 %%';
    else
      insert into detracciones (obra_id, item_id, porcentaje) values (p_obra_id, r.item_id, round(r.porcentaje, 2))
      on conflict (obra_id, item_id) do update set porcentaje = excluded.porcentaje, updated_by = auth.uid(), updated_at = now();
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.guardar_detracciones(bigint, jsonb) from public, anon;
grant execute on function public.guardar_detracciones(bigint, jsonb) to authenticated;

alter table public.comprobantes add column if not exists detraccion numeric(14, 2) not null default 0;
alter table public.comprobantes add constraint comprobantes_detraccion_check
  check (detraccion >= 0 and detraccion <= total - retencion);

-- Detracción que corresponde a una factura por sus líneas: total × (Σ parcial × % ÷ Σ parcial).
create or replace function public.fn_detraccion_sugerida(p_comprobante_id bigint)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when c.tipo <> 'FACTURA' then 0 else
    coalesce(round(c.total * sum(coalesce(l.parcial, 0) * coalesce(d.porcentaje, 0) / 100) / nullif(sum(coalesce(l.parcial, 0)), 0), 2), 0)
  end
    from comprobantes c
    left join v_oc_items_calc l on l.comprobante_id = c.id
    left join detracciones d on d.obra_id = l.obra_id and d.item_id = l.item_id
   where c.id = p_comprobante_id
   group by c.id, c.tipo, c.total
$$;
revoke execute on function public.fn_detraccion_sugerida(bigint) from public, anon;
grant execute on function public.fn_detraccion_sugerida(bigint) to authenticated;

-- Al corregir el total o el tipo de un comprobante, la detracción se mantiene en proporción (o se
-- calcula si pasa a factura, o se quita si deja de serlo).
create or replace function public.fn_comprobante_detraccion()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.tipo <> 'FACTURA' then
    new.detraccion := 0;
  elsif new.detraccion = old.detraccion and (new.total <> old.total or new.tipo <> old.tipo) then
    if old.tipo = 'FACTURA' and old.total > 0 then
      new.detraccion := round(old.detraccion * new.total / old.total, 2);
    else
      new.detraccion := 0;  -- se recalcula al final de la corrección con las líneas
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists comprobante_detraccion on public.comprobantes;
create trigger comprobante_detraccion before update of total, tipo on public.comprobantes
  for each row execute function public.fn_comprobante_detraccion();

create or replace function public.fn_comprobante_detraccion_nueva()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Pasó a factura en una corrección: se calcula con sus líneas.
  if new.tipo = 'FACTURA' and old.tipo <> 'FACTURA' then
    update comprobantes set detraccion = least(fn_detraccion_sugerida(new.id), total - retencion) where id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists comprobante_detraccion_nueva on public.comprobantes;
create trigger comprobante_detraccion_nueva after update of tipo on public.comprobantes
  for each row execute function public.fn_comprobante_detraccion_nueva();

-- Las funciones de los triggers no se llaman por la API.
revoke execute on function public.fn_comprobante_detraccion() from public, anon, authenticated;
revoke execute on function public.fn_comprobante_detraccion_nueva() from public, anon, authenticated;

-- Registro del comprobante con su detracción (null = la que corresponde por las líneas).
drop function if exists public.registrar_comprobante(bigint, tipo_comprobante, text, text, date, numeric, numeric, text, bigint[]);
create or replace function public.registrar_comprobante(
  p_proveedor_id bigint, p_tipo tipo_comprobante, p_serie text, p_numero text, p_fecha date, p_total numeric,
  p_retencion numeric, p_archivo_path text, p_item_ids bigint[], p_detraccion numeric default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_serie text := upper(btrim(p_serie));
  v_numero text := upper(btrim(p_numero));
  v_ret numeric := coalesce(p_retencion, 0);
  v_n int;
  v_empresa bigint;
  v_id bigint;
  v_det numeric;
begin
  perform exigir_rol('LOGISTICA');
  if not exists (select 1 from proveedores where id = p_proveedor_id) then
    raise exception 'El proveedor % no existe', p_proveedor_id;
  end if;
  if p_tipo is null then
    raise exception 'Debe indicar el tipo de comprobante';
  end if;
  if coalesce(v_serie, '') = '' or coalesce(v_numero, '') = '' then
    raise exception 'Debe indicar serie y número del comprobante';
  end if;
  if v_numero ~ '^\d+$' then  -- misma normalización que el seed: sin ceros a la izquierda
    v_numero := coalesce(nullif(ltrim(v_numero, '0'), ''), '0');
  end if;
  if p_fecha is null then
    raise exception 'Debe indicar la fecha de emisión';
  end if;
  if p_total is null or p_total <= 0 then
    raise exception 'El total del comprobante debe ser mayor que cero';
  end if;
  if v_ret < 0 or v_ret > p_total then
    raise exception 'La retención debe estar entre 0 y el total';
  end if;
  if p_detraccion is not null and (p_detraccion < 0 or p_detraccion > p_total - v_ret) then
    raise exception 'La detracción debe estar entre 0 y el total menos la retención';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    raise exception 'Debe seleccionar al menos un ítem de orden';
  end if;

  perform 1 from ordenes_compra o
   where (o.obra_id, o.numero) in (select obra_id, numero_oc from oc_items where id = any (p_item_ids))
   order by o.obra_id, o.numero
     for update;
  perform 1 from oc_items where id = any (p_item_ids) order by id for update;

  select count(*) into v_n from oc_items where id = any (p_item_ids);
  if v_n <> (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception 'Algunos ítems seleccionados no existen';
  end if;
  if exists (select 1 from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
              where l.id = any (p_item_ids) and o.proveedor_id <> p_proveedor_id) then
    raise exception 'Hay ítems de órdenes de otro proveedor';
  end if;
  if exists (select 1 from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
              where l.id = any (p_item_ids) and o.estado not in ('PRECIOS_CONFIRMADOS', 'FACTURADA')) then
    raise exception 'Solo se pueden facturar ítems de órdenes con precios confirmados';
  end if;
  if exists (select 1 from oc_items where id = any (p_item_ids) and comprobante_id is not null) then
    raise exception 'Hay ítems que ya tienen comprobante';
  end if;
  select min(ob.empresa_id), count(distinct ob.empresa_id) into v_empresa, v_n
    from oc_items l join obras ob on ob.id = l.obra_id
   where l.id = any (p_item_ids);
  if v_n > 1 then
    raise exception 'Los ítems pertenecen a obras de distintas empresas';
  end if;
  if exists (select 1 from comprobantes where proveedor_id = p_proveedor_id and tipo = p_tipo
                and serie = v_serie and numero = v_numero) then
    raise exception 'El comprobante % %-% ya está registrado para este proveedor', p_tipo, v_serie, v_numero;
  end if;

  insert into comprobantes (empresa_id, proveedor_id, tipo, serie, numero, fecha_emision, total, retencion, archivo_path)
  values (v_empresa, p_proveedor_id, p_tipo, v_serie, v_numero, p_fecha, p_total, v_ret, nullif(btrim(p_archivo_path), ''))
  returning id into v_id;

  update oc_items set comprobante_id = v_id where id = any (p_item_ids);

  -- Solo las facturas llevan detracción.
  v_det := case when p_tipo = 'FACTURA' then coalesce(round(p_detraccion, 2), fn_detraccion_sugerida(v_id)) else 0 end;
  if v_det > 0 then
    update comprobantes set detraccion = least(v_det, total - retencion) where id = v_id;
  end if;

  update ordenes_compra o set estado = 'FACTURADA'
   where o.estado = 'PRECIOS_CONFIRMADOS'
     and (o.obra_id, o.numero) in (select obra_id, numero_oc from oc_items where id = any (p_item_ids))
     and not exists (select 1 from oc_items l
                      where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is null);
  return v_id;
end;
$$;
revoke execute on function public.registrar_comprobante(bigint, tipo_comprobante, text, text, date, numeric, numeric, text, bigint[], numeric) from public, anon;
grant execute on function public.registrar_comprobante(bigint, tipo_comprobante, text, text, date, numeric, numeric, text, bigint[], numeric) to authenticated;

-- Lo que se le paga al proveedor: total menos retención y detracción.
create or replace view public.v_comprobantes with (security_invoker = on) as
 SELECT c.id,
    c.empresa_id,
    e.nombre AS empresa,
    e.ruc AS empresa_ruc,
    c.proveedor_id,
    pr.razon_social AS proveedor,
    pr.ruc_o_cod AS proveedor_ruc,
    c.tipo,
    c.serie,
    c.numero,
    ((c.serie || '-'::text) || c.numero) AS comprobante,
    c.fecha_emision,
    c.total,
    c.base,
    c.igv,
    c.retencion,
    (c.total - c.retencion - c.detraccion) AS neto,
    COALESCE(pa.pagado, (0)::numeric) AS pagado,
    ((c.total - c.retencion - c.detraccion) - COALESCE(pa.pagado, (0)::numeric)) AS saldo,
    a.id AS asiento_id,
    c.archivo_path,
    c.created_at,
    c.detraccion
   FROM ((((comprobantes c
     JOIN empresas e ON ((e.id = c.empresa_id)))
     JOIN proveedores pr ON ((pr.id = c.proveedor_id)))
     LEFT JOIN LATERAL ( SELECT sum(ap.monto) AS pagado
           FROM pago_aplicaciones ap
          WHERE (ap.comprobante_id = c.id)) pa ON (true))
     LEFT JOIN asientos a ON (((a.comprobante_id = c.id) AND (a.origen = 'COMPRA'::text))));
