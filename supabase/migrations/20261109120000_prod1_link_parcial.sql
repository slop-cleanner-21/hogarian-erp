-- Prod 1: en el link del proveedor, con la orden confirmada, los P.U. van netos de la garantía (es como se le comunica). Para eso la
-- respuesta lleva el parcial de cada línea (lo que factura).
do $m$
declare f text; a text;
begin
  f := pg_get_functiondef('public.get_cotizacion'::regproc);
  a := $x$'ret_garantia_pct', l.ret_garantia_pct,$x$;
  if position(a in f) = 0 then raise exception 'get_cotizacion: no encontré la retención de la línea'; end if;
  execute replace(f, a, $x$'ret_garantia_pct', l.ret_garantia_pct,
                      'parcial', case when v_orden then l.parcial end,$x$);
end;
$m$;
