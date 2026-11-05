-- Ingreso (tercera re-auditoría, 05/11/2026):
--
-- 1. Nadie deja afuera a otro sabiendo su correo. Los intentos fallidos se cuentan por IP y cuenta: los fallos desde
--    la IP de un atacante solo lo hacen esperar a él. Contra un ataque desde muchas IP, la cuenta también tiene un
--    tope propio, pero ese no frena a los dispositivos donde la cuenta ya entró antes (llevan una marca firmada que
--    pone el servidor, «dispositivo conocido»): el dueño sigue entrando desde su celular o su PC.
--      · IP + cuenta: 3 fallidos en 10 minutos.       · IP (todas las cuentas): 10.
--      · cuenta, desde dispositivos no conocidos: 20.  · cuenta, desde un dispositivo conocido: 3 (solo ese).
-- 2. El tope es atómico: contar, verificar y registrar el intento van juntos, con un bloqueo por cuenta (con pedidos
--    simultáneos pasaban 5 intentos en vez de 3).
-- 3. Auth no manda correos: los códigos de un solo uso (/auth/v1/otp, /recover) se podían pedir y adivinar (6
--    dígitos, 1 hora). La app no los usa: abre las sesiones con enlaces que genera y canjea el servidor (no se envían).

create or replace function public.ingreso_intentar(
  p_email text, p_clave text, p_ip text, p_conocido text, p_detalle jsonb default '{}'::jsonb
) returns table (user_id uuid, espera integer)
  language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_desde timestamptz := now() - interval '10 minutes';
  v_id uuid;
  v_hash text;
  v_activa boolean;
  v_espera integer := 0;
  -- Cuánto falta para que el más viejo de los n últimos fallidos cumpla los 10 minutos (si hay al menos n).
  v_mas_viejo timestamptz;
begin
  -- Un intento a la vez por cuenta (y por IP): el recuento y el registro no se cruzan con otros simultáneos.
  perform pg_advisory_xact_lock(hashtextextended('ingreso:' || v_email, 0));
  if p_ip is not null then perform pg_advisory_xact_lock(hashtextextended('ingreso-ip:' || p_ip, 0)); end if;

  -- IP + cuenta: 3.
  if p_ip is not null then
    select min(created_at) into v_mas_viejo from (
      select created_at from audit_log
       where tabla = 'sesion' and accion = 'LOGIN_FALLIDO' and created_at >= v_desde
         and detalle->>'email' = v_email and detalle->>'ip' = p_ip
       order by created_at desc limit 3) x having count(*) >= 3;
    v_espera := greatest(v_espera, coalesce(ceil(extract(epoch from v_mas_viejo + interval '10 minutes' - now()))::int, 0));
    -- IP: 10.
    select min(created_at) into v_mas_viejo from (
      select created_at from audit_log
       where tabla = 'sesion' and accion = 'LOGIN_FALLIDO' and created_at >= v_desde and detalle->>'ip' = p_ip
       order by created_at desc limit 10) x having count(*) >= 10;
    v_espera := greatest(v_espera, coalesce(ceil(extract(epoch from v_mas_viejo + interval '10 minutes' - now()))::int, 0));
  end if;
  if p_conocido is not null then
    -- Dispositivo conocido: solo sus propios fallos (3).
    select min(created_at) into v_mas_viejo from (
      select created_at from audit_log
       where tabla = 'sesion' and accion = 'LOGIN_FALLIDO' and created_at >= v_desde
         and detalle->>'email' = v_email and detalle->>'conocido' = p_conocido
       order by created_at desc limit 3) x having count(*) >= 3;
  else
    -- Desde dispositivos no conocidos, la cuenta: 20 (un ataque repartido en muchas IP).
    select min(created_at) into v_mas_viejo from (
      select created_at from audit_log
       where tabla = 'sesion' and accion = 'LOGIN_FALLIDO' and created_at >= v_desde
         and detalle->>'email' = v_email and detalle->>'conocido' is null
       order by created_at desc limit 20) x having count(*) >= 20;
  end if;
  v_espera := greatest(v_espera, coalesce(ceil(extract(epoch from v_mas_viejo + interval '10 minutes' - now()))::int, 0));
  if v_espera > 0 then
    return query select null::uuid, greatest(v_espera, 1);
    return;
  end if;

  -- La verificación tarda lo mismo exista o no la cuenta (bcrypt contra un hash de relleno).
  select u.id, c.hash, (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null
    into v_id, v_hash, v_activa
    from auth.users u left join credenciales c on c.user_id = u.id
   where lower(u.email) = v_email;
  if extensions.crypt(left(coalesce(p_clave, ''), 72), coalesce(v_hash, hash_relleno())) = coalesce(v_hash, '-') and v_activa then
    return query select v_id, 0;
    return;
  end if;
  insert into audit_log (tabla, accion, detalle)
  values ('sesion', 'LOGIN_FALLIDO',
          coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('email', v_email, 'motivo', 'invalid_credentials')
            || case when p_ip is not null then jsonb_build_object('ip', p_ip) else '{}'::jsonb end
            || case when p_conocido is not null then jsonb_build_object('conocido', p_conocido) else '{}'::jsonb end);
  return query select null::uuid, 0;
end;
$$;
revoke execute on function public.ingreso_intentar(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ingreso_intentar(text, text, text, text, jsonb) to service_role;

-- ingreso_valido (la verificación suelta) ya no la usa la app nueva: se quita en la migración siguiente, para que la
-- versión anterior siga entrando mientras se despliega la nueva.

-- Auth no manda correos (hook «send email»): códigos y recuperación por correo, apagados.
create or replace function public.hook_sin_correo(event jsonb)
  returns jsonb language sql stable
as $$
  select jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'No disponible'))
$$;
revoke execute on function public.hook_sin_correo(jsonb) from public, anon, authenticated;
grant execute on function public.hook_sin_correo(jsonb) to supabase_auth_admin;
