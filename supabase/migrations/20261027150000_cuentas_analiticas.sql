-- Las cuentas de costo de obra (clase 9) del plan de la empresa llegan a 11 dígitos.
alter table public.cuentas_contables drop constraint cuentas_contables_codigo_check;
alter table public.cuentas_contables add constraint cuentas_contables_codigo_check check (codigo ~ '^\d{2,12}$');
