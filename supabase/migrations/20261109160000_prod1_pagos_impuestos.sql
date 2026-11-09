-- Prod 1: Contabilidad paga las detracciones y las retenciones de 4ta, y lo registra con su constancia.
--   Detracción (SPOT): se deposita en la cuenta de detracciones del proveedor (Banco de la Nación), por comprobante; la
--   constancia de depósito tiene su número. Se pueden registrar varias de una empresa con un mismo número (pago masivo).
--   Retención de 4ta: se declara y paga a SUNAT por mes, el del pago del recibo (es cuando se retiene); entra todo lo
--   retenido de esa empresa en ese mes que aún no se pagó.
-- Cada pago genera su asiento (Debe 421210101 la detracción del proveedor, 401720101 la renta de 4ta; Haber 1041). Anular
-- un pago libera sus comprobantes y borra su asiento. Un comprobante con su detracción o su retención pagada no se anula
-- ni cambia ese monto.

-- 1. Datos ---------------------------------------------------------------------------------------------------------
alter table public.proveedores add column if not exists cuenta_detracciones text
  constraint proveedores_cuenta_detracciones_chk check (cuenta_detracciones ~ '^[0-9]{8,20}$');

create table public.impuesto_pagos (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas (id),
  tipo text not null constraint impuesto_pagos_tipo_chk check (tipo in ('DETRACCION', 'RETENCION_4TA')),
  -- Retención: el mes (AAAAMM) en que se pagaron los recibos.
  periodo text constraint impuesto_pagos_periodo_chk check (periodo ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
  fecha date not null,
  -- N° de la constancia de depósito (detracción) o de la orden / operación del pago a SUNAT (retención).
  numero text not null constraint impuesto_pagos_numero_chk check (btrim(numero) <> ''),
  monto numeric(12, 2) not null constraint impuesto_pagos_monto_chk check (monto > 0),
  archivo_path text not null constraint impuesto_pagos_archivo_chk check (archivo_path like 'impuestos/%' and position('..' in archivo_path) = 0),
  anulado_at timestamptz,
  anulado_motivo text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint impuesto_pagos_periodo_tipo_chk check ((tipo = 'RETENCION_4TA') = (periodo is not null))
);

create table public.impuesto_pago_comprobantes (
  impuesto_pago_id bigint not null references public.impuesto_pagos (id) on delete cascade,
  comprobante_id bigint not null references public.comprobantes (id),
  tipo text not null,
  monto numeric(12, 2) not null,
  vigente boolean not null default true,
  primary key (impuesto_pago_id, comprobante_id)
);
-- Una detracción o una retención se paga una vez.
create unique index impuesto_pago_comprobantes_vigente_uq on public.impuesto_pago_comprobantes (comprobante_id, tipo) where vigente;

alter table public.asientos add column if not exists impuesto_pago_id bigint references public.impuesto_pagos (id);
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check check (origen in ('COMPRA', 'PAGO', 'IMPUESTO'));
alter table public.asientos drop constraint asientos_check;
alter table public.asientos add constraint asientos_check check (
  (origen = 'COMPRA' and comprobante_id is not null and pago_id is null and impuesto_pago_id is null)
  or (origen = 'PAGO' and pago_id is not null and comprobante_id is null and impuesto_pago_id is null)
  or (origen = 'IMPUESTO' and impuesto_pago_id is not null and comprobante_id is null and pago_id is null)
);
create unique index asientos_impuesto_uq on public.asientos (impuesto_pago_id) where origen = 'IMPUESTO';

-- Lectura: Contabilidad, Tesorería y Gerencia (el Jefe de Operaciones, nada de dinero). Se escriben solo por las funciones.
alter table public.impuesto_pagos enable row level security;
alter table public.impuesto_pago_comprobantes enable row level security;
revoke all on public.impuesto_pagos, public.impuesto_pago_comprobantes from anon, authenticated;
grant select on public.impuesto_pagos, public.impuesto_pago_comprobantes to authenticated;
create policy lectura_por_rol on public.impuesto_pagos for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'GERENCIA')));
create policy lectura_por_rol on public.impuesto_pago_comprobantes for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'TESORERIA', 'GERENCIA')));
create trigger audit_impuesto_pagos after insert or delete or update on public.impuesto_pagos
  for each row execute function public.fn_audit();
