-- Prod 1: retención por garantía de las OS, su devolución en una OS de retenciones por proveedor y obra, y borradores de
-- Nueva OC / OS en la cuenta. La retención por garantía es distinta de la de 4ta: se descuenta antes, en la línea. El proveedor
-- factura y cobra el neto (S/ 1,000 al 5 % son S/ 950) y la 4ta se calcula sobre ese comprobante.

-- ── Retención por garantía ──────────────────────────────────────────────────────────────────────────────────
alter table public.oc_items add column ret_garantia_pct numeric(5,2) not null default 0
  constraint oc_items_ret_garantia_chk check (ret_garantia_pct >= 0 and ret_garantia_pct < 100);
grant select (ret_garantia_pct) on public.oc_items to authenticated;

-- En qué OS de retenciones se devolvió lo retenido a esta orden. Se limpia si esa OS se anula.
alter table public.ordenes_compra add column retenida_en text;
grant select (retenida_en) on public.ordenes_compra to authenticated;

-- El P.U. sigue siendo el acordado (contra él se compara el presupuesto); `parcial` pasa a ser lo que se factura y se paga.
create or replace view public.v_oc_items_calc with (security_invoker = true) as
 SELECT l.id,
    l.obra_id,
    l.numero_oc,
    l.partida_id,
    l.cantidad,
    l.pu_cotizado,
    l.pu_aprobado,
    l.aprobado_por,
    l.comprobante_id,
    l.created_at,
    o.estado,
    o.fecha,
    o.tipo,
    o.proveedor_id,
    p.codigo AS partida_codigo,
    p.etapa,
    p.requerimiento,
    p.item_id,
    i.descripcion,
    i.unidad,
    i.rubro,
    i.cuenta_contable,
    i.tipo_material,
    t.tol AS tolerancia_pct,
    t.pu AS pu_partida,
    round(fn_pu_max(t.pu, t.tol), 4) AS pu_max,
    e.pu_efectivo,
    round(l.cantidad * e.pu_efectivo * (1 - l.ret_garantia_pct / 100), 2) AS parcial,
    COALESCE(l.pu_cotizado > fn_pu_max(t.pu, t.tol) AND l.pu_aprobado IS NULL, false) AS sobreprecio,
    l.ret_garantia_pct,
    round(l.cantidad * e.pu_efectivo, 2) - round(l.cantidad * e.pu_efectivo * (1 - l.ret_garantia_pct / 100), 2) AS retenido
   FROM oc_items l
     JOIN ordenes_compra o ON o.obra_id = l.obra_id AND o.numero = l.numero_oc
     JOIN partidas p ON p.id = l.partida_id
     JOIN items i ON i.id = p.item_id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN l.precio_fijado_at IS NOT NULL THEN l.tol_fijada
                    WHEN o.tipo = 'OS'::tipo_orden AND NOT o.historico THEN 0::numeric(6,4)
                    ELSE i.tolerancia_pct
                END AS tol,
                CASE
                    WHEN l.precio_fijado_at IS NOT NULL THEN l.pu_fijado
                    ELSE p.pu
                END AS pu) t
     CROSS JOIN LATERAL ( SELECT fn_pu_efectivo(l.pu_cotizado, l.pu_aprobado, t.pu, t.tol) AS pu_efectivo) e;

create or replace view public.v_oc_items with (security_invoker = true) as
 SELECT c.id,
    c.obra_id,
    c.numero_oc,
    c.partida_id,
    c.cantidad,
    c.pu_cotizado,
    c.pu_aprobado,
    c.aprobado_por,
    c.comprobante_id,
    c.partida_codigo,
    c.etapa,
    c.requerimiento,
    c.item_id,
    c.descripcion,
    c.unidad,
    c.rubro,
    c.pu_partida,
    c.pu_max,
    c.pu_efectivo,
    c.parcial,
        CASE
            WHEN c.sobreprecio THEN 'SOBREPRECIO'::text
            ELSE NULL::text
        END AS alerta,
    c.pu_cotizado - c.pu_partida AS dif,
    h.pu_hist,
    (cp.serie || '-'::text) || cp.numero AS comprobante,
    c.estado,
    c.fecha,
    c.cuenta_contable,
    c.tipo_material,
    c.ret_garantia_pct,
    c.retenido
   FROM v_oc_items_calc c
     LEFT JOIN comprobantes cp ON cp.id = c.comprobante_id
     LEFT JOIN LATERAL ( SELECT hh.pu_efectivo AS pu_hist
           FROM v_oc_items_calc hh
          WHERE hh.item_id = c.item_id AND hh.estado <> 'ANULADA'::estado_oc AND hh.pu_efectivo IS NOT NULL AND (hh.obra_id IS DISTINCT FROM c.obra_id OR hh.numero_oc IS DISTINCT FROM c.numero_oc)
          ORDER BY hh.fecha DESC, hh.id DESC
         LIMIT 1) h ON true;

