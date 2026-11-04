-- Operaciones en dos niveles y tres presupuestos (29/10/2026):
--   * Gerencia carga y publica el presupuesto; Operaciones lo sigue (sin editarlo).
--   * Adicionales de materiales: el Ingeniero (OPERACIONES) los pide, el Jefe los revisa y Gerencia
--     los aprueba. Los de mano de obra y subcontratos los hace Gerencia en el presupuesto.
--   * Bajas de partida: las pide el Jefe de Operaciones. Él asigna a los residentes.
--   * El rol OBRAS deja de usarse; el cargo OBRAS de las personas pasa a OTRO.
--   * v_seguimiento_partida: en qué etapa está lo presupuestado (Logística, Tesorería, Residente).

-- ============================================================ personas
update public.personas set cargo = 'OTRO' where cargo = 'OBRAS';
alter table public.personas drop constraint if exists personas_cargo_check;
alter table public.personas add constraint personas_cargo_check check (cargo in ('RESIDENTE', 'OTRO'));

-- ============================================================ solicitudes: revisión del Jefe
alter table public.solicitudes drop constraint if exists solicitudes_estado_check;
alter table public.solicitudes add constraint solicitudes_estado_check
  check (estado in ('POR_JEFE', 'PENDIENTE', 'APROBADA', 'RECHAZADA'));
alter table public.solicitudes
  add column revisado_by uuid references auth.users (id),
  add column revisado_at timestamptz,
  add column revision text;

