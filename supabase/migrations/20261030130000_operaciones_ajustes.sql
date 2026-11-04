-- Seguimiento: lo pagado deja de contarse en Tesorería y pasa a «Pagado» (por llegar), junto con
-- lo que está en entrega. Así cada partida se lee por estado: por pedir, pedido, por pagar,
-- pagado y recibido.
create or replace view public.v_seguimiento_partida with (security_invoker = true) as
 WITH lineas AS (
         SELECT l.partida_id,
            l.cantidad,
            o.estado,
            o.entrega_cerrada_at,
            COALESCE(( SELECT sum(en.cantidad) AS sum
                   FROM entregas en
                  WHERE (en.oc_item_id = l.id)), (0)::numeric) AS entregado
           FROM (oc_items l
             JOIN ordenes_compra o ON (((o.obra_id = l.obra_id) AND (o.numero = l.numero_oc))))
          WHERE (o.estado <> ALL (ARRAY['ANULADA'::estado_oc, 'BORRADOR'::estado_oc]))
        ), x AS (
         SELECT lineas.partida_id,
            sum(
                CASE
                    WHEN (lineas.estado = ANY (ARRAY['EMITIDA'::estado_oc, 'PRECIOS_CONFIRMADOS'::estado_oc, 'FACTURADA'::estado_oc])) THEN lineas.cantidad
                    ELSE (0)::numeric
                END) AS en_logistica,
            sum(
                CASE
                    WHEN (lineas.estado = 'EN_TESORERIA'::estado_oc) THEN lineas.cantidad
                    ELSE (0)::numeric
                END) AS en_tesoreria,
            sum(
                CASE
                    WHEN ((lineas.estado = ANY (ARRAY['PAGADA'::estado_oc, 'EN_ENTREGA'::estado_oc, 'RECIBIDA'::estado_oc])) AND (lineas.entrega_cerrada_at IS NULL)) THEN GREATEST((lineas.cantidad - lineas.entregado), (0)::numeric)
                    ELSE (0)::numeric
                END) AS por_recibir,
            sum(lineas.entregado) AS recibido
           FROM lineas
          GROUP BY lineas.partida_id
        )
 SELECT p.id AS partida_id,
    p.obra_id,
    p.etapa,
    p.requerimiento,
    p.item_id,
    i.descripcion,
    i.unidad,
    i.rubro,
        CASE
            WHEN (i.rubro = 'MATERIAL'::rubro) THEN 'MATERIALES'::text
            WHEN (i.rubro = 'MANO OBRA'::rubro) THEN 'MANO_OBRA'::text
            ELSE 'SUBCONTRATOS'::text
        END AS grupo,
    p.cantidad AS presupuestado,
    p.pu,
    COALESCE(x.en_logistica, (0)::numeric) AS en_logistica,
    COALESCE(x.en_tesoreria, (0)::numeric) AS en_tesoreria,
    COALESCE(x.por_recibir, (0)::numeric) AS por_recibir,
    COALESCE(x.recibido, (0)::numeric) AS recibido,
    GREATEST(((((ef.efectivo - COALESCE(x.en_logistica, (0)::numeric)) - COALESCE(x.en_tesoreria, (0)::numeric)) - COALESCE(x.por_recibir, (0)::numeric)) - COALESCE(x.recibido, (0)::numeric)), (0)::numeric) AS por_pedir,
    ef.efectivo AS presupuesto_efectivo,
    ef.recibido AS adelanto_recibido,
    ef.dado AS adelanto_dado,
    COALESCE(( SELECT sum(ri.cantidad) AS sum
           FROM (requerimientos_obra_items ri
             JOIN requerimientos_obra rq ON ((rq.id = ri.requerimiento_id)))
          WHERE ((ri.partida_id = p.id) AND (rq.estado = 'VIGENTE'::text))), (0)::numeric) AS requerido,
    fn_orden_etapa(p.obra_id, p.etapa) AS orden_etapa
   FROM (((partidas p
     JOIN items i ON ((i.id = p.item_id)))
     JOIN v_presupuesto_efectivo ef ON ((ef.partida_id = p.id)))
     LEFT JOIN x ON ((x.partida_id = p.id)))
  WHERE (p.dada_de_baja_at IS NULL);

-- Un residente no se quita sin reemplazo: se usa reemplazar_residente.
CREATE OR REPLACE FUNCTION public.asignar_persona_obra(p_obra_id bigint, p_persona_id bigint, p_asignar boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p personas%rowtype;
begin
  if rol_actual() not in ('JEFE_OPERACIONES', 'GERENCIA', 'ADMIN') then
    raise exception 'Solo Operaciones asigna personas a las obras';
  end if;
  select * into v_p from personas where id = p_persona_id;
  if not found then
    raise exception 'La persona no existe';
  end if;
  if v_p.user_id is null then
    raise exception 'La persona no tiene usuario de acceso';
  end if;
  if p_asignar then
    if v_p.estado <> 'ACTIVA' then
      raise exception 'Solo se asignan personas aprobadas por Gerencia';
    end if;
    insert into perfil_obras (user_id, obra_id) values (v_p.user_id, p_obra_id) on conflict do nothing;
  else
    if v_p.cargo = 'RESIDENTE' then
      raise exception 'Para quitar a un residente elige quién lo reemplaza';
    end if;
    delete from perfil_obras where user_id = v_p.user_id and obra_id = p_obra_id;
  end if;
end;
$function$;

create or replace function public.reemplazar_residente(p_obra_id bigint, p_sale bigint, p_entra bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sale personas%rowtype;
  v_entra personas%rowtype;
begin
  if rol_actual() not in ('JEFE_OPERACIONES', 'GERENCIA', 'ADMIN') then
    raise exception 'Solo Operaciones asigna personas a las obras';
  end if;
  if p_sale = p_entra then
    raise exception 'Elige a otro residente';
  end if;
  select * into v_sale from personas where id = p_sale;
  select * into v_entra from personas where id = p_entra;
  if v_sale.id is null or v_entra.id is null then
    raise exception 'La persona no existe';
  end if;
  if v_entra.cargo <> 'RESIDENTE' or v_entra.estado <> 'ACTIVA' or v_entra.user_id is null then
    raise exception 'El reemplazo debe ser un residente aprobado y con usuario';
  end if;
  insert into perfil_obras (user_id, obra_id) values (v_entra.user_id, p_obra_id) on conflict do nothing;
  delete from perfil_obras where user_id = v_sale.user_id and obra_id = p_obra_id;
end;
$$;

revoke execute on function public.reemplazar_residente(bigint, bigint, bigint) from public, anon;
grant execute on function public.reemplazar_residente(bigint, bigint, bigint) to authenticated;
