-- Prod 1: una OS con retención por garantía se factura por el neto. Si se aceptara el comprobante por el 100 %, Tesorería pagaría lo
-- retenido junto con la orden y después se devolvería otra vez en la OS de retenciones. Se admite S/ 1 de diferencia por redondeo.

create or replace function public.fn_exigir_neto(p_total numeric, p_item_ids bigint[]) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_neto numeric;
  v_retenido numeric;
begin
  select coalesce(sum(parcial), 0), coalesce(sum(retenido), 0) into v_neto, v_retenido
    from v_oc_items_calc where id = any (p_item_ids);
  if v_retenido > 0 and abs(p_total - v_neto) > 1 then
    raise exception 'El comprobante debe ser por % (sin la retención por garantía)', fn_soles(v_neto);
  end if;
end;
$$;
revoke all on function public.fn_exigir_neto(numeric, bigint[]) from public, anon, authenticated;

do $m$
declare f text; a text;
begin
  f := pg_get_functiondef('public.registrar_comprobante'::regproc);
  a := $x$  -- OS: si llega el otro comprobante, otro contrato.$x$;
  if position(a in f) = 0 then raise exception 'registrar_comprobante: no encontré el punto'; end if;
  execute replace(f, a, $x$  perform fn_exigir_neto(round(p_total, 2), p_item_ids);

  -- OS: si llega el otro comprobante, otro contrato.$x$);

  f := pg_get_functiondef('public.editar_comprobante'::regproc);
  a := $x$  -- OS: factura o recibo por honorarios; con el otro, otro contrato.$x$;
  if position(a in f) = 0 then raise exception 'editar_comprobante: no encontré el punto'; end if;
  execute replace(f, a, $x$  if round(p_total, 2) <> c.total then
    perform fn_exigir_neto(round(p_total, 2), (select array_agg(id) from oc_items where comprobante_id = p_id));
  end if;

  -- OS: factura o recibo por honorarios; con el otro, otro contrato.$x$);
end;
$m$;
