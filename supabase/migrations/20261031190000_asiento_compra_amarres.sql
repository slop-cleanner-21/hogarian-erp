-- Contabilidad con el plan de la empresa (Plan_Contable.xlsx) y su voucher de compras (Rpt_Voucher.pdf).
--
-- 1. Plan: las cuentas que se usan (las de los ítems, IGV de compras, proveedores, honorarios,
--    renta de cuarta y redondeos) con su denominación y sus amarres (Destino Prim. Debe/Haber).
--    Se cargan aquí y no en una migración aparte para que también existan tras un db reset (el
--    seed de cuentas no pisa lo que ya está). Las cuentas bancarias no se cargan.
-- 2. Asiento de compra como el voucher: una línea por ítem a la cuenta 9 del ítem (con su
--    descripción), el IGV a la 961110102 (IGV no deducible), el total a la 421210101 (o a la
--    424110101 y la 401720101 en un recibo por honorarios) y el redondeo a la 759930104 o la
--    659910108. Después, las cuentas de amarre: cada cuenta con amarre lleva su par Debe/Haber, y
--    el Debe se amarra a su vez (602410106 → 244110106 / 612410106) sin volver a la clase 9.
-- 3. Destino del IGV de cada factura para el registro de compras del SIRE (DGNG por defecto, o DNG).

alter table public.cuentas_contables
  add column if not exists amarre_debe text references public.cuentas_contables (codigo),
  add column if not exists amarre_haber text references public.cuentas_contables (codigo);

insert into public.cuentas_contables (codigo, denominacion, tipo) values
  ('6032', 'SUMINISTROS', 'GASTO'),
  ('911210501', 'ELIMINACIÓN DE DESMONTE', 'GASTO'),
  ('911220118', 'FLETE DE OBRA', 'GASTO'),
  ('911220317', 'CARPINTERÍA DE MADERA (INC. ACABADO)', 'GASTO'),
  ('911220318', 'CARPINTERÍA METÁLICA', 'GASTO'),
  ('911220320', 'VIDRIOS, CRISTALES Y SIMILARES', 'GASTO'),
  ('911220321', 'PINTURA', 'GASTO'),
  ('911220328', 'ALQUILER DE EQUIPO MAYOR', 'GASTO'),
  ('911220329', 'VALORIZACIONES DE OBRA', 'GASTO'),
  ('911220331', 'ACARREO DE MATERIALES', 'GASTO'),
  ('911220332', 'CUADRILLA PARA VACIADO DE CONCRETO', 'GASTO'),
  ('911220333', 'VIGUETA Y BOVEDILLA PRE-FABRICADA', 'GASTO'),
  ('911220334', 'EXCAVACION C/MAQUINARIA EN ZAPATAS', 'GASTO'),
  ('911220335', 'HABILITACION DE ACERO DE COLUMNAS', 'GASTO'),
  ('911220336', 'HABILITACION DE PARRILLA EN ZAPATAS', 'GASTO'),
  ('911220411', 'SEGURIDAD DE OBRA', 'GASTO'),
  ('911220424', 'ALQUILER DE EQUIPOS Y HERRAMIENTAS', 'GASTO'),
  ('911910103', 'IMPLEMENTACION SERV. DE LUZ Y AGUA', 'GASTO'),
  ('912110101', 'AGREGADOS', 'GASTO'),
  ('91211010101', 'MATERIA PRIMA PARA CONSTRUCCION', 'GASTO'),
  ('91220101', 'MATERIALES AUXILIAR', 'GASTO'),
  ('961110102', 'IGV COMPRAS', 'GASTO'),
  ('421210101', 'PROVEED.NACIONAL FACT,BOL, Y COMP X PAGA', 'PASIVO'),
  ('424110101', 'HONORARIOS POR PAGAR M.N.', 'PASIVO'),
  ('401720101', 'RETENCIONES IMP.A LA RENTA CUARTA CATEG.', 'PASIVO'),
  ('759930104', 'REDONDEO', 'INGRESO'),
  ('659910108', 'REDONDEOS', 'GASTO'),
  ('638210111', 'MANTENIMIENTO Y LIMPIEZA', 'GASTO'),
  ('791110101', 'CARGAS IMPUTAB.A CUENTAS DE COSTOS', 'INGRESO'),
  ('6093101', 'TRANSPORTE DE MATERIALES', 'GASTO'),
  ('638110102', 'CONSTRUCCION DE EDIFICIOS', 'GASTO'),
  ('633110202', 'CONSTRUCCION DE DEPARTAMENTOS, ESTAC. Y DEPOSITO', 'GASTO'),
  ('639201', 'SERVICIOS TEMPORALES - RXH', 'GASTO'),
  ('602410103', 'LADRILLO', 'GASTO'),
  ('634230101', 'MAQ. Y EQ. DE CONSTRUCCION', 'GASTO'),
  ('638210109', 'VIGILANCIA', 'GASTO'),
  ('635629099', 'ALQUILER DE OTROS EQUIPOS', 'GASTO'),
  ('602410106', 'AGREGADOS', 'GASTO'),
  ('602101', 'MATERIAS PRIMAS PARA PROD.MANUFACTURADOS', 'GASTO'),
  ('6956101', 'MATERIALES AUXILIARES', 'ACTIVO'),
  ('641110101', 'IGV NO DEDUCIBLE COMO CRÉDITO FÍSCAL', 'GASTO'),
  ('7911101', 'CARGAS IMPUTAB.A CUENTAS DE COST.Y GAST.', 'INGRESO'),
  ('244110103', 'LADRILLO', 'ACTIVO'),
  ('612410103', 'LADRILLO - COMPRAS', 'GASTO'),
  ('244110106', 'AGREGADOS', 'ACTIVO'),
  ('612410106', 'AGREGADOS - COMPRAS', 'GASTO')
