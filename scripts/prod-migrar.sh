#!/usr/bin/env bash
# Migraciones pendientes a producción: primero un respaldo de la base (C:\Code\Projects\ERP\respaldos, debe pesar más de
# 500 KB), después supabase db push. Sin migraciones pendientes no hace nada.
#   bash scripts/prod-migrar.sh            respalda y aplica
#   bash scripts/prod-migrar.sh --ver      solo muestra qué aplicaría
# La contraseña y el proyecto salen de .env.produccion.local (fuera del repo); no se imprimen.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=.env.produccion.local
[ -f "$ENV" ] || { echo "Falta $ENV" >&2; exit 1; }
valor() { grep -h "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '"'; }
PGPASSWORD="$(valor SUPABASE_DB_PASSWORD)"
REF="$(valor NEXT_PUBLIC_SUPABASE_URL | sed -E 's#https?://([^.]+)\.supabase\.co.*#\1#')"
[ -n "$PGPASSWORD" ] && [ -n "$REF" ] || { echo "Faltan SUPABASE_DB_PASSWORD o NEXT_PUBLIC_SUPABASE_URL en $ENV" >&2; exit 1; }

pendientes="$(npx supabase db push -p "$PGPASSWORD" --dry-run 2>&1)"
echo "$pendientes" | grep -E '^ • |up to date|upToDate' || true
if ! echo "$pendientes" | grep -q '^ • '; then
  echo "Sin migraciones pendientes"
  exit 0
fi
[ "${1:-}" = "--ver" ] && exit 0

respaldo="C:/Code/Projects/ERP/respaldos/prod-$(date +%Y%m%d-%H%M%S)-antes-de-migrar.dump"
docker exec -e PGPASSWORD="$PGPASSWORD" supabase_db_erp-prod1 pg_dump \
  "host=aws-1-sa-east-1.pooler.supabase.com port=5432 user=postgres.$REF dbname=postgres sslmode=require" \
  -Fc -n public -n auth -n storage >"$respaldo"
peso=$(wc -c <"$respaldo")
[ "$peso" -gt 500000 ] || { echo "El respaldo pesa solo $peso bytes: no se migra" >&2; exit 1; }
echo "Respaldo: $respaldo ($peso bytes)"
npx supabase db push -p "$PGPASSWORD" --yes 2>&1 | tail -5
