-- El residente solo ve lo que llega a sus obras: órdenes pagadas (o ya en entrega / recibidas),
-- sus líneas, entregas y fotos. Nada de presupuesto, pagos, contabilidad ni solicitudes, y no
-- escribe en ninguna tabla (sus entregas pasan por registrar_entrega, que es security definer).
-- Las políticas son RESTRICTIVE: se suman (AND) a las existentes y solo afectan al residente.

create or replace function public.orden_visible_residente(p_obra bigint, p_numero text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ordenes_compra o
    where o.obra_id = p_obra
      and o.numero = p_numero
      and o.estado in ('PAGADA', 'EN_ENTREGA', 'RECIBIDA')
      and o.obra_id in (select public.obras_residente())
  )
$$;

revoke execute on function public.orden_visible_residente(bigint, text) from public, anon;
grant execute on function public.orden_visible_residente(bigint, text) to authenticated;

-- Escritura: ninguna tabla, salvo sus avisos, sus suscripciones push y las fotos (adjuntos,
-- que ya tienen su propia regla).
do $$
declare
  t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not in ('notificaciones', 'push_suscripciones', 'adjuntos')
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists residente_sin_insert on public.%I', t);
    execute format('drop policy if exists residente_sin_update on public.%I', t);
    execute format('drop policy if exists residente_sin_delete on public.%I', t);
    execute format(
      'create policy residente_sin_insert on public.%I as restrictive for insert to authenticated with check (not (select public.es_residente()))', t);
    execute format(
      'create policy residente_sin_update on public.%I as restrictive for update to authenticated using (not (select public.es_residente()))', t);
    execute format(
      'create policy residente_sin_delete on public.%I as restrictive for delete to authenticated using (not (select public.es_residente()))', t);
  end loop;
end
$$;

-- Lectura: nada de estas tablas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'adelantos', 'asiento_lineas', 'asientos', 'audit_log', 'comprobantes', 'comprobantes_historial',
    'cotizacion_accesos', 'cuentas_contables', 'datos_demo', 'guias', 'ordenes_pago', 'pago_aplicaciones',
    'pagos', 'personas', 'proveedor_contactos', 'proveedor_tipos_material', 'rechazos',
    'requerimientos_obra', 'requerimientos_obra_items', 'solicitudes', 'transportistas'
  ]
  loop
    execute format('drop policy if exists residente_sin_select on public.%I', t);
    execute format(
      'create policy residente_sin_select on public.%I as restrictive for select to authenticated using (not (select public.es_residente()))', t);
  end loop;
end
$$;

-- Lectura acotada: solo lo de sus órdenes visibles.
drop policy if exists residente_select on public.ordenes_compra;
create policy residente_select on public.ordenes_compra as restrictive for select to authenticated
  using (not (select public.es_residente()) or public.orden_visible_residente(obra_id, numero));

drop policy if exists residente_select on public.oc_items;
create policy residente_select on public.oc_items as restrictive for select to authenticated
  using (not (select public.es_residente()) or public.orden_visible_residente(obra_id, numero_oc));

drop policy if exists residente_select on public.entregas;
create policy residente_select on public.entregas as restrictive for select to authenticated
  using (not (select public.es_residente()) or public.orden_visible_residente(obra_id, numero_oc));

drop policy if exists residente_select on public.entrega_fotos;
create policy residente_select on public.entrega_fotos as restrictive for select to authenticated
  using (not (select public.es_residente()) or exists (select 1 from public.entregas e where e.id = entrega_id));

drop policy if exists residente_select on public.adjuntos;
create policy residente_select on public.adjuntos as restrictive for select to authenticated
  using (not (select public.es_residente()) or (tipo = 'FOTO' and public.orden_visible_residente(obra_id, numero_oc)));

-- Partidas: solo las de las líneas de sus órdenes (las vistas de órdenes las necesitan).
drop policy if exists residente_select on public.partidas;
create policy residente_select on public.partidas as restrictive for select to authenticated
  using (
    not (select public.es_residente())
    or exists (select 1 from public.oc_items i where i.partida_id = partidas.id)
  );

drop policy if exists residente_select on public.proveedores;
create policy residente_select on public.proveedores as restrictive for select to authenticated
  using (not (select public.es_residente()) or exists (select 1 from public.ordenes_compra o where o.proveedor_id = proveedores.id));

drop policy if exists residente_select on public.obras;
create policy residente_select on public.obras as restrictive for select to authenticated
  using (not (select public.es_residente()) or id in (select public.obras_residente()));

drop policy if exists residente_select on public.perfil_obras;
create policy residente_select on public.perfil_obras as restrictive for select to authenticated
  using (not (select public.es_residente()) or user_id = (select auth.uid()));

