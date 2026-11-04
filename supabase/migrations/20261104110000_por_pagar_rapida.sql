-- v_por_pagar lenta con RLS: con las políticas, Postgres estima mal las filas y vuelve a agrupar las líneas
-- (lin) y los comprobantes (cp) de todas las órdenes por cada orden (~0,9 s por consulta para Tesorería, que
-- en Pagos hace dos). Con las dos CTE materializadas se calculan una sola vez (~40 ms); el resultado es el
-- mismo. Se parchea la definición vigente, como en proveedor_cuentas, para no repetirla entera.
do $$
declare
  d text := pg_get_viewdef('public.v_por_pagar'::regclass, true);
  n text;
begin
  n := replace(replace(d, 'WITH lin AS (', 'WITH lin AS MATERIALIZED ('), '), cp AS (', '), cp AS MATERIALIZED (');
  if n = d or position('lin AS MATERIALIZED' in n) = 0 or position('cp AS MATERIALIZED' in n) = 0 then
    raise exception 'v_por_pagar: no se encontraron las CTE lin y cp';
  end if;
  execute 'create or replace view public.v_por_pagar with (security_invoker = on) as ' || n;
end
$$;
