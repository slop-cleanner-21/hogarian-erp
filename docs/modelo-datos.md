# Modelo de datos — ERP MVP (Supabase / Postgres 17)

Origen: `CONTROL DE COSTOS V2.2.xlsm`. Migraciones en `supabase/migrations/2026102710*` (schema, views, rpc), `2026102712*` a `2026102715*` (rol RESIDENTE; tesorería por documento, OP y expediente; contactos de proveedores; cuentas de `ITEM.xlsx`) y `20261028*` (etapa 3, ver la última sección).
Seeds: `seed/base.sql` (versionado), `seed/excel.sql` (generado, **no versionado**), `seed/tipo_material.sql`, `seed/cuentas_items.sql` (cuentas de `ITEM.xlsx`), `seed/asignaciones.sql` (obras del residente), `seed/demo.sql` (obra DEMO HOGARIAN).

> Las secciones de abajo describen el modelo de las etapas 1 y 2. Lo que cambió en la etapa 3 (estados, OP, rechazos, entregas, guías, roles, solicitudes) está en la última sección, que manda sobre lo anterior cuando difieren.

## ⚠ Desviaciones y ampliaciones del contrato

Todos los nombres del contrato se mantienen. Diferencias:

| Dónde | Qué |
|---|---|
| `partidas.pu` | **Admite null** (= sin precio presupuestado → sin control de precio, como en el Excel, donde `P.U. MAX` queda vacío). `cantidad` sin dato se carga como 0. `codigo` tiene default `'G' || nextval(partidas_codigo_seq)`. |
| `v_oc_items` | Los nombres que el contrato dejaba ambiguos quedan así: **`partida_codigo`**, `etapa`, `requerimiento`, `descripcion`, `unidad`, `rubro`, **`pu_partida`** (pu de la partida), `pu_max`, **`comprobante`** (texto `serie-numero`). Columnas extra: `item_id`, `estado`, `fecha` (de la orden), `cuenta_contable`, `tipo_material`. |
| `v_pendientes_pago` | Columnas extra: **`origen`** (`'COMPROBANTE'` \| `'ORDEN'`), **`obra_id`, `numero_oc`** (solo en filas `ORDEN`), `retencion`. `saldo = total - retencion - pagado`. |
| `v_ordenes` | Columnas extra: `motivo_anulacion`, `updated_at`. |
| `get_cotizacion` | Claves extra: `tipo`, `empresa_ruc`. Si el token no existe lanza el error `Cotización no encontrada`. |
| `proveedores` | Columna extra `comprobante_excel`, con el valor original de PROVEED.D. |
| `audit_log` | `authenticated` **solo puede leer** (sin insert, update ni delete). Escribe el trigger `fn_audit` (security definer). |
| Vistas extra | `v_comprobantes` (saldo y asiento por comprobante) y `v_oc_items_calc` (base interna de precio efectivo). |
| `tipos_material` | Añadido por pedido posterior: tabla + `items.tipo_material` + columna en `v_partidas` y `v_oc_items`. |
| Cuentas | Las 6 cuentas que usan los asientos automáticos (1041, 40111, 40172, 4212, 4222, 4241) se insertan **en la migración** para que el RPC funcione sin seed. |

## Enums

| enum | valores | origen Excel |
|---|---|---|
| `rubro` | MATERIAL, MANO OBRA, SUBCONTRATO, LOCACION, PROYECTO, FINALIZACION, OTRO | L!B2:B8 (literal, con espacio en `MANO OBRA`) |
| `tipo_comprobante` | FACTURA, RXH, BOLETA, RECIBO_SIMPLE, OTRO | L!B12:B16: `R.HONORARIOS→RXH`, `RECIBO SIMPLE→RECIBO_SIMPLE` |
| `estado_oc` | BORRADOR, EMITIDA, PRECIOS_CONFIRMADOS, FACTURADA, PAGADA, ANULADA | — |
| `tipo_orden` | OC, OS | — |
| `rol` | LOGISTICA, CONTABILIDAD, TESORERIA, ADMIN, RESIDENTE | — |
| `tipo_adjunto` | GUIA, VOUCHER, FOTO, CONTRATO | — |

Mapeo de PROVEED.D a `proveedores.comprobante_habitual`: FACTURA y `'FACTURA '` → FACTURA; RxH y RXH → RXH; BOLETA → BOLETA; RECIBO → RECIBO_SIMPLE; NO APLICA → null; BOL 5CAT y RENTA2DA → OTRO (el valor original queda en `comprobante_excel`).

## Mapeo Excel → tablas

| Hoja / columna | Tabla.columna | Regla |
|---|---|---|
| L!D2:D27 | `requerimientos.codigo` | REGULAR, ADIC 1..25 (orden 0..25) |
| L!F2:F27 | `etapas.codigo` | `grupo` = prefijo (L, ACB, IE, IS) |
| DATOS!B2:C5 | `empresas(nombre, ruc)` | RUC corregido: MARBELEN = 20607600881, ARIANT = 20607590304, ARISANT null |
| DATOS!B12:C25 | `obras(nombre, empresa_id)` | Las 14 obras, también las que no tienen presupuesto |
| ITEMS A/B/C/D/E | `items(numero, descripcion, unidad, rubro, tolerancia_pct)` | Descripción con espacios normalizados (clave única). Las 7 filas de título sin UND ni RUBRO ("MANO DE OBRA PARA …") se omiten |
| PROVEED B/C/D/E/F | `proveedores(ruc_o_cod, razon_social, comprobante_habitual)` + `proveedor_cuentas(banco, cuenta_bancaria)` (solo si tiene alguno de los dos) | Se hace trim. Código duplicado: se conserva la primera fila (como en VLOOKUP). Se quita el `´` inicial de la cuenta |
| GASTOPROG A/C/E/G/J/M/N | `partidas(codigo, obra_id, etapa, requerimiento, item_id, cantidad, pu)` | Valores cacheados. J → `items` por descripción normalizada (si no existe se crea con K/L) |
| GASTOPROG O, P, Q, R, S, T | vista `v_partidas` | `parcial`, `pu_max`, `cant_comprometida`, `monto_ejecutado`, `saldo_cant`, `saldo_monto` |
| GASTOEJEC E (+obra) | `ordenes_compra(obra_id, numero)` | PK (obra, número). Vacío o 'FALTA' → `SN-nnn` por (obra, proveedor, fecha). Si un mismo (obra, número) tiene más de un proveedor, el primero conserva el número y los demás llevan sufijo `-B`, `-C` |
| GASTOEJEC A/C/D/X | `oc_items(partida_id, cantidad, pu_cotizado, pu_aprobado)` | Se omiten las líneas con cantidad 0 o vacía |
| GASTOEJEC B | `ordenes_compra.fecha` = mínima fecha de sus líneas | Fecha de serie Excel (base 1899-12-30) |
| GASTOEJEC F, W | `ordenes_compra.proveedor_id` | Si el proveedor no existe se crea un stub con el nombre de W (en este archivo: 0) |
| GASTOEJEC G/H | `comprobantes(tipo, serie, numero)` | Ver "Comprobantes" |
| GASTOEJEC I | `pagos.numero_operacion` | Ver "Pagos" |
| GASTOEJEC U/V | `v_oc_items.pu_efectivo/parcial` | Regla de precio efectivo |
| FILTRO | vista `v_pendientes_pago` | — |

