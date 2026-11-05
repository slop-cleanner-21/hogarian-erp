#!/usr/bin/env bash
# Vuelve a cargar el Excel en una base ya en uso, partiendo de cero en lo operativo: borra obras, órdenes, comprobantes,
# pagos, proveedores e ítems (y lo que cuelga de ellos) y corre los mismos seeds de cargar-datos.sh.
#
# Se conservan las cuentas (perfiles, credenciales, huellas, sus avisos), la auditoría, los catálogos (plan contable,
# etapas, tipos de material), los parámetros y lo que el Admin puso en las empresas (razón social, dirección, firmante).
# Todo va en UNA transacción: si algo falla, la base queda como estaba. No borra archivos del storage.
#
#   DB_CONN='host=… port=5432 user=postgres.xxx dbname=postgres sslmode=require' PGPASSWORD=… \
#     bash scripts/produccion/recargar-datos.sh
#
# Antes: un respaldo (pg_dump). Usa el psql del contenedor local de Supabase.
set -euo pipefail
: "${DB_CONN:?Define DB_CONN (cadena de conexión de la base)}"
cd "$(dirname "$0")/../../supabase/seed"

{
  cat <<'SQL'
create temp table _empresas on commit drop as select * from public.empresas;
truncate public.adelantos, public.adjuntos, public.asiento_lineas, public.asientos, public.avance_fotos, public.avances,
  public.comprobantes, public.comprobantes_historial, public.cotizacion_accesos, public.datos_demo, public.detracciones,
  public.empresas, public.entrega_fotos, public.entregas, public.guias, public.items, public.notificaciones,
  public.obra_etapas, public.obras, public.oc_items, public.ordenes_compra, public.ordenes_pago, public.pago_aplicaciones,
  public.pagos, public.partidas, public.perfil_obras, public.proveedor_contactos, public.proveedor_cuentas,
  public.proveedor_tipos_material, public.proveedores, public.rechazos, public.requerimientos_obra,
  public.requerimientos_obra_items, public.retenciones, public.solicitud_adjuntos, public.solicitudes,
  public.valorizacion_partidas, public.valorizaciones
  restart identity;
SQL
  # Los mismos de cargar-datos.sh, en el mismo orden.
  cat base.sql excel.sql tipo_material.sql cuentas_items.sql historico.sql prod1_historico.sql prod1_envio.sql
  cat <<'SQL'
-- Lo que el Admin ajustó en las empresas (excel.sql las crea solo con nombre y RUC).
set local app.skip_audit = 'on';
update public.empresas e
   set nombre = a.nombre, ruc = a.ruc, razon_social = a.razon_social, direccion = a.direccion, firmante_id = a.firmante_id
  from _empresas a where a.id = e.id;
do $$
begin
  if (select count(*) from public.empresas) <> (select count(*) from _empresas) then
    raise exception 'Las empresas no coinciden con las de antes: no se carga nada';
  end if;
end $$;
SQL
} | docker exec -i -e PGCLIENTENCODING=UTF8 -e PGPASSWORD supabase_db_erp-prod1 \
  psql "$DB_CONN" -v ON_ERROR_STOP=1 -q --single-transaction
echo "== listo"
