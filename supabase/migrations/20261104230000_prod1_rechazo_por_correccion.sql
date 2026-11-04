-- Prod 1: el rechazo de Tesorería devuelve la orden solo hasta donde hace falta corregir (antes, siempre a
-- «Cotizando»: había que volver a confirmar precios que estaban bien) y queda registrado de punta a punta.
--
--   Corregir     | Vuelve a                     | Logística
--   DATOS        | FACTURADA (Guía / Contrato)  | corrige (cuenta, guía, contrato, firma…) y la reenvía, con una nota
--   FACTURA      | PRECIOS_CONFIRMADOS (Facturar)| registra la factura nueva: va sola a Tesorería
--   PRECIOS      | EMITIDA (Cotizando)          | revisa los precios (el link se renueva) y registra la factura nueva
--
-- El motivo es obligatorio. El reenvío queda en el rechazo (cuándo, quién y qué se corrigió) y Tesorería
-- recibe un aviso.

alter table public.rechazos
  add column if not exists correccion text,
  add column if not exists reenviado_at timestamptz,
  add column if not exists reenviado_by uuid references auth.users (id),
  add column if not exists nota_reenvio text;
alter table public.rechazos drop constraint if exists rechazos_correccion_check;
alter table public.rechazos add constraint rechazos_correccion_check
  check (correccion is null or correccion in ('DATOS', 'FACTURA', 'PRECIOS'));
comment on column public.rechazos.correccion is 'Qué pidió corregir Tesorería: DATOS (vuelve a Guía/Contrato), FACTURA (a Facturar) o PRECIOS (a Cotizando)';
comment on column public.rechazos.reenviado_at is 'Cuándo volvió a Tesorería (corregida)';
comment on column public.rechazos.nota_reenvio is 'Qué se corrigió, según Logística al reenviarla';

-- Rechazos de antes: los que anularon la factura, por la factura; los demás, por datos.
update public.rechazos set correccion = case when comprobantes_anulados is not null then 'FACTURA' else 'DATOS' end
 where correccion is null and doc <> 'OP';
-- Los que ya volvieron a Tesorería (o se pagaron) quedan reenviados.
update public.rechazos r set reenviado_at = coalesce(r.reenviado_at, r.created_at)
  from public.ordenes_compra o
 where r.reenviado_at is null and o.obra_id = r.obra_id and o.numero = r.numero
   and o.estado in ('EN_TESORERIA', 'PAGADA', 'EN_ENTREGA', 'RECIBIDA');

