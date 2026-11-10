#!/usr/bin/env bash
# Copia los datos de producción a la base LOCAL (contenedor supabase_db_erp-prod1), para probar con lo real.
#   bash scripts/prod-a-local.sh
# Solo LEE producción (pg_dump de datos). En local reemplaza todo: los datos de public, las cuentas (auth.users e
# identities) y la lista de archivos (storage.objects; los archivos mismos no se copian). El esquema local no se toca: si la
# rama tiene migraciones que producción aún no, sus columnas nuevas quedan con su valor por defecto.
# Después: los usuarios de prueba, la obra demo y las demos (scripts/demos-locales.sh) y la plantilla del Excel.
set -euo pipefail
# Git Bash (Windows) no debe convertir las rutas del contenedor (/tmp/…) en rutas de Windows.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
ENV=.env.produccion.local
[ -f "$ENV" ] || { echo "Falta $ENV" >&2; exit 1; }
valor() { grep -h "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '"'; }
PGPASSWORD="$(valor SUPABASE_DB_PASSWORD)"
REF="$(valor NEXT_PUBLIC_SUPABASE_URL | sed -E 's#https?://([^.]+)\.supabase\.co.*#\1#')"
[ -n "$PGPASSWORD" ] && [ -n "$REF" ] || { echo "Faltan SUPABASE_DB_PASSWORD o NEXT_PUBLIC_SUPABASE_URL en $ENV" >&2; exit 1; }
PROD="host=aws-1-sa-east-1.pooler.supabase.com port=5432 user=postgres.$REF dbname=postgres sslmode=require"
C=supabase_db_erp-prod1

echo "== 1. Datos de producción (solo lectura)"
docker exec -e PGPASSWORD="$PGPASSWORD" $C pg_dump "$PROD" --data-only -Fc -n public -f /tmp/prod-public.dump
docker exec -e PGPASSWORD="$PGPASSWORD" $C pg_dump "$PROD" --data-only -Fc -t auth.users -t auth.identities -t storage.objects -f /tmp/prod-auth.dump

echo "== 2. Local: vaciar y cargar (sin disparadores ni auditoría)"
docker exec -i -e PGCLIENTENCODING=UTF8 $C psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
set session_replication_role = replica;
set storage.allow_delete_query = 'true';
do $$
declare t text;
begin
  select string_agg(format('public.%I', tablename), ', ') into t from pg_tables where schemaname = 'public';
  execute 'truncate ' || t || ' restart identity cascade';
end $$;
-- Las cuentas y todo lo que cuelga de ellas (identidades, sesiones, factores…).
truncate auth.users cascade;
delete from storage.objects;
SQL
docker exec -e PGOPTIONS="-c session_replication_role=replica" $C pg_restore -U supabase_admin -d postgres --data-only --no-owner -j 2 /tmp/prod-public.dump
docker exec -e PGOPTIONS="-c session_replication_role=replica" $C pg_restore -U supabase_admin -d postgres --data-only --no-owner /tmp/prod-auth.dump
docker exec $C rm -f /tmp/prod-public.dump /tmp/prod-auth.dump

echo "== 3. Usuarios de prueba y obra demo"
for f in supabase/seed/usuarios_locales.sql supabase/seed/demo.sql; do
  docker exec -i -e PGCLIENTENCODING=UTF8 $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <"$f" >/dev/null
  echo "   $f"
done
docker exec -i $C psql -U postgres -At -c "select 'órdenes ' || count(*) from ordenes_compra" -c "select 'usuarios ' || count(*) from auth.users"
