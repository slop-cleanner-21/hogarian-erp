-- Prod 1: el Admin gestiona los usuarios desde la app (crear cuentas, cambiar nombre, correo y rol,
-- restablecer la contraseña, desactivar y reactivar). Las cuentas se crean con la API de administración de
-- Supabase desde el servidor; aquí solo se asegura que un usuario desactivado (baneado) deje de ver datos
-- al instante, sin esperar a que venza su token (hasta 1 h): para la base queda como un usuario sin perfil.

CREATE OR REPLACE FUNCTION public.rol_actual()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.role() in ('authenticated', 'anon')
      then coalesce((select p.rol::text from public.perfiles p join auth.users u on u.id = p.user_id
                      where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())), '')
    else (select rol::text from public.perfiles where user_id = auth.uid())
  end
$function$;

CREATE OR REPLACE FUNCTION public.rol_en(VARIADIC p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select p.rol::text = 'ADMIN' or p.rol::text = any (p_roles)
       from public.perfiles p join auth.users u on u.id = p.user_id
      where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())),
    false)
$function$;