**Tipo de orden**: OS si el número empieza por `OS` o si todas las líneas son de MANO OBRA o SUBCONTRATO; si no, OC.
**Estado en el seed**: todas las líneas con op. bancaria → PAGADA; si no, todas con comprobante → FACTURADA; si no, PRECIOS_CONFIRMADOS.

**Comprobantes**: H se normaliza a mayúsculas sin espacios y se separa en serie y número; al número se le quitan los ceros a la izquierda (`F001 - 0005702` → `F001`/`5702`). `0` o vacío → sin comprobante. `E001-` → número `S/N`. Se agrupa por (proveedor, serie, número). Para el tipo se usa G (el más frecuente); si G está vacío se usa el comprobante habitual del proveedor, luego RUC 20 + serie E → FACTURA, y por último la serie (E→RXH, F→FACTURA, B→BOLETA, otra→OTRO). `total` = suma del parcial de las líneas; `fecha_emision` = máxima fecha de las líneas; `retencion` = 0. `empresa_id` = empresa de la obra de las líneas.
**Pagos**: se agrupa por (empresa, I normalizado, p. ej. `6185 - 6186` → `6185-6186`). Fecha = máxima fecha de las líneas, banco = banco del proveedor, monto = suma del parcial. Cada pago tiene una aplicación por comprobante, o por orden si la línea no tiene comprobante. El mismo número de operación en empresas distintas da pagos distintos.

## Reglas de negocio

- **Precio efectivo** (Excel U/V): `pu_max = partida.pu * (1 + item.tolerancia_pct)`. `pu_efectivo = pu_cotizado` si `pu_cotizado <= pu_max` (o si `partida.pu` es null); si no, `pu_aprobado`; si este es null, la línea no se valoriza. `parcial = round(cantidad * pu_efectivo, 2)`. Funciones: `fn_pu_max`, `fn_pu_efectivo`.
- **Alerta** `SOBREPRECIO`: `pu_cotizado > pu_max` y `pu_aprobado` null.
- **Comprometido**: suma de `oc_items` de órdenes que no están ANULADA ni BORRADOR.
- **base/igv** (trigger `fn_comprobante_montos`, solo si vienen null): FACTURA → `base = round(total/1.18, 2)` e `igv = total - base`; otros tipos → `base = total` e `igv = 0`.
- **Saldo de un comprobante** = `total - retencion - Σ pago_aplicaciones`.
- **Pagado de una orden** = Σ aplicaciones directas + Σ (parcial de la línea × min(1, pagado_comprobante / neto_comprobante)).
- **Auditoría**: el trigger `fn_audit` actúa sobre ordenes_compra, oc_items, comprobantes, pagos, pago_aplicaciones, asientos e items (solo cuando cambian `cuenta_contable` o `tipo_material`). En los UPDATE, `detalle` guarda `{col: {old, new}}`; `registro` es el id, o `obra_id/numero` en las órdenes. `user_id` = `auth.uid()` (null en anon o seed). Los seeds lo desactivan con `set app.skip_audit = 'on'`.
- **RLS**: está activada en todas las tablas. Política MVP: `authenticated` tiene acceso total (audit_log solo lectura) y `anon` no tiene grants. Las vistas usan `security_invoker`.
- **Storage**: bucket privado `comprobantes` (10 MB; pdf, jpeg, png, webp, xml) con políticas select, insert, update y delete para `authenticated`. Bucket privado `documentos` (15 MB; pdf, jpeg, png, webp, heic, xml) con select, insert y delete para `authenticated` (adjuntos del expediente).
- **Residente**: `es_residente()` y `obras_residente()` (security definer). En `adjuntos` el residente solo inserta FOTO de las obras de `perfil_obras`, solo borra sus propias fotos y no actualiza; el resto de roles tiene acceso total. Las demás tablas siguen permisivas (la restricción por obra se aplica en la app).
- **Periodo de anotación**: `comprobantes.periodo_anotacion` (AAAAMM, ≥ mes de emisión). El trigger `comprobantes_periodo` lo llena con el mes de emisión si viene null. Se cambia con `actualizar_periodo_anotacion` mientras no esté contabilizado.
- **Saldo por documento (Tesorería)**: en efectivo, neto de retención. Parte de un comprobante que corresponde a una orden (`v_orden_comprobantes`): `factor` = parcial de sus líneas / parcial de todas las líneas del comprobante; `neto_orden` = neto × factor; `pagado_orden` = pagos atribuidos a la orden (pagos cuyo VOUCHER apunta a esa orden, como los de `pagar_documento`) + factor × pagos no atribuidos; `saldo_orden` = max(0, min(saldo del comprobante, neto_orden − pagado_orden)). Saldo de la orden = max(0, Σ saldo_orden + parcial sin comprobante − pagos directos a la orden). Con un comprobante de una sola orden, factor = 1.
- **OP**: `numero` = `OP-0001`, correlativo por obra. PENDIENTE → PAGADA (cuando los pagos cubren el monto) o ANULADA (solo sin pagos; motivo obligatorio).

