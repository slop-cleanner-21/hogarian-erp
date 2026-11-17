-- N° de las OC y OS: una sola serie por empresa (como la lleva Logística en Soluflex LO), no una por obra.
-- Con una serie por obra, cada obra seguía desde su mayor N° del Excel: dos obras de la misma empresa daban el mismo N° (OS
-- 100358 en dos obras de Ariant), chocaban con los N° que LO ya había dado a otras órdenes, y un error de tipeo del Excel
-- (1000139, 100669) sacaba a la obra de la serie. Ahora:
--  - `siguiente_numero_oc(obra)`: el siguiente de la serie de la empresa de la obra. La serie es la primera tirada de números
--    de 6 dígitos de la empresa (hasta el primer salto de más de 100: lo de después son errores de tipeo); se saltan los que ya
--    existan en la empresa (anuladas incluidas). Bloquea la serie de la empresa hasta el fin de la transacción: dos órdenes a la
--    vez no toman el mismo N°. Es la que muestra Nueva OC / OS (solo lo calcula, no lo gasta).
--  - Una orden nueva (no histórica) no puede repetir el N° de otra de su empresa (`fn_numero_unico_empresa`), también si
--    llega con su N° escrito. Las cargas (`app.skip_audit`) no se revisan: el Excel trae repetidos.
--  - Las órdenes nuevas que ya repetían el N° de otra de su empresa y que aún no salieron a nadie (sin contrato enviado ni
--    adjuntos, sin cotización enviada ni link abierto, sin pagos, guía, entregas, rechazos ni valorización) toman un N° nuevo de
--    la serie. Las que ya salieron (contrato firmado, PDF o pago) conservan el suyo: su contrato y su voucher lo citan.

create or replace function public.siguiente_numero_oc(p_obra_id bigint)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_emp bigint;
  v_n bigint;
begin
  select empresa_id into v_emp from obras where id = p_obra_id;
  if v_emp is null then
    return '100001';
  end if;
  -- Serializa la numeración de la empresa (se suelta al terminar la transacción que crea la orden).
  perform pg_advisory_xact_lock(hashtext('numero_orden'), v_emp::integer);
  with nums as (
    select distinct o.numero::bigint as n
      from ordenes_compra o join obras b on b.id = o.obra_id
     where b.empresa_id = v_emp and o.numero ~ '^\d{6}$'
  ), s as (
    select n, lead(n) over (order by n) as sig from nums
  )
  select min(n) into v_n from s where sig is null or sig - n > 100;
  v_n := coalesce(v_n, 100000) + 1;
  while exists (select 1 from ordenes_compra o join obras b on b.id = o.obra_id
                 where b.empresa_id = v_emp and o.numero = v_n::text) loop
    v_n := v_n + 1;
  end loop;
  return v_n::text;
end;
$$;
revoke execute on function public.siguiente_numero_oc(bigint) from public, anon;
grant execute on function public.siguiente_numero_oc(bigint) to authenticated, service_role;

create or replace function public.fn_numero_unico_empresa()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_emp bigint;
begin
  if new.historico or current_setting('app.skip_audit', true) = 'on' then
    return new;
  end if;
  select empresa_id into v_emp from obras where id = new.obra_id;
  perform pg_advisory_xact_lock(hashtext('numero_orden'), v_emp::integer);
  if exists (select 1 from ordenes_compra o join obras b on b.id = o.obra_id
              where b.empresa_id = v_emp and o.numero = new.numero
                and (o.obra_id, o.numero) is distinct from (new.obra_id, new.numero)) then
    raise exception 'Ya existe una orden N° % en la empresa', new.numero;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_numero_unico_empresa() from public, anon, authenticated;

drop trigger if exists numero_unico_empresa on public.ordenes_compra;
create trigger numero_unico_empresa before insert or update of numero, obra_id on public.ordenes_compra
  for each row execute function fn_numero_unico_empresa();

-- Órdenes nuevas con el N° repetido en su empresa que todavía no salieron a nadie: N° nuevo de la serie. De un par, la más
-- reciente. Los avisos que apuntaban a la orden pasan al N° nuevo.
create or replace function public.corregir_numeros_repetidos()
returns table (empresa_id bigint, obra_id bigint, tipo text, anterior text, nuevo text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  r record;
  v_nuevo text;
begin
  for r in
    select o.obra_id, o.numero, o.tipo, b.empresa_id
      from ordenes_compra o join obras b on b.id = o.obra_id
     where not o.historico and o.estado::text <> 'ANULADA'
       and o.contrato_enviado_at is null and o.cotizacion_enviada_at is null
       and exists (select 1 from ordenes_compra x join obras bx on bx.id = x.obra_id
                    where bx.empresa_id = b.empresa_id and x.numero = o.numero and x.obra_id <> o.obra_id
                      and (x.historico or x.created_at < o.created_at or x.estado::text = 'ANULADA'
                           or x.contrato_enviado_at is not null or x.cotizacion_enviada_at is not null))
       and not exists (select 1 from cotizacion_accesos a where a.obra_id = o.obra_id and a.numero = o.numero)
       and not exists (select 1 from adjuntos a where a.obra_id = o.obra_id and a.numero_oc = o.numero)
       and not exists (select 1 from pago_aplicaciones a where a.obra_id = o.obra_id and a.numero_oc = o.numero)
       and not exists (select 1 from guias g where g.obra_id = o.obra_id and g.numero_oc = o.numero)
       and not exists (select 1 from entregas e where e.obra_id = o.obra_id and e.numero_oc = o.numero)
       and not exists (select 1 from rechazos x where x.obra_id = o.obra_id and x.numero = o.numero)
       and not exists (select 1 from valorizaciones v where v.obra_id = o.obra_id and v.numero_oc = o.numero)
       and not exists (select 1 from ordenes_compra x where x.obra_id = o.obra_id and x.retenida_en = o.numero)
     order by o.created_at
  loop
    -- Si su par ya cambió de N° en esta misma vuelta, ya no está repetida.
    if not exists (select 1 from ordenes_compra x join obras bx on bx.id = x.obra_id
                    where bx.empresa_id = r.empresa_id and x.numero = r.numero and x.obra_id <> r.obra_id) then
      continue;
    end if;
    v_nuevo := siguiente_numero_oc(r.obra_id);
    update ordenes_compra set numero = v_nuevo where obra_id = r.obra_id and numero = r.numero;
    update notificaciones
       set href = regexp_replace(href, '/' || r.obra_id || '/' || r.numero || '(?=$|[/?#])', '/' || r.obra_id || '/' || v_nuevo)
     where href ~ ('/' || r.obra_id || '/' || r.numero || '($|[/?#])');
    empresa_id := r.empresa_id; obra_id := r.obra_id; tipo := r.tipo::text; anterior := r.numero; nuevo := v_nuevo;
    return next;
  end loop;
end;
$$;
revoke execute on function public.corregir_numeros_repetidos() from public, anon, authenticated;

-- Se corre una vez aquí; la lista de cambios queda en el registro de la migración.
do $$
declare
  r record;
begin
  for r in select * from corregir_numeros_repetidos() loop
    raise notice 'Empresa %: % % de la obra % pasa a ser la % %', r.empresa_id, r.tipo, r.anterior, r.obra_id, r.tipo, r.nuevo;
  end loop;
end $$;
