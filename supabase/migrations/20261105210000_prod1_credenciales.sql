-- Contraseñas fuera de Supabase Auth (re-auditoría del 05/11/2026) y bloqueo con huella sin atajos.
--
-- 1. La contraseña de cada usuario vive en `credenciales` (hash bcrypt), que solo lee el servidor. En auth.users
--    queda siempre una al azar que nadie conoce: así no sirve probar contraseñas directo contra la API de Supabase
--    (no pasa por los límites de la app, y su propio límite ve la IP de Vercel, la misma para todos), ni cambiar la
--    contraseña con un token robado (PUT /auth/v1/user): Auth acepta el cambio, pero no es la que vale. El ingreso lo
--    verifica el servidor (con sus límites) y abre la sesión con un enlace mágico de un solo uso, como la huella.
-- 2. Una sesión cerrada en Auth (que ya no está en auth.sessions) no da nada aunque su token siga vigente; y el
--    propio usuario ya no puede borrar el bloqueo de sus sesiones.
-- 3. Sin CAPTCHA: se retira login_ips (los límites de ingreso los lleva la app con la auditoría).

-- 1. Credenciales -------------------------------------------------------------------------------------------------

create table public.credenciales (
  user_id uuid primary key references auth.users (id) on delete cascade deferrable initially deferred,
  hash text not null,
  cambiada_at timestamptz not null default now()
);
alter table public.credenciales enable row level security;
revoke all on public.credenciales from anon, authenticated;

-- Las contraseñas actuales pasan a credenciales y Auth se queda con una al azar.
insert into public.credenciales (user_id, hash)
select id, encrypted_password from auth.users where encrypted_password like '$2%'
on conflict (user_id) do update set hash = excluded.hash;
update auth.users
   set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf'))
 where encrypted_password is not null and encrypted_password <> '';

-- Toda contraseña que se le ponga a Auth se reemplaza por una al azar. La que se carga por SQL (semillas locales,
-- scripts con la base) pasa antes a credenciales; la que llega por la API de Auth (de un usuario o del panel), no:
-- las contraseñas las pone solo el servidor (fijar_contrasena).
create or replace function public.fn_auth_contrasena()
  returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if new.encrypted_password is null or new.encrypted_password = '' then return new; end if;
  if tg_op = 'UPDATE' and new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
  if session_user <> 'supabase_auth_admin' and new.encrypted_password like '$2%' then
    insert into public.credenciales (user_id, hash) values (new.id, new.encrypted_password)
    on conflict (user_id) do update set hash = excluded.hash, cambiada_at = now();
  end if;
  new.encrypted_password := extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf'));
  return new;
end;
$$;
create trigger auth_contrasena before insert or update of encrypted_password on auth.users
  for each row execute function public.fn_auth_contrasena();
revoke execute on function public.fn_auth_contrasena() from public, anon, authenticated;

-- Un hash de relleno: el ingreso tarda lo mismo exista o no la cuenta (no se puede saber cuáles existen por el tiempo).
create or replace function public.hash_relleno() returns text language sql immutable as $$
  select '$2a$10$C58hmgnhLAZMIgTpV9cfweGVBXW0FInOwsxCygOhOgETTxk5tOUrm'::text
$$;
revoke execute on function public.hash_relleno() from public, anon, authenticated;

-- El ingreso: el usuario de ese correo si la contraseña es la suya y la cuenta está activa (null si no).
create or replace function public.ingreso_valido(p_email text, p_clave text)
  returns uuid language plpgsql stable security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_hash text;
  v_activa boolean;
