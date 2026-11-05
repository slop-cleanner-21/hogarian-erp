-- La base hace cumplir la retención de 4ta, la detracción y el comprobante de una OS (06/11/2026). Antes las reglas
-- de la retención vivían solo en la pantalla (src/lib/retencion.ts): por la API se podía registrar cualquier monto.
--   · Retención de 4ta (LIR art. 71): solo recibos por honorarios de más de S/ 1,500, por el % del proveedor, salvo
--     suspensión vigente (otorgada antes o el mismo día del recibo, del mismo año). La calcula la base; si llega otra,
--     se rechaza diciendo cuál corresponde.
--   · Detracción (SPOT): solo facturas de más del mínimo con ítems que la llevan. Si no corresponde, no se acepta
--     ninguna; si corresponde, no puede ser 0 (el monto lo puede ajustar Logística al de la factura).
--   · OS: el comprobante es factura o recibo por honorarios; si llega el otro, el contrato se regenera en la misma
--     transacción (antes la app llamaba a set_datos_os aparte y, si el registro fallaba, el contrato ya había cambiado).
--   · Corregir un comprobante: mismas reglas. Si no cambian tipo, fecha ni total, la retención queda como estaba.
--   · Suspensión de 4ta del proveedor: solo con la constancia de verdad subida (en documentos/proveedores/) y con
--     fecha que no sea futura.

-- Retención de 4ta que corresponde a un comprobante (misma regla que retencion4ta() de src/lib/retencion.ts).
create or replace function public.fn_retencion_4ta(p_proveedor_id bigint, p_tipo tipo_comprobante, p_fecha date, p_total numeric)
  returns numeric language sql stable security definer set search_path = public, pg_temp
as $$
  select case
           when p_tipo <> 'RXH' or not (p_total > 1500) then 0
           when pr.suspension_4ta_fecha is not null and p_fecha >= pr.suspension_4ta_fecha
                and extract(year from p_fecha) = extract(year from pr.suspension_4ta_fecha) then 0
           else round(p_total * coalesce(pr.retencion_4ta_pct, 8) / 100, 2)
         end
    from proveedores pr where pr.id = p_proveedor_id
$$;
revoke execute on function public.fn_retencion_4ta(bigint, tipo_comprobante, date, numeric) from public, anon, authenticated;

create or replace function public.fn_soles(p numeric) returns text language sql immutable set search_path = public, pg_temp
as $$ select 'S/ ' || to_char(p, 'FM999,999,990.00') $$;
revoke execute on function public.fn_soles(numeric) from public, anon;

-- Una OS cuyo comprobante cambia (factura ↔ recibo por honorarios): otro contrato; el firmado deja de servir.
create or replace function public.fn_os_comprobante(p_obra_id bigint, p_numero text, p_tipo tipo_comprobante)
  returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
begin
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if v_o.tipo <> 'OS' or v_o.comprobante_tipo is not distinct from p_tipo then
    return;
  end if;
  if v_o.estado not in ('EMITIDA', 'PRECIOS_CONFIRMADOS', 'FACTURADA') then
    raise exception 'La OS % ya está en Tesorería: para cambiar el tipo de comprobante, Tesorería debe rechazarla', p_numero;
  end if;
  if v_o.comprobante_tipo is not null then
    delete from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero;
    update ordenes_compra set contrato_enviado_at = null where obra_id = p_obra_id and numero = p_numero;
  end if;
  update ordenes_compra set comprobante_tipo = p_tipo where obra_id = p_obra_id and numero = p_numero;
end;
$$;
revoke execute on function public.fn_os_comprobante(bigint, text, tipo_comprobante) from public, anon, authenticated;

create or replace function public.registrar_comprobante(p_proveedor_id bigint, p_tipo tipo_comprobante, p_serie text, p_numero text,
  p_fecha date, p_total numeric, p_retencion numeric, p_archivo_path text, p_item_ids bigint[], p_detraccion numeric default null::numeric)
  returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_serie text := upper(btrim(p_serie));
  v_numero text := upper(btrim(p_numero));
  v_ret numeric;
  v_n int;
  v_empresa bigint;
  v_id bigint;
  v_det numeric;
  v_sug numeric;
  v_os record;
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
  -- Retención de 4ta: la que corresponde, no otra.
  v_ret := fn_retencion_4ta(p_proveedor_id, p_tipo, p_fecha, round(p_total, 2));
  if p_retencion is not null and round(p_retencion, 2) <> v_ret then
    raise exception '%', case when v_ret = 0 then 'Este comprobante no lleva retención de 4ta'
                              else 'La retención de 4ta de este recibo es ' || fn_soles(v_ret) end;
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
  if p_tipo not in ('FACTURA', 'RXH') and exists (
       select 1 from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
        where l.id = any (p_item_ids) and o.tipo = 'OS') then
    raise exception 'El comprobante de una OS es factura o recibo por honorarios';
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

  -- OS: si llega el otro comprobante, otro contrato.
  for v_os in select distinct l.obra_id, l.numero_oc from oc_items l where l.id = any (p_item_ids) loop
    perform fn_os_comprobante(v_os.obra_id, v_os.numero_oc, p_tipo);
  end loop;

  insert into comprobantes (empresa_id, proveedor_id, tipo, serie, numero, fecha_emision, total, retencion, archivo_path)
  values (v_empresa, p_proveedor_id, p_tipo, v_serie, v_numero, p_fecha, p_total, v_ret, nullif(btrim(p_archivo_path), ''))
  returning id into v_id;

  update oc_items set comprobante_id = v_id where id = any (p_item_ids);

  -- Detracción: solo si corresponde (factura de más del mínimo, con ítems que la llevan) y entonces no puede ser 0.
  v_sug := fn_detraccion_sugerida(v_id);
  if v_sug = 0 then
    if coalesce(p_detraccion, 0) > 0 then
      raise exception 'Este comprobante no lleva detracción';
    end if;
  else
    v_det := coalesce(round(p_detraccion, 2), v_sug);
    if v_det <= 0 then
      raise exception 'Esta factura lleva detracción (%)', fn_soles(v_sug);
    end if;
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

