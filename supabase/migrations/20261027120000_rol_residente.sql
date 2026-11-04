-- Rol RESIDENTE (sube fotos de sus obras). Va en un archivo propio: un valor de enum nuevo
-- no se puede usar en la misma transacción en que se agrega.
alter type public.rol add value if not exists 'RESIDENTE';
