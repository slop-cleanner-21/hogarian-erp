# Seguridad del link de cotización

El ERP entero exige sesión, salvo una puerta: el **link de cotización** (`/cotizar/<token>`), que el proveedor abre sin cuenta. Este documento analiza esa puerta, lo que se cambia en la etapa 3 y lo que queda pendiente.

## 1. Cómo funciona hoy

- Cada orden tiene un `token_cotizacion` (UUID v4, generado por Postgres al crear la orden).
- La página llama a `get_cotizacion(token)` y el envío a `enviar_cotizacion(token, precios)`. Las dos funciones son `SECURITY DEFINER` y son **las únicas** que el rol `anon` puede ejecutar (desde el 30/10/2026 también por permisos de ejecución, no solo por políticas).
- Verificado en la base local:
  - Las 23 tablas tienen RLS y ninguna política admite `anon`.
  - `anon` no tiene permisos directos sobre tablas.
  - Los buckets `comprobantes` y `documentos` son privados.
- `enviar_cotizacion` solo acepta precios mientras la orden está «Cotizando», y solo para ítems de esa orden.

## 2. Superficie expuesta y riesgos

| # | Riesgo | Situación hoy | Severidad |
|---|---|---|---|
| R1 | **El link no vence nunca.** Sigue mostrando la orden (obra, empresa, RUC, ítems y precios) aunque la orden esté pagada o anulada. | Abierto | Media |
| R2 | **Se puede reescribir la cotización** cuantas veces se quiera mientras la orden esté «Cotizando», incluso después de enviarla. | Abierto | Media |
| R3 | **Un link reenviado** (el proveedor lo reenvía a otra persona, queda en un chat grupal) da acceso igual. | Inherente a los links | Media |
| R4 | **Adivinar tokens.** Un UUID v4 tiene 122 bits aleatorios: no es viable por fuerza bruta. Sí lo es si el token se filtra (historial, `Referer`, logs de un proxy). | Bajo con UUID v4 | Baja |
| R5 | **Sin límite de intentos ni registro de accesos.** No se sabe quién abrió el link ni cuántas veces; un script podría llamar `enviar_cotizacion` en bucle. | Abierto | Media |
| R6 | **Indexación / `Referer`.** La página no declara `noindex` ni `Referrer-Policy`: si el proveedor sigue un enlace externo desde ahí, el token podría viajar en el `Referer`. | Abierto | Baja |
| R7 | **Llamada directa a la API.** La clave `anon` es pública por diseño. Con ella, cualquiera puede llamar `get_cotizacion`/`enviar_cotizacion` sin pasar por la página; las mismas defensas deben vivir en la base, no en Next. | Defensas ya en la base | Info |
| R8 | **⚠️ La ruta `/sb` publica toda la API de Supabase** (auth, REST, storage) a través de la app. El proxy de la demo la excluye de la contraseña de acceso, y los usuarios de prueba tienen la clave conocida `erp12345` con botones de entrada rápida. Con el túnel abierto, cualquiera con el link podía iniciar sesión por `/sb/auth/v1/token` y leer **datos reales** (RUCs, cuentas bancarias). | **Crítico mientras haya túnel** | Alta |

## 3. Cambios de la etapa 3

**Ciclo de vida del link (resuelve R1, R2 y R3):**

| Momento | Qué ve el proveedor |
|---|---|
| Logística envía el link → cotización *enviada* | Formulario editable. El borrador se guarda en su navegador (`localStorage`, clave por token, solo los precios). |
| El proveedor pulsa **Enviar cotización** → *recibida* | La cotización enviada, **fija, sin poder editar**. |
| Logística **reenvía el link** para que corrija | Se genera un **token nuevo**; el anterior deja de funcionar al instante. |
| Logística **confirma los precios** | El token se anula: «Este link ya no está disponible». |
| La orden se anula | Igual: el link deja de funcionar. |

**Además:**
- **Límite de intentos (R5):** tabla `cotizacion_accesos` con cada lectura y envío (token, hora, acción). `get_cotizacion` y `enviar_cotizacion` rechazan si hay demasiados intentos por token en una ventana corta. Logística puede ver cuántas veces se abrió el link.
- **R6:** la página declara `robots: noindex, nofollow` y `Referrer-Policy: no-referrer`, y no incluye enlaces externos.
- **Datos mínimos:** `get_cotizacion` devuelve solo lo necesario para cotizar (empresa, obra, ítems, cantidades). No expone presupuesto, precios máximos ni histórico.
- **Validación:** se mantiene en la base: la cotización solo se acepta en estado *enviada*, precios ≥ 0 y solo para ítems de la orden.

## 4. Fuera del link: lo que hay que cerrar antes de producción

1. **R8 – exposición de `/sb` (urgente si se vuelve a abrir el túnel):**
   - **Mínimo:** contraseñas de prueba fuertes y distintas, y sin botones de entrada rápida mientras el túnel esté abierto (`NEXT_PUBLIC_USUARIOS_LOCALES=0`).
   - **Correcto:** en la nube el navegador habla directo con Supabase (no hace falta `/sb`), con usuarios reales.
   - Sobre todo: no publicar datos reales en una demo abierta; usar solo la obra DEMO.
2. **RLS por rol (escritura cerrada el 30/10/2026, migración `permisos_por_rol`):**
   - Las tablas son de solo lectura por la API. Solo se escribe directo donde la app lo hace, y solo con su rol: ítems, proveedores y sus cuentas bancarias, tipos de material y transportistas (Logística); cuentas contables y la cuenta de una OP (Contabilidad). Nadie puede cambiar su rol en `perfiles`.
   - Todas las funciones que escriben exigen el rol que las usa en la app (`exigir_rol`; ADMIN siempre) y corren como su dueño.
   - `anon` solo ejecuta `get_cotizacion` y `enviar_cotizacion`; `notificar` es interno.
   - Storage: cada usuario borra o cambia solo lo que subió. El residente solo ve y sube fotos de entregas y avances de sus obras, y no ve comprobantes.
