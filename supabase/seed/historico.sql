-- Órdenes históricas del Excel que ya están pagadas: el material llegó hace tiempo, así que se
-- registra la entrega completa (sin fotos, a nombre del Admin) y quedan Recibidas. Así no aparecen
-- como pendientes en Logística ni en "Por recibir" del residente.

-- Carga inicial: sin auditoría (como excel.sql).
set app.skip_audit = 'on';

do $$
begin
  if not exists (select 1 from public.perfiles where rol = 'ADMIN') then
    raise exception 'Falta el Admin: créalo antes de cargar el histórico (scripts/produccion/crear-admin.mjs)';
  end if;
end;
$$;

insert into public.entregas (obra_id, numero_oc, oc_item_id, cantidad, rol, capturado_en, created_by, created_at)
select l.obra_id, l.numero_oc, l.id, l.cantidad, 'HISTORICO', o.fecha::timestamptz, a.user_id, o.fecha::timestamptz
  from public.oc_items l
  join public.ordenes_compra o on o.obra_id = l.obra_id and o.numero = l.numero_oc
  -- A nombre del Admin (local: admin@erp.local; producción: el primero, creado antes de la carga).
  cross join (select user_id from public.perfiles where rol = 'ADMIN' order by user_id limit 1) a
 where o.estado = 'PAGADA'
   and l.cantidad > 0;

update public.ordenes_compra set estado = 'RECIBIDA' where estado = 'PAGADA';

reset app.skip_audit;
