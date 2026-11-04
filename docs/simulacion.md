# Simulación de una obra completa: RESIDENCIAL LOS ÁLAMOS

`npm run db:simular` (script `scripts/simular-obra.mjs`) crea una obra y recorre **todos los flujos del ERP con los usuarios reales de cada rol**. Usa las mismas funciones y permisos que la app: si una regla de negocio fallara, la simulación se detendría con el error.

El resultado es una obra de 3 pisos con unos 3 meses y medio de historia, hasta hoy:
- las primeras etapas quedan cerradas de punta a punta;
- las siguientes quedan en cada estado intermedio, como una obra en marcha.

```bash
npx supabase db reset          # base limpia (datos del Excel + obra DEMO)
npm run db:demo-entregas       # fotos de la obra DEMO
npm run db:simular             # obra RESIDENCIAL LOS ÁLAMOS
npm run db:demo-archivos       # comprobantes y vouchers simulados para todo lo que no tiene archivo
npm run db:demo-fotos          # fotos de entregas: ilustraciones planas por grupo, con el sello «FOTO DEMO»
npm run db:demo-requerimientos # requerimientos de Operaciones con un adelanto de cemento en cadena y uno anulado
```

Las órdenes históricas del Excel que ya estaban pagadas quedan **Recibidas** (seed `historico.sql`: entrega completa a nombre de Admin, marcada «Histórico»), para que no aparezcan como pendientes.

La simulación es **reproducible**: siempre genera los mismos datos. Si la obra ya existe, no hace nada (hay que resetear la base).

## Qué hace, en orden

| # | Rol | Paso |
|---|---|---|
| 1 | Gerencia | Crea la obra «RESIDENCIAL LOS ÁLAMOS» (HOGARIAN, Av. Los Álamos 450, Trujillo) |
| 2 | Gerencia | Carga el presupuesto: 89 partidas en 10 etapas (L0, L1A, L1B, L2A, L2B, L3A, L3B, IS 1, IE 1, ACB 1). Toma la estructura de la obra real RAYMONDI: por etapa, los 6 materiales, las 2 manos de obra y el subcontrato de mayor monto, con el 60 % de las cantidades |
| 3 | Gerencia / Jefe de Operaciones | Gerencia publica el presupuesto; el Jefe de Operaciones asigna al residente (Carlos Mendoza) |
| 4 | RRHH | Pide el alta de una segunda residente (queda por aprobar en Gerencia) |
| 5 | Contabilidad | Asigna cuenta a los ítems que no la tenían, como haría en la grilla de Cuentas |
| 6 | Logística | Arma las órdenes de cada etapa: OC para materiales y OS para subcontratos, agrupadas por el proveedor habitual de cada ítem según las compras reales. La mano de obra no: va por valorizaciones (paso 14c) |
| 7 | Logística / proveedor | La mitad de las órdenes se cotiza **por link**: el proveedor abre el link y envía sus precios, sin sesión, como lo haría desde su teléfono. La otra mitad la llena Logística. En L1B hay un **sobreprecio** que Logística aprueba |
| 8 | Logística → Contabilidad | Las OC de acero, cemento y agregados piden **guía de remisión**, con las 3 modalidades de transporte (proveedor, propio y tercero). Contabilidad la emite con N° y PDF antes del pago |
| 9 | Logística | Registra el comprobante: factura, o recibo por honorarios con retención del 8 % si el proveedor es persona natural |
| 10 | Logística → Tesorería | Envía a Tesorería. Algunas órdenes se **rechazan** y vuelven a cotización: en una, Logística corrige el comprobante (queda en el historial), confirma y reenvía; otra queda devuelta |
| 11 | Tesorería | **Aprueba el pago** con N° de operación y voucher |
| 12 | Contabilidad | **Contabiliza** el comprobante y el pago (asientos cuadrados) |
| 13 | Logística | Envía la **constancia** al proveedor |
| 14 | Residente / Logística | **Entregas** en varios días, con 1 o 2 fotos cada una. El residente registra el 80 % con GPS; Logística el resto, sin GPS |
| 14b | Gerencia | **Cierra una entrega incompleta** en L2B (el proveedor no completará): lo que faltaba vuelve al saldo. Una entrega de L2A se registra **con observación** (bolsas rotas) |
| 14c | Residente → Operaciones → Logística | **Mano de obra:** el residente registra el avance de cada partida (L0 a L2A completas, L2B al 60 %, L3A al 25 %) con fotos y GPS; Operaciones **valoriza** cada dos semanas (6 valorizaciones; un ítem con retención de 3 %, el resto 5 %). Logística crea la OS de cada valorización: 4 llegan a Recibida, la 5.ª queda en Tesorería y la 6.ª espera su OS. Lo de los últimos días queda **sin valorizar**, con un registro observado por Operaciones |
| 15 | Ingeniero → Jefe → Gerencia → Logística | **Adicional** de 60 bolsas de yeso en L2A: el Ingeniero de Operaciones lo pide, el Jefe lo revisa, Gerencia lo aprueba y Logística lo compra hasta recibirlo |
| 16 | Jefe de Operaciones / Ingeniero | Pide la **baja** de una partida de acabados y la **baja de lo que falta** de una de L3B (por aprobar en Gerencia). El Ingeniero pide un **adicional de mano de obra con sustento** (por revisar del Jefe) |
| 17 | Contabilidad → Tesorería | 5 **OP**: alquiler de andamios (3 meses), agua y luz, y movilidad. Tres quedan pagadas y contabilizadas, una en Tesorería y una rechazada |

