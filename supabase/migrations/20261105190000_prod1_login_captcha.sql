-- Ingreso: reintentos y CAPTCHA por IP. Desde el 3.er intento fallido desde una IP, esa IP pide CAPTCHA para
-- siempre (y espera cada vez más entre intentos fallidos). Solo la usa el servidor (clave secreta).

create table public.login_ips (
  ip text primary key,
  fallos integer not null default 0,     -- intentos fallidos desde esta IP (en total: no se reinician)
  captcha_desde timestamptz,             -- desde cuándo pide CAPTCHA (para siempre)
  ultimo_fallo_at timestamptz
);
alter table public.login_ips enable row level security;
revoke all on public.login_ips from anon, authenticated;

-- Un intento fallido desde la IP (atómico entre pedidos simultáneos). nuevo_captcha: recién marcada.
create or replace function public.login_fallo_ip(p_ip text)
  returns table (fallos integer, captcha boolean, nuevo_captcha boolean)
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r login_ips%rowtype;
  v_nuevo boolean := false;
begin
  insert into login_ips as l (ip, fallos, ultimo_fallo_at) values (p_ip, 1, now())
  on conflict (ip) do update set fallos = l.fallos + 1, ultimo_fallo_at = now()
  returning * into r;
  if r.fallos >= 3 and r.captcha_desde is null then
    update login_ips set captcha_desde = now() where ip = p_ip returning * into r;
    v_nuevo := true;
  end if;
  return query select r.fallos, r.captcha_desde is not null, v_nuevo;
end;
$$;
revoke execute on function public.login_fallo_ip(text) from public, anon, authenticated;
grant execute on function public.login_fallo_ip(text) to service_role;
