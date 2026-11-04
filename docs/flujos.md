# Flujos por caso de uso

Paso a paso de cada documento, con el rol que actúa en cada paso. Cada flujo cierra con lo que **decidieron** los product owners; lo que sigue abierto está al final, en [Pendientes](#pendientes-para-la-siguiente-iteración).

Roles:

| Sigla | Rol |
|---|---|
| LOG | Logística |
| CON | Contabilidad |
| TES | Tesorería |
| RES | Residente |
| ING | Ingeniero de Operaciones |
| JEF | Jefe de Operaciones |
| GER | Gerencia |
| RRHH | Recursos Humanos |
| PROV | Proveedor (sin cuenta, entra por link) |

---

## 1. Orden de compra (OC)

| # | Rol | Paso | Estado resultante |
|---|---|---|---|
| 1 | LOG | Crea la OC desde las partidas pendientes del presupuesto de la obra: elige partidas, cantidades (por defecto, el saldo) y proveedor. Marca si **requiere guía**. | Cotizando |
| 2 | LOG | Envía el **link de cotización** al proveedor (WhatsApp, Telegram o copiar). | Cotizando · enviada |
| 2b | LOG | *Alternativa:* llena los precios él mismo, sin link. | Cotizando |
| 3 | PROV | Llena los precios (puede hacerlo en varias sesiones) y pulsa **Enviar cotización**. Desde ahí, el link solo muestra lo enviado. | Cotizando · recibida |
| 4 | LOG | Revisa los precios (presupuesto, máximo, histórico).<br>Puede corregirlos o **reenviar el link**; el anterior deja de funcionar.<br>Si un precio supera el máximo, lo aprueba explícitamente.<br>**Confirma precios** y el link vence. | Por facturar |
| 5 | LOG | Si la OC requiere guía, la **solicita** con los datos del traslado (ver §4). | Por facturar |
| 6 | LOG | Registra el **comprobante** (factura, por defecto). | Por enviar |
| 7 | LOG | **Envía a Tesorería.** | En Tesorería |
| 8a | TES | **Aprueba el pago** con el N° de operación y el voucher. Si la OC requiere guía, la guía tiene que estar emitida. | Pagada |
| 8b | TES | O la **rechaza**, con un motivo opcional. La orden **vuelve a cotización**:<br>• el comprobante queda registrado y LOG puede corregirlo;<br>• cada corrección deja una copia en el historial;<br>• LOG confirma los precios y la reenvía. | Cotizando |
| 9 | LOG | **Envía la constancia de pago** al proveedor. | En entrega |
| 10 | RES / LOG | Registran las **entregas**: ítem, cantidad y fotos. El residente solo puede usar la cámara de la app y necesita GPS; LOG puede usar la galería. | En entrega |
| 11 | — | Cuando lo entregado cubre lo pedido en todas las líneas, la orden se cierra sola. | Recibida |
| 11b | OPE | Si el proveedor no completará el pedido, OPE **cierra la entrega incompleta** con un motivo. Lo que no llegó vuelve al saldo de la partida. | Recibida |
| — | CON | Después del comprobante, contabiliza el comprobante y el pago, y arma el expediente. | — |
| — | LOG | **Anular**: solo mientras la orden no tenga comprobante ni pagos. Si la guía ya estaba emitida, se avisa a CON para que la anule en SUNAT. | Anulada |

**Quién ve las fotos y el avance:** LOG, TES, OPE, GER (y CON en el expediente). El proveedor no.

✅ **Decidido**
- Ninguna compra se paga en partes. El sistema sigue aceptando pagos parciales hasta confirmarlo.
- No se puede recibir más de lo pedido.
- La entrega incompleta la cierra Operaciones.
- Si Tesorería rechaza, la orden vuelve a cotización, porque casi siempre el error está ahí. El comprobante se conserva y se puede corregir, con historial.

---

## 2. Orden de servicio (OS)

Igual que la OC, con estas diferencias:

| # | Rol | Diferencia |
|---|---|---|
| 1 | LOG | No lleva guía de remisión. |
| 2 | LOG | **La OS nace con el precio del presupuesto** en cada línea: Logística solo cambia lo que difiera y confirma. El link de cotización sigue siendo opcional, y el proveedor no ve el precio de presupuesto. |
| 4 | LOG | **El precio de referencia es el presupuestado, sin tolerancia.** Un precio mayor es alerta y uno menor es ahorro. Ambos se informan a TES al enviar, y TES los aprueba. |
| — | LOG | **El PDF de la OS lleva precios:** es la forma de comunicarlos al proveedor. El de la OC solo lleva cantidades. |
| 6 | LOG | El comprobante habitual es el **recibo por honorarios** (preseleccionado). |
| 5 | LOG | **Contrato** (desde *Por facturar*): la app lo genera por el **100 % del monto** con el RUC o DNI del proveedor, los ítems y el **concepto del recibo por honorarios** (glosa), que se arma al confirmar precios y Logística puede editar. Se envía al proveedor por WhatsApp, Telegram o Compartir junto con la glosa para que la ponga en su RHE. |
| 5b | LOG | El proveedor firma en papel y Logística **sube el contrato firmado**. **Sin él, la OS no se puede enviar a Tesorería.** |
| 10 | RES / LOG | La «entrega» es la ejecución del servicio: se registra igual, con la cantidad ejecutada y fotos. |

✅ **Decidido**
- El contrato es obligatorio en toda OS: se genera al confirmar precios, es por el 100 % del monto y el proveedor lo firma en papel (29/10/2026).
- Las OS con retención de 4ta categoría se pagan por el neto. La retención se paga a SUNAT con una OP.

---

## 3. Orden de pago (OP)

Pagos que no salen de una OC u OS: gastos generales, planillas, impuestos, etc.

| # | Rol | Paso | Estado |
|---|---|---|---|
| 1 | CON | Crea la OP: obra (o gastos generales), beneficiario, concepto, monto, fecha y cuenta contable. | Borrador |
| 2 | CON | La **envía a Tesorería**. | En Tesorería |
| 3a | TES | **Aprueba el pago** con el N° de operación y el voucher. | Pagada |
| 3b | TES | O la **rechaza**, con un motivo opcional: vuelve a CON, con el historial. | Borrador |
| 4 | CON | Contabiliza el pago (Debe: cuenta de la OP / Haber: banco). | — |

✅ **Decidido**
- El sustento de la OP es un comprobante. Falta definir el detalle (ver Pendientes).

---

## 4. Guía de remisión (solo OC)

| # | Rol | Paso | Estado de la guía |
|---|---|---|---|
| 1 | LOG | Marca si la OC **requiere guía**, al crearla o después, mientras la guía no esté emitida. Puede retractarse. | — |
| 2 | LOG | Con los precios confirmados, **solicita la guía** con estos datos:<br>• **quién transporta**: el proveedor con su unidad, nuestro transporte, o un transportista que contrata y paga el proveedor;<br>• punto de partida y punto de llegada;<br>• transportista (solo en el tercer caso), placa y licencia;<br>• ítems y cantidades (se arman solos desde la orden y se pueden editar);<br>• fecha de inicio del traslado. | Solicitada |
| 3 | CON | En su pestaña **Guías** ve las pendientes, copia cada dato, la **emite en SUNAT** y sube el PDF con su número. | Emitida |
| 4 | TES | Una OC que requiere guía **no se puede pagar** sin la guía emitida. En Tesorería aparece como «Falta guía». | — |
| 5 | LOG | Si **anula la OC** con la guía ya emitida, se avisa a CON. | Anulación pendiente |
| 6 | CON | La anula en SUNAT y la marca como anulada. | Anulada |

**Transportistas:** catálogo que mantiene LOG, con RUC, razón social, placa y licencia por defecto.

✅ **Decidido**
- Se registra quién transporta, con 3 modalidades. Los datos de cada caso dependen de la modalidad y los llena Logística.
- Sin guía emitida no se paga.
- La guía se pide solo con los precios ya definidos, para no estar anulando guías.

---

## 5. Entrega de materiales / ejecución de servicios

| # | Rol | Paso |
|---|---|---|
| 1 | RES | Abre la orden (solo de sus obras), elige el ítem y la cantidad que llegó, y toma las fotos **con la cámara de la app**, sin galería. Se guardan la ubicación GPS y la hora; sin GPS no se puede registrar. |
| 1b | LOG | Lo mismo, pero puede subir fotos de la galería y el GPS es opcional. |
| 2 | — | Una cantidad puede tener cualquier número de fotos. Se pueden registrar varias entregas, en distintos momentos y por distintas personas. |
| 3 | OPE / GER / LOG / TES | Ven el avance por línea (presupuestado, comprado y llegado), con sus fotos. |
| 4 | OPE | Si el proveedor no completará el pedido, **cierra la entrega incompleta** (ver §1, paso 11b). |

✅ **Decidido**
- Bastan las fotos con la cantidad y el ítem; no hace falta una conformidad aparte. Los servicios también tienen cantidad.
- Por ahora no se valida la distancia a la obra (queda en Pendientes).

---

## 6. Presupuesto de obra

| # | Rol | Paso |
|---|---|---|
| 1 | GER | **Crea la obra** (nombre, empresa, datos). Es el único rol que crea obras. |
| 2 | GER | **Carga el presupuesto**: etapa, requerimiento, ítem del catálogo, cantidad y P.U. En escritorio es una grilla tipo Excel; en el celular, un formulario. Se ve como **3 presupuestos**: Materiales (OC, rubro MATERIAL), Mano de obra (OS) y Subcontratos (OS: subcontratos y demás servicios). |
| 3 | GER | **Publica el presupuesto.** ING y JEF reciben un aviso. Solo GER lo modifica, también después de publicado (puede cargar adicionales directo). Fija la **retención de cada ítem de mano de obra** (5 % por defecto; por obra e ítem). |
| 4 | JEF | Asigna los **residentes** a la obra. Para quitar uno elige quién lo reemplaza (con confirmación). |
| 5 | ING / JEF | **Seguimiento** por partida, sin datos de órdenes, proveedores ni facturas. Materiales y Subcontratos: *Por requerir › Requerido sin comprar › Pedido › Por pagar › Pagado sin entregar (o ejecutar) › Entregado (o Ejecutado)*. Mano de obra: *Por ejecutar › Ejecutado sin valorizar › Valorizado sin pagar › Pagado*, con la retención acumulada. En Materiales solo cantidades; en Mano de obra y Subcontratos, también el P.U. |
| 6 | ING | **Adicional** de materiales, mano de obra o subcontratos: lo calcula y lo pide (ítem, etapa, cantidad, P.U. estimado, motivo) con **archivos de sustento** (fotos o PDF). Va al Jefe. |
| 7 | JEF | **Revisa** los adicionales del Ingeniero: los pasa a Gerencia o los rechaza, con un comentario. Sus propios adicionales van directo a Gerencia. También **pide las bajas** de partidas: de **lo que falta** (lo no comprometido, requerido ni avanzado; la cantidad que elija) o de **toda la partida**. |
| 8 | GER | Aprueba o rechaza lo que le llega (adicionales revisados y bajas); al aprobarlo, se aplica al presupuesto. |
| 9 | ING / JEF | **Ejecución**: lo ejecutado de los 3 presupuestos por partida, con fotos; en mano de obra y subcontratos, P.U. y valorizado (en materiales, sin precios). Solo consulta. |

**Baja de lo que falta:** al aprobarse, la partida queda con menos cantidad; no toca órdenes.

**Baja de toda la partida con órdenes:** al pedirla y al aprobarla se muestra qué órdenes se anularán. Se anulan completas, con todas sus líneas. No se puede dar de baja si la partida ya tiene compras pagadas o si alguna de sus órdenes tiene comprobante.

✅ **Decidido**
- El presupuesto se bloquea en cuanto se publica.
- Los adicionales usan el requerimiento ADIC n, por compatibilidad con los datos históricos.
- El rol Obras ya no existe: sus funciones pasan a Operaciones (29/10/2026).
- Cadena de aprobación Ingeniero › Jefe › Gerencia para todo lo que no tenga otra regla.
- Operaciones pide adicionales de los 3 presupuestos, con sustento (30/10/2026).
- Ingeniero y Jefe ven todas las obras.

---

## 6c. Mano de obra: avance, valorización y retención

| # | Rol | Paso |
|---|---|---|
| 1 | RES | Ve el presupuesto de mano de obra de su obra (cantidad, P.U. y parcial) y lo **pagado frente a lo presupuestado**. **Registra el avance** de cada partida: cantidad, fecha, fotos con la cámara de la app y GPS; si hay algo que avisar, lo marca **con observación**. No puede pasar de lo presupuestado. |
| 2 | ING / JEF | Revisan el avance en un **calendario de la semana** (lunes a domingo, partidas con avance; *Ver todas* muestra el resto) con las fotos de cada registro. Si un registro está mal, lo **observan** con un texto: no se valoriza y el residente lo **vuelve a registrar** si corresponde. |
| 3 | ING / JEF | **Valorizan** cuando lo deciden (la fecha de corte es ese momento): todo lo registrado sin observar pasa a la valorización N° n, por partida: cantidad × P.U. (bruto), menos la **retención** del ítem, igual a **neto**. El acumulado sin valorizar vuelve a cero; las anteriores quedan en *Valorizaciones*. |
| 4 | LOG | En *Requeridos › Mano de obra por ordenar* crea la **OS de la valorización**: elige al beneficiario; las líneas, cantidades y P.U. **netos de retención** vienen fijos. La OS queda con precios confirmados y su glosa del RHE («Servicio de valorización N° n …»). |
| 5 | LOG / TES | Sigue el flujo de la OS: contrato firmado (con el mismo P.U. neto) › comprobante › Tesorería › pago. Al enviar la constancia queda **Recibida**: su ejecución ya está en los avances. |
| 6 | GER | **Cierra la obra**: se da de baja todo lo que falta de cada partida (en mano de obra queda en lo valorizado) y ya no se requiere, ordena ni avanza nada. Exige que no quede avance sin valorizar. |
| 7 | LOG | Crea la **OS de retención**: una sola, con lo retenido de todas las valorizaciones pagadas (una línea por partida). Va a Tesorería sin contrato. |

✅ **Decidido** (30/10/2026)
- Una OS por valorización, con un solo beneficiario.
- La retención es por obra e ítem, 5 % por defecto; se fija al cargar el presupuesto.
- La retención se paga al final, en una sola OS.
- Gerencia cierra la obra directo.
- La mano de obra ya no se compra ni se requiere: solo se valoriza.
- El residente no pide materiales ni subcontratos; en materiales y subcontratos registra lo que llega, con observación si hace falta.

---

## 6b. Requerimientos y adelantos

| # | Rol | Paso |
|---|---|---|
| 1 | JEF | Define el **orden de las etapas** de cada obra (Operaciones › Obra). Al cargar el presupuesto, cada etapa toma el orden general; el Jefe lo ajusta con flechas. |
| 2 | ING / JEF | Crea un **requerimiento**: elige partidas de los 3 presupuestos y la cantidad que necesita la obra. No pasa por aprobación. Lo requerido de cada partida no puede superar su presupuesto. |
| 3 | ING / JEF | Si a una etapa le falta, **adelanta** el mismo ítem de una etapa **posterior** (según el orden de la obra), eligiendo de cuál y cuánto, hasta cubrir lo que falta. La etapa que presta queda con menos; si después le falta a ella, adelanta de la siguiente, y en la última se pide un **adicional**. El total del presupuesto no cambia. |
| 4 | LOG | Ve los requerimientos en **Requeridos** (solo consulta) y en Nueva OC/OS cada partida muestra lo **requerido sin comprar**. Compra con libertad, con o sin requerimiento, dentro del presupuesto efectivo de cada partida (lo presupuestado ± los adelantos). |
| 5 | — | Lo **atendido** de cada requerimiento se calcula por partida: lo comprometido en órdenes se reparte primero a los requerimientos más antiguos (Pendiente / Parcial / Atendido). |
| 6 | ING / JEF | Quien lo creó o el Jefe puede **anular** un requerimiento: sus adelantos se revierten, salvo que lo adelantado ya se haya comprado. |

✅ **Decidido** (29/10/2026)
- Orden de etapas por obra, a cargo del Jefe de Operaciones.
- Requerimientos sin aprobación, creados por el Ingeniero o el Jefe.
- En el adelanto, Operaciones elige de qué etapa y cuánto.
- Logística solo consulta los requerimientos; no se vinculan a las órdenes, ni siquiera cuando se compra exactamente lo pedido.
- El residente no crea requerimientos.

---

## 7. Personas (Recursos Humanos)

| # | Rol | Paso |
|---|---|---|
| 1 | RRHH | Registra una persona: nombre, DNI, cargo (residente u otro), teléfono y correo. Queda como **solicitud de alta**. |
| 2 | GER | Aprueba o rechaza. Al aprobarla, la persona queda activa. |
| 3 | RRHH | Los cambios de nombre o cargo, y las bajas, también pasan por Gerencia. **El teléfono y el correo se cambian directamente.** |
| 4 | JEF / GER | Solo las personas activas se pueden asignar a obras. |

✅ **Decidido**
- RRHH gestiona solo las personas; no gestiona proveedores ni transportistas.
- Los cambios menores no necesitan aprobación.

---

## 8. Avisos

Avisos en la app (campana) y como notificación push en el teléfono:

| Evento | Destino |
|---|---|
| El proveedor envió su cotización | LOG |
| Tesorería rechazó una OC/OS (vuelve a cotización) | LOG |
| Tesorería rechazó una OP | CON |
| OS enviada con precio distinto al presupuestado | TES |
| Guía solicitada | CON |
| OC anulada con guía emitida | CON |
| Entrega cerrada incompleta | LOG |
| Solicitud de Obras o de RRHH | GER |
| Solicitud aprobada o rechazada | Quien la pidió |

✅ **Decidido**
- Los avisos llegan solo por la app: nada por correo ni por WhatsApp.

---

## Pendientes para la siguiente iteración

📨 = enviada por WhatsApp a Contabilidad (Angeles) o a Logística (Marcos).

**Órdenes y entregas**
1. Cuando una entrega se cierra incompleta, lo que no llegó vuelve al saldo de la partida. Hay que reconfirmarlo.
2. Decisión (03/11/2026): para la versión de producción 1 se asume que **el proveedor siempre completa**. Lo siguiente queda para el MVP completo.
   📨 Logística: si un proveedor no completa el pedido, Operaciones cierra la entrega (la orden ya pagada queda con lo que llegó) y Logística pide lo que falta a otro proveedor en una orden nueva. La app copiaría los ítems y las cantidades pendientes. ¿Está bien así?
3. ✅ Resuelto (03/11/2026): sí, nota de crédito y **factura nueva**. Al rechazar una orden con factura, Tesorería marca «El proveedor emite factura nueva» (marcado por defecto): la factura queda **anulada** (se conserva, con el motivo, fuera del registro de compras) y sus líneas vuelven a estar sin comprobante para que Logística registre la nueva. Si la factura ya tiene pagos, está contabilizada o cubre otras órdenes, no se ofrece: la hoja dice por qué y se rechaza sin anularla. Tesorería y Logística ven el **historial de rechazos** de cada orden (todos, con qué factura anuló cada uno).
3b. 📨 Logística y Contabilidad: si se pagó una cantidad que no llegó (entrega cerrada incompleta), ¿cómo se recupera ese pago (nota de crédito, devolución, descuento en otra compra) y cómo se registra?

**Servicios**
4. Decisión (03/11/2026): se resuelve en el **cierre de la obra**, al final. No entra en producción 1.
   📨 Contabilidad: cuando un servicio sale más barato que lo presupuestado y Tesorería lo aprueba, ¿qué se hace con ese ahorro? ¿Se registra o se ajusta el presupuesto?
5. ✅ Resuelto: la mano de obra se paga por valorizaciones (ver 6c).

15. Texto legal del contrato de locación de servicios: hoy es una plantilla base (partes, objeto, retribución, concepto del RHE, naturaleza civil). Que lo valide el área legal.
16. ✅ Resuelto para mano de obra: cada valorización es una OS con su contrato (con el P.U. neto). En subcontratos sigue un contrato por el 100 % de la OS.
16b. La OS de retención no lleva contrato (libera lo retenido de contratos ya firmados). Confirmar.

**OP e impuestos**
6. 📨 Contabilidad: ¿qué sustento debe tener cada OP? ¿Depende del tipo de gasto?
7. 📨 Contabilidad: ¿hay OP recurrentes (alquileres, servicios básicos, planillas) que convenga programar?
8. ✅ **Detracciones** implementadas (03/11/2026):
   - **Gerencia** marca, en el presupuesto de cada obra, qué ítems llevan detracción; al marcar uno toma **5 %**, que se puede cambiar. Por defecto ningún ítem la lleva. Se guarda por obra e ítem.
   - Al **registrar una factura**, Logística ve la detracción calculada con las líneas que la llevan (total × Σ parcial × % ÷ Σ parcial) y la ajusta a lo que diga la factura. Solo facturas.
   - **Tesorería paga al proveedor el total menos la retención y la detracción**; en el detalle se ve cuánto se descuenta.
   - La detracción la paga **Contabilidad**. Por ahora solo queda registrada en el comprobante.
   - Solo se propone si el total de la factura **supera el mínimo** (S/ 700 por defecto), que Gerencia cambia en *Obras › Detracción desde*. No se usa el código de bien o servicio del SPOT.

**Guía de remisión**
9. ✅ Decisión (03/11/2026): la modalidad por defecto es la más común en obra (el proveedor entrega con su propio transporte).
10. ✅ Decisión (03/11/2026): **una sola guía por orden**.

**Contabilidad**
11. ✅ Resuelto con su plan contable: ya están cargadas las denominaciones. Falta la **912110102** (ítem «AGUA PUESTA EN OBRA»), que no está en el plan: ¿es la 91220102 «Agua para construcción»?
12. ✅ Implementado (30/10/2026), como su voucher de compras (Rpt_Voucher): el asiento va directo a la cuenta 9 de cada ítem y el plan genera los amarres. Detalle y supuestos a confirmar:
    - **Cuentas de origen:** una línea por ítem a su cuenta 9 (con la descripción del ítem); IGV a la **961110102**; total al Haber de la **421210101** (en recibos por honorarios, **424110101** y la retención a la **401720101**); el redondeo a la **759930104** (Haber) o la **659910108** (Debe).
    - **Cuentas de amarre:** cada cuenta con *Destino Prim. Debe/Haber* lleva su par, y el Debe del amarre se amarra a su vez (912110101 → 602410106 / 791110101 → 244110106 / 612410106), como en el voucher. 📨 Supuesto: un amarre **nunca vuelve a una cuenta 9**; así se cortan los ciclos del plan (602101 → 91211010101 y 6956101 → 912201). Confirmar.
    - **TXT:** ahora es el del **SIRE (080400, reemplazo de la propuesta del RCE)**, con 41 campos como su archivo real. Facturas con IGV en **DGNG** por defecto; en la hoja de la compra se cambia a **DNG**. Facturas sin IGV y boletas, en *no gravadas* (campo 21). 📨 ¿Cómo se decide entre DGNG y DNG? ¿Por obra o por empresa? Si hay una regla, se aplica sola.
    - **Plan:** se cargaron del plan de la empresa las cuentas que se usan, con sus amarres (no las cuentas bancarias). En *Cuentas › Plan* se ven y se corrigen.
    - 📨 El IGV va siempre a la 961110102 (no deducible): ¿alguna empresa usa crédito fiscal (40111)?
    - 📨 ¿El centro de costo (1001 en su voucher) es la obra? Hoy el asiento no lo lleva.
    - 📨 La **911910103** no tiene amarre en el plan: hoy se registra sin amarre. ¿Cuál lleva?
    - 📨 ¿Hay compras en dólares que el ERP deba registrar? Hoy todo es en soles.
    - 📨 ¿Cómo es el asiento de un pago? Hoy: Debe 421210101 (o 424110101, o la cuenta de la OP) y Haber 1041. Nos falta un voucher de pago para comparar y la subcuenta de cada banco.
    - 📨 En su voucher la detracción va en una línea aparte de la 42. Las detracciones siguen pendientes (punto 8).
    - Cada ítem solo se puede asignar a una cuenta de **clase 9**; de ahí salen los amarres. Una vez contabilizada, el **destino del IGV** de la factura ya no se cambia (como el periodo).
    - 📨 En su plan, la **961110102** tiene como amarre Haber la **7911101**, mientras que las demás cuentas 9 usan la **791110101**. ¿Es correcto?
    - 📨 El redondeo acepta hasta **S/ 1.00** de diferencia entre el total y la suma de base e IGV; más que eso no se contabiliza. ¿Cuál es su tolerancia?
    - 📨 En los datos del Excel ningún recibo por honorarios tiene **retención**, ni los de más de S/ 1,500. ¿Son recibos con suspensión de retención o falta ese dato?
    - Cuatro facturas del Excel tienen serie de 5 caracteres (**E0001**). Decisión (03/11/2026): **el Excel es la fuente de verdad**; se dejan así. Desde ahora la app exige 4 caracteres al registrar facturas, boletas y recibos por honorarios.

**Presupuesto**
12b. Si una orden de la partida dada de baja incluye también otras partidas, hoy se anula completa (con todas sus líneas). Confirmar si se prefiere quitar solo esa línea.

**Entregas y personas**
13. Validar con el GPS que el residente esté en la obra. Requiere registrar las coordenadas de cada obra; se implementará más adelante.
14. Usuarios de acceso: quién los crea y cómo se entregan. Se verá más adelante, para todos los roles. Mientras tanto, una persona aprobada que no tiene usuario no se puede asignar a una obra.
