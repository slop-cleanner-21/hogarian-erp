-- Prod 1: la firma de los contratos es por empresa (un gerente puede firmar por varias, con un sello distinto en cada una). La sube
-- el gerente que firma por esa empresa (o el Admin); sin ella, la del gerente (perfil_privado). Solo la lee el servidor.
create table public.empresa_firmas (
  empresa_id bigint primary key references public.empresas (id) on delete cascade,
  path text not null constraint empresa_firmas_path_chk check (path like 'firmas/%' and position('..' in path) = 0),
  subida_por uuid references auth.users (id) on delete set null,
  subida_at timestamptz not null default now()
);
alter table public.empresa_firmas enable row level security;
revoke all on public.empresa_firmas from anon, authenticated;
create trigger audit_empresa_firmas after insert or delete or update on public.empresa_firmas
  for each row execute function public.fn_audit();
