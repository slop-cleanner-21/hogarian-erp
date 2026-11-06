-- Sugerencias (06/11/2026): desde el encabezado de la app, cualquier rol avisa de un error, propone una mejora o una
-- preferencia de diseño, con capturas y la pantalla desde la que escribe. Las lee el Admin (Admin › Sugerencias) y le llega un
-- aviso. Solo el servidor las lee (clave secreta); se escriben por enviar_sugerencia.

create table public.sugerencias (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  rol text not null,
  tipo text not null check (tipo in ('ERROR', 'MEJORA', 'DISENO')),
  texto text not null check (char_length(btrim(texto)) between 3 and 2000),
  pantalla text,
  ruta text,
  capturas text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index sugerencias_fecha on public.sugerencias (created_at desc, id desc);
alter table public.sugerencias enable row level security;
revoke all on public.sugerencias from anon, authenticated;
create trigger audit_sugerencias after insert or delete or update on public.sugerencias
  for each row execute function public.fn_audit();

-- Las capturas: cada uno sube a su carpeta; solo el servidor las lee.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sugerencias', 'sugerencias', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/gif'])
on conflict (id) do nothing;

create policy sugerencias_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'sugerencias' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.rol_actual()) <> '');

create or replace function public.enviar_sugerencia(p_tipo text, p_texto text, p_pantalla text, p_ruta text, p_capturas text[])
  returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_rol text := coalesce(rol_actual(), '');
  v_capturas text[] := coalesce(p_capturas, '{}');
  v_texto text := btrim(coalesce(p_texto, ''));
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

  insert into sugerencias (user_id, rol, tipo, texto, pantalla, ruta, capturas)
  values (auth.uid(), v_rol, p_tipo, v_texto, left(nullif(btrim(p_pantalla), ''), 200),
          case when p_ruta like '/%' and p_ruta not like '//%' then left(p_ruta, 500) end, v_capturas)
  returning id into v_id;

  select nombre into v_nombre from perfiles where user_id = auth.uid();
  perform notificar('ADMIN', 'SUGERENCIA',
    format('%s de %s', case p_tipo when 'ERROR' then 'Error en la app' when 'MEJORA' then 'Sugerencia de mejora' else 'Preferencia de diseño' end, coalesce(v_nombre, 'un usuario')),
    left(v_texto, 140), '/admin/sugerencias');
  return v_id;
end;
$$;
revoke execute on function public.enviar_sugerencia(text, text, text, text, text[]) from public, anon;
grant execute on function public.enviar_sugerencia(text, text, text, text, text[]) to authenticated;
