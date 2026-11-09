-- Prod 1: la recepción la registra Logística, con foto opcional (los residentes, cuando existan, la seguirán debiendo). Cuando llega
-- todo lo pedido, la orden queda recibida. El aviso de una entrega con observación lleva a Operaciones a su seguimiento.
do $m$
declare f text; a text;
begin
  f := pg_get_functiondef('public.registrar_entrega'::regproc);
  a := $x$  if p_fotos is null or cardinality(p_fotos) = 0 then$x$;
  if position(a in f) = 0 then raise exception 'registrar_entrega: no encontré el control de fotos'; end if;
  f := replace(f, a, $x$  if v_rol = 'RESIDENTE' and (p_fotos is null or cardinality(p_fotos) = 0) then$x$);
  a := $x$  foreach f in array p_fotos loop$x$;
  if position(a in f) = 0 then raise exception 'registrar_entrega: no encontré el recorrido de fotos'; end if;
  f := replace(f, a, $x$  foreach f in array coalesce(p_fotos, '{}'::text[]) loop$x$);
  a := $x$format('/operaciones/valorizaciones?obra=%s', v_l.obra_id)$x$;
  if position(a in f) = 0 then raise exception 'registrar_entrega: no encontré el link de Operaciones'; end if;
  execute replace(f, a, $x$format('/operaciones?obra=%s', v_l.obra_id)$x$);
end;
$m$;
