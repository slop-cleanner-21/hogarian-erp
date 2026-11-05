-- Rendimiento de los permisos (informe del 05/11/2026): rol_actual(), rol_en(), es_residente() y sesion_bloqueada()
-- eran funciones SQL con SECURITY DEFINER y search_path fijo, que Postgres no puede incrustar en la consulta: cada
-- vez que una política las llama (decenas de veces en una vista como v_por_pagar), se vuelven a planificar, con su
-- join a auth.users. En plpgsql el plan de sus consultas queda guardado por conexión. Mismo resultado.

create or replace function public.sesion_bloqueada()
  returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if v_sid is null then return false; end if;
  -- Una sesión que ya no existe (cerrada, revocada) o con el «desbloqueado» vencido.
  return not exists (select 1 from auth.sessions a where a.id = v_sid)
      or exists (select 1 from public.sesiones_bloqueo b where b.session_id = v_sid and b.desbloqueado_hasta <= now());
end;
$$;

create or replace function public.rol_actual()
  returns text language plpgsql stable security definer set search_path = public
as $$
declare
  v_rol text;
begin
  if auth.role() in ('authenticated', 'anon') then
    select p.rol::text into v_rol
      from public.perfiles p join auth.users u on u.id = p.user_id
     where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now()) and public.rol_prod1(p.rol::text);
    if v_rol is null or public.sesion_bloqueada() then return ''; end if;
    return v_rol;
  end if;
  select rol::text into v_rol from public.perfiles where user_id = auth.uid();
  return v_rol;
end;
$$;

create or replace function public.rol_en(variadic p_roles text[])
  returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  select p.rol::text into v_rol
    from public.perfiles p join auth.users u on u.id = p.user_id
   where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now()) and public.rol_prod1(p.rol::text);
  if v_rol is null or public.sesion_bloqueada() then return false; end if;
  return v_rol = 'ADMIN' or v_rol = any (p_roles);
end;
$$;

create or replace function public.es_residente()
  returns boolean language plpgsql stable security definer set search_path = public
as $$
begin
  return exists (select 1 from public.perfiles where user_id = auth.uid() and rol::text = 'RESIDENTE');
end;
$$;
