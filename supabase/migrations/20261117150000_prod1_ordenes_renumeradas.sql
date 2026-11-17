-- Los links viejos de una orden que cambió de N° (prod1_numeracion_empresa) siguen llevando a ella. Un link compartido por
-- WhatsApp antes del cambio («/tesoreria/pago/<obra>/100361») daba 404: ahora la página busca el N° nuevo aquí y redirige.

create table public.ordenes_renumeradas (
  obra_id       bigint not null references public.obras (id),
  anterior      text not null,
  nuevo         text not null,
  renumerada_at timestamptz not null default now(),
  primary key (obra_id, anterior)
);
alter table public.ordenes_renumeradas enable row level security;
-- Solo números de orden: lo lee quien tenga un rol (cada pantalla vuelve a revisar si puede ver la orden).
create policy ordenes_renumeradas_select on public.ordenes_renumeradas for select to authenticated
  using ((select rol_actual()) <> '');
revoke all on public.ordenes_renumeradas from anon, authenticated;
grant select on public.ordenes_renumeradas to authenticated;
create trigger audit_ordenes_renumeradas after insert or delete or update on public.ordenes_renumeradas
  for each row execute function fn_audit();

-- Las tres que cambiaron de N° el 17/11/2026 (solo si están así: en otra base no hace nada).
insert into public.ordenes_renumeradas (obra_id, anterior, nuevo, renumerada_at)
select b.id, x.anterior, x.nuevo, '2026-11-17 14:45-05'
  from (values ('INDEPENDENCIA', '100326', '100367'), ('MERCEDES B', '100697', '100712'), ('RAYMONDI', '100361', '100368'))
       as x (obra, anterior, nuevo)
  join public.obras b on b.nombre = x.obra
 where exists (select 1 from public.ordenes_compra o where o.obra_id = b.id and o.numero = x.nuevo and not o.historico)
   and not exists (select 1 from public.ordenes_compra o where o.obra_id = b.id and o.numero = x.anterior)
on conflict do nothing;

-- Desde ahora, toda orden que cambie de N° deja su rastro (una cadena de cambios apunta siempre al último).
create or replace function public.fn_orden_renumerada()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.numero is distinct from old.numero and new.obra_id = old.obra_id then
    update ordenes_renumeradas set nuevo = new.numero where obra_id = old.obra_id and nuevo = old.numero;
    insert into ordenes_renumeradas (obra_id, anterior, nuevo) values (old.obra_id, old.numero, new.numero)
    on conflict (obra_id, anterior) do update set nuevo = excluded.nuevo, renumerada_at = now();
    delete from ordenes_renumeradas where obra_id = new.obra_id and anterior = new.numero;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_orden_renumerada() from public, anon, authenticated;
create trigger orden_renumerada after update of numero on public.ordenes_compra
  for each row execute function fn_orden_renumerada();