## Tablas (resumen)

`perfiles(user_id→auth.users, nombre, rol)` · `empresas(id, nombre uq, ruc uq)` · `obras(id, nombre uq, empresa_id, estado)` · `etapas(codigo, grupo, orden)` · `requerimientos(codigo, orden)` · `tipos_material(codigo, orden)` · `cuentas_contables(codigo, denominacion, tipo ∈ ACTIVO/PASIVO/PATRIMONIO/GASTO/INGRESO, amarre_debe→, amarre_haber→)` · `items(id, numero, descripcion uq, unidad, rubro, tolerancia_pct, cuenta_contable→, tipo_material→)` · `proveedores(id, ruc_o_cod uq, razon_social, comprobante_habitual, comprobante_excel)` · `proveedor_cuentas(proveedor_id PK→proveedores cascade, banco, cuenta_bancaria, updated_at, updated_by)` (lectura: Logística, Tesorería, Contabilidad, Gerencia y ADMIN; escritura: Logística) · `partidas(id, codigo uq, obra_id, etapa→, requerimiento→, item_id, cantidad, pu, uq(id, obra_id))` · `ordenes_compra(PK(obra_id, numero), tipo, proveedor_id, fecha, estado, token_cotizacion uq, motivo_anulacion, created_by/updated_by, created_at/updated_at)` · `oc_items(id, obra_id, numero_oc, partida_id, cantidad>0, pu_cotizado, pu_aprobado, aprobado_por, comprobante_id; FK(obra_id, numero_oc)→ordenes_compra ON UPDATE/DELETE CASCADE; FK(partida_id, obra_id)→partidas(id, obra_id))` · `comprobantes(id, empresa_id, proveedor_id, tipo, serie, numero, fecha_emision, periodo_anotacion, total, base, igv, retencion, archivo_path, created_by, created_at, uq(proveedor_id, tipo, serie, numero))` · `pagos(id, empresa_id, fecha, banco, numero_operacion, monto>0, …)` · `pago_aplicaciones(id, pago_id, comprobante_id | (obra_id, numero_oc) | orden_pago_id, monto>0; exactamente un destino)` · `asientos(id, empresa_id, fecha, glosa, origen ∈ COMPRA/PAGO, comprobante_id | pago_id; uq parcial por comprobante y por pago)` · `asiento_lineas(id, asiento_id, cuenta→, debe, haber, glosa, amarre, orden; exactamente uno > 0)` · `audit_log(id, user_id, tabla, registro, accion, detalle, created_at)` · `perfil_obras(PK(user_id→auth.users, obra_id→obras))` · `ordenes_pago(id, obra_id, numero uq por obra, proveedor_id, concepto, monto>0, fecha, cuenta_contable→ null, estado ∈ PENDIENTE/PAGADA/ANULADA, motivo_anulacion, created_by, created_at)` · `adjuntos(id, tipo, obra_id, numero_oc, pago_id→pagos cascade, orden_pago_id→, path uq, nombre, mime, created_by, created_at; FK(obra_id, numero_oc)→ordenes_compra; VOUCHER exige pago_id; GUIA/FOTO/CONTRATO exigen la orden)`.

`fn_audit` también audita `ordenes_pago` y `adjuntos`.

### Embeds de PostgREST

Hay una sola FK entre cada par de tablas, así que estos embeds se resuelven sin ambigüedad (lo comprueba `check_db.mjs`):
`pagos → asientos` (asientos.pago_id), `pagos → pago_aplicaciones`, `pagos → adjuntos`, `pago_aplicaciones → ordenes_pago`, `ordenes_pago → proveedores` / `obras`, `ordenes_compra → adjuntos`, `pago_aplicaciones → comprobantes` (comprobante_id), `pago_aplicaciones → ordenes_compra` (FK compuesta (obra_id, numero_oc) → (obra_id, numero)), `ordenes_compra → proveedores`, `comprobantes → proveedores`, `proveedores → proveedor_cuentas` (1:1, devuelve un objeto o null: `proveedores(razon_social, proveedor_cuentas(banco, cuenta_bancaria))`).
Por ejemplo, `pagos.select('*, asientos(id), pago_aplicaciones(monto, comprobantes(proveedores(razon_social)), ordenes_compra(proveedores(razon_social)))')`.
`asientos(id)` devuelve un **array** de 0 o 1 elementos: la unicidad es un índice parcial y PostgREST no la trata como 1:1.

## Vistas (todas `security_invoker`)

