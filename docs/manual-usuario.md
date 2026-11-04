# Manual de usuario

Hogarian ERP se usa desde el celular (también funciona en escritorio y se puede instalar como app). Cada persona entra con su usuario y ve solo su módulo.

En todas las pantallas:
- La **campana** de la barra superior muestra los avisos sin leer, y el **avatar** abre el menú: tema claro, oscuro o del sistema, y cerrar sesión. En **Avisos**, cada aviso tiene su ✕ para borrarlo, y «Limpiar todo» los borra todos.
- Las listas tienen **búsqueda** y el botón **Filtrar y ordenar**. Los filtros activos aparecen como chips, cada uno con su ✕; con dos o más, aparece «Limpiar».
- La app **recuerda** los filtros de cada lista, la pestaña elegida y la última pantalla abierta. En Logística, los filtros se comparten entre OC y OS.
- Las **fotos** (entregas, vouchers, comprobantes, guías) se abren en un visor dentro de la app: ✕ o el botón atrás del teléfono lo cierran. Los PDF se abren en otra pestaña; en la app instalada se descargan.
- Todos los desplegables tienen **buscador**.

---

## Logística

**Inicio:** OC y OS en la barra inferior. Las pestañas son *Pendientes* (lo que espera una acción tuya), *Tesorería*, *Recibidas* y *Todas*. Filtros: estado, obra, etapa, tipo de material, fecha, proveedor y sobreprecio. **Nueva** abre la orden con la obra que tengas filtrada.

**Nueva orden** (botón flotante):
1. Elige la obra (si venías filtrando una obra, ya viene elegida).
2. Marca las partidas: en *Pendientes* están las que aún tienen saldo; en *Completas*, las ya pedidas. Puedes filtrarlas por etapa, requerimiento y tipo de material.
3. Revisa las cantidades (por defecto, el saldo) y elige el proveedor. Primero aparecen los que **ya vendieron esos ítems** (con la marca «Ya lo vendió» o «Vendió N de M» y la fecha de su última orden), luego los que venden ese tipo de material. Si el proveedor no existe, **+ Nuevo proveedor** al final de la lista lo crea y lo deja elegido.
4. En una OC, marca **Requiere guía de remisión** si corresponde.
5. Confirma.

**Detalle de la orden**, según su estado:

| Estado | Qué haces |
|---|---|
| Cotizando | **Link de cotización**: envíalo por WhatsApp o Telegram, o cópialo. El bloque muestra si la cotización está *Sin enviar*, *Enviada* (con las veces que se abrió) o *Recibida*. También puedes escribir los precios tú mismo. Si un precio supera el máximo, apruébalo explícitamente. **Confirmar precios** cierra la cotización y el link vence. Si el proveedor debe corregir, usa **Reenviar para corregir** (el link anterior deja de funcionar) |
| Por facturar | En una OS, el bloque **Contrato**: concepto del recibo por honorarios (editable y copiable), PDF del contrato (compartir, ver, descargar), envío al proveedor por WhatsApp o Telegram y **Subir** el contrato firmado. Sin el firmado no se puede enviar a Tesorería. Si la OC lleva guía, **Solicitar guía**: Logística llena todos los datos de la guía; Contabilidad solo la emite en SUNAT y sube el PDF. Un transportista nuevo se crea desde el mismo selector. Datos: quién transporta (el proveedor con su unidad, nuestro transporte o un transportista contratado por el proveedor), puntos de partida y llegada, placa, licencia y fecha. Si el transporte es de un transportista, al elegirlo se completan su placa y su licencia. Luego **Registrar comprobante**: el tipo se recuerda por OC/OS, y el habitual del proveedor tiene prioridad |
| Por enviar | **Enviar a Tesorería**. En una OS, la confirmación muestra los precios que difieren del presupuesto |
| En Tesorería | Esperar el pago (o el rechazo, que llega como aviso) |
| Pagada | **Constancia de pago**: WhatsApp (con los datos del pago) o Compartir (con el voucher). La orden pasa a *En entrega* |
| Rechazada | Si Tesorería rechaza, la orden **vuelve a Cotizando** con el motivo en rojo. Si Tesorería pidió **factura nueva**, la factura queda anulada y se registra la nueva; si no, el comprobante se conserva y el lápiz permite corregirlo (cada corrección queda en su historial). Luego se confirman los precios (pasa directo a *Por enviar*) y se reenvía. **Rechazos (N)** muestra todos los rechazos de la orden |
| En entrega | **Entregas**: avance por ítem; **Registrar entrega** con ítem, cantidad y fotos de la galería o de la cámara |
| Recibida | Solo consulta. Si Operaciones cerró la entrega incompleta, se muestra el aviso con el motivo |

