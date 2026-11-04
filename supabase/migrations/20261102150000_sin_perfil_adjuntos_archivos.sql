-- Hallazgos de la auditoría de permisos por API (02/11/2026).
--
-- 1. Un usuario autenticado SIN fila en perfiles (p. ej. creado por signup) tenía rol NULL, y
--    `NULL not in (...)` es NULL: pasaba el control de rol de 21 funciones y leía las tablas abiertas.
--    Ahora, para una sesión de la API sin perfil, rol_actual() y mi_rol() devuelven '' (que no está en
--    ninguna lista); en psql, seeds y service_role siguen en NULL, como hasta ahora.
-- 2. Política restrictiva: sin perfil no se lee ni escribe ninguna tabla ni archivo.
-- 3. adjuntos: nadie edita ni borra por la API (la app solo inserta); el insert valida la carpeta y el rol.
-- 4. Archivos por rol, como las tablas: vouchers (pagos/, demo/) y el bucket comprobantes solo para
--    Contabilidad, Tesorería y Logística; sustentos de solicitudes para Gerencia y Operaciones.
-- 5. anon: sin privilegios sobre tablas ni vistas (solo ejecuta get_cotizacion y enviar_cotizacion).

-- 1 ---------------------------------------------------------------------------------------------------
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth.role() in ('authenticated', 'anon')
      then coalesce((select rol::text from public.perfiles where user_id = auth.uid()), '')
    else (select rol::text from public.perfiles where user_id = auth.uid())
  end
$$;

create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.rol_actual()
$$;

-- mo_partidas comprobaba `rol_actual() is null`; sin perfil ahora es '' y RRHH no tiene por qué ver partidas.
do $$
declare
  v_def text := pg_get_functiondef('public.mo_partidas(bigint)'::regprocedure);
begin
  if position('if rol_actual() is null then' in v_def) = 0 then
    raise exception 'mo_partidas cambió: revisar el control de sesión';
  end if;
  execute replace(v_def, 'if rol_actual() is null then', 'if coalesce(rol_actual(), '''') in ('''', ''RRHH'') then');
end $$;

-- 2 ---------------------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format(
      'create policy con_perfil on public.%I as restrictive for all to authenticated '
      'using ((select public.rol_actual()) <> '''') with check ((select public.rol_actual()) <> '''')', t);
  end loop;
end $$;

create policy con_perfil on storage.objects as restrictive for all to authenticated
  using (bucket_id not in ('documentos', 'comprobantes') or (select public.rol_actual()) <> '')
  with check (bucket_id not in ('documentos', 'comprobantes') or (select public.rol_actual()) <> '');

-- 3 ---------------------------------------------------------------------------------------------------
drop policy adjuntos_update on public.adjuntos;
drop policy adjuntos_delete on public.adjuntos;
drop policy adjuntos_insert on public.adjuntos;
-- Los vouchers los registra pagar_documento. El archivo tiene que estar en la carpeta de su orden
-- ({obra}/{numero}/…): así nadie enlaza un archivo ajeno para poder leerlo.
create policy adjuntos_insert on public.adjuntos for insert to authenticated
  with check (
    tipo <> 'VOUCHER'
    and split_part(path, '/', 1) = obra_id::text
    and split_part(path, '/', 2) = numero_oc
    and case
      when tipo = 'GUIA' then (select public.rol_en('CONTABILIDAD'))
      when (select public.es_residente()) then tipo = 'FOTO' and obra_id in (select public.obras_residente())
      else (select public.rol_en('LOGISTICA'))
    end
  );

-- 4 ---------------------------------------------------------------------------------------------------
create policy archivos_por_rol on storage.objects as restrictive for select to authenticated
  using (
    case
      when bucket_id = 'comprobantes' then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA'))
      when bucket_id = 'documentos' and (name like 'pagos/%' or name like 'demo/%')
        then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA'))
      when bucket_id = 'documentos' and name like 'solicitudes/%'
        then (select public.rol_en('GERENCIA', 'OPERACIONES', 'JEFE_OPERACIONES'))
      else true
    end
  );

-- 5 ---------------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