| vista | columnas |
|---|---|
| `v_partidas` | id, codigo, obra_id, obra, empresa_id, etapa, requerimiento, item_id, descripcion, unidad, rubro, cantidad, pu, parcial, pu_max, cant_comprometida, monto_ejecutado, saldo_cant, saldo_monto, avance, tipo_material |
| `v_precio_historico_item` | item_id, ultimo_pu, ultima_fecha, pu_promedio, pu_min, pu_max_hist, n_compras (líneas valorizadas de órdenes no anuladas) |
| `v_oc_items` | id, obra_id, numero_oc, partida_id, cantidad, pu_cotizado, pu_aprobado, aprobado_por, comprobante_id, partida_codigo, etapa, requerimiento, item_id, descripcion, unidad, rubro, pu_partida, pu_max, pu_efectivo, parcial, alerta, dif, pu_hist (último pu del ítem **en otras órdenes**), comprobante, estado, fecha, cuenta_contable, tipo_material |
| `v_ordenes` | obra_id, numero, obra, empresa_id, empresa, empresa_ruc, proveedor_id, proveedor, proveedor_ruc, tipo, fecha, estado, token_cotizacion, n_items, total, facturado, pagado, has_alertas, created_at, motivo_anulacion, updated_at, etapas (text[]), tipos_material (text[]), glosa_rhe, contrato_enviado_at |
| `v_pendientes_pago` | empresa_id, empresa, proveedor_id, proveedor, ruc, banco, cuenta_bancaria (de `proveedor_cuentas`, LEFT JOIN: nulos para quien no la lee), origen, comprobante_id, tipo, serie, numero, fecha, obras, ordenes, obra_id, numero_oc, total, retencion, pagado, saldo. Filas `COMPROBANTE`: comprobantes con saldo > 0, con obra_id y numero_oc en null. Filas `ORDEN` ("FALTA comprobante"): **una por orden** en PRECIOS_CONFIRMADOS, FACTURADA o PAGADA; `total` = parcial de las líneas sin comprobante, `pagado` = aplicaciones directas a la orden. Tesorería las paga con `{obra_id, numero_oc, monto}` |
| `v_registro_compras` | empresa_id, empresa, empresa_ruc, periodo (= periodo_anotacion), comprobante_id, tipo, serie, numero, fecha_emision, proveedor_id, proveedor_ruc, proveedor, base, igv, total, retencion, asiento_id, items_sin_cuenta, periodo_emision, cuo (id del asiento o `C<id>`), estado_ple ('0' no FACTURA; '1' FACTURA anotada en su mes; '6' FACTURA anotada en un periodo posterior), destino_igv (DGNG/DNG) |
| `v_por_pagar` | doc ('OC' \| 'OS' \| 'OP'), obra_id, numero, orden_pago_id, empresa_id, empresa, obra, proveedor_id, proveedor, ruc, banco, cuenta_bancaria (de `proveedor_cuentas`, LEFT JOIN), fecha, total, pagado, saldo, n_comprobantes, tiene_contrato, falta_comprobante, estado ('PENDIENTE' \| 'PAGADO'). OC/OS: montos en efectivo (ver «Saldo por documento»), pagado = total − saldo; PENDIENTE = PRECIOS_CONFIRMADOS/FACTURADA con saldo > 0.005; PAGADO = PAGADA (o saldo ya cubierto). OP: PENDIENTE/PAGADA; las ANULADA no aparecen |
| `v_expediente` | comprobante_id, empresa_id, periodo, proveedor, serie, numero, tipo, ordenes ('OC 100325, OS …'), obra_id, numero_oc (primera orden), tiene_archivo, tiene_orden, tiene_guia, tiene_voucher (voucher de un pago al comprobante o a sus órdenes), tiene_fotos, requiere_contrato (alguna OS), tiene_contrato, docs_ok, docs_req. Desde `20261027130000_expediente_opcionales.sql` guía y contrato son opcionales: docs_req = 4 (comprobante, orden, voucher, fotos) |
| `v_orden_comprobantes` (extra) | obra_id, numero_oc, comprobante_id, fecha_emision, parcial, factor, neto, pagado, saldo, neto_orden, pagado_orden, saldo_orden |
| `v_items_sin_cuenta` | item_id, numero, descripcion, unidad, rubro, n_partidas, n_oc_items, monto_comprado |
| `v_comprobantes` (extra) | id, empresa_id, empresa, empresa_ruc, proveedor_id, proveedor, proveedor_ruc, tipo, serie, numero, comprobante, fecha_emision, total, base, igv, retencion, neto, pagado, saldo, asiento_id, archivo_path, created_at |

## RPC (search_path = public; mensajes de error en español)

| función | retorno | notas |
|---|---|---|
| `siguiente_numero_oc(p_obra_id bigint)` | text | máximo número numérico de la obra + 1; si no hay, `'100001'` |
| `crear_orden(p_obra_id bigint, p_numero text, p_proveedor_id bigint, p_tipo tipo_orden, p_items jsonb [{partida_id, cantidad}])` | text (número) | `p_numero` null o vacío → `siguiente_numero_oc`. Crea la orden en estado EMITIDA con fecha de hoy. Bloquea las partidas y valida `cantidad <= saldo_cant` (suma por partida) y que pertenezcan a la obra |
| `get_cotizacion(p_token uuid)` | jsonb `{numero, tipo, obra, empresa, empresa_ruc, proveedor, fecha, estado, items:[{id, descripcion, unidad, cantidad, pu_cotizado}]}` | **SECURITY DEFINER, anon** |
| `enviar_cotizacion(p_token uuid, p_precios jsonb [{item_id, pu}])` | void | **SECURITY DEFINER, anon**. Solo con la orden en EMITIDA; `item_id` = `oc_items.id` |
| `guardar_precios(p_obra_id bigint, p_numero text, p_precios jsonb [{item_id, pu?, pu_aprobado?}])` | void | Solo EMITIDA. Clave ausente = no cambia; `pu_aprobado` null = borra la aprobación. `aprobado_por = auth.uid()` |
| `confirmar_precios(p_obra_id bigint, p_numero text)` | void | Exige que todas las líneas tengan precio y que no quede SOBREPRECIO → PRECIOS_CONFIRMADOS |
| `registrar_comprobante(p_proveedor_id, p_tipo, p_serie, p_numero, p_fecha, p_total, p_retencion, p_archivo_path, p_item_ids bigint[])` | bigint | Las líneas deben ser del proveedor, estar en PRECIOS_CONFIRMADOS o FACTURADA, sin comprobante y de una sola empresa. La serie se pasa a mayúsculas y al número se le quitan los ceros a la izquierda. Una orden con todas sus líneas facturadas pasa a FACTURADA |
| `registrar_pago(p_empresa_id, p_fecha, p_banco, p_numero_operacion, p_aplicaciones jsonb [{comprobante_id, monto} \| {obra_id, numero_oc, monto} \| {orden_pago_id, monto}])` | bigint | monto = suma. Valida empresa y saldo (comprobante: neto - pagado; orden: total - pagado; OP: monto - pagado, solo PENDIENTE). Solo admite pago a orden en PRECIOS_CONFIRMADOS o FACTURADA. Una orden o una OP cubierta al 100% pasa a PAGADA |
| `anular_orden(p_obra_id, p_numero, p_motivo)` | void | Motivo obligatorio. Falla si la orden tiene comprobante o pagos |
| `asignar_cuenta_item(p_item_id bigint, p_cuenta text)` | void | `p_cuenta` null o vacío limpia la cuenta |
| `contabilizar_comprobante(p_comprobante_id)` | bigint (asiento) | Como el voucher de compras. Origen: Debe una línea por ítem a su cuenta por su parte de `base` según el parcial (el residuo a la línea mayor) con la descripción en `glosa`, y 961110102 por el igv; Haber 421210101 por el total (RXH: 424110101 por total - retención y 401720101 por la retención); la diferencia con el total a 759930104 (Haber) o 659910108 (Debe). Amarre (`amarre = true`): por cada Debe de origen, su `amarre_debe`/`amarre_haber`, y el Debe del amarre se amarra a su vez sin volver a la clase 9 |
| `contabilizar_pago(p_pago_id)` | bigint (asiento) | Debe: cuenta de la OP (obligatoria: «Asigne la cuenta contable de la OP …»), 424110101 (RxH) o 421210101 (resto y pagos a órdenes). Haber: 1041 |
| `cambiar_destino_igv(p_comprobante_id, p_destino)` | void | DGNG o DNG de una factura con IGV para el TXT del SIRE (Contabilidad) |
| `crear_orden_pago(p_obra_id, p_proveedor_id, p_concepto, p_monto, p_fecha, p_cuenta)` | text (OP-0001) | `p_fecha` null → hoy; `p_cuenta` null o vacía → sin cuenta |
| `anular_orden_pago(p_id, p_motivo)` | void | Solo PENDIENTE y sin pagos; motivo obligatorio |
| `pagar_documento(p_obra_id, p_numero, p_orden_pago_id, p_fecha, p_banco, p_numero_operacion, p_monto, p_voucher_path, p_voucher_nombre)` | bigint (pago) | «Aprobar pago». Exige N° de operación y voucher. Destino: (obra_id, numero) **o** orden_pago_id. En OC/OS reparte el monto sobre el `saldo_orden` de sus comprobantes (del más antiguo al más reciente) y el resto va como pago directo a la orden; el tope es el saldo de `v_por_pagar`. Llama a `registrar_pago`, crea el adjunto VOUCHER (con la orden, o con orden_pago_id) y pasa la orden a PAGADA si su saldo queda en 0 |
| `actualizar_periodo_anotacion(p_comprobante_id, p_periodo)` | void | AAAAMM, ≥ mes de emisión, solo si no está contabilizado |

