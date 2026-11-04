-- La guía de remisión la registra Contabilidad (la emite en SUNAT). Residentes y Logística ya no.

create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol::text from public.perfiles where user_id = auth.uid()
$$;

drop policy adjuntos_insert on public.adjuntos;
create policy adjuntos_insert on public.adjuntos for insert to authenticated
  with check (
    case
      when tipo = 'GUIA' then (select public.mi_rol()) in ('CONTABILIDAD', 'ADMIN')
      when (select public.es_residente()) then tipo = 'FOTO' and obra_id in (select public.obras_residente())
      else true
    end
  );

drop policy adjuntos_delete on public.adjuntos;
create policy adjuntos_delete on public.adjuntos for delete to authenticated
  using (
    case
      when tipo = 'GUIA' then (select public.mi_rol()) in ('CONTABILIDAD', 'ADMIN')
      when (select public.es_residente()) then tipo = 'FOTO' and created_by = auth.uid()
      else true
    end
  );

-- Tampoco se puede convertir otro adjunto en guía (ni tocar una guía) por UPDATE.
drop policy adjuntos_update on public.adjuntos;
create policy adjuntos_update on public.adjuntos for update to authenticated
  using (
    not (select public.es_residente())
    and (tipo <> 'GUIA' or (select public.mi_rol()) in ('CONTABILIDAD', 'ADMIN'))
  )
  with check (
    not (select public.es_residente())
    and (tipo <> 'GUIA' or (select public.mi_rol()) in ('CONTABILIDAD', 'ADMIN'))
  );
