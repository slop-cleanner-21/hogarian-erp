-- Permisos por rol para todos los roles (antes solo el residente estaba restringido).
--
-- 1. Las funciones que escriben exigen el rol de quien las usa en la app y corren como su dueño
--    (antes algunas corrían con los permisos de quien llamaba y no miraban el rol).
-- 2. Sin sesión (anon) solo se puede usar la cotización por link; notificar es interno.
-- 3. Las tablas son de solo lectura salvo las que la app escribe directo, y solo para su rol.
-- 4. Storage: cada uno borra o cambia solo lo que subió; el residente solo ve y sube las fotos de
--    sus obras; los comprobantes no los ve el residente.

-- Exige uno de los roles (ADMIN siempre puede). Sin JWT de usuario (migraciones, seeds, service
-- role) no aplica.
create or replace function public.exigir_rol(variadic p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return;
  end if;
  if coalesce(rol_actual(), '') <> all (p_roles || 'ADMIN'::text) then
    raise exception 'No tienes permiso para esta acción';
  end if;
end;
$$;

-- actualizar_periodo_anotacion: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.actualizar_periodo_anotacion(p_comprobante_id bigint, p_periodo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_c comprobantes%rowtype;
  v_per text := btrim(p_periodo);
begin
  perform exigir_rol('CONTABILIDAD');
  select * into v_c from comprobantes where id = p_comprobante_id for update;
  if not found then
    raise exception 'El comprobante % no existe', p_comprobante_id;
  end if;
  if exists (select 1 from asientos where comprobante_id = p_comprobante_id and origen = 'COMPRA') then
    raise exception 'El comprobante %-% ya está contabilizado: no se puede cambiar el periodo', v_c.serie, v_c.numero;
  end if;
  if v_per is null or v_per !~ '^\d{4}(0[1-9]|1[0-2])$' then
    raise exception 'Periodo inválido: use el formato AAAAMM';
  end if;
  if v_per < to_char(v_c.fecha_emision, 'YYYYMM') then
    raise exception 'El periodo % es anterior al mes de emisión del comprobante (%)', v_per, to_char(v_c.fecha_emision, 'YYYYMM');
  end if;
  update comprobantes set periodo_anotacion = v_per where id = p_comprobante_id;
end;
$function$;

-- anular_orden_pago: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.anular_orden_pago(p_id bigint, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_op ordenes_pago%rowtype;
begin
  perform exigir_rol('CONTABILIDAD');
  select * into v_op from ordenes_pago where id = p_id for update;
  if not found then
    raise exception 'La orden de pago % no existe', p_id;
  end if;
  if v_op.estado not in ('BORRADOR', 'EN_TESORERIA') then
    raise exception 'La orden de pago % ya no se puede anular (estado %)', v_op.numero, v_op.estado;
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Debe indicar el motivo de anulación';
  end if;
  if exists (select 1 from pago_aplicaciones where orden_pago_id = p_id) then
    raise exception 'No se puede anular la orden de pago %: tiene pagos registrados', v_op.numero;
  end if;
  update ordenes_pago set estado = 'ANULADA', motivo_anulacion = btrim(p_motivo) where id = p_id;
end;
$function$;

-- asignar_cuenta_item: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.asignar_cuenta_item(p_item_id bigint, p_cuenta text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cuenta text := nullif(btrim(p_cuenta), '');
begin
  perform exigir_rol('CONTABILIDAD');
  if v_cuenta is not null and not exists (select 1 from cuentas_contables where codigo = v_cuenta) then
    raise exception 'La cuenta contable % no existe', v_cuenta;
  end if;
  update items set cuenta_contable = v_cuenta where id = p_item_id;
  if not found then
    raise exception 'El ítem % no existe', p_item_id;
  end if;
end;
$function$;

-- asignar_cuenta_items: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.asignar_cuenta_items(p_ids bigint[], p_cuenta text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_n integer;
begin
  perform exigir_rol('CONTABILIDAD');
  if not exists (select 1 from cuentas_contables where codigo = p_cuenta) then
    raise exception 'La cuenta % no existe', p_cuenta;
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Selecciona al menos un ítem';
  end if;
  update items set cuenta_contable = p_cuenta
   where id = any (p_ids) and cuenta_contable is distinct from p_cuenta;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- contabilizar_comprobante: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.contabilizar_comprobante(p_comprobante_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  perform exigir_rol('CONTABILIDAD');
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
$function$;

-- contabilizar_pago: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.contabilizar_pago(p_pago_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p pagos%rowtype;
  v_asiento bigint;
  v_sin text;
begin
  perform exigir_rol('CONTABILIDAD');
  select * into v_p from pagos where id = p_pago_id for update;
  if not found then
    raise exception 'El pago % no existe', p_pago_id;
  end if;
  if exists (select 1 from asientos where pago_id = p_pago_id and origen = 'PAGO') then
    raise exception 'El pago % ya está contabilizado', p_pago_id;
  end if;
  select string_agg(op.numero, ', ' order by op.numero) into v_sin
    from pago_aplicaciones a join ordenes_pago op on op.id = a.orden_pago_id
   where a.pago_id = p_pago_id and op.cuenta_contable is null;
  if v_sin is not null then
    raise exception 'Asigne la cuenta contable de la OP % antes de contabilizar el pago', v_sin;
  end if;

  insert into asientos (empresa_id, fecha, glosa, origen, pago_id)
  values (v_p.empresa_id, v_p.fecha,
          format('Pago op. %s %s', coalesce(v_p.numero_operacion, 's/n'), coalesce(v_p.banco, '')), 'PAGO', v_p.id)
  returning id into v_asiento;

  -- Debe: cuenta de la OP; 4241 para RxH; 4212 para el resto y para pagos a órdenes sin comprobante
  insert into asiento_lineas (asiento_id, cuenta, debe)
  select v_asiento,
         case when a.orden_pago_id is not null then op.cuenta_contable
              when c.tipo = 'RXH' then '4241'
              else '4212' end,
         sum(a.monto)
    from pago_aplicaciones a
    left join comprobantes c on c.id = a.comprobante_id
    left join ordenes_pago op on op.id = a.orden_pago_id
   where a.pago_id = p_pago_id
   group by 2;
  insert into asiento_lineas (asiento_id, cuenta, haber) values (v_asiento, '1041', v_p.monto);

  if (select sum(debe) - sum(haber) from asiento_lineas where asiento_id = v_asiento) <> 0 then
    raise exception 'Asiento descuadrado para el pago %', p_pago_id;
  end if;
  return v_asiento;
end;
$function$;

-- crear_orden_pago: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.crear_orden_pago(p_obra_id bigint, p_proveedor_id bigint, p_concepto text, p_monto numeric, p_fecha date, p_cuenta text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cuenta text := nullif(btrim(p_cuenta), '');
  v_monto numeric := round(p_monto, 2);
  v_n int;
  v_numero text;
begin
  perform exigir_rol('CONTABILIDAD');
  if not exists (select 1 from obras where id = p_obra_id) then
    raise exception 'La obra % no existe', p_obra_id;
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor_id) then
    raise exception 'El beneficiario % no existe', p_proveedor_id;
  end if;
  if nullif(btrim(p_concepto), '') is null then
    raise exception 'Debe indicar el concepto de la orden de pago';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto de la orden de pago debe ser mayor que cero';
  end if;
  if v_cuenta is not null and not exists (select 1 from cuentas_contables where codigo = v_cuenta) then
    raise exception 'La cuenta contable % no existe', v_cuenta;
  end if;

  -- correlativo por obra (serializado por obra)
  perform pg_advisory_xact_lock(hashtextextended('ordenes_pago:' || p_obra_id, 0));
  select coalesce(max(substring(numero from '^OP-(\d+)$')::int), 0) + 1 into v_n
    from ordenes_pago where obra_id = p_obra_id;
  v_numero := 'OP-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;

  insert into ordenes_pago (obra_id, numero, proveedor_id, concepto, monto, fecha, cuenta_contable)
  values (p_obra_id, v_numero, p_proveedor_id, btrim(p_concepto), v_monto, coalesce(p_fecha, current_date), v_cuenta);
  return v_numero;
end;
$function$;

-- enviar_op_a_tesoreria: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.enviar_op_a_tesoreria(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('CONTABILIDAD');
  update ordenes_pago set estado = 'EN_TESORERIA' where id = p_id and estado = 'BORRADOR';
  if not found then
    raise exception 'La orden de pago no está en borrador';
  end if;
end;
$function$;

-- emitir_guia: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.emitir_guia(p_id bigint, p_numero_guia text, p_archivo_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('CONTABILIDAD');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('CONTABILIDAD', 'ADMIN') then
    raise exception 'Solo Contabilidad emite la guía';
  end if;
  if nullif(btrim(p_numero_guia), '') is null or nullif(btrim(p_archivo_path), '') is null then
    raise exception 'Ingresa el N° de guía y sube el PDF';
  end if;
  update guias set estado = 'EMITIDA', numero_guia = upper(btrim(p_numero_guia)), archivo_path = p_archivo_path,
                   emitido_by = auth.uid(), emitido_at = now()
   where id = p_id and estado = 'SOLICITADA';
  if not found then
    raise exception 'La guía no está pendiente de emisión';
  end if;
end;
$function$;

-- marcar_guia_anulada: CONTABILIDAD
CREATE OR REPLACE FUNCTION public.marcar_guia_anulada(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('CONTABILIDAD');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('CONTABILIDAD', 'ADMIN') then
    raise exception 'Solo Contabilidad anula la guía';
  end if;
  update guias set estado = 'ANULADA', anulada_at = now() where id = p_id and estado = 'ANULACION_PENDIENTE';
  if not found then
    raise exception 'La guía no está pendiente de anulación';
  end if;
end;
$function$;

-- confirmar_precios: LOGISTICA
CREATE OR REPLACE FUNCTION public.confirmar_precios(p_obra_id bigint, p_numero text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_estado estado_oc;
  v_n int;
  v_sin int;
  v_sobre int;
begin
  perform exigir_rol('LOGISTICA');
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
  -- Si vuelve de un rechazo con su comprobante ya registrado, pasa directo a "Por enviar".
  update ordenes_compra
     set estado = case when exists (select 1 from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is null)
                       then 'PRECIOS_CONFIRMADOS'::estado_oc else 'FACTURADA'::estado_oc end
   where obra_id = p_obra_id and numero = p_numero;
  -- OS: glosa por defecto del recibo por honorarios (va en el contrato y se envía al proveedor).
  update ordenes_compra set glosa_rhe = glosa_rhe_defecto(p_obra_id, p_numero)
   where obra_id = p_obra_id and numero = p_numero and tipo = 'OS' and glosa_rhe is null;
end;
$function$;

-- crear_orden: LOGISTICA
CREATE OR REPLACE FUNCTION public.crear_orden(p_obra_id bigint, p_numero text, p_proveedor_id bigint, p_tipo tipo_orden, p_items jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_numero text;
  v_p record;
  r record;
  v_comp numeric;
begin
  perform exigir_rol('LOGISTICA');
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

  if exists (select 1 from jsonb_to_recordset(p_items) x(partida_id bigint)
              join partidas p on p.id = x.partida_id join items i on i.id = p.item_id
             where i.rubro = 'MANO OBRA') then
    raise exception 'La mano de obra se ordena desde una valorización de Operaciones';
  end if;
  if (select estado from obras where id = p_obra_id) = 'CERRADA' then
    raise exception 'La obra está cerrada';
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
    select p.obra_id, fn_presupuesto_efectivo(p.id) as cantidad, p.codigo into v_p
      from partidas p where p.id = r.partida_id for update;
    if not found then
      raise exception 'La partida % no existe', r.partida_id;
    end if;
    if v_p.obra_id <> p_obra_id then
      raise exception 'La partida % no pertenece a la obra de la orden', v_p.codigo;
    end if;
    -- Si la entrega de una orden se cerró incompleta, lo que no llegó vuelve al saldo.
    select coalesce(sum(case when o.entrega_cerrada_at is null then l.cantidad
                             else coalesce((select sum(en.cantidad) from entregas en where en.oc_item_id = l.id), 0) end), 0) into v_comp
      from oc_items l
      join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
     where l.partida_id = r.partida_id
       and o.estado not in ('ANULADA', 'BORRADOR')
       and not o.es_retencion;
    if r.cantidad > v_p.cantidad - v_comp then
      raise exception 'La cantidad solicitada (%) de la partida % excede su saldo disponible (%)',
        trim_scale(r.cantidad), v_p.codigo, trim_scale(v_p.cantidad - v_comp);
    end if;
  end loop;

  insert into ordenes_compra (obra_id, numero, tipo, proveedor_id, fecha, estado)
  values (p_obra_id, v_numero, coalesce(p_tipo, 'OC'), p_proveedor_id, current_date, 'EMITIDA');

  -- En la OS el precio de partida es el del presupuesto: Logística solo confirma lo que no cambie.
  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado)
  select p_obra_id, v_numero, x.partida_id, x.cantidad, case when coalesce(p_tipo, 'OC') = 'OS' then p.pu end
    from rows from (jsonb_to_recordset(p_items) as (partida_id bigint, cantidad numeric))
         with ordinality as x(partida_id, cantidad, n)
    join partidas p on p.id = x.partida_id
   order by x.n;

  return v_numero;
exception
  when unique_violation then
    raise exception 'Ya existe la orden % en esta obra', v_numero;
end;
$function$;

-- enviar_constancia: LOGISTICA
CREATE OR REPLACE FUNCTION public.enviar_constancia(p_obra_id bigint, p_numero text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('LOGISTICA');
  update ordenes_compra
     set estado = case when valorizacion_id is not null or es_retencion then 'RECIBIDA'::estado_oc else 'EN_ENTREGA'::estado_oc end
   where obra_id = p_obra_id and numero = p_numero and estado = 'PAGADA';
  if not found then
    raise exception 'La orden % no está pagada', p_numero;
  end if;
end;
$function$;

-- guardar_precios: LOGISTICA
CREATE OR REPLACE FUNCTION public.guardar_precios(p_obra_id bigint, p_numero text, p_precios jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_estado estado_oc;
  e jsonb;
  v_pu numeric;
  v_apr numeric;
begin
  perform exigir_rol('LOGISTICA');
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
$function$;

-- marcar_cotizacion_enviada: LOGISTICA
CREATE OR REPLACE FUNCTION public.marcar_cotizacion_enviada(p_obra_id bigint, p_numero text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('LOGISTICA');
  update ordenes_compra
     set cotizacion_estado = 'ENVIADA', cotizacion_enviada_at = now()
   where obra_id = p_obra_id and numero = p_numero
     and estado = 'EMITIDA' and cotizacion_estado = 'SIN_ENVIAR';
end;
$function$;

-- reenviar_cotizacion: LOGISTICA
CREATE OR REPLACE FUNCTION public.reenviar_cotizacion(p_obra_id bigint, p_numero text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_token uuid := gen_random_uuid();
begin
  perform exigir_rol('LOGISTICA');
  update ordenes_compra
     set token_cotizacion = v_token, cotizacion_estado = 'ENVIADA', cotizacion_enviada_at = now(),
         cotizacion_recibida_at = null
   where obra_id = p_obra_id and numero = p_numero and estado = 'EMITIDA';
  if not found then
    raise exception 'La orden % ya no está en cotización', p_numero;
  end if;
  return v_token;
end;
$function$;

-- registrar_comprobante: LOGISTICA
CREATE OR REPLACE FUNCTION public.registrar_comprobante(p_proveedor_id bigint, p_tipo tipo_comprobante, p_serie text, p_numero text, p_fecha date, p_total numeric, p_retencion numeric, p_archivo_path text, p_item_ids bigint[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_serie text := upper(btrim(p_serie));
  v_numero text := upper(btrim(p_numero));
  v_ret numeric := coalesce(p_retencion, 0);
  v_n int;
  v_empresa bigint;
  v_id bigint;
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
$function$;

-- editar_comprobante: LOGISTICA
CREATE OR REPLACE FUNCTION public.editar_comprobante(p_id bigint, p_tipo tipo_comprobante, p_serie text, p_numero text, p_fecha date, p_total numeric, p_retencion numeric, p_archivo_path text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c comprobantes%rowtype;
  v_antes jsonb;
  v_despues jsonb;
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
  if p_total is null or p_total <= 0 or coalesce(p_retencion, 0) < 0 or coalesce(p_retencion, 0) >= p_total then
    raise exception 'Revisa el total y la retención';
  end if;

  v_antes := jsonb_build_object('tipo', c.tipo, 'serie', c.serie, 'numero', c.numero, 'fecha_emision', c.fecha_emision,
                                'total', c.total, 'retencion', c.retencion, 'archivo_path', c.archivo_path);
  update comprobantes
     set tipo = p_tipo, serie = upper(btrim(p_serie)), numero = coalesce(nullif(ltrim(btrim(p_numero), '0'), ''), '0'),
         fecha_emision = p_fecha, total = round(p_total, 2), retencion = round(coalesce(p_retencion, 0), 2),
         archivo_path = coalesce(nullif(btrim(p_archivo_path), ''), archivo_path),
         -- el trigger vuelve a calcular base e IGV
         base = null, igv = null,
         periodo_anotacion = greatest(periodo_anotacion, to_char(p_fecha, 'YYYYMM'))
   where id = p_id
  returning jsonb_build_object('tipo', tipo, 'serie', serie, 'numero', numero, 'fecha_emision', fecha_emision,
                               'total', total, 'retencion', retencion, 'archivo_path', archivo_path) into v_despues;
  if v_antes is distinct from v_despues then
    insert into comprobantes_historial (comprobante_id, anterior, nuevo, motivo)
    values (p_id, v_antes, v_despues, nullif(btrim(coalesce(p_motivo, '')), ''));
  end if;
exception when unique_violation then
  raise exception 'Ya existe un comprobante con esa serie y número para el proveedor';
end;
$function$;

-- enviar_a_tesoreria: LOGISTICA
CREATE OR REPLACE FUNCTION public.enviar_a_tesoreria(p_obra_id bigint, p_numero text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_o ordenes_compra%rowtype;
  v_sobre int;
  v_bajo int;
begin
  perform exigir_rol('LOGISTICA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística envía órdenes a Tesorería';
  end if;
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe', p_numero;
  end if;
  if v_o.estado <> 'FACTURADA' then
    raise exception 'La orden % no está lista para enviar (estado %): todas sus líneas deben tener comprobante', p_numero, v_o.estado;
  end if;
  if v_o.tipo = 'OS' and not v_o.es_retencion and not exists (
       select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero) then
    raise exception 'Falta el contrato firmado de la OS %', p_numero;
  end if;
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = p_obra_id and numero = p_numero;

  if v_o.tipo = 'OS' then
    select count(*) filter (where pu_efectivo > pu_partida + 0.0001), count(*) filter (where pu_efectivo < pu_partida - 0.0001)
      into v_sobre, v_bajo
      from v_oc_items_calc where obra_id = p_obra_id and numero_oc = p_numero;
    if v_sobre + v_bajo > 0 then
      perform notificar('TESORERIA', 'OS_PRECIO',
        format('OS %s con precios distintos al presupuesto', p_numero),
        concat_ws(', ',
          case when v_sobre > 0 then format('%s sobre el presupuesto', v_sobre) end,
          case when v_bajo > 0 then format('%s por debajo (ahorro)', v_bajo) end),
        format('/tesoreria/pago/%s/%s', p_obra_id, p_numero));
    end if;
  end if;
end;
$function$;

-- set_requiere_guia: LOGISTICA
CREATE OR REPLACE FUNCTION public.set_requiere_guia(p_obra_id bigint, p_numero text, p_requiere boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_o ordenes_compra%rowtype;
begin
  perform exigir_rol('LOGISTICA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística decide si la orden lleva guía';
  end if;
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe', p_numero;
  end if;
  if v_o.tipo <> 'OC' then
    raise exception 'Solo las órdenes de compra llevan guía de remisión';
  end if;
  if not p_requiere and exists (select 1 from guias where obra_id = p_obra_id and numero_oc = p_numero and estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then
    raise exception 'La guía ya fue emitida: anula la orden o pide a Contabilidad que la anule';
  end if;
  update ordenes_compra set requiere_guia = p_requiere where obra_id = p_obra_id and numero = p_numero;
  if not p_requiere then
    update guias set estado = 'ANULADA', anulada_at = now()
     where obra_id = p_obra_id and numero_oc = p_numero and estado = 'SOLICITADA';
  end if;
end;
$function$;

-- solicitar_guia: LOGISTICA
CREATE OR REPLACE FUNCTION public.solicitar_guia(p_obra_id bigint, p_numero text, p_datos jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_o ordenes_compra%rowtype;
  v_t transportistas%rowtype;
  v_modalidad text := coalesce(nullif(p_datos->>'modalidad', ''), 'TERCERO');
  v_ruc_t text;
  v_nombre_t text;
  v_id bigint;
  v_nueva boolean;
begin
  perform exigir_rol('LOGISTICA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística pide la guía';
  end if;
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found or v_o.tipo <> 'OC' or not v_o.requiere_guia then
    raise exception 'La orden no requiere guía de remisión';
  end if;
  if v_o.estado in ('BORRADOR', 'EMITIDA', 'ANULADA') then
    raise exception 'La guía se pide con la orden cotizada (estado %)', v_o.estado;
  end if;
  -- Quién transporta: el proveedor con su unidad, nosotros, o un transportista que contrata el proveedor.
  if v_modalidad not in ('PROVEEDOR', 'PROPIO', 'TERCERO') then
    raise exception 'Modalidad de transporte inválida';
  end if;
  if v_modalidad = 'TERCERO' then
    select * into v_t from transportistas where id = (p_datos->>'transportista_id')::bigint;
    if not found then
      raise exception 'Elige el transportista';
    end if;
    v_ruc_t := v_t.ruc;
    v_nombre_t := v_t.razon_social;
  elsif v_modalidad = 'PROVEEDOR' then
    select ruc_o_cod, razon_social into v_ruc_t, v_nombre_t from proveedores where id = v_o.proveedor_id;
  else
    select e.ruc, e.nombre into v_ruc_t, v_nombre_t from obras ob join empresas e on e.id = ob.empresa_id where ob.id = p_obra_id;
  end if;
  if exists (select 1 from guias where obra_id = p_obra_id and numero_oc = p_numero and estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then
    raise exception 'La guía ya fue emitida';
  end if;
  if nullif(btrim(p_datos->>'punto_partida'), '') is null or nullif(btrim(p_datos->>'punto_llegada'), '') is null
     or nullif(btrim(p_datos->>'placa'), '') is null or nullif(btrim(p_datos->>'licencia'), '') is null
     or nullif(btrim(p_datos->>'detalle'), '') is null or (p_datos->>'fecha_traslado') is null then
    raise exception 'Completa todos los datos de la guía';
  end if;

  select id into v_id from guias where obra_id = p_obra_id and numero_oc = p_numero and estado = 'SOLICITADA';
  v_nueva := v_id is null;
  if v_nueva then
    insert into guias (obra_id, numero_oc, modalidad, punto_partida, punto_llegada, ruc_remitente, transportista_id, ruc_transportista,
                       transportista, placa, licencia, detalle, fecha_traslado)
    values (p_obra_id, p_numero, v_modalidad, btrim(p_datos->>'punto_partida'), btrim(p_datos->>'punto_llegada'),
            (select ruc_o_cod from proveedores where id = v_o.proveedor_id), v_t.id, coalesce(v_ruc_t, ''), coalesce(v_nombre_t, ''),
            upper(btrim(p_datos->>'placa')), upper(btrim(p_datos->>'licencia')), btrim(p_datos->>'detalle'),
            (p_datos->>'fecha_traslado')::date)
    returning id into v_id;
  else
    update guias set modalidad = v_modalidad, punto_partida = btrim(p_datos->>'punto_partida'), punto_llegada = btrim(p_datos->>'punto_llegada'),
                     transportista_id = v_t.id, ruc_transportista = coalesce(v_ruc_t, ''), transportista = coalesce(v_nombre_t, ''),
                     placa = upper(btrim(p_datos->>'placa')), licencia = upper(btrim(p_datos->>'licencia')),
                     detalle = btrim(p_datos->>'detalle'), fecha_traslado = (p_datos->>'fecha_traslado')::date
     where id = v_id;
  end if;
  perform notificar('CONTABILIDAD', 'GUIA_SOLICITADA',
                    format(case when v_nueva then 'Guía solicitada: OC %s' else 'Guía corregida: OC %s' end, p_numero),
                    (select razon_social from proveedores where id = v_o.proveedor_id), '/contabilidad/guias');
  return v_id;
end;
$function$;

-- anular_orden: LOGISTICA, GERENCIA
CREATE OR REPLACE FUNCTION public.anular_orden(p_obra_id bigint, p_numero text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_estado estado_oc;
begin
  perform exigir_rol('LOGISTICA', 'GERENCIA');
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

  -- Guía: si ya se emitió en SUNAT, Contabilidad debe anularla allá; si solo estaba pedida, se cancela.
  update guias set estado = 'ANULACION_PENDIENTE'
   where obra_id = p_obra_id and numero_oc = p_numero and estado = 'EMITIDA';
  if found then
    perform notificar('CONTABILIDAD', 'GUIA_ANULAR', format('Anular en SUNAT la guía de la OC %s', p_numero),
                      'La orden de compra fue anulada', '/contabilidad/guias?est=anu');
  end if;
  update guias set estado = 'ANULADA', anulada_at = now()
   where obra_id = p_obra_id and numero_oc = p_numero and estado = 'SOLICITADA';
end;
$function$;

-- cerrar_entrega: GERENCIA
CREATE OR REPLACE FUNCTION public.cerrar_entrega(p_obra_id bigint, p_numero text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('GERENCIA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Operaciones cierra una entrega incompleta';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo';
  end if;
  update ordenes_compra
     set estado = 'RECIBIDA', entrega_cerrada_at = now(), entrega_cerrada_motivo = btrim(p_motivo), entrega_cerrada_by = auth.uid()
   where obra_id = p_obra_id and numero = p_numero and estado = 'EN_ENTREGA';
  if not found then
    raise exception 'La orden % no está en entrega', p_numero;
  end if;
  perform notificar('LOGISTICA', 'ENTREGA_CERRADA', format('Entrega cerrada incompleta: %s', p_numero), btrim(p_motivo),
                    format('/logistica/ordenes/%s/%s', p_obra_id, p_numero));
end;
$function$;

-- pagar_documento: TESORERIA
CREATE OR REPLACE FUNCTION public.pagar_documento(p_obra_id bigint, p_numero text, p_orden_pago_id bigint, p_fecha date, p_banco text, p_numero_operacion text, p_monto numeric, p_voucher_path text, p_voucher_nombre text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_path text := nullif(btrim(p_voucher_path), '');
  v_numero text := nullif(btrim(p_numero), '');
  v_monto numeric := round(p_monto, 2);
  v_emp bigint;
  v_estado estado_oc;
  v_op ordenes_pago%rowtype;
  v_aplic jsonb := '[]'::jsonb;
  v_saldo numeric;
  v_rest numeric;
  v_a numeric;
  v_pago bigint;
  v_ext text;
  r record;
begin
  perform exigir_rol('TESORERIA');
  if nullif(btrim(p_numero_operacion), '') is null then
    raise exception 'Debe indicar el N° de operación';
  end if;
  if v_path is null then
    raise exception 'Debe adjuntar el voucher del pago';
  end if;
  if exists (select 1 from adjuntos where path = v_path) then
    raise exception 'El archivo % ya está registrado', v_path;
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'El monto del pago debe ser mayor que cero';
  end if;
  if not ((p_orden_pago_id is not null and p_obra_id is null and v_numero is null)
       or (p_orden_pago_id is null and p_obra_id is not null and v_numero is not null)) then
    raise exception 'Indique la orden (obra y número) o la orden de pago, solo una de ellas';
  end if;

  if p_orden_pago_id is not null then
    select * into v_op from ordenes_pago where id = p_orden_pago_id for update;
    if not found then
      raise exception 'La orden de pago % no existe', p_orden_pago_id;
    end if;
    select empresa_id into v_emp from obras where id = v_op.obra_id;
    v_aplic := jsonb_build_array(jsonb_build_object('orden_pago_id', v_op.id, 'monto', v_monto));
  else
    select ob.empresa_id, o.estado into v_emp, v_estado
      from ordenes_compra o join obras ob on ob.id = o.obra_id
     where o.obra_id = p_obra_id and o.numero = v_numero
       for update of o;
    if not found then
      raise exception 'La orden % no existe en la obra', v_numero;
    end if;
    if v_estado <> 'EN_TESORERIA' then
      raise exception 'La orden % no está en Tesorería (estado %)', v_numero, v_estado;
    end if;

    select p.saldo into v_saldo from v_por_pagar p
     where p.doc in ('OC', 'OS') and p.obra_id = p_obra_id and p.numero = v_numero;
    v_saldo := coalesce(v_saldo, 0);
    if v_saldo <= 0.005 then
      raise exception 'La orden % no tiene saldo por pagar', v_numero;
    end if;
    if v_monto > v_saldo then
      raise exception 'El monto % excede el saldo por pagar (%) de la orden %', v_monto, v_saldo, v_numero;
    end if;

    v_rest := v_monto;
    for r in select comprobante_id, saldo_orden
               from v_orden_comprobantes
              where obra_id = p_obra_id and numero_oc = v_numero and saldo_orden > 0
              order by fecha_emision, comprobante_id loop
      exit when v_rest <= 0;
      v_a := least(v_rest, r.saldo_orden);
      v_aplic := v_aplic || jsonb_build_object('comprobante_id', r.comprobante_id, 'monto', v_a);
      v_rest := v_rest - v_a;
    end loop;
    if v_rest > 0 then   -- resto <= líneas sin comprobante - pagos directos (por el tope de v_por_pagar)
      v_aplic := v_aplic || jsonb_build_object('obra_id', p_obra_id, 'numero_oc', v_numero, 'monto', v_rest);
    end if;
  end if;

  v_pago := registrar_pago(v_emp, p_fecha, p_banco, p_numero_operacion, v_aplic);

  v_ext := lower(substring(v_path from '\.([A-Za-z0-9]+)$'));
  insert into adjuntos (tipo, obra_id, numero_oc, pago_id, orden_pago_id, path, nombre, mime)
  values ('VOUCHER',
          case when p_orden_pago_id is null then p_obra_id end,
          case when p_orden_pago_id is null then v_numero end,
          v_pago,
          p_orden_pago_id,
          v_path,
          coalesce(nullif(btrim(p_voucher_nombre), ''), regexp_replace(v_path, '^.*/', '')),
          case v_ext when 'pdf' then 'application/pdf' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
                     when 'png' then 'image/png' when 'webp' then 'image/webp' when 'heic' then 'image/heic' end);

  -- con el voucher ya registrado (atribución del pago), la orden sin saldo pasa a PAGADA aunque un
  -- comprobante compartido con otra orden siga con saldo
  if p_orden_pago_id is null
     and (select p.saldo from v_por_pagar p
           where p.doc in ('OC', 'OS') and p.obra_id = p_obra_id and p.numero = v_numero) <= 0.005 then
    update ordenes_compra set estado = 'PAGADA'
     where obra_id = p_obra_id and numero = v_numero and estado = 'EN_TESORERIA';
  end if;
  return v_pago;
end;
$function$;

-- registrar_pago: TESORERIA
CREATE OR REPLACE FUNCTION public.registrar_pago(p_empresa_id bigint, p_fecha date, p_banco text, p_numero_operacion text, p_aplicaciones jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  v_emp bigint;
  v_estado estado_oc;
  v_op_estado text;
  v_op_numero text;
  v_saldo numeric;
  v_total numeric := 0;
  v_id bigint;
  v_aplic jsonb;
begin
  perform exigir_rol('TESORERIA');
  if not exists (select 1 from empresas where id = p_empresa_id) then
    raise exception 'La empresa % no existe', p_empresa_id;
  end if;
  if p_fecha is null then
    raise exception 'Debe indicar la fecha del pago';
  end if;
  if p_aplicaciones is null or jsonb_typeof(p_aplicaciones) <> 'array' or jsonb_array_length(p_aplicaciones) = 0 then
    raise exception 'El pago debe tener al menos una aplicación';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_aplicaciones)
                           x(comprobante_id bigint, obra_id bigint, numero_oc text, orden_pago_id bigint, monto numeric)
              where x.monto is null or x.monto <= 0) then
    raise exception 'Cada aplicación requiere un monto mayor que cero';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_aplicaciones)
                           x(comprobante_id bigint, obra_id bigint, numero_oc text, orden_pago_id bigint, monto numeric)
              where not ((x.comprobante_id is not null and x.obra_id is null and x.numero_oc is null and x.orden_pago_id is null)
                      or (x.comprobante_id is null and x.obra_id is not null and x.numero_oc is not null and x.orden_pago_id is null)
                      or (x.comprobante_id is null and x.obra_id is null and x.numero_oc is null and x.orden_pago_id is not null))) then
    raise exception 'Cada aplicación debe indicar un solo destino: comprobante_id, obra_id y numero_oc, u orden_pago_id';
  end if;

  -- agrupa por destino (comprobante, orden u orden de pago)
  select jsonb_agg(jsonb_build_object('comprobante_id', g.comprobante_id, 'obra_id', g.obra_id,
                                      'numero_oc', g.numero_oc, 'orden_pago_id', g.orden_pago_id, 'monto', g.monto))
    into v_aplic
    from (select x.comprobante_id, x.obra_id, x.numero_oc, x.orden_pago_id, sum(x.monto) as monto
            from jsonb_to_recordset(p_aplicaciones)
                 x(comprobante_id bigint, obra_id bigint, numero_oc text, orden_pago_id bigint, monto numeric)
           group by 1, 2, 3, 4) g;

  for r in select * from jsonb_to_recordset(v_aplic)
                         x(comprobante_id bigint, obra_id bigint, numero_oc text, orden_pago_id bigint, monto numeric)
            order by x.comprobante_id nulls last, x.obra_id nulls last, x.numero_oc, x.orden_pago_id loop
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
    elsif r.orden_pago_id is not null then
      select ob.empresa_id, op.estado, op.numero,
             op.monto - coalesce((select sum(ap.monto) from pago_aplicaciones ap where ap.orden_pago_id = op.id), 0)
        into v_emp, v_op_estado, v_op_numero, v_saldo
        from ordenes_pago op join obras ob on ob.id = op.obra_id
       where op.id = r.orden_pago_id
         for update of op;
      if not found then
        raise exception 'La orden de pago % no existe', r.orden_pago_id;
      end if;
      if v_emp <> p_empresa_id then
        raise exception 'La orden de pago % pertenece a otra empresa', v_op_numero;
      end if;
      if v_op_estado <> 'EN_TESORERIA' then
        raise exception 'La orden de pago % no está en Tesorería (estado %)', v_op_numero, v_op_estado;
      end if;
      if r.monto > v_saldo + 0.005 then
        raise exception 'El monto % excede el saldo pendiente (%) de la orden de pago %', r.monto, v_saldo, v_op_numero;
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
      if v_estado <> 'EN_TESORERIA' then
        raise exception 'La orden % no está en Tesorería (estado %)', r.numero_oc, v_estado;
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

  insert into pago_aplicaciones (pago_id, comprobante_id, obra_id, numero_oc, orden_pago_id, monto)
  select v_id, x.comprobante_id, x.obra_id, x.numero_oc, x.orden_pago_id, x.monto
    from jsonb_to_recordset(v_aplic)
         x(comprobante_id bigint, obra_id bigint, numero_oc text, orden_pago_id bigint, monto numeric);

  -- órdenes cubiertas al 100% -> PAGADA
  update ordenes_compra o set estado = 'PAGADA'
    from v_ordenes v
   where v.obra_id = o.obra_id and v.numero = o.numero
     and o.estado = 'EN_TESORERIA'
     and v.total > 0
     and v.pagado >= v.total - 0.005
     and (o.obra_id, o.numero) in (
           select ap.obra_id, ap.numero_oc from pago_aplicaciones ap where ap.pago_id = v_id and ap.obra_id is not null
           union
           select l.obra_id, l.numero_oc from oc_items l
             join pago_aplicaciones ap on ap.comprobante_id = l.comprobante_id
            where ap.pago_id = v_id);

  -- órdenes de pago cubiertas al 100% -> PAGADA
  update ordenes_pago op set estado = 'PAGADA'
   where op.estado = 'EN_TESORERIA'
     and op.id in (select ap.orden_pago_id from pago_aplicaciones ap where ap.pago_id = v_id and ap.orden_pago_id is not null)
     and (select sum(ap.monto) from pago_aplicaciones ap where ap.orden_pago_id = op.id) >= op.monto - 0.005;
  return v_id;
end;
$function$;

-- rechazar_documento: TESORERIA
CREATE OR REPLACE FUNCTION public.rechazar_documento(p_obra_id bigint, p_numero text, p_orden_pago_id bigint, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_o ordenes_compra%rowtype;
  v_op ordenes_pago%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  perform exigir_rol('TESORERIA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('TESORERIA', 'ADMIN') then
    raise exception 'Solo Tesorería puede rechazar';
  end if;
  if p_orden_pago_id is not null then
    select * into v_op from ordenes_pago where id = p_orden_pago_id for update;
    if not found or v_op.estado <> 'EN_TESORERIA' then
      raise exception 'La orden de pago no está en Tesorería';
    end if;
    update ordenes_pago set estado = 'BORRADOR' where id = p_orden_pago_id;
    insert into rechazos (doc, orden_pago_id, motivo, estado_previo, estado_destino)
    values ('OP', p_orden_pago_id, v_motivo, 'EN_TESORERIA', 'BORRADOR');
    perform notificar('CONTABILIDAD', 'RECHAZO', format('Tesorería rechazó la %s', v_op.numero), v_motivo,
                      format('/contabilidad/op/%s', p_orden_pago_id));
  else
    select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
    if not found or v_o.estado <> 'EN_TESORERIA' then
      raise exception 'La orden % no está en Tesorería', p_numero;
    end if;
    -- Vuelve a cotización: los precios y el comprobante quedan registrados para corregirlos. El link
    -- se renueva (muestra la cotización recibida; "Reenviar" lo abre para que el proveedor corrija).
    update ordenes_compra
       set estado = 'EMITIDA', token_cotizacion = gen_random_uuid(),
           cotizacion_estado = case when cotizacion_estado = 'SIN_ENVIAR' then 'SIN_ENVIAR'::cotizacion_estado else 'RECIBIDA'::cotizacion_estado end
     where obra_id = p_obra_id and numero = p_numero;
    insert into rechazos (doc, obra_id, numero, motivo, estado_previo, estado_destino)
    values (v_o.tipo::text, p_obra_id, p_numero, v_motivo, 'EN_TESORERIA', 'EMITIDA');
    perform notificar('LOGISTICA', 'RECHAZO', format('Tesorería rechazó la %s %s: vuelve a cotización', v_o.tipo, p_numero), v_motivo,
                      format('/logistica/ordenes/%s/%s', p_obra_id, p_numero));
  end if;
end;
$function$;

-- Ejecución: nada para anon/public salvo la cotización por link; el hook de login solo para Auth.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
grant execute on function public.get_cotizacion(uuid) to anon;
grant execute on function public.enviar_cotizacion(uuid,jsonb) to anon;
revoke execute on function public.fn_perfil_a_token() from authenticated;
grant execute on function public.fn_perfil_a_token() to supabase_auth_admin;
revoke execute on function public.notificar(text,text,text,text,text) from authenticated;
revoke execute on function public.notificar_usuario(uuid,text,text,text,text) from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Tablas: lectura para todos (el residente sigue con sus restricciones) y escritura por rol.
drop policy if exists asiento_lineas_authenticated_all on public.asiento_lineas;
create policy asiento_lineas_select on public.asiento_lineas for select to authenticated using (true);
drop policy if exists asientos_authenticated_all on public.asientos;
create policy asientos_select on public.asientos for select to authenticated using (true);
drop policy if exists comprobantes_authenticated_all on public.comprobantes;
create policy comprobantes_select on public.comprobantes for select to authenticated using (true);
drop policy if exists cuentas_contables_authenticated_all on public.cuentas_contables;
create policy cuentas_contables_select on public.cuentas_contables for select to authenticated using (true);
drop policy if exists empresas_authenticated_all on public.empresas;
create policy empresas_select on public.empresas for select to authenticated using (true);
drop policy if exists etapas_authenticated_all on public.etapas;
create policy etapas_select on public.etapas for select to authenticated using (true);
drop policy if exists items_authenticated_all on public.items;
create policy items_select on public.items for select to authenticated using (true);
drop policy if exists obras_authenticated_all on public.obras;
create policy obras_select on public.obras for select to authenticated using (true);
drop policy if exists oc_items_authenticated_all on public.oc_items;
create policy oc_items_select on public.oc_items for select to authenticated using (true);
drop policy if exists ordenes_compra_authenticated_all on public.ordenes_compra;
create policy ordenes_compra_select on public.ordenes_compra for select to authenticated using (true);
drop policy if exists ordenes_pago_authenticated_all on public.ordenes_pago;
create policy ordenes_pago_select on public.ordenes_pago for select to authenticated using (true);
drop policy if exists pago_aplicaciones_authenticated_all on public.pago_aplicaciones;
create policy pago_aplicaciones_select on public.pago_aplicaciones for select to authenticated using (true);
drop policy if exists pagos_authenticated_all on public.pagos;
create policy pagos_select on public.pagos for select to authenticated using (true);
drop policy if exists partidas_authenticated_all on public.partidas;
create policy partidas_select on public.partidas for select to authenticated using (true);
drop policy if exists perfil_obras_authenticated_all on public.perfil_obras;
create policy perfil_obras_select on public.perfil_obras for select to authenticated using (true);
drop policy if exists perfiles_authenticated_all on public.perfiles;
create policy perfiles_select on public.perfiles for select to authenticated using (true);
drop policy if exists proveedor_contactos_authenticated_all on public.proveedor_contactos;
create policy proveedor_contactos_select on public.proveedor_contactos for select to authenticated using (true);
drop policy if exists proveedor_tipos_material_authenticated_all on public.proveedor_tipos_material;
create policy proveedor_tipos_material_select on public.proveedor_tipos_material for select to authenticated using (true);
drop policy if exists proveedores_authenticated_all on public.proveedores;
create policy proveedores_select on public.proveedores for select to authenticated using (true);
drop policy if exists requerimientos_authenticated_all on public.requerimientos;
create policy requerimientos_select on public.requerimientos for select to authenticated using (true);
drop policy if exists tipos_material_authenticated_all on public.tipos_material;
create policy tipos_material_select on public.tipos_material for select to authenticated using (true);
drop policy if exists transportistas_authenticated_all on public.transportistas;
create policy transportistas_select on public.transportistas for select to authenticated using (true);
create policy items_insert on public.items for insert to authenticated with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy items_update on public.items for update to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN')) with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedores_insert on public.proveedores for insert to authenticated with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedores_update on public.proveedores for update to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN')) with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedores_delete on public.proveedores for delete to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedor_contactos_insert on public.proveedor_contactos for insert to authenticated with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedor_contactos_update on public.proveedor_contactos for update to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN')) with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedor_contactos_delete on public.proveedor_contactos for delete to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedor_tipos_material_insert on public.proveedor_tipos_material for insert to authenticated with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedor_tipos_material_update on public.proveedor_tipos_material for update to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN')) with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy proveedor_tipos_material_delete on public.proveedor_tipos_material for delete to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy tipos_material_insert on public.tipos_material for insert to authenticated with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy tipos_material_update on public.tipos_material for update to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN')) with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy tipos_material_delete on public.tipos_material for delete to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy transportistas_insert on public.transportistas for insert to authenticated with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy transportistas_update on public.transportistas for update to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN')) with check ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy transportistas_delete on public.transportistas for delete to authenticated using ((select rol_actual()) in ('LOGISTICA', 'ADMIN'));
create policy cuentas_contables_insert on public.cuentas_contables for insert to authenticated with check ((select rol_actual()) in ('CONTABILIDAD', 'ADMIN'));
create policy cuentas_contables_update on public.cuentas_contables for update to authenticated using ((select rol_actual()) in ('CONTABILIDAD', 'ADMIN')) with check ((select rol_actual()) in ('CONTABILIDAD', 'ADMIN'));
create policy ordenes_pago_update on public.ordenes_pago for update to authenticated using ((select rol_actual()) in ('CONTABILIDAD', 'ADMIN')) with check ((select rol_actual()) in ('CONTABILIDAD', 'ADMIN'));

-- Storage. Residente: solo las fotos de entregas y avances de sus obras (y los adjuntos que ya
-- puede ver). Los demás: todo el bucket documentos; los comprobantes no son para el residente.
create or replace function public.ruta_obra_residente(p_name text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select split_part(p_name, '/', 1) in ('entregas', 'avances')
     and split_part(p_name, '/', 2) ~ '^[0-9]+$'
     and split_part(p_name, '/', 2)::bigint in (select obras_residente())
$$;
revoke execute on function public.ruta_obra_residente(text) from public, anon;
grant execute on function public.ruta_obra_residente(text) to authenticated;

drop policy if exists documentos_select on storage.objects;
drop policy if exists documentos_insert on storage.objects;
drop policy if exists documentos_delete on storage.objects;
drop policy if exists comprobantes_select on storage.objects;
drop policy if exists comprobantes_insert on storage.objects;
drop policy if exists comprobantes_update on storage.objects;
drop policy if exists comprobantes_delete on storage.objects;

create policy documentos_select on storage.objects for select to authenticated using (
  bucket_id = 'documentos'
  and (not (select public.es_residente())
       or public.ruta_obra_residente(name)
       or exists (select 1 from public.adjuntos a where a.path = storage.objects.name))
);
create policy documentos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos' and (not (select public.es_residente()) or public.ruta_obra_residente(name))
);
create policy documentos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'documentos' and owner_id = (select auth.uid())::text
);
create policy comprobantes_select on storage.objects for select to authenticated using (
  bucket_id = 'comprobantes' and not (select public.es_residente())
);
create policy comprobantes_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'comprobantes' and not (select public.es_residente())
);
create policy comprobantes_update on storage.objects for update to authenticated
  using (bucket_id = 'comprobantes' and owner_id = (select auth.uid())::text)
  with check (bucket_id = 'comprobantes' and owner_id = (select auth.uid())::text);
create policy comprobantes_delete on storage.objects for delete to authenticated using (
  bucket_id = 'comprobantes' and owner_id = (select auth.uid())::text
);
