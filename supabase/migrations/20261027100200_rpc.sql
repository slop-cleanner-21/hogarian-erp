-- ERP MVP: funciones RPC (flujo OC -> cotización -> comprobante -> pago -> contabilidad).
-- Todas SECURITY INVOKER salvo get_cotizacion / enviar_cotizacion (anon, por token).

-- Cuentas que usan los asientos automáticos (el resto del plan está en seed/base.sql)
insert into public.cuentas_contables (codigo, denominacion, tipo) values
  ('1041',  'Cuentas corrientes operativas', 'ACTIVO'),
  ('40111', 'IGV - Cuenta propia', 'PASIVO'),
  ('40172', 'Renta de cuarta categoría', 'PASIVO'),
  ('4212',  'Facturas, boletas y otros comprobantes por pagar - Emitidas', 'PASIVO'),
  ('4222',  'Anticipos a proveedores', 'ACTIVO'),
  ('4241',  'Honorarios por pagar', 'PASIVO')
on conflict (codigo) do nothing;

-- ============================================================ órdenes
create or replace function public.siguiente_numero_oc(p_obra_id bigint)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(max(numero::numeric) + 1, 100001)::bigint::text
    from ordenes_compra
   where obra_id = p_obra_id
     and numero ~ '^\d{1,15}$'
$$;

create or replace function public.crear_orden(
  p_obra_id bigint,
  p_numero text,
  p_proveedor_id bigint,
  p_tipo public.tipo_orden,
  p_items jsonb   -- [{partida_id, cantidad}]
)
returns text
language plpgsql
set search_path = public
as $$
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
    select coalesce(sum(l.cantidad), 0) into v_comp
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

  insert into oc_items (obra_id, numero_oc, partida_id, cantidad)
  select p_obra_id, v_numero, x.partida_id, x.cantidad
    from rows from (jsonb_to_recordset(p_items) as (partida_id bigint, cantidad numeric))
         with ordinality as x(partida_id, cantidad, n)
   order by x.n;

  return v_numero;
exception
  when unique_violation then
    raise exception 'Ya existe la orden % en esta obra', v_numero;
end;
$$;

-- ============================================================ cotización pública (anon, por token)
create or replace function public.get_cotizacion(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'numero', o.numero,
           'tipo', o.tipo,
           'obra', ob.nombre,
           'empresa', e.nombre,
           'empresa_ruc', e.ruc,
           'proveedor', pr.razon_social,
           'fecha', o.fecha,
           'estado', o.estado,
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', l.id,
                      'descripcion', i.descripcion,
                      'unidad', i.unidad,
                      'cantidad', l.cantidad,
                      'pu_cotizado', l.pu_cotizado) order by l.id)
               from oc_items l
               join partidas p on p.id = l.partida_id
               join items i on i.id = p.item_id
              where l.obra_id = o.obra_id and l.numero_oc = o.numero), '[]'::jsonb))
    into v
    from ordenes_compra o
    join obras ob on ob.id = o.obra_id
    join empresas e on e.id = ob.empresa_id
    join proveedores pr on pr.id = o.proveedor_id
   where o.token_cotizacion = p_token;
  if v is null then
    raise exception 'Cotización no encontrada';
  end if;
  return v;
end;
$$;

create or replace function public.enviar_cotizacion(p_token uuid, p_precios jsonb /* [{item_id, pu}] */)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
  r record;
begin
  select * into v_o from ordenes_compra where token_cotizacion = p_token for update;
  if not found then
    raise exception 'Cotización no encontrada';
  end if;
  if v_o.estado <> 'EMITIDA' then
    raise exception 'La orden % ya no acepta cotizaciones (estado %)', v_o.numero, v_o.estado;
  end if;
  if p_precios is null or jsonb_typeof(p_precios) <> 'array' then
    raise exception 'Formato de precios inválido';
  end if;
  for r in select * from jsonb_to_recordset(p_precios) x(item_id bigint, pu numeric) loop
    if r.pu is null or r.pu < 0 then
      raise exception 'Precio inválido para el ítem %', r.item_id;
    end if;
    update oc_items set pu_cotizado = r.pu
     where id = r.item_id and obra_id = v_o.obra_id and numero_oc = v_o.numero;
    if not found then
      raise exception 'El ítem % no pertenece a esta cotización', r.item_id;
    end if;
  end loop;
