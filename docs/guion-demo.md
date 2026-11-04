# Guion de demo — Prod 1 (Logística → proveedor → Tesorería)

Duración: unos 20 minutos (12 en vivo + 8 de casos ya armados). Todo pasa en la obra
**«DEMO TESORERÍA Y LOGÍSTICA (PROD 1)»** (empresa HOGARIAN), que solo tiene lo que se puede llenar en
prod 1. La obra «(MVP)» es la comparación con el sistema completo; no se usa en este guion.

## Antes de empezar

- App en `http://localhost:3100` (desde el celular, en la misma Wi-Fi: `http://<IP de la laptop>:3100`).
- Contraseña de acceso de la demo: la de `DEMO_ACCESO` en `.env.local`.
- Usuarios (clave de los usuarios de prueba, la de `ERP_PASS`): `logistica@erp.local`,
  `tesoreria@erp.local`, `gerencia@erp.local`. En local, la pantalla de ingreso tiene un botón por rol.
- Conviene tener **dos ventanas**: una con Logística y otra en incógnito para el proveedor y luego
  Tesorería (o el celular para el proveedor).
- Para repetir la demo desde cero: «Reinicio de datos» en `docs/prod1.md`.

---

## Parte 1 — Una OC de punta a punta, en vivo

### 1. Logística arma la OC (rol Logística)

1. Barra inferior **OC** → botón **+ Nueva**.
2. Obra: **DEMO TESORERÍA Y LOGÍSTICA (PROD 1)**. Se ven sus partidas de material con «Pedido /
   Presupuesto».
3. Buscar y marcar tres ítems de la etapa **L0**:
   | Ítem | Cantidad | Por qué |
   |---|---|---|
   | CEMENTO TIPO I | 30 | lleva guía (material pesado) |
   | HORMIGON | 10 | Gerencia le marcó **detracción 5 %** |
   | ALAMBRE RECOCIDO N°16 | 20 | ítem chico |
4. **Continuar** → **Proveedor**: el primero sugerido es **FERRETERÍA EL PROGRESO DEMO SAC**, con
   «última orden …»: es quien ya vendió esos ítems. Elegirlo y crear la OC.

Qué remarcar: Logística no escribe precios; la cantidad no puede pasar el saldo de la partida.

### 2. Lo que se manda al proveedor

En la OC recién creada:
- Bloque **Presupuesto** (plegado; se abre y se recuerda): cuánto de la obra está pagado, por pagar en
  Tesorería, en Logística y libre.
- Botón de diseño junto a la campana: los ítems se pueden ver como lista, tabla, por etapa, precios…
- **Link de cotización** → **WhatsApp**, **Telegram** o **Copiar**. Copiar el link.

### 3. El proveedor cotiza (sin usuario)

1. Abrir el link en la ventana de incógnito (o en el celular): ve la OC, los ítems y las cantidades.
2. Llenar **P.U. (inc. IGV)** de cada ítem. Para mostrar la alerta, poner el cemento **caro** (p. ej.
   36.00; el presupuesto es 30.90).
3. **Enviar cotización** → «Cotización enviada».

### 4. Logística revisa y confirma (rol Logística)

1. La OC se actualiza sola: el cemento queda en amarillo con **Sobreprecio**.
2. Marcar **Aprobar sobreprecio** (o bajar el precio) → **Confirmar precios**.
3. **Registrar comprobante**: tipo Factura, serie y número, fecha, total y la foto o el PDF. Como hay
   hormigón con detracción y el total pasa de S/ 700, aparece la **detracción (5 %)**.
4. Guía de remisión: en la misma hoja del comprobante, **Requiere guía de remisión** (es la última vez que
   se decide). Sin guía, el botón dice **«Registrar y enviar a Tesorería»** y la OC pasa directo. Con guía,
   el botón de abajo pasa a **«Falta la guía de remisión»**: la OC **no se envía a Tesorería** sin ella.
5. **Registrar guía**: quién transporta (el proveedor con su unidad), placa, licencia, punto de partida y
   de llegada, N° de guía y la foto o el PDF → **Registrar guía**.
