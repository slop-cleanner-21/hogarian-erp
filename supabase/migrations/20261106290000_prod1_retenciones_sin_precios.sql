-- Prod 1: una OS de retenciones no se rechaza por precios: su monto es lo retenido y no se cambia, así que en cotización quedaría trabada.
do $m$
declare f text; a text;
begin
  f := pg_get_functiondef('public.rechazar_documento'::regproc);
  a := $x$  -- La factura o los precios: la factura se anula (el proveedor emite otra).$x$;
  if position(a in f) = 0 then raise exception 'rechazar_documento: no encontré el punto'; end if;
  execute replace(f, a, $x$  if v_corr = 'PRECIOS' and exists (select 1 from ordenes_compra where obra_id = p_obra_id and numero = p_numero and es_retencion) then
    raise exception 'El monto de una OS de retenciones no se corrige: rechaza por datos o por la factura';
  end if;

  -- La factura o los precios: la factura se anula (el proveedor emite otra).$x$);
end;
$m$;
