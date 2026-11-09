# Prod 1

Versión de producción reducida del ERP de Hogarian. Se separó del MVP el 03/11/2026, desde el tag
`checkpoint-antes-prod1` (commit `4bd6baf`) del repo `hogarian-erp-mvp1`.

Hay que ponerla en uso rápido. El MVP sigue aparte con todos los módulos; más adelante se continúa
desde el MVP, se toman de aquí las mejoras que sirvan y se migran los datos.

**Regla:** los cambios que se piden para prod 1 (simplificar, quitar cosas) **no** se llevan al MVP.
Una corrección del MVP sí puede traerse aquí (`git fetch mvp && git cherry-pick <commit>`). Por eso el
código del MVP se toca lo mínimo, para que los cherry-picks entren sin conflictos.

## Módulos y roles

| Rol | Qué tiene |
|---|---|
| **Tesorería** | Aprobación y pago de OC y OS (sin órdenes de pago de Contabilidad). Presupuesto de la obra enfocado en lo pagado y lo pendiente de pago. |
| **Logística** | OC, OS, proveedores, transportistas e ítems (los consulta y clasifica; no los crea). Sin la pestaña Requerimientos ni nada de residentes. Registra la guía de remisión y crea las OS de mano de obra. |
| **Gerencia** | Obras: carga y publica presupuestos, con sus detracciones, el mínimo del SPOT y los adicionales. Seguimiento (la misma vista que el del Jefe de Operaciones), órdenes e **ítems**: los crea Gerencia. |
| **Jefe de Operaciones** | Solo el seguimiento de compras de Logística, sin nada de dinero ni contable: ni montos ni P.U. en pantalla, y la base no le da las tablas con precios, montos o datos contables (órdenes, partidas, ítems, proveedores, parámetros, adjuntos, valorizaciones). Su seguimiento sale de vistas sin montos (`v_seguimiento_partida`, `v_entregas_partida`; migración `prod1_operaciones_sin_dinero`). |
| **Ingeniero de Operaciones** | Exactamente lo mismo que el Jefe: solo ver el seguimiento. Para la base es un Jefe (`rol_actual()` / `rol_en()` lo tratan como `JEFE_OPERACIONES`, migración `prod1_ing_operaciones`), así hereda todas sus restricciones; en `perfiles` queda su rol (`OPERACIONES`), para migrar al MVP. |
| Admin | Todo lo anterior y **Usuarios** (`/admin`, desde su menú). |

**Una persona puede tener varios roles** (migración `prod1_varios_roles`), por ejemplo Tesorería y Gerencia. Trabaja con uno
a la vez y cambia desde su menú; así las reglas de cada rol siguen iguales (varias son restricciones, y sumar permisos las
rompería). `perfil_roles` guarda todos sus roles y `perfiles.rol` el de ahora; los asigna solo el Admin («Otros roles» en su
ficha) y `cambiar_rol` revisa en la base que sea uno de los suyos. Una pantalla de otro de sus roles (un aviso, un link) ofrece
cambiar con un toque y la abre (`/rol`). Lo que mira a la persona usa todos sus roles: los avisos le llegan por todos, puede
firmar por una empresa si uno es Gerencia (mientras firme, no se le puede quitar) y el DNI es obligatorio si tiene Gerencia. Si
tiene la app abierta en dos dispositivos, el otro toma el cambio al renovar su sesión (hasta 1 h); mientras, la base le niega
lo del rol anterior.

Contabilidad, Residente y RRHH **no entran**. Sus roles siguen en la base
(para migrar al MVP), pero `requireSesion` los manda a `/sin-acceso` (`src/lib/prod1.ts`).

## Decisiones de flujo (propias de prod 1)

- **Guía de remisión:** la registra Logística en un solo paso, con los datos del traslado, el N° de
  guía y el PDF o la foto (RPC `registrar_guia`). Si se anula la OC, Logística marca «Ya se anuló en
  SUNAT». Como la registra la misma Logística, una OC que requiere guía **no se envía a Tesorería**
  sin ella (`enviar_a_tesoreria` la rechaza y el botón pasa a «Falta la guía de remisión»). El aviso
  de Tesorería («Falta la guía…») queda solo para datos viejos o del MVP.
  «Requiere guía» se marca al crear la OC, se puede cambiar en Cotizando y Facturar y se decide por última vez al
  **registrar la factura**; desde ahí queda fijo, también en la base (`set_requiere_guia`): sin guía,
  la OC pasa **directo a Tesorería** en cuanto queda facturada («Registrar y enviar a Tesorería»); con guía,
  espera en la pestaña «Guía» y se envía sola al registrarla.
- **Envío automático a Tesorería:** una orden facturada que ya tiene lo que le toca (la guía registrada si la
  requiere, el contrato firmado si es OS) se envía sola. La base lo resuelve en `enviar_si_lista`, que la app
  llama tras registrar el comprobante, la guía o el contrato firmado, confirmar los precios (tras un rechazo
  con la factura conservada). Ya no quedan órdenes «Por enviar»; el botón «Enviar a
  Tesorería» solo aparece en datos viejos. Las del Excel que ya están completas pasan a Tesorería con el último
  seed (`supabase/seed/prod1_envio.sql`), salvo las rechazadas.
- **N° de orden:** lo pone la base (el siguiente de la obra, contando las anuladas); en Nueva OC / OS no se
  escribe. Una OS u OC anulada nunca repite su número.
- **OS: comprobante y contrato.** Al crear la OS, Logística elige el comprobante (recibo por honorarios o
  factura; parte del habitual del proveedor) y la **fecha de inicio** de los trabajos (obligatoria). La de fin
  es la fecha de la OS, que se emite cuando ya se sabe cuándo trabajaron: el inicio no puede ser posterior.
  - RHE → **contrato de locación de servicios**, con el concepto del recibo.
  - Factura → **contrato comercial** de prestación de servicios, sin concepto (plantilla provisional, hasta
    que llegue la definitiva).
  - Si al facturar (o al corregir el comprobante) llega el otro, el contrato se **regenera**: el firmado se quita de
    la orden (el archivo queda) y hay que enviarlo y firmarlo de nuevo. Lo hace la base en la misma transacción que
    el registro (`fn_os_comprobante`); una OS ya en Tesorería no cambia de comprobante sin un rechazo. Una OS solo
    acepta factura o recibo por honorarios.
  - El contrato lleva la **firma de Gerencia** (imagen que sube el gerente en «Mi firma», su menú), con su
    nombre y DNI (lo pone el Admin al crear su usuario; obligatorio en Gerencia). Firma y DNI están en
    `perfil_privado` y en `documentos/firmas/`: solo los lee el servidor. Si hay varios gerentes, firma el de
    la firma más reciente. La firma se pide al armar el PDF (`firmaContrato`), no viaja con la orden.
  - Arriba del contrato va el **logo de la empresa** (PNG para PDF en `public/empresas/pdf/`: react-pdf no lee
    WebP ni SVG; `logoPdfEmpresa`).