Las fotos, vouchers y guías son imágenes PNG generadas y marcadas como **SIMULADAS**.

## Cómo queda la obra

| Etapa | Estado de sus órdenes |
|---|---|
| L0, L1A, L1B, L2A (+ adicional) | **Recibidas**: flujo completo, contabilizado |
| L2B | **En entrega**: llegó una parte, una orden pidió solo el 70 % de la partida y otra se **cerró incompleta** |
| L3A | En **Tesorería**, una **rechazada** (de vuelta en cotización, con su factura) y una **pagada sin constancia** |
| L3B | **Por facturar** (una con la guía solicitada) y **cotizando** con los precios cargados |
| IS 1 | **Cotizando**: link enviado, esperando al proveedor |
| IE 1, ACB 1 | Solo presupuesto (sin órdenes) |

Con los datos actuales, la obra queda así: 35 órdenes y 5 OP; 81 entregas con 128 fotos, 67 de ellas con GPS; 12 guías (11 emitidas y 1 solicitada); 23 comprobantes contabilizados; avance de S/ 293,784 presupuestado, 248,081 comprado y 172,653 llegado.

Los avisos de más de una semana quedan leídos. Siguen sin leer los de lo que está en curso: rechazos, cotizaciones y solicitudes por aprobar.

## Qué mirar con cada rol

| Rol | Dónde |
|---|---|
| Logística | *Pendientes*: la orden rechazada con el motivo, la pagada sin constancia, la que espera guía y las que se están cotizando. En una orden de L2B, la sección Entregas en sus 3 vistas |
| Contabilidad | *Compras* (expediente completo y asientos), *Guías* (una por emitir y las emitidas con su PDF), *OP* (la rechazada en borrador) |
| Tesorería | *Pagos › HOGARIAN › Logística*: 3 por pagar, el historial de rechazos y el detalle con historial por ítem. *Presupuesto › RESIDENCIAL LOS ÁLAMOS*: avance por etapa |
| Residente | *Por recibir*: las órdenes de L2B, donde puede registrar con la cámara y el GPS |
| Gerencia | *Solicitudes*: el alta de la residente y la baja de partida por aprobar. *Avance* y *Órdenes* de la obra |
| Operaciones | *Seguimiento › RESIDENCIAL LOS ÁLAMOS* en sus 3 presupuestos; *Solicitudes* (el adicional aprobado y la baja pendiente); *Valorizaciones* con fotos; el Jefe, *Residentes* |
| RRHH | *Por aprobar*: la nueva residente |
