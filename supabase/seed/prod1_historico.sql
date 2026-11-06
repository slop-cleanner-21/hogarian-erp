-- Prod 1: todo lo cargado hasta aquí (Excel y su histórico) es dato histórico. Va después de excel.sql e
-- historico.sql y antes de las demos: lo que se cree después (demos, la app) es normal.
-- Carga inicial: sin auditoría (como excel.sql).
set app.skip_audit = 'on';

update public.ordenes_compra set historico = true where not historico;
update public.comprobantes set historico = true where not historico;
update public.pagos set historico = true where not historico;

-- Las OS del Excel usan la tolerancia del ítem, como el Excel: las líneas se cargaron antes de marcarlas como históricas.
update public.oc_items l
   set tol_fijada = i.tolerancia_pct
  from public.ordenes_compra o, public.partidas p, public.items i
 where o.obra_id = l.obra_id and o.numero = l.numero_oc and p.id = l.partida_id and i.id = p.item_id
   and o.tipo = 'OS' and o.historico and l.precio_fijado_at is not null;

reset app.skip_audit;
