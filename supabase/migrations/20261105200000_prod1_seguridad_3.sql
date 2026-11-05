-- Re-auditoría contra producción (05/11/2026).
--
-- 1. Bloqueo con huella hecho cumplir por la base: una sesión abierta en un dispositivo con la huella activada queda
--    en sesiones_bloqueo con su «desbloqueado hasta». Vencido, rol_actual() / rol_en() la tratan como sin perfil:
--    no lee ni escribe nada (tablas, RPC, archivos, realtime), aunque se borren las cookies o se use el token directo
--    contra la API. Solo el servidor la desbloquea (tras verificar la huella).
-- 2. Subida de archivos por rol y carpeta (antes, cualquier rol a cualquier carpeta).
-- 3. El Jefe de Operaciones no lee lo financiero (facturas, pagos, retenciones, detracciones, contactos, personas).
-- 4. Sin TRUNCATE / TRIGGER / REFERENCES para anon y authenticated.
-- 5. Verificar la contraseña actual (para cambiarla) sin abrir otra sesión.
-- 6. El envío del proveedor no devuelve errores crudos de Postgres.

-- 1. Sesiones con bloqueo ---------------------------------------------------------------------------------------

create table public.sesiones_bloqueo (
  session_id uuid primary key,             -- la de auth.sessions (claim session_id del JWT)
  user_id uuid not null references auth.users (id) on delete cascade,
  desbloqueado_hasta timestamptz not null, -- vencido: bloqueada
  created_at timestamptz not null default now()
);
create index on public.sesiones_bloqueo (user_id);
alter table public.sesiones_bloqueo enable row level security;
revoke all on public.sesiones_bloqueo from anon, authenticated;

-- La ventana, igual que la de la cookie (src/lib/bloqueo-servidor.ts, VENTANA_MS).
create or replace function public.bloqueo_ventana() returns interval language sql immutable as $$ select interval '3 minutes' $$;
revoke execute on function public.bloqueo_ventana() from public, anon, authenticated;

-- La sesión del pedido está bloqueada (tiene bloqueo y su «desbloqueado» venció).
create or replace function public.sesion_bloqueada()
  returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.sesiones_bloqueo
     where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and desbloqueado_hasta <= now())
$$;
revoke execute on function public.sesion_bloqueada() from public, anon;
grant execute on function public.sesion_bloqueada() to authenticated, service_role;

-- El estado de la sesión propia, renovando el «desbloqueado» si sigue vigente (lo llama el proxy, como mucho una vez
-- por minuto). 'libre': sin bloqueo; 'abierta': desbloqueada (renovada); 'bloqueada'.
create or replace function public.bloqueo_estado()
  returns text language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_hasta timestamptz;
begin
  if v_sid is null then return 'libre'; end if;
  update sesiones_bloqueo set desbloqueado_hasta = now() + bloqueo_ventana()
   where session_id = v_sid and desbloqueado_hasta > now()
  returning desbloqueado_hasta into v_hasta;
  if found then return 'abierta'; end if;
  return case when exists (select 1 from sesiones_bloqueo where session_id = v_sid) then 'bloqueada' else 'libre' end;
end;
$$;
revoke execute on function public.bloqueo_estado() from public, anon;
grant execute on function public.bloqueo_estado() to authenticated;

-- La sesión propia pasa a tener bloqueo (al activar la huella, entrar con ella, o entrar con contraseña en un
-- dispositivo con la huella). p_abierta: recién verificada (contraseña o huella), queda desbloqueada; si no, bloqueada.
-- Nunca desbloquea una sesión que ya estaba bloqueada (eso solo lo hace el servidor tras la huella).
create or replace function public.bloqueo_activar(p_abierta boolean)
  returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_sid is null or auth.uid() is null then raise exception 'Sin sesión'; end if;
  insert into sesiones_bloqueo (session_id, user_id, desbloqueado_hasta)
  values (v_sid, auth.uid(), case when p_abierta then now() + bloqueo_ventana() else now() end)
  on conflict (session_id) do nothing;
  -- Las de sesiones que ya no existen (cerradas o vencidas).
  delete from sesiones_bloqueo b
   where b.user_id = auth.uid() and not exists (select 1 from auth.sessions s where s.id = b.session_id);
end;
$$;
revoke execute on function public.bloqueo_activar(boolean) from public, anon;
grant execute on function public.bloqueo_activar(boolean) to authenticated;

-- Solo el servidor, tras verificar la huella.
create or replace function public.bloqueo_desbloquear(p_session uuid)
  returns void language sql security definer set search_path = public, pg_temp
as $$
  update public.sesiones_bloqueo set desbloqueado_hasta = now() + public.bloqueo_ventana() where session_id = p_session
$$;
revoke execute on function public.bloqueo_desbloquear(uuid) from public, anon, authenticated;
grant execute on function public.bloqueo_desbloquear(uuid) to service_role;