on conflict (codigo) do update set denominacion = excluded.denominacion
  where cuentas_contables.denominacion = 'Sin denominación';

update public.cuentas_contables c
   set amarre_debe = a.debe, amarre_haber = a.haber
  from (values
  ('911210501', '638210111', '791110101'),
  ('911220118', '6093101', '791110101'),
  ('911220317', '638110102', '791110101'),
  ('911220318', '638110102', '791110101'),
  ('911220320', '638110102', '791110101'),
  ('911220321', '638110102', '791110101'),
  ('911220328', '638110102', '791110101'),
  ('911220329', '633110202', '791110101'),
  ('911220331', '639201', '791110101'),
  ('911220332', '633110202', '791110101'),
  ('911220333', '602410103', '791110101'),
  ('911220334', '634230101', '791110101'),
  ('911220335', '633110202', '791110101'),
  ('911220336', '633110202', '791110101'),
  ('911220411', '638210109', '791110101'),
  ('911220424', '635629099', '791110101'),
  ('912110101', '602410106', '791110101'),
  ('91211010101', '602101', '791110101'),
  ('91220101', '6956101', '791110101'),
  ('961110102', '641110101', '7911101'),
  ('602410103', '244110103', '612410103'),
  ('602410106', '244110106', '612410106')
  ) as a(codigo, debe, haber)
 where c.codigo = a.codigo;

alter table public.asiento_lineas
  add column if not exists glosa text,
  add column if not exists amarre boolean not null default false,
  add column if not exists orden integer;

alter table public.comprobantes
  add column if not exists destino_igv text not null default 'DGNG' check (destino_igv in ('DGNG', 'DNG'));

