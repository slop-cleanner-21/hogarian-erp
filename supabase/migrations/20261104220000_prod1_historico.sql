-- Prod 1: marca formal de los datos históricos (los del Excel, que pueden estar incompletos) frente a los
-- normales (los que se generan en prod 1). La pone la carga del Excel (supabase/seed/prod1_historico.sql);
-- todo lo que se crea en la app nace normal (default false).
-- Los históricos son permisivos con los archivos: una OS histórica no necesita el contrato firmado ni una OC
-- histórica la guía para ir a Tesorería, y sus comprobantes y pagos pueden no tener archivo.

alter table public.ordenes_compra add column if not exists historico boolean not null default false;
alter table public.comprobantes add column if not exists historico boolean not null default false;
alter table public.pagos add column if not exists historico boolean not null default false;
comment on column public.ordenes_compra.historico is 'Cargada del Excel (dato histórico, puede estar incompleto); false = generada en la app';
comment on column public.comprobantes.historico is 'Cargado del Excel (dato histórico, puede no tener archivo)';
comment on column public.pagos.historico is 'Cargado del Excel (dato histórico, puede no tener voucher)';

-- enviar_a_tesoreria (del MVP): la OS histórica no exige el contrato firmado ni la OC histórica la guía.
do $$
declare
  v_def text := pg_get_functiondef('public.enviar_a_tesoreria(bigint, text)'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def,
    'if v_o.tipo = ''OS'' and not v_o.es_retencion and not exists (',
    'if v_o.tipo = ''OS'' and not v_o.es_retencion and not v_o.historico and not exists (');
  v_nueva := replace(v_nueva,
    'if v_o.tipo = ''OC'' and v_o.requiere_guia and not exists (',
    'if v_o.tipo = ''OC'' and v_o.requiere_guia and not v_o.historico and not exists (');
  if v_nueva = v_def or position('not v_o.historico' in v_nueva) = 0 then
    raise exception 'enviar_a_tesoreria: no se encontró dónde aplicar la marca de histórico';
  end if;
  execute v_nueva;
end;
$$;

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
  -- Las históricas no exigen contrato ni guía (pueden no tener archivos).
  if v_o.tipo = 'OS' and not v_o.es_retencion and not v_o.historico and not exists (
       select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero) then
    return false;
  end if;
  if v_o.tipo = 'OC' and v_o.requiere_guia and not v_o.historico and not exists (
       select 1 from guias where obra_id = p_obra_id and numero_oc = p_numero and estado in ('EMITIDA', 'ANULACION_PENDIENTE')) then
    return false;
  end if;
  perform enviar_a_tesoreria(p_obra_id, p_numero);
  return true;
end;
$$;
