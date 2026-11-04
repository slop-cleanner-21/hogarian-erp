-- Observación en las entregas: el residente (o Logística) marca un registro como observado
-- (material dañado, imprevisto…) con un texto. Se avisa a Logística y a Operaciones.
alter table public.entregas add column if not exists observacion text;

drop function if exists public.registrar_entrega(bigint, numeric, text[], double precision, double precision, double precision, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.registrar_entrega(p_oc_item_id bigint, p_cantidad numeric, p_fotos text[], p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_precision double precision DEFAULT NULL::double precision, p_capturado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_observacion text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rol text := (select rol::text from perfiles where user_id = auth.uid());
  v_l oc_items%rowtype;
  v_estado estado_oc;
  v_entregado numeric;
  v_id bigint;
  v_obs text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_tipo tipo_orden;
  f text;
begin
  if v_rol is null or v_rol not in ('LOGISTICA', 'RESIDENTE', 'ADMIN') then
    raise exception 'Solo Logística y los residentes registran entregas';
  end if;
  select * into v_l from oc_items where id = p_oc_item_id for update;
  if not found then
    raise exception 'La línea de la orden no existe';
  end if;
  select estado into v_estado from ordenes_compra where obra_id = v_l.obra_id and numero = v_l.numero_oc for update;
  if v_estado <> 'EN_ENTREGA' then
    raise exception 'La orden % no está en entrega (estado %)', v_l.numero_oc, v_estado;
  end if;
  if v_rol = 'RESIDENTE' then
    if v_l.obra_id not in (select obras_residente()) then
      raise exception 'La obra no está asignada a este residente';
    end if;
    if p_lat is null or p_lng is null then
      raise exception 'Activa la ubicación del teléfono para registrar la entrega';
    end if;
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Ingresa la cantidad que llegó';
  end if;
  if p_fotos is null or cardinality(p_fotos) = 0 then
    raise exception 'Agrega al menos una foto';
  end if;
  select coalesce(sum(cantidad), 0) into v_entregado from entregas where oc_item_id = p_oc_item_id;
  if v_entregado + p_cantidad > v_l.cantidad + 0.0001 then
    raise exception 'Solo faltan % por llegar', v_l.cantidad - v_entregado;
  end if;

  insert into entregas (obra_id, numero_oc, oc_item_id, cantidad, rol, lat, lng, precision_m, capturado_en, observacion)
  values (v_l.obra_id, v_l.numero_oc, p_oc_item_id, p_cantidad, v_rol, p_lat, p_lng, p_precision, p_capturado, v_obs)
  returning id into v_id;
  foreach f in array p_fotos loop
    if f is null or f !~ ('^entregas/' || v_l.obra_id || '/') then
      raise exception 'Ruta de foto inválida';
    end if;
    insert into entrega_fotos (entrega_id, path) values (v_id, f);
  end loop;

  -- Con observación (material dañado, imprevisto…): avisa a Logística y a Operaciones.
  if v_obs is not null then
    select tipo into v_tipo from ordenes_compra where obra_id = v_l.obra_id and numero = v_l.numero_oc;
    perform notificar(r, 'ENTREGA', format('Entrega con observación: %s %s', v_tipo, v_l.numero_oc), v_obs,
                      case when r = 'LOGISTICA' then format('/logistica/ordenes/%s/%s', v_l.obra_id, v_l.numero_oc)
                           else format('/operaciones/valorizaciones?obra=%s', v_l.obra_id) end)
      from unnest(array['LOGISTICA', 'OPERACIONES', 'JEFE_OPERACIONES']) r;
  end if;

  -- Todo lo pedido llegó: la orden queda recibida.
  if not exists (
    select 1 from v_entregas_item where obra_id = v_l.obra_id and numero_oc = v_l.numero_oc and entregado < pedido - 0.0001
  ) then
    update ordenes_compra set estado = 'RECIBIDA' where obra_id = v_l.obra_id and numero = v_l.numero_oc;
  end if;
  return v_id;
end;
$function$;

revoke execute on function public.registrar_entrega(bigint, numeric, text[], double precision, double precision, double precision, timestamp with time zone, text) from public, anon;
grant execute on function public.registrar_entrega(bigint, numeric, text[], double precision, double precision, double precision, timestamp with time zone, text) to authenticated;