- **Link del proveedor:** mientras la orden está «Cotizando» cotiza en él; desde que se confirman los precios, el
  mismo link le muestra su orden, solo para ver (nada se sube desde ahí, tampoco el contrato firmado):
  - precios confirmados, total y estado (Confirmada, En pago, Pagada, constancia enviada);
  - la retención de 4ta y la detracción de su comprobante;
  - sus pagos (fecha, banco, N° de operación, monto) con el voucher;
  - en una OS, el contrato: el firmado si Logística ya lo subió; si no, el contrato para firmar (generado en el
    servidor, con el logo y la firma de Gerencia).

  No ve el presupuesto, la revisión interna (sobreprecio, rechazos y sus motivos), cuentas, la factura ni la guía.
  Los archivos los entrega `/cotizar/<token>/archivo`, que valida el token en la base (`archivo_link`, solo con la
  clave secreta) sin mostrar el almacenamiento. El link **vence 15 días después del pago** (`link_vigente`) o al
  anularse la orden; rechazar por precios lo renueva.
- **Retención por garantía** (OS; distinta de la de 4ta y anterior a ella): Logística la define al crear la OS, por tipo de
  partida: mano de obra 5 %, subcontratos 0 % y adicionales 0 % por defecto (`src/lib/garantia.ts`); después no se cambia. Va por
  línea (`oc_items.ret_garantia_pct`). El P.U. sigue siendo el acordado (contra él se compara el presupuesto) y `parcial` es el
  neto: el proveedor factura y cobra el neto (S/ 1,000 al 5 % son S/ 950) y la 4ta se calcula sobre ese comprobante. La base no
  acepta otro total (`fn_exigir_neto`, S/ 1 de margen por redondeo): con el 100 %, lo retenido se pagaría dos veces. Las pantallas
  muestran cada línea a cantidad × P.U. y restan lo retenido en el total. En el Excel exportado va el P.U. neto.
- **OS de retenciones** (Proveedores › Retenciones, `/logistica/retenciones`, vista `v_os_retenidas`): lo retenido por proveedor y
  obra: por devolver (OS ya pagadas), sin pagar (aún no se retuvo) y devuelto. Con la obra cerrada, Logística crea una OS por
  proveedor y obra (`crear_orden_retencion`): recibo por honorarios con el concepto «Retenciones de la obra X», una línea por
  partida con cantidad 1 y el monto como precio aprobado, para que el total sea lo retenido al céntimo. Sigue el recorrido normal,
  con su contrato de locación, que lista las OS retenidas. Cada OS devuelta queda marcada (`retenida_en`) y no se devuelve dos
  veces; si la OS de retenciones se anula, vuelve a estar por devolver. Su monto no se cambia (Tesorería no la rechaza por precios) y su
  P.U. no cuenta como precio del ítem. En el contexto de la orden, lo retenido figura por pagar hasta que entra en esa OS. Al cerrar la obra, Logística recibe el aviso con el monto.
  **Históricos** (migración `prod1_garantia_historica`, `fn_garantia_historica`): la mano de obra al 95 % del presupuesto está a su
  neto en el Excel. Precio, parcial, comprobantes y pagos no se tocan: `oc_items.pu_bruto` guarda el P.U. acordado y lo retenido es
  la diferencia, al céntimo (si la orden vuelve a cotización, pasa a llevarla como una nueva: P.U. al 100 % y el %). **Excepción:** en una obra donde ya se pagó el ítem «RETENCION 5%», la devolución se hizo a un proveedor
  por la cuadrilla: sus OS quedan devueltas en esa orden y no se vuelven a pagar. Las líneas a otros porcentajes (0.855, 0.8938…)
  no se marcan: no se sabe cuánto de esa rebaja es retención.
- **Retención de 4ta categoría** (LIR art. 71): solo en recibos por honorarios de **más de S/ 1,500**, por el %
  del proveedor (8 % por defecto; Logística lo cambia en su ficha). Tesorería paga el neto y la retención
  queda registrada. No se retiene si el proveedor tiene **suspensión de 4ta** vigente: Logística la marca en
  su ficha con su fecha y la constancia (Formulario 1609) o su N° de operación, que se valida en SUNAT. Rige desde el **día
  siguiente** al de su emisión y vale hasta el 31 de diciembre de ese año (`src/lib/retencion.ts`). Las conocidas están en
  `suspensiones_4ta`, por RUC y solo para la base (seed `suspensiones_4ta.sql`, datos reales, fuera del repo): un proveedor nuevo
  toma la más reciente por su RUC o por el DNI de su RUC 10. De los demás se asume que no la tienen: con un recibo de más de
  S/ 1,500 sin suspensión del año, Nueva OS y el detalle de la orden avisan «Sin suspensión de 4ta: pídele la constancia al
  proveedor». **La calcula la base** (`fn_retencion_4ta`, migración `prod1_impuestos_base`): al
  registrar o corregir un comprobante rechaza cualquier otra («La retención de 4ta de este recibo es S/ …»), y en la
  pantalla se muestra calculada, sin editar. Corregir un comprobante sin cambiar tipo, fecha ni total la deja como
  estaba. La suspensión solo se guarda con la constancia de verdad subida (`documentos/proveedores/`) o su N° de
  operación, y sin fecha futura, también por la API.
- **Detracción** (SPOT): solo la llevan las facturas (OC y OS) de más de S/ 700 (700 exactos no), en los ítems que marca
  Gerencia; un recibo por honorarios nunca la lleva. La base la hace cumplir: si no corresponde (otro comprobante, bajo el mínimo o sin ítems que la lleven) no
  acepta ninguna; si corresponde, no puede ser 0 (Logística puede ajustar el monto al de la factura). Al corregir el
  comprobante, se quita o se calcula según el nuevo tipo y total.
