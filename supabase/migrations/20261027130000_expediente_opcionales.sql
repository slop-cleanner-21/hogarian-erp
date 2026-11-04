-- Guía de remisión y contrato pasan a ser opcionales en el expediente (decisión del usuario).
-- Siguen informándose (tiene_guia, tiene_contrato, requiere_contrato), pero no cuentan en docs_ok/docs_req:
-- obligatorios = comprobante, orden, voucher y fotografías.

create or replace view public.v_expediente with (security_invoker = true) as
with ord as (
  select distinct l.comprobante_id, l.obra_id, l.numero_oc, o.tipo
    from public.oc_items l
    join public.ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
   where l.comprobante_id is not null
), oa as (
  select d.comprobante_id,
         string_agg(distinct d.tipo::text || ' ' || d.numero_oc, ', '
                    order by d.tipo::text || ' ' || d.numero_oc) as ordenes,
         (array_agg(d.obra_id order by d.obra_id, d.numero_oc))[1] as obra_id,
         (array_agg(d.numero_oc order by d.obra_id, d.numero_oc))[1] as numero_oc,
         bool_or(d.tipo = 'OS') as requiere_contrato
    from ord d
   group by d.comprobante_id
), adj as (
  select d.comprobante_id,
         bool_or(a.tipo = 'GUIA') as guia,
         bool_or(a.tipo = 'FOTO') as fotos,
         bool_or(a.tipo = 'CONTRATO') as contrato
    from ord d
    join public.adjuntos a on a.obra_id = d.obra_id and a.numero_oc = d.numero_oc
   where a.tipo in ('GUIA', 'FOTO', 'CONTRATO')
   group by d.comprobante_id
), vou as (
  select ap.comprobante_id
    from public.pago_aplicaciones ap
    join public.adjuntos a on a.pago_id = ap.pago_id and a.tipo = 'VOUCHER'
   where ap.comprobante_id is not null
  union
  select d.comprobante_id
    from ord d
    join public.pago_aplicaciones ap on ap.obra_id = d.obra_id and ap.numero_oc = d.numero_oc
    join public.adjuntos a on a.pago_id = ap.pago_id and a.tipo = 'VOUCHER'
), x as (
  select c.id as comprobante_id,
         c.empresa_id,
         c.periodo_anotacion::text as periodo,
         pr.razon_social as proveedor,
         c.serie,
         c.numero,
         c.tipo,
         oa.ordenes,
         oa.obra_id,
         oa.numero_oc,
         c.archivo_path is not null as tiene_archivo,
         oa.comprobante_id is not null as tiene_orden,
         coalesce(adj.guia, false) as tiene_guia,
         vou.comprobante_id is not null as tiene_voucher,
         coalesce(adj.fotos, false) as tiene_fotos,
         coalesce(oa.requiere_contrato, false) as requiere_contrato,
         coalesce(adj.contrato, false) as tiene_contrato
    from public.comprobantes c
    join public.proveedores pr on pr.id = c.proveedor_id
    left join oa on oa.comprobante_id = c.id
    left join adj on adj.comprobante_id = c.id
    left join vou on vou.comprobante_id = c.id
)
select x.*,
       (x.tiene_archivo::int + x.tiene_orden::int + x.tiene_voucher::int + x.tiene_fotos::int) as docs_ok,
       4 as docs_req
  from x;
