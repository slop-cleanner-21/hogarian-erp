-- Prod 1: los ítems los crea Gerencia (ya no Logística). Al crearlo puede indicar, si quiere, la cuenta
-- contable del ítem (la del asiento de compra), así que lee el plan de cuentas. Logística sigue
-- clasificando el tipo de material (actualizar ítems no cambia).

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check ((select rol_actual()) in ('GERENCIA', 'ADMIN'));

drop policy if exists lectura_por_rol on public.cuentas_contables;
create policy lectura_por_rol on public.cuentas_contables as restrictive for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'GERENCIA')));
