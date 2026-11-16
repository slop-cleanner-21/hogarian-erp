-- Sugerencias hechas con Hogariano (el asistente): la misma tabla y el mismo aviso al Admin, con su origen para que lo sepa.
-- `origen` es una etiqueta (APP: el formulario del encabezado; HOGARIANO: por chat), no un permiso.

alter table public.sugerencias
  add column origen text not null default 'APP' check (origen in ('APP', 'HOGARIANO'));

-- Una sola firma: con dos sobrecargas (la vieja y una con un parámetro por defecto) la llamada con 5 argumentos sería ambigua.
drop function public.enviar_sugerencia(text, text, text, text, text[]);

create function public.enviar_sugerencia(p_tipo text, p_texto text, p_pantalla text, p_ruta text, p_capturas text[], p_origen text default 'APP')
  returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rol text := coalesce(rol_actual(), '');
  v_capturas text[] := coalesce(p_capturas, '{}');
  v_texto text := btrim(coalesce(p_texto, ''));
  v_origen text := coalesce(p_origen, 'APP');
  v_id bigint;
  v_c text;
  v_nombre text;
begin
  if v_rol = '' then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if p_tipo is null or p_tipo not in ('ERROR', 'MEJORA', 'DISENO') then
    raise exception 'Elige el tipo de sugerencia';
  end if;
  if v_origen not in ('APP', 'HOGARIANO') then
    raise exception 'Origen no válido';
  end if;
  if char_length(v_texto) < 3 or char_length(v_texto) > 2000 then
    raise exception 'Cuéntanos qué pasó (hasta 2,000 caracteres)';
  end if;
  if cardinality(v_capturas) > 5 then
    raise exception 'Hasta 5 capturas';
  end if;
  foreach v_c in array v_capturas loop
    -- Solo sus propios archivos, y que existan.
    if v_c !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') or v_c like '%..%'
       or not exists (select 1 from storage.objects where bucket_id = 'sugerencias' and name = v_c) then
      raise exception 'Captura no válida';
    end if;
  end loop;

  insert into sugerencias (user_id, rol, tipo, texto, pantalla, ruta, capturas, origen)
  values (auth.uid(), v_rol, p_tipo, v_texto, left(nullif(btrim(p_pantalla), ''), 200),
          case when p_ruta like '/%' and p_ruta not like '//%' then left(p_ruta, 500) end, v_capturas, v_origen)
  returning id into v_id;

  select nombre into v_nombre from perfiles where user_id = auth.uid();
  perform notificar('ADMIN', 'SUGERENCIA',
    format('%s de %s%s', case p_tipo when 'ERROR' then 'Error en la app' when 'MEJORA' then 'Sugerencia de mejora' else 'Preferencia de diseño' end,
           coalesce(v_nombre, 'un usuario'), case when v_origen = 'HOGARIANO' then ' (con Hogariano)' else '' end),
    left(v_texto, 140), '/admin/sugerencias');
  return v_id;
end;
$$;
revoke execute on function public.enviar_sugerencia(text, text, text, text, text[], text) from public, anon;
grant execute on function public.enviar_sugerencia(text, text, text, text, text[], text) to authenticated;