3. **Lectura por rol (02/11/2026, migración `lectura_por_rol`):** políticas restrictivas que se suman a las de arriba. Cada rol lee lo que usa su pantalla; ADMIN lee todo.

   | Tabla | La leen |
   |---|---|
   | `asiento_lineas`, `cuentas_contables` | Contabilidad |
   | `asientos` | Contabilidad, Logística y Tesorería (para saber si un comprobante está contabilizado) |
   | `pagos`, `ordenes_pago`, `rechazos`, `guias`, `comprobantes_historial` | Contabilidad, Tesorería y Logística |
   | `cotizacion_accesos` | Logística |
   | `proveedor_cuentas` (banco y cuenta del proveedor) | Logística, Tesorería, Contabilidad y Gerencia |
   | `personas`, `solicitudes` | RRHH, Gerencia y Operaciones (Ingeniero y Jefe) |
   | `solicitud_adjuntos` | Gerencia y Operaciones |
   | `audit_log`, `datos_demo` | Solo ADMIN |

   - **RRHH** solo lee personas, solicitudes, perfiles y sus avisos; no ve ninguna otra tabla ni archivo.
   - **Siguen abiertas** a todo rol salvo RRHH (y, en lo suyo, el residente): órdenes, ítems, partidas, proveedores (sin sus cuentas bancarias), comprobantes y aplicaciones de pago. Las vistas de órdenes de Operaciones y Gerencia calculan con ellas lo facturado y lo pagado; como las vistas respetan la RLS, cerrarlas daría montos en cero sin error.
   - **Archivos:** los vouchers (`documentos/pagos/` y `demo/`) y el bucket `comprobantes` solo los leen Contabilidad, Tesorería y Logística; los sustentos (`documentos/solicitudes/`), Gerencia y Operaciones.
   - **Sin perfil (02/11/2026, migración `sin_perfil_adjuntos_archivos`):** un usuario autenticado sin fila en `perfiles` pasaba los controles `rol_actual() not in (...)` (NULL) y leía todo. Ahora su rol es `''`, una política restrictiva le cierra todas las tablas y archivos, y el **registro (signup) está apagado** en `supabase/config.toml`: los usuarios los crea el administrador.
   - **`adjuntos`:** nadie edita ni borra por la API; el insert exige que el archivo esté en la carpeta de su orden (`{obra}/{número}/…`), así nadie enlaza un archivo ajeno para leerlo. Los vouchers solo los registra `pagar_documento`.
   - `anon` no tiene privilegios sobre tablas ni vistas.
   - `registrar_pago` (aplica pagos a comprobantes sin mirar si la orden está en Tesorería) ya no se ejecuta por la API: queda para seeds y cargas. La app paga con `pagar_documento`, que sí lo exige.
   - Ojo en `supabase/config.toml`: el registro se apaga con `[auth] enable_signup = false`. **No** apagar `[auth.email] enable_signup`, que desactiva todo el login por correo.
   - **Queda:** Gerencia y Operaciones leen el registro de compras (`v_registro_compras`) por la API, aunque su pantalla no lo usa; y las funciones de cálculo por partida (`fn_presupuesto_efectivo`, `fn_requerido_partida`…) responden a cualquier rol con perfil, porque las usa una vista.
   - **Cuentas bancarias de los proveedores (resuelto el 03/11/2026, migración `proveedor_cuentas`):** eran columnas de `proveedores`, legibles por todo rol con perfil salvo RRHH. La RLS es por filas y todos los usuarios son el mismo rol de base (`authenticated`), así que se movieron a la tabla `proveedor_cuentas`: la leen Logística, Tesorería, Contabilidad y Gerencia (y ADMIN) y solo Logística la escribe. Operaciones (Ingeniero y Jefe), Residente y RRHH no la ven. `v_por_pagar` y `v_pendientes_pago` la unen con LEFT JOIN: para quien no puede leerla, banco y cuenta salen nulos sin perder la fila.
4. **Fotos de entregas:** la app obliga al residente a usar la cámara integrada y exige GPS, pero eso se garantiza en el navegador, **no ante alguien que manipule el cliente** (puede enviar una imagen o coordenadas falsas a la API). Mitigaciones: guardar la hora del servidor junto a la del dispositivo, la precisión del GPS, y a futuro validar la distancia a la obra y los metadatos de la imagen. Sirve para trazabilidad, no como prueba forense.

## 5. Mejoras futuras (no incluidas)

- **PIN de un solo uso** enviado al proveedor por otro canal (SMS/WhatsApp) para abrir el link.
- **Vencimiento por tiempo** además del vencimiento por estado (p. ej. 15 días sin enviar).
- **Portal de proveedores** con cuenta propia, cuando haya más interacción que cotizar.
- **WAF / rate limiting en el borde** (Cloudflare) además del límite en la base.

## 6. Tiempo real en la nube

Sí: con Supabase en la nube, la app puede actualizarse sola. Supabase Realtime abre un **WebSocket** desde el navegador y avisa los cambios de las tablas suscritas (`postgres_changes`), **respetando la RLS** (cada usuario solo recibe lo que puede leer).

No es automático: hay que (1) agregar las tablas a la publicación `supabase_realtime` y (2) suscribirse desde la pantalla. Eso se hace en la etapa 3: con la orden abierta, cuando el proveedor envía su cotización, la pantalla de Logística se refresca sola, y la campana de avisos también. En local funciona igual si se activa el servicio `realtime` del Docker (hoy apagado por memoria).