Además, desde el detalle:
- **Orden de compra / servicio:** compartir, ver o descargar el PDF. La OC no lleva precios; la OS sí.
- **Anular** (menú ⋮): mientras la orden no tenga comprobante ni pagos.

**Comprobante con detracción:** si la orden tiene ítems que Gerencia marcó con detracción, al registrar una **factura** aparece **Detracción** con el monto calculado; se corrige si la factura dice otro. Tesorería pagará el total menos la detracción.

**Pago:** con la orden pagada, *Constancia de pago* (abierta) para enviarla al proveedor; en las etapas siguientes sigue disponible como **Pago**, plegado.

**Mano de obra por ordenar** (arriba en Requeridos): cada valorización de Operaciones sin OS y, en las obras cerradas, la retención por pagar. **Crear OS** pide el beneficiario; las líneas, cantidades y P.U. netos de retención vienen fijos. La OS queda con precios confirmados y sigue como cualquier OS (contrato, comprobante, Tesorería); al enviar la constancia queda recibida. La OS de retención no lleva contrato. En **Nueva OS** ya no aparece la mano de obra.

**Requeridos** (primero en la barra): los requerimientos de Operaciones, con lo pendiente primero; filtros por obra, estado, presupuesto y etapa. Cada uno tiene **Atender con una OC / OS**: abre la nueva orden directo en el paso de proveedor, con las partidas y cantidades que faltan (los materiales van en OC y los servicios en OS; si hay de ambos, un botón para cada uno). Las cantidades se pueden ajustar y la orden no queda vinculada al requerimiento: lo atendido se recalcula por partida. En **Nueva OC/OS**, las partidas requeridas muestran «Requerido N» y el botón *Requeridas por Operaciones* las filtra. El presupuesto de cada partida ya incluye los adelantos.

**Proveedores / Transportistas:** dos pestañas.
- *Proveedores:* contactos con WhatsApp y Telegram, y qué tipos de material vende cada uno.
- *Transportistas:* RUC, razón social, placa y licencia.

**Ítems:** materiales y servicios, con su tipo de material. Al final del selector de tipo, **+ Nuevo tipo** crea uno; también desde «Vende» en la ficha del proveedor.

**OS:** nace con el precio del presupuesto en cada línea; basta con **Confirmar precios** si nada cambió. La diferencia con el presupuesto se ve en una línea, por ejemplo «+0.10 (+4.5 %)».

---

## Contabilidad

Barra inferior: **OP · Pagos · Compras · Guías · Cuentas**. Al entrar se abre OP.

- **Cuentas:** asignar la cuenta contable a los ítems. La pestaña **Plan** es el plan de cuentas: toca una cuenta para ponerle nombre (las importadas llegan «Sin denominación», resaltadas), cambiar su tipo, su **amarre** (cuenta de Debe y de Haber) y ver la lista de ítems que la usan; **Nueva cuenta** agrega una.
  - **En el celular:** toca un ítem para elegir su cuenta, o marca varios (o «Seleccionar todo lo filtrado») y usa «Asignar cuenta a N».
  - **En escritorio:** es una grilla. ↑↓ para moverte, Enter para elegir la cuenta y Espacio para seleccionar. Shift o Ctrl + clic seleccionan varias filas. Ctrl+C copia la cuenta y Ctrl+V la pega en la fila o en todas las seleccionadas. Cada descripción tiene su botón para copiarla.
