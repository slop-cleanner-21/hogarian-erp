-- Auditoría de seguridad (05/11/2026). Propio de prod 1: no va al MVP.

-- ── 1. Solo los roles de prod 1 existen para la base ──
-- Contabilidad, Residente, Ing. de Operaciones y RRHH no entran a prod 1 (la app los manda a «Sin acceso»), pero la
-- RLS y los RPC del MVP les seguían dando datos por la API. rol_actual() y rol_en() son la base de exigir_rol, de
-- las políticas restrictivas «con_perfil» y de las de lectura por rol: para esos roles quedan como sin perfil.

create or replace function public.rol_prod1(p_rol text) returns boolean
  language sql immutable set search_path = public, pg_temp
as $$ select p_rol in ('LOGISTICA', 'TESORERIA', 'GERENCIA', 'JEFE_OPERACIONES', 'ADMIN') $$;
revoke execute on function public.rol_prod1(text) from public, anon;
grant execute on function public.rol_prod1(text) to authenticated;

create or replace function public.rol_actual()
  returns text language sql stable security definer set search_path = public
as $$
  select case
    when auth.role() in ('authenticated', 'anon')
      then coalesce((select p.rol::text from public.perfiles p join auth.users u on u.id = p.user_id
                      where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
                        and public.rol_prod1(p.rol::text)), '')
    else (select rol::text from public.perfiles where user_id = auth.uid())
  end
$$;

create or replace function public.rol_en(variadic p_roles text[])
  returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.rol::text = 'ADMIN' or p.rol::text = any (p_roles)
       from public.perfiles p join auth.users u on u.id = p.user_id
      where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
        and public.rol_prod1(p.rol::text)),
    false)
$$;

-- El Jefe de Operaciones solo consulta el seguimiento: ninguna función que escriba (las del MVP lo dejaban
-- ordenar etapas, valorizar o pedir adicionales).
create or replace function public.exigir_rol(variadic p_roles text[])
  returns void language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return;
  end if;
  if coalesce(rol_actual(), '') = 'JEFE_OPERACIONES' or coalesce(rol_actual(), '') <> all (p_roles || 'ADMIN'::text) then
    raise exception 'No tienes permiso para esta acción';
  end if;
end;
$$;

-- registrar_entrega leía el rol directo de perfiles (sin el baneo ni prod 1).
do $$
declare
  f text := pg_get_functiondef('public.registrar_entrega'::regproc);
  a text := '(select rol::text from perfiles where user_id = auth.uid())';
