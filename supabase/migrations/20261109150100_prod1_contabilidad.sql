-- Prod 1: entra Contabilidad. El Asistente tiene exactamente lo mismo que el Jefe: para la base es CONTABILIDAD
-- (rol_actual / rol_en), así hereda sus permisos; en perfiles queda su rol, para migrar al MVP.
create or replace function public.rol_prod1(p_rol text) returns boolean
  language sql immutable set search_path = public, pg_temp
as $$ select p_rol in ('LOGISTICA', 'TESORERIA', 'GERENCIA', 'JEFE_OPERACIONES', 'OPERACIONES', 'CONTABILIDAD', 'ASISTENTE_CONTABILIDAD', 'ADMIN') $$;

create or replace function public.rol_actual() returns text
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_rol text;
begin
  if auth.role() in ('authenticated', 'anon') then
    select p.rol::text into v_rol
      from public.perfiles p join auth.users u on u.id = p.user_id
     where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now()) and public.rol_prod1(p.rol::text);
    if v_rol is null or public.sesion_bloqueada() then return ''; end if;
    return case v_rol when 'OPERACIONES' then 'JEFE_OPERACIONES' when 'ASISTENTE_CONTABILIDAD' then 'CONTABILIDAD' else v_rol end;
  end if;
  select rol::text into v_rol from public.perfiles where user_id = auth.uid();
  return v_rol;
end;
$$;

create or replace function public.rol_en(variadic p_roles text[]) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_rol text;
begin
  select p.rol::text into v_rol
    from public.perfiles p join auth.users u on u.id = p.user_id
   where p.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now()) and public.rol_prod1(p.rol::text);
  if v_rol is null or public.sesion_bloqueada() then return false; end if;
  if v_rol = 'OPERACIONES' then v_rol := 'JEFE_OPERACIONES'; end if;
  if v_rol = 'ASISTENTE_CONTABILIDAD' then v_rol := 'CONTABILIDAD'; end if;
  return v_rol = 'ADMIN' or v_rol = any (p_roles);
end;
$$;

-- Los avisos de Contabilidad llegan a los dos.
create or replace function public.notificar(p_rol text, p_tipo text, p_titulo text, p_cuerpo text, p_href text) returns void
  language sql security definer set search_path = public, pg_temp