- **Compras:** registro de compras por empresa y periodo.
  - **Hoja de cada comprobante:** artículos con su cuenta, P.U. y cantidad; el expediente (comprobante, orden, voucher, fotos y guía); el periodo de anotación; en facturas con IGV, **IGV destinado a** (operaciones gravadas y no gravadas, o no gravadas: va al TXT del SIRE); la descarga del **ZIP**; y **Contabilizar**, que genera el asiento.
  - **El asiento**, como el voucher de compras: *Cuentas de origen* (cada ítem a su cuenta 9, el IGV a la 961110102, el total a la 421210101 o, en honorarios, a la 424110101 y la 401720101, y el redondeo) y *Cuentas de amarre* (las del plan de cada cuenta), cada bloque con su subtotal.
  - **Arriba:** empresa, periodo y el botón de filtros en una sola línea. El ícono de **descarga** abre la lista de lo filtrado, todo marcado: desmarca lo que no quieras y baja el **TXT del SIRE** (registro de compras 080400, solo facturas y boletas) o el **ZIP** de expedientes de lo marcado.
- **OP:** órdenes de pago.
  - **Crear una OP:** botón flotante; se indican obra, beneficiario, concepto, monto, fecha y cuenta.
  - **Enviarla a Tesorería:** desde la OP en borrador.
  - **Si Tesorería la rechaza:** vuelve a *Borrador* con el motivo; corrígela y envíala de nuevo.
  - **Anular:** con el menú ⋮.
- **Pagos:** los pagos que hizo Tesorería (o que vienen del Excel con su N° de operación). **Contabilizar** un pago genera su asiento: Debe la cuenta por pagar (421210101 facturas, 424110101 honorarios, o la cuenta de la OP) y Haber el banco (1041). La contadora revisa que el monto, la fecha y el N° de operación coincidan con el voucher y el estado de cuenta antes de contabilizar.
- **Guías:**
  - **Por emitir:** cada dato tiene su botón de copiar para emitir la guía en SUNAT. Después se registra el N° y se sube el PDF.
  - **Por anular:** guías de OC anuladas; se marcan como anuladas una vez anuladas en SUNAT.

---

## Tesorería

- **Pagos:**
  - **Entrar:** elige la empresa (con su logo) y luego quién envía: **Logística (OC/OS)** o **Contabilidad (OP)**. La próxima vez la app vuelve directo a esa lista. Las cabeceras *Empresa* y *Envía* permiten cambiar; al cambiar de empresa te quedas en la misma área.
  - **Pestañas:** en Logística, **OC | OS** arriba y *Por pagar*, *Pagado*, *Rechazos* debajo; cada fila conserva lo elegido en la otra. En Rechazos, el motivo se ve completo en rojo.
  - **Filtros:** obra, proveedor, etapa, fecha (con **Personalizado**: un calendario para elegir desde y hasta) y monto.
- **Detalle de pago:**
  - **Datos para pagar:** proveedor, RUC, cuenta, el monto y el N° del comprobante tienen su botón de **copiar** (el monto se copia sin formato).
  - **Comprobante:** se ve la imagen; si no tiene archivo, una simulada marcada «NO VÁLIDO».
  - **Líneas:** cantidad y P.U. comparado con otras compras; en una OS, comparado con el presupuesto. Debajo, *Ejecutado X / Y* de la partida y un **Historial** con las órdenes anteriores del ítem (sin la orden actual).
  - **Contrato firmado:** en una OS, junto a los demás documentos.
  - **Entregas y fotos:** si la orden ya está en entrega.
  - **Aprobar pago:** monto, fecha, banco, N° de operación y voucher. Un solo botón **Subir voucher** abre la cámara, la galería o los archivos del teléfono. Si la OC requiere guía y aún no está emitida, se avisa «Falta guía» y no se puede aprobar.
  - **Rechazar:** con un motivo opcional. Una OC/OS vuelve a cotización en Logística; una OP, a borrador en Contabilidad. Quien la envió recibe un aviso. Si la orden ya tiene factura, **El proveedor emite factura nueva** viene marcado: la factura se anula (nota de crédito) y Logística registra la nueva. Si ya tiene pagos, está contabilizada o es de otras órdenes, no se ofrece y la hoja dice por qué. **Rechazos (N)** muestra el historial de la orden.
  - **Detracción y retención:** el monto a pagar ya las descuenta; en cada comprobante se ve cuánto (la detracción la paga Contabilidad).
