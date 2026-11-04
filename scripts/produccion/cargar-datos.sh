#!/usr/bin/env bash
# Carga los datos reales en la base de producción (Supabase en la nube), en orden, sin demos ni usuarios de
# prueba. Antes: migraciones (`npx supabase db push`) y el primer Admin (crear-admin.mjs).
#
#   PROD_DB_URL='postgresql://postgres.xxx:CLAVE@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' \
#     bash scripts/produccion/cargar-datos.sh
#
# Usa el psql del contenedor local de Supabase (no hace falta instalarlo). Cada archivo va en una
# transacción: si uno falla, se detiene y no queda a medias.
set -euo pipefail
: "${PROD_DB_URL:?Define PROD_DB_URL (cadena de conexión de la base de producción)}"
cd "$(dirname "$0")/../../supabase/seed"

SEEDS=(
  base.sql            # plan contable mínimo y catálogos
  excel.sql           # el Excel de Logística (generado por scripts/extract_excel.py; NO versionado)
  tipo_material.sql   # clasificación inicial de ítems
  cuentas_items.sql   # cuenta contable de cada ítem
  historico.sql       # órdenes pagadas del Excel: entregadas y recibidas
  prod1_historico.sql # marca de histórico
  prod1_envio.sql     # las facturadas completas pasan a Tesorería
)
# No van: usuarios_locales.sql, asignaciones.sql (residentes de prueba), demo.sql y los scripts db:demo-*.

for f in "${SEEDS[@]}"; do
  echo "== $f"
  docker exec -i -e PGCLIENTENCODING=UTF8 supabase_db_erp-prod1 \
    psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 -q --single-transaction < "$f"
done
echo "== listo"
