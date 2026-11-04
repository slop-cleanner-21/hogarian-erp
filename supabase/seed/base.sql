-- Seed base (versionado): plan contable mínimo PCGE y catálogos estáticos. Va también a producción.
-- Los usuarios de prueba están aparte, en usuarios_locales.sql (solo desarrollo local).

-- ------------------------------------------------------------ plan contable (PCGE, mínimo)
-- Carga inicial: sin auditoría (como excel.sql).
set app.skip_audit = 'on';

insert into public.cuentas_contables (codigo, denominacion, tipo) values
  ('1011',  'Caja', 'ACTIVO'),
  ('1041',  'Cuentas corrientes operativas', 'ACTIVO'),
  ('40111', 'IGV - Cuenta propia', 'PASIVO'),
  ('40172', 'Renta de cuarta categoría', 'PASIVO'),
  ('4212',  'Facturas, boletas y otros comprobantes por pagar - Emitidas', 'PASIVO'),
  ('4222',  'Anticipos a proveedores', 'ACTIVO'),
  ('4241',  'Honorarios por pagar', 'PASIVO'),
  ('6011',  'Mercaderías manufacturadas', 'GASTO'),
  ('6021',  'Materias primas para productos manufacturados', 'GASTO'),
  ('6031',  'Materiales auxiliares', 'GASTO'),
  ('6032',  'Suministros', 'GASTO'),
  ('6033',  'Repuestos', 'GASTO'),
  ('6041',  'Envases', 'GASTO'),
  ('6211',  'Sueldos y salarios', 'GASTO'),
  ('6311',  'Transporte', 'GASTO'),
  ('6321',  'Asesoría y consultoría - Administrativa', 'GASTO'),
  ('6322',  'Asesoría y consultoría - Legal y tributaria', 'GASTO'),
  ('6323',  'Asesoría y consultoría - Auditoría y contable', 'GASTO'),
  ('6327',  'Asesoría y consultoría - Producción', 'GASTO'),
  ('6329',  'Asesoría y consultoría - Otros', 'GASTO'),
  ('6343',  'Mantenimiento y reparaciones - Inmuebles, maquinaria y equipo', 'GASTO'),
  ('6352',  'Alquileres - Edificaciones', 'GASTO'),
  ('6353',  'Alquileres - Maquinarias y equipos de explotación', 'GASTO'),
  ('6361',  'Servicios básicos - Energía eléctrica', 'GASTO'),
  ('6363',  'Servicios básicos - Agua', 'GASTO'),
  ('639',   'Otros servicios prestados por terceros', 'GASTO')
on conflict (codigo) do update set denominacion = excluded.denominacion, tipo = excluded.tipo;

-- ------------------------------------------------------------ catálogos (hoja L del Excel)
insert into public.etapas (codigo, grupo, orden) values
  ('L0', 'L', 1), ('L1A', 'L', 2), ('L1B', 'L', 3), ('L2A', 'L', 4), ('L2B', 'L', 5), ('L3A', 'L', 6),
  ('L3B', 'L', 7), ('L4A', 'L', 8), ('L4B', 'L', 9), ('L5A', 'L', 10), ('L5B', 'L', 11),
  ('ACB 1', 'ACB', 12), ('ACB 2', 'ACB', 13), ('ACB 3', 'ACB', 14), ('ACB 4', 'ACB', 15), ('ACB 5', 'ACB', 16),
  ('IE 1', 'IE', 17), ('IE 2', 'IE', 18), ('IE 3', 'IE', 19), ('IE 4', 'IE', 20), ('IE 5', 'IE', 21),
  ('IS 1', 'IS', 22), ('IS 2', 'IS', 23), ('IS 3', 'IS', 24), ('IS 4', 'IS', 25), ('IS 5', 'IS', 26)
on conflict (codigo) do nothing;

insert into public.requerimientos (codigo, orden)
select 'REGULAR', 0
union all
select 'ADIC ' || n, n from generate_series(1, 25) n
on conflict (codigo) do nothing;

reset app.skip_audit;