`execute` está concedido a `authenticated` y `service_role`; a `anon` solo en las dos funciones de cotización.

## Anomalías encontradas (extract_excel.py)

- DATOS: MARBELEN tenía el RUC de ARIANT; se corrigió a 20607600881.
- ITEMS: 678 filas con descripción. Se omiten 7 títulos; quedan 671 sin duplicados (73 tenían espacios sobrantes).
- PROVEED: 265 filas con 8 códigos duplicados (se conserva la primera fila) → 257 proveedores. Hay códigos no-RUC (DNI, `CAJA1`, `/73390078`, …).
- GASTOPROG: G4351–G4360 sin CANT ni P.U. (cantidad 0, pu null); G5836, G5847 y G5849 sin P.U. (pu null: sin control de precio, como en el Excel).
- GASTOEJEC: 3475 líneas → 3474 (1 con cantidad 0: fila 1885). La fila 1505 no tiene fecha y toma la de la fila anterior. La fila 2020 tiene sobreprecio sin aprobar y no se valoriza (también es 0 en el Excel). Las filas 2396, 2397, 2474, 2475 y 2696 tienen N° de comprobante `0` (se tratan como sin comprobante). Las filas 3324 y 3328 tienen `E001-` (se cargan como S/N).
- Seis (obra, número) con 2 proveedores → sufijo `-B`. Ocho grupos sin número → `SN-001…008`. La orden `1000139` (VIRGEN DEL MAR) parece un error de tipeo de 100139: por eso `siguiente_numero_oc` de esa obra devuelve **1000140** hasta que se corrija.
- Comprobantes: 12 sin TIPO de AGREGADOS LA GRAN CORAL (serie E001) se infieren FACTURA por su comprobante habitual. E001-50 (RxH) abarca obras de HOGARIAN y ARIANT (se asigna a ARIANT). 10 comprobantes abarcan varias órdenes (la mayoría con el mismo número de orden en MERCEDES A y B).
- Op. bancarias: el mismo número aparece en empresas distintas (11 casos; son pagos distintos). Solo la operación `6731-6733` paga 2 comprobantes.
- Validación contra GASTOPROG Q/R: 0 diferencias en cantidad. 1 diferencia en monto (G1607: 8514.83 vs 8514.92), por el redondeo a 2 decimales por línea frente al float del Excel. Total ejecutado: 3,036,771.28 (BD) frente a 3,036,771.02 (Excel).

## Regenerar y validar

```bash
python -I scripts/extract_excel.py "<ruta>/CONTROL DE COSTOS V2.2.xlsm" supabase/seed/excel.sql --check-json <tmp>/check.json
# sin Docker: PGlite instalado en cualquier carpeta (npm i @electric-sql/pglite)
node scripts/check_db.mjs --pglite-dir <carpeta con node_modules> --check-json <tmp>/check.json
# con Docker: npx supabase db reset
```


## Etapa 3: flujo completo, entregas, guías y roles nuevos

Migraciones `20261028100000` a `20261028170100`.

### Enums

| enum | cambio |
|---|---|
| `estado_oc` | + `EN_TESORERIA` (después de FACTURADA), `EN_ENTREGA` y `RECIBIDA` (después de PAGADA). FACTURADA pasa a significar «Por enviar»: tiene comprobante pero aún no se envió a Tesorería |
| `rol` | + `GERENCIA`, `OPERACIONES` (Ingeniero de Operaciones), `OBRAS` (en desuso desde el 29/10), `RRHH`, `JEFE_OPERACIONES` |
| `cotizacion_estado` (nuevo) | `SIN_ENVIAR`, `ENVIADA`, `RECIBIDA` |

**Ciclo de la OC/OS:** `EMITIDA → PRECIOS_CONFIRMADOS → FACTURADA → EN_TESORERIA → PAGADA → EN_ENTREGA → RECIBIDA`.
- Si Tesorería rechaza, la orden pasa de `EN_TESORERIA` a `FACTURADA`.
- La orden se puede anular (`ANULADA`) mientras no tenga comprobante ni pagos.

