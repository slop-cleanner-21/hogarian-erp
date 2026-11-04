-- Prod 1: sin Contabilidad, Residente ni Ingeniero de Operaciones.
-- * Logística registra la guía de remisión completa (datos, N° y PDF) en un solo paso, y la marca
--   como anulada en SUNAT cuando se anula la OC.
-- * Logística crea las OS de mano de obra directo, como las de subcontrato (sin valorizaciones).

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
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.marcar_guia_anulada(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform exigir_rol('LOGISTICA');
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('LOGISTICA', 'ADMIN') then
    raise exception 'Solo Logística marca la guía como anulada';
  end if;
  update guias set estado = 'ANULADA', anulada_at = now() where id = p_id and estado = 'ANULACION_PENDIENTE';
  if not found then
    raise exception 'La guía no está pendiente de anulación';
  end if;
end;
$function$;

-- Datos del traslado + N° de guía + PDF: queda emitida de una vez.
create or replace function public.registrar_guia(p_obra_id bigint, p_numero text, p_datos jsonb, p_numero_guia text, p_archivo_path text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  perform exigir_rol('LOGISTICA');
  if nullif(btrim(p_numero_guia), '') is null or nullif(btrim(p_archivo_path), '') is null then
    raise exception 'Ingresa el N° de guía y sube la guía';
  end if;
  if p_archivo_path not like format('guias/%s/%s/%%', p_obra_id, p_numero) then
    raise exception 'Archivo de guía inválido';
  end if;
  v_id := solicitar_guia(p_obra_id, p_numero, p_datos);
  update guias set estado = 'EMITIDA', numero_guia = upper(btrim(p_numero_guia)), archivo_path = p_archivo_path,
                   emitido_by = auth.uid(), emitido_at = now()
   where id = v_id;
  return v_id;
end;
$$;

revoke execute on function public.registrar_guia(bigint, text, jsonb, text, text) from public, anon;
grant execute on function public.registrar_guia(bigint, text, jsonb, text, text) to authenticated, service_role;
