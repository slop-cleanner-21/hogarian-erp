# Observaciones de la primera prueba (28/10/2026)

Lo que salió al probar la app en el celular, qué se cambió y las respuestas a las preguntas.

## General

| Observación | Qué se hizo |
|---|---|
| No se podían limpiar las notificaciones | En **Avisos**, cada aviso tiene su ✕ para borrarlo al instante. **Limpiar todo**, con confirmación, borra todos. |
| La interfaz iba lenta; se pidió una UI optimista | Cada pantalla tardaba 160–620 ms en el servidor, por varias consultas en cadena (validar la sesión con el servidor de auth y leer el perfil en cada pantalla). Ahora tarda 20–80 ms: la sesión se valida con el token y el rol y el nombre viajan dentro de él.<br>Además:<ul><li>Al navegar aparece al instante un esqueleto de la pantalla.</li><li>Las pestañas se marcan apenas se tocan.</li><li>Los avisos se borran sin esperar al servidor.</li></ul> |
| Los filtros no se guardaban | Al volver de OS a OC se borraban los filtros guardados. Ya está corregido. En Logística, los filtros (obra, etapa, etc.) son los mismos para OC y OS. |
| Faltaban filtros | En las órdenes de Logística se agregaron **Etapa**, **Tipo de material** y **Fecha**, que se suman a Estado, Obra, Proveedor y Sobreprecio. **Nueva** abre la orden con la obra que esté filtrada. |
| Las fotos y la guía en la app instalada dejaban al usuario sin salida y «atrás» cerraba la app | Las fotos (entregas, vouchers, comprobantes, guías) se abren en un **visor dentro de la app**: ✕ para cerrar, deslizar entre fotos y botón de descarga. El botón **atrás** del teléfono cierra el visor. Los PDF se abren en otra pestaña en el navegador; en la app instalada se descargan y los abre el visor de PDF del teléfono. |

## Guía de remisión: quién hace qué

- **Logística** llena **todos** los datos al solicitarla:
  - quién transporta;
  - puntos de partida y de llegada;
  - transportista, placa y licencia;
  - fecha de traslado;
  - ítems.
- **Contabilidad** no edita nada. Copia esos datos (cada uno tiene su botón de copiar), emite la guía en SUNAT y sube el PDF con el número.

## Logística

| Observación | Qué se hizo |
|---|---|
| OC pagadas en *Pendientes* | Eran órdenes **históricas del Excel**: estaban pagadas y nadie iba a registrar su entrega. Ahora quedan **Recibidas**, con su entrega completa marcada «Histórico». En *Pendientes* quedan las que esperan algo de Logística, incluida la constancia de pago de las órdenes pagadas en la app. |

En *Pendientes* también hay unas 357 órdenes del Excel como **Por facturar**. En el Excel no tienen factura ni N° de operación: son de las obras MERCEDES A, MERCEDES B, PRIMAVERA 4 y VIRGEN DEL MAR, entre noviembre de 2025 y julio de 2026. Se dejan así: **el Excel es la fuente de verdad** (decisión del 03/11/2026).

## Contabilidad

| Observación | Qué se hizo |
|---|---|
| Gestor de cuentas | En **Cuentas**, la pestaña **Plan** muestra el plan de cuentas. Tocando una cuenta se le pone el nombre y el tipo; las importadas llegan como «Sin denominación» y aparecen resaltadas. **Nueva cuenta** agrega una. |
| En Compras, el filtro iba en otra línea | Empresa, periodo y el botón de filtros quedan en una sola línea. |
| En la demo había órdenes por contabilizar sin comprobante ni voucher | Todo comprobante sin archivo y todo pago sin voucher tienen ahora una **imagen simulada** con el sello «SIMULADO, NO VÁLIDO». Son 784 archivos, registrados uno por uno en la tabla **`datos_demo`** para quitarlos cuando se migren los datos reales (`npm run db:demo-archivos`). |
| El TXT y el ZIP debían bajar solo lo filtrado, con opción de elegir | El ícono de **descarga** abre la lista de lo filtrado, todo marcado. Se desmarca lo que no se quiera y se baja el **TXT PLE** (solo facturas y boletas) o el **ZIP** de expedientes de lo marcado. |
| Orden de los módulos | **OP · Pagos · Compras · Guías · Cuentas**. Al entrar se abre OP. |

