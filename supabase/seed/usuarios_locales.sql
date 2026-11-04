-- Usuarios de prueba: SOLO desarrollo local (contraseña erp12345). No van a producción: allí el primer
-- Admin se crea con scripts/produccion/crear-admin.mjs y los demás los crea él desde la app (Usuarios).

-- ------------------------------------------------------------ usuarios locales (auth)
-- Carga inicial: sin auditoría (como excel.sql).
set app.skip_audit = 'on';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
)
select '00000000-0000-0000-0000-000000000000'::uuid, u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('erp12345', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nombre', u.nombre), now(), now(),
       '', '', '', '', ''
  from (values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'logistica@erp.local',    'Logística'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'contabilidad@erp.local', 'Contabilidad'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'tesoreria@erp.local',    'Tesorería'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'admin@erp.local',        'Administrador'),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'residente@erp.local',    'Residente'),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'gerencia@erp.local',     'Gerencia'),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'operaciones@erp.local',  'Ing. de Operaciones'),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'jefeoperaciones@erp.local', 'Jefe de Operaciones'),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'rrhh@erp.local',         'Recursos Humanos')
  ) as u(id, email, nombre)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.email in ('logistica@erp.local', 'contabilidad@erp.local', 'tesoreria@erp.local', 'admin@erp.local',
                   'residente@erp.local', 'gerencia@erp.local', 'operaciones@erp.local', 'jefeoperaciones@erp.local', 'rrhh@erp.local')
   and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

insert into public.perfiles (user_id, nombre, rol) values
  ('a0000000-0000-4000-8000-000000000001', 'Logística', 'LOGISTICA'),
  ('a0000000-0000-4000-8000-000000000002', 'Contabilidad', 'CONTABILIDAD'),
  ('a0000000-0000-4000-8000-000000000003', 'Tesorería', 'TESORERIA'),
  ('a0000000-0000-4000-8000-000000000004', 'Administrador', 'ADMIN'),
  ('a0000000-0000-4000-8000-000000000005', 'Residente', 'RESIDENTE'),
  ('a0000000-0000-4000-8000-000000000006', 'Gerencia', 'GERENCIA'),
  ('a0000000-0000-4000-8000-000000000007', 'Ing. de Operaciones', 'OPERACIONES'),
  ('a0000000-0000-4000-8000-000000000008', 'Jefe de Operaciones', 'JEFE_OPERACIONES'),
  ('a0000000-0000-4000-8000-000000000009', 'Recursos Humanos', 'RRHH')
on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol;

reset app.skip_audit;