end;
$$;

-- ============================================================ precios (logística)
create or replace function public.guardar_precios(
  p_obra_id bigint,
  p_numero text,
  p_precios jsonb   -- [{item_id, pu?, pu_aprobado?}]  (clave ausente = no cambia; null = borra)
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estado estado_oc;
  e jsonb;
  v_pu numeric;
  v_apr numeric;
begin
  select estado into v_estado from ordenes_compra
   where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe en la obra', p_numero;
  end if;
  if v_estado <> 'EMITIDA' then
    raise exception 'Solo se pueden modificar precios de órdenes EMITIDAS (la orden % está %)', p_numero, v_estado;
  end if;
  if p_precios is null or jsonb_typeof(p_precios) <> 'array' then
    raise exception 'Formato de precios inválido';
  end if;
  for e in select value from jsonb_array_elements(p_precios) loop
    v_pu := (e ->> 'pu')::numeric;
    v_apr := (e ->> 'pu_aprobado')::numeric;
    if v_pu < 0 or v_apr < 0 then
      raise exception 'Precio negativo para el ítem %', e ->> 'item_id';
    end if;
    update oc_items set
           pu_cotizado  = case when e ? 'pu' then v_pu else pu_cotizado end,
           pu_aprobado  = case when e ? 'pu_aprobado' then v_apr else pu_aprobado end,
           aprobado_por = case when e ? 'pu_aprobado' then case when v_apr is null then null else auth.uid() end
                               else aprobado_por end
     where id = (e ->> 'item_id')::bigint and obra_id = p_obra_id and numero_oc = p_numero;
    if not found then
      raise exception 'El ítem % no pertenece a la orden %', e ->> 'item_id', p_numero;
    end if;
  end loop;
end;
$$;

create or replace function public.confirmar_precios(p_obra_id bigint, p_numero text)
returns void
language plpgsql
set search_path = public
as $$
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
  update ordenes_compra set estado = 'PRECIOS_CONFIRMADOS'
   where obra_id = p_obra_id and numero = p_numero;
end;
$$;

create or replace function public.anular_orden(p_obra_id bigint, p_numero text, p_motivo text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_estado estado_oc;
begin
  select estado into v_estado from ordenes_compra
   where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe en la obra', p_numero;
  end if;
  if v_estado = 'ANULADA' then
    raise exception 'La orden % ya está anulada', p_numero;
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Debe indicar el motivo de anulación';
  end if;
  if exists (select 1 from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is not null) then
    raise exception 'No se puede anular la orden %: tiene comprobantes registrados', p_numero;
  end if;
  if exists (select 1 from pago_aplicaciones where obra_id = p_obra_id and numero_oc = p_numero) then
    raise exception 'No se puede anular la orden %: tiene pagos registrados', p_numero;
  end if;
  update ordenes_compra set estado = 'ANULADA', motivo_anulacion = btrim(p_motivo)
   where obra_id = p_obra_id and numero = p_numero;
end;
$$;

-- ============================================================ comprobantes
create or replace function public.registrar_comprobante(
  p_proveedor_id bigint,
  p_tipo public.tipo_comprobante,
  p_serie text,
  p_numero text,
  p_fecha date,
  p_total numeric,
  p_retencion numeric,
  p_archivo_path text,
  p_item_ids bigint[]   -- ids de oc_items
)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_serie text := upper(btrim(p_serie));
  v_numero text := upper(btrim(p_numero));
  v_ret numeric := coalesce(p_retencion, 0);
  v_n int;
  v_empresa bigint;
  v_id bigint;
begin
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

  update ordenes_compra o set estado = 'FACTURADA'
   where o.estado = 'PRECIOS_CONFIRMADOS'
     and (o.obra_id, o.numero) in (select obra_id, numero_oc from oc_items where id = any (p_item_ids))
     and not exists (select 1 from oc_items l
                      where l.obra_id = o.obra_id and l.numero_oc = o.numero and l.comprobante_id is null);
  return v_id;
end;
$$;

-- ============================================================ pagos
create or replace function public.registrar_pago(
  p_empresa_id bigint,
  p_fecha date,
  p_banco text,
  p_numero_operacion text,
  p_aplicaciones jsonb   -- [{comprobante_id, monto} | {obra_id, numero_oc, monto}]
)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  r record;
  v_emp bigint;
  v_estado estado_oc;
  v_saldo numeric;
  v_total numeric := 0;
  v_id bigint;
  v_aplic jsonb;
begin
  if not exists (select 1 from empresas where id = p_empresa_id) then
    raise exception 'La empresa % no existe', p_empresa_id;
  end if;
  if p_fecha is null then
    raise exception 'Debe indicar la fecha del pago';
  end if;
  if p_aplicaciones is null or jsonb_typeof(p_aplicaciones) <> 'array' or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe tener al menos una aplicación';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_aplicaciones) x(comprobante_id bigint, obra_id bigint, numero_oc text, monto numeric)
              where x.monto is null or x.monto <= 0) then
    raise exception 'Cada aplicación requiere un monto mayor que cero';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_aplicaciones) x(comprobante_id bigint, obra_id bigint, numero_oc text, monto numeric)
              where not ((x.comprobante_id is not null and x.obra_id is null and x.numero_oc is null)
                      or (x.comprobante_id is null and x.obra_id is not null and x.numero_oc is not null))) then
    raise exception 'Cada aplicación debe indicar comprobante_id, o bien obra_id y numero_oc (no ambos)';
  end if;

  -- agrupa por destino (comprobante u orden)
  select jsonb_agg(jsonb_build_object('comprobante_id', g.comprobante_id, 'obra_id', g.obra_id,
                                      'numero_oc', g.numero_oc, 'monto', g.monto))
    into v_aplic
    from (select x.comprobante_id, x.obra_id, x.numero_oc, sum(x.monto) as monto
            from jsonb_to_recordset(p_aplicaciones) x(comprobante_id bigint, obra_id bigint, numero_oc text, monto numeric)
           group by 1, 2, 3) g;

  for r in select * from jsonb_to_recordset(v_aplic) x(comprobante_id bigint, obra_id bigint, numero_oc text, monto numeric)
            order by x.comprobante_id nulls last, x.obra_id, x.numero_oc loop
    if r.comprobante_id is not null then
      select c.empresa_id,
             c.total - c.retencion - coalesce((select sum(ap.monto) from pago_aplicaciones ap where ap.comprobante_id = c.id), 0)
        into v_emp, v_saldo
        from comprobantes c where c.id = r.comprobante_id for update;
      if not found then
        raise exception 'El comprobante % no existe', r.comprobante_id;
      end if;
      if v_emp <> p_empresa_id then
        raise exception 'El comprobante % pertenece a otra empresa', r.comprobante_id;
      end if;
      if r.monto > v_saldo + 0.005 then
        raise exception 'El monto % excede el saldo pendiente (%) del comprobante %', r.monto, v_saldo, r.comprobante_id;
      end if;
    else
      select ob.empresa_id, o.estado into v_emp, v_estado
        from ordenes_compra o join obras ob on ob.id = o.obra_id
       where o.obra_id = r.obra_id and o.numero = r.numero_oc
         for update of o;
      if not found then
        raise exception 'La orden % no existe en la obra %', r.numero_oc, r.obra_id;
      end if;
      if v_emp <> p_empresa_id then
        raise exception 'La orden % pertenece a otra empresa', r.numero_oc;
      end if;
      if v_estado not in ('PRECIOS_CONFIRMADOS', 'FACTURADA') then
        raise exception 'Solo se pueden pagar órdenes con precios confirmados (la orden % está %)', r.numero_oc, v_estado;
      end if;
      select total - pagado into v_saldo from v_ordenes where obra_id = r.obra_id and numero = r.numero_oc;
      if r.monto > v_saldo + 0.005 then
        raise exception 'El monto % excede el saldo pendiente (%) de la orden %', r.monto, v_saldo, r.numero_oc;
      end if;
    end if;
    v_total := v_total + r.monto;
  end loop;

  insert into pagos (empresa_id, fecha, banco, numero_operacion, monto)
  values (p_empresa_id, p_fecha, nullif(btrim(p_banco), ''), nullif(btrim(p_numero_operacion), ''), v_total)
  returning id into v_id;

  insert into pago_aplicaciones (pago_id, comprobante_id, obra_id, numero_oc, monto)
  select v_id, x.comprobante_id, x.obra_id, x.numero_oc, x.monto
    from jsonb_to_recordset(v_aplic) x(comprobante_id bigint, obra_id bigint, numero_oc text, monto numeric);

  -- órdenes cubiertas al 100% -> PAGADA
  update ordenes_compra o set estado = 'PAGADA'
    from v_ordenes v
   where v.obra_id = o.obra_id and v.numero = o.numero
     and o.estado in ('PRECIOS_CONFIRMADOS', 'FACTURADA')
     and v.total > 0
     and v.pagado >= v.total - 0.005
     and (o.obra_id, o.numero) in (
           select ap.obra_id, ap.numero_oc from pago_aplicaciones ap where ap.pago_id = v_id and ap.obra_id is not null
           union
           select l.obra_id, l.numero_oc from oc_items l
             join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id
            where ap.pago_id = v_id);
  return v_id;