### ¿Qué diferencia hay entre Compras y Pagos?

- **Compras** es el **registro de compras**: los comprobantes que se reciben (facturas, boletas, recibos por honorarios).
  - **Contabilizar una compra** genera el asiento del gasto: *Debe* la cuenta de cada ítem (y el IGV 40111); *Haber* la cuenta por pagar al proveedor (4212 facturas, 4241 honorarios).
  - De aquí salen el **TXT del PLE 8.1** y los **expedientes**.
- **Pagos** son las **salidas de dinero**: las transferencias que hizo Tesorería.
  - **Contabilizar un pago** genera el asiento de la cancelación: *Debe* la cuenta por pagar (4212, 4241 o la cuenta de la OP); *Haber* el banco (1041).
  - Una factura puede pagarse en uno o varios pagos, y un pago puede cubrir varias facturas.

En resumen, la compra registra la deuda con el proveedor y el pago registra que esa deuda se canceló.

### ¿Al contabilizar un pago, qué hace la contadora?

Revisa que el pago esté bien antes de llevarlo a los libros. El monto, la fecha y el N° de operación tienen que coincidir con el **voucher** y con el **estado de cuenta del banco**, y el pago tiene que corresponder a los comprobantes a los que se aplicó. Si todo cuadra, pulsa **Contabilizar** y la app genera el asiento (Debe 4212/4241/cuenta de la OP, Haber 1041).

La estructura exacta del asiento sigue pendiente de confirmar con Contabilidad (ver `flujos.md`).

### ¿De dónde salen los pagos por contabilizar?

Son los pagos que todavía no tienen asiento:

- los que Tesorería **aprobó en la app** (con N° de operación y voucher);
- los que vienen del **Excel de control de costos**, de las líneas con N° de operación. Esos no tenían voucher; ahora llevan el voucher simulado.

## Tesorería

| Observación | Qué se hizo |
|---|---|
| Logos de las 4 empresas | Se encontraron en la PC los de **MARBELEN** (captura de pantalla) y **ARIANT** (Descargas). **HOGARIAN** usa el logo HG. **ARISANT** lleva el de Hogarian hasta que tengamos el suyo. |
| Al cambiar de empresa volvía a «¿quién envía?» | Ahora se queda en la misma área (Logística o Contabilidad) de la nueva empresa. |

## Residente

| Observación | Qué se hizo |
|---|---|
| Salían todas las órdenes por llegar y no se podía subir ninguna foto | Sus obras de prueba (RAYMONDI y ADOLFO KING) tenían cientos de órdenes **pagadas** del Excel. En esas órdenes todavía no se puede registrar la entrega, porque primero Logística envía la constancia al proveedor. Ahora *Por recibir* muestra solo las órdenes **en entrega**, que son las que aceptan fotos, y las históricas quedan como recibidas. |

## Ajustes tras la auditoría (29/10/2026)

- **Sin señal:** si una acción falla por falta de conexión, la app muestra «Sin conexión», con **Reintentar** e **Ir al inicio**. Antes salía la página de error genérica, en inglés. En Avisos, si no hay señal, los avisos borrados vuelven a aparecer con el mensaje.
- **Carga al cambiar de vista:** al pasar de OC a OS, elegir una empresa o cambiar el periodo, aparece de inmediato una barra arriba y el contenido se atenúa hasta que llegan los datos. La barra inferior y los selectores marcan la opción elegida al instante.
- **Logística:**
  - El comprobante de la orden se abre en el visor.
  - El enlace a la guía ahora funciona desde el celular: apuntaba a la dirección interna del servidor.
  - El filtro Estado ofrece solo los estados de la pestaña activa y se quita al cambiar de pestaña.
- **Galería por ítem:** el visor recorre todas las fotos del ítem, no solo las de una entrega.
- **Plan de cuentas:** su búsqueda ya no se arrastra a las pestañas de ítems.
- **Botón atrás con una hoja abierta:**
  - En **Android**, Chrome cierra las hojas con el botón atrás del teléfono, porque son diálogos nativos.
  - En el **navegador de escritorio**, «atrás» cambia de página.
  - No se agregó una entrada al historial por cada hoja: chocaría con las acciones que, al cerrar la hoja, navegan a otra pantalla (por ejemplo, rechazar un pago).

