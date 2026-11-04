-- Clasificación inicial de ítems por tipo de material.
-- Reglas por descripción (regex, sin distinguir mayúsculas). Se aplican en orden y solo a ítems sin tipo.
-- Lo que no encaja en ningún tipo queda NULL ("sin tipo") para reclasificar desde Logística.

set app.skip_audit = 'on';

-- ACERO: barras de construcción y alambre de amarre (solo materiales; la habilitación es mano de obra).
update items set tipo_material = 'ACERO'
where tipo_material is null and rubro = 'MATERIAL'
  and descripcion ~* '^(ACERO DE|ALAMBRE RECOCIDO)';

-- CEMENTO: cemento en bolsa y mortero premezclado.
update items set tipo_material = 'CEMENTO'
where tipo_material is null and rubro = 'MATERIAL'
  and descripcion ~* '^(CEMENTO|RAPIMIX)';

-- AGREGADOS: arenas, piedra, hormigón y material de préstamo.
update items set tipo_material = 'AGREGADOS'
where tipo_material is null and rubro = 'MATERIAL'
  and descripcion ~* '^(ARENA|HORMIGON|GRAVILLA|PIEDRA|MATERIAL DE PRESTAMO)';

-- SERVICIOS ELECTRICOS (antes que sanitarios: "ALAMBRE SOLIDO", "CURVA DE LUZ", "CAJAS DE PASO").
update items set tipo_material = 'SERVICIOS ELECTRICOS'
where tipo_material is null and (
  (rubro = 'MATERIAL' and descripcion ~* '(ELECTRIC|INTERRUPTOR|TOMACORRIENTE|SOCATE|TERMOMAGNETICA|TABLERO|CABLE|ALAMBRE SOLIDO|CINTA AISLANTE|CURVA DE LUZ|PVC SEL|CAJA OCTOGONAL|CAJA RECTANGULAR|CAJAS DE PASO|LUZ EMERGENCIA)')
  or (rubro <> 'MATERIAL' and descripcion ~* '(ELECTRIC|CABLEADO)')
);

-- SERVICIOS SANITARIOS: agua, desagüe, aparatos y griferías; y su instalación.
update items set tipo_material = 'SERVICIOS SANITARIOS'
where tipo_material is null and (
  (rubro = 'MATERIAL' and descripcion ~* '(PVC|GALV|UPR|SANITARI|DESAG|TRAMPA|SUMIDERO|REGISTRO DE|SOMBRERO DE VENTILACI|CUELLO DE CERA|INODORO|LAVATORIO|LAVAPLATOS|LAVAROPA|DUCHA|GRIFO|LLAVE DE PASO|LLAVE CUELLO|LLAVE CROMADA|TUBO DE ABASTO|UNION (UNIVERSAL|MIXTA|SIMPLE)|REDUCCI|ADAPTADOR|TAPON|NIPLE|VALVULA|MEDIDOR DE AGUA|TANQUE ELEVADO|FILTRO AGUA|ELECTROBOMBA|TEFLON|PERNOS ANCL PISO|ÑAS PARA LAVATORIO|NAS PARA LAVATORIO)')
  or (rubro <> 'MATERIAL' and descripcion ~* '(SANITARIA|DESAG|INODORO|DUCHA|LAVAMANOS|LAVAPLATOS|LAVARROPA|INSTALACION DE TANQUE|ELECTROBOMBA|CONEXI.N DOMICILIARIA)')
);

reset app.skip_audit;
