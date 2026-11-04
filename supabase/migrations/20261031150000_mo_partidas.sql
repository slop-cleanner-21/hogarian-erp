-- Partidas de mano de obra de una obra con su avance. Para el residente, leer la vista de
-- seguimiento con sus políticas restrictivas fila por fila es muy lento: esta función valida que
-- la obra sea suya y lee la vista como su dueño.
create or replace function public.mo_partidas(p_obra_id bigint)
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
  retencion_acumulada numeric
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
           v.ejecutado_sin_valorizar, v.valorizado_sin_pagar, v.valorizado_pagado, v.retencion_acumulada
      from v_seguimiento_partida v
     where v.obra_id = p_obra_id and v.grupo = 'MANO_OBRA'
     order by v.orden_etapa, v.partida_id;
end;
$$;

revoke execute on function public.mo_partidas(bigint) from public, anon;
grant execute on function public.mo_partidas(bigint) to authenticated;