**Ciclo de la OP:** `BORRADOR → EN_TESORERIA → PAGADA`.
- Si Tesorería la rechaza, vuelve a `BORRADOR`.
- Se puede anular (`ANULADA`) mientras no tenga pagos.

### Tablas nuevas o cambiadas

| tabla | columnas / reglas |
|---|---|
| `ordenes_compra` | Columnas nuevas: `cotizacion_estado`, `cotizacion_enviada_at`, `cotizacion_recibida_at` y `requiere_guia`. `token_cotizacion` admite null: al salir de EMITIDA, el trigger `ordenes_compra_vencer_cotizacion` lo borra y el link vence |
| `cotizacion_accesos` | token, obra_id, numero, accion (`VER`/`ENVIAR`), ok, created_at. Solo la escriben `get_cotizacion` y `enviar_cotizacion`. Sirve para el límite de intentos y para contar las veces que se abrió el link |
| `ordenes_pago` | estado ∈ `BORRADOR`, `EN_TESORERIA`, `PAGADA`, `ANULADA`, con default BORRADOR (antes: PENDIENTE/PAGADA/ANULADA) |
| `rechazos` | doc (OC/OS/OP), obra_id + numero **o** orden_pago_id, motivo, estado_previo, estado_destino, created_by, created_at |
| `notificaciones` | user_id, tipo, titulo, cuerpo, href, leida_at, push_enviado_at. RLS: cada usuario ve, marca y borra solo las suyas. Está en la publicación de Realtime |
| `push_suscripciones` | user_id, endpoint uq, p256dh, auth. Una por dispositivo |
| `entregas` | obra_id, numero_oc, oc_item_id, cantidad > 0, rol, lat, lng, precision_m, capturado_en (hora del dispositivo), created_by, created_at (hora del servidor). Solo se escribe con `registrar_entrega` |
| `entrega_fotos` | entrega_id (cascade), path uq. Las fotos van al bucket `documentos`, prefijo `entregas/<obra>/` |
| `transportistas` | ruc uq (11 dígitos), razon_social, placa, licencia |
| `guias` | Una vigente por orden (obra_id + numero_oc). Estado ∈ `SOLICITADA`, `EMITIDA`, `ANULACION_PENDIENTE`, `ANULADA`.<br>Datos del traslado: punto_partida, punto_llegada, ruc_remitente, transportista (id, RUC y razón social copiados), placa, licencia, detalle y fecha_traslado.<br>Al emitirse: numero_guia y archivo_path. Fechas de solicitud, emisión y anulación |
| `obras` | Columnas nuevas: `direccion`, `presupuesto_estado` (`BORRADOR`/`PUBLICADO`) y `presupuesto_publicado_at`. Las obras del Excel nacen publicadas; las que crea Gerencia, en borrador |
| `personas` | nombre, dni uq (8 dígitos), cargo (`RESIDENTE`/`OTRO`), telefono, correo, user_id uq (usuario de acceso), estado (`PENDIENTE`/`ACTIVA`/`BAJA`) |
| `solicitudes` | tipo ∈ `ADICIONAL`, `BAJA_PARTIDA`, `PERSONA_ALTA`, `PERSONA_CAMBIO`, `PERSONA_BAJA`; obra_id, partida_id, persona_id; datos (lo que se propone, o una copia de la partida que se da de baja); motivo; estado (`PENDIENTE`/`APROBADA`/`RECHAZADA`); respuesta; solicitado_by/at y resuelto_by/at |
| `adjuntos` | Las guías (GUIA) solo las insertan, borran o cambian Contabilidad y Admin (`mi_rol()`) |
| `datos_demo` | tabla, registro_id, archivo, created_at; único (tabla, registro_id). Marca los archivos generados para la demo (comprobantes y vouchers simulados) para quitarlos al migrar los datos reales |
| `ordenes_compra` (29/10) | `glosa_rhe` (concepto del recibo por honorarios de la OS; `glosa_rhe_defecto` lo arma al confirmar precios) y `contrato_enviado_at`. RPC `guardar_glosa_rhe` y `enviar_contrato`. `enviar_a_tesoreria` exige un adjunto CONTRATO en la OS. `crear_orden` llena `pu_cotizado` con el P.U. del presupuesto en la OS, y `get_cotizacion` solo muestra al proveedor los precios que él envió |
| `solicitudes` (29/10) | estado suma `POR_JEFE` (adicional del Ingeniero esperando al Jefe); columnas `revisado_by`, `revisado_at`, `revision` |
| `v_seguimiento_partida` (29/10) | Por partida: `presupuestado`, `por_pedir`, `en_logistica` (EMITIDA…FACTURADA), `en_tesoreria` (EN_TESORERIA, PAGADA), `por_recibir` (en entrega, sin cerrar), `recibido` (entregas), `pu` y `grupo` (`MATERIALES` = MATERIAL, `MANO_OBRA` = MANO OBRA, `SUBCONTRATOS` = el resto). Sin datos de órdenes ni proveedores |
| `obra_etapas` (29/10) | obra_id, etapa, orden. Orden de las etapas por obra; un trigger agrega cada etapa nueva con el orden general. RPC `ordenar_etapas_obra` (Jefe de Operaciones). `fn_orden_etapa(obra, etapa)` |
| `requerimientos_obra` (29/10) | obra_id, numero (REQ-001 por obra), nota, estado (`VIGENTE`/`ANULADO`), created_by/at, anulado_by/at, motivo_anulacion. (`requerimientos` ya existía: es el catálogo REGULAR / ADIC n) |
| `requerimientos_obra_items` (29/10) | requerimiento_id, partida_id, cantidad |
| `adelantos` (29/10) | obra_id, item_id, partida_origen_id (etapa posterior que presta), partida_destino_id (la que recibe), cantidad, requerimiento_id |
| `v_presupuesto_efectivo` (29/10) | Por partida: cantidad + adelantos recibidos − adelantos dados (de requerimientos vigentes). Lo usan `v_partidas` (`cantidad_efectiva`, `adelanto_recibido`, `adelanto_dado`; el saldo y el avance son contra lo efectivo), `crear_orden` y `guardar_partidas` |
| `v_requerimiento_items` (29/10) | Línea de requerimiento vigente con `requerido`, `atendido` (lo comprometido de la partida repartido primero a los más antiguos) y `pendiente` |
| RPC `crear_requerimiento(obra, nota, lineas)` / `anular_requerimiento(id, motivo)` | Operaciones. Valida que lo requerido no supere el presupuesto efectivo y que los adelantos cubran exactamente lo que falta, del mismo ítem y de etapas posteriores con saldo. Anular revierte los adelantos salvo que ya se haya comprado lo adelantado |
| `auth.users.raw_app_meta_data` | `rol` y `nombre`, copiados desde `perfiles` por el trigger `perfiles_a_token`: viajan en el JWT y la app no consulta el perfil en cada pantalla |