- **OS de mano de obra:** Logística las crea directo, como una OS de subcontrato (sin avances,
  valorizaciones ni retenciones). El seguimiento de mano de obra usa el mismo recorrido que el de
  los subcontratos.
- **Recepción: la registra Logística** (migración `prod1_recepcion_logistica`), en la orden «Enviada» (estado EN_ENTREGA): por ítem,
  lo que llegó, con foto opcional y observación (con observación, aviso a Logística y Operaciones). Cuando llega todo lo pedido, la
  orden pasa a «Recibida». Una orden pasa a «Enviada» cuando Logística confirma que envió la constancia de pago al proveedor
  («Confirmar envío»: abrir WhatsApp o compartir no lo prueba). El mensaje nombra la factura, no el N° de la orden, que es de
  control interno. El contrato de una OS igual: «Enviado» solo con su «Confirmar envío». En el futuro la registrarán los residentes,
  que tendrán que subir foto; ese rol aún no está en prod 1.
- **Logística › OC / OS:** una pestaña por estado, con nombres cortos y en dos filas para que se vean
  todas a 360 px (Borrador, Cotizando, Facturar, Guía en OC o Contrato en OS, Tesorería, Pagada / Enviada, Recibida (las del
  Excel y el MVP), Anulada, Todas). En «Guía» / «Contrato» (facturadas) cada fila dice lo que falta: «Subir guía» o
  «Firmar contrato».
- **Pago completo:** Tesorería paga siempre la orden entera (todo su saldo): el monto viene fijo y
  `pagar_documento` rechaza un pago parcial. Una orden vieja con pago parcial se paga por lo que le falta.
  El total de la orden muestra la detracción y la retención (Logística y Tesorería), para que lo pagado
  menor que el total no parezca un error.
- **Adicionales:** Gerencia los agrega directo en la obra (bloque «Adicionales», con el presupuesto ya
  publicado), sin la solicitud de Operaciones del MVP (RPC `agregar_adicional`). Un adicional es un grupo de
  partidas con el siguiente N° de la obra («ADIC n»); puede repetir el ítem y la etapa de una regular. Logística
  recibe un aviso que abre Nueva OC u OS. Toda partida adicional lleva la marca «Adicional N»
  (`MarcaAdicional`): editor y avance de Gerencia, presupuesto de Tesorería, Nueva OC y los ítems de una orden.
- **Consulta de una orden** (`/consulta/orden/…`, la que abre Gerencia): la misma pantalla que el pago de
  Tesorería (`vistaOrden` en `src/app/tesoreria/pago/vista-orden.tsx`, común a las dos), sin el formulario de
  pago ni las acciones: datos y estado, ítems con sus diseños, total con detracción y retención, presupuesto,
  factura con su archivo, PDF de la orden, contrato, guía de remisión, pagos con voucher, rechazos y entregas.
  Para eso Gerencia lee guías, pagos, rechazos, facturas y vouchers (antes solo Logística, Contabilidad y
  Tesorería). El Jefe de Operaciones no entra a la consulta.
- **Sugerencias:** un botón en el encabezado de todas las pantallas (va en `TopBar`, porque varias no llevan menú de usuario), para
  todos los roles: error, mejora o preferencia de diseño, con hasta 5 capturas (también se pegan en la computadora) y, solas, la
  pantalla y el link desde donde se escribe. Al Admin le llega un aviso y las ve en Admin › Sugerencias, con un enlace a esa
  pantalla. Tabla `sugerencias` y bucket `sugerencias`: solo las lee el servidor; cada uno sube a su carpeta y se escribe por
  `enviar_sugerencia`, que solo acepta archivos propios.
- **Usuarios (solo el Admin):** crea cuentas (nombres y apellidos, correo, rol de prod 1, DNI y celular), cambia nombres,
  apellidos, correo, rol, DNI y celular, restablece la contraseña (genera otra temporal),
  desactiva y reactiva. Lo hace el servidor con la clave secreta (`src/lib/supabase/admin.ts`); el registro
  público sigue apagado. Una cuenta desactivada queda baneada: no entra, no renueva su sesión y la base deja
  de darle datos al instante (`rol_actual` / `rol_en` la tratan como sin perfil). El Admin no puede
  desactivarse ni quitarse el rol. Cada usuario cambia su contraseña desde su menú («Cambiar contraseña»).
  Un cambio de rol rige en la base al instante; en las pantallas, al renovarse su sesión (hasta 1 h).
  - **Entregar el acceso** (al crear la cuenta, o después desde su ficha), de una de dos formas; se ve una sola vez,
    para **enviarlo por WhatsApp** a su celular (abre WhatsApp con el mensaje escrito, el Admin lo envía),
    **compartirlo** con el menú del teléfono (WhatsApp, Telegram, correo, SMS…) o copiarlo:
    - **Link de acceso** (por defecto; migración `prod1_bienvenida`, `src/lib/bienvenida.ts`): sirve **una sola vez** y
      vence a los 7 días. Al abrirlo (`/bienvenida/<token>`, sin sesión), el usuario completa sus datos —nombres,
      apellidos, DNI (obligatorio en Gerencia) y celular, **solo esa vez**; después solo los cambia el Admin— y crea su
      contraseña; entra directo y, si el teléfono puede, se le ofrece la huella. La base guarda solo el hash del token y
      lo usa de una vez (`bienvenida_completar`). Generar otro link o una contraseña temporal invalida el anterior;
      hasta usarlo, la cuenta no tiene contraseña.
    - **Contraseña temporal**: el mensaje lleva la dirección de la app, el correo y la contraseña.
  - **Nombres y apellidos van por separado** (`perfiles.nombres`, `perfiles.apellidos`; migración
    `prod1_nombres_apellidos`); `perfiles.nombre` es el completo, que muestra la app, y lo arma la base (trigger). Los
    apellidos son opcionales al crear la cuenta: con el link los completa el usuario.
  - El celular (como el DNI) va en `perfil_privado`: solo lo lee el servidor. Se guarda con el código del país (un
    número de 9 dígitos que empieza con 9 lleva el 51).
- **Presupuesto de la obra (Gerencia):** buscador por ítem y «Filtros» (requerimiento: regular o cada adicional,
  varias etapas, rubro y con o sin P.U.), en la pantalla, sin recargar (`FiltrosHoja` con `local`); las
  partidas nuevas o cambiadas siempre se ven. Las adicionales llevan una franja a la izquierda y dicen
  «Adicional N» (no «ADIC N»), en la grilla y en el celular; el Seguimiento también las marca.
