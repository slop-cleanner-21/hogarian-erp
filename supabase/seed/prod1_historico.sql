-- Prod 1: todo lo cargado hasta aquí (Excel y su histórico) es dato histórico. Va después de excel.sql e
-- historico.sql y antes de las demos: lo que se cree después (demos, la app) es normal.
-- Carga inicial: sin auditoría (como excel.sql).
set app.skip_audit = 'on';

update public.ordenes_compra set historico = true where not historico;
update public.comprobantes set historico = true where not historico;
update public.pagos set historico = true where not historico;

reset app.skip_audit;
