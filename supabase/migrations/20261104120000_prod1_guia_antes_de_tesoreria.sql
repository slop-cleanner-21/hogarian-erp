-- Prod 1: la guía de remisión la registra la misma Logística, así que una OC que la requiere no puede
-- ir a Tesorería sin ella (en el MVP la emite Contabilidad y Tesorería solo frena el pago).
-- Se parchea la definición vigente de enviar_a_tesoreria: el chequeo va junto al del contrato de la OS.
do $$
declare
  d text := pg_get_functiondef('public.enviar_a_tesoreria'::regproc);
  ancla text := '  update ordenes_compra set estado = ''EN_TESORERIA'' where obra_id = p_obra_id and numero = p_numero;';
  n text;
begin
  if position('Falta registrar la guía de remisión' in d) > 0 then
    return;
  end if;
  n := replace(d, ancla, $chequeo$  if v_o.tipo = 'OC' and v_o.requiere_guia and not exists (
       select 1 from guias where obra_id = p_obra_id and numero_oc = p_numero and estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then
    raise exception 'Falta registrar la guía de remisión de la OC %', p_numero;
  end if;
$chequeo$ || ancla);
  if n = d then
    raise exception 'enviar_a_tesoreria: no se encontró dónde agregar el chequeo de la guía';
  end if;
  execute n;
end
$$;