-- Destino del IGV de una factura en el registro de compras (Contabilidad).
create or replace function public.cambiar_destino_igv(p_comprobante_id bigint, p_destino text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform exigir_rol('CONTABILIDAD');
  if p_destino not in ('DGNG', 'DNG') then
    raise exception 'Destino inválido';
  end if;
  update comprobantes set destino_igv = p_destino where id = p_comprobante_id and tipo = 'FACTURA' and igv > 0;
  if not found then
    raise exception 'Solo las facturas con IGV tienen destino';
  end if;
end;
$$;
revoke execute on function public.cambiar_destino_igv(bigint, text) from public, anon;
grant execute on function public.cambiar_destino_igv(bigint, text) to authenticated;

create or replace function public.contabilizar_comprobante(p_comprobante_id bigint)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_c comprobantes%rowtype;
  v_prov text;
  v_doc text;
  v_glosa text;
  v_asiento bigint;
  v_sin text;
  v_w numeric;
  v_n integer;
  v_monto numeric;
  v_acum numeric := 0;
  v_mayor bigint;
  v_max numeric := 0;
  v_id bigint;
  v_dif numeric;
  v_orden integer := 0;
  v_cola text[];
  v_vistas text[];
  v_cta text;
  v_d text;
  v_h text;
  r record;
begin
  perform exigir_rol('CONTABILIDAD');
  select * into v_c from comprobantes where id = p_comprobante_id for update;
  if not found then
    raise exception 'El comprobante % no existe', p_comprobante_id;
  end if;
  if exists (select 1 from asientos where comprobante_id = p_comprobante_id and origen = 'COMPRA') then
    raise exception 'El comprobante %-% ya está contabilizado', v_c.serie, v_c.numero;
  end if;
  if not exists (select 1 from oc_items where comprobante_id = p_comprobante_id) then
    raise exception 'El comprobante %-% no tiene ítems vinculados', v_c.serie, v_c.numero;
  end if;
  select string_agg(distinct descripcion, '; ') into v_sin
    from v_oc_items_calc where comprobante_id = p_comprobante_id and cuenta_contable is null;
  if v_sin is not null then
    raise exception 'Hay ítems sin cuenta contable: %', v_sin;
  end if;
  if v_c.total <= 0 then
    raise exception 'El comprobante %-% tiene total cero', v_c.serie, v_c.numero;
  end if;
  select razon_social into v_prov from proveedores where id = v_c.proveedor_id;
  v_doc := format('%s %s-%s',
                  case v_c.tipo when 'FACTURA' then 'FT' when 'BOLETA' then 'BV' when 'RXH' then 'RH' else v_c.tipo::text end,
                  v_c.serie, v_c.numero);
  v_glosa := format('Compra %s %s', v_doc, v_prov);

  insert into asientos (empresa_id, fecha, glosa, origen, comprobante_id)
  values (v_c.empresa_id, v_c.fecha_emision, v_glosa, 'COMPRA', v_c.id)
  returning id into v_asiento;

  -- Cuentas de origen. Debe: cada ítem (sus líneas de todas las órdenes juntas) a su cuenta con su
  -- parte de la base (en RXH y boleta la base es el total), según el parcial; sin parciales, en
  -- partes iguales.
  select sum(coalesce(parcial, 0)), count(distinct item_id) into v_w, v_n from v_oc_items_calc where comprobante_id = p_comprobante_id;
  for r in
    select cuenta_contable as cuenta, min(descripcion) as descripcion,
           case when v_w > 0 then sum(coalesce(parcial, 0)) else 1 end as peso
      from v_oc_items_calc where comprobante_id = p_comprobante_id
     group by item_id, cuenta_contable
     order by min(id)
  loop
    v_monto := round(v_c.base * r.peso / case when v_w > 0 then v_w else v_n end, 2);
    if v_monto > 0 then
      v_orden := v_orden + 1;
      insert into asiento_lineas (asiento_id, cuenta, debe, glosa, orden)
      values (v_asiento, r.cuenta, v_monto, r.descripcion, v_orden)
      returning id into v_id;
      if v_monto > v_max then
        v_max := v_monto;
        v_mayor := v_id;
      end if;
      v_acum := v_acum + v_monto;
    end if;
  end loop;
  -- Residuo del reparto a la línea mayor.
  v_dif := v_c.base - v_acum;
  if v_dif <> 0 and v_mayor is not null then
    update asiento_lineas set debe = debe + v_dif where id = v_mayor;
  end if;
  if v_c.igv > 0 then
    v_orden := v_orden + 1;
    insert into asiento_lineas (asiento_id, cuenta, debe, glosa, orden) values (v_asiento, '961110102', v_c.igv, v_glosa, v_orden);
  end if;

  -- Haber: el total por pagar.
  if v_c.tipo = 'RXH' then
    if v_c.total - v_c.retencion > 0 then
      v_orden := v_orden + 1;
      insert into asiento_lineas (asiento_id, cuenta, haber, glosa, orden) values (v_asiento, '424110101', v_c.total - v_c.retencion, v_glosa, v_orden);
    end if;
    if v_c.retencion > 0 then
      v_orden := v_orden + 1;
      insert into asiento_lineas (asiento_id, cuenta, haber, glosa, orden) values (v_asiento, '401720101', v_c.retencion, v_glosa, v_orden);
    end if;
  else
    v_orden := v_orden + 1;
    insert into asiento_lineas (asiento_id, cuenta, haber, glosa, orden) values (v_asiento, '421210101', v_c.total, v_glosa, v_orden);
  end if;

  -- Redondeo: lo que no cuadra entre base + IGV y el total del comprobante.
  select sum(debe) - sum(haber) into v_dif from asiento_lineas where asiento_id = v_asiento;
  if abs(v_dif) > 1 then
    raise exception 'El comprobante %-% no cuadra: base + IGV difiere del total en %', v_c.serie, v_c.numero, v_dif;
  elsif v_dif > 0 then
    v_orden := v_orden + 1;
    insert into asiento_lineas (asiento_id, cuenta, haber, glosa, orden) values (v_asiento, '759930104', v_dif, v_glosa, v_orden);
  elsif v_dif < 0 then
    v_orden := v_orden + 1;
    insert into asiento_lineas (asiento_id, cuenta, debe, glosa, orden) values (v_asiento, '659910108', -v_dif, v_glosa, v_orden);
  end if;

  -- Cuentas de amarre: cada Debe de origen con amarre lleva su par, y el Debe del amarre se
  -- amarra a su vez (sin volver a la clase 9 ni repetir una cuenta).
  for r in
    select cuenta, debe, glosa from asiento_lineas where asiento_id = v_asiento and not amarre and debe > 0 order by orden
  loop
    v_cola := array[r.cuenta];
    v_vistas := array[r.cuenta];
    while cardinality(v_cola) > 0 loop
      v_cta := v_cola[1];
      v_cola := v_cola[2:];
      select amarre_debe, amarre_haber into v_d, v_h from cuentas_contables where codigo = v_cta;
      if v_d is not null and v_h is not null then
        v_orden := v_orden + 1;
        insert into asiento_lineas (asiento_id, cuenta, debe, glosa, orden, amarre) values (v_asiento, v_d, r.debe, r.glosa, v_orden, true);
        v_orden := v_orden + 1;
        insert into asiento_lineas (asiento_id, cuenta, haber, glosa, orden, amarre) values (v_asiento, v_h, r.debe, r.glosa, v_orden, true);
        if left(v_d, 1) <> '9' and not v_d = any (v_vistas) then
          v_cola := v_cola || v_d;
          v_vistas := v_vistas || v_d;
        end if;
      end if;
    end loop;
  end loop;

  if (select sum(debe) - sum(haber) from asiento_lineas where asiento_id = v_asiento) <> 0 then
    raise exception 'Asiento descuadrado para el comprobante %-%', v_c.serie, v_c.numero;
  end if;
  return v_asiento;
end;
$$;

CREATE OR REPLACE FUNCTION public.contabilizar_pago(p_pago_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_p pagos%rowtype;
  v_asiento bigint;
  v_sin text;
begin
  perform exigir_rol('CONTABILIDAD');
  select * into v_p from pagos where id = p_pago_id for update;
  if not found then
    raise exception 'El pago % no existe', p_pago_id;
  end if;
  if exists (select 1 from asientos where pago_id = p_pago_id and origen = 'PAGO') then
    raise exception 'El pago % ya está contabilizado', p_pago_id;
  end if;
  select string_agg(op.numero, ', ' order by op.numero) into v_sin
    from pago_aplicaciones a join ordenes_pago op on op.id = a.orden_pago_id
   where a.pago_id = p_pago_id and op.cuenta_contable is null;
  if v_sin is not null then
    raise exception 'Asigne la cuenta contable de la OP % antes de contabilizar el pago', v_sin;
  end if;

  insert into asientos (empresa_id, fecha, glosa, origen, pago_id)
  values (v_p.empresa_id, v_p.fecha,
          format('Pago op. %s %s', coalesce(v_p.numero_operacion, 's/n'), coalesce(v_p.banco, '')), 'PAGO', v_p.id)
  returning id into v_asiento;

  -- Debe: cuenta de la OP; 424110101 para RxH; 421210101 para el resto y para pagos a órdenes sin comprobante
  insert into asiento_lineas (asiento_id, cuenta, debe)
  select v_asiento,
         case when a.orden_pago_id is not null then op.cuenta_contable
              when c.tipo = 'RXH' then '424110101'
              else '421210101' end,
         sum(a.monto)
    from pago_aplicaciones a
    left join comprobantes c on c.id = a.comprobante_id
    left join ordenes_pago op on op.id = a.orden_pago_id
   where a.pago_id = p_pago_id
   group by 2;
  insert into asiento_lineas (asiento_id, cuenta, haber) values (v_asiento, '1041', v_p.monto);

  if (select sum(debe) - sum(haber) from asiento_lineas where asiento_id = v_asiento) <> 0 then
    raise exception 'Asiento descuadrado para el pago %', p_pago_id;
  end if;
  return v_asiento;
end;
$function$;

create or replace view public.v_registro_compras with (security_invoker = on) as
SELECT vc.empresa_id,
    vc.empresa,
    vc.empresa_ruc,
    (c.periodo_anotacion)::text AS periodo,
    vc.id AS comprobante_id,
    vc.tipo,
    vc.serie,
    vc.numero,
    vc.fecha_emision,
    vc.proveedor_id,
    vc.proveedor_ruc,
    vc.proveedor,
    vc.base,
    vc.igv,
    vc.total,
    vc.retencion,
    vc.asiento_id,
    COALESCE(s.n, (0)::bigint) AS items_sin_cuenta,
    to_char((vc.fecha_emision)::timestamp with time zone, 'YYYYMM'::text) AS periodo_emision,
    COALESCE((vc.asiento_id)::text, ('C'::text || vc.id)) AS cuo,
        CASE
            WHEN (vc.tipo <> 'FACTURA'::tipo_comprobante) THEN '0'::text
            WHEN ((c.periodo_anotacion)::text > to_char((vc.fecha_emision)::timestamp with time zone, 'YYYYMM'::text)) THEN '6'::text
            ELSE '1'::text
        END AS estado_ple,
    c.destino_igv
   FROM ((v_comprobantes vc
     JOIN comprobantes c ON ((c.id = vc.id)))
     LEFT JOIN LATERAL ( SELECT count(DISTINCT ci.item_id) AS n
           FROM v_oc_items_calc ci
          WHERE ((ci.comprobante_id = vc.id) AND (ci.cuenta_contable IS NULL))) s ON (true));