- **Empresas (solo el Admin, Admin › Empresas):** razón social, RUC (11 dígitos), dirección fiscal y quién firma
  sus contratos (un usuario de Gerencia; sin elegir, el gerente con la firma más reciente). El contrato usa la
  razón social, el domicilio y el firmante de la empresa de la orden (`representanteContratos(empresaId)`).
- **Auditoría (solo el Admin, Admin › Auditoría):** todo cambio de la base queda en `audit_log` (trigger
  `fn_audit` en todas las tablas del negocio salvo el propio registro, avisos, push, accesos al link y datos
  demo): quién, cuándo, tabla, registro (su clave primaria) y qué cambió. Lo que el servidor hace con la clave
  secreta (cuentas, firma, DNI) queda a nombre de quien lo hizo (`createAdminClient(actor)` → `x-actor`). La app
  registra además las sesiones —inicio, intento fallido, cierre y cambio de contraseña, con IP y dispositivo— y
  las acciones de cuentas del Admin (`src/lib/auditoria.ts`). Pantalla con pestañas Sesiones / Cambios, filtros
  (usuario, fecha, acción, qué) y CSV. «Sistema» = sin usuario (SQL directo o el proveedor desde su link). Las
  cargas masivas (Excel, seeds) no se auditan (`app.skip_audit`).
- **Exportar Excel** (menú de Logística, Tesorería, Gerencia y Admin; `src/lib/excel-libro.ts`): el mismo `CONTROL DE COSTOS`
  .xlsm con lo que se registró en la app, con sus fórmulas, macros y hojas, y Excel recalcula al abrirlo. No se arma uno nuevo: se
  toma el original (la plantilla, bucket privado `excel`; tiene RUCs y cuentas reales, no va en el repo) y se escriben solo las
  celdas de datos: es lo inverso de `scripts/extract_excel.py`. Entran las órdenes con precios confirmados en adelante (no las
  anuladas), los ítems, proveedores, obras y partidas nuevos y, en las del Excel, lo que cambió (precios, comprobante y pago
  registrados en la app). La línea N de la carga es la N-ésima fila válida de GASTOEJEC: **la plantilla debe ser el mismo archivo
  con el que se generó `excel.sql`** (`npm run excel:plantilla -- <ruta>`). Si una hoja se llena (partidas 10,000, compras 15,951,
  proveedores 500, obras 50), lo dice. Los RUC van como número y el texto de un ítem como lo tiene ITEMS (con sus espacios): si no, las búsquedas del libro (BUSCARV
  de PROVEED e ITEMS) no los encuentran y dan #N/D. Revisado abriéndolo en Excel (`tests/audit/excel-recalc.ps1`, local): sin errores salvo 30
  `#REF!` que ya trae la hoja FILTRO del original. Pesa más de lo que una respuesta del servidor permite: se guarda y se baja con un enlace
  de 2 minutos. Queda en la auditoría. El Jefe y el Ingeniero de Operaciones no lo tienen (lleva lo financiero).
- **Ítems:** los crea Gerencia (Gerencia › Ítems, la misma lista que la de Logística). Al crearlo puede elegir
  la **cuenta contable** del ítem (la del asiento de compra), opcional; por eso Gerencia lee el plan de cuentas.
  Logística ve el catálogo sin «Nuevo» y sigue clasificando el tipo de material o la especialidad.
  Al escribir la descripción, la hoja muestra los ítems ya existentes con nombre parecido (sin importar
  mayúsculas, tildes ni el orden de las palabras; `src/lib/parecidos.ts`); con uno igual no deja guardar.
- **Requerimientos:** no existen. En el seguimiento, «Por requerir» pasa a «Por comprar» (o «Por
  contratar») y desaparece «Requerido sin comprar».
- **Tesorería › Pagos:** arriba, la misma fila del presupuesto: empresa por su logo, obra (fuera de
  Filtros) y Filtros. Filtros como el del presupuesto: botón con cuántos hay activos y una hoja con
  orden, fecha, monto, proveedor y varias etapas a la vez.
- **Diseños (botón junto a la campana, componente `SelectorDiseno`, con una miniatura por opción):**
  - Listas de Pagos y de OC / OS de Logística, 10 vistas: Lista (la de antes), Compacta, Tarjetas,
    Tabla, Mosaico, y agrupadas Por obra, Por proveedor, Por fecha, Por etapa, Por monto y, solo en
    Pagos, Por empresa (cada grupo con su cantidad y su suma de todo lo filtrado; `grupoDe` /
    `totalesPorGrupo` en `src/lib/diseno.ts`). **Por etapa:** una orden sale en cada etapa que toca, con
    lo que pide en ella (y «de S/ total» si toca varias); en Pagos el saldo o lo pagado se reparte entre
    sus etapas según lo que pide en cada una, así las sumas cuadran con la de la sección.
    En la misma hoja, «Fijar filtros arriba» deja filtros, pestañas y buscador bajo la barra.
  - Sin datos redundantes: en Logística cada pestaña ya es un estado, así que la fila solo lo dice en «Todas» o
    si avisa algo (sobreprecio, la guía o el contrato que falta, anulada); con una obra elegida arriba, las filas
    no la repiten (Logística y Pagos; en «Por proveedor» va la fecha en su lugar). Los agrupados no repiten lo
    que ya dice el grupo.
  - Detalle de una orden (Logística y pago de Tesorería), 10 vistas de los ítems (`ItemsOrden`): Lista
    (la de antes), Compacta, Tabla, Tarjetas, Por etapa, Con avance, Precios, Por importe, Mosaico y
    Resumen. En Logística, mientras se editan los precios, siempre la lista (tiene los campos de P.U.).
  - Se recuerda por pantalla en cookies (`prod1_diseno_<pantalla>`, `prod1_fijar_<pantalla>`).
- **Logística › OC / OS:** arriba, como en Tesorería, el selector de obra (sin empresa) y «Filtros»
  con cuántos hay activos; la hoja (`FiltrosHoja`, la misma de Pagos) tiene orden, estado, fecha, monto,
  proveedor, varias etapas, varios tipos de material y sobreprecio. El buscador va bajo las pestañas.
