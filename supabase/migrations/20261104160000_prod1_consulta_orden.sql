-- Prod 1: la consulta de una orden (Gerencia, solo lectura) muestra lo mismo que ve
-- Tesorería al pagarla: la guía de remisión, la factura con su archivo, los pagos con su voucher y los rechazos.
-- Se amplía a Gerencia la lectura de esas tablas y archivos. Escribir sigue igual (por RPC, con su rol).
-- Las cuentas bancarias de proveedores no cambian (Operaciones no las ve).

drop policy if exists lectura_por_rol on public.pagos;
create policy lectura_por_rol on public.pagos as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA')));

drop policy if exists lectura_por_rol on public.rechazos;
create policy lectura_por_rol on public.rechazos as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA')));

drop policy if exists lectura_por_rol on public.guias;
create policy lectura_por_rol on public.guias as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA')));

-- Archivos: facturas (bucket comprobantes) y vouchers (pagos/, demo/).
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
      else true
    end
  );
