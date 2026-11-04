-- El destino del IGV va en el TXT del SIRE y debe coincidir con lo asentado: una vez contabilizada la factura
-- ya no se cambia (como el periodo de anotación).
create or replace function public.cambiar_destino_igv(p_comprobante_id bigint, p_destino text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform exigir_rol('CONTABILIDAD');
  if p_destino not in ('DGNG', 'DNG') then
    raise exception 'Destino inválido';
  end if;
  if exists (select 1 from asientos where comprobante_id = p_comprobante_id) then
    raise exception 'La factura ya está contabilizada';
  end if;
  update comprobantes set destino_igv = p_destino where id = p_comprobante_id and tipo = 'FACTURA' and igv > 0;
  if not found then
    raise exception 'Solo las facturas con IGV tienen destino';
  end if;
end;
$$;