- **Cambiar el presupuesto y las órdenes** (migración `prod1_precios_fijos`): en cotización la orden sigue al presupuesto. Desde
  que se aprueban los precios queda fijo con qué P.U. y tolerancia se comparó (`oc_items.precio_fijado_at`, `pu_fijado`,
  `tol_fijada`; lo hace un disparador al salir de EMITIDA) y cambiar el presupuesto ya no la mueve; si vuelve a cotización (rechazo
  por precios), se suelta. En los dos casos Logística recibe un aviso en esa orden («Cambió el presupuesto de la OC N: rige para su
  cotización» o «… sus precios no cambian», con el ítem y los dos precios). Las anuladas no avisan. En el Excel exportado una línea
  así va como sobreprecio aprobado, para que sus fórmulas no la dejen en cero.
- **Tolerancia de las OS:** las nuevas no tienen (cualquier precio sobre el presupuesto es sobreprecio). Las históricas usan la
  del ítem, como el Excel (migración `prod1_tolerancia_historicos`; al recargar, `prod1_historico.sql`).
- **Buscadores de las listas** (`SearchBox`, los 10 de la app): lo borrado no vuelve. El proxy no restaura la vista guardada si el
  pedido viene de esa misma vista (`Referer`), y el campo ignora la URL de lo que él mismo mandó, que en una lista lenta llega tarde.
- **Buscador de OC / OS:** por N°, proveedor, obra o **ítem** (sin importar tildes ni mayúsculas; «cemento sol» halla «CEMENTO
  PORTLAND SOL»). El ítem es la columna `items_busqueda` de `v_ordenes`, una subconsulta que solo se calcula si el filtro la usa:
  medido por la API, pasa de 4-6 ms a 11-16 ms. No usar una función por fila: era 15 a 40 veces más lenta. Al rehacer una vista,
  repetir `with (security_invoker = true)`: `create or replace` lo quita y la vista deja de aplicar las reglas de cada rol.
- **Borrador de Nueva OC / OS:** lo avanzado (obra, ítems, proveedor, comprobante, fecha, guía, garantía) queda en el dispositivo,
  por usuario y tipo (`src/lib/borrador-orden.ts`, 14 días): al salir, retroceder o cerrar la app y volver a Nueva sigue como
  estaba. Se borra al emitir la orden o al quitar todos los ítems. **«Guardar borrador»** lo pasa a la cuenta (`orden_borradores`,
  cada uno ve los suyos, desde cualquier dispositivo) y deja empezar otra: varios a la vez, en la pestaña «Borrador» de OC / OS.
  Todavía no son órdenes: no tienen N° (se pone al emitir), no cuentan contra el saldo y no se auditan. Se borra al emitirlo.
- **Nueva OC / OS:** sin desplegables de «Ordenar por» ni de «Regular o adicional» (siempre por etapa);
  las partidas adicionales llevan la etiqueta «Adicional N».
- **Avisos** (campana; `notificar`, solo a las cuentas activas del rol):
  - Logística: cotización recibida (a la orden), rechazo de Tesorería (a la orden), adicional (a Nueva OC / OS), precio del
    presupuesto cambiado (a cada orden con esa partida);
  - Tesorería: **orden nueva por pagar** («Nueva OC N por pagar · obra», con el proveedor) y orden reenviada corregida
    (al pago); OS con precios distintos al presupuesto;
  - Jefe e Ingeniero de Operaciones: presupuesto publicado (a su seguimiento).

  La campana cuenta los sin leer sin recargar (Realtime); al abrir Avisos quedan leídos. Cada aviso sale también como
  notificación push si el teléfono la activó.

  **Cada uno elige sus avisos** (Avisos › «Elegir avisos»; migración `prod1_preferencias_avisos`, `src/lib/avisos.ts`):
  por evento, «Avisar» (campana) y «Al celular» (push, solo si avisa). Los de su rol llegan por defecto, con celular;
  el Admin y Gerencia pueden sumarse a cualquier evento de los demás (por área), que arranca apagado y, al sumarse, sin
  celular: así no se les llena el teléfono. Solo se guarda lo que cambió del defecto.
- **Anular una OC u OS** (Logística o Gerencia, menú de la orden): mientras no se mandó a Tesorería (Cotizando, Facturar, Guía /
  Contrato, también tras un rechazo) y sin pagos. Su factura o recibo se anula con ella (si no está contabilizado ni cubre otras
  órdenes) y su N° se puede registrar de nuevo en la orden correcta: la unicidad de los comprobantes solo cuenta los vigentes.
- **Varias personas a la vez:** lo resuelve la base. Pagar, rechazar, enviar a Tesorería, registrar la factura, confirmar
  precios y anular bloquean la orden y revisan su estado: si dos actúan a la vez, la segunda espera y, si la orden ya
  cambió, recibe el error (un solo pago; o el pago o el rechazo; la cotización del proveedor, una vez). Las pantallas no
  se actualizan solas (salvo el detalle de una orden en Logística): lo de otro se ve al recargar o al intentar actuar.
  Las listas ordenan con un desempate único (obra y N°, o el id): lo del Excel comparte fecha y hora de carga.
- **Rendimiento:** las filas de las listas (Pagos, OC / OS) no precargan su detalle (`prefetch={false}`):
  al abrir una lista eran decenas de peticiones que en el celular competían con lo que se ve; el
  detalle se pide al tocarlo. En Pagos, la lista y los totales se consultan a la vez.
- **Por qué no se puede enviar un formulario:** junto al botón deshabilitado, «Falta: …» dice qué falta y se va quitando
  (`Faltan`, en `components/ui`). Un campo vacío no muestra un valor de ejemplo que parezca lleno (la serie del comprobante).
- **Montos y precios siempre con «S/»** (`soles()` y `solesPu()` en `src/lib/format.ts`).
- **El bloque «Presupuesto» de una orden** arranca plegado y recuerda, por pantalla, si se dejó abierto.
- **Proveedor en Nueva OC / OS, en acordeones:** cada proveedor que ya vendió trae una flecha que despliega los
  ítems elegidos con el P.U. de su última orden con precio y la fecha, o «No lo vendió», y se elige desde ahí
  («Elegir») o tocando su nombre (`detalle` de `SearchSheet`).
- **Nueva OC sugiere primero a quien ya vendió el ítem.** Ojo con la API: corta cada respuesta en 1000
  filas (`max_rows`), y un `.limit()` mayor no lo cambia; lo que pueda pasar de 1000 se trae con `todas()`
  (`src/lib/paginar.ts`). El historial de ventas se perdía así y los ítems quedaban sin proveedor.
