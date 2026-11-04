-- Roles nuevos (archivo propio: un valor de enum no se usa en la misma transacción en que se agrega).
--   GERENCIA     crea obras, modifica presupuestos y aprueba solicitudes (de Obras y de RRHH).
--   OPERACIONES  arma el presupuesto, asigna residentes y vigila el avance de la obra.
--   OBRAS        ve el presupuesto de sus obras y pide adicionales o bajas de partidas.
--   RRHH         gestiona el catálogo de personas (altas, cambios y bajas con aprobación de Gerencia).
alter type public.rol add value if not exists 'GERENCIA';
alter type public.rol add value if not exists 'OPERACIONES';
alter type public.rol add value if not exists 'OBRAS';
alter type public.rol add value if not exists 'RRHH';