- **Presupuesto:** el presupuesto de cada obra por etapa, con barras de lo comprado y lo que llegó. Debajo de cada partida, sus entregas con foto, cantidad y fecha. Hay un interruptor *Cantidad / Monto*, y al desplegar un ítem se ven sus órdenes (cada una abre su detalle en solo lectura, con fotos).

---

## Residente

Barra inferior: **Recepción · Mano de obra**.

**Recepción** (materiales y subcontratos): solo ve qué le llegará y cuánto ya se entregó. No ve presupuesto, precios ni órdenes sin pagar.

- Pestañas:
  - **Por recibir:** órdenes ya pagadas. Si Logística todavía no envió la constancia al proveedor, figuran como *Por despachar* (solo consulta); cuando está en entrega, *Por recibir*, y ahí se registra lo que llega.
  - **Recibidas.**
- **Registrar entrega:**
  1. Elige el ítem y la cantidad que llegó.
  2. **Tomar fotos** abre la **cámara de la app** a pantalla completa: obturador grande, contador, cambio de cámara y linterna si el teléfono la tiene; **Listo** vuelve al formulario con las miniaturas (tocar una la amplía, la ✕ la quita). No se pueden elegir fotos de la galería.
  3. La app pide la **ubicación GPS** y sin ella no deja registrar.
  4. **Con observación** (material dañado, faltante, imprevisto…): al marcarlo, escribe qué pasó. Logística y Operaciones reciben el aviso y la entrega queda marcada en rojo.
- En cada orden ve lo pedido y lo que ya llegó por ítem, con las fotos de todas las entregas.

**Mano de obra** (por obra):
- Arriba, **Pagado S/ X de S/ Y**: lo pagado de las valorizaciones (sin la retención, que se paga al cerrar la obra) frente al total presupuestado de mano de obra.
- **Observados por Operaciones:** los registros que Operaciones observó, con su texto. **Volver a registrar** abre el registro con la partida y la cantidad.
- **Semana:** calendario de lunes a domingo (← → cambia de semana) con lo avanzado cada día por partida: *Sin valorizar*, *Observado* o *Valorizado*. Tocar un día muestra sus registros con fotos. **Registrar avance**: partida, cantidad (hasta lo que queda), fecha, fotos con la cámara de la app, GPS y, si hace falta, *Con observación*.
- **Presupuesto:** las partidas de mano de obra por etapa con cantidad, P.U., parcial y lo avanzado; **Avance** registra directo en esa partida.

---

## Gerencia

- **Solicitudes:** aprobar o rechazar, con un comentario opcional:
  - adicionales de materiales (ya revisados por el Jefe de Operaciones, con su comentario) y bajas de partidas que pide el Jefe;
  - altas, cambios y bajas de personas que pide RRHH.

  Pestañas **Obras | RRHH** (quién pide) sobre *Por aprobar | Resueltas*. Para decidir, cada **adicional de materiales** muestra el ítem, la cantidad, la etapa y el **monto** (cantidad × P.U.); el **último precio de compra** del ítem y su promedio (en rojo si el P.U. pedido lo supera en más de 20 %); cuánto agrega sobre lo presupuestado del ítem en la obra, o si es un **ítem nuevo**; el ítem **etapa por etapa** (presupuestado, comprado, llegado), y un aviso si en etapas siguientes aún queda material sin requerir que se podría **adelantar**. Una baja muestra el avance de la partida y sus **órdenes**. Todas muestran las **solicitudes anteriores**; las de personas, sus obras asignadas. El cambio de datos de una persona muestra solo lo que cambia (*antes → después*). Quien pidió la solicitud recibe un aviso con la respuesta.
