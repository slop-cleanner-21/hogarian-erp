-- Prod 1: las órdenes cargadas (Excel, demos) que ya están facturadas con lo que les toca (la guía si la
-- requieren, el contrato firmado si son OS) pasan a Tesorería, como haría el envío automático
-- (enviar_si_lista); las históricas no esperan contrato ni guía. Las rechazadas no: esperan a que Logística
-- corrija. Va al final de los seeds.
-- Carga inicial: sin auditoría (como excel.sql).
set app.skip_audit = 'on';

update ordenes_compra o
   set estado = 'EN_TESORERIA'
 where o.estado = 'FACTURADA'
   and not exists (select 1 from rechazos r where r.obra_id = o.obra_id and r.numero = o.numero)
   and (o.tipo <> 'OS' or o.es_retencion or o.historico
        or exists (select 1 from adjuntos a where a.tipo = 'CONTRATO' and a.obra_id = o.obra_id and a.numero_oc = o.numero))
   and (o.tipo <> 'OC' or not o.requiere_guia or o.historico
        or exists (select 1 from guias g where g.obra_id = o.obra_id and g.numero_oc = o.numero and g.estado in ('EMITIDA', 'ANULACION_PENDIENTE')));

reset app.skip_audit;
