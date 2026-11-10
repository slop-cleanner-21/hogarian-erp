#!/usr/bin/env bash
# Las demos locales, después de `npx supabase db reset`. SOLO LOCAL: corre contra el contenedor de Supabase de esta máquina.
#
# Los scripts de demo simulan el recorrido del MVP con cuentas que en prod 1 no entran (Residente, RRHH, Contabilidad) y
# con el Jefe escribiendo. Mientras corren, las funciones que deciden el rol se cambian por las del MVP y las que le niegan
# la escritura al Jefe dejan de hacerlo; al terminar (también si algo falla) vuelven las de prod 1, tal como estaban.
#
#   ERP_PASS=erp12345 npm run db:demos
set -uo pipefail
cd "$(dirname "$0")/.."
: "${ERP_PASS:?Define ERP_PASS (la contraseña de los usuarios de prueba)}"

psql_local() { docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_erp-prod1 psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

ORIGINAL="$(mktemp)"
psql_local -At > "$ORIGINAL" <<'SQL'
select pg_get_functiondef(p.oid) || ';' from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and (p.proname in ('rol_actual', 'rol_en', 'exigir_rol')
        or pg_get_functiondef(p.oid) like $g$%in ('', 'JEFE_OPERACIONES') then%$g$);
SQL
[ -s "$ORIGINAL" ] || { echo "No pude leer las funciones de rol"; exit 1; }

restaurar() {
  psql_local --single-transaction < "$ORIGINAL" && echo "== funciones de prod 1 restauradas"
  rm -f "$ORIGINAL"
}
trap restaurar EXIT

psql_local --single-transaction <<'SQL'
create or replace function public.rol_actual() returns text language sql stable security definer set search_path = public
  as $$ select rol::text from public.perfiles where user_id = auth.uid() $$;
create or replace function public.rol_en(variadic p_roles text[]) returns boolean language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select rol::text = 'ADMIN' or rol::text = any (p_roles) from public.perfiles where user_id = auth.uid()), false) $$;
create or replace function public.exigir_rol(variadic p_roles text[]) returns void language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') and coalesce(rol_actual(), '') <> all (p_roles || 'ADMIN'::text) then
    raise exception 'No tienes permiso para esta acción';
  end if;
end;
$$;
do $do$
declare f record;
begin
  for f in select pg_get_functiondef(p.oid) d from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and pg_get_functiondef(p.oid) like $g$%in ('', 'JEFE_OPERACIONES') then%$g$ loop
    execute replace(f.d, $g$in ('', 'JEFE_OPERACIONES') then$g$, $g$in ('') then$g$);
  end loop;
end $do$;
SQL

# DEMOS="db:demo-tesoreria" corre solo esas (p. ej. tras copiar los datos de producción con scripts/prod-a-local.sh).
for demo in ${DEMOS:-db:demo-entregas db:simular db:demo-archivos db:demo-fotos db:demo-requerimientos db:demo-tesoreria}; do
  echo "== $demo"
  if ! npm run --silent "$demo"; then
    # Los requerimientos son del MVP (prod 1 no los tiene): si sus partidas no están (otros datos), se sigue.
    [ "$demo" = db:demo-requerimientos ] && { echo "   (sin la demo de requerimientos: es del MVP)"; continue; }
    exit 1
  fi
done
echo "== listo"
