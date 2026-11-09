-- Prod 1 (sugerencia de Logística): en una OS se puede cambiar el proveedor hasta que se le envía el contrato al maestro (sin contrato
-- enviado ni firmado y sin comprobante). El link del proveedor anterior deja de servir; en cotización, los precios vuelven al
-- presupuesto (los que mandó el anterior no valen) y la cotización queda por enviar al nuevo.
create or replace function public.cambiar_proveedor_orden(p_obra_id bigint, p_numero text, p_proveedor_id bigint)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o ordenes_compra%rowtype;
  v_habitual tipo_comprobante;
begin
  perform exigir_rol('LOGISTICA');
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe', p_numero;
  end if;
  if v_o.tipo <> 'OS' or v_o.es_retencion then
    raise exception 'Solo se cambia el proveedor de una OS';
  end if;
  if v_o.estado not in ('EMITIDA', 'PRECIOS_CONFIRMADOS') or v_o.contrato_enviado_at is not null
     or exists (select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero)
     or exists (select 1 from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is not null) then
    raise exception 'El proveedor ya no se cambia: el contrato ya se le envió o la OS ya tiene su comprobante';
  end if;
  select comprobante_habitual into v_habitual from proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige el proveedor';
  end if;
  if p_proveedor_id = v_o.proveedor_id then
    raise exception 'Es el mismo proveedor';
  end if;

  update ordenes_compra
     set proveedor_id = p_proveedor_id,
         token_cotizacion = gen_random_uuid(),
         comprobante_tipo = case when v_habitual in ('RXH', 'FACTURA') then v_habitual else comprobante_tipo end,
         cotizacion_estado = case when estado = 'EMITIDA' then 'SIN_ENVIAR'::cotizacion_estado else cotizacion_estado end,
         cotizacion_enviada_at = case when estado = 'EMITIDA' then null else cotizacion_enviada_at end,
         cotizacion_recibida_at = case when estado = 'EMITIDA' then null else cotizacion_recibida_at end
   where obra_id = p_obra_id and numero = p_numero;

  if v_o.estado = 'EMITIDA' then
    update oc_items l set pu_cotizado = p.pu, pu_aprobado = null
      from partidas p
     where p.id = l.partida_id and l.obra_id = p_obra_id and l.numero_oc = p_numero;
  end if;
end;
$$;
revoke all on function public.cambiar_proveedor_orden(bigint, text, bigint) from public, anon;
grant execute on function public.cambiar_proveedor_orden(bigint, text, bigint) to authenticated;
