-- «Requiere guía» se decide hasta facturar (06/11/2026): en Cotizando y Facturar se puede cambiar; desde que la orden queda
-- facturada ya es fijo. Antes se podía cambiar en cualquier estado, hasta en una orden recibida. Si hay que corregirlo, Tesorería
-- la rechaza por la factura y vuelve a «Facturar».
do $$
declare
  v_def text := pg_get_functiondef('public.set_requiere_guia(bigint, text, boolean)'::regprocedure);
  v_nuevo text;
begin
  v_nuevo := regexp_replace(
    v_def,
    $r$(raise exception 'Solo las órdenes de compra llevan guía de remisión';\s+end if;)$r$,
    E'\\1\n  if v_o.estado not in (''EMITIDA'', ''PRECIOS_CONFIRMADOS'') then\n    raise exception ''Después de facturar ya no se cambia si la orden lleva guía'';\n  end if;'
  );
  if v_nuevo = v_def then raise exception 'set_requiere_guia cambió: revisar la migración'; end if;
  execute v_nuevo;
end $$;