- **Obras:** crear una obra (nombre, empresa, dirección) y **cargar su presupuesto** en la grilla (en el celular, un formulario). Nace en borrador; **Publicar presupuesto** avisa a Operaciones. Gerencia es la única que lo modifica, también después de publicado: así hace los adicionales de mano de obra y subcontratos.
- **Cerrar entrega incompleta:** en una orden *En entrega* (desde el historial de un ítem en Avance), cuando el proveedor ya no enviará el resto. Pide un motivo; la orden queda *Recibida* y lo que no llegó vuelve al saldo de la partida.
- **Bajas de partida:** la solicitud muestra qué órdenes se anularán al aprobarla. Si la partida ya tiene compras pagadas, no se puede.
- **Avance:** el presupuesto de obra (igual que en Tesorería), con filtro por **empresa** y obra. Debajo de cada partida se ven sus **entregas** (recepciones y ejecuciones): foto, cantidad y fecha de cada una, que suman lo que llegó; tocar una abre el visor con la cantidad, la fecha y quién la registró.
- **Órdenes:** todas las órdenes, solo para consultar.

- **Obra › Retención de mano de obra:** el % de retención de cada ítem de mano de obra de la obra (5 % por defecto). Se descuenta al valorizar y se paga junta al final.
- **Obras › Detracción desde:** monto a partir del cual una factura lleva detracción (S/ 700 por defecto), para todas las obras.
- **Obra › Detracción:** *Agregar ítem* marca un ítem de la obra con detracción (5 %, editable); la ✕ la quita. Por defecto ningún ítem la lleva.
- **Obra › Cerrar obra:** la confirmación resume las partidas con saldo que se dan de baja, el monto y la retención por pagar. Se da de baja todo lo que falta y el presupuesto queda de solo lectura; Logística recibe el aviso para crear la OS de retención. No se puede cerrar con avance de mano de obra sin valorizar.
- **Solicitudes:** los adicionales llevan el nombre de su presupuesto (*Adicional de materiales / mano de obra / subcontratos*) y el sustento que adjuntó Operaciones; la baja de *lo que falta* muestra cuánto se da de baja.

---

## Operaciones

Dos niveles: **Ingeniero de Operaciones** y **Jefe de Operaciones**. Ambos ven todas las obras. Barra inferior: **Seguimiento · Requerir · Solicitudes · Ejecución · Obra**.

- **Seguimiento:** elige empresa y obra; pestañas **Materiales | Mano de obra | Subcontratos**. Cada partida muestra una barra con lo presupuestado repartido por estado y debajo solo los estados que tiene, con su cantidad: *Por pedir*, *Pedido* (orden en Logística), *Por pagar* (en Tesorería), *Pagado* (pagado, por llegar) y *Recibido*. En Materiales no hay precios; en Mano de obra y Subcontratos se ve el P.U. No muestra órdenes, proveedores ni facturas. Filtros por etapa y estado (incluye *Requerido sin comprar*), y búsqueda. Debajo de cada partida se ven sus **entregas**: foto, cantidad y fecha de cada una (la suma es lo que llegó); tocar una abre el visor. Cada partida marca lo **requerido sin comprar** y sus **adelantos** («+20 de L2A» si recibió, «−20 a L1B» si prestó); las etapas siguen el orden de la obra.
- **Requerir:** (materiales y subcontratos; la mano de obra se valoriza) los requerimientos de cada obra, con lo atendido por Logística en cada línea (*Pendiente*, *Parcial*, *Atendido*). Búsqueda (N°, ítem o nota) y filtros por estado (incluye *Anulado*), presupuesto, etapa, quién lo pidió y fecha; orden por fecha o pendientes primero.
  - **Para probar un adelanto:** en *DEMO HOGARIAN*, L1A tiene solo 30 BLS de cemento y 20 de acero de 1/2" por requerir; pide más y adelanta lo que falta de L1B (y, en cadena, L1B de ACB 1).
  - **Nuevo requerimiento:** 1) elige las partidas: una lista en columnas *Etapa · Partida · Disponible*, con pestañas Materiales / Mano de obra / Subcontratos y buscador; 2) escribe las cantidades. Si una cantidad supera lo disponible, aparece «Faltan N»: **Adelantar de otra etapa** ofrece las etapas posteriores del mismo ítem con lo que *puede adelantar*; hay que cubrir exactamente lo que falta. Si ninguna etapa posterior tiene saldo, se pide un adicional en Solicitudes. Antes de enviar se confirma el resumen de adelantos.
  - **Anular:** quien lo creó o el Jefe; los adelantos vuelven a su etapa.