6. Al registrar la guía la OC **pasa sola a Tesorería** (ya no hay que enviarla).

### 5. Tesorería paga (rol Tesorería)

1. **Pagos** → **OC** → **Por pagar**. Arriba: empresa por su logo, obra y Filtros. Mostrar el botón de
   diseño (Lista, Tabla, Por proveedor, Por monto…) y «Fijar filtros arriba».
2. Abrir la OC: datos del proveedor con **banco y cuenta para copiar**, los ítems (probar el diseño
   **Con avance**: cuánto se ejecutó de cada partida) y el bloque Presupuesto.
3. Arriba se ve el **total de la orden**, la **detracción** restando y lo **que se paga**. Formulario: el
   monto viene fijo en el saldo (Tesorería paga siempre la orden completa), fecha, banco, **N° de
   operación** y **voucher** → **Aprobar pago**.
4. Alternativa: **Rechazar** con un motivo; si la orden tiene factura, se puede marcar que el proveedor
   emite factura nueva (la vieja se anula).

### 6. Cierre en Logística (rol Logística)

1. La OC queda **Pagada**. Enviar la **constancia** al proveedor (compartir el voucher o por WhatsApp):
   la OC pasa a **Enviada** (los residentes aún no pueden marcar las entregas).
2. Recepción de lo que llega: **pendiente de definir en prod 1** (no se registra todavía).

---

## Parte 2 — Casos ya armados (abrir y mostrar)

Todas en la obra «(PROD 1)». Logística: **OC** u **OS** → pestaña **Todas**. Tesorería: **Pagos**.

| N° | Rol | Qué mostrar |
|---|---|---|
| 100001 | Logística | OC recién emitida: el link aún no se envió. |
| 100002 | Logística | Link enviado; el proveedor todavía no cotiza (cuántas veces lo abrió). |
| 100003 | Logística | Cotización recibida: falta confirmar precios. |
| 100004 | Logística | Cotización con **sobreprecio** por aprobar. |
| 100005 / 100006 | Logística | Precios confirmados con ítem con detracción: sobre y bajo el mínimo de S/ 700. |
| OS 100007 | Logística | Pestaña «Contrato»: **Firmar contrato** (OS facturada sin contrato firmado). Al subir el firmado va sola a Tesorería. |
| 100008 | Tesorería | OC facturada sin guía: pasó sola a Tesorería. |
| 100009 | Logística | Pestaña «Guía»: **Subir guía** (requiere guía y no está registrada). Al registrarla va sola a Tesorería. |
| 100010 | Tesorería | Por pagar con factura. |
| 100011 | Tesorería | Por pagar con **detracción 5 %**: total de la orden, detracción y lo que se paga. |
| OS 100012 | Tesorería | Servicio con contrato y recibo por honorarios: **retención 8 %**. |
| 100013 | Tesorería | Por pagar con **boleta**. |
| 100014 | Tesorería | Requiere guía y ya la tiene registrada. |
| 100015 | Tesorería / Logística | Dos **rechazos** previos (uno por un documento, reenviado con su nota; otro por la factura): historial de rechazos. |
| OS 100016 | Tesorería | Subcontrato con contrato y factura: **detracción 12 %**. |
| 100017 | Logística | Pagada: falta enviar la constancia al proveedor. |
| 100018 | Logística | Constancia enviada: **Enviada** (sin recepción). |
| 100019 | Logística | Rechazada con factura nueva: espera la factura nueva del proveedor. |
| 100020 | Logística | Rechazada sin anular: vuelve a cotización con su factura. |
| 100021 | Logística | **Anulada**. |
| OS 100022–100026 | Logística / Tesorería | **Mano de obra** (Logística crea la OS directo): emitida, en Tesorería con recibo y con factura, pagada y rechazada. |

Tesorería paga siempre la orden completa: el monto viene fijo en el saldo (no hay pagos parciales).

### Para cerrar (opcional)

- **Tesorería › Presupuesto**: la obra con lo pagado y lo pendiente por partida; la empresa y la obra
  elegidas en Pagos se mantienen al pasar al Presupuesto.
- **Gerencia**: el presupuesto de la obra y las detracciones por ítem.
