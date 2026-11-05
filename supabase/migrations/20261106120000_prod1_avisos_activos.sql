-- Los avisos van solo a las cuentas activas: una desactivada (baneada) no entra a verlos (06/11/2026).
create or replace function public.notificar(p_rol text, p_tipo text, p_titulo text, p_cuerpo text, p_href text)
  returns void language sql security definer set search_path = public, pg_temp
as $$
  insert into notificaciones (user_id, tipo, titulo, cuerpo, href)
  select p.user_id, p_tipo, p_titulo, nullif(btrim(coalesce(p_cuerpo, '')), ''), p_href
    from perfiles p join auth.users u on u.id = p.user_id
   where p.rol::text = p_rol and (u.banned_until is null or u.banned_until <= now()) and u.deleted_at is null;
$$;
