-- Lectura por rol. Hasta ahora todo rol autenticado salvo el residente leía todas las tablas por la API
-- (p. ej. RRHH, los pagos). Se agregan políticas RESTRICTIVAS de SELECT que se suman (AND) a las que ya
-- existen, así que lo que el residente tenía cerrado sigue cerrado.
--
-- Criterio: cada rol lee lo que usa su pantalla. Las vistas son security_invoker, así que solo se cierran
-- tablas que no alimentan vistas de otros roles: comprobantes y pago_aplicaciones quedan abiertas porque
-- v_ordenes y v_oc_items (Operaciones, Gerencia, Residente) las usan para lo facturado y lo pagado.
-- ADMIN lee todo. service_role y las funciones SECURITY DEFINER no pasan por RLS.

create or replace function public.rol_en(variadic p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select coalesce(
    (select rol::text = 'ADMIN' or rol::text = any (p_roles) from public.perfiles where user_id = auth.uid()),
    false)
$$;

revoke execute on function public.rol_en(text[]) from public, anon;
grant execute on function public.rol_en(text[]) to authenticated, service_role;

-- Contabilidad
create policy lectura_por_rol on public.asiento_lineas as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD')));
create policy lectura_por_rol on public.cuentas_contables as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD')));
-- v_comprobantes (Logística, Tesorería) y v_por_pagar (Tesorería) miran si el comprobante tiene asiento.
create policy lectura_por_rol on public.asientos as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'LOGISTICA', 'TESORERIA')));

-- Pagos y lo que los rodea: Logística sube la constancia y ve el voucher; Tesorería paga; Contabilidad
-- contabiliza.
create policy lectura_por_rol on public.pagos as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA')));
create policy lectura_por_rol on public.ordenes_pago as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA')));
create policy lectura_por_rol on public.rechazos as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA')));
create policy lectura_por_rol on public.guias as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA')));
create policy lectura_por_rol on public.comprobantes_historial as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA')));

-- El acceso de los proveedores al link de cotización: solo Logística.
create policy lectura_por_rol on public.cotizacion_accesos as restrictive for select to authenticated
  using ((select public.rol_en('LOGISTICA')));

-- Personas (DNI, teléfono, correo) y solicitudes: quienes piden, revisan y aprueban.
create policy lectura_por_rol on public.personas as restrictive for select to authenticated
  using ((select public.rol_en('RRHH', 'GERENCIA', 'OPERACIONES', 'JEFE_OPERACIONES')));
create policy lectura_por_rol on public.solicitudes as restrictive for select to authenticated
  using ((select public.rol_en('RRHH', 'GERENCIA', 'OPERACIONES', 'JEFE_OPERACIONES')));
create policy lectura_por_rol on public.solicitud_adjuntos as restrictive for select to authenticated
  using ((select public.rol_en('GERENCIA', 'OPERACIONES', 'JEFE_OPERACIONES')));

-- Bitácora y registro de los datos simulados: solo ADMIN.
create policy lectura_por_rol on public.audit_log as restrictive for select to authenticated
  using ((select public.rol_en('ADMIN')));
create policy lectura_por_rol on public.datos_demo as restrictive for select to authenticated
  using ((select public.rol_en('ADMIN')));

-- RRHH solo ve personas, solicitudes, perfiles y sus avisos: se le cierra el resto de tablas que no
-- tienen ya una política por rol.
do $$
declare
  t text;
begin
  foreach t in array array[
    'adelantos', 'adjuntos', 'avance_fotos', 'avances', 'comprobantes', 'empresas', 'entrega_fotos',
    'entregas', 'etapas', 'items', 'obra_etapas', 'obras', 'oc_items', 'ordenes_compra', 'pago_aplicaciones',
    'partidas', 'perfil_obras', 'proveedor_contactos', 'proveedor_tipos_material', 'proveedores',
    'requerimientos', 'requerimientos_obra', 'requerimientos_obra_items', 'retenciones', 'tipos_material',
    'transportistas', 'valorizacion_partidas', 'valorizaciones'
  ] loop
    execute format(
      'create policy rrhh_sin_select on public.%I as restrictive for select to authenticated '
      'using ((select public.rol_actual()) is distinct from %L)', t, 'RRHH');
  end loop;
end $$;

-- Archivos: RRHH no usa ninguno (los avatares no están en storage).
create policy rrhh_sin_archivos on storage.objects as restrictive for select to authenticated
  using (bucket_id not in ('documentos', 'comprobantes') or (select public.rol_actual()) is distinct from 'RRHH');
create policy rrhh_sin_subir on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('documentos', 'comprobantes') or (select public.rol_actual()) is distinct from 'RRHH');