create trigger audit_impuesto_pago_comprobantes after insert or delete or update on public.impuesto_pago_comprobantes
  for each row execute function public.fn_audit();

-- 2. Lo que hay por pagar -----------------------------------------------------------------------------------------
-- Detracciones: facturas vigentes con detracción, con su pago (si lo hay) y si Tesorería ya le pagó al proveedor.
create or replace view public.v_detracciones with (security_invoker = true) as
select c.id as comprobante_id, c.empresa_id, e.nombre as empresa, c.proveedor_id, pr.razon_social as proveedor,
       pr.ruc_o_cod as proveedor_ruc, pr.cuenta_detracciones, c.tipo, c.serie, c.numero, c.fecha_emision, c.total,
       c.detraccion, c.historico,
       (select max(p.fecha) from pago_aplicaciones a join pagos p on p.id = a.pago_id where a.comprobante_id = c.id) as pagado_proveedor,
       ip.id as impuesto_pago_id, ip.fecha as fecha_pago, ip.numero as constancia
  from comprobantes c
  join empresas e on e.id = c.empresa_id
  join proveedores pr on pr.id = c.proveedor_id
  left join impuesto_pago_comprobantes ic on ic.comprobante_id = c.id and ic.tipo = 'DETRACCION' and ic.vigente
  left join impuesto_pagos ip on ip.id = ic.impuesto_pago_id
 where c.anulado_at is null and c.detraccion > 0;

-- Retenciones de 4ta: recibos vigentes ya pagados (la retención se hace al pagar), por el mes de su pago.
create or replace view public.v_retenciones_4ta with (security_invoker = true) as
with pagado as (
  select a.comprobante_id, max(p.fecha) as fecha
    from pago_aplicaciones a join pagos p on p.id = a.pago_id
   where a.comprobante_id is not null
   group by a.comprobante_id
)
select c.id as comprobante_id, c.empresa_id, e.nombre as empresa, c.proveedor_id, pr.razon_social as proveedor,
       pr.ruc_o_cod as proveedor_ruc, c.serie, c.numero, c.fecha_emision, c.total, c.retencion, c.historico,
       pg.fecha as pagado_proveedor, to_char(pg.fecha, 'YYYYMM') as periodo,
       ip.id as impuesto_pago_id, ip.fecha as fecha_pago, ip.numero as constancia
  from comprobantes c
  join pagado pg on pg.comprobante_id = c.id
  join empresas e on e.id = c.empresa_id
  join proveedores pr on pr.id = c.proveedor_id
  left join impuesto_pago_comprobantes ic on ic.comprobante_id = c.id and ic.tipo = 'RETENCION_4TA' and ic.vigente
  left join impuesto_pagos ip on ip.id = ic.impuesto_pago_id
 where c.anulado_at is null and c.tipo = 'RXH' and c.retencion > 0;

grant select on public.v_detracciones, public.v_retenciones_4ta to authenticated;

-- 3. Funciones -------------------------------------------------------------------------------------------------------
-- La constancia: subida de verdad, en la carpeta de la empresa.
create or replace function public.fn_constancia_valida(p_empresa_id bigint, p_path text) returns void
  language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if nullif(btrim(coalesce(p_path, '')), '') is null then
    raise exception 'Sube la constancia';
  end if;
  if p_path not like format('impuestos/%s/%%', p_empresa_id) or position('..' in p_path) > 0
     or not exists (select 1 from storage.objects where bucket_id = 'documentos' and name = p_path) then
    raise exception 'Constancia inválida';
  end if;
end;
$$;

create or replace function public.fn_asiento_impuesto(p_pago bigint) returns bigint
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v impuesto_pagos%rowtype;
  v_asiento bigint;
  v_orden int := 0;
  r record;