begin
  select u.id, c.hash, (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null
    into v_id, v_hash, v_activa
    from auth.users u left join public.credenciales c on c.user_id = u.id
   where lower(u.email) = lower(p_email);
  if extensions.crypt(left(coalesce(p_clave, ''), 72), coalesce(v_hash, public.hash_relleno())) = coalesce(v_hash, '-') and v_activa then
    return v_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.ingreso_valido(text, text) from public, anon, authenticated;
grant execute on function public.ingreso_valido(text, text) to service_role;

-- La contraseña actual de un usuario (para cambiarla).
create or replace function public.contrasena_correcta(p_user uuid, p_clave text)
  returns boolean language sql stable security definer set search_path = public, extensions, pg_temp
as $$
  select coalesce((select extensions.crypt(left(coalesce(p_clave, ''), 72), c.hash) = c.hash
                     from public.credenciales c where c.user_id = p_user), false)
$$;
revoke execute on function public.contrasena_correcta(uuid, text) from public, anon, authenticated;
grant execute on function public.contrasena_correcta(uuid, text) to service_role;

-- Fija la contraseña (alta, restablecimiento o cambio) y cierra las demás sesiones del usuario (p_conservar: la del
-- que la cambia; null: todas). Solo el servidor.
create or replace function public.fijar_contrasena(p_user uuid, p_clave text, p_conservar uuid default null)
  returns void language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
begin
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 72 or p_clave !~ '[A-Za-z]' or p_clave !~ '[0-9]' then
    raise exception 'La contraseña debe tener al menos 8 caracteres, con letras y números';
  end if;
  insert into credenciales (user_id, hash) values (p_user, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do update set hash = excluded.hash, cambiada_at = now();
  delete from auth.sessions where user_id = p_user and (p_conservar is null or id <> p_conservar);
end;
$$;
revoke execute on function public.fijar_contrasena(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fijar_contrasena(uuid, text, uuid) to service_role;

-- 2. Bloqueo: sesiones cerradas y sin atajos ----------------------------------------------------------------------

-- Bloqueada: con bloqueo vencido, o una sesión que ya no existe (cerrada, o el token es de una sesión revocada).
create or replace function public.sesion_bloqueada()
  returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  with s as (select nullif(auth.jwt() ->> 'session_id', '')::uuid as id)
  select coalesce(
    (select s.id is not null
            and (not exists (select 1 from auth.sessions a where a.id = s.id)
                 or exists (select 1 from public.sesiones_bloqueo b where b.session_id = s.id and b.desbloqueado_hasta <= now()))
       from s),
    false)
$$;

-- El usuario ya no borra filas (antes limpiaba las de sesiones inexistentes: cerrando la sesión en Auth se quitaba
-- el bloqueo). La limpieza la hace el servidor (bloqueo_desbloquear).
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
end;
$$;

create or replace function public.bloqueo_desbloquear(p_session uuid)
  returns void language sql security definer set search_path = public, pg_temp
as $$
  update public.sesiones_bloqueo set desbloqueado_hasta = now() + public.bloqueo_ventana() where session_id = p_session;
  delete from public.sesiones_bloqueo b
   where b.user_id = (select user_id from public.sesiones_bloqueo where session_id = p_session)
     and not exists (select 1 from auth.sessions s where s.id = b.session_id);
$$;

-- Ayudantes con la clave secreta que respondían a cualquier sesión (también una bloqueada): solo con rol (o el
-- servidor, sin sesión).
create or replace function public.fn_presupuesto_efectivo(p_partida_id bigint)
  returns numeric language sql stable security definer set search_path = public
as $$
  select efectivo from v_presupuesto_efectivo where partida_id = p_partida_id and coalesce((select public.rol_actual()), 'x') <> '';
$$;

create or replace function public.fn_comprometido_partida(p_partida_id bigint)
  returns numeric language sql stable security definer set search_path = public
as $$
  select coalesce(sum(case when o.entrega_cerrada_at is null then l.cantidad
                           else coalesce((select sum(en.cantidad) from entregas en where en.oc_item_id = l.id), 0) end), 0)
    from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
   where l.partida_id = p_partida_id and o.estado not in ('ANULADA', 'BORRADOR') and not o.es_retencion
     and coalesce((select public.rol_actual()), 'x') <> '';
$$;

-- 3. Sin CAPTCHA ---------------------------------------------------------------------------------------------------
drop function if exists public.login_fallo_ip(text);
drop table if exists public.login_ips;
