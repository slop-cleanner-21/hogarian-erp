-- La verificación suelta (ingreso_valido) ya no la usa la app: todo ingreso pasa por ingreso_intentar, con sus topes
-- (se dejó una migración para que la versión anterior siguiera entrando mientras se desplegaba la nueva).
drop function if exists public.ingreso_valido(text, text);
