-- Prod 1: el Ingeniero de Operaciones (rol OPERACIONES) entra, con exactamente lo mismo que el Jefe de Operaciones:
-- solo ver el seguimiento (06/11/2026). Para la base es un Jefe: rol_actual() y rol_en() lo tratan como
-- JEFE_OPERACIONES, así hereda todas sus restricciones (no pasa ninguna función que escriba, no lee lo financiero, solo
-- ve las fotos de las entregas, no sube archivos) sin repetirlas. Su rol de verdad (OPERACIONES) sigue en perfiles,
-- para migrar al sistema completo.

create or replace function public.rol_prod1(p_rol text)
  returns boolean language sql immutable set search_path = public, pg_temp
as $$ select p_rol in ('LOGISTICA', 'TESORERIA', 'GERENCIA', 'JEFE_OPERACIONES', 'OPERACIONES', 'ADMIN') $$;

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
    return case when v_rol = 'OPERACIONES' then 'JEFE_OPERACIONES' else v_rol end;
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
  if v_rol = 'OPERACIONES' then v_rol := 'JEFE_OPERACIONES'; end if;
  return v_rol = 'ADMIN' or v_rol = any (p_roles);
end;
$$;