-- Solo el servidor: la huella ya no vale en esa sesión (se quitó en este dispositivo) o en ninguna (sin huellas).
create or replace function public.bloqueo_quitar(p_session uuid, p_user uuid)
  returns void language sql security definer set search_path = public, pg_temp
as $$
  delete from public.sesiones_bloqueo where (p_session is not null and session_id = p_session) or (p_session is null and user_id = p_user)
$$;
revoke execute on function public.bloqueo_quitar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bloqueo_quitar(uuid, uuid) to service_role;

-- Sesión bloqueada = sin perfil.
create or replace function public.rol_actual()
  returns text language sql stable security definer set search_path = public
as $$
  select case
    when auth.role() in ('authenticated', 'anon')
      then coalesce((select p.rol::text from public.perfiles p join auth.users u on u.id = p.user_id
                      where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
                        and public.rol_prod1(p.rol::text) and not public.sesion_bloqueada()), '')
    else (select rol::text from public.perfiles where user_id = auth.uid())
  end
$$;

create or replace function public.rol_en(variadic p_roles text[])
  returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.rol::text = 'ADMIN' or p.rol::text = any (p_roles)
       from public.perfiles p join auth.users u on u.id = p.user_id
      where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and public.rol_prod1(p.rol::text) and not public.sesion_bloqueada()),
    false)
$$;

-- Lo propio que no pasa por el rol (avisos, suscripciones push): tampoco con la sesión bloqueada.
create policy sin_bloqueo on public.notificaciones as restrictive for all to authenticated
  using (not (select public.sesion_bloqueada())) with check (not (select public.sesion_bloqueada()));
create policy sin_bloqueo on public.push_suscripciones as restrictive for all to authenticated
  using (not (select public.sesion_bloqueada())) with check (not (select public.sesion_bloqueada()));
create policy sin_bloqueo on storage.objects as restrictive for all to authenticated
  using (not (select public.sesion_bloqueada())) with check (not (select public.sesion_bloqueada()));

-- 2. Subida de archivos por rol y carpeta ----------------------------------------------------------------------
-- comprobantes: las facturas, Logística. documentos: pagos/ (vouchers) Tesorería; guias/, proveedores/ (constancia
-- de suspensión de 4ta) y <obra>/<orden>/ (contratos) Logística; el resto (firmas/, entregas/, solicitudes/, demo/)
-- nadie desde el navegador (lo sube el servidor). El Admin, todo lo de los roles.
create policy subir_por_rol on storage.objects as restrictive for insert to authenticated
with check (
  case
    when bucket_id = 'comprobantes' then (select public.rol_en('LOGISTICA'))
    when bucket_id = 'documentos' then
      case
        when name like 'pagos/%' then (select public.rol_en('TESORERIA'))
        when name like 'guias/%' or name like 'proveedores/%' or name ~ '^[0-9]+/' then (select public.rol_en('LOGISTICA'))
        else false
      end
    else true
  end
);

-- 3. El Jefe de Operaciones: solo lo del seguimiento ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['comprobantes', 'pago_aplicaciones', 'retenciones', 'detracciones', 'proveedor_contactos',
                           'personas', 'solicitudes', 'solicitud_adjuntos', 'transportistas', 'proveedor_tipos_material']
  loop
    execute format(
      'create policy sin_jefe_operaciones on public.%I as restrictive for select to authenticated using ((select public.rol_actual()) is distinct from %L)',
      t, 'JEFE_OPERACIONES');
  end loop;
end $$;

-- 4. Sin TRUNCATE / TRIGGER / REFERENCES (PostgREST no los usa; lo que Supabase da por defecto) ------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- 5. Verificar la contraseña actual (solo el servidor) --------------------------------------------------------
create or replace function public.contrasena_correcta(p_user uuid, p_clave text)
  returns boolean language sql stable security definer set search_path = public, extensions, pg_temp
as $$
  select coalesce((select u.encrypted_password is not null and u.encrypted_password <> ''
                          and extensions.crypt(p_clave, u.encrypted_password) = u.encrypted_password
                     from auth.users u where u.id = p_user), false)
$$;
revoke execute on function public.contrasena_correcta(uuid, text) from public, anon, authenticated;
grant execute on function public.contrasena_correcta(uuid, text) to service_role;

-- 6. Envío del proveedor: datos mal formados → un mensaje propio, no el error de Postgres ------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.enviar_cotizacion(uuid, jsonb)'::regprocedure);
  v_viejo text := 'for r in select * from jsonb_to_recordset(p_precios) x(item_id bigint, pu numeric) loop';
begin
  if position(v_viejo in v_def) = 0 then raise exception 'enviar_cotizacion cambió: revisar la migración'; end if;
  v_def := replace(v_def, v_viejo, $q$begin
    perform 1 from jsonb_to_recordset(p_precios) x(item_id bigint, pu numeric);
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value
                 or datatype_mismatch or invalid_datetime_format then
    raise exception 'Formato de precios inválido';
  end;
  for r in select * from jsonb_to_recordset(p_precios) x(item_id bigint, pu numeric) loop$q$);
  execute v_def;
end $$;