- **Empresa y obra compartidas entre Pagos y Presupuesto:** al elegirlas en una, el navegador las guarda
  (`prod1_empresa_obra`) y las pone en la vista guardada de la otra (`prod1_vistas`); el proxy la abre
  ya con las mismas. No se hace en el proxy: ahí contarían los prefetch de Next, que piden vistas viejas.
  Si Pagos está en «Todas las obras», el presupuesto toma la empresa y conserva su obra.
- **Demos de Tesorería y Logística** (`db:demo-tesoreria` arma las dos; las dos con mano de obra):
  - «DEMO TESORERÍA Y LOGÍSTICA (MVP)»: todo como en el MVP (guía emitida por Contabilidad, entregas con
    fotos y cantidades recibidas).
  - «DEMO TESORERÍA Y LOGÍSTICA (PROD 1)»: solo lo que se llena en prod 1 (guía registrada por Logística,
    sin entregas ni fotos, sin caso «recibida»).
- El proveedor siempre completa la orden; no hay entregas incompletas.
- El ahorro en servicios se resuelve al cierre de obra; no se contempla en prod 1.
- **Datos:** el Excel de Logística es la fuente de verdad. Los **datos históricos** (del Excel, les pueden
  faltar cosas) se distinguen de los **normales** (los que se generan en prod 1) con la columna
  `historico` de órdenes, comprobantes y pagos: la pone la carga (`supabase/seed/prod1_historico.sql`) y
  todo lo que se crea en la app nace normal. Las entregas del Excel van marcadas como «Histórico» y los
  archivos simulados de las demos se registran en `datos_demo`.
  - Los históricos son **permisivos con los archivos**: una OS histórica no espera el contrato firmado ni una
    OC histórica la guía para ir a Tesorería; su comprobante o su pago sin archivo dice «Histórico · sin
    archivo» (no la imagen simulada) y su factura se puede registrar sin archivo. La orden muestra «Origen:
    Histórico (Excel)».
  - Los normales exigen el archivo de la factura al registrarla.
- **Hora de Lima:** la base trabaja en `America/Lima` (migración `prod1_zona_lima`): «hoy» es el día de
  Lima también de noche.
