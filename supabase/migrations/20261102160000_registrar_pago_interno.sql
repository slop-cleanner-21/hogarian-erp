-- registrar_pago aplica un pago a comprobantes sin mirar si la orden está en Tesorería (su rama de
-- comprobante no lo revisa). La app paga con pagar_documento, que sí lo exige; registrar_pago queda solo
-- para seeds y cargas (postgres / service_role).
revoke execute on function public.registrar_pago(bigint, date, text, text, jsonb) from authenticated;
