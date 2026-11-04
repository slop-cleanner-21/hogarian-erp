-- Obra de demostración "DEMO HOGARIAN" (empresa HOGARIAN): un poco de todo para probar y presentar.
-- Se arma con los mismos RPC que usa la app, así los estados y saldos son coherentes.
--
--  Partidas:  completas (cemento, alambre, arena, asentado de bloque), parciales (acero 1/2", hormigón),
--             pedidas sin precio o con sobreprecio (acero 3/8", ladrillo, tubo PVC) y sin tocar
--             (cable, pintura tras anular su OC, instalaciones sanitarias).
--  Órdenes:   900001 EN_ENTREGA (pagada, contabilizada, constancia enviada) · 900002 EN_TESORERIA ·
--             900003 PRECIOS_CONFIRMADOS (por facturar) · 900004 EMITIDA con cotización recibida y
--             sobreprecio sin aprobar · 900005 EMITIDA con el link enviado, esperando al proveedor ·
--             900006 ANULADA · 900007 OS con RxH, pago parcial, en Tesorería y un precio sobre el
--             presupuesto · 900008 de vuelta en cotización tras un rechazo de Tesorería · 900009 PAGADA (falta la
--             constancia) · 900010 OS con precio por debajo del presupuesto, por enviar · 900011 OS
--             recibida (entregas con fotos: scripts/demo-entregas.mjs).
--  Guía de remisión pedida para 900003; transportistas de prueba.
--  Órdenes de pago: OP-0001 en Tesorería, OP-0002 pagada y OP-0003 rechazada (borrador).
--  Los pasos que en la app exigen un rol (enviar a Tesorería, rechazar) se hacen aquí directo sobre las tablas.
--  El residente y el ingeniero de Obras de prueba quedan asignados a esta obra; personas y solicitudes
--  por aprobar en Gerencia; obra «DEMO RESIDENCIAL LAS LOMAS» con el presupuesto en borrador.

do $$
declare
  v_emp   bigint := (select id from empresas where nombre = 'HOGARIAN');
  v_obra  bigint;
  -- partidas
  p_cem bigint; p_ac12 bigint; p_ac38 bigint; p_are bigint; p_hor bigint; p_lad bigint;
  p_ala bigint; p_tub bigint; p_cab bigint; p_pin bigint; p_ase bigint; p_ins bigint;
  v_val1 bigint; v_val2 bigint; v_ops uuid; v_res uuid;
  p_cla bigint; p_pie bigint; p_tar bigint;
  -- proveedores
  pr_cup bigint := (select id from proveedores where razon_social ilike 'MATERIALES CUPISNIQUE%' limit 1);
  pr_for bigint := (select id from proveedores where razon_social ilike 'FORZAMAT%' limit 1);
  pr_cor bigint := (select id from proveedores where razon_social ilike 'AGREGADOS Y MAQUINARIA LA GRAN CORAL%' limit 1);
  -- Persona natural con recibo por honorarios: la de más órdenes (sin su RUC en el código: es dato personal).
  pr_jir bigint := (select p.id from proveedores p where p.comprobante_habitual = 'RXH' and p.ruc_o_cod like '10%'
                     order by (select count(*) from ordenes_compra o where o.proveedor_id = p.id) desc, p.id limit 1);
  v_ids bigint[];
  v_total numeric;
  v_comp bigint;
  v_pago bigint;
  v_op bigint;
begin
  if v_emp is null or pr_cup is null or pr_for is null or pr_cor is null or pr_jir is null then
    raise exception 'Demo: faltan datos base (empresa o proveedores del Excel)';
  end if;

  insert into obras (nombre, empresa_id) values ('DEMO HOGARIAN', v_emp) returning id into v_obra;

  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1A', 'REGULAR', (select id from items where descripcion = 'CEMENTO TIPO I'), 500, 30.90) returning id into p_cem;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1A', 'REGULAR', (select id from items where descripcion = 'ACERO DE 1/2'''''), 300, 35.90) returning id into p_ac12;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1A', 'REGULAR', (select id from items where descripcion = 'ACERO DE 3/8"'), 250, 20.80) returning id into p_ac38;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L0', 'REGULAR', (select id from items where descripcion = 'ARENA GRUESA'), 40, 34.00) returning id into p_are;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L0', 'REGULAR', (select id from items where descripcion = 'HORMIGON'), 60, 38.00) returning id into p_hor;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1B', 'REGULAR', (select id from items where descripcion = 'LADRILLO DE TECHO H= 15 CM'), 2000, 2.60) returning id into p_lad;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1A', 'REGULAR', (select id from items where descripcion ilike 'ALAMBRE RECOCIDO N%16'), 150, 4.00) returning id into p_ala;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'IS 1', 'REGULAR', (select id from items where descripcion = 'TUBO PVC SAL 4"'), 40, 28.00) returning id into p_tub;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'IE 1', 'REGULAR', (select id from items where descripcion ilike 'CABLE FILAMENTADO N%14 THW'), 30, 85.00) returning id into p_cab;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'ACB 1', 'ADIC 1', (select id from items where descripcion = 'PINTURA LATEX'), 80, 45.00) returning id into p_pin;
  -- El mismo material en etapas siguientes, para probar requerimientos con adelanto
  -- (L1A toma de L1B y L1B de ACB 1): db:demo-requerimientos deja L1A casi sin saldo.
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1B', 'REGULAR', (select id from items where descripcion = 'CEMENTO TIPO I'), 300, 30.90),
    (v_obra, 'ACB 1', 'REGULAR', (select id from items where descripcion = 'CEMENTO TIPO I'), 120, 30.90),
    (v_obra, 'L1B', 'REGULAR', (select id from items where descripcion = 'ACERO DE 1/2'''''), 200, 35.90);
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1A', 'REGULAR', (select id from items where descripcion = 'ASENTADO DE BLOQUE 14 EN 1ER NIVEL'), 3000, 1.30) returning id into p_ase;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'IS 1', 'REGULAR', (select id from items where descripcion = 'INSTALACIONES SANITARIAS - 1ER PISO'), 1, 2500.00) returning id into p_ins;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L1B', 'REGULAR', (select id from items where descripcion = 'CLAVOS PARA MADERA DE 3"'), 60, 6.50) returning id into p_cla;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'L0', 'REGULAR', (select id from items where descripcion = 'PIEDRA BASE 6"'), 25, 60.00) returning id into p_pie;
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu) values
    (v_obra, 'ACB 1', 'REGULAR', (select id from items where descripcion = 'TARRAJEO EN INTERIORES Y ZONAS COMUNES (MUROS VIGAS COLUMNAS)'), 400, 18.00) returning id into p_tar;

  -- 900001: cemento completo -> precios -> factura -> pago total -> contabilizado
  perform crear_orden(v_obra, '900001', pr_cup, 'OC', jsonb_build_array(jsonb_build_object('partida_id', p_cem, 'cantidad', 500)));
  perform guardar_precios(v_obra, '900001', (select jsonb_agg(jsonb_build_object('item_id', id, 'pu', 30.50, 'pu_aprobado', null))
                                              from oc_items where obra_id = v_obra and numero_oc = '900001'));
  perform confirmar_precios(v_obra, '900001');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900001';
  v_comp := registrar_comprobante(pr_cup, 'FACTURA', 'F001', '9001', current_date - 20, v_total, 0, null, v_ids);
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = v_obra and numero = '900001';
  v_pago := registrar_pago(v_emp, current_date - 15, 'BBVA', 'DEMO-5001', jsonb_build_array(jsonb_build_object('comprobante_id', v_comp, 'monto', v_total)));
  perform asignar_cuenta_item((select id from items where descripcion = 'CEMENTO TIPO I'), '91211010101');
  perform contabilizar_comprobante(v_comp);
  perform contabilizar_pago(v_pago);
  perform enviar_constancia(v_obra, '900001');

  -- 900002: acero 1/2" parcial (200 de 300) + alambre completo -> factura, por pagar
  perform crear_orden(v_obra, '900002', pr_for, 'OC', jsonb_build_array(
    jsonb_build_object('partida_id', p_ac12, 'cantidad', 200),
    jsonb_build_object('partida_id', p_ala, 'cantidad', 150)));
  perform guardar_precios(v_obra, '900002', (select jsonb_agg(jsonb_build_object('item_id', l.id,
                                               'pu', case when l.partida_id = p_ac12 then 35.00 else 4.00 end, 'pu_aprobado', null))
                                              from oc_items l where l.obra_id = v_obra and l.numero_oc = '900002'));
  perform confirmar_precios(v_obra, '900002');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900002';
  perform registrar_comprobante(pr_for, 'FACTURA', 'F002', '1450', current_date - 6, v_total, 0, null, v_ids);
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = v_obra and numero = '900002';

  -- 900003: arena completa + hormigón parcial (30 de 60) -> precios confirmados, por facturar
  perform crear_orden(v_obra, '900003', pr_cor, 'OC', jsonb_build_array(
    jsonb_build_object('partida_id', p_are, 'cantidad', 40),
    jsonb_build_object('partida_id', p_hor, 'cantidad', 30)));
  perform guardar_precios(v_obra, '900003', (select jsonb_agg(jsonb_build_object('item_id', l.id,
                                               'pu', case when l.partida_id = p_are then 34.00 else 37.00 end, 'pu_aprobado', null))
                                              from oc_items l where l.obra_id = v_obra and l.numero_oc = '900003'));
  perform confirmar_precios(v_obra, '900003');

  -- 900004: cotizada con sobreprecio sin aprobar en acero 3/8" (25.00 > máximo)
  perform crear_orden(v_obra, '900004', pr_for, 'OC', jsonb_build_array(
    jsonb_build_object('partida_id', p_ac38, 'cantidad', 100),
    jsonb_build_object('partida_id', p_lad, 'cantidad', 1000)));
  perform guardar_precios(v_obra, '900004', (select jsonb_agg(jsonb_build_object('item_id', l.id,
                                               'pu', case when l.partida_id = p_ac38 then 25.00 else 2.50 end, 'pu_aprobado', null))
                                              from oc_items l where l.obra_id = v_obra and l.numero_oc = '900004'));
  -- el proveedor ya respondió por el link
  update ordenes_compra set cotizacion_estado = 'RECIBIDA', cotizacion_enviada_at = now() - interval '4 days',
                            cotizacion_recibida_at = now() - interval '3 days'
   where obra_id = v_obra and numero = '900004';

  -- 900005: emitida, esperando la cotización del proveedor
  perform crear_orden(v_obra, '900005', pr_cup, 'OC', jsonb_build_array(jsonb_build_object('partida_id', p_tub, 'cantidad', 20)));
  update ordenes_compra set cotizacion_estado = 'ENVIADA', cotizacion_enviada_at = now() - interval '1 day'
   where obra_id = v_obra and numero = '900005';

  -- 900006: anulada (la pintura vuelve a quedar con todo su saldo)
  perform crear_orden(v_obra, '900006', pr_cup, 'OC', jsonb_build_array(jsonb_build_object('partida_id', p_pin, 'cantidad', 40)));
  perform anular_orden(v_obra, '900006', 'Se cambió la especificación de la pintura');

  -- Mano de obra: el residente registra el avance y Operaciones valoriza (sus fotos las sube
  -- scripts/demo-entregas.mjs). Valorización N° 2: asentado de bloque (1 800 de 3 000 UND).
  select user_id into v_ops from perfiles where rol = 'OPERACIONES' limit 1;
  select user_id into v_res from perfiles where rol = 'RESIDENTE' limit 1;
  insert into valorizaciones (obra_id, numero, fecha_corte, numero_oc, created_by, created_at)
  values (v_obra, 2, now() - interval '9 days', '900007', v_ops, now() - interval '9 days') returning id into v_val1;
  insert into avances (obra_id, partida_id, fecha, cantidad, estado, valorizacion_id, lat, lng, precision_m, created_by, created_at)
  select v_obra, p_ase, current_date - d, 600, 'VALORIZADO', v_val1, -8.1117, -79.0289, 10, v_res, now() - make_interval(days => d)
    from unnest(array[16, 13, 10]) d;
  insert into valorizacion_partidas (valorizacion_id, partida_id, cantidad, pu, porcentaje) values (v_val1, p_ase, 1800, 1.30, 5);
  -- Y lo de esta semana, sin valorizar (uno con observación del residente).
  insert into avances (obra_id, partida_id, fecha, cantidad, estado, observacion, lat, lng, precision_m, created_by, created_at)
  values (v_obra, p_ase, current_date - 2, 300, 'REGISTRADO', null, -8.1117, -79.0289, 9, v_res, now() - interval '2 days'),
         (v_obra, p_ase, current_date - 1, 250, 'REGISTRADO', 'Se paró una hora por falta de agua', -8.1118, -79.0290, 11, v_res, now() - interval '1 day');

  -- 900007: OS de la valorización N° 2 (P.U. neto de la retención de 5 %), recibo por honorarios y pago parcial
  insert into ordenes_compra (obra_id, numero, tipo, proveedor_id, fecha, estado, valorizacion_id, glosa_rhe)
  values (v_obra, '900007', 'OS', pr_jir, current_date, 'EMITIDA', v_val1, 'SERVICIO DE VALORIZACIÓN N° 2 DEMO HOGARIAN');
  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado)
  select v_obra, '900007', vp.partida_id, vp.cantidad, round((vp.parcial - vp.retencion) / vp.cantidad, 4)
    from valorizacion_partidas vp where vp.valorizacion_id = v_val1;
  perform confirmar_precios(v_obra, '900007');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900007';
  v_comp := registrar_comprobante(pr_jir, 'RXH', 'E001', '77', current_date - 4, v_total, round(v_total * 0.08, 2), null, v_ids);
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = v_obra and numero = '900007';
  perform registrar_pago(v_emp, current_date - 2, 'BCP', 'DEMO-5002', jsonb_build_array(jsonb_build_object('comprobante_id', v_comp, 'monto', 2000)));

  -- 900008: clavos, facturada; Tesorería la rechazó y volvió a Logística
  perform crear_orden(v_obra, '900008', pr_for, 'OC', jsonb_build_array(jsonb_build_object('partida_id', p_cla, 'cantidad', 60)));
  perform guardar_precios(v_obra, '900008', (select jsonb_agg(jsonb_build_object('item_id', id, 'pu', 6.40, 'pu_aprobado', null))
                                              from oc_items where obra_id = v_obra and numero_oc = '900008'));
  perform confirmar_precios(v_obra, '900008');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900008';
  perform registrar_comprobante(pr_for, 'FACTURA', 'F002', '1502', current_date - 3, v_total, 0, null, v_ids);
  insert into rechazos (doc, obra_id, numero, motivo, estado_previo, estado_destino, created_by, created_at, correccion)
  values ('OC', v_obra, '900008', 'El precio de los clavos no es el negociado: corregir la cotización',
          'EN_TESORERIA', 'EMITIDA', (select id from auth.users where email = 'tesoreria@erp.local'), now() - interval '1 day', 'PRECIOS');
  -- el rechazo la devuelve a cotización (con su comprobante registrado)
  update ordenes_compra set estado = 'EMITIDA', token_cotizacion = gen_random_uuid(), cotizacion_estado = 'RECIBIDA'
   where obra_id = v_obra and numero = '900008';

  -- 900009: piedra, pagada; falta enviar la constancia al proveedor
  perform crear_orden(v_obra, '900009', pr_cor, 'OC', jsonb_build_array(jsonb_build_object('partida_id', p_pie, 'cantidad', 25)));
  perform guardar_precios(v_obra, '900009', (select jsonb_agg(jsonb_build_object('item_id', id, 'pu', 58.00, 'pu_aprobado', null))
                                              from oc_items where obra_id = v_obra and numero_oc = '900009'));
  perform confirmar_precios(v_obra, '900009');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900009';
  v_comp := registrar_comprobante(pr_cor, 'FACTURA', 'F003', '880', current_date - 5, v_total, 0, null, v_ids);
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = v_obra and numero = '900009';
  perform registrar_pago(v_emp, current_date - 1, 'BCP', 'DEMO-5004', jsonb_build_array(jsonb_build_object('comprobante_id', v_comp, 'monto', v_total)));

  -- 900010: OS de tarrajeo con precio por debajo del presupuesto (ahorro), lista para enviar
  perform crear_orden(v_obra, '900010', pr_jir, 'OS', jsonb_build_array(jsonb_build_object('partida_id', p_tar, 'cantidad', 400)));
  perform guardar_precios(v_obra, '900010', (select jsonb_agg(jsonb_build_object('item_id', id, 'pu', 17.00, 'pu_aprobado', null))
                                              from oc_items where obra_id = v_obra and numero_oc = '900010'));
  perform confirmar_precios(v_obra, '900010');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900010';
  perform registrar_comprobante(pr_jir, 'RXH', 'E001', '81', current_date - 1, v_total, round(v_total * 0.08, 2), null, v_ids);

  -- 900011: OS de la valorización N° 1 (instalaciones sanitarias, 1 GLB), pagada y con la constancia
  -- enviada: queda recibida (su ejecución está en el avance del residente).
  insert into valorizaciones (obra_id, numero, fecha_corte, numero_oc, created_by, created_at)
  values (v_obra, 1, now() - interval '20 days', '900011', v_ops, now() - interval '20 days') returning id into v_val2;
  insert into avances (obra_id, partida_id, fecha, cantidad, estado, valorizacion_id, lat, lng, precision_m, created_by, created_at)
  values (v_obra, p_ins, current_date - 22, 1, 'VALORIZADO', v_val2, -8.1119, -79.0291, 12, v_res, now() - interval '22 days');
  insert into valorizacion_partidas (valorizacion_id, partida_id, cantidad, pu, porcentaje) values (v_val2, p_ins, 1, 2500.00, 5);
  insert into ordenes_compra (obra_id, numero, tipo, proveedor_id, fecha, estado, valorizacion_id, glosa_rhe)
  values (v_obra, '900011', 'OS', pr_jir, current_date, 'EMITIDA', v_val2, 'SERVICIO DE VALORIZACIÓN N° 1 DEMO HOGARIAN');
  insert into oc_items (obra_id, numero_oc, partida_id, cantidad, pu_cotizado)
  select v_obra, '900011', vp.partida_id, vp.cantidad, round((vp.parcial - vp.retencion) / vp.cantidad, 4)
    from valorizacion_partidas vp where vp.valorizacion_id = v_val2;
  perform confirmar_precios(v_obra, '900011');
  select array_agg(id), sum(parcial) into v_ids, v_total from v_oc_items where obra_id = v_obra and numero_oc = '900011';
  v_comp := registrar_comprobante(pr_jir, 'RXH', 'E001', '74', current_date - 14, v_total, round(v_total * 0.08, 2), null, v_ids);
  update ordenes_compra set estado = 'EN_TESORERIA' where obra_id = v_obra and numero = '900011';
  perform registrar_pago(v_emp, current_date - 13, 'BCP', 'DEMO-5005', jsonb_build_array(jsonb_build_object('comprobante_id', v_comp, 'monto', v_total - round(v_total * 0.08, 2))));
  perform enviar_constancia(v_obra, '900011');

  -- Fechas escalonadas para que la bandeja se vea realista
  update ordenes_compra set fecha = current_date - case numero
      when '900001' then 25 when '900002' then 12 when '900003' then 9 when '900004' then 5
      when '900005' then 2 when '900006' then 7 when '900008' then 8 when '900009' then 11
      when '900010' then 4 when '900011' then 18 else 10 end
   where obra_id = v_obra;

  -- Órdenes de pago (las crea Contabilidad): una en Tesorería, una pagada y una rechazada
  perform crear_orden_pago(v_obra, pr_jir, 'Movilidad del personal de obra', 450.00, current_date - 1, '6329');
  perform enviar_op_a_tesoreria((select id from ordenes_pago where obra_id = v_obra and concepto like 'Movilidad%'));
  perform crear_orden_pago(v_obra, pr_cor, 'Alquiler de andamios (2 semanas)', 1200.00, current_date - 8, '6329');
  v_op := (select id from ordenes_pago where obra_id = v_obra and concepto like 'Alquiler%');
  perform enviar_op_a_tesoreria(v_op);
  perform crear_orden_pago(v_obra, pr_cor, 'Flete de retiro de desmonte', 380.00, current_date - 2, '6329');
  insert into rechazos (doc, orden_pago_id, motivo, estado_previo, estado_destino, created_by, created_at)
  select 'OP', id, 'Falta el sustento del flete', 'EN_TESORERIA', 'BORRADOR',
         (select id from auth.users where email = 'tesoreria@erp.local'), now() - interval '6 hours'
    from ordenes_pago where obra_id = v_obra and concepto like 'Flete%';
  perform registrar_pago(v_emp, current_date - 3, 'BBVA', 'DEMO-5003', jsonb_build_array(jsonb_build_object('orden_pago_id', v_op, 'monto', 1200.00)));

  -- Transportistas y una guía pedida a Contabilidad (900003, cotizada)
  insert into transportistas (ruc, razon_social, placa, licencia) values
    ('20605566778', 'TRANSPORTES DEMO NORTE S.A.C.', 'T5X-482', 'Q46812375'),
    ('20481122334', 'CARGA PESADA LA LIBERTAD E.I.R.L.', 'B8K-901', 'Q70219834')
  on conflict (ruc) do nothing;
  update ordenes_compra set requiere_guia = true where obra_id = v_obra and numero = '900003';
  insert into guias (obra_id, numero_oc, punto_partida, punto_llegada, ruc_remitente, transportista_id, ruc_transportista,
                     transportista, placa, licencia, detalle, fecha_traslado, solicitado_by)
  select v_obra, '900003', 'Cantera La Gran Coral, Km 12 carretera Industrial, Trujillo',
         'Obra DEMO HOGARIAN, Calle Los Pinos 145, Víctor Larco, Trujillo',
         (select ruc_o_cod from proveedores where id = pr_cor), t.id, t.ruc, t.razon_social, t.placa, t.licencia,
         (select string_agg(l.cantidad::numeric(12,2) || ' ' || i.unidad || ' ' || i.descripcion, chr(10) order by l.id)
            from oc_items l join partidas p on p.id = l.partida_id join items i on i.id = p.item_id
           where l.obra_id = v_obra and l.numero_oc = '900003'),
         current_date + 2, (select id from auth.users where email = 'logistica@erp.local')
    from transportistas t where t.ruc = '20605566778';

  -- Personas (RRHH): el residente de prueba y una persona de oficina, activos; un alta por aprobar.
  insert into personas (nombre, dni, cargo, telefono, correo, user_id, estado) values
    ('CARLOS MENDOZA RÍOS', '45879612', 'RESIDENTE', '949 112 233', 'residente@erp.local', 'a0000000-0000-4000-8000-000000000005', 'ACTIVA'),
    ('LUCÍA PAREDES VEGA', '41236587', 'OTRO', '987 654 321', null, null, 'ACTIVA'),
    ('JORGE SALAZAR TORRES', '70451236', 'RESIDENTE', '956 300 410', null, null, 'PENDIENTE');
  insert into solicitudes (tipo, persona_id, datos, motivo, solicitado_by, solicitado_at)
  select 'PERSONA_ALTA', id, jsonb_build_object('nombre', nombre, 'dni', dni, 'cargo', cargo, 'telefono', telefono),
         'Residente para la nueva obra', 'a0000000-0000-4000-8000-000000000009', now() - interval '5 hours'
    from personas where dni = '70451236';

  -- Operaciones: un adicional del ingeniero ya revisado por el jefe (en Gerencia), otro esperando al jefe,
  -- y una baja pedida por el jefe.
  insert into solicitudes (tipo, obra_id, datos, motivo, estado, solicitado_by, solicitado_at, revisado_by, revisado_at, revision)
  values ('ADICIONAL', v_obra,
          jsonb_build_object('etapa', 'L1B', 'requerimiento', 'ADIC 1', 'item_id', (select id from items where descripcion = 'YESO 5 KG'),
                             'cantidad', 80, 'pu', 9.50),
          'Resanes no previstos en el presupuesto', 'PENDIENTE', 'a0000000-0000-4000-8000-000000000007', now() - interval '1 day',
          'a0000000-0000-4000-8000-000000000008', now() - interval '20 hours', 'Conforme con el metrado');
  insert into solicitudes (tipo, obra_id, datos, motivo, estado, solicitado_by, solicitado_at)
  values ('ADICIONAL', v_obra,
          jsonb_build_object('etapa', 'L1A', 'requerimiento', 'ADIC 1', 'item_id', (select id from items where descripcion = 'CEMENTO TIPO I'),
                             'cantidad', 40, 'pu', 30.90),
          'Mayor metrado en la losa de L1A', 'POR_JEFE', 'a0000000-0000-4000-8000-000000000007', now() - interval '2 hours');
  insert into solicitudes (tipo, obra_id, partida_id, datos, motivo, solicitado_by, solicitado_at)
  select 'BAJA_PARTIDA', v_obra, p_cab,
         jsonb_build_object('descripcion', i.descripcion, 'unidad', i.unidad, 'etapa', p.etapa, 'cantidad', p.cantidad),
         'El cableado lo asume el subcontrato eléctrico', 'a0000000-0000-4000-8000-000000000008', now() - interval '3 hours'
    from partidas p join items i on i.id = p.item_id where p.id = p_cab;

  -- Obra nueva de Gerencia con el presupuesto en borrador (Gerencia lo está armando)
  insert into obras (nombre, empresa_id, direccion, presupuesto_estado, presupuesto_publicado_at)
  values ('DEMO RESIDENCIAL LAS LOMAS', v_emp, 'Av. Larco 1200, Trujillo', 'BORRADOR', null);
  insert into partidas (obra_id, etapa, requerimiento, item_id, cantidad, pu)
  select (select id from obras where nombre = 'DEMO RESIDENCIAL LAS LOMAS'), x.etapa, 'REGULAR', i.id, x.cantidad, x.pu
    from (values ('L0', 'ARENA GRUESA', 60, 34.00), ('L0', 'PIEDRA BASE 6"', 40, 60.00),
                 ('L1A', 'CEMENTO TIPO I', 800, 30.90), ('L1A', 'ACERO DE 3/8"', 400, 20.80)) as x(etapa, descripcion, cantidad, pu)
    join items i on i.descripcion = x.descripcion;

  -- Residente de prueba
  insert into perfil_obras (user_id, obra_id)
  select id, v_obra from auth.users where email = 'residente@erp.local'
  on conflict do nothing;
end $$;
