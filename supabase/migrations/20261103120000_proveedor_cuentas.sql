-- Cuentas bancarias de los proveedores en una tabla aparte. La RLS es por filas y todos los usuarios son el
-- mismo rol de base (authenticated), así que dos columnas de proveedores no se pueden cerrar por rol:
-- se mueven a proveedor_cuentas, que solo leen Logística, Tesorería, Contabilidad y Gerencia (y ADMIN).
-- Operaciones, Jefe de Operaciones, Residente y RRHH siguen leyendo proveedores, sin las cuentas.
-- Solo Logística (y ADMIN) las registra, como el resto de la ficha del proveedor.

create table public.proveedor_cuentas (
  proveedor_id    bigint primary key references public.proveedores (id) on delete cascade,
  banco           text,
  cuenta_bancaria text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid()
);

comment on table public.proveedor_cuentas is
  'Banco y cuenta del proveedor. Lectura: Logística, Tesorería, Contabilidad, Gerencia y ADMIN.';

-- Solo si cambia la cuenta: la ficha del proveedor la vuelve a guardar (upsert) aunque no se haya tocado.
create trigger proveedor_cuentas_updated before update on public.proveedor_cuentas
  for each row
  when (old.banco is distinct from new.banco or old.cuenta_bancaria is distinct from new.cuenta_bancaria)
  execute function public.fn_set_updated();

alter table public.proveedor_cuentas enable row level security;

revoke all on public.proveedor_cuentas from anon;
grant select, insert, update, delete on public.proveedor_cuentas to authenticated;
grant all on public.proveedor_cuentas to service_role;

create policy proveedor_cuentas_select on public.proveedor_cuentas for select to authenticated
  using ((select public.rol_en('LOGISTICA', 'TESORERIA', 'CONTABILIDAD', 'GERENCIA')));
create policy proveedor_cuentas_insert on public.proveedor_cuentas for insert to authenticated
  with check ((select public.rol_en('LOGISTICA')));
create policy proveedor_cuentas_update on public.proveedor_cuentas for update to authenticated
  using ((select public.rol_en('LOGISTICA'))) with check ((select public.rol_en('LOGISTICA')));
create policy proveedor_cuentas_delete on public.proveedor_cuentas for delete to authenticated
  using ((select public.rol_en('LOGISTICA')));
-- Como en todas las tablas (20261102150000): sin perfil no se lee ni escribe.
create policy con_perfil on public.proveedor_cuentas as restrictive for all to authenticated
  using ((select public.rol_actual()) <> '') with check ((select public.rol_actual()) <> '');

insert into public.proveedor_cuentas (proveedor_id, banco, cuenta_bancaria)
select id, banco, cuenta_bancaria
  from public.proveedores
 where banco is not null or cuenta_bancaria is not null;

-- Vistas de Tesorería: las mismas columnas, en el mismo orden, con las cuentas desde proveedor_cuentas
-- (LEFT JOIN: para quien no las puede leer salen nulas, sin perder la fila).
do $$
declare
  v text;
  d text;
begin
  foreach v in array array['v_por_pagar', 'v_pendientes_pago'] loop
    d := pg_get_viewdef(('public.' || v)::regclass, true);
    if (length(d) - length(replace(d, 'pr.banco,', ''))) / length('pr.banco,') <> 2
       or (length(d) - length(replace(d, 'pr.cuenta_bancaria,', ''))) / length('pr.cuenta_bancaria,') <> 2
       or (length(d) - length(replace(d, 'JOIN proveedores pr ON pr.id = ', ''))) / length('JOIN proveedores pr ON pr.id = ') <> 2 then
      raise exception '% cambió: revisar el reemplazo de las cuentas bancarias', v;
    end if;
    d := replace(d, 'pr.banco,', 'pc.banco,');
    d := replace(d, 'pr.cuenta_bancaria,', 'pc.cuenta_bancaria,');
    d := regexp_replace(d, 'JOIN proveedores pr ON pr\.id = ([a-z]+\.proveedor_id)',
                        'JOIN proveedores pr ON pr.id = \1' || chr(10) || '     LEFT JOIN proveedor_cuentas pc ON pc.proveedor_id = pr.id', 'g');
    execute format('create or replace view public.%I with (security_invoker = on) as %s', v, d);
  end loop;
end $$;

alter table public.proveedores drop column banco, drop column cuenta_bancaria;
