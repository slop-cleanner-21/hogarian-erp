-- Prod 1: el contrato firmado de una OS no puede ser el mismo archivo que su factura o recibo (pasó en las OS 1000148 y
-- 1000149: se subió el comprobante como contrato y la orden se fue sola a Tesorería). La app ya lo revisaba, pero un
-- pedido desde una versión anterior de la app (abierta desde antes de un despliegue) no pasaba por esa revisión: ahora
-- la hace la base. El almacenamiento guarda de cada archivo su MD5 (eTag) y su tamaño: si los dos coinciden con los de
-- un comprobante de la orden, es el mismo archivo.

create or replace function public.fn_contrato_no_comprobante()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_etag text;
  v_size text;
  v_comp text;
begin
  if new.tipo <> 'CONTRATO' then
    return new;
  end if;
  select o.metadata ->> 'eTag', o.metadata ->> 'size' into v_etag, v_size
    from storage.objects o where o.bucket_id = 'documentos' and o.name = new.path;
  if v_etag is null then
    return new;
  end if;
  select c.serie || '-' || c.numero into v_comp
    from comprobantes c
    join storage.objects o on o.bucket_id = 'comprobantes' and o.name = c.archivo_path
   where c.id in (select l.comprobante_id from oc_items l where l.obra_id = new.obra_id and l.numero_oc = new.numero_oc)
     and o.metadata ->> 'eTag' = v_etag and o.metadata ->> 'size' = v_size
   limit 1;
  if v_comp is not null then
    raise exception 'Ese archivo es el comprobante % de la orden, no el contrato: sube el contrato firmado', v_comp;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_contrato_no_comprobante() from public, anon, authenticated;

drop trigger if exists adjuntos_contrato_no_comprobante on public.adjuntos;
create trigger adjuntos_contrato_no_comprobante
  before insert or update of path, tipo on public.adjuntos
  for each row execute function public.fn_contrato_no_comprobante();

-- Al revés (primero el archivo como contrato y después el mismo como comprobante): al enviar a Tesorería solo cuenta un
-- contrato que no sea un comprobante de la orden.
create or replace function public.os_contrato_valido(p_obra_id bigint, p_numero text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1
      from adjuntos a
      left join storage.objects oa on oa.bucket_id = 'documentos' and oa.name = a.path
     where a.tipo = 'CONTRATO' and a.obra_id = p_obra_id and a.numero_oc = p_numero
       and not exists (
         select 1
           from comprobantes c
           join storage.objects oc on oc.bucket_id = 'comprobantes' and oc.name = c.archivo_path
          where c.id in (select l.comprobante_id from oc_items l where l.obra_id = p_obra_id and l.numero_oc = p_numero)
            and oa.metadata ->> 'eTag' is not null
            and oc.metadata ->> 'eTag' = oa.metadata ->> 'eTag' and oc.metadata ->> 'size' = oa.metadata ->> 'size'));
$$;
revoke all on function public.os_contrato_valido(bigint, text) from public, anon, authenticated;

do $$
declare
  f text;
  def text;
  nuevo text;
begin
  foreach f in array array['public.enviar_a_tesoreria(bigint, text)', 'public.enviar_si_lista(bigint, text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    nuevo := regexp_replace(def,
      $x$not exists \(\s*select 1 from adjuntos where tipo = 'CONTRATO' and obra_id = p_obra_id and numero_oc = p_numero\)$x$,
      'not os_contrato_valido(p_obra_id, p_numero)');
    if nuevo = def then
      raise exception 'No se encontró la condición del contrato en %', f;
    end if;
    execute nuevo;
  end loop;
end $$;
