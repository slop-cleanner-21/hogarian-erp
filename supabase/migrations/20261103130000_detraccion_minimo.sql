-- Mínimo de la detracción (SPOT): solo se propone si el total de la factura lo supera. Lo fija Gerencia
-- (S/ 700 por defecto). Tabla de parámetros de una sola fila.

create table if not exists public.parametros (
  id boolean primary key default true check (id),
  detraccion_minimo numeric(14, 2) not null default 700 check (detraccion_minimo >= 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
insert into public.parametros (id) values (true) on conflict do nothing;

alter table public.parametros enable row level security;
revoke all on public.parametros from anon, authenticated;
grant select on public.parametros to authenticated;
create policy parametros_select on public.parametros for select to authenticated using (true);
create policy con_perfil on public.parametros as restrictive for all to authenticated
  using ((select public.rol_actual()) <> '') with check ((select public.rol_actual()) <> '');

create or replace function public.guardar_detraccion_minimo(p_monto numeric)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform exigir_rol('GERENCIA');
  if p_monto is null or p_monto < 0 then
    raise exception 'El mínimo debe ser cero o más';
  end if;
  update parametros set detraccion_minimo = round(p_monto, 2), updated_by = auth.uid(), updated_at = now() where id;
end;
$$;
revoke execute on function public.guardar_detraccion_minimo(numeric) from public, anon;
grant execute on function public.guardar_detraccion_minimo(numeric) to authenticated;

-- La detracción que corresponde por sus líneas, solo si el total supera el mínimo.
create or replace function public.fn_detraccion_sugerida(p_comprobante_id bigint)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when c.tipo <> 'FACTURA' or c.total <= (select detraccion_minimo from parametros) then 0 else
    coalesce(round(c.total * sum(coalesce(l.parcial, 0) * coalesce(d.porcentaje, 0) / 100) / nullif(sum(coalesce(l.parcial, 0)), 0), 2), 0)
  end
    from comprobantes c
    left join v_oc_items_calc l on l.comprobante_id = c.id
    left join detracciones d on d.obra_id = l.obra_id and d.item_id = l.item_id
   where c.id = p_comprobante_id
   group by c.id, c.tipo, c.total
$$;