-- Lo retenido, por orden. Lo leen Logística, Tesorería, Gerencia y el servidor (el contrato del link del proveedor).
create view public.v_os_retenidas with (security_invoker = true) as
select o.obra_id, ob.nombre as obra, ob.estado as obra_estado, o.numero, o.fecha, o.estado, o.proveedor_id,
       pr.razon_social as proveedor, pr.ruc_o_cod as proveedor_ruc, o.retenida_en,
       d.estado as devolucion_estado,
       o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA') as pagada,
       sum(l.parcial) as neto,
       sum(l.retenido) as retenido
  from public.ordenes_compra o
  join public.obras ob on ob.id = o.obra_id
  join public.proveedores pr on pr.id = o.proveedor_id
  join public.v_oc_items_calc l on l.obra_id = o.obra_id and l.numero_oc = o.numero
  left join public.ordenes_compra d on d.obra_id = o.obra_id and d.numero = o.retenida_en
 where o.tipo = 'OS' and not o.es_retencion and o.estado <> 'ANULADA' and l.ret_garantia_pct > 0
   and (current_user = 'service_role' or public.rol_en('LOGISTICA', 'TESORERIA', 'GERENCIA'))
 group by o.obra_id, ob.nombre, ob.estado, o.numero, o.fecha, o.estado, o.proveedor_id, pr.razon_social, pr.ruc_o_cod, o.retenida_en, d.estado;
revoke all on public.v_os_retenidas from anon;
grant select on public.v_os_retenidas to authenticated, service_role;

