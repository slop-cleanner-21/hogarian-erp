-- Prod 1: Gerencia agrega los adicionales de una obra directo (sin la solicitud de Operaciones del MVP).
-- Un adicional es un grupo de partidas con el mismo N° («ADIC n», el siguiente de la obra); puede repetir
-- un ítem y una etapa que ya tiene una partida regular. Logística lo ve al crear la orden (marcado como
-- adicional) y recibe un aviso.

CREATE OR REPLACE FUNCTION public.agregar_adicional(p_obra_id bigint, p_partidas jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_rol text := rol_actual();
  v_obra obras%rowtype;
  v_n int;
  v_req text;
  v_lineas int;
  v_tipo text;
begin
  if v_rol not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia agrega adicionales';
  end if;
  select * into v_obra from obras where id = p_obra_id for update;
  if not found then
    raise exception 'La obra no existe';
  end if;
  if v_obra.estado = 'CERRADA' then
    raise exception 'La obra está cerrada';
  end if;
  if v_obra.presupuesto_estado <> 'PUBLICADO' then
    raise exception 'Publica el presupuesto antes de agregar adicionales';
  end if;
  if p_partidas is null or jsonb_typeof(p_partidas) <> 'array' or jsonb_array_length(p_partidas) = 0 then
    raise exception 'El adicional necesita al menos una partida';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_partidas) x(etapa text, item_id bigint, cantidad numeric, pu numeric)
              where x.etapa is null or x.item_id is null or x.cantidad is null or x.cantidad <= 0 or x.pu is null or x.pu < 0
                 or not exists (select 1 from etapas e where e.codigo = x.etapa)
                 or not exists (select 1 from items i where i.id = x.item_id)) then
    raise exception 'Cada partida del adicional necesita etapa, ítem, cantidad y P.U. válidos';
  end if;

  -- El siguiente N° de adicional de la obra.
  select coalesce(max(substring(requerimiento from '^ADIC (\d+)$')::int), 0) + 1 into v_n
    from partidas where obra_id = p_obra_id;
  v_req := 'ADIC ' || v_n;
  insert into requerimientos (codigo, orden) values (v_req, v_n) on conflict (codigo) do nothing;

  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu)
  select p_obra_id, x.etapa, v_req, x.item_id, x.cantidad, x.pu
    from jsonb_to_recordset(p_partidas) x(etapa text, item_id bigint, cantidad numeric, pu numeric);
  get diagnostics v_lineas = row_count;

  -- El aviso abre la orden que corresponde: OC si hay material; si no (mano de obra, subcontrato), OS.
  v_tipo := case when exists (select 1 from jsonb_to_recordset(p_partidas) x(item_id bigint) join items i on i.id = x.item_id
                               where i.rubro = 'MATERIAL') then 'OC' else 'OS' end;
  perform notificar('LOGISTICA', 'ADICIONAL',
    format('Adicional %s en %s', v_n, v_obra.nombre),
    format('%s partida(s) nuevas para ordenar', v_lineas),
    format('/logistica/ordenes/nueva?tipo=%s&obra=%s', v_tipo, p_obra_id));
  return v_req;
end;
$function$;

revoke all on function public.agregar_adicional(bigint, jsonb) from public, anon;
grant execute on function public.agregar_adicional(bigint, jsonb) to authenticated;
