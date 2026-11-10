-- Prod 1, Contabilidad (2): asientos manuales (apertura, ventas, depósitos, ajustes), contabilizar en lote, cierre de
-- periodo y avisos de detracciones y retenciones por pagar.

-- 1. Asientos manuales ---------------------------------------------------------------------------------------------
alter table public.asientos drop constraint asientos_origen_check;
alter table public.asientos add constraint asientos_origen_check check (origen in ('COMPRA', 'PAGO', 'IMPUESTO', 'MANUAL'));
alter table public.asientos drop constraint asientos_check;
alter table public.asientos add constraint asientos_check check (
  (origen = 'COMPRA' and comprobante_id is not null and pago_id is null and impuesto_pago_id is null)
  or (origen = 'PAGO' and pago_id is not null and comprobante_id is null and impuesto_pago_id is null)
  or (origen = 'IMPUESTO' and impuesto_pago_id is not null and comprobante_id is null and pago_id is null)
  or (origen = 'MANUAL' and comprobante_id is null and pago_id is null and impuesto_pago_id is null)
);

-- p_lineas: [{cuenta, debe, haber, glosa?}]: cada línea con Debe o Haber (no los dos), cuentas del plan, y cuadrado.
create or replace function public.registrar_asiento_manual(p_empresa_id bigint, p_fecha date, p_glosa text, p_lineas jsonb)
returns bigint
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_debe numeric := 0;
  v_haber numeric := 0;
  v_orden int := 0;
  r record;
begin
  perform exigir_rol('CONTABILIDAD');
  if p_empresa_id is null or not exists (select 1 from empresas where id = p_empresa_id) then
    raise exception 'Elige la empresa';
  end if;
  if p_fecha is null then
    raise exception 'Ingresa la fecha';
  end if;
  if nullif(btrim(coalesce(p_glosa, '')), '') is null then
    raise exception 'Ingresa la glosa';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then
    raise exception 'El asiento lleva al menos dos líneas';
  end if;
  for r in
    select x.cuenta, coalesce(x.debe, 0) as debe, coalesce(x.haber, 0) as haber
      from jsonb_to_recordset(p_lineas) as x(cuenta text, debe numeric, haber numeric, glosa text)
  loop
    if not exists (select 1 from cuentas_contables where codigo = r.cuenta) then
      raise exception 'La cuenta % no está en el plan', coalesce(r.cuenta, '(vacía)');
    end if;
    if r.debe < 0 or r.haber < 0 or (r.debe > 0) = (r.haber > 0) then
      raise exception 'Cada línea lleva un monto en el Debe o en el Haber (cuenta %)', r.cuenta;
    end if;
    v_debe := v_debe + round(r.debe, 2);
    v_haber := v_haber + round(r.haber, 2);
  end loop;
  if v_debe <> v_haber then
    raise exception 'El asiento no cuadra: Debe S/ % y Haber S/ %', to_char(v_debe, 'FM999,999,990.00'), to_char(v_haber, 'FM999,999,990.00');
  end if;
  insert into asientos (empresa_id, fecha, glosa, origen) values (p_empresa_id, p_fecha, btrim(p_glosa), 'MANUAL')
  returning id into v_id;
  for r in
    select e.x ->> 'cuenta' as cuenta, round(coalesce((e.x ->> 'debe')::numeric, 0), 2) as debe,
           round(coalesce((e.x ->> 'haber')::numeric, 0), 2) as haber, nullif(btrim(coalesce(e.x ->> 'glosa', '')), '') as glosa
      from jsonb_array_elements(p_lineas) with ordinality as e(x, n)
     order by e.n
  loop
    v_orden := v_orden + 1;
    insert into asiento_lineas (asiento_id, cuenta, debe, haber, glosa, orden) values (v_id, r.cuenta, r.debe, r.haber, r.glosa, v_orden);
  end loop;
  return v_id;
end;
$$;

