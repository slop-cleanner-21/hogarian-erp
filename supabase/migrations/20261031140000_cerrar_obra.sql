-- Cierre de obra (Gerencia, directo): se da de baja todo lo que falta de cada partida (queda en
-- lo comprometido; en mano de obra, en lo valorizado) y la obra queda cerrada: ya no se requiere,
-- ordena ni avanza nada, salvo la OS de retención que Logística crea al final.
create or replace function public.cerrar_obra(p_obra_id bigint)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_obra text;
  v_estado text;
  v_retencion numeric;
  r record;
  v_n integer := 0;
begin
  if rol_actual() not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia cierra obras';
  end if;
  select nombre, estado into v_obra, v_estado from obras where id = p_obra_id for update;
  if not found then
    raise exception 'La obra no existe';
  end if;
  if v_estado = 'CERRADA' then
    raise exception 'La obra ya está cerrada';
  end if;
  if exists (select 1 from avances where obra_id = p_obra_id and estado = 'REGISTRADO') then
    raise exception 'Hay avance de mano de obra sin valorizar: Operaciones debe valorizarlo u observarlo antes';
  end if;
  for r in select id, fn_faltante_partida(id) as faltante from partidas
            where obra_id = p_obra_id and dada_de_baja_at is null order by id for update loop
    if r.faltante > 0 then
      update partidas set cantidad = cantidad - r.faltante where id = r.id;
      v_n := v_n + 1;
    end if;
  end loop;
  update obras set estado = 'CERRADA', cerrada_at = now(), cerrada_by = auth.uid() where id = p_obra_id;

  select coalesce(sum(vp.retencion), 0) into v_retencion
    from valorizaciones v join valorizacion_partidas vp on vp.valorizacion_id = v.id where v.obra_id = p_obra_id;
  perform notificar('LOGISTICA', 'OBRA', format('Obra cerrada: %s', v_obra),
                    case when v_retencion > 0 then format('Retención por pagar S/ %s', to_char(v_retencion, 'FM999G999G990D00')) end,
                    '/logistica/requerimientos');
  perform notificar(r2, 'OBRA', format('Obra cerrada: %s', v_obra), null, format('/operaciones?obra=%s', p_obra_id))
    from unnest(array['OPERACIONES', 'JEFE_OPERACIONES']) r2;
  return v_retencion;
end;
$$;
revoke execute on function public.cerrar_obra(bigint) from public, anon;
grant execute on function public.cerrar_obra(bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.crear_requerimiento(p_obra_id bigint, p_nota text, p_lineas jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id bigint;
  v_numero text;
  l record;
  a record;
  v_p record;
  v_o record;
  v_disp numeric;
  v_adel numeric;
  v_falta numeric;
  v_disp_origen numeric;
begin
  if rol_actual() not in ('OPERACIONES', 'JEFE_OPERACIONES', 'ADMIN') then
    raise exception 'Solo Operaciones crea requerimientos';
  end if;
  if not exists (select 1 from obras where id = p_obra_id and presupuesto_estado = 'PUBLICADO') then
    raise exception 'La obra no tiene el presupuesto publicado';
  end if;
  if (select estado from obras where id = p_obra_id) = 'CERRADA' then
    raise exception 'La obra está cerrada';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El requerimiento debe tener al menos una partida';
  end if;
  perform 1 from obras where id = p_obra_id for update;  -- numeración sin carreras
  v_numero := 'REQ-' || lpad(((select count(*) from requerimientos_obra where obra_id = p_obra_id) + 1)::text, 3, '0');
  insert into requerimientos_obra (obra_id, numero, nota) values (p_obra_id, v_numero, nullif(btrim(coalesce(p_nota, '')), ''))
  returning id into v_id;

  for l in
    select (x->>'partida_id')::bigint as partida_id, (x->>'cantidad')::numeric as cantidad, coalesce(x->'adelantos', '[]'::jsonb) as adelantos
      from jsonb_array_elements(p_lineas) x
     order by (x->>'partida_id')::bigint
  loop
    if l.partida_id is null or coalesce(l.cantidad, 0) <= 0 then
      raise exception 'Cada partida necesita una cantidad mayor que cero';
    end if;
    select p.id, p.obra_id, p.item_id, p.etapa, i.descripcion, i.unidad into v_p
      from partidas p join items i on i.id = p.item_id where p.id = l.partida_id and p.dada_de_baja_at is null for update of p;
    if not found or v_p.obra_id <> p_obra_id then
      raise exception 'La partida % no es de esta obra', l.partida_id;
    end if;
    v_disp := fn_presupuesto_efectivo(v_p.id) - fn_requerido_partida(v_p.id);
    v_falta := greatest(l.cantidad - v_disp, 0);
    select coalesce(sum((y->>'cantidad')::numeric), 0) into v_adel from jsonb_array_elements(l.adelantos) y;
    if v_falta > 0.0001 and v_adel < v_falta - 0.0001 then
      raise exception '% en %: faltan % % en el presupuesto. Adelanta de una etapa posterior o pide un adicional',
        v_p.descripcion, v_p.etapa, trim_scale(round(v_falta - v_adel, 4)), v_p.unidad;
    end if;
    if v_adel > v_falta + 0.0001 then
      raise exception '% en %: el adelanto (%) supera lo que falta (%)', v_p.descripcion, v_p.etapa, trim_scale(v_adel), trim_scale(round(v_falta, 4));
    end if;
    for a in select (y->>'partida_origen_id')::bigint as origen, (y->>'cantidad')::numeric as cantidad from jsonb_array_elements(l.adelantos) y loop
      if coalesce(a.cantidad, 0) <= 0 then
        raise exception 'Cada adelanto necesita una cantidad mayor que cero';
      end if;
      select p.id, p.obra_id, p.item_id, p.etapa into v_o from partidas p where p.id = a.origen and p.dada_de_baja_at is null for update;
      if not found or v_o.obra_id <> p_obra_id or v_o.item_id <> v_p.item_id then
        raise exception 'Solo se adelanta el mismo ítem de la misma obra';
      end if;
      if fn_orden_etapa(p_obra_id, v_o.etapa) <= fn_orden_etapa(p_obra_id, v_p.etapa) then
        raise exception 'Solo se adelanta de una etapa posterior a % (se pidió de %)', v_p.etapa, v_o.etapa;
      end if;
      v_disp_origen := fn_presupuesto_efectivo(v_o.id) - greatest(fn_requerido_partida(v_o.id), fn_comprometido_partida(v_o.id));
      if a.cantidad > v_disp_origen + 0.0001 then
        raise exception 'La etapa % solo puede adelantar % % de %', v_o.etapa, trim_scale(round(greatest(v_disp_origen, 0), 4)), v_p.unidad, v_p.descripcion;
      end if;
      insert into adelantos (obra_id, item_id, partida_origen_id, partida_destino_id, cantidad, requerimiento_id)
      values (p_obra_id, v_p.item_id, v_o.id, v_p.id, a.cantidad, v_id);
    end loop;
    insert into requerimientos_obra_items (requerimiento_id, partida_id, cantidad) values (v_id, v_p.id, l.cantidad);
  end loop;

  perform notificar('LOGISTICA', 'REQUERIMIENTO', format('Requerimiento %s', v_numero),
                    (select nombre from obras where id = p_obra_id), format('/logistica/requerimientos?obra=%s', p_obra_id));
  return v_id;
end;
$function$;
