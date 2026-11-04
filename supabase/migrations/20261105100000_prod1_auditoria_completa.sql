-- Prod 1: auditoría de todo lo que cambia la base. Antes, solo 13 tablas tenían el trigger (órdenes,
-- comprobantes, pagos…); ahora todas las del negocio (obras, partidas, proveedores y sus cuentas, perfiles,
-- rechazos, detracciones, empresas…). Cada fila del registro dice quién (el usuario; con la clave secreta, el
-- que la app indica en x-actor), cuándo, la tabla, el registro (su clave primaria) y qué cambió.
-- Las sesiones (inicio, intento fallido, cierre, cambio de contraseña) y las acciones de cuentas del Admin las
-- registra la app en la misma tabla (tabla «sesion» / «usuarios»). Solo el Admin lee el registro.
-- No se auditan: el propio registro, los avisos, las suscripciones push, los accesos al link de cotización
-- (tienen su propia tabla) ni las marcas de datos demo. Las cargas masivas (Excel) lo apagan con app.skip_audit.

create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_det jsonb;
  v_reg text;
  v_actor uuid := auth.uid();
begin
  if coalesce(current_setting('app.skip_audit', true), '') = 'on' then
    return null;
  end if;
  -- Con la clave secreta (acciones del Admin en el servidor) no hay usuario en el token: la app lo pasa en x-actor.
  if v_actor is null and auth.role() = 'service_role' then
    begin
      v_actor := nullif(current_setting('request.headers', true)::json ->> 'x-actor', '')::uuid;
    exception when others then
      v_actor := null;
    end;
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  -- El registro: su clave primaria (compuesta, unida con «/»).
  select string_agg(v_row ->> a.attname, '/' order by k.ord)
    into v_reg
    from pg_index i
    cross join lateral unnest(i.indkey) with ordinality k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
   where i.indrelid = tg_relid and i.indisprimary;
  v_reg := coalesce(v_reg, v_row ->> 'id');
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value))
      into v_det
      from jsonb_each(v_new) n
     where n.value is distinct from (v_old -> n.key)
       and n.key not in ('updated_at', 'updated_by');
    if v_det is null then
      return null;
    end if;
  else
    v_det := v_row;
  end if;
  insert into public.audit_log (user_id, tabla, registro, accion, detalle)
  values (v_actor, tg_table_name, v_reg, tg_op, v_det);
  return null;
end;
$$;

-- El trigger en todas las tablas del negocio que aún no lo tienen.
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('audit_log', 'notificaciones', 'push_suscripciones', 'cotizacion_accesos', 'datos_demo')
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname like 'audit%')
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function public.fn_audit()', t.relname);
  end loop;
end;
$$;

-- Para los reportes: por usuario y fecha, y por tabla.
create index if not exists audit_log_creado_idx on public.audit_log (created_at desc);
create index if not exists audit_log_usuario_idx on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_tabla_idx on public.audit_log (tabla, created_at desc);
