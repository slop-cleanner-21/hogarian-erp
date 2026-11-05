-- Nombres y apellidos por separado (06/11/2026). `nombre` sigue siendo el nombre completo que muestra la app (menú,
-- auditoría, contratos): ahora lo arma la base con los dos (trigger). Los de hoy se separan por la primera palabra
-- («José Vergara» → José / Vergara); quien tiene un solo nombre queda sin apellidos hasta que los complete (link de
-- bienvenida o el Admin).

alter table public.perfiles add column nombres text, add column apellidos text;

update public.perfiles
   set nombres = split_part(btrim(nombre), ' ', 1),
       apellidos = nullif(btrim(substring(btrim(nombre) from length(split_part(btrim(nombre), ' ', 1)) + 1)), '');

create or replace function public.fn_perfil_nombre()
  returns trigger language plpgsql set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Una carga que solo trae el nombre (semillas, scripts): todo va a nombres.
    if new.nombres is null and new.apellidos is null then new.nombres := new.nombre; end if;
  elsif new.nombre is distinct from old.nombre and new.nombres is not distinct from old.nombres and new.apellidos is not distinct from old.apellidos then
    -- Alguien cambió solo el nombre completo (algo viejo): pasa a nombres.
    new.nombres := new.nombre;
    new.apellidos := null;
  end if;
  new.nombres := nullif(btrim(regexp_replace(coalesce(new.nombres, ''), '\s+', ' ', 'g')), '');
  new.apellidos := nullif(btrim(regexp_replace(coalesce(new.apellidos, ''), '\s+', ' ', 'g')), '');
  new.nombre := coalesce(nullif(btrim(concat_ws(' ', new.nombres, new.apellidos)), ''), new.nombre);
  return new;
end;
$$;
create trigger perfiles_nombre before insert or update on public.perfiles
  for each row execute function public.fn_perfil_nombre();
revoke execute on function public.fn_perfil_nombre() from public, anon, authenticated;

-- El nombre completo pasa al token también cuando cambian nombres o apellidos (un trigger «update of nombre» no ve el
-- cambio que hace otro trigger).
drop trigger if exists perfiles_a_token on public.perfiles;
create trigger perfiles_a_token after insert or update of rol, nombre, nombres, apellidos on public.perfiles
  for each row execute function public.fn_perfil_a_token();

-- El link de bienvenida guarda nombres y apellidos por separado.
drop function if exists public.bienvenida_completar(text, text, text, text, text);
create or replace function public.bienvenida_completar(
  p_hash text, p_nombres text, p_apellidos text, p_dni text, p_telefono text, p_clave text
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
  if length(btrim(coalesce(p_nombres, ''))) < 2 or length(p_nombres) > 80 then raise exception 'Ingresa tus nombres'; end if;
  if length(btrim(coalesce(p_apellidos, ''))) < 2 or length(p_apellidos) > 80 then raise exception 'Ingresa tus apellidos'; end if;
  if coalesce(p_dni, '') !~ '^([0-9]{8})?$' then raise exception 'El DNI tiene 8 dígitos'; end if;
  if v_rol = 'GERENCIA' and coalesce(p_dni, '') = '' then raise exception 'Ingresa tu DNI: va en los contratos que firmas'; end if;
  if coalesce(p_telefono, '') !~ '^([0-9]{8,15})?$' then raise exception 'Celular no válido'; end if;

  update invitaciones set usada_at = now() where id = v_inv.id;
  update invitaciones set expira_at = now() where user_id = v_inv.user_id and usada_at is null;
  update perfiles set nombres = p_nombres, apellidos = p_apellidos where user_id = v_inv.user_id;
  insert into perfil_privado (user_id, dni, telefono) values (v_inv.user_id, nullif(p_dni, ''), nullif(p_telefono, ''))
  on conflict (user_id) do update set dni = excluded.dni, telefono = excluded.telefono;
  perform fijar_contrasena(v_inv.user_id, p_clave);
  return v_inv.user_id;
end;
$$;
revoke execute on function public.bienvenida_completar(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.bienvenida_completar(text, text, text, text, text, text) to service_role;
