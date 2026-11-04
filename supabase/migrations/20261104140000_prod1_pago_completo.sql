-- Prod 1: Tesorería paga siempre la orden completa (todo su saldo), sin pagos parciales. Una orden que ya
-- traiga un pago parcial (del Excel o del MVP) se paga por lo que le falta, entero.
-- Se parchea la definición vigente de pagar_documento: el chequeo va justo después del del saldo excedido.
do $$
declare
  d text := pg_get_functiondef('public.pagar_documento'::regproc);
  ancla text := 'v_rest := v_monto;';
  n text;
begin
  if position('no se aceptan pagos parciales' in d) > 0 then
    return;
  end if;
  -- Antes de repartir el monto entre los comprobantes (después de comprobar que no excede el saldo).
  n := replace(d, ancla, $chequeo$if v_monto < v_saldo - 0.005 then
      raise exception 'Tesorería paga la orden % completa: S/ % (no se aceptan pagos parciales)', v_numero, v_saldo;
    end if;
    $chequeo$ || ancla);
  if n = d then
    raise exception 'pagar_documento: no se encontró dónde agregar el chequeo del pago completo';
  end if;
  execute n;
end
$$;
