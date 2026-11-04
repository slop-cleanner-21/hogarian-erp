-- Entrar y desbloquear con huella (passkeys / WebAuthn). Cada dispositivo que el usuario activa guarda su
-- credencial (la clave pública; la privada no sale del teléfono). Solo el servidor las lee y escribe (clave
-- secreta): sin políticas, ni anon ni authenticated ven nada.

create table public.huellas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,          -- base64url
  public_key text not null,                    -- base64url (COSE)
  counter bigint not null default 0,
  transports text[] not null default '{}',
  rp_id text not null,                          -- dominio en que se activó (la credencial solo vale ahí)
  dispositivo text,
  created_at timestamptz not null default now(),
  usada_at timestamptz
);
create index huellas_user_id_idx on public.huellas (user_id);
alter table public.huellas enable row level security;

-- Desafíos de un solo uso (5 minutos). user_id: el de la sesión al activar o desbloquear; null al entrar.
create table public.huella_desafios (
  id uuid primary key default gen_random_uuid(),
  challenge text not null,
  user_id uuid references auth.users (id) on delete cascade,
  expira_at timestamptz not null default now() + interval '5 minutes'
);
alter table public.huella_desafios enable row level security;

-- RLS sin políticas: nadie con su sesión ve ni escribe una fila (0 filas, como el resto de tablas cerradas).

-- Auditoría: activar y quitar una huella (cada uso ya queda como inicio de sesión o desbloqueo).
create trigger audit_huellas after insert or delete on public.huellas
  for each row execute function public.fn_audit();
