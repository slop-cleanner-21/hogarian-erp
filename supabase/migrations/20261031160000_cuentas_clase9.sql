-- Denominación de las cuentas de clase 9 que usan los ítems, según el plan contable de la empresa
-- (Plan_Contable.xlsx de Contabilidad). La 912110102 no está en el plan: queda pendiente de
-- confirmar con Contabilidad.
update public.cuentas_contables c
   set denominacion = d.denominacion
  from (values
    ('911210501', 'ELIMINACIÓN DE DESMONTE'),
    ('911220118', 'FLETE DE OBRA'),
    ('911220317', 'CARPINTERÍA DE MADERA (INC. ACABADO)'),
    ('911220318', 'CARPINTERÍA METÁLICA'),
    ('911220320', 'VIDRIOS, CRISTALES Y SIMILARES'),
    ('911220321', 'PINTURA'),
    ('911220328', 'ALQUILER DE EQUIPO MAYOR'),
    ('911220329', 'VALORIZACIONES DE OBRA'),
    ('911220331', 'ACARREO DE MATERIALES'),
    ('911220332', 'CUADRILLA PARA VACIADO DE CONCRETO'),
    ('911220333', 'VIGUETA Y BOVEDILLA PRE-FABRICADA'),
    ('911220334', 'EXCAVACIÓN C/MAQUINARIA EN ZAPATAS'),
    ('911220335', 'HABILITACIÓN DE ACERO DE COLUMNAS'),
    ('911220336', 'HABILITACIÓN DE PARRILLA EN ZAPATAS'),
    ('911220411', 'SEGURIDAD DE OBRA'),
    ('911220424', 'ALQUILER DE EQUIPOS Y HERRAMIENTAS'),
    ('911910103', 'IMPLEMENTACIÓN SERV. DE LUZ Y AGUA'),
    ('912110101', 'AGREGADOS'),
    ('91211010101', 'MATERIA PRIMA PARA CONSTRUCCIÓN'),
    ('91220101', 'MATERIALES AUXILIAR')
  ) as d(codigo, denominacion)
 where c.codigo = d.codigo and c.denominacion = 'Sin denominación';
