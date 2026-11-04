-- ERP MVP: reglas de precio y vistas (security_invoker = true: respetan RLS del usuario).

-- Regla del Excel (GASTOEJEC.U / V):
--   pu_max      = partida.pu * (1 + item.tolerancia_pct)
--   pu_efectivo = pu_cotizado si pu_cotizado <= pu_max; si no, pu_aprobado (null -> línea no valorizada)
--   partida.pu null (sin precio presupuestado) -> no hay control de precio.
-- Funciones SQL simples sin "set search_path" para que el planner las pueda inline-ar.
create or replace function public.fn_pu_max(p_pu numeric, p_tol numeric)
returns numeric
language sql
immutable
as $$
  select p_pu * (1 + coalesce(p_tol, 0))
$$;

create or replace function public.fn_pu_efectivo(p_cotizado numeric, p_aprobado numeric, p_pu numeric, p_tol numeric)
returns numeric
language sql
immutable
as $$
  select case
           when p_cotizado is null then null
           when p_pu is null or p_cotizado <= p_pu * (1 + coalesce(p_tol, 0)) then p_cotizado
           else p_aprobado
         end
$$;

-- ------------------------------------------------------------ base interna: línea + precio efectivo
create view public.v_oc_items_calc with (security_invoker = true) as
select l.id,
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
       p.codigo        as partida_codigo,
       p.etapa,
       p.requerimiento,
       p.item_id,
       i.descripcion,
       i.unidad,
       i.rubro,
       i.cuenta_contable,
       i.tipo_material,
       i.tolerancia_pct,
       p.pu            as pu_partida,
       round(public.fn_pu_max(p.pu, i.tolerancia_pct), 4) as pu_max,
       e.pu_efectivo,
       round(l.cantidad * e.pu_efectivo, 2) as parcial,
       coalesce(l.pu_cotizado > public.fn_pu_max(p.pu, i.tolerancia_pct) and l.pu_aprobado is null, false)
                       as sobreprecio
  from public.oc_items l
  join public.ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
  join public.partidas p on p.id = l.partida_id
  join public.items i on i.id = p.item_id
  cross join lateral (
    select public.fn_pu_efectivo(l.pu_cotizado, l.pu_aprobado, p.pu, i.tolerancia_pct) as pu_efectivo
  ) e;

-- ------------------------------------------------------------ v_partidas (GASTOPROG)
create view public.v_partidas with (security_invoker = true) as
select p.id,
       p.codigo,
       p.obra_id,
       ob.nombre as obra,
       ob.empresa_id,
       p.etapa,
       p.requerimiento,
       p.item_id,
       i.descripcion,
       i.unidad,
       i.rubro,
       p.cantidad,
       p.pu,
       round(p.cantidad * p.pu, 2) as parcial,
       round(public.fn_pu_max(p.pu, i.tolerancia_pct), 4) as pu_max,
       coalesce(x.cant, 0) as cant_comprometida,
       coalesce(x.monto, 0) as monto_ejecutado,
       p.cantidad - coalesce(x.cant, 0) as saldo_cant,
       coalesce(round(p.cantidad * p.pu, 2), 0) - coalesce(x.monto, 0) as saldo_monto,
       case when p.cantidad > 0 then round(coalesce(x.cant, 0) / p.cantidad, 4) end as avance,
       i.tipo_material
  from public.partidas p
  join public.obras ob on ob.id = p.obra_id
  join public.items i on i.id = p.item_id
  left join lateral (
    select sum(c.cantidad) as cant,
           sum(coalesce(c.parcial, 0)) as monto
      from public.v_oc_items_calc c
     where c.partida_id = p.id
       and c.estado not in ('ANULADA', 'BORRADOR')
  ) x on true;

-- ------------------------------------------------------------ histórico de precios por ítem
create view public.v_precio_historico_item with (security_invoker = true) as
select c.item_id,
       (array_agg(c.pu_efectivo order by c.fecha desc, c.id desc))[1] as ultimo_pu,
       max(c.fecha) as ultima_fecha,
       round(avg(c.pu_efectivo), 4) as pu_promedio,
       min(c.pu_efectivo) as pu_min,
       max(c.pu_efectivo) as pu_max_hist,
       count(*) as n_compras
  from public.v_oc_items_calc c
 where c.estado <> 'ANULADA'
   and c.pu_efectivo is not null
 group by c.item_id;