begin
  if position(a in f) = 0 then raise exception 'registrar_entrega: no se encontró la lectura del rol'; end if;
  execute replace(f, a, 'nullif(rol_actual(), '''')');
end $$;

-- ── 2. El token del link de cotización: solo Logística ──
-- Cualquier rol leía token_cotizacion (ordenes_compra, v_ordenes, v_por_pagar) y podía cotizar como el proveedor.
-- Se quita la columna de la lectura directa; las vistas la dan solo a Logística (y Admin).

create or replace function public.token_cotizacion_de(p_obra bigint, p_numero text)
  returns uuid language sql stable security definer set search_path = public, pg_temp
as $$
  select case when public.rol_en('LOGISTICA')
    then (select token_cotizacion from public.ordenes_compra where obra_id = p_obra and numero = p_numero) end
$$;
revoke execute on function public.token_cotizacion_de(bigint, text) from public, anon;
grant execute on function public.token_cotizacion_de(bigint, text) to authenticated;

do $$
declare
  v text;
  def text;
  cols text;
begin
  foreach v in array array['v_ordenes', 'v_por_pagar'] loop
    def := pg_get_viewdef(format('public.%I', v)::regclass);
    if position('o.token_cotizacion,' in def) = 0 then raise exception '%: no se encontró token_cotizacion', v; end if;
    def := replace(def, 'o.token_cotizacion,', 'public.token_cotizacion_de(o.obra_id, o.numero) AS token_cotizacion,');
    execute format('create or replace view public.%I with (security_invoker = true) as %s', v, def);
  end loop;

  -- Lectura por columnas: todas menos el token. (Una columna nueva de ordenes_compra necesita su grant.)
  revoke select on public.ordenes_compra from anon, authenticated;
  select string_agg(quote_ident(attname), ', ' order by attnum) into cols
    from pg_attribute
   where attrelid = 'public.ordenes_compra'::regclass and attnum > 0 and not attisdropped and attname <> 'token_cotizacion';
  execute format('grant select (%s) on public.ordenes_compra to authenticated', cols);
end $$;

-- enviar_cotizacion aceptaba precio 0 (la app pide positivo).
do $$
declare
  f text := pg_get_functiondef('public.enviar_cotizacion'::regproc);
begin
  if position('r.pu is null or r.pu < 0' in f) = 0 then raise exception 'enviar_cotizacion: no se encontró la validación del precio'; end if;
  execute replace(f, 'r.pu is null or r.pu < 0', 'r.pu is null or r.pu <= 0');
end $$;

-- ── 3. Límite de intentos del link: por token ──
-- Los fallos globales (tokens que no existen) bloqueaban también los links válidos: 60 tokens falsos por minuto
-- dejaban a todos los proveedores sin cotizar. Un token real solo cuenta los suyos.
create or replace function public.fn_cotizacion_limite(p_token uuid)
  returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from ordenes_compra where token_cotizacion = p_token) then
    if (select count(*) from cotizacion_accesos where token = p_token and created_at > now() - interval '10 minutes') >= 120 then
      raise exception 'Demasiados intentos. Vuelve a intentarlo en unos minutos.' using errcode = 'P0429';
    end if;
    return;
  end if;
  if (select count(*) from cotizacion_accesos where not ok and created_at > now() - interval '1 minute') >= 60 then
    raise exception 'Demasiados intentos. Vuelve a intentarlo en unos minutos.' using errcode = 'P0429';
  end if;
end;
$$;

-- ── 4. Ítems: Logística solo clasifica ──
-- Podía cambiar cualquier columna, incluida la tolerancia de sobreprecio que revisa confirmar_precios.
revoke update on public.items from anon, authenticated;
grant update (tipo_material) on public.items to authenticated;

-- ── 5. Archivos ──
-- Nadie sube a firmas/ con su sesión (la firma la guarda el servidor).
create policy sin_subir_firmas on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'documentos' or name not like 'firmas/%');

-- El Jefe de Operaciones solo ve las fotos de las entregas y no sube nada.
create policy jefe_solo_entregas on storage.objects as restrictive for select to authenticated
  using (
    bucket_id not in ('documentos', 'comprobantes')
    or (select rol_actual()) is distinct from 'JEFE_OPERACIONES'
    or (bucket_id = 'documentos' and (name like 'entregas/%' or name like 'demo/%'))
  );
create policy jefe_sin_subir on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('documentos', 'comprobantes') or (select rol_actual()) is distinct from 'JEFE_OPERACIONES');

-- ── 6. Funciones del MVP que miran el rol por su cuenta ──
-- No pasan por exigir_rol (comparan rol_actual() o leen perfiles): el Jefe de Operaciones y los roles fuera de
-- prod 1 las seguían usando (valorizar, ordenar etapas, pedir adicionales, gestionar personas…). Una guarda al
-- empezar: solo con un rol de prod 1 que no sea el Jefe.
do $$
declare
  fn text;
  f text;
  g text;
begin
  foreach fn in array array[
    'actualizar_contacto_persona', 'adjuntar_solicitud', 'anular_requerimiento', 'asignar_persona_obra',
    'crear_requerimiento', 'observar_avance', 'ordenar_etapas_obra', 'reemplazar_residente', 'registrar_avance',
    'revisar_solicitud', 'solicitar_adicional', 'solicitar_baja_partida', 'solicitar_persona', 'valorizar'
  ] loop
    f := pg_get_functiondef(format('public.%I', fn)::regproc);
    -- (Las funciones pueden tener fin de línea \r\n: migraciones escritas en Windows.)
    g := regexp_replace(f, E'\\nbegin[ \\t\\r]*\\n',
      E'\nbegin\n  -- prod 1: sin rol de prod 1 o Jefe de Operaciones, nada (20261105130000_prod1_seguridad)\n'
      || E'  if coalesce(auth.role(), '''') in (''authenticated'', ''anon'') and coalesce(rol_actual(), '''') in ('''', ''JEFE_OPERACIONES'') then\n'
      || E'    raise exception ''No tienes permiso para esta acción'';\n  end if;\n', 'i');
    if g = f then raise exception '%: no se encontró el begin', fn; end if;
    execute g;
  end loop;
end $$;
