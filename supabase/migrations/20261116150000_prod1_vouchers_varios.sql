-- Tesorería sube uno o más archivos del pago (el voucher en varias fotos, o la constancia y el voucher). La pantalla ya muestra
-- todos los adjuntos VOUCHER de un pago; pagar_documento registraba solo uno. Ahora recibe los demás en `p_vouchers_extra`
-- ([{path, nombre}], hasta 9 más), en la misma transacción que el pago: o se registran todos o ninguno.
-- Se parchea la definición vigente (que ya trae los cambios de prod 1) y se cambia la firma: la vieja se elimina para que una
-- llamada con 9 argumentos no sea ambigua entre dos funciones.

do $$
declare
  vieja constant text := 'public.pagar_documento(bigint,text,bigint,date,text,text,numeric,text,text)';
  d text := pg_get_functiondef(vieja::regprocedure);
  antes text;
begin
  antes := d;
  d := replace(d, 'p_voucher_nombre text)', 'p_voucher_nombre text, p_vouchers_extra jsonb DEFAULT ''[]''::jsonb)');
  if d = antes then
    raise exception 'pagar_documento: no se encontró la firma';
  end if;

  -- Los extra: se revisan antes de registrar el pago (en su carpeta, existentes, no repetidos, hasta 9).
  antes := d;
  d := replace(d, $a$  if exists (select 1 from adjuntos where path = v_path) then
    raise exception 'El archivo % ya está registrado', v_path;
  end if;$a$, $b$  if exists (select 1 from adjuntos where path = v_path) then
    raise exception 'El archivo % ya está registrado', v_path;
  end if;
  if jsonb_typeof(coalesce(p_vouchers_extra, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_vouchers_extra, '[]'::jsonb)) > 9 then
    raise exception 'Hasta 10 archivos del pago';
  end if;
  for r in select x.path from jsonb_to_recordset(coalesce(p_vouchers_extra, '[]'::jsonb)) as x(path text, nombre text) loop
    -- En la misma carpeta que el primero (la del pago de esta orden) y ya subido: nadie enlaza un archivo ajeno.
    if nullif(btrim(r.path), '') is null or r.path like '%..%'
       or regexp_replace(r.path, '/[^/]*$', '') <> regexp_replace(v_path, '/[^/]*$', '')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = r.path) then
      raise exception 'Archivo del pago no válido: %', r.path;
    end if;
    if r.path = v_path or exists (select 1 from adjuntos where path = r.path) then
      raise exception 'El archivo % ya está registrado', r.path;
    end if;
  end loop;
  if (select count(*) from jsonb_to_recordset(coalesce(p_vouchers_extra, '[]'::jsonb)) as x(path text, nombre text))
     <> (select count(distinct x.path) from jsonb_to_recordset(coalesce(p_vouchers_extra, '[]'::jsonb)) as x(path text, nombre text)) then
    raise exception 'Un archivo del pago está repetido';
  end if;$b$);
  if d = antes then
    raise exception 'pagar_documento: no se encontró el chequeo del voucher';
  end if;

  -- Y se registran junto con el primero.
  antes := d;
  d := replace(d, $a$                     when 'png' then 'image/png' when 'webp' then 'image/webp' when 'heic' then 'image/heic' end);
$a$, $b$                     when 'png' then 'image/png' when 'webp' then 'image/webp' when 'heic' then 'image/heic' end);

  insert into adjuntos (tipo, obra_id, numero_oc, pago_id, orden_pago_id, path, nombre, mime)
  select 'VOUCHER',
         case when p_orden_pago_id is null then p_obra_id end,
         case when p_orden_pago_id is null then v_numero end,
         v_pago,
         p_orden_pago_id,
         x.path,
         coalesce(nullif(btrim(x.nombre), ''), regexp_replace(x.path, '^.*/', '')),
         case lower(substring(x.path from '\.([A-Za-z0-9]+)$'))
           when 'pdf' then 'application/pdf' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
           when 'png' then 'image/png' when 'webp' then 'image/webp' when 'heic' then 'image/heic' end
    from jsonb_to_recordset(coalesce(p_vouchers_extra, '[]'::jsonb)) as x(path text, nombre text);
$b$);
  if d = antes then
    raise exception 'pagar_documento: no se encontró el registro del voucher';
  end if;

  execute 'drop function ' || vieja;
  execute d;
end;
$$;

revoke execute on function public.pagar_documento(bigint, text, bigint, date, text, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.pagar_documento(bigint, text, bigint, date, text, text, numeric, text, text, jsonb) to authenticated, service_role;
