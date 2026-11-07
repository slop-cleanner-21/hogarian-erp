-- Prod 1: Logística anula una OC u OS mientras no se haya mandado a Tesorería, aunque ya tenga su factura o recibo. Ese comprobante
-- se anula con la orden (si no tiene pagos, no está contabilizado y no cubre otras órdenes). Un comprobante anulado no bloquea su
-- número: la orden correcta puede registrarlo de nuevo.

create or replace function public.anular_orden(p_obra_id bigint, p_numero text, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_estado estado_oc;
  v_ids bigint[];
begin
  perform exigir_rol('LOGISTICA', 'GERENCIA');
  select estado into v_estado from ordenes_compra
   where obra_id = p_obra_id and numero = p_numero for update;
  if not found then
    raise exception 'La orden % no existe en la obra', p_numero;
  end if;
  if v_estado = 'ANULADA' then
    raise exception 'La orden % ya está anulada', p_numero;
  end if;
  if v_estado not in ('BORRADOR', 'EMITIDA', 'PRECIOS_CONFIRMADOS', 'FACTURADA') then
    raise exception 'La orden % ya se mandó a Tesorería: no se puede anular', p_numero;
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'Debe indicar el motivo de anulación';
  end if;
  if exists (select 1 from pago_aplicaciones where obra_id = p_obra_id and numero_oc = p_numero) then
    raise exception 'No se puede anular la orden %: tiene pagos registrados', p_numero;
  end if;

  -- Su factura o recibo se anula con ella.
  select array_agg(distinct comprobante_id) into v_ids
    from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is not null;
  if v_ids is not null then
    if exists (select 1 from pago_aplicaciones where comprobante_id = any (v_ids)) then
      raise exception 'No se puede anular la orden %: su comprobante tiene pagos', p_numero;
    end if;
    if exists (select 1 from asientos where comprobante_id = any (v_ids)) then
      raise exception 'No se puede anular la orden %: su comprobante ya está contabilizado', p_numero;
    end if;
    if exists (select 1 from oc_items where comprobante_id = any (v_ids) and (obra_id, numero_oc) <> (p_obra_id, p_numero)) then
      raise exception 'No se puede anular la orden %: su comprobante también es de otras órdenes', p_numero;
    end if;
    update oc_items set comprobante_id = null where comprobante_id = any (v_ids);
    update comprobantes set anulado_at = now(), anulado_motivo = format('Orden %s anulada: %s', p_numero, btrim(p_motivo))
     where id = any (v_ids);
  end if;

  update ordenes_compra set estado = 'ANULADA', motivo_anulacion = btrim(p_motivo)
   where obra_id = p_obra_id and numero = p_numero;

  -- Guía: si ya se emitió en SUNAT, hay que anularla allá; si solo estaba pedida, se cancela.
  update guias set estado = 'ANULACION_PENDIENTE'
   where obra_id = p_obra_id and numero_oc = p_numero and estado = 'EMITIDA';
  if found then
    perform notificar('CONTABILIDAD', 'GUIA_ANULAR', format('Anular en SUNAT la guía de la OC %s', p_numero),
                      'La orden de compra fue anulada', '/contabilidad/guias?est=anu');
  end if;
  update guias set estado = 'ANULADA', anulada_at = now()
   where obra_id = p_obra_id and numero_oc = p_numero and estado = 'SOLICITADA';
end;
$$;

-- El N° de un comprobante anulado se puede volver a registrar.
alter table public.comprobantes drop constraint comprobantes_proveedor_id_tipo_serie_numero_key;
create unique index comprobantes_vigente_key on public.comprobantes (proveedor_id, tipo, serie, numero) where anulado_at is null;

do $m$
declare f text; a text;
begin
  f := pg_get_functiondef('public.registrar_comprobante'::regproc);
  a := $x$                and serie = v_serie and numero = v_numero) then$x$;
  if position(a in f) = 0 then raise exception 'registrar_comprobante: no encontré el control de duplicado'; end if;
  execute replace(f, a, $x$                and serie = v_serie and numero = v_numero and anulado_at is null) then$x$);
end;
$m$;