CREATE OR REPLACE FUNCTION public.guardar_obra(p_id bigint, p_nombre text, p_empresa_id bigint, p_direccion text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id bigint;
begin
  if rol_actual() not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia crea y edita obras';
  end if;
  if nullif(btrim(p_nombre), '') is null then
    raise exception 'Ingresa el nombre de la obra';
  end if;
  if p_id is null then
    insert into obras (nombre, empresa_id, direccion, presupuesto_estado)
    values (upper(btrim(p_nombre)), p_empresa_id, nullif(btrim(p_direccion), ''), 'BORRADOR')
    returning id into v_id;
  else
    update obras set nombre = upper(btrim(p_nombre)), empresa_id = p_empresa_id, direccion = nullif(btrim(p_direccion), '')
     where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'La obra no existe';
    end if;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'Ya existe una obra con ese nombre';
end;
$function$;

CREATE OR REPLACE FUNCTION public.guardar_partidas(p_obra_id bigint, p_partidas jsonb, p_eliminar bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rol text := rol_actual();
  v_estado text;
  r record;
  v_comprado numeric;
  v_n integer := 0;
begin
  select presupuesto_estado into v_estado from obras where id = p_obra_id for update;
  if not found then
    raise exception 'La obra no existe';
  end if;
  if v_rol not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia carga y modifica el presupuesto';
  end if;

  -- Bajas: solo partidas sin órdenes.
  if p_eliminar is not null and cardinality(p_eliminar) > 0 then
    if exists (select 1 from oc_items where partida_id = any (p_eliminar)) then
      raise exception 'No se puede quitar una partida que ya tiene órdenes';
    end if;
    delete from partidas where obra_id = p_obra_id and id = any (p_eliminar);
    get diagnostics v_n = row_count;
  end if;

  for r in select * from jsonb_to_recordset(coalesce(p_partidas, '[]'::jsonb))
                        x(id bigint, etapa text, requerimiento text, item_id bigint, cantidad numeric, pu numeric) loop
    if r.etapa is null or r.item_id is null or r.cantidad is null or r.cantidad < 0 or (r.pu is not null and r.pu < 0) then
      raise exception 'Cada partida necesita etapa, ítem, cantidad y P.U. válidos';
    end if;
    if r.id is null then
      insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu)
      values (p_obra_id, r.etapa, coalesce(r.requerimiento, 'REGULAR'), r.item_id, r.cantidad, r.pu);
    else
      select coalesce(sum(l.cantidad), 0) into v_comprado
        from v_oc_items_calc l where l.partida_id = r.id and l.estado <> 'ANULADA';
      if r.cantidad < v_comprado - 0.0001 then
        raise exception 'La cantidad de una partida no puede quedar debajo de lo ya comprado (%)', v_comprado;
      end if;
      update partidas set etapa = r.etapa, requerimiento = coalesce(r.requerimiento, 'REGULAR'), item_id = r.item_id,
                          cantidad = r.cantidad, pu = r.pu
       where id = r.id and obra_id = p_obra_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publicar_presupuesto(p_obra_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if rol_actual() not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia publica el presupuesto';
  end if;
  if not exists (select 1 from partidas where obra_id = p_obra_id) then
    raise exception 'El presupuesto no tiene partidas';
  end if;
  update obras set presupuesto_estado = 'PUBLICADO', presupuesto_publicado_at = now()
   where id = p_obra_id and presupuesto_estado = 'BORRADOR';
  if not found then
    raise exception 'El presupuesto ya está publicado';
  end if;
  perform notificar(r, 'PRESUPUESTO', format('Presupuesto publicado: %s', (select nombre from obras where id = p_obra_id)), null,
                    format('/operaciones?obra=%s', p_obra_id))
     from unnest(array['OPERACIONES', 'JEFE_OPERACIONES']) r;
end;
$function$;

CREATE OR REPLACE FUNCTION public.asignar_persona_obra(p_obra_id bigint, p_persona_id bigint, p_asignar boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p personas%rowtype;
begin
  if rol_actual() not in ('JEFE_OPERACIONES', 'GERENCIA', 'ADMIN') then
    raise exception 'Solo Operaciones asigna personas a las obras';
  end if;
  select * into v_p from personas where id = p_persona_id;
  if not found then
    raise exception 'La persona no existe';
  end if;
  if v_p.user_id is null then
    raise exception 'La persona no tiene usuario de acceso';
  end if;
  if p_asignar then
    if v_p.estado <> 'ACTIVA' then
      raise exception 'Solo se asignan personas aprobadas por Gerencia';
    end if;
    insert into perfil_obras (user_id, obra_id) values (v_p.user_id, p_obra_id) on conflict do nothing;
  else
    delete from perfil_obras where user_id = v_p.user_id and obra_id = p_obra_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_adicional(p_obra_id bigint, p_datos jsonb, p_motivo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id bigint;
  -- El Ingeniero pasa por el Jefe de Operaciones; lo que pide el Jefe va directo a Gerencia.
  v_ing boolean := rol_actual() = 'OPERACIONES';
begin
  if rol_actual() not in ('OPERACIONES', 'JEFE_OPERACIONES', 'ADMIN') then
    raise exception 'Solo Operaciones pide adicionales';
  end if;
  -- Los adicionales de mano de obra y subcontratos los hace Gerencia en el presupuesto.
  if coalesce((select rubro::text from items where id = (p_datos->>'item_id')::bigint), '') <> 'MATERIAL' then
    raise exception 'Solo se piden adicionales de materiales: los de mano de obra y subcontratos los hace Gerencia';
  end if;
  if (p_datos->>'item_id') is null or (p_datos->>'etapa') is null or coalesce((p_datos->>'cantidad')::numeric, 0) <= 0 then
    raise exception 'Indica el ítem, la etapa y la cantidad';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo';
  end if;
  insert into solicitudes (tipo, obra_id, datos, motivo, estado)
  values ('ADICIONAL', p_obra_id, p_datos, btrim(p_motivo), case when v_ing then 'POR_JEFE' else 'PENDIENTE' end)
  returning id into v_id;
  if v_ing then
    perform notificar('JEFE_OPERACIONES', 'SOLICITUD', 'Adicional por revisar',
                      (select nombre from obras where id = p_obra_id), '/operaciones/solicitudes?tab=revisar');
  else
    perform notificar('GERENCIA', 'SOLICITUD', 'Solicitud de adicional',
                      (select nombre from obras where id = p_obra_id), '/gerencia/solicitudes');
  end if;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.solicitar_baja_partida(p_partida_id bigint, p_motivo text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_obra bigint;
  v_id bigint;
begin
  select obra_id into v_obra from partidas where id = p_partida_id;
  if v_obra is null then
    raise exception 'La partida no existe';
  end if;
  if rol_actual() not in ('JEFE_OPERACIONES', 'ADMIN') then
    raise exception 'Solo el Jefe de Operaciones pide bajas de partidas';
  end if;
  -- Con órdenes se puede pedir la baja (al aprobarla se anulan); con compras pagadas, no.
  if exists (select 1 from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
              where l.partida_id = p_partida_id and o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA')) then
    raise exception 'La partida ya tiene compras pagadas: no se puede dar de baja';
  end if;
  if exists (select 1 from solicitudes where partida_id = p_partida_id and estado in ('PENDIENTE', 'POR_JEFE')) then
    raise exception 'Ya hay una solicitud pendiente para esta partida';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo';
  end if;
  -- Se guarda cómo era la partida: al aprobarse la baja ya no existe.
  insert into solicitudes (tipo, obra_id, partida_id, datos, motivo)
  select 'BAJA_PARTIDA', v_obra, p_partida_id,
         jsonb_build_object('descripcion', i.descripcion, 'unidad', i.unidad, 'etapa', p.etapa, 'cantidad', p.cantidad),
         btrim(p_motivo)
    from partidas p join items i on i.id = p.item_id where p.id = p_partida_id
  returning id into v_id;
  perform notificar('GERENCIA', 'SOLICITUD', 'Solicitud de baja de partida',
                    (select nombre from obras where id = v_obra), '/gerencia/solicitudes');
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolver_solicitud(p_id bigint, p_aprobar boolean, p_respuesta text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s solicitudes%rowtype;
  r record;
  v_titulo text;
begin
  if rol_actual() not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia resuelve solicitudes';
  end if;
  select * into s from solicitudes where id = p_id for update;
  if not found or s.estado <> 'PENDIENTE' then
    raise exception 'La solicitud ya fue resuelta';
  end if;

  if p_aprobar then
    if s.tipo = 'ADICIONAL' then
      insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu)
      values (s.obra_id, s.datos->>'etapa', coalesce(s.datos->>'requerimiento', 'REGULAR'), (s.datos->>'item_id')::bigint,
              (s.datos->>'cantidad')::numeric, nullif(s.datos->>'pu', '')::numeric);
    elsif s.tipo = 'BAJA_PARTIDA' then
      -- Las órdenes de la partida se anulan; si alguna ya se pagó o tiene comprobante, no se puede.
      for r in select distinct o.obra_id, o.numero, o.estado,
                      exists (select 1 from oc_items x where x.obra_id = o.obra_id and x.numero_oc = o.numero and x.comprobante_id is not null) as con_comprobante,
                      exists (select 1 from pago_aplicaciones ap where ap.obra_id = o.obra_id and ap.numero_oc = o.numero) as con_pago
                 from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
                where l.partida_id = s.partida_id and o.estado <> 'ANULADA' loop
        if r.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA') or r.con_pago then
          raise exception 'La orden % ya está pagada: la partida no se puede dar de baja', r.numero;
        end if;
        if r.con_comprobante then
          raise exception 'La orden % tiene comprobante registrado: Logística debe anularlo antes de dar de baja la partida', r.numero;
        end if;
        perform anular_orden(r.obra_id, r.numero, 'Baja de partida aprobada por Gerencia');
      end loop;
      -- Si tuvo órdenes (ahora anuladas) la partida queda de baja; si no, se borra.
      if exists (select 1 from oc_items where partida_id = s.partida_id) then
        update partidas set dada_de_baja_at = now() where id = s.partida_id;
      else
        delete from partidas where id = s.partida_id;
      end if;
    elsif s.tipo = 'PERSONA_ALTA' then
      update personas set estado = 'ACTIVA' where id = s.persona_id;
    elsif s.tipo = 'PERSONA_CAMBIO' then
      update personas
         set nombre = coalesce(upper(nullif(btrim(s.datos->>'nombre'), '')), nombre),
             cargo = coalesce(s.datos->>'cargo', cargo),
             telefono = case when s.datos ? 'telefono' then nullif(btrim(s.datos->>'telefono'), '') else telefono end,
             correo = case when s.datos ? 'correo' then nullif(lower(btrim(s.datos->>'correo')), '') else correo end
       where id = s.persona_id;
    elsif s.tipo = 'PERSONA_BAJA' then
      update personas set estado = 'BAJA' where id = s.persona_id;
      delete from perfil_obras where user_id = (select user_id from personas where id = s.persona_id);
    end if;
  elsif s.tipo = 'PERSONA_ALTA' then
    -- alta rechazada: la persona no llega a existir como activa
    update personas set estado = 'BAJA' where id = s.persona_id;
  end if;

  update solicitudes set estado = case when p_aprobar then 'APROBADA' else 'RECHAZADA' end,
                         respuesta = nullif(btrim(coalesce(p_respuesta, '')), ''), resuelto_by = auth.uid(), resuelto_at = now()
   where id = p_id;

  v_titulo := format('%s: %s',
    case s.tipo when 'ADICIONAL' then 'Adicional' when 'BAJA_PARTIDA' then 'Baja de partida'
                when 'PERSONA_ALTA' then 'Alta de persona' when 'PERSONA_CAMBIO' then 'Cambio de persona' else 'Baja de persona' end,
    case when p_aprobar then 'aprobada' else 'rechazada' end);
  perform notificar_usuario(s.solicitado_by, 'SOLICITUD_RESUELTA', v_titulo,
                            coalesce(nullif(btrim(coalesce(p_respuesta, '')), ''), s.datos->>'descripcion',
                                     (select descripcion from items where id = (s.datos->>'item_id')::bigint),
                                     (select nombre from personas where id = s.persona_id)),
                            case when s.tipo like 'PERSONA%' then '/rrhh' else '/operaciones/solicitudes' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cerrar_entrega(p_obra_id bigint, p_numero text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if coalesce((select rol::text from perfiles where user_id = auth.uid()), '') not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Operaciones cierra una entrega incompleta';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Indica el motivo';
  end if;
  update ordenes_compra
     set estado = 'RECIBIDA', entrega_cerrada_at = now(), entrega_cerrada_motivo = btrim(p_motivo), entrega_cerrada_by = auth.uid()
   where obra_id = p_obra_id and numero = p_numero and estado = 'EN_ENTREGA';
  if not found then
    raise exception 'La orden % no está en entrega', p_numero;
  end if;
  perform notificar('LOGISTICA', 'ENTREGA_CERRADA', format('Entrega cerrada incompleta: %s', p_numero), btrim(p_motivo),
                    format('/logistica/ordenes/%s/%s', p_obra_id, p_numero));
end;
$function$;

create or replace function public.revisar_solicitud(p_id bigint, p_aprobar boolean, p_comentario text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s solicitudes%rowtype;
  v_obra text;
begin
  if rol_actual() not in ('JEFE_OPERACIONES', 'ADMIN') then
    raise exception 'Solo el Jefe de Operaciones revisa estas solicitudes';
  end if;
  select * into s from solicitudes where id = p_id for update;
  if not found or s.estado <> 'POR_JEFE' then
    raise exception 'La solicitud ya fue revisada';
  end if;
  update solicitudes
     set estado = case when p_aprobar then 'PENDIENTE' else 'RECHAZADA' end,
         revisado_by = auth.uid(), revisado_at = now(), revision = nullif(btrim(coalesce(p_comentario, '')), ''),
         resuelto_by = case when p_aprobar then null else auth.uid() end,
         resuelto_at = case when p_aprobar then null else now() end
   where id = p_id;
  v_obra := (select nombre from obras where id = s.obra_id);
  if p_aprobar then
    perform notificar('GERENCIA', 'SOLICITUD', 'Solicitud de adicional', v_obra, '/gerencia/solicitudes');
  else
    perform notificar_usuario(s.solicitado_by, 'SOLICITUD_RESUELTA', 'Adicional: rechazado por el Jefe de Operaciones',
                              coalesce(nullif(btrim(coalesce(p_comentario, '')), ''), v_obra), '/operaciones/solicitudes');
  end if;
end;
$$;
grant execute on function public.revisar_solicitud(bigint, boolean, text) to authenticated;

-- ============================================================ seguimiento por partida
-- Lo presupuestado de cada partida repartido por etapa. Sin datos de órdenes, proveedores ni comprobantes.
create or replace view public.v_seguimiento_partida with (security_invoker = true) as
with lineas as (
  select l.partida_id, l.cantidad, o.estado, o.entrega_cerrada_at,
         coalesce((select sum(en.cantidad) from public.entregas en where en.oc_item_id = l.id), 0) as entregado
    from public.oc_items l
    join public.ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
   where o.estado not in ('ANULADA', 'BORRADOR')
),
x as (
  select partida_id,
         sum(case when estado in ('EMITIDA', 'PRECIOS_CONFIRMADOS', 'FACTURADA') then cantidad else 0 end) as en_logistica,
         sum(case when estado in ('EN_TESORERIA', 'PAGADA') then cantidad else 0 end) as en_tesoreria,
         sum(case when estado in ('EN_ENTREGA', 'RECIBIDA') and entrega_cerrada_at is null then greatest(cantidad - entregado, 0) else 0 end) as por_recibir,
         sum(entregado) as recibido
    from lineas
   group by partida_id
)
select p.id as partida_id,
       p.obra_id,
       p.etapa,
       p.requerimiento,
       p.item_id,
       i.descripcion,
       i.unidad,
       i.rubro,
       case when i.rubro = 'MATERIAL' then 'MATERIALES' when i.rubro = 'MANO OBRA' then 'MANO_OBRA' else 'SUBCONTRATOS' end as grupo,
       p.cantidad as presupuestado,
       p.pu,
       coalesce(x.en_logistica, 0) as en_logistica,
       coalesce(x.en_tesoreria, 0) as en_tesoreria,
       coalesce(x.por_recibir, 0) as por_recibir,
       coalesce(x.recibido, 0) as recibido,
       greatest(p.cantidad - coalesce(x.en_logistica, 0) - coalesce(x.en_tesoreria, 0) - coalesce(x.por_recibir, 0) - coalesce(x.recibido, 0), 0) as por_pedir
  from public.partidas p
  join public.items i on i.id = p.item_id
  left join x on x.partida_id = p.id
 where p.dada_de_baja_at is null;

grant select on public.v_seguimiento_partida to authenticated;
