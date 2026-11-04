-- Estados nuevos de la OC/OS (archivo propio: un valor de enum no se puede usar en la misma
-- transacción en que se agrega).
--   FACTURADA     → "Por enviar": con comprobante, lista para mandar a Tesorería.
--   EN_TESORERIA  → Tesorería la paga o la rechaza (vuelve a FACTURADA).
--   PAGADA        → falta enviar la constancia de pago al proveedor.
--   EN_ENTREGA    → llegan los materiales / se ejecuta el servicio (entregas con fotos).
--   RECIBIDA      → todo lo pedido llegó.
alter type public.estado_oc add value if not exists 'EN_TESORERIA' after 'FACTURADA';
alter type public.estado_oc add value if not exists 'EN_ENTREGA' after 'PAGADA';
alter type public.estado_oc add value if not exists 'RECIBIDA' after 'EN_ENTREGA';
