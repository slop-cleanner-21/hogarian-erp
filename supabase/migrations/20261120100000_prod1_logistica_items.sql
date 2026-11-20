-- Prod 1: Logística también crea ítems del catálogo (antes solo Gerencia), con su cuenta contable opcional.
-- La tolerancia de sobreprecio la sigue poniendo solo Gerencia: un ítem de Logística nace con 0 (también por la API,
-- no solo en la pantalla). Para elegir la cuenta, Logística lee el plan de cuentas.

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (
    (select public.rol_actual()) in ('GERENCIA', 'ADMIN')
    or ((select public.rol_actual()) = 'LOGISTICA' and tolerancia_pct = 0)
  );

-- El plan de cuentas: Contabilidad, Gerencia y ahora Logística (rol_en deja pasar al Admin).
drop policy if exists lectura_por_rol on public.cuentas_contables;
create policy lectura_por_rol on public.cuentas_contables as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'GERENCIA', 'LOGISTICA')));