create or replace function public.editar_comprobante(p_id bigint, p_tipo tipo_comprobante, p_serie text, p_numero text, p_fecha date,
  p_total numeric, p_retencion numeric, p_archivo_path text, p_motivo text)
  returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  c comprobantes%rowtype;
  v_antes jsonb;
  v_despues jsonb;
  v_ret numeric;
  v_sug numeric;
  v_os record;
begin
  perform exigir_rol('LOGISTICA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística corrige comprobantes';
  end if;
  select * into c from comprobantes where id = p_id for update;
  if not found then
    raise exception 'El comprobante no existe';
  end if;
  if exists (select 1 from asientos where comprobante_id = p_id) then
    raise exception 'El comprobante ya está contabilizado: pide a Contabilidad que lo revise';
  end if;
  if exists (select 1 from pago_aplicaciones where comprobante_id = p_id) then
    raise exception 'El comprobante ya tiene pagos';
  end if;
  if p_tipo is null or p_fecha is null or p_total is null or p_total <= 0 then
    raise exception 'Revisa el tipo, la fecha y el total';
  end if;
  -- Retención de 4ta: si cambian tipo, fecha o total, la que corresponde; si no, la que tenía.
  v_ret := case when p_tipo = c.tipo and p_fecha = c.fecha_emision and round(p_total, 2) = c.total then c.retencion
                else fn_retencion_4ta(c.proveedor_id, p_tipo, p_fecha, round(p_total, 2)) end;
  if p_retencion is not null and round(p_retencion, 2) <> v_ret then
    raise exception '%', case when v_ret = 0 then 'Este comprobante no lleva retención de 4ta'
                              else 'La retención de 4ta de este recibo es ' || fn_soles(v_ret) end;
  end if;
  if v_ret >= p_total then
    raise exception 'Revisa el total y la retención';
  end if;
  -- OS: factura o recibo por honorarios; con el otro, otro contrato.
  for v_os in select distinct o.obra_id, o.numero from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
               where l.comprobante_id = p_id and o.tipo = 'OS' order by 1, 2 loop
    if p_tipo not in ('FACTURA', 'RXH') then
      raise exception 'El comprobante de una OS es factura o recibo por honorarios';
    end if;
    if p_tipo <> c.tipo then
      perform fn_os_comprobante(v_os.obra_id, v_os.numero, p_tipo);
    end if;
  end loop;

  v_antes := jsonb_build_object('tipo', c.tipo, 'serie', c.serie, 'numero', c.numero, 'fecha_emision', c.fecha_emision,
                                'total', c.total, 'retencion', c.retencion, 'archivo_path', c.archivo_path);
  update comprobantes
     set tipo = p_tipo, serie = upper(btrim(p_serie)), numero = coalesce(nullif(ltrim(btrim(p_numero), '0'), ''), '0'),
         fecha_emision = p_fecha, total = round(p_total, 2), retencion = v_ret,
         archivo_path = coalesce(nullif(btrim(p_archivo_path), ''), archivo_path),
         -- el trigger vuelve a calcular base e IGV
         base = null, igv = null,
         periodo_anotacion = greatest(periodo_anotacion, to_char(p_fecha, 'YYYYMM'))
   where id = p_id
  returning jsonb_build_object('tipo', tipo, 'serie', serie, 'numero', numero, 'fecha_emision', fecha_emision,
                               'total', total, 'retencion', retencion, 'archivo_path', archivo_path) into v_despues;
  -- Detracción: los triggers la escalan con el total; aquí, que corresponda (ninguna bajo el mínimo o sin ítems que la
  -- lleven; la calculada si corresponde y no tenía).
  v_sug := fn_detraccion_sugerida(p_id);
  update comprobantes
     set detraccion = case when v_sug = 0 then 0 when detraccion = 0 then least(v_sug, total - retencion) else least(detraccion, total - retencion) end
   where id = p_id;
  if v_antes is distinct from v_despues then
    insert into comprobantes_historial (comprobante_id, anterior, nuevo, motivo)
    values (p_id, v_antes, v_despues, nullif(btrim(coalesce(p_motivo, '')), ''));
  end if;
exception when unique_violation then
  raise exception 'Ya existe un comprobante con esa serie y número para el proveedor';
end;
$$;

-- Suspensión de 4ta: solo con la constancia subida de verdad y con fecha que no sea futura (lo que la app ya pide; por
-- la API también). Las cargas (sin usuario) no pasan por aquí.
create or replace function public.fn_proveedor_suspension()
  returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.suspension_4ta_path is null then
    return new;
  end if;
  if tg_op = 'INSERT' or new.suspension_4ta_path is distinct from old.suspension_4ta_path then
    if new.suspension_4ta_path not like 'proveedores/%'
       or not exists (select 1 from storage.objects where bucket_id = 'documentos' and name = new.suspension_4ta_path) then
      raise exception 'Sube la constancia de suspensión de 4ta';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.suspension_4ta_fecha is distinct from old.suspension_4ta_fecha) and new.suspension_4ta_fecha > current_date then
    raise exception 'La fecha de la constancia no puede ser futura';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_proveedor_suspension() from public, anon, authenticated;
create trigger proveedor_suspension before insert or update of suspension_4ta_path, suspension_4ta_fecha on public.proveedores
  for each row execute function public.fn_proveedor_suspension();