end;
$$;

-- ============================================================ contabilidad
create or replace function public.asignar_cuenta_item(p_item_id bigint, p_cuenta text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_cuenta text := nullif(btrim(p_cuenta), '');
begin
  if v_cuenta is not null and not exists (select 1 from cuentas_contables where codigo = v_cuenta) then
    raise exception 'La cuenta contable % no existe', v_cuenta;
  end if;
  update items set cuenta_contable = v_cuenta where id = p_item_id;
  if not found then
    raise exception 'El ítem % no existe', p_item_id;
  end if;
end;
$$;

create or replace function public.contabilizar_comprobante(p_comprobante_id bigint)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_c comprobantes%rowtype;
  v_prov text;
  v_asiento bigint;
  v_sin text;
  v_w numeric;
  v_monto numeric;
  v_acum numeric := 0;
  v_mayor text;
  v_dif numeric;
  r record;
begin
  select * into v_c from comprobantes where id = p_comprobante_id for update;
  if not found then
    raise exception 'El comprobante % no existe', p_comprobante_id;
  end if;
  if exists (select 1 from asientos where comprobante_id = p_comprobante_id and origen = 'COMPRA') then
    raise exception 'El comprobante %-% ya está contabilizado', v_c.serie, v_c.numero;
  end if;
  if not exists (select 1 from oc_items where comprobante_id = p_comprobante_id) then
    raise exception 'El comprobante %-% no tiene ítems vinculados', v_c.serie, v_c.numero;
  end if;
  select string_agg(distinct descripcion, '; ') into v_sin
    from v_oc_items_calc where comprobante_id = p_comprobante_id and cuenta_contable is null;
  if v_sin is not null then
    raise exception 'Hay ítems sin cuenta contable: %', v_sin;
  end if;
  if v_c.total <= 0 then
    raise exception 'El comprobante %-% tiene total cero', v_c.serie, v_c.numero;
  end if;
  select razon_social into v_prov from proveedores where id = v_c.proveedor_id;

  insert into asientos (empresa_id, fecha, glosa, origen, comprobante_id)
  values (v_c.empresa_id, v_c.fecha_emision,
          format('Compra %s %s-%s %s', v_c.tipo, v_c.serie, v_c.numero, v_prov), 'COMPRA', v_c.id)
  returning id into v_asiento;

  -- Debe: gasto (base; en RXH/BOLETA/OTRO base = total) repartido por cuenta según el parcial de las líneas
  select sum(coalesce(parcial, 0)) into v_w from v_oc_items_calc where comprobante_id = p_comprobante_id;
  for r in
    select cuenta_contable as cuenta, sum(coalesce(parcial, 0)) as peso
      from v_oc_items_calc where comprobante_id = p_comprobante_id
     group by cuenta_contable
     order by 2 desc, 1
  loop
    v_mayor := coalesce(v_mayor, r.cuenta);
    v_monto := case when v_w > 0 then round(v_c.base * r.peso / v_w, 2) else 0 end;
    if v_monto > 0 then
      insert into asiento_lineas (asiento_id, cuenta, debe) values (v_asiento, r.cuenta, v_monto);
      v_acum := v_acum + v_monto;
    end if;
  end loop;
  v_dif := v_c.base - v_acum;  -- residuo de redondeo a la cuenta de mayor peso
  if v_dif <> 0 then
    update asiento_lineas set debe = debe + v_dif where asiento_id = v_asiento and cuenta = v_mayor;
    if not found then
      insert into asiento_lineas (asiento_id, cuenta, debe) values (v_asiento, v_mayor, v_dif);
    end if;
  end if;
  if v_c.igv > 0 then
    insert into asiento_lineas (asiento_id, cuenta, debe) values (v_asiento, '40111', v_c.igv);
  end if;

  -- Haber
  if v_c.tipo = 'RXH' then
    if v_c.total - v_c.retencion > 0 then
      insert into asiento_lineas (asiento_id, cuenta, haber) values (v_asiento, '4241', v_c.total - v_c.retencion);
    end if;
    if v_c.retencion > 0 then
      insert into asiento_lineas (asiento_id, cuenta, haber) values (v_asiento, '40172', v_c.retencion);
    end if;
  else
    insert into asiento_lineas (asiento_id, cuenta, haber) values (v_asiento, '4212', v_c.total);
  end if;

  if (select sum(debe) - sum(haber) from asiento_lineas where asiento_id = v_asiento) <> 0 then
    raise exception 'Asiento descuadrado para el comprobante %-%', v_c.serie, v_c.numero;
  end if;
  return v_asiento;
end;
$$;

create or replace function public.contabilizar_pago(p_pago_id bigint)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_p pagos%rowtype;
  v_asiento bigint;
begin
  select * into v_p from pagos where id = p_pago_id for update;
  if not found then
    raise exception 'El pago % no existe', p_pago_id;
  end if;
  if exists (select 1 from asientos where pago_id = p_pago_id and origen = 'PAGO') then
    raise exception 'El pago % ya está contabilizado', p_pago_id;
  end if;

  insert into asientos (empresa_id, fecha, glosa, origen, pago_id)
  values (v_p.empresa_id, v_p.fecha,
          format('Pago op. %s %s', coalesce(v_p.numero_operacion, 's/n'), coalesce(v_p.banco, '')), 'PAGO', v_p.id)
  returning id into v_asiento;

  -- Debe: 4241 para RxH, 4212 para el resto y para pagos a órdenes sin comprobante
  insert into asiento_lineas (asiento_id, cuenta, debe)
  select v_asiento, case when c.tipo = 'RXH' then '4241' else '4212' end, sum(a.monto)
    from pago_aplicaciones a
    left join comprobantes c on c.id = a.comprobante_id
   where a.pago_id = p_pago_id
   group by 2;
  insert into asiento_lineas (asiento_id, cuenta, haber) values (v_asiento, '1041', v_p.monto);

  if (select sum(debe) - sum(haber) from asiento_lineas where asiento_id = v_asiento) <> 0 then
    raise exception 'Asiento descuadrado para el pago %', p_pago_id;
  end if;
  return v_asiento;
end;
$$;

-- ============================================================ permisos
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on function public.get_cotizacion(uuid) to anon;
grant execute on function public.enviar_cotizacion(uuid, jsonb) to anon;
