-- Prod 1: una orden facturada que ya tiene lo que le toca (la guía registrada si la requiere, el contrato
-- firmado si es OS) se envía sola a Tesorería. La app llama a enviar_si_lista después de cada acción de
-- Logística que puede completarla: registrar el comprobante, la guía o el contrato firmado, confirmar los
-- precios (tras un rechazo con la factura conservada) o quitar «Requiere guía».

create or replace function public.enviar_si_lista(p_obra_id bigint, p_numero text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o ordenes_compra%rowtype;
begin
  perform exigir_rol('LOGISTICA');
  select * into v_o from ordenes_compra where obra_id = p_obra_id and numero = p_numero;
  if not found or v_o.estado <> 'FACTURADA' then
    return false;
  end if;
  if v_o.tipo = 'OS' and not v_o.es_retencion and not exists (
       select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero) then
    return false;
  end if;
  if v_o.tipo = 'OC' and v_o.requiere_guia and not exists (
       select 1 from guias where obra_id = p_obra_id and numero_oc = p_numero and estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then
    return false;
  end if;
  perform enviar_a_tesoreria(p_obra_id, p_numero);
  return true;
end;
$$;
revoke all on function public.enviar_si_lista(bigint, text) from public, anon;
grant execute on function public.enviar_si_lista(bigint, text) to authenticated;

-- Las que ya estaban completas («Por enviar») pasan a Tesorería.
update ordenes_compra o
   set estado = 'EN_TESORERIA'
 where o.estado = 'FACTURADA'
   and (o.tipo <> 'OS' or o.es_retencion
        or exists (select 1 from adjuntos a where a.tipo = 'CONTRATO' and a.obra_id = o.obra_id and a.numero_oc = o.numero))
   and (o.tipo <> 'OC' or not o.requiere_guia
        or exists (select 1 from guias g where g.obra_id = o.obra_id and g.numero_oc = o.numero and g.estado in ('EMITIDA', 'ANULACION_PENDIENTE')));
