-- Prod 1: la base trabaja en hora de Lima. Con UTC, `current_date` (la fecha de una orden, de un pago…)
-- pasaba al día siguiente desde las 7 p. m.: una OS emitida de noche salía con la fecha de mañana como fin de
-- su contrato. Las horas guardadas (timestamptz) no cambian; solo cómo se leen y qué día es «hoy».
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/Lima');
end;
$$;
set timezone to 'America/Lima';
