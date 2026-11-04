-- Prod 1: datos de cada empresa para los documentos (los edita el Admin en Admin › Empresas): razón social,
-- dirección fiscal y quién firma sus contratos. Sin firmante elegido, firma el gerente con la firma más
-- reciente (igual para todas). El RUC, de 11 dígitos (10, 15, 17 o 20 al inicio).

alter table public.empresas
  add column if not exists razon_social text,
  add column if not exists direccion text,
  add column if not exists firmante_id uuid references auth.users (id) on delete set null;
alter table public.empresas drop constraint if exists empresas_ruc_check;
alter table public.empresas add constraint empresas_ruc_check check (ruc is null or ruc ~ '^(10|15|17|20)\d{9}$');
comment on column public.empresas.razon_social is 'Razón social (va en contratos y documentos); nombre es el corto de la app';
comment on column public.empresas.firmante_id is 'Quién firma los contratos de la empresa (Gerencia); null: el gerente con la firma más reciente';
