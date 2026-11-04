-- Retenciones de mano de obra: por obra e ítem (un mismo ítem puede tener otra retención en otra
-- obra). Se descuentan al valorizar y se pagan juntas en una última OS al cerrar la obra. Sin fila,
-- la retención es 5 %.
create table if not exists public.retenciones (
  obra_id bigint not null references public.obras (id) on delete cascade,
  item_id bigint not null references public.items (id),
  porcentaje numeric(5, 2) not null default 5 check (porcentaje >= 0 and porcentaje < 100),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (obra_id, item_id)
);

alter table public.retenciones enable row level security;
revoke all on public.retenciones from anon, authenticated;
grant select on public.retenciones to authenticated;
drop policy if exists retenciones_select on public.retenciones;
create policy retenciones_select on public.retenciones for select to authenticated
  using (not (select public.es_residente()));

-- Retención vigente de un ítem en una obra (5 % por defecto).
create or replace function public.fn_retencion(p_obra_id bigint, p_item_id bigint)
returns numeric
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select porcentaje from public.retenciones where obra_id = p_obra_id and item_id = p_item_id), 5)
$$;

grant execute on function public.fn_retencion(bigint, bigint) to authenticated;

-- Gerencia fija la retención de cada ítem de mano de obra de la obra.
create or replace function public.guardar_retenciones(p_obra_id bigint, p_retenciones jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_n integer := 0;
begin
  if rol_actual() not in ('GERENCIA', 'ADMIN') then
    raise exception 'Solo Gerencia fija las retenciones';
  end if;
  for r in select * from jsonb_to_recordset(coalesce(p_retenciones, '[]'::jsonb)) x(item_id bigint, porcentaje numeric) loop
    if r.porcentaje is null or r.porcentaje < 0 or r.porcentaje >= 100 then
      raise exception 'La retención debe estar entre 0 y 99.99 %%';
    end if;
    if not exists (
      select 1 from partidas p join items i on i.id = p.item_id
       where p.obra_id = p_obra_id and p.item_id = r.item_id and i.rubro = 'MANO OBRA'
    ) then
      raise exception 'Solo se retiene a ítems de mano de obra de la obra';
    end if;
    insert into retenciones (obra_id, item_id, porcentaje) values (p_obra_id, r.item_id, r.porcentaje)
    on conflict (obra_id, item_id) do update set porcentaje = excluded.porcentaje, updated_by = auth.uid(), updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.guardar_retenciones(bigint, jsonb) from public, anon;
grant execute on function public.guardar_retenciones(bigint, jsonb) to authenticated;