begin
  select * into v from impuesto_pagos where id = p_pago;
  insert into asientos (empresa_id, fecha, glosa, origen, impuesto_pago_id)
  values (v.empresa_id, v.fecha,
          case v.tipo when 'DETRACCION' then format('Detracción constancia %s', v.numero)
                      else format('Retención 4ta %s/%s op. %s', right(v.periodo, 2), left(v.periodo, 4), v.numero) end,
          'IMPUESTO', v.id)
  returning id into v_asiento;
  for r in
    select ic.monto, format('%s-%s %s', c.serie, c.numero, pr.razon_social) as glosa
      from impuesto_pago_comprobantes ic
      join comprobantes c on c.id = ic.comprobante_id
      join proveedores pr on pr.id = c.proveedor_id
     where ic.impuesto_pago_id = v.id
     order by c.fecha_emision, c.id
  loop
    v_orden := v_orden + 1;
    insert into asiento_lineas (asiento_id, cuenta, debe, glosa, orden)
    values (v_asiento, case v.tipo when 'DETRACCION' then '421210101' else '401720101' end, r.monto, r.glosa, v_orden);
  end loop;
  insert into asiento_lineas (asiento_id, cuenta, haber, glosa, orden) values (v_asiento, '1041', v.monto, null, v_orden + 1);
  return v_asiento;
end;
$$;

create or replace function public.registrar_pago_detraccion(p_comprobantes bigint[], p_fecha date, p_numero text,
                                                            p_archivo_path text) returns bigint
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_empresa bigint;
  v_id bigint;
  v_monto numeric;
  r record;
begin
  perform exigir_rol('CONTABILIDAD');
  if coalesce(cardinality(p_comprobantes), 0) = 0 then
    raise exception 'Elige las detracciones';
  end if;
  if nullif(btrim(coalesce(p_numero, '')), '') is null then
    raise exception 'Ingresa el N° de constancia';
  end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'La fecha del pago no puede ser futura';
  end if;
  -- Bloquea los comprobantes: dos personas no pagan la misma detracción.
  perform 1 from comprobantes where id = any (p_comprobantes) order by id for update;
  for r in select c.*, (select count(*) from impuesto_pago_comprobantes ic
                         where ic.comprobante_id = c.id and ic.tipo = 'DETRACCION' and ic.vigente) as pagadas
             from comprobantes c where c.id = any (p_comprobantes)
  loop
    if r.anulado_at is not null then
      raise exception 'El comprobante %-% está anulado', r.serie, r.numero;
    end if;
    if coalesce(r.detraccion, 0) <= 0 then
      raise exception 'El comprobante %-% no lleva detracción', r.serie, r.numero;
    end if;
    if r.pagadas > 0 then
      raise exception 'La detracción del comprobante %-% ya está pagada', r.serie, r.numero;
    end if;
    if p_fecha < r.fecha_emision then
      raise exception 'La fecha del pago es anterior a la del comprobante %-%', r.serie, r.numero;
    end if;
    if v_empresa is not null and v_empresa <> r.empresa_id then
      raise exception 'Las detracciones de un pago deben ser de una misma empresa';
    end if;
    v_empresa := r.empresa_id;
  end loop;
  if (select count(*) from comprobantes where id = any (p_comprobantes)) <> cardinality(array(select distinct unnest(p_comprobantes))) then
    raise exception 'Algún comprobante no existe';
  end if;
  perform fn_constancia_valida(v_empresa, p_archivo_path);
  select sum(detraccion) into v_monto from comprobantes where id = any (p_comprobantes);
  insert into impuesto_pagos (empresa_id, tipo, fecha, numero, monto, archivo_path)
  values (v_empresa, 'DETRACCION', p_fecha, upper(btrim(p_numero)), v_monto, p_archivo_path)
  returning id into v_id;
  insert into impuesto_pago_comprobantes (impuesto_pago_id, comprobante_id, tipo, monto)
  select v_id, c.id, 'DETRACCION', c.detraccion from comprobantes c where c.id = any (p_comprobantes);
  perform fn_asiento_impuesto(v_id);
  return v_id;