- **Solicitudes:**
  - **Ingeniero:** *Pedir adicional* de materiales (material, etapa, requerimiento, cantidad, P.U. estimado y motivo). Va al Jefe. Ve sus solicitudes: *Por revisar (Jefe)*, *En Gerencia*, *Aprobada* o *Rechazada*, con el comentario de cada uno.
  - **Jefe:** pestaña **Por revisar** con los adicionales del Ingeniero: *Pasar a Gerencia* o *Rechazar*, con un comentario. Sus adicionales van directo a Gerencia. **Pedir baja** de una partida sin compras pagadas (si tiene órdenes, se muestra cuáles se anularían).
  - **Pedir adicional:** pestañas *Materiales | Mano de obra | Subcontratos*, ítem, etapa, requerimiento, cantidad, P.U. estimado, motivo y **Adjuntar fotos o PDF** de sustento.
  - **Pedir baja** (Jefe): *Lo que falta* (la cantidad que elijas, hasta lo que no está comprometido, requerido ni avanzado) o *Toda la partida* (si no tiene compras pagadas). También con sustento.
  - Cada solicitud muestra su sustento (las fotos se abren en el visor).
  - Búsqueda (material, partida o motivo) y filtros por tipo, estado y fecha.
- **Ejecución:** con pestañas **Materiales | Mano de obra | Subcontratos**. En **Mano de obra**:
  - **Por valorizar:** lo registrado sin valorizar de la obra (neto, bruto y retención) y **Valorizar**, que confirma el detalle por partida. Debajo, el calendario de la semana (abre en la del último avance sin valorizar); tocar un día muestra los registros con fotos y **Observar** (con un texto: no se valoriza y el residente lo vuelve a registrar). *Ver todas las partidas* incluye las que no avanzaron.
  - **Acumulado:** por partida, lo valorizado frente a lo presupuestado y la retención; arriba, el total valorizado y la **retención acumulada** de la obra.
  - **Valorizaciones:** el historial (N°, corte, neto, bruto, retención y estado de su OS); al abrir una, su detalle por partida con las fotos.
- En **Materiales y Subcontratos**, solo consulta. Por partida: *ejecutado / presupuestado*, una barra de avance y cada registro con su foto, cantidad y fecha. En Mano de obra y Subcontratos, además, el P.U. y lo **valorizado** (ejecutado × P.U.), con el total de la obra arriba; en Materiales, sin precios. Filtros: etapa, avance (*Con avance*, *Sin avance*, *Completo*), fecha del registro (con rango personalizado: muestra lo ejecutado y valorizado *en el periodo*) y quién lo registró; orden por etapa, último registro o mayor avance.
- **Obra:** por obra, sus **residentes** (el Jefe los asigna o quita; el Ingeniero solo los ve). Quitar pide confirmación y, si es residente, hay que elegir quién lo reemplaza: sin reemplazo no se puede quitar y el **orden de etapas** (el Jefe lo cambia con las flechas ↑↓ y *Guardar orden*). Ese orden decide de qué etapas se puede adelantar.

---

## Recursos Humanos

- **Personas:** pestañas *Activas*, *Por aprobar* y *Bajas*.
- **Nueva persona:** nombre, DNI, cargo, teléfono y correo. Queda *Por aprobar* hasta que Gerencia la aprueba.
- En una persona activa:
  - el **teléfono y el correo** se guardan directo, sin aprobación;
  - un cambio de nombre o cargo se envía como **Pedir cambio**;
  - **Pedir baja** pide confirmación.

  Mientras haya una solicitud pendiente, la ficha queda bloqueada.

---

## Proveedor (sin cuenta)

Recibe un link por WhatsApp o Telegram:
1. Llena el precio unitario (con IGV) de cada ítem. Puede cerrar y volver: lo escrito se guarda en su teléfono.
2. **Enviar cotización.** Después el link solo muestra lo enviado, sin poder cambiarlo.
3. Cuando Logística confirma los precios, el link deja de funcionar.

La página se ve siempre en modo claro; el sol/luna de arriba la cambia a oscuro.
