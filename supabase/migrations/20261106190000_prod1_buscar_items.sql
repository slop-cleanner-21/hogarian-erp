-- Buscar órdenes por ítem (06/11/2026). Columna items_busqueda de v_ordenes: las descripciones de los ítems de la orden, sin
-- tildes. Es una subconsulta de la vista (solo se calcula si el filtro la usa). Medido por la API: una función por fila
-- (columna calculada de PostgREST) hacía la búsqueda 15 a 40 veces más lenta; esto la deja casi igual.
do $$
declare
  v_def text := pg_get_viewdef('public.v_ordenes'::regclass, true);
  v_nuevo text;
begin
  v_nuevo := regexp_replace(rtrim(v_def, E'; \n'), E'\n   FROM ordenes_compra o\n', $r$,
    ( SELECT string_agg(translate(i.descripcion, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'), ' | ')
        FROM oc_items l JOIN partidas p ON p.id = l.partida_id JOIN items i ON i.id = p.item_id
       WHERE l.obra_id = o.obra_id AND l.numero_oc = o.numero) AS items_busqueda
   FROM ordenes_compra o
$r$);
  if v_nuevo = rtrim(v_def, E'; \n') then raise exception 'v_ordenes cambió: revisar la migración'; end if;
  -- Sin repetir security_invoker, «create or replace» lo quita y la vista deja de aplicar las reglas de cada rol.
  execute 'create or replace view public.v_ordenes with (security_invoker = true) as ' || v_nuevo;
end $$;
notify pgrst, 'reload schema';