## Segunda ronda de pedidos (29/10/2026)

| Rol | Pedido | Qué se hizo |
|---|---|---|
| Tesorería | Separar OC y OS en pestañas | Fila **OC \| OS** sobre *Por pagar \| Pagado \| Rechazos*. Cada fila conserva su estado al cambiar la otra. Se quitó el filtro «Tipo de orden». |
| Tesorería | Fecha personalizada | Opción **Personalizado** en el filtro de fecha, con un calendario para elegir desde y hasta. También en Logística. |
| Tesorería | Copiar los datos para pagar | Proveedor, RUC, cuenta, monto (sin formato) y N° del comprobante, cada uno con su botón de copiar. |
| Tesorería | Historial sin la propia orden | El historial de una línea muestra solo las órdenes anteriores. |
| Tesorería | Motivo del rechazo en rojo | Bloque rojizo con el motivo completo. |
| Logística | Tipos de material nuevos | **+ Nuevo tipo** en el selector de tipo del ítem y en «Vende» del proveedor. |
| Logística | Proveedores que ya vendieron primero | Se ordenan por cuántos de los ítems elegidos ya vendieron y por la última orden, con la marca «Ya lo vendió» o «Vendió N de M» (también al buscar). |
| Logística | Diferencia en una fila | «+0.10 (+4.5 %)». |
| Logística | Cotización corta en la OS | La OS nace con el precio del presupuesto; basta con confirmar. |
| Logística | Crear transportista y proveedor sin salir | **+ Nuevo transportista** en la guía y **+ Nuevo proveedor** en la nueva orden; quedan elegidos. |
| Contabilidad | Lista de ítems de la cuenta | La hoja de cada cuenta del plan lista sus ítems, con buscador si son muchos. |
| Residente | Mejor cámara | Cámara a pantalla completa: obturador grande, contador, cambio de cámara, linterna, destello y Reintentar si falla; miniaturas en el formulario. |
| Gerencia | Contexto de las solicitudes | Adicional de materiales: monto, último precio y promedio del ítem, % sobre lo presupuestado del ítem (o ítem nuevo), el ítem por etapa y lo adelantable de etapas siguientes. Baja: avance de la partida y sus órdenes. Solicitudes anteriores; obras asignadas de la persona. (Se quitó el ejecutado de la obra: no ayudaba a decidir.) |
| Gerencia | Filtro por empresa en Presupuesto | Selector de empresa junto al de obra. |
| Gerencia | Solicitudes por solicitante | Pestañas **Obras \| RRHH**. |
| Contrato | Contrato firmado por el proveedor, al 100 %, con la glosa del RHE | Ver el flujo de la OS en `flujos.md`. La app genera el contrato al confirmar precios, Logística lo envía con la glosa, y sin el firmado subido la OS no pasa a Tesorería. |

**Dudas abiertas:** el texto legal del contrato (es una plantilla base) y si una OS pagada en partes lleva un contrato por cada pago (puntos 15 y 16 de `flujos.md`).

## Operaciones y presupuestos (29/10/2026)

| Pedido | Qué se hizo |
|---|---|
| 3 presupuestos: Materiales (OC), Mano de obra (OS) y Subcontratos (OS) | Se ven en pestañas en el seguimiento. Subcontratos incluye los demás servicios (locación, proyecto, finalización, otros). |
| Ingeniero › Jefe › Gerencia | Roles **Ingeniero de Operaciones** y **Jefe de Operaciones**. Los adicionales de materiales del Ingeniero pasan por el Jefe antes de Gerencia; los del Jefe van directo. |
| Gerencia carga los presupuestos y hace los adicionales de OS | Solo Gerencia edita y publica el presupuesto; Operaciones lo sigue. |
| Jefe: aprobar los pedidos del Ingeniero y solicitar bajas | Bandeja **Por revisar** y **Pedir baja**, solo para el Jefe. |
| Ambos ven los presupuestos (materiales sin precios; mano de obra y subcontratos con P.U.) | **Seguimiento** con esa visibilidad. |
| Dolor: no hay seguimiento de los requerimientos | Por partida: *Por pedir › Logística › Tesorería › Por recibir › Recibido*, sin entrar al detalle de órdenes, proveedores ni facturas. |
| Revisión de valorizaciones (solo ver) | **Valorizaciones**: lo ejecutado en las OS con fotos. |
| Obras no existe | Rol y módulo quitados; sus funciones pasan a Operaciones. |
| Residentes ven OC y OS aprobadas | Solo las **pagadas**: *Por despachar* (pagada, sin constancia), *Por recibir* y **Recibidas**. Se quitó «En camino». |
| Residentes: qué ven del presupuesto | Nada: ni presupuesto ni precios. Solo qué material llega y cuánto ya se entregó. |

