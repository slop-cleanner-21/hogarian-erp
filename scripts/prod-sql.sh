#!/usr/bin/env bash
# SQL contra la base de producción (Supabase en la nube), para revisar o corregir datos vivos.
#   bash scripts/prod-sql.sh archivo.sql      el SQL de un archivo
#   bash scripts/prod-sql.sh <<'SQL' … SQL    el SQL por la entrada estándar
# La contraseña y el proyecto salen de .env.produccion.local (fuera del repo); no se imprimen. Corre psql dentro del
# contenedor local de Postgres, en una transacción: si una sentencia falla, no se aplica nada.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env.produccion.local
[ -f "$ENV" ] || { echo "Falta $ENV" >&2; exit 1; }
valor() { grep -h "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '"'; }
PGPASSWORD="$(valor SUPABASE_DB_PASSWORD)"
REF="$(valor NEXT_PUBLIC_SUPABASE_URL | sed -E 's#https?://([^.]+)\.supabase\.co.*#\1#')"
[ -n "$PGPASSWORD" ] && [ -n "$REF" ] || { echo "Faltan SUPABASE_DB_PASSWORD o NEXT_PUBLIC_SUPABASE_URL en $ENV" >&2; exit 1; }
CONN="host=aws-1-sa-east-1.pooler.supabase.com port=5432 user=postgres.$REF dbname=postgres sslmode=require"
if [ $# -ge 1 ]; then
  [ -f "$1" ] || { echo "No existe $1" >&2; exit 1; }
  exec <"$1"
fi
docker exec -i -e PGPASSWORD="$PGPASSWORD" -e PGCLIENTENCODING=UTF8 supabase_db_erp-prod1 \
  psql "$CONN" -v ON_ERROR_STOP=1 --single-transaction -X -At -F ' | '
