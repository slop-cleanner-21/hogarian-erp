-- Prod 1: estados financieros de Contabilidad (balance de comprobación, situación financiera y resultados). Salen de los
-- asientos de la app: sumas del Debe y del Haber por cuenta, de una empresa, entre dos fechas. Con los permisos de quien
-- consulta (security invoker): las líneas de los asientos solo las lee Contabilidad.
create or replace function public.sumas_cuentas(p_empresa_id bigint, p_desde date, p_hasta date)
returns table (cuenta text, denominacion text, debe numeric, haber numeric)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select l.cuenta, c.denominacion, coalesce(sum(l.debe), 0), coalesce(sum(l.haber), 0)
    from asiento_lineas l
    join asientos a on a.id = l.asiento_id
    left join cuentas_contables c on c.codigo = l.cuenta
   where a.empresa_id = p_empresa_id and a.fecha between p_desde and p_hasta
   group by l.cuenta, c.denominacion
   order by l.cuenta
$$;
revoke execute on function public.sumas_cuentas(bigint, date, date) from public, anon;
grant execute on function public.sumas_cuentas(bigint, date, date) to authenticated, service_role;

-- El rango de fechas con asientos de cada empresa (para elegir el ejercicio y el mes).
create or replace function public.rango_asientos(p_empresa_id bigint)
returns table (desde date, hasta date)
language sql stable security invoker set search_path = public, pg_temp
as $$ select min(fecha), max(fecha) from asientos where empresa_id = p_empresa_id $$;
revoke execute on function public.rango_asientos(bigint) from public, anon;
grant execute on function public.rango_asientos(bigint) to authenticated, service_role;
