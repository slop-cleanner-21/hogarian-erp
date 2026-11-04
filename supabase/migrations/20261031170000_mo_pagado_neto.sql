-- Lo pagado de mano de obra en neto: las valorizaciones con su OS pagada se pagan sin la retención,
-- que se paga al cerrar la obra. Las órdenes de mano de obra anteriores a las valorizaciones cuentan
-- a su P.U.
drop function if exists public.mo_partidas(bigint);

create function public.mo_partidas(p_obra_id bigint)
returns table (
  partida_id bigint,
  etapa text,
  orden_etapa integer,
  descripcion text,
  unidad text,
  presupuesto_efectivo numeric,
  pu numeric,
  en_logistica numeric,
  en_tesoreria numeric,
  por_recibir numeric,
  recibido numeric,
  ejecutado_sin_valorizar numeric,
  valorizado_sin_pagar numeric,
  valorizado_pagado numeric,
  retencion_acumulada numeric,
  pagado_neto numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if rol_actual() is null then
    raise exception 'Inicia sesión';
  end if;
  if es_residente() and p_obra_id not in (select obras_residente()) then
    raise exception 'La obra no está asignada a este residente';
  end if;
  return query
    select v.partida_id, v.etapa, v.orden_etapa, v.descripcion, v.unidad, v.presupuesto_efectivo, v.pu,
           v.en_logistica, v.en_tesoreria, v.por_recibir, v.recibido,
           v.ejecutado_sin_valorizar, v.valorizado_sin_pagar, v.valorizado_pagado, v.retencion_acumulada,
           v.recibido * coalesce(v.pu, 0) + coalesce((
             select sum(vp.parcial - vp.retencion)
               from valorizacion_partidas vp
               join valorizaciones va on va.id = vp.valorizacion_id
               join ordenes_compra o on o.obra_id = va.obra_id and o.numero = va.numero_oc
              where vp.partida_id = v.partida_id
                and o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA')
           ), 0)
      from v_seguimiento_partida v
     where v.obra_id = p_obra_id and v.grupo = 'MANO_OBRA'
     order by v.orden_etapa, v.partida_id;
end;
$$;

revoke execute on function public.mo_partidas(bigint) from public, anon;
grant execute on function public.mo_partidas(bigint) to authenticated;