end;
$$;

-- p_monto: lo que vio quien paga; si cambió (otro pagó o se registró otro recibo), no se registra.
create or replace function public.registrar_pago_retencion(p_empresa_id bigint, p_periodo text, p_monto numeric, p_fecha date,
                                                           p_numero text, p_archivo_path text) returns bigint
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_ids bigint[];
  v_monto numeric;
begin
  perform exigir_rol('CONTABILIDAD');
  if p_periodo is null or p_periodo !~ '^[0-9]{4}(0[1-9]|1[0-2])$' then
    raise exception 'Periodo inválido';
  end if;
  if nullif(btrim(coalesce(p_numero, '')), '') is null then
    raise exception 'Ingresa el N° de orden u operación';
  end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Lima')::date then
    raise exception 'La fecha del pago no puede ser futura';
  end if;
  if p_fecha < to_date(p_periodo || '01', 'YYYYMMDD') then
    raise exception 'La fecha del pago es anterior al periodo';
  end if;
  -- Un pago de retenciones a la vez por empresa.
  perform pg_advisory_xact_lock(hashtext('retencion_4ta'), p_empresa_id::int);
  select array_agg(comprobante_id order by comprobante_id), sum(retencion) into v_ids, v_monto
    from v_retenciones_4ta
   where empresa_id = p_empresa_id and periodo = p_periodo and impuesto_pago_id is null;
  if v_ids is null then
    raise exception 'No hay retenciones por pagar de ese periodo';
  end if;
  if round(v_monto, 2) <> round(coalesce(p_monto, 0), 2) then
    raise exception 'Las retenciones del periodo cambiaron: ahora suman S/ %. Vuelve a abrirlo', to_char(v_monto, 'FM999,999,990.00');
  end if;
  perform fn_constancia_valida(p_empresa_id, p_archivo_path);
  insert into impuesto_pagos (empresa_id, tipo, periodo, fecha, numero, monto, archivo_path)
  values (p_empresa_id, 'RETENCION_4TA', p_periodo, p_fecha, upper(btrim(p_numero)), v_monto, p_archivo_path)
  returning id into v_id;
  insert into impuesto_pago_comprobantes (impuesto_pago_id, comprobante_id, tipo, monto)
  select v_id, c.id, 'RETENCION_4TA', c.retencion from comprobantes c where c.id = any (v_ids);
  perform fn_asiento_impuesto(v_id);
  return v_id;
end;
$$;

create or replace function public.anular_pago_impuesto(p_id bigint, p_motivo text) returns void
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v impuesto_pagos%rowtype;
  v_asiento bigint;
begin
  perform exigir_rol('CONTABILIDAD');
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Ingresa el motivo';
  end if;
  select * into v from impuesto_pagos where id = p_id for update;
  if not found then
    raise exception 'El pago no existe';
  end if;
  if v.anulado_at is not null then
    raise exception 'El pago ya está anulado';
  end if;
  update impuesto_pagos set anulado_at = now(), anulado_motivo = btrim(p_motivo) where id = p_id;
  update impuesto_pago_comprobantes set vigente = false where impuesto_pago_id = p_id;
  select id into v_asiento from asientos where impuesto_pago_id = p_id and origen = 'IMPUESTO';
  delete from asiento_lineas where asiento_id = v_asiento;
  delete from asientos where id = v_asiento;
end;
$$;

-- La cuenta de detracciones del proveedor (Banco de la Nación): la pone Contabilidad (o Logística, en su ficha).
create or replace function public.guardar_cuenta_detracciones(p_proveedor_id bigint, p_cuenta text) returns void
  language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_cuenta text := nullif(regexp_replace(coalesce(p_cuenta, ''), '[\s-]', '', 'g'), '');