-- Solo un asiento manual se anula (los demás salen de su comprobante, pago o pago de impuestos).
create or replace function public.anular_asiento_manual(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform exigir_rol('CONTABILIDAD');
  if not exists (select 1 from asientos where id = p_id and origen = 'MANUAL') then
    raise exception 'Solo se anula un asiento manual';
  end if;
  delete from asiento_lineas where asiento_id = p_id;
  delete from asientos where id = p_id;
end;
$$;

-- 2. Contabilizar en lote: los que se pueden; de los demás, por qué no ------------------------------------------------
create or replace function public.contabilizar_comprobantes(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ok int := 0;
  v_errores jsonb := '[]'::jsonb;
  r record;
begin
  perform exigir_rol('CONTABILIDAD');
  for r in
    select c.id, c.serie || '-' || c.numero as doc from comprobantes c
     where c.id = any (p_ids) and c.anulado_at is null
       and not exists (select 1 from asientos s where s.comprobante_id = c.id and s.origen = 'COMPRA')
     order by c.fecha_emision, c.id
  loop
    begin
      perform contabilizar_comprobante(r.id);
      v_ok := v_ok + 1;
    exception when others then
      v_errores := v_errores || jsonb_build_object('id', r.id, 'documento', r.doc, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('contabilizados', v_ok, 'errores', v_errores);
end;
$$;

create or replace function public.contabilizar_pagos(p_ids bigint[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ok int := 0;
  v_errores jsonb := '[]'::jsonb;
  r record;
begin
  perform exigir_rol('CONTABILIDAD');
  for r in
    select p.id, coalesce(p.numero_operacion, p.id::text) as op from pagos p
     where p.id = any (p_ids) and not exists (select 1 from asientos s where s.pago_id = p.id and s.origen = 'PAGO')
     order by p.fecha, p.id
  loop
    begin
      perform contabilizar_pago(r.id);
      v_ok := v_ok + 1;
    exception when others then
      v_errores := v_errores || jsonb_build_object('id', r.id, 'documento', 'Op. ' || r.op, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('contabilizados', v_ok, 'errores', v_errores);
end;
$$;

-- 3. Cierre de periodo --------------------------------------------------------------------------------------------
-- Un mes cerrado de una empresa: no se registran ni corrigen sus comprobantes (uno nuevo se anota en el siguiente mes
-- abierto) ni se hacen o anulan asientos con esa fecha. Contabilidad lo reabre si hace falta.
create table public.periodos_cerrados (
  empresa_id bigint not null references public.empresas (id),
  periodo text not null constraint periodos_cerrados_periodo_chk check (periodo ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
  cerrado_at timestamptz not null default now(),
  cerrado_por uuid default auth.uid() references auth.users (id) on delete set null,
  primary key (empresa_id, periodo)
);
alter table public.periodos_cerrados enable row level security;
revoke all on public.periodos_cerrados from anon, authenticated;
grant select on public.periodos_cerrados to authenticated;
create policy lectura_por_rol on public.periodos_cerrados for select to authenticated
  using ((select public.rol_en('CONTABILIDAD', 'LOGISTICA', 'TESORERIA', 'GERENCIA')));
create trigger audit_periodos_cerrados after insert or delete or update on public.periodos_cerrados
  for each row execute function public.fn_audit();

create or replace function public.periodo_cerrado(p_empresa_id bigint, p_periodo text) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from periodos_cerrados where empresa_id = p_empresa_id and periodo = p_periodo) $$;

create or replace function public.cerrar_periodo(p_empresa_id bigint, p_periodo text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform exigir_rol('CONTABILIDAD');
  if p_periodo is null or p_periodo !~ '^[0-9]{4}(0[1-9]|1[0-2])$' then
    raise exception 'Periodo inválido';
  end if;
  if p_periodo >= to_char((now() at time zone 'America/Lima')::date, 'YYYYMM') then
    raise exception 'Solo se cierra un mes que ya terminó';
  end if;
  insert into periodos_cerrados (empresa_id, periodo) values (p_empresa_id, p_periodo) on conflict do nothing;
end;
$$;

create or replace function public.reabrir_periodo(p_empresa_id bigint, p_periodo text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform exigir_rol('CONTABILIDAD');
  delete from periodos_cerrados where empresa_id = p_empresa_id and periodo = p_periodo;
end;
$$;

create or replace function public.fn_comprobante_periodo_cerrado() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_vueltas int := 0;
begin
  if tg_op = 'INSERT' then
    -- Uno nuevo de un mes ya cerrado se anota en el siguiente abierto (el SIRE permite anotarlo hasta 12 meses después).
    while new.periodo_anotacion is not null and periodo_cerrado(new.empresa_id, new.periodo_anotacion) and v_vueltas < 24 loop
      new.periodo_anotacion := to_char(to_date(new.periodo_anotacion || '01', 'YYYYMMDD') + interval '1 month', 'YYYYMM');
      v_vueltas := v_vueltas + 1;
    end loop;
    return new;
  end if;
  if periodo_cerrado(old.empresa_id, old.periodo_anotacion)
     and (new.total, new.base, new.igv, new.retencion, new.detraccion, new.tipo, new.serie, new.numero, new.fecha_emision,
          new.periodo_anotacion, new.destino_igv, new.anulado_at, new.proveedor_id)
         is distinct from
         (old.total, old.base, old.igv, old.retencion, old.detraccion, old.tipo, old.serie, old.numero, old.fecha_emision,
          old.periodo_anotacion, old.destino_igv, old.anulado_at, old.proveedor_id) then
    raise exception 'El periodo %/% está cerrado: Contabilidad debe reabrirlo para cambiar el comprobante %-%',
      right(old.periodo_anotacion, 2), left(old.periodo_anotacion, 4), old.serie, old.numero;
  end if;
  if new.periodo_anotacion is distinct from old.periodo_anotacion and periodo_cerrado(new.empresa_id, new.periodo_anotacion) then
    raise exception 'El periodo %/% está cerrado', right(new.periodo_anotacion, 2), left(new.periodo_anotacion, 4);
  end if;
  return new;
end;
$$;
create trigger comprobantes_periodo_cerrado before insert or update on public.comprobantes
  for each row execute function public.fn_comprobante_periodo_cerrado();

create or replace function public.fn_asiento_periodo_cerrado() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_a asientos%rowtype;
begin
  v_a := case when tg_op = 'DELETE' then old else new end;
  if periodo_cerrado(v_a.empresa_id, to_char(v_a.fecha, 'YYYYMM')) then
    raise exception 'El periodo %/% está cerrado: Contabilidad debe reabrirlo', to_char(v_a.fecha, 'MM'), to_char(v_a.fecha, 'YYYY');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger asientos_periodo_cerrado before insert or delete on public.asientos
  for each row execute function public.fn_asiento_periodo_cerrado();

-- 4. Avisos: al pagar Tesorería una factura con detracción o un recibo con retención, Contabilidad tiene que depositarla
--    o declararla.
create or replace function public.fn_aviso_impuesto_por_pagar() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  c record;
begin
  if new.comprobante_id is null then
    return new;
  end if;
  select cp.serie, cp.numero, cp.detraccion, cp.retencion, cp.tipo, pr.razon_social, e.nombre as empresa into c
    from comprobantes cp join proveedores pr on pr.id = cp.proveedor_id join empresas e on e.id = cp.empresa_id
   where cp.id = new.comprobante_id;
  if coalesce(c.detraccion, 0) > 0
     and not exists (select 1 from pago_aplicaciones a where a.comprobante_id = new.comprobante_id and a.id <> new.id) then
    perform notificar('CONTABILIDAD', 'DETRACCION_POR_PAGAR',
      format('Detracción por depositar: %s-%s · S/ %s', c.serie, c.numero, to_char(c.detraccion, 'FM999,999,990.00')),
      format('%s · %s', c.razon_social, c.empresa), '/contabilidad/impuestos?imp=det&est=pend');
  end if;
  if c.tipo = 'RXH' and coalesce(c.retencion, 0) > 0
     and not exists (select 1 from pago_aplicaciones a where a.comprobante_id = new.comprobante_id and a.id <> new.id) then
    perform notificar('CONTABILIDAD', 'RETENCION_POR_PAGAR',
      format('Retención de 4ta por declarar: %s-%s · S/ %s', c.serie, c.numero, to_char(c.retencion, 'FM999,999,990.00')),
      format('%s · %s', c.razon_social, c.empresa), '/contabilidad/impuestos?imp=ret&est=pend');
  end if;
  return new;
end;
$$;
create trigger aviso_impuesto_por_pagar after insert on public.pago_aplicaciones
  for each row execute function public.fn_aviso_impuesto_por_pagar();

-- Permisos de las funciones.
revoke execute on function public.registrar_asiento_manual(bigint, date, text, jsonb), public.anular_asiento_manual(bigint),
  public.contabilizar_comprobantes(bigint[]), public.contabilizar_pagos(bigint[]), public.cerrar_periodo(bigint, text),
  public.reabrir_periodo(bigint, text), public.periodo_cerrado(bigint, text) from public, anon;
grant execute on function public.registrar_asiento_manual(bigint, date, text, jsonb), public.anular_asiento_manual(bigint),
  public.contabilizar_comprobantes(bigint[]), public.contabilizar_pagos(bigint[]), public.cerrar_periodo(bigint, text),
  public.reabrir_periodo(bigint, text), public.periodo_cerrado(bigint, text) to authenticated, service_role;
revoke execute on function public.fn_comprobante_periodo_cerrado(), public.fn_asiento_periodo_cerrado(),
  public.fn_aviso_impuesto_por_pagar() from public, anon, authenticated;

-- La retención que se revisa al pagar (prod1_retencion_al_pagar) no toca un recibo de un mes cerrado: si no, guardar la
-- suspensión de un proveedor fallaría por un recibo viejo.
create or replace function public.fn_recalcular_retencion_4ta(p_proveedor_id bigint, p_comprobante_ids bigint[] default null)
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_n integer;
begin
  update comprobantes c
     set retencion = fn_retencion_4ta(c.proveedor_id, c.tipo, greatest(c.fecha_emision, v_hoy), c.total)
   where c.tipo = 'RXH'
     and c.anulado_at is null
     and not c.historico
     and (p_proveedor_id is null or c.proveedor_id = p_proveedor_id)
     and (p_comprobante_ids is null or c.id = any (p_comprobante_ids))
     and not exists (select 1 from pago_aplicaciones a where a.comprobante_id = c.id)
     and not exists (select 1 from asientos s where s.comprobante_id = c.id)
     and not periodo_cerrado(c.empresa_id, c.periodo_anotacion)
     and (c.retencion = 0) is distinct from (fn_retencion_4ta(c.proveedor_id, c.tipo, greatest(c.fecha_emision, v_hoy), c.total) = 0);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.fn_recalcular_retencion_4ta(bigint, bigint[]) from public, anon, authenticated;
