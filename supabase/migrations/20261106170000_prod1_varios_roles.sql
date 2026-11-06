-- Una persona puede tener varios roles (06/11/2026). Por ejemplo, Tesorería y Gerencia.
--   · perfil_roles: todos los roles de la persona. perfiles.rol sigue siendo el rol con el que trabaja ahora: un rol a
--     la vez, así rol_actual(), rol_en(), exigir_rol() y todas las políticas siguen igual (varias son restricciones,
--     como que el Jefe no vea lo financiero: sumar los permisos de dos roles las rompería).
--   · cambiar_rol: la persona pasa a otro de SUS roles (lo revisa la base). Lo asigna solo el Admin (con la clave secreta).
--   · Lo que mira a la persona y no a la sesión usa todos sus roles: avisos, firmante de una empresa, DNI obligatorio.

create table public.perfil_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  rol public.rol not null,
  primary key (user_id, rol)
);
alter table public.perfil_roles enable row level security;
revoke all on public.perfil_roles from anon, authenticated;
grant select on public.perfil_roles to authenticated;
-- Cada uno ve los suyos (rol_actual() vacío: sesión bloqueada o rol sin módulo). Nadie los escribe desde la API.
create policy propios on public.perfil_roles for select to authenticated
  using (user_id = (select auth.uid()) and (select public.rol_actual()) <> '');
create index perfil_roles_rol on public.perfil_roles (rol);

insert into public.perfil_roles (user_id, rol) select user_id, rol from public.perfiles;

-- El rol con el que trabaja siempre es uno de los suyos (también en las altas y los cambios que no pasan por el Admin).
create or replace function public.fn_perfil_rol()
  returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into perfil_roles (user_id, rol) values (new.user_id, new.rol) on conflict do nothing;
  return null;
end;
$$;
revoke execute on function public.fn_perfil_rol() from public, anon, authenticated;
create trigger perfiles_rol after insert or update of rol on public.perfiles
  for each row execute function public.fn_perfil_rol();

create trigger audit_perfil_roles after insert or delete or update on public.perfil_roles
  for each row execute function public.fn_audit();

-- Pasar a otro de sus roles. El token toma el rol al renovarse (lo hace la app enseguida); la base, al instante.
create or replace function public.cambiar_rol(p_rol text)
  returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.sesion_bloqueada() or coalesce(public.rol_actual(), '') = '' then
    raise exception 'No tienes permiso para esta acción';
  end if;
  if not public.rol_prod1(p_rol) or not exists (select 1 from perfil_roles where user_id = auth.uid() and rol::text = p_rol) then
    raise exception 'No tienes ese rol';
  end if;
  update perfiles set rol = p_rol::public.rol where user_id = auth.uid() and rol::text <> p_rol;
end;
$$;
revoke execute on function public.cambiar_rol(text) from public, anon;
grant execute on function public.cambiar_rol(text) to authenticated;

-- Los avisos llegan por todos sus roles, no solo por el que tiene abierto.
create or replace function public.notificar(p_rol text, p_tipo text, p_titulo text, p_cuerpo text, p_href text)
  returns void language sql security definer set search_path = public, pg_temp
as $$
  with activos as (
    select r.user_id, r.rol::text as rol
      from perfil_roles r join auth.users u on u.id = r.user_id
     where (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null
  ), destinatarios as (
    select a.user_id, coalesce(pr.celular, true) as push
      from activos a left join aviso_preferencias pr on pr.user_id = a.user_id and pr.tipo = p_tipo
     where (a.rol = p_rol or (p_rol = 'JEFE_OPERACIONES' and a.rol = 'OPERACIONES')) and coalesce(pr.avisar, true)
    union
    select a.user_id, pr.celular
      from activos a join aviso_preferencias pr on pr.user_id = a.user_id and pr.tipo = p_tipo
     where a.rol in ('ADMIN', 'GERENCIA') and a.rol <> p_rol and pr.avisar
  )
  insert into notificaciones (user_id, tipo, titulo, cuerpo, href, push)
  select user_id, p_tipo, p_titulo, nullif(btrim(coalesce(p_cuerpo, '')), ''), p_href, bool_or(push)
    from destinatarios group by user_id;
$$;

-- El DNI es obligatorio si entre sus roles está Gerencia, aunque no sea el principal.
do $$
declare
  v_def text := pg_get_functiondef('public.bienvenida_completar(text, text, text, text, text, text)'::regprocedure);
  v_nuevo text;
begin
  v_nuevo := replace(v_def, $r$if v_rol = 'GERENCIA' and coalesce(p_dni, '') = '' then$r$,
    $r$if exists (select 1 from perfil_roles where user_id = v_inv.user_id and rol = 'GERENCIA') and coalesce(p_dni, '') = '' then$r$);
  if v_nuevo = v_def then raise exception 'bienvenida_completar cambió: revisar la migración'; end if;
  execute v_nuevo;
end $$;
