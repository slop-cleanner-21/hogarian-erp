-- Prod 1: Contabilidad entra con dos roles iguales, como Operaciones: el Jefe (CONTABILIDAD) y el Asistente de Contabilidad.
-- El valor nuevo va solo en esta migración (un valor de enum nuevo no se puede usar en la misma transacción).
alter type public.rol add value if not exists 'ASISTENTE_CONTABILIDAD';