drop function if exists public.rechazar_documento(bigint, text, bigint, text, boolean);
create or replace function public.rechazar_documento(
  p_obra_id bigint, p_numero text, p_orden_pago_id bigint, p_motivo text,
  p_factura_nueva boolean default false, p_correccion text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
  v_op ordenes_pago%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  -- Sin indicar (llamadas de antes): con factura nueva, la factura; si no, los datos.
  v_corr text := coalesce(p_correccion, case when p_factura_nueva then 'FACTURA' else 'DATOS' end);
  v_destino estado_oc;
  v_ids bigint[];
  v_anuladas text[];
begin
  perform exigir_rol('TESORERIA');
  if p_orden_pago_id is not null then
    select * into v_op from ordenes_pago where id = p_orden_pago_id for update;
    if not found or v_op.estado <> 'EN_TESORERIA' then
      raise exception 'La orden de pago no está en Tesorería';
    end if;
    update ordenes_pago set estado = 'BORRADOR' where id = p_orden_pago_id;
    insert into rechazos (doc, orden_pago_id, motivo, estado_previo, estado_destino)
    values ('OP', p_orden_pago_id, v_motivo, 'EN_TESORERIA', 'BORRADOR');
    perform notificar('CONTABILIDAD', 'RECHAZO', format('Tesorería rechazó la %s', v_op.numero), v_motivo,
                      format('/contabilidad/op/%s', p_orden_pago_id));
    return;
  end if;

  if v_corr not in ('DATOS', 'FACTURA', 'PRECIOS') then
    raise exception 'Indica qué hay que corregir: los datos o documentos, la factura o los precios';
  end if;
  if v_motivo is null then
    raise exception 'Escribe el motivo del rechazo: es lo que Logística va a corregir';
  end if;
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero for update;
  if not found or v_o.estado <> 'EN_TESORERIA' then
    raise exception 'La orden % no está en Tesorería', p_numero;
  end if;

  -- La factura o los precios: la factura se anula (el proveedor emite otra).
  if v_corr in ('FACTURA', 'PRECIOS') then
    select array_agg(distinct comprobante_id) into v_ids
      from oc_items where obra_id = p_obra_id and numero_oc = p_numero and comprobante_id is not null;
    if v_ids is not null then
      if exists (select 1 from pago_aplicaciones where comprobante_id = any (v_ids)) then
        raise exception 'El comprobante ya tiene pagos: no se puede anular (rechaza por datos o documentos)';
      end if;
      if exists (select 1 from asientos where comprobante_id = any (v_ids)) then
        raise exception 'El comprobante ya está contabilizado: no se puede anular (rechaza por datos o documentos)';
      end if;
      if exists (select 1 from oc_items where comprobante_id = any (v_ids) and (obra_id, numero_oc) <> (p_obra_id, p_numero)) then
        raise exception 'El comprobante también es de otras órdenes: no se puede anular desde esta (rechaza por datos o documentos)';
      end if;
      select array_agg(tipo::text || ' ' || serie || '-' || numero order by id) into v_anuladas from comprobantes where id = any (v_ids);
      update oc_items set comprobante_id = null where comprobante_id = any (v_ids);
      update comprobantes set anulado_at = now(), anulado_motivo = v_motivo where id = any (v_ids);
    elsif v_corr = 'FACTURA' then
      raise exception 'La orden no tiene comprobantes que anular';
    end if;
  end if;

  v_destino := case v_corr when 'DATOS' then 'FACTURADA' when 'FACTURA' then 'PRECIOS_CONFIRMADOS' else 'EMITIDA' end;
  if v_corr = 'PRECIOS' then
    -- A cotización: los precios quedan para corregirlos; el link se renueva ("Reenviar" lo abre al proveedor).
    update ordenes_compra
       set estado = v_destino, token_cotizacion = gen_random_uuid(),
           cotizacion_estado = case when cotizacion_estado = 'SIN_ENVIAR' then 'SIN_ENVIAR'::cotizacion_estado else 'RECIBIDA'::cotizacion_estado end
     where obra_id = p_obra_id and numero = p_numero;
  else
    update ordenes_compra set estado = v_destino where obra_id = p_obra_id and numero = p_numero;
  end if;

  insert into rechazos (doc, obra_id, numero, motivo, estado_previo, estado_destino, comprobantes_anulados, correccion)
  values (v_o.tipo::text, p_obra_id, p_numero, v_motivo, 'EN_TESORERIA', v_destino::text, v_anuladas, v_corr);
  perform notificar('LOGISTICA', 'RECHAZO',
                    format('Tesorería rechazó la %s %s: %s', v_o.tipo, p_numero,
                           case v_corr when 'DATOS' then 'corrige y reenvíala'
                                       when 'FACTURA' then 'registra la factura nueva'
                                       else 'revisa los precios' end),
                    v_motivo, format('/logistica/ordenes/%s/%s?tipo=%s', p_obra_id, p_numero, v_o.tipo));
end;
$$;
revoke all on function public.rechazar_documento(bigint, text, bigint, text, boolean, text) from public, anon;
grant execute on function public.rechazar_documento(bigint, text, bigint, text, boolean, text) to authenticated;

-- Al volver a Tesorería, el rechazo abierto queda reenviado (cuándo y quién) y Tesorería recibe un aviso.
do $$
declare
  v_def text := pg_get_functiondef('public.enviar_a_tesoreria(bigint, text)'::regprocedure);
  v_ancla text := 'update ordenes_compra set estado = ''EN_TESORERIA'' where obra_id = p_obra_id and numero = p_numero;';
begin
  if position(v_ancla in v_def) = 0 then
    raise exception 'enviar_a_tesoreria: no se encontró dónde registrar el reenvío';
  end if;
  execute replace(v_def, v_ancla, v_ancla || '
  update rechazos set reenviado_at = now(), reenviado_by = auth.uid()
   where obra_id = p_obra_id and numero = p_numero and reenviado_at is null;
  if found then
    perform notificar(''TESORERIA'', ''REENVIO'', format(''Logística reenvió la %s %s corregida'', v_o.tipo, p_numero),
      (select nota_reenvio from rechazos where obra_id = p_obra_id and numero = p_numero order by created_at desc limit 1),
      format(''/tesoreria/pago/%s/%s'', p_obra_id, p_numero));
  end if;');
end;
$$;

-- Reenviar la corregida (por datos o documentos), con lo que se corrigió.
create or replace function public.reenviar_a_tesoreria(p_obra_id bigint, p_numero text, p_nota text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform exigir_rol('LOGISTICA');
  update rechazos set nota_reenvio = nullif(btrim(coalesce(p_nota, '')), '')
   where obra_id = p_obra_id and numero = p_numero and reenviado_at is null;
  perform enviar_a_tesoreria(p_obra_id, p_numero);
end;
$$;
revoke all on function public.reenviar_a_tesoreria(bigint, text, text) from public, anon;
grant execute on function public.reenviar_a_tesoreria(bigint, text, text) to authenticated;