-- Crear orden: cada ítem de una OS puede traer su % (lo define Logística al crearla).
do $m$
declare f text; a text; b text;
begin
  f := pg_get_functiondef('public.crear_orden'::regproc);

  a := $x$  if (select estado from obras where id = p_obra_id) = 'CERRADA' then$x$;
  b := $x$  if exists (select 1 from jsonb_to_recordset(p_items) x(ret_garantia_pct numeric)
              where x.ret_garantia_pct is not null and (x.ret_garantia_pct < 0 or x.ret_garantia_pct >= 100)) then
    raise exception 'La retención por garantía va de 0 a 99.99 %%';
  end if;
  if coalesce(p_tipo, 'OC') <> 'OS' and exists (select 1 from jsonb_to_recordset(p_items) x(ret_garantia_pct numeric) where x.ret_garantia_pct > 0) then
    raise exception 'La retención por garantía es solo de las OS';
  end if;

  if (select estado from obras where id = p_obra_id) = 'CERRADA' then$x$;
  if position(a in f) = 0 then raise exception 'crear_orden: no encontré el control de obra cerrada'; end if;
  f := replace(f, a, b);

  a := $x$  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado)
  select p_obra_id, v_numero, x.partida_id, x.cantidad, case when coalesce(p_tipo, 'OC') = 'OS' then p.pu end
    from rows from (jsonb_to_recordset(p_items) as (partida_id bigint, cantidad numeric))
         with ordinality as x(partida_id, cantidad, n)$x$;
  b := $x$  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado, ret_garantia_pct)
  select p_obra_id, v_numero, x.partida_id, x.cantidad, case when coalesce(p_tipo, 'OC') = 'OS' then p.pu end, coalesce(x.ret_garantia_pct, 0)
    from rows from (jsonb_to_recordset(p_items) as (partida_id bigint, cantidad numeric, ret_garantia_pct numeric))
         with ordinality as x(partida_id, cantidad, ret_garantia_pct, n)$x$;
  if position(a in f) = 0 then raise exception 'crear_orden: no encontré el insert de ítems'; end if;
  execute replace(f, a, b);

  -- La OS de retenciones lleva contrato, como cualquier otra.
  f := pg_get_functiondef('public.enviar_si_lista'::regproc);
  a := $x$v_o.tipo = 'OS' and not v_o.es_retencion and not v_o.historico$x$;
  if position(a in f) = 0 then raise exception 'enviar_si_lista: no encontré la excepción'; end if;
  execute replace(f, a, $x$v_o.tipo = 'OS' and not v_o.historico$x$);

  f := pg_get_functiondef('public.enviar_a_tesoreria'::regproc);
  if position(a in f) = 0 then raise exception 'enviar_a_tesoreria: no encontré la excepción'; end if;
  f := replace(f, a, $x$v_o.tipo = 'OS' and not v_o.historico$x$);
  -- Devuelve dinero, no compra al P.U. del presupuesto: no avisa diferencias de precio.
  a := $x$  if v_o.tipo = 'OS' then
    select count(*) filter (where pu_efectivo > pu_partida + 0.0001)$x$;
  if position(a in f) = 0 then raise exception 'enviar_a_tesoreria: no encontré el aviso de precios'; end if;
  execute replace(f, a, $x$  if v_o.tipo = 'OS' and not v_o.es_retencion then
    select count(*) filter (where pu_efectivo > pu_partida + 0.0001)$x$);

  f := pg_get_functiondef('public.archivo_link'::regproc);
  a := $x$v_o.tipo = 'OS' and not v_o.es_retencion and v_o.valorizacion_id is null$x$;
  if position(a in f) = 0 then raise exception 'archivo_link: no encontré la excepción'; end if;
  execute replace(f, a, $x$v_o.tipo = 'OS' and v_o.valorizacion_id is null$x$);

  -- El proveedor ve lo que se le retuvo; su contrato, también en la OS de retenciones.
  f := pg_get_functiondef('public.get_cotizacion'::regproc);
  if position(a in f) = 0 then raise exception 'get_cotizacion: no encontré la excepción'; end if;
  f := replace(f, a, $x$v_o.tipo = 'OS' and v_o.valorizacion_id is null$x$);
  a := $x$'cantidad', l.cantidad,$x$;
  if position(a in f) = 0 then raise exception 'get_cotizacion: no encontré la cantidad'; end if;
  f := replace(f, a, $x$'cantidad', l.cantidad,
                      'ret_garantia_pct', l.ret_garantia_pct,$x$);
  execute f;

  -- Al cerrar la obra, Logística recibe lo retenido por devolver (antes, las valorizaciones del MVP).
  f := pg_get_functiondef('public.cerrar_obra'::regproc);
  a := $x$select coalesce\(sum\(vp\.retencion\), 0\) into v_retencion\s+from valorizaciones v join valorizacion_partidas vp on vp\.valorizacion_id = v\.id where v\.obra_id = p_obra_id;$x$;
  if f !~ a then raise exception 'cerrar_obra: no encontré la suma'; end if;
  f := regexp_replace(f, a, $x$select coalesce(sum(l.retenido), 0) into v_retencion
    from v_oc_items_calc l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
   where l.obra_id = p_obra_id and o.retenida_en is null and not o.es_retencion and o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA');$x$);
  a := $x$'/logistica/requerimientos');$x$;
  if position(a in f) = 0 then raise exception 'cerrar_obra: no encontré el link'; end if;
  execute replace(f, a, $x$format('/logistica/retenciones?obra=%s', p_obra_id));$x$);
end;
$m$;

-- OS de retenciones: lo retenido a un proveedor en las OS ya pagadas de una obra cerrada, en un recibo por honorarios.
-- Una línea por partida con cantidad 1 y el monto como precio aprobado: así el total es lo retenido, al céntimo.
create or replace function public.crear_orden_retencion(p_obra_id bigint, p_numero text, p_proveedor_id bigint)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_numero text;
  v_obra text;
  v_estado text;
  v_inicio date;
  v_ordenes text[];
