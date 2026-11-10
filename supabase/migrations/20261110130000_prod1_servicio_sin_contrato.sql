-- Prod 1: servicios que no llevan contrato (p. ej. un alquiler de winche por horas).
-- Logística marca el servicio (ítem) como «Sin contrato», desde su catálogo o al crear la OS. Una OS cuyos
-- servicios son todos «sin contrato» va a Tesorería sin contrato firmado; si alguno lo lleva, sigue pidiéndolo.

alter table public.items add column if not exists sin_contrato boolean not null default false;

-- Logística (policy items_update) cambia solo el tipo de material y esta marca.
grant update (tipo_material, sin_contrato) on public.items to authenticated;

-- ¿La OS lleva contrato? Sí, salvo que todos sus servicios estén marcados «sin contrato».
-- Sin líneas (no debería pasar) la respuesta es sí: nunca se salta el contrato por falta de datos.
create or replace function public.os_lleva_contrato(p_obra_id bigint, p_numero text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from oc_items l where l.obra_id = p_obra_id and l.numero_oc = p_numero)
      or exists (
        select 1
          from oc_items l
          join partidas p on p.id = l.partida_id
          join items i on i.id = p.item_id
         where l.obra_id = p_obra_id and l.numero_oc = p_numero and not i.sin_contrato);
$$;
revoke all on function public.os_lleva_contrato(bigint, text) from public, anon, authenticated;

-- Enviar a Tesorería (a mano o solo) ya no pide el contrato si la OS no lo lleva.
do $$
declare
  f text;
  def text;
  nuevo text;
begin
  foreach f in array array['public.enviar_a_tesoreria(bigint, text)', 'public.enviar_si_lista(bigint, text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    nuevo := replace(def,
      $x$v_o.tipo = 'OS' and not v_o.historico and not exists ($x$,
      $x$v_o.tipo = 'OS' and not v_o.historico and os_lleva_contrato(p_obra_id, p_numero) and not exists ($x$);
    if nuevo = def then
      raise exception 'No se encontró la condición del contrato en %', f;
    end if;
    execute nuevo;
  end loop;

  -- El link del proveedor no le muestra un contrato para firmar.
  def := pg_get_functiondef('public.get_cotizacion(uuid)'::regprocedure);
  nuevo := replace(def,
    $x$'contrato', case when v_orden and v_o.tipo = 'OS' and v_o.valorizacion_id is null then$x$,
    $x$'contrato', case when v_orden and v_o.tipo = 'OS' and v_o.valorizacion_id is null and os_lleva_contrato(v_o.obra_id, v_o.numero) then$x$);
  if nuevo = def then
    raise exception 'No se encontró el contrato en get_cotizacion';
  end if;
  execute nuevo;
end $$;