-- ------------------------------------------------------------ comprobantes con saldo (apoyo)
create view public.v_comprobantes with (security_invoker = true) as
select c.id,
       c.empresa_id,
       e.nombre as empresa,
       e.ruc as empresa_ruc,
       c.proveedor_id,
       pr.razon_social as proveedor,
       pr.ruc_o_cod as proveedor_ruc,
       c.tipo,
       c.serie,
       c.numero,
       c.serie || '-' || c.numero as comprobante,
       c.fecha_emision,
       c.total,
       c.base,
       c.igv,
       c.retencion,
       c.total - c.retencion as neto,
       coalesce(pa.pagado, 0) as pagado,
       c.total - c.retencion - coalesce(pa.pagado, 0) as saldo,
       a.id as asiento_id,
       c.archivo_path,
       c.created_at
  from public.comprobantes c
  join public.empresas e on e.id = c.empresa_id
  join public.proveedores pr on pr.id = c.proveedor_id
  left join lateral (
    select sum(ap.monto) as pagado from public.pago_aplicaciones ap where ap.comprobante_id = c.id
  ) pa on true
  left join public.asientos a on a.comprobante_id = c.id and a.origen = 'COMPRA';

-- ------------------------------------------------------------ v_oc_items
create view public.v_oc_items with (security_invoker = true) as
select c.id,
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
       case when c.sobreprecio then 'SOBREPRECIO' end as alerta,
       c.pu_cotizado - c.pu_partida as dif,
       h.pu_hist,
       cp.serie || '-' || cp.numero as comprobante,
       c.estado,
       c.fecha,
       c.cuenta_contable,
       c.tipo_material
  from public.v_oc_items_calc c
  left join public.comprobantes cp on cp.id = c.comprobante_id
  left join lateral (
    select hh.pu_efectivo as pu_hist
      from public.v_oc_items_calc hh
     where hh.item_id = c.item_id
       and hh.estado <> 'ANULADA'
       and hh.pu_efectivo is not null
       and (hh.obra_id, hh.numero_oc) is distinct from (c.obra_id, c.numero_oc)
     order by hh.fecha desc, hh.id desc
     limit 1
  ) h on true;

-- ------------------------------------------------------------ v_ordenes
-- pagado = aplicaciones directas a la orden + parte proporcional de lo pagado en sus comprobantes
--          (parcial de la línea * min(1, pagado_comprobante / neto_comprobante))
create view public.v_ordenes with (security_invoker = true) as
select o.obra_id,
       o.numero,
       ob.nombre as obra,
       ob.empresa_id,
       e.nombre as empresa,
       e.ruc as empresa_ruc,
       o.proveedor_id,
       pr.razon_social as proveedor,
       pr.ruc_o_cod as proveedor_ruc,
       o.tipo,
       o.fecha,
       o.estado,
       o.token_cotizacion,
       coalesce(t.n_items, 0) as n_items,
       coalesce(t.total, 0) as total,
       coalesce(t.facturado, 0) as facturado,
       round(coalesce(t.pagado_cpe, 0) + coalesce(d.pagado, 0), 2) as pagado,
       coalesce(t.has_alertas, false) as has_alertas,
       o.created_at,
       o.motivo_anulacion,
       o.updated_at
  from public.ordenes_compra o
  join public.obras ob on ob.id = o.obra_id
  join public.empresas e on e.id = ob.empresa_id
  join public.proveedores pr on pr.id = o.proveedor_id
  left join lateral (
    select count(*) as n_items,
           sum(coalesce(c.parcial, 0)) as total,
           sum(coalesce(c.parcial, 0)) filter (where c.comprobante_id is not null) as facturado,
           sum(coalesce(c.parcial, 0) * coalesce(f.factor, 0)) as pagado_cpe,
           bool_or(c.sobreprecio) as has_alertas
      from public.v_oc_items_calc c
      left join lateral (
        select case when cp.total - cp.retencion > 0
                    then least(1, coalesce(sum(ap.monto), 0) / (cp.total - cp.retencion))
                    else 1 end as factor
          from public.comprobantes cp
          left join public.pago_aplicaciones ap on ap.comprobante_id = cp.id
         where cp.id = c.comprobante_id
         group by cp.id
      ) f on true
     where c.obra_id = o.obra_id
       and c.numero_oc = o.numero
  ) t on true
  left join lateral (
    select sum(ap.monto) as pagado
      from public.pago_aplicaciones ap
     where ap.obra_id = o.obra_id
       and ap.numero_oc = o.numero
  ) d on true;