### Vistas nuevas o cambiadas

| vista | qué |
|---|---|
| `v_oc_items_calc` | En una OS la tolerancia es 0: el máximo es el precio presupuestado |
| `v_por_pagar` | OC/OS: solo `EN_TESORERIA` (PENDIENTE) y `PAGADA`/`EN_ENTREGA`/`RECIBIDA` (PAGADO). OP: `EN_TESORERIA`/`PAGADA`. Columna nueva `etapas text[]` (etapas de las líneas, para filtrar) |
| `v_rechazos` | Historial de rechazos con obra, empresa, proveedor y número |
| `v_entregas_item` | Por línea de orden: pedido y entregado |
| `v_avance_partida` | Por partida: presupuestado, pu, parcial; comprado y monto comprado (en órdenes no anuladas); llegado; n° de fotos |
| `v_expediente` | `tiene_fotos` también cuenta las fotos de las entregas, y `tiene_guia` cuenta la guía emitida |

### RPC nuevas o cambiadas

| función | quién | qué hace |
|---|---|---|
| `get_cotizacion(token)` | anon | Responde `{disponible: false}` si el link no existe, venció o todavía no se envió. Registra el acceso y aplica el límite de intentos |
| `enviar_cotizacion(token, precios)` | anon | Solo con la cotización `ENVIADA`. Exige todos los precios y la deja `RECIBIDA`; un trigger avisa a Logística |
| `marcar_cotizacion_enviada`, `reenviar_cotizacion` | Logística | Compartir el link deja la cotización ENVIADA; reenviar genera un token nuevo |
| `enviar_a_tesoreria(obra, numero)` | Logística | FACTURADA → EN_TESORERIA. En una OS avisa a Tesorería si algún precio difiere del presupuesto |
| `rechazar_documento(obra, numero, op, motivo)` | Tesorería | La orden vuelve a FACTURADA (OC/OS) o a BORRADOR (OP). Guarda el rechazo y avisa |
| `enviar_constancia(obra, numero)` | Logística | PAGADA → EN_ENTREGA |
| `registrar_pago`, `pagar_documento` | Tesorería | Solo aceptan documentos `EN_TESORERIA` |
| `enviar_op_a_tesoreria(id)` | Contabilidad | BORRADOR → EN_TESORERIA |
| `registrar_entrega(oc_item, cantidad, fotos[], lat, lng, precision, capturado)` | Logística, Residente | No deja pasar de lo pedido. El residente necesita tener la obra asignada y enviar GPS. Al completarse todas las líneas, la orden pasa a RECIBIDA |
| `set_requiere_guia`, `solicitar_guia` | Logística | Solo OC. La guía se pide con la orden cotizada y se puede corregir hasta que se emita |
| `emitir_guia`, `marcar_guia_anulada` | Contabilidad | Se emite con N° y archivo. La anulación cierra las guías de OC anuladas |
| `anular_orden` | Logística | Si la guía ya estaba emitida, la pasa a ANULACION_PENDIENTE y avisa a Contabilidad |
| `asignar_cuenta_items(ids[], cuenta)` | Contabilidad | Asigna la misma cuenta a varios ítems |
| `guardar_obra` | Gerencia | Crea una obra (en borrador) o la edita |
| `guardar_partidas(obra, partidas, eliminar[])` | Gerencia | Altas, cambios y bajas de partidas. No deja una cantidad por debajo de lo comprado ni quitar partidas con órdenes |
| `publicar_presupuesto(obra)` | Gerencia | BORRADOR → PUBLICADO; avisa a Operaciones (Ingeniero y Jefe) |
| `asignar_persona_obra(obra, persona, asignar)` | Jefe de Operaciones, Gerencia | Solo personas ACTIVAS con usuario. Escribe en `perfil_obras` |
| `solicitar_adicional` | Ingeniero y Jefe de Operaciones | Ítems de los 3 presupuestos (desde el 30/10). El del Ingeniero queda `POR_JEFE`; el del Jefe, `PENDIENTE` (Gerencia) |
| `revisar_solicitud(id, aprobar, comentario)` | Jefe de Operaciones | `POR_JEFE` → `PENDIENTE` (avisa a Gerencia) o `RECHAZADA` (avisa al Ingeniero). Guarda `revisado_by/_at` y `revision` |
| `solicitar_baja_partida(partida, motivo, cantidad?)` | Jefe de Operaciones | Con `cantidad`: baja de lo que falta (`fn_faltante_partida`); al aprobarla se reduce `partidas.cantidad`. Sin ella: toda la partida, sin compras pagadas; al aprobarla se anulan sus órdenes |
| `solicitar_persona(tipo, persona, datos, motivo)` | RRHH | ALTA crea la persona en PENDIENTE; CAMBIO y BAJA se piden sobre personas activas |
| `resolver_solicitud(id, aprobar, respuesta)` | Gerencia | Si se aprueba, la aplica. En ambos casos avisa a quien la pidió |
| `notificar(rol, …)`, `notificar_usuario(user, …)` | interno | Crean avisos. El push lo envía la app con `enviarAvisosPendientes` (`src/lib/push.ts`) |


### Decisiones de los product owners (`20261028180000_decisiones_po.sql`)

