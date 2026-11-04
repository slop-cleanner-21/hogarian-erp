-- Operaciones en dos niveles (29/10/2026): OPERACIONES queda como Ingeniero de Operaciones y se
-- agrega el Jefe de Operaciones. El rol OBRAS deja de usarse (un valor de enum no se borra).
alter type public.rol add value if not exists 'JEFE_OPERACIONES';