-- ------------------------------------------------------------ v_pendientes_pago (hoja FILTRO)
-- origen 'COMPROBANTE': comprobante con saldo; origen 'ORDEN': líneas sin comprobante ('FALTA')
-- de órdenes con precios confirmados o posteriores.
create view public.v_pendientes_pago with (security_invoker = true) as
select vc.empresa_id,
       vc.empresa,
       vc.proveedor_id,
       vc.proveedor,
       vc.proveedor_ruc as ruc,
       pr.banco,
       pr.cuenta_bancaria,
       'COMPROBANTE'::text as origen,
       vc.id as comprobante_id,
       vc.tipo,
       vc.serie,
       vc.numero,
       vc.fecha_emision as fecha,
       x.obras,
       x.ordenes,
       null::bigint as obra_id,
       null::text as numero_oc,
       vc.total,
       vc.retencion,
       vc.pagado,
       vc.saldo
  from public.v_comprobantes vc
  join public.proveedores pr on pr.id = vc.proveedor_id
  left join lateral (
    select string_agg(distinct ob.nombre, ', ') as obras,
           string_agg(distinct l.numero_oc, ', ') as ordenes
      from public.oc_items l
      join public.obras ob on ob.id = l.obra_id
     where l.comprobante_id = vc.id
  ) x on true
 where vc.saldo > 0.005
union all
select ob.empresa_id,
       e.nombre,
       o.proveedor_id,
       pr.razon_social,
       pr.ruc_o_cod,
       pr.banco,
       pr.cuenta_bancaria,
       'ORDEN'::text,
       null::bigint,
       null::public.tipo_comprobante,
       null::text,
       null::text,
       o.fecha,
       ob.nombre,
       o.numero,
       o.obra_id,
       o.numero,
       s.total,
       0::numeric,
       coalesce(d.pagado, 0),
       s.total - coalesce(d.pagado, 0)
  from public.ordenes_compra o
  join public.obras ob on ob.id = o.obra_id
  join public.empresas e on e.id = ob.empresa_id
  join public.proveedores pr on pr.id = o.proveedor_id
  cross join lateral (
    select sum(coalesce(c.parcial, 0)) as total
      from public.v_oc_items_calc c
     where c.obra_id = o.obra_id
       and c.numero_oc = o.numero
       and c.comprobante_id is null
  ) s
  left join lateral (
    select sum(ap.monto) as pagado
      from public.pago_aplicaciones ap
     where ap.obra_id = o.obra_id
       and ap.numero_oc = o.numero
  ) d on true
 where o.estado in ('PRECIOS_CONFIRMADOS', 'FACTURADA', 'PAGADA')
   and s.total - coalesce(d.pagado, 0) > 0.005;

-- ------------------------------------------------------------ registro de compras
create view public.v_registro_compras with (security_invoker = true) as
select vc.empresa_id,
       vc.empresa,
       vc.empresa_ruc,
       to_char(vc.fecha_emision, 'YYYYMM') as periodo,
       vc.id as comprobante_id,
       vc.tipo,
       vc.serie,
       vc.numero,
       vc.fecha_emision,
       vc.proveedor_id,
       vc.proveedor_ruc,
       vc.proveedor,
       vc.base,
       vc.igv,
       vc.total,
       vc.retencion,
       vc.asiento_id,
       coalesce(s.n, 0) as items_sin_cuenta
  from public.v_comprobantes vc
  left join lateral (
    select count(distinct c.item_id) as n
      from public.v_oc_items_calc c
     where c.comprobante_id = vc.id
       and c.cuenta_contable is null
  ) s on true;

-- ------------------------------------------------------------ ítems sin cuenta contable (en uso)
create view public.v_items_sin_cuenta with (security_invoker = true) as
select i.id as item_id,
       i.numero,
       i.descripcion,
       i.unidad,
       i.rubro,
       coalesce(p.n, 0) as n_partidas,
       coalesce(l.n, 0) as n_oc_items,
       coalesce(l.monto, 0) as monto_comprado
  from public.items i
  left join (select item_id, count(*) as n from public.partidas group by item_id) p on p.item_id = i.id
  left join (
    select item_id, count(*) as n, sum(coalesce(parcial, 0)) as monto
      from public.v_oc_items_calc
     where estado <> 'ANULADA'
     group by item_id
  ) l on l.item_id = i.id
 where i.cuenta_contable is null
   and (coalesce(p.n, 0) > 0 or coalesce(l.n, 0) > 0);

-- ------------------------------------------------------------ permisos
revoke all on public.v_oc_items_calc, public.v_partidas, public.v_precio_historico_item, public.v_comprobantes,
              public.v_oc_items, public.v_ordenes, public.v_pendientes_pago, public.v_registro_compras,
              public.v_items_sin_cuenta from anon;
grant select on public.v_oc_items_calc, public.v_partidas, public.v_precio_historico_item, public.v_comprobantes,
               public.v_oc_items, public.v_ordenes, public.v_pendientes_pago, public.v_registro_compras,
               public.v_items_sin_cuenta to authenticated, service_role;