| Tema | Cambio |
|---|---|
| Rechazo de Tesorería | `rechazar_documento` devuelve la OC/OS a `EMITIDA` (cotización), con un token nuevo y la cotización `RECIBIDA`. `confirmar_precios` la pasa directo a `FACTURADA` si todas sus líneas ya tienen comprobante |
| Corrección de comprobantes | `editar_comprobante(id, tipo, serie, numero, fecha, total, retencion, archivo, motivo)`, solo para Logística y solo si el comprobante no está contabilizado ni pagado. Cada cambio guarda antes y después en `comprobantes_historial(comprobante_id, anterior, nuevo, motivo, editado_by, editado_at)` |
| Guía obligatoria | Trigger `pago_aplicaciones_exige_guia`: ningún pago a una OC con `requiere_guia` (directo o por sus comprobantes) sin guía `EMITIDA`. `v_por_pagar.falta_guia` |
| Modalidad de transporte | `guias.modalidad` ∈ `PROVEEDOR` (su unidad), `PROPIO` (nuestro transporte), `TERCERO` (transportista contratado por el proveedor). El transportista solo se elige en `TERCERO`; en los otros casos se toman el RUC y el nombre del proveedor o de la empresa |
| Entrega incompleta | `cerrar_entrega(obra, numero, motivo)` (Gerencia): `EN_ENTREGA → RECIBIDA` con `ordenes_compra.entrega_cerrada_at/_motivo/_by`. En `v_partidas`, `v_avance_partida` y `crear_orden` esa orden cuenta solo lo entregado, así que el resto vuelve al saldo |
| Baja de partida con órdenes | `solicitar_baja_partida` solo se bloquea con compras pagadas. Al aprobarla, `resolver_solicitud` anula las órdenes; no puede si alguna tiene comprobante o pagos. La partida se marca `dada_de_baja_at`, o se borra si nunca tuvo órdenes. Las vistas de presupuesto la ocultan |
| Personas | `actualizar_contacto_persona(id, telefono, correo)` (RRHH, sin aprobación). `asignar_persona_obra`: Jefe de Operaciones o Gerencia |

### Mano de obra, retenciones, solicitudes con sustento y cierre de obra (31/10)

Migraciones `20261031100000` a `20261031160000`.

| Objeto | Qué es |
|---|---|
| `entregas.observacion` | Texto de una entrega «con observación». `registrar_entrega(…, p_observacion)` avisa a Logística y Operaciones |
| `retenciones(obra_id, item_id, porcentaje)` | Retención (%) de cada ítem de mano de obra por obra; sin fila, 5 %. `fn_retencion(obra, item)`, `guardar_retenciones(obra, jsonb)` (Gerencia) |
| `avances` | Avance de mano de obra del residente: obra, partida, fecha, cantidad, observación, estado (`REGISTRADO`, `OBSERVADO`, `VALORIZADO`), observación de Operaciones, valorización, `reemplaza_id`, GPS. Fotos en `avance_fotos(avance_id, path)` (`documentos/avances/{obra}/…`) |
| `valorizaciones(obra_id, numero, fecha_corte, numero_oc)` | Una por corte; `valorizacion_partidas(valorizacion_id, partida_id, cantidad, pu, porcentaje, parcial, retencion)` guarda el detalle con el % del momento |
| `ordenes_compra.valorizacion_id`, `es_retencion` | OS creada desde una valorización o la OS de retención de la obra. La de retención suma en montos pero no en cantidades (`v_partidas`, `v_avance_partida`, `fn_comprometido_partida`, `crear_orden`, `guardar_partidas`) |
| `obras.estado` | Ya existía (`EN_EJECUCION`); `CERRADA` al cerrar la obra, con `cerrada_at` y `cerrada_by` |
| `solicitud_adjuntos(solicitud_id, path, nombre, mime)` | Sustento de adicionales y bajas (`documentos/solicitudes/{id}/…`, sin SVG). `adjuntar_solicitud(id, jsonb)` |
| `v_seguimiento_partida` | + `ejecutado_sin_valorizar`, `valorizado_sin_pagar`, `valorizado_pagado`, `retencion_acumulada`. Las OS de valorización y de retención no entran en sus tramos de órdenes |
| `v_retencion_obra` | Retención de cada obra de valorizaciones con OS pagada y su OS de retención, si existe |
| `partidas.faltante` (campo calculado) | `fn_faltante_partida`: lo que se puede dar de baja (efectivo − máx(comprometido + avance sin OS, requerido)), nunca más que la cantidad |

| RPC | Quién | Regla |
|---|---|---|
| `registrar_avance(partida, cantidad, fecha, fotos[], observacion, gps…, reemplaza_id)` | Residente | Partida de mano de obra de su obra, con GPS y fotos, fecha no futura, sin pasar del presupuesto efectivo (lo observado no cuenta) |
| `observar_avance(id, texto)` | Ingeniero y Jefe de Operaciones | Solo `REGISTRADO`; avisa al residente |
| `valorizar(obra)` | Ingeniero y Jefe de Operaciones | Todo lo `REGISTRADO` pasa a la valorización N° n con el % de cada ítem; avisa a Logística. Exige P.U. en las partidas |
| `crear_orden_valorizacion(valorizacion, numero, proveedor)` | Logística | OS con las partidas y cantidades valorizadas y P.U. = neto / cantidad; queda en precios confirmados con glosa «Servicio de valorización N° n …» |
| `crear_orden_retencion(obra, numero, proveedor)` | Logística | Solo con la obra cerrada y todas sus valorizaciones pagadas: una línea por partida con lo retenido. No exige contrato |
| `mo_partidas(obra)` | Todos (el residente, solo sus obras) | Partidas de mano de obra con su avance (lee la vista como su dueño) |
| `cerrar_obra(obra)` | Gerencia | Sin avance sin valorizar. Reduce cada partida en lo que falta y marca la obra `CERRADA`; avisa a Logística (retención por pagar) y Operaciones. Después no se crean requerimientos, órdenes, adicionales ni avances |
| `enviar_constancia` | Logística | La OS de valorización o de retención pasa de PAGADA a RECIBIDA (sin entregas) |
| `crear_orden` | Logística | Rechaza partidas de mano de obra y obras cerradas |