as $$
  with activos as (
    select r.user_id, r.rol::text as rol
      from perfil_roles r join auth.users u on u.id = r.user_id
     where (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null
  ), destinatarios as (
    select a.user_id, coalesce(pr.celular, true) as push
      from activos a left join aviso_preferencias pr on pr.user_id = a.user_id and pr.tipo = p_tipo
     where (a.rol = p_rol
            or (p_rol = 'JEFE_OPERACIONES' and a.rol = 'OPERACIONES')
            or (p_rol = 'CONTABILIDAD' and a.rol = 'ASISTENTE_CONTABILIDAD'))
       and coalesce(pr.avisar, true)
    union
    select a.user_id, pr.celular
      from activos a join aviso_preferencias pr on pr.user_id = a.user_id and pr.tipo = p_tipo
     where a.rol in ('ADMIN', 'GERENCIA') and a.rol <> p_rol and pr.avisar
  )
  insert into notificaciones (user_id, tipo, titulo, cuerpo, href, push)
  select user_id, p_tipo, p_titulo, nullif(btrim(coalesce(p_cuerpo, '')), ''), p_href, bool_or(push)
    from destinatarios group by user_id;
$$;

-- Expedientes ZIP de Contabilidad: pesan más de lo que una respuesta del servidor permite. Se guardan aquí y se bajan
-- con un enlace firmado de 2 minutos. Bucket privado: solo lo usa el servidor, con la clave secreta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exportes', 'exportes', false, 52428800, array['application/zip'])
on conflict (id) do nothing;

-- Prod 1: la guía de una OC anulada la marca anulada en SUNAT la propia Logística (no Contabilidad, que tampoco tiene
-- la pantalla de Guías): anular_orden ya no le avisa a Contabilidad.
do $$
declare
  v_def text := pg_get_functiondef('public.anular_orden'::regproc);
  v_nuevo text;
begin
  v_nuevo := regexp_replace(v_def,
    'if found then\s+perform notificar\(''CONTABILIDAD'', ''GUIA_ANULAR''[^;]*;\s+end if;\s*', '', 'g');
  if v_nuevo = v_def then
    raise exception 'anular_orden: no se encontró el aviso a Contabilidad';
  end if;
  execute v_nuevo;
end;
$$;

-- La OP enviada (o reenviada tras un rechazo) le avisa a Tesorería, como una OC u OS por pagar.
create or replace function public.enviar_op_a_tesoreria(p_id bigint) returns void
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_op ordenes_pago%rowtype;
begin
  perform exigir_rol('CONTABILIDAD');
  update ordenes_pago set estado = 'EN_TESORERIA' where id = p_id and estado = 'BORRADOR' returning * into v_op;
  if not found then
    raise exception 'La orden de pago no está en borrador';
  end if;
  perform notificar('TESORERIA', 'POR_PAGAR',
    format('Nueva %s por pagar · %s', v_op.numero, (select nombre from obras where id = v_op.obra_id)),
    (select razon_social from proveedores where id = v_op.proveedor_id),
    format('/tesoreria/pago/op/%s', v_op.id));
end;
$$;

-- Expediente de una compra en prod 1: comprobante, orden y voucher, más la guía si alguna OC la requiere y el contrato
-- firmado si es una OS. Ya no cuenta las fotos de entrega (las subían los residentes del MVP: casi todo quedaba en 3/4).
create or replace view public.v_expediente with (security_invoker = true) as
with ord as (
  select distinct l.comprobante_id, l.obra_id, l.numero_oc, o.tipo, o.requiere_guia
    from oc_items l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
   where l.comprobante_id is not null
), oa as (
  select d.comprobante_id,
         string_agg(distinct d.tipo::text || ' ' || d.numero_oc, ', ' order by d.tipo::text || ' ' || d.numero_oc) as ordenes,
         (array_agg(d.obra_id order by d.obra_id, d.numero_oc))[1] as obra_id,
         (array_agg(d.numero_oc order by d.obra_id, d.numero_oc))[1] as numero_oc,
         bool_or(d.tipo = 'OS') as requiere_contrato,
         bool_or(d.tipo = 'OC' and d.requiere_guia) as requiere_guia
    from ord d group by d.comprobante_id
), adj as (
  select d.comprobante_id,
         bool_or(a.tipo = 'GUIA') as guia,
         bool_or(a.tipo = 'FOTO') as fotos,
         bool_or(a.tipo = 'CONTRATO') as contrato
    from ord d join adjuntos a on a.obra_id = d.obra_id and a.numero_oc = d.numero_oc
   where a.tipo in ('GUIA', 'FOTO', 'CONTRATO')
   group by d.comprobante_id
), vou as (
  select ap.comprobante_id
    from pago_aplicaciones ap join adjuntos a on a.pago_id = ap.pago_id and a.tipo = 'VOUCHER'
   where ap.comprobante_id is not null
  union
  select d.comprobante_id
    from ord d
    join pago_aplicaciones ap on ap.obra_id = d.obra_id and ap.numero_oc = d.numero_oc
    join adjuntos a on a.pago_id = ap.pago_id and a.tipo = 'VOUCHER'
), gu as (
  select distinct d.comprobante_id
    from ord d join guias g on g.obra_id = d.obra_id and g.numero_oc = d.numero_oc and g.estado = 'EMITIDA'
), ef as (
  select distinct d.comprobante_id
    from ord d join entregas e on e.obra_id = d.obra_id and e.numero_oc = d.numero_oc join entrega_fotos f on f.entrega_id = e.id
), x as (
  select c.id as comprobante_id, c.empresa_id, c.periodo_anotacion::text as periodo, pr.razon_social as proveedor,
         c.serie, c.numero, c.tipo, oa.ordenes, oa.obra_id, oa.numero_oc,
         c.archivo_path is not null as tiene_archivo,
         oa.comprobante_id is not null as tiene_orden,
         coalesce(adj.guia, false) or gu.comprobante_id is not null as tiene_guia,
         vou.comprobante_id is not null as tiene_voucher,
         coalesce(adj.fotos, false) or ef.comprobante_id is not null as tiene_fotos,
         coalesce(oa.requiere_contrato, false) as requiere_contrato,
         coalesce(adj.contrato, false) as tiene_contrato,
         coalesce(oa.requiere_guia, false) as requiere_guia
    from comprobantes c
    join proveedores pr on pr.id = c.proveedor_id
    left join oa on oa.comprobante_id = c.id
    left join adj on adj.comprobante_id = c.id
    left join vou on vou.comprobante_id = c.id
    left join ef on ef.comprobante_id = c.id
    left join gu on gu.comprobante_id = c.id
)
select comprobante_id, empresa_id, periodo, proveedor, serie, numero, tipo, ordenes, obra_id, numero_oc,
       tiene_archivo, tiene_orden, tiene_guia, tiene_voucher, tiene_fotos, requiere_contrato, tiene_contrato,
       tiene_archivo::int + tiene_orden::int + tiene_voucher::int
         + (requiere_guia and tiene_guia)::int + (requiere_contrato and tiene_contrato)::int as docs_ok,
       3 + requiere_guia::int + requiere_contrato::int as docs_req,
       requiere_guia
  from x;

-- De una OP, Contabilidad solo cambia la cuenta contable (estado, monto y lo demás van por sus funciones), y no en una
-- anulada ni con su pago ya contabilizado (el asiento ya la usó).
revoke update on public.ordenes_pago from authenticated;
grant update (cuenta_contable) on public.ordenes_pago to authenticated;
create policy cuenta_hasta_contabilizar on public.ordenes_pago as restrictive for update to authenticated
  using (
    estado <> 'ANULADA'
    and not exists (select 1 from pago_aplicaciones a join asientos s on s.pago_id = a.pago_id and s.origen = 'PAGO'
                     where a.orden_pago_id = ordenes_pago.id)
  );
