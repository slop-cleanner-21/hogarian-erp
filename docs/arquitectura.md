# Arquitectura

## Stack

| Capa | Tecnología |
|---|---|
| App | Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`), React 19, TypeScript, Tailwind CSS 4 |
| Datos | Supabase local en Docker: Postgres 17, Auth, PostgREST, Storage y Realtime |
| PDF | `@react-pdf/renderer`: PDF de la orden en el cliente, y en el servidor para el ZIP del expediente |
| Imágenes generadas | `next/og`: voucher y comprobante simulados, íconos de la PWA |
| Avisos push | `web-push` (VAPID) y el service worker `public/sw.js` |
| ZIP | `fflate` (expediente) |

## Estructura

```
src/
  app/                    una carpeta por módulo (rol) + rutas compartidas
    logistica/ contabilidad/ tesoreria/ residente/
    gerencia/ operaciones/ obras/ rrhh/
    cotizar/[token]/      link público del proveedor (sin sesión)
    consulta/orden/       orden en solo lectura (varias áreas)
    presupuesto/          pantallas y acciones compartidas del presupuesto de obra
    avisos/               campana: lista de avisos y suscripción push
    entregas/             acción para registrar entregas (Logística y Residente)
    acceso/ login/        puerta de la demo y login
  components/             UI compartida (ui/ = primitivas: Button, Field, Sheet, SearchSelect…)
  lib/                    supabase (server/client), tipos generados, formato, push, realtime…
supabase/
  migrations/             esquema, vistas, RPC y RLS (una migración por cambio)
  seed/                   base.sql, excel.sql (no versionado), demo.sql, cuentas_items.sql…
scripts/                  extract_excel.py, demo-entregas.mjs, simular-obra.mjs
tests/audit/              auditorías de interfaz con Playwright (solo local: no se versiona, trae datos reales)
docs/                     esta documentación
```

## Decisiones principales

- **La lógica de negocio vive en la base.** Los cambios de estado y las validaciones son funciones RPC en plpgsql: crear orden, confirmar precios, pagar, rechazar, entregar, publicar presupuesto… La app solo las llama desde Server Actions con `requireSesion([roles])`. Así, la regla vale igual para la app, para un script o para la API.
- **Sesión.** El proxy y `getSesion` validan el JWT localmente con `auth.getClaims()` (firma ES256, sin viaje al servidor de auth). El rol y el nombre van en `app_metadata` del token: el trigger `perfiles_a_token` los copia de `perfiles` a `auth.users`. Un cambio de rol se ve al refrescar el token (máx. 1 h) o al volver a entrar.
- **Carga.** Cada módulo tiene `loading.tsx` con un esqueleto que aparece al instante al navegar; las pestañas se marcan al tocarlas y los avisos se borran con `useOptimistic`.
- **Roles.** `perfiles.rol` decide qué módulos se ven: `HOME_BY_ROL` en `src/lib/nav.ts` y `MODULOS` en `src/components/shell.tsx`. Las RPC sensibles vuelven a comprobar el rol con `rol_actual()` / `mi_rol()` (por ejemplo, rechazar solo lo hace Tesorería). ADMIN entra a todo.
- **RLS.** Está activa en todas las tablas. Las tablas nuevas restringen la escritura a sus RPC, y los avisos son de cada usuario. Las tablas de las etapas 1 y 2 siguen siendo permisivas para `authenticated`; endurecerlas por rol y por obra queda pendiente para producción (ver `seguridad-cotizacion.md`).
- **Tipos.** `npm run db:types` genera `src/lib/database.types.ts`, y `src/lib/types.ts` deriva de ahí los tipos que usa la UI.
- **Navegador → Supabase.** Pasa por la propia app (`/sb/*`, rewrite en `next.config.ts`) para que funcione detrás de un solo dominio o túnel. En la nube el navegador puede hablar directo con Supabase.
- **Tiempo real.** Supabase Realtime (`postgres_changes`) con el token de la sesión (`abrirCanal` en `src/lib/realtime.ts`):
  - el detalle de la orden se refresca cuando el proveedor cotiza o cambia el estado;
  - la campana se actualiza sola.
- **Avisos.** La base crea filas en `notificaciones` (funciones `notificar*`). Después de cada acción que puede generarlas, la Server Action llama a `enviarAvisosPendientes()` con `after()`, que los envía como push a las suscripciones del usuario.
- **Archivos.** Hay dos buckets privados:
  - `comprobantes`;
  - `documentos`: vouchers, guías, contratos y fotos de entregas.

  Se muestran con URL firmadas (1 hora). Cuando falta el archivo de un comprobante o de un voucher, se muestra una imagen simulada con el sello «NO VÁLIDO». Las imágenes se abren en el visor de la app (`src/components/visor.tsx`), que agrega una entrada al historial para que «atrás» lo cierre; los PDF van a otra pestaña o, en la PWA, se descargan (`EnlaceArchivo`, `abrirBlob`).
- **Datos de demostración.** `npm run db:demo-archivos` genera comprobantes y vouchers simulados para todo lo que no tiene archivo y registra cada uno en `datos_demo` (tabla, registro, archivo), para quitarlos al migrar los datos reales.
- **PWA.** `manifest.ts`; las metas `theme-color` siguen el tema elegido (`BarrasSistema`); al abrirse, la app retoma la última pantalla (`RecordarRuta`). Los filtros viven en la URL y se recuerdan por pantalla en `localStorage` (`RecordarFiltros`).

## Entorno

| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente de Supabase |
| `SUPABASE_SECRET_KEY` | Envío de push (lee avisos y suscripciones de todos) y scripts de datos |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `DEMO_ACCESO` | Contraseña de la puerta de la demo (`/acceso`) |
| `NEXT_PUBLIC_USUARIOS_LOCALES=1` | Botones de entrada rápida por rol en el login |

## Comandos

| Comando | Qué hace |
|---|---|
| `npx supabase db reset` | Migraciones + seeds (datos reales del Excel y obra DEMO HOGARIAN) |
| `npm run db:demo-entregas` | Fotos de las entregas de la obra DEMO |
| `npm run db:simular` | Simula la obra completa RESIDENCIAL LOS ÁLAMOS (ver `simulacion.md`) |
| `npm run db:demo-fotos` | Fotos de entregas de las obras demo: ilustraciones planas por grupo de material o servicio (dibujadas en SVG, guardadas en PNG), registradas en `datos_demo` |
| `npm run db:demo-archivos` | Comprobantes y vouchers simulados para lo que no tiene archivo (registrados en `datos_demo`) |
| `npm run db:types` | Regenera los tipos de la base |
| `npm run build && npm start` | Producción local en el puerto 3000 |
| `npx next typegen` | Tipos de rutas (`PageProps`, `LayoutProps`) tras agregar rutas |