**Para después:** los pedidos (requerimientos) del Excel de MERCEDES B: quién los hace, quién los aprueba y cómo Logística los atiende (`flujos.md`, punto 17).

## Requerimientos y adelantos (29/10/2026)

| Pedido | Qué se hizo |
|---|---|
| Registrar el orden de las etapas; lo gestiona el Jefe de Operaciones | Orden **por obra** en Operaciones › Obra, con flechas. |
| Operaciones pide parte del presupuesto como indicación para Logística | **Requerimientos** (Requerir), sin aprobación; Logística los ve en **Requeridos** y en Nueva OC/OS, y compra con la libertad de siempre. |
| No pueden exceder el presupuesto | Lo requerido por partida no supera su presupuesto efectivo. |
| Adelantar material de la etapa siguiente y seguirlo | **Adelantos**: Operaciones elige de qué etapa posterior y cuánto; queda registrado y se ve en el seguimiento («+20 de L2A», «−20 a L1B»). El total del presupuesto no cambia; Logística puede comprar lo adelantado donde corresponde. |

## Mano de obra, retenciones y cierre de obra (30/10/2026)

| Pedido | Qué se hizo |
|---|---|
| Nombres más claros en el Seguimiento | *Por requerir · Requerido sin comprar · Pedido · Por pagar · Pagado sin entregar · Entregado* (en subcontratos, *ejecutar/Ejecutado*). Mano de obra: *Por ejecutar · Ejecutado sin valorizar · Valorizado sin pagar · Pagado*. Cada partida muestra solo los estados que tiene. |
| Avisar de una observación al registrar (material dañado, imprevisto) | **Con observación** al registrar una entrega o un avance; el texto es obligatorio, se avisa a Logística y Operaciones y queda marcada en rojo. |
| Mano de obra: el residente registra y Operaciones valoriza | El residente ve el presupuesto de mano de obra (cantidad, P.U., parcial) y lo **pagado frente a lo presupuestado**, y registra el avance con fotos en un **calendario semanal**. Operaciones observa lo que esté mal (el residente lo vuelve a registrar) y **valoriza** cuando lo decide; el acumulado vuelve a cero y las anteriores quedan en el historial. |
| Retención por ítem (obra-ítem), 5 % por defecto, visible para los operativos | Gerencia la fija en la obra; se descuenta al valorizar y se ve por partida y en total (Ejecución › Acumulado y Seguimiento). |
| La valorización va a Logística para la OS, el contrato y el pago | **Una OS por valorización** con P.U. neto de retención; el contrato sale de la misma OS. |
| La retención se paga al final en una sola OS | Al cerrar la obra, Logística crea la **OS de retención** (sin contrato). |
| Adicional / baja de los 3 presupuestos, con sustento | Operaciones pide adicionales de materiales, mano de obra y subcontratos con fotos o PDF; la baja puede ser de **lo que falta** o de toda la partida. |
| Al cerrar una obra, dar de baja todo lo faltante | **Cerrar obra** en Gerencia, con confirmación y resumen. |
| Residente no pide materiales ni subcontratos | Se mantiene: solo registra lo que llega y su avance de mano de obra. |
| Dudas de Contabilidad | Con su plan contable se cargaron las denominaciones de las cuentas de clase 9. El asiento como el de Angeles (cuenta 9 + amarres 6/79, IGV a 961110102) y el TXT de SIRE (080400) quedan para la siguiente ronda, con las preguntas en `flujos.md`. |
