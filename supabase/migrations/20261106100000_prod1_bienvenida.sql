-- Entregar los accesos (06/11/2026):
-- - Link de bienvenida, de un solo uso: el Admin lo genera para una cuenta; al abrirlo, el usuario completa sus datos
--   (nombres y apellidos, DNI, celular: solo esa vez) y crea su contraseña; luego deja de servir. Vence a los 7 días;
--   generar otro (o una contraseña temporal) invalida el anterior.
-- - Celular de cada usuario (para pasarle el link o la contraseña por WhatsApp), en perfil_privado como el DNI: solo
--   lo lee el servidor.

alter table public.perfil_privado add column telefono text check (telefono ~ '^[0-9]{8,15}$');

create table public.invitaciones (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,          -- sha256 del token (el token solo lo tiene el link)
  creada_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expira_at timestamptz not null,
  usada_at timestamptz
);
create index on public.invitaciones (user_id);
alter table public.invitaciones enable row level security;
revoke all on public.invitaciones from anon, authenticated;

-- Usa el link: valida (sin usar, sin vencer, cuenta activa), guarda los datos y la contraseña y lo marca usado, todo a
-- la vez (un segundo envío simultáneo no pasa). Devuelve el usuario. Solo el servidor.
create or replace function public.bienvenida_completar(
  p_hash text, p_nombre text, p_dni text, p_telefono text, p_clave text
) returns uuid
  language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare
  v_inv invitaciones%rowtype;
  v_rol text;
begin
  select * into v_inv from invitaciones where token_hash = p_hash for update;
  if not found or v_inv.usada_at is not null or v_inv.expira_at <= now() then
    raise exception 'Este link ya no sirve';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_inv.user_id and (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null) then
    raise exception 'La cuenta está desactivada';
  end if;
  select rol::text into v_rol from perfiles where user_id = v_inv.user_id;
  if v_rol is null then raise exception 'La cuenta no tiene rol'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 or length(p_nombre) > 120 then raise exception 'Ingresa tu nombre y apellidos'; end if;
  if coalesce(p_dni, '') !~ '^([0-9]{8})?$' then raise exception 'El DNI tiene 8 dígitos'; end if;
  if v_rol = 'GERENCIA' and coalesce(p_dni, '') = '' then raise exception 'Ingresa tu DNI: va en los contratos que firmas'; end if;
  if coalesce(p_telefono, '') !~ '^([0-9]{8,15})?$' then raise exception 'Celular no válido'; end if;

  update invitaciones set usada_at = now() where id = v_inv.id;
  -- Las demás sin usar de la cuenta dejan de servir.
  update invitaciones set expira_at = now() where user_id = v_inv.user_id and usada_at is null;
  update perfiles set nombre = trim(p_nombre) where user_id = v_inv.user_id;
  insert into perfil_privado (user_id, dni, telefono) values (v_inv.user_id, nullif(p_dni, ''), nullif(p_telefono, ''))
  on conflict (user_id) do update set dni = excluded.dni, telefono = excluded.telefono;
  perform fijar_contrasena(v_inv.user_id, p_clave);
  return v_inv.user_id;
end;
$$;
revoke execute on function public.bienvenida_completar(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bienvenida_completar(text, text, text, text, text) to service_role;
