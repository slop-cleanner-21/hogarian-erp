-- Obras asignadas a residentes (solo desarrollo local). Va después de excel.sql, que crea las obras.
insert into public.perfil_obras (user_id, obra_id)
select 'a0000000-0000-4000-8000-000000000005'::uuid, o.id
  from public.obras o
 where o.nombre in ('RAYMONDI', 'ADOLFO KING')
on conflict do nothing;
