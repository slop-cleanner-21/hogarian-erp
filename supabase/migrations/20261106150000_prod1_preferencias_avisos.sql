-- Cada usuario elige sus avisos (06/11/2026). Por evento: «avisar» (campana) y «al celular» (push; solo si avisa).
--   · Los eventos de su rol llegan por defecto (campana y celular); se pueden apagar.
--   · El Admin y Gerencia pueden sumarse a cualquier evento de los demás: por defecto ninguno (que no les llene el
--     celular); al sumarse, el celular arranca apagado.
-- Solo se guarda lo que cambió del defecto. La lista de eventos y a qué rol le tocan está en src/lib/avisos.ts.

create table public.aviso_preferencias (
  user_id uuid not null references auth.users (id) on delete cascade,
  tipo text not null check (tipo ~ '^[A-Z_]{2,40}$'),
  avisar boolean not null,
  celular boolean not null,
  primary key (user_id, tipo)
);
alter table public.aviso_preferencias enable row level security;
revoke all on public.aviso_preferencias from anon, authenticated;
grant select, insert, update, delete on public.aviso_preferencias to authenticated;
-- Cada uno, las suyas (y no con la sesión bloqueada).
create policy propias on public.aviso_preferencias for all to authenticated
  using (user_id = (select auth.uid()) and not (select public.sesion_bloqueada()))
  with check (user_id = (select auth.uid()) and not (select public.sesion_bloqueada()));

-- Si el aviso sale también como notificación al celular.
alter table public.notificaciones add column push boolean not null default true;

-- A quién le llega cada aviso: las cuentas activas del rol que no lo apagaron (natural) y el Admin o Gerencia que se
-- sumaron (opcional). Lo del Jefe de Operaciones le llega también al Ingeniero (tienen lo mismo).
create or replace function public.notificar(p_rol text, p_tipo text, p_titulo text, p_cuerpo text, p_href text)
  returns void language sql security definer set search_path = public, pg_temp
as $$
  with activos as (
    select p.user_id, p.rol::text as rol
      from perfiles p join auth.users u on u.id = p.user_id
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

-- El presupuesto publicado: un solo aviso para el Jefe y el Ingeniero de Operaciones (antes, uno por rol: quien se
-- sumara a ese evento lo recibía dos veces).
do $$
declare
  v_def text := pg_get_functiondef('public.publicar_presupuesto(bigint)'::regprocedure);
  v_nuevo text;
begin
  v_nuevo := regexp_replace(v_def, $r$perform notificar\(r, 'PRESUPUESTO'$r$, $r$perform notificar('JEFE_OPERACIONES', 'PRESUPUESTO'$r$);
  v_nuevo := regexp_replace(v_nuevo, $r$\)\s*from unnest\(array\['OPERACIONES', 'JEFE_OPERACIONES'\]\) r;$r$, ');');
  if v_nuevo = v_def or position('unnest' in v_nuevo) > 0 then raise exception 'publicar_presupuesto cambió: revisar la migración'; end if;
  execute v_nuevo;
end $$;