- **Cuenta sin perfil:** va a «Sin acceso» (antes la app la trataba como Logística).
- **Seguridad (auditoría del 05/11/2026, migración `prod1_seguridad`):**
  - Para la base solo existen los roles de prod 1: `rol_actual()` / `rol_en()` tratan a Contabilidad, Residente,
    Ing. de Operaciones y RRHH como sin perfil (no leen nada ni pasan ningún RPC). El Jefe de Operaciones no pasa
    ninguna función que escriba y de los archivos solo ve las fotos de las entregas.
  - El token del link de cotización solo lo ve Logística (`token_cotizacion_de` en `v_ordenes` / `v_por_pagar`).
    `ordenes_compra` se lee **por columnas**: una columna nueva necesita su `grant select (…)`.
  - Logística solo cambia `tipo_material` de un ítem (no su tolerancia de sobreprecio).
  - Lo que se hace con la clave secreta (Admin, Empresas, firma, huella) mira el rol vigente en la base
    (`requireSesionVigente`): un Admin desactivado pierde el panel al instante. Nadie se reactiva a sí mismo.
  - **Contraseñas fuera de Supabase Auth** (migración `prod1_credenciales`): cada una vive en `credenciales` (bcrypt),
    que solo lee el servidor; en `auth.users` queda siempre una al azar (un trigger reemplaza toda contraseña que le
    llegue a Auth). Así no sirve probar contraseñas directo contra la API de Supabase (con la clave pública, sin pasar
    por los límites de la app), ni cambiarla con un token robado (`PUT /auth/v1/user`: Auth lo acepta, pero no es la
    que vale). El servidor verifica la contraseña (`ingreso_valido`, que tarda lo mismo exista o no la cuenta) y abre
    la sesión con un enlace mágico de un solo uso, generado y canjeado ahí mismo, como la huella
    (`src/lib/sesion-servidor.ts`). Alta, restablecimiento y cambio: `fijar_contrasena` (cierra las demás sesiones).
  - **Login: intentos** (`ingreso_intentar`, migración `prod1_ingreso_atomico`; atómico: contar, verificar y registrar van
    juntos, con un bloqueo por cuenta). Intentos fallidos en 10 minutos, y espera hasta que el más viejo los cumpla
    (aun con la contraseña correcta; la cuenta regresiva en el botón):
    - **3 por IP y cuenta**: los fallos de un tercero solo lo hacen esperar a él; el dueño entra desde otra IP;
    - **10 por IP** (todas las cuentas): no deja afuera a toda una oficina por los errores de uno;
    - **20 por cuenta desde dispositivos no conocidos** (un ataque repartido en muchas IP). No frena a los
      **dispositivos conocidos**, donde la cuenta ya entró antes (cookie firmada `prod1_conocido`, httpOnly,
      `src/lib/dispositivo-conocido.ts`): nadie deja afuera al dueño sabiendo su correo; esos solo cuentan sus propios
      fallos (3). La huella tampoco pasa por estos topes.

    Sin CAPTCHA (con las contraseñas fuera de Auth no hace falta). Auth no manda correos (hook `send_email` →
    `hook_sin_correo`): ni códigos ni recuperación que se puedan pedir y adivinar; los enlaces de las sesiones los
    genera y canjea el servidor (códigos de 10 caracteres, 5 minutos).
  - «Cerrar sesión» cierra solo la de ese dispositivo. Una sesión cerrada no da nada aunque su token siga vigente.
  - `/sb` (local) no reenvía las cookies a Supabase: no las usa y, con más de 8 KB (en localhost llegan también las del MVP), su
    puerta de entrada responde «Bad request» a todo. Pide la contraseña de la demo y solo deja pasar la clave pública; sin esa contraseña no pasa ningún
    POST salvo las dos rutas públicas (`/cotizar/<token>/enviar`, `/acceso/entrar`).
  - **Túnel: dado de baja** (04/11/2026). No se vuelve a abrir: para probar en el celular, la URL de Vercel.
  - Cabeceras: sin incrustar en otro sitio, `nosniff`, `Referrer-Policy`; los XML / SVG de `/sb` en sandbox.
  - El precio de una cotización debe ser mayor que 0. Los tokens falsos ya no bloquean los links reales.
  - El CSV de la auditoría no lleva fórmulas.
  - Re-auditoría (migración `prod1_seguridad_2`): las rutas de archivos no admiten `..`, `//`, `\` ni `%` (el link
    entregaba cualquier archivo); precios de cotización solo números válidos; sin la contraseña de la demo no pasa
    ninguna server action (el envío del proveedor y la contraseña de la demo son rutas: `/cotizar/<token>/enviar`,
    `/acceso/entrar`); el contrato del link va sin la imagen de la firma; huellas solo para el servidor y desafíos
    limitados por IP; los intentos de login ya bloqueados no se registran. Ítems: auditados en todo cambio.
  - Re-auditoría contra producción (migración `prod1_seguridad_3`):
    - el bloqueo con huella, también en la base (arriba);
    - **archivos por rol y carpeta**: facturas (`comprobantes`) Logística; en `documentos`, `pagos/` Tesorería y
      `guias/`, `proveedores/` y `<obra>/<orden>/` Logística; lo demás (firmas, entregas, demos) solo el servidor;
    - el **Jefe de Operaciones** no lee lo financiero (facturas, pagos, retenciones, detracciones, contactos y personas):
      solo lo de su seguimiento;
    - **contraseñas**: con letras y números; cambiar la propia pide la actual (con un tope de 5 intentos en 10 minutos, y
      queda en la auditoría «Cambio de contraseña fallido»);
    - la cookie de sesión va solo por HTTPS en producción y `SameSite=Lax`;
    - el bundle no lleva la lista de usuarios locales ni su contraseña (`NEXT_PUBLIC_USUARIOS_LOCALES` fija al
      compilar); `/acceso` no existe sin contraseña de demo;
    - sin `TRUNCATE` / `TRIGGER` / `REFERENCES` para anon y las sesiones; el envío del proveedor no devuelve errores
      crudos de Postgres.
- **Login:** sol / luna arriba a la derecha (claro u oscuro, el mismo tema del menú).
- **Huella (passkey, WebAuthn):** cada usuario la activa por dispositivo desde su menú › Huella (ahí ve y quita
  sus dispositivos). En la app instalada (PWA) se ofrece una vez si el teléfono tiene huella o rostro. Con ella:
  - **entra sin contraseña:** el login la pide solo al abrirse (no si cerró sesión a propósito) y tiene «Entrar
    con huella»; el servidor verifica la firma y abre la sesión con un enlace mágico de un solo uso;
  - **la app se bloquea** cada vez que se abre (y al volver de otra app tras más de 1 minuto fuera) y se
    desbloquea con la huella; «Usar contraseña» cierra la sesión. Se abre apenas el teléfono acepta la huella y
    el servidor la verifica después (si la rechaza, vuelve a bloquear). Mientras carga la app recién abierta, la
    pantalla no se muestra (`BLOQUEO_SCRIPT`, `src/lib/bloqueo.ts`).
  - **el servidor y la base hacen cumplir el bloqueo** (`src/lib/bloqueo-servidor.ts`, proxy, tabla
    `sesiones_bloqueo`): la sesión abierta en un dispositivo con la huella (al activarla, al entrar con ella o con
    contraseña en ese dispositivo) queda en la base con su «desbloqueado hasta», que se renueva con los pedidos y un
    latido cada minuto mientras la app está a la vista, y vence a los 3 minutos sin actividad. Vencido:
    - el proxy no entrega ninguna pantalla: redirige a `/desbloquear` (y un pedido que no es una pantalla recibe 401);
    - la base trata a la sesión como sin perfil (`rol_actual()` / `rol_en()`): ni tablas, ni RPC, ni archivos, ni
      realtime, aunque se use su token directo contra la API.

    Desactivar JavaScript, ver el código, borrar las cookies, inventar el `Origin` (la huella se busca en el dominio
    al que llegó el pedido) o cerrar la sesión en Auth no se lo salta: las cookies firmadas (httpOnly) solo
    evitan preguntarle a la base en cada pedido. Solo el servidor desbloquea, tras verificar la huella. Desbloquear y
    cerrar sesión van por rutas (`/desbloquear/opciones`, `/desbloquear/verificar`, `/login/salir`) que funcionan con
    la pantalla bloqueada; `/desbloquear?volver=` solo vuelve a una ruta de la app (nunca a otro dominio).

  Si otra persona entra con contraseña en ese dispositivo, la huella deja de ofrecerse. Una huella quitada desde
  otro dispositivo deja de ofrecerse al fallar. Las credenciales (`huellas`, solo la clave pública) y los
  desafíos de un solo uso (`huella_desafios`, 5 min) solo los lee el servidor. Valen solo en el dominio en que se
  activaron: al cambiar de dominio, cada uno la activa de nuevo. Auditoría: «Inició sesión · con huella»,
  «Desbloqueó con huella», intentos fallidos, y cada alta o baja de una huella (`src/lib/huella.ts`).
- **Barra de navegación de Android** (atrás, inicio, tareas) en la app instalada: la pinta Chrome con el
  `theme_color` del manifiesto, que no puede seguir el tema; va oscura (con íconos blancos) en los dos temas. La
  barra de arriba sí sigue el tema (`meta theme-color`, `BarrasSistema`). Las apps ya instaladas toman el color
  cuando Chrome actualiza la app (o al reinstalarla).

### Heredado del MVP (ya implementado)

- **Detracciones:** Gerencia marca, por obra e ítem, cuáles llevan detracción. Ninguno la lleva por
  defecto; al marcarlo entra con 5 % y se puede editar. No se propone si la factura no pasa el mínimo
  (S/ 700, configurable por Gerencia). Tesorería paga el total menos retención y detracción; la
  detracción solo queda registrada (en el MVP la paga Contabilidad).
- **Rechazo de Tesorería** (prod 1): Tesorería elige **qué hay que corregir** y la orden vuelve solo hasta ahí
  (antes, siempre a «Cotizando», y había que reconfirmar precios que estaban bien). El motivo es obligatorio.

  | Corregir | Vuelve a | Logística |
  |---|---|---|
  | Datos o documentos (por defecto) | «Guía / Contrato», con su factura | corrige y toca «Reenviar a Tesorería» (con «Qué se corrigió») |
  | La factura | «Facturar», con sus precios (la factura se anula) | registra la nueva: va sola a Tesorería |
  | Los precios | «Cotizando» (la factura se anula, el link se renueva) | revisa los precios y registra la factura nueva |

  Si la factura no se puede anular (tiene pagos, ya está contabilizada o cubre varias órdenes), solo se puede
  pedir corregir datos o documentos, y se dice por qué. Mientras esté por corregir, la orden dice «Rechazada»
  en la lista de Logística (en cualquier pestaña) y «Rechazada, por corregir» en su detalle, con el motivo
  arriba. Al volver, Tesorería recibe un aviso y la ve «Reenviada» en Por pagar y, en la orden, qué se
  corrigió. El historial (Logística y Tesorería) guarda cada rechazo: cuándo, quién, qué corregir, el motivo,
  las facturas anuladas y el reenvío (cuándo, quién y la nota). RPC `rechazar_documento` (con `p_correccion`) y
  `reenviar_a_tesoreria`; el reenvío lo registra `enviar_a_tesoreria`.
- **Guía:** una por orden, y arranca con «el proveedor con su unidad», que es lo más común.
- **Logística** ve plegadas todas las etapas anteriores de la orden: constancia de pago, vouchers y
  rechazos.
- Las **cuentas bancarias de proveedores** las leen Logística, Tesorería y Gerencia; Operaciones no.
- **Tesorería › Presupuesto:**
  - pestañas Material / Mano de obra / Subcontrato;
  - filtros de empresa (por logos), de obra, de varias etapas a la vez y de pago (Por pagar,
    Pagado parcial, Pagado completo, Sin pagar);
  - subtotales por etapa y el total de lo filtrado fijo abajo.

## Pendientes para producción

- **Paso a producción** (Vercel + Supabase en la nube + repo propio): ver `docs/produccion.md`. Ya quedan
  por variables de entorno los botones de acceso rápido (`NEXT_PUBLIC_USUARIOS_LOCALES`), la contraseña de
  la demo (`DEMO_ACCESO`) y la conexión directa del navegador con
  Supabase sin `/sb` (`NEXT_PUBLIC_SUPABASE_DIRECTO=1`); en local siguen como antes hasta el paso.
- **Quién firma por cada empresa:** ya se elige en Admin › Empresas (sin elegir, el gerente con la firma más
  reciente); falta que respondan si es uno por empresa. Los gerentes subirán su firma («Mi firma») en su momento.
- **Detracciones y retenciones de 4ta:** se registran; las paga Contabilidad, que aún no está en prod 1.
- **Contabilidad:** dos roles iguales, como Operaciones: Jefe de Contabilidad y Asistente de Contabilidad (Ángeles y Jerson), cuando
  ese módulo entre a prod 1.
- **Observaciones de datos:**
  - Virgen del Mar numera sus órdenes desde 1000140 porque el Excel trae una OC 1000139 (parece un error de tipeo); se deja como
    en el Excel.
  - Suspensiones de 4ta cruzadas por nombre, por confirmar: dos proveedores con código interno (`ZAMANTACRED`, `ASEVENT`) y un RUC que
    está en el proveedor «PROVISIONAL DE LOGISTICA CONTOGURIZ».
  - Las OS 100494 (Mercedes A) y 100496 (Mercedes B) del Excel son ítems «RETENCION 5%» sin pagar, del 15/05/2026: por decidir si se
    pagan, porque la OS de retenciones de esas obras devolvería también ese dinero.
  - Las líneas de mano de obra a otros porcentajes del presupuesto (0.855, 0.8938, 0.665, 0.9025) son otros precios, no retención.

## Entorno (separado del MVP)

| | MVP | Prod 1 |
|---|---|---|
| Carpeta | `C:\Code\Projects\ERP\MVP\MVP-1` | `C:\Code\Projects\ERP\PROD1` |
| Supabase (`project_id`) | `erp-mvp1`, puertos 54xxx | `erp-prod1`, puertos 55xxx (API 55321, DB 55322, Studio 55323, correo 55324) |
| Next | `:3000` | `:3100` (`npm start` / `npm run dev` ya usan `-p 3100`) |
| Cookies | `sb-erp-auth-token`, `erp_*` | `sb-prod1-auth-token`, `prod1_*`. En localhost las cookies no se separan por puerto; sin esto, las sesiones de los dos chocarían. |

Los dos pueden correr a la vez.

- **Reinicio de datos:** `npx supabase db reset` (carga también `usuarios_locales.sql`, solo local), `ERP_PASS=erp12345 npm run db:demos`
  y la plantilla del export (`npm run excel:plantilla -- <ruta>`). Las pruebas leen datos de las demos al cargarse: sin ellas la
  suite dice «0 pruebas». `db:demos` (`scripts/demos-locales.sh`) cambia por un rato las funciones de rol por las del MVP, porque
  las demos usan cuentas que en prod 1 no entran, y siempre las restaura al terminar.
- **Excel nuevo:** `python -I scripts/extract_excel.py <ruta>.xlsm supabase/seed/excel.sql`, reinicio de datos y su plantilla.
- **Pruebas:** `ERP_DEMO=… ERP_PASS=erp12345 npx playwright test` contra `:3100`. La base de las pruebas es
  `supabase_db_erp-prod1`. `tests/e2e/flujo.spec.ts` recorre el flujo entero solo por las pantallas (sin seeds;
  SQL solo para comprobar y limpiar): obra, presupuesto, proveedor, OC con guía y OS con recibo por honorarios,
  link del proveedor, factura, rechazo y reenvío, pago, constancia, consulta, seguimiento y auditoría.
- **Recorrido en producción:** `npm run test:prod` (`scripts/recorrido-prod.mjs`) corre ese mismo `flujo.spec.ts` contra
  `hogarian-erp.vercel.app` y la base de la nube, con obras, proveedores e ítems «E2E» nuevos y cuentas temporales
  `e2e.<rol>@hogarian.test` (contraseña al azar, nunca las reales). Limpia aunque falle y compara las filas de todas las
  tablas con las de antes. Si se corta, `npm run test:prod -- --limpiar`. Los usuarios reales pueden ver avisos en la
  campana mientras corre (y push, si tienen el celular activado): conviene correrlo sin nadie trabajando.
- **Build:** `npm run build`. Luego hay que matar el `next start` de prod 1 (el del puerto 3100, no el del
  MVP) y comprobar que un chunk CSS o JS responda 200.
