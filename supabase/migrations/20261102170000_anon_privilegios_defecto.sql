-- anon no tiene privilegios en public (20261102150000); que tampoco los reciban las secuencias y funciones
-- que se creen después como postgres. (Los privilegios por defecto de supabase_admin no se pueden cambiar
-- desde postgres: las tablas nuevas se crean siempre por migración, como postgres.)
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
revoke all on all sequences in schema public from anon;
