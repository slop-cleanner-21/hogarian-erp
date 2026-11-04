-- Prod 1: datos de la OS para su contrato, retención de 4ta por proveedor y la firma del gerente.
--
-- * OS: al crearla, Logística elige el comprobante que emitirá el proveedor (recibo por honorarios →
--   contrato de locación de servicios; factura → contrato comercial, sin concepto del recibo) y la fecha de
--   inicio de los trabajos. La fecha de fin es la de la OS (se emite cuando ya se sabe cuándo trabajaron):
--   el inicio no puede ser posterior. Si al facturar llega el otro comprobante, el contrato se regenera:
--   el firmado deja de servir (se quita de la orden; el archivo queda) y hay que enviarlo de nuevo.
-- * Retención de 4ta categoría (Ley del Impuesto a la Renta, art. 71; 8 %): solo en recibos por
--   honorarios de más de S/ 1,500. Cada proveedor tiene su %, 8 por defecto. No se retiene si el proveedor
--   tiene suspensión de retenciones vigente (Formulario 1609): vale desde que SUNAT la otorga hasta el 31 de
--   diciembre de ese año. Solo se registra con la constancia subida.
-- * Firma del gerente y DNI: datos privados del perfil, solo los usa el servidor (sin acceso por la API).

alter table public.ordenes_compra
  add column if not exists comprobante_tipo public.tipo_comprobante,
  add column if not exists fecha_inicio date;
alter table public.ordenes_compra drop constraint if exists ordenes_compra_fecha_inicio_chk;
alter table public.ordenes_compra add constraint ordenes_compra_fecha_inicio_chk
  check (fecha_inicio is null or fecha_inicio <= fecha);
alter table public.ordenes_compra drop constraint if exists ordenes_compra_comprobante_tipo_chk;
alter table public.ordenes_compra add constraint ordenes_compra_comprobante_tipo_chk
  check (comprobante_tipo is null or (tipo = 'OS' and comprobante_tipo in ('FACTURA', 'RXH')));

alter table public.proveedores
  add column if not exists retencion_4ta_pct numeric(5, 2) not null default 8,
  add column if not exists suspension_4ta_fecha date,
  add column if not exists suspension_4ta_path text;
alter table public.proveedores drop constraint if exists proveedores_retencion_4ta_chk;
alter table public.proveedores add constraint proveedores_retencion_4ta_chk
  check (retencion_4ta_pct >= 0 and retencion_4ta_pct < 100);
alter table public.proveedores drop constraint if exists proveedores_suspension_4ta_chk;
alter table public.proveedores add constraint proveedores_suspension_4ta_chk
  check ((suspension_4ta_fecha is null) = (nullif(btrim(suspension_4ta_path), '') is null));

create table if not exists public.perfil_privado (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  dni        text check (dni ~ '^\d{8}$'),
  firma_path text,
  firma_at   timestamptz
);
alter table public.perfil_privado enable row level security;
revoke all on public.perfil_privado from anon, authenticated;
-- Con RLS y sin políticas: por la API no se ve ninguna fila (solo el servidor, con la clave secreta).
grant select on public.perfil_privado to authenticated;
grant all on public.perfil_privado to service_role;

-- Comprobante y fecha de inicio de una OS (al crearla, o el comprobante al facturar).
create or replace function public.set_datos_os(p_obra_id bigint, p_numero text, p_comprobante public.tipo_comprobante, p_fecha_inicio date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
begin
  perform exigir_rol('LOGISTICA');
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe', p_numero;
  end if;
  if v_o.tipo <> 'OS' then
    raise exception 'Solo las OS llevan contrato';
  end if;
  if v_o.estado not in ('EMITIDA', 'PRECIOS_CONFIRMADOS', 'FACTURADA') then
    raise exception 'La OS % ya no se puede cambiar (estado %)', p_numero, v_o.estado;
  end if;
  if p_comprobante is not null and p_comprobante not in ('FACTURA', 'RXH') then
    raise exception 'El comprobante de una OS es factura o recibo por honorarios';
  end if;
  if p_fecha_inicio is not null and p_fecha_inicio > v_o.fecha then
    raise exception 'La fecha de inicio no puede ser posterior a la fecha de fin (%)', to_char(v_o.fecha, 'DD/MM/YYYY');
  end if;
  -- Otro comprobante, otro contrato: el firmado deja de servir y hay que enviar el nuevo.
  if p_comprobante is not null and v_o.comprobante_tipo is not null and p_comprobante <> v_o.comprobante_tipo then
    delete from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero;
    update ordenes_compra set contrato_enviado_at = null where obra_id = p_obra_id and numero = p_numero;
  end if;
  update ordenes_compra
     set comprobante_tipo = coalesce(p_comprobante, comprobante_tipo),
         fecha_inicio = coalesce(p_fecha_inicio, fecha_inicio)
   where obra_id = p_obra_id and numero = p_numero;
end;
$$;
revoke all on function public.set_datos_os(bigint, text, public.tipo_comprobante, date) from public, anon;
grant execute on function public.set_datos_os(bigint, text, public.tipo_comprobante, date) to authenticated;

-- Firmas (documentos/firmas/…): solo el servidor (clave secreta) las lee; van incrustadas en el contrato.
drop policy if exists archivos_por_rol on storage.objects;
create policy archivos_por_rol on storage.objects as restrictive for select to authenticated
  using (
    case
      when bucket_id = 'comprobantes'
        then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA'))
      when bucket_id = 'documentos' and (name like 'pagos/%' or name like 'demo/%')
        then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA'))
      when bucket_id = 'documentos' and name like 'solicitudes/%'
        then (select public.rol_en('GERENCIA', 'OPERACIONES', 'JEFE_OPERACIONES'))
      when bucket_id = 'documentos' and name like 'firmas/%'
        then false
      else true
    end
  );