begin
  perform exigir_rol('LOGISTICA');
  select nombre, estado into v_obra, v_estado from obras where id = p_obra_id for update;
  if not found then
    raise exception 'La obra no existe';
  end if;
  if v_estado <> 'CERRADA' then
    raise exception 'Las retenciones se devuelven con la obra cerrada';
  end if;
  -- Bloqueadas: dos a la vez no devuelven lo mismo.
  perform 1 from ordenes_compra o
    where o.obra_id = p_obra_id and o.proveedor_id = p_proveedor_id and o.tipo = 'OS' and not o.es_retencion
      and o.retenida_en is null and o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA')
    order by o.numero for update;

  select array_agg(distinct l.numero_oc), min(coalesce(o.fecha_inicio, o.fecha)) into v_ordenes, v_inicio
    from v_oc_items_calc l join ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
   where l.obra_id = p_obra_id and o.proveedor_id = p_proveedor_id and o.tipo = 'OS' and not o.es_retencion
     and o.retenida_en is null and o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA') and l.retenido > 0;
  if v_ordenes is null then
    raise exception 'Este proveedor no tiene retención por devolver en la obra';
  end if;

  v_numero := coalesce(nullif(btrim(p_numero), ''), siguiente_numero_oc(p_obra_id));
  if exists (select 1 from ordenes_compra where obra_id = p_obra_id and numero = v_numero) then
    raise exception 'Ya existe la orden % en esta obra', v_numero;
  end if;
  -- No se cotiza: el link del proveedor vale desde ya, para ver su orden y su contrato.
  insert into ordenes_compra (obra_id, numero, tipo, proveedor_id, fecha, estado, es_retencion, glosa_rhe, comprobante_tipo, fecha_inicio,
                              cotizacion_estado, cotizacion_enviada_at, cotizacion_recibida_at)
  values (p_obra_id, v_numero, 'OS', p_proveedor_id, current_date, 'EMITIDA', true, format('Retenciones de la obra %s', v_obra), 'RXH', v_inicio,
          'RECIBIDA', now(), now());
  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado, pu_aprobado, aprobado_por)
  select p_obra_id, v_numero, l.partida_id, 1, sum(l.retenido), sum(l.retenido), auth.uid()
    from v_oc_items_calc l
   where l.obra_id = p_obra_id and l.numero_oc = any (v_ordenes) and l.retenido > 0
   group by l.partida_id order by l.partida_id;
  update ordenes_compra set retenida_en = v_numero where obra_id = p_obra_id and numero = any (v_ordenes);
  perform confirmar_precios(p_obra_id, v_numero);
  return v_numero;
end;
$$;
revoke all on function public.crear_orden_retencion(bigint, text, bigint) from public, anon;
grant execute on function public.crear_orden_retencion(bigint, text, bigint) to authenticated;

-- Si la OS de retenciones se anula, lo retenido vuelve a estar por devolver.
create or replace function public.fn_soltar_retenidas() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update ordenes_compra set retenida_en = null where obra_id = new.obra_id and retenida_en = new.numero;
  return null;
end;
$$;
revoke all on function public.fn_soltar_retenidas() from public, anon, authenticated;
create trigger orden_soltar_retenidas after update of estado on public.ordenes_compra
  for each row when (new.estado = 'ANULADA' and old.estado <> 'ANULADA' and new.es_retencion)
  execute function public.fn_soltar_retenidas();

-- ── Borradores de Nueva OC / OS, en la cuenta ───────────────────────────────────────────────────────────────
-- Cada uno ve los suyos, desde cualquier dispositivo. Todavía no son órdenes: no tienen N° ni cuentan contra el saldo.
create table public.orden_borradores (
  id bigint generated by default as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo public.tipo_orden not null,
  obra_id bigint not null references public.obras (id),
  datos jsonb not null constraint orden_borradores_datos_chk check (octet_length(datos::text) < 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orden_borradores_user_idx on public.orden_borradores (user_id, tipo, updated_at desc);
alter table public.orden_borradores enable row level security;
create policy orden_borradores_propios on public.orden_borradores for all to authenticated
  using (user_id = (select auth.uid()) and (select public.rol_en('LOGISTICA')))
  with check (user_id = (select auth.uid()) and (select public.rol_en('LOGISTICA')));
revoke all on public.orden_borradores from anon;
grant select, insert, update, delete on public.orden_borradores to authenticated;