begin
  perform exigir_rol('CONTABILIDAD', 'LOGISTICA');
  if v_cuenta is not null and v_cuenta !~ '^[0-9]{8,20}$' then
    raise exception 'La cuenta de detracciones lleva solo números';
  end if;
  update proveedores set cuenta_detracciones = v_cuenta where id = p_proveedor_id;
  if not found then
    raise exception 'El proveedor no existe';
  end if;
end;
$$;

revoke execute on function public.fn_constancia_valida(bigint, text), public.fn_asiento_impuesto(bigint) from public, anon, authenticated;
revoke execute on function public.registrar_pago_detraccion(bigint[], date, text, text),
  public.registrar_pago_retencion(bigint, text, numeric, date, text, text), public.anular_pago_impuesto(bigint, text),
  public.guardar_cuenta_detracciones(bigint, text) from public, anon;
grant execute on function public.registrar_pago_detraccion(bigint[], date, text, text),
  public.registrar_pago_retencion(bigint, text, numeric, date, text, text), public.anular_pago_impuesto(bigint, text),
  public.guardar_cuenta_detracciones(bigint, text) to authenticated, service_role;

-- 4. Un comprobante con su detracción o su retención pagada no se anula ni cambia ese monto ------------------------
create or replace function public.fn_comprobante_impuesto_pagado() returns trigger
  language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if (new.anulado_at is not null and old.anulado_at is null)
     or new.detraccion is distinct from old.detraccion
     or new.retencion is distinct from old.retencion then
    if exists (select 1 from impuesto_pago_comprobantes ic
                where ic.comprobante_id = new.id and ic.vigente
                  and (new.anulado_at is not null and old.anulado_at is null
                       or (ic.tipo = 'DETRACCION' and new.detraccion is distinct from old.detraccion)
                       or (ic.tipo = 'RETENCION_4TA' and new.retencion is distinct from old.retencion))) then
      raise exception 'Contabilidad ya pagó la % del comprobante %-%: primero hay que anular ese pago',
        case when new.retencion is distinct from old.retencion then 'retención' else 'detracción' end, new.serie, new.numero;
    end if;
  end if;
  return new;
end;
$$;
create trigger comprobante_impuesto_pagado before update on public.comprobantes
  for each row execute function public.fn_comprobante_impuesto_pagado();

-- 5. Archivos: las constancias van en documentos/impuestos/<empresa>/; las sube Contabilidad y las leen Contabilidad,
--    Tesorería y Gerencia.
drop policy if exists archivos_por_rol on storage.objects;
create policy archivos_por_rol on storage.objects as restrictive for select to authenticated
  using (
    case
      when bucket_id = 'comprobantes'
        then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA'))
      when bucket_id = 'documentos' and (name like 'pagos/%' or name like 'demo/%')
        then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'LOGISTICA', 'GERENCIA'))
      when bucket_id = 'documentos' and name like 'impuestos/%'
        then (select public.rol_en('CONTABILIDAD', 'TESORERIA', 'GERENCIA'))
      when bucket_id = 'documentos' and name like 'solicitudes/%'
        then (select public.rol_en('GERENCIA', 'OPERACIONES', 'JEFE_OPERACIONES'))
      when bucket_id = 'documentos' and name like 'firmas/%'
        then false
      else true
    end
  );

drop policy if exists subir_por_rol on storage.objects;
create policy subir_por_rol on storage.objects as restrictive for insert to authenticated
with check (
  case
    when bucket_id = 'comprobantes' then (select public.rol_en('LOGISTICA'))
    when bucket_id = 'documentos' then
      case
        when name like 'pagos/%' then (select public.rol_en('TESORERIA'))
        when name like 'impuestos/%' then (select public.rol_en('CONTABILIDAD'))
        when name like 'guias/%' or name like 'proveedores/%' or name ~ '^[0-9]+/' then (select public.rol_en('LOGISTICA'))
        else false
      end
    else true
  end
);

revoke execute on function public.fn_comprobante_impuesto_pagado() from public, anon, authenticated;
