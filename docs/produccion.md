# Paso a producción (Prod 1)

Vercel (la app) + Supabase en la nube (base, auth y archivos) + un repo de GitHub propio. Hasta el día del
paso, local sigue igual: accesos rápidos, contraseña de la demo y túnel.

## 1. Lo que hace falta de la realidad

| Dato | Para qué |
|---|---|
| El Excel de Logística al día del corte (`CONTROL DE COSTOS V2.2.xlsm`) y `ITEM.xlsx` | La carga inicial (`scripts/extract_excel.py` → `supabase/seed/excel.sql`, `cuentas_items.sql`). Desde el corte, el Excel se congela. |
| RUC de **ARISANT** | Hoy está vacío (va en las órdenes, los contratos y el PDF). |
| Usuarios: nombre, correo y rol de cada persona (Logística, Tesorería, Gerencia, Jefe de Operaciones, Admin); DNI de Gerencia | El primer Admin lo crea el script; los demás, el Admin desde la app (Usuarios). |
| Correo del primer Admin | `scripts/produccion/crear-admin.mjs`. |
| Nombre del repo, y la cuenta u organización de GitHub, Vercel y Supabase | Dónde vive cada cosa. |
| Dominio (p. ej. `erp.hogariangroup.com`) y acceso a su DNS | La dirección de la app. Sin dominio propio, la de Vercel (`*.vercel.app`). |
| Fecha y hora del corte | Desde ese momento se trabaja en la app y no en el Excel. |

## 2. Supabase (nube)

1. Crear el proyecto en la región **São Paulo (sa-east-1)**, la más cercana a Lima.
2. Vincular y subir las migraciones (crean tablas, funciones, políticas, buckets y la zona horaria de Lima):
   ```sh
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase config push   # auth: registro apagado, sin confirmación por correo, contraseña de 6+ (la app pide 8)
   ```
   En Auth › URL Configuration: *Site URL* = el dominio de la app.
3. Crear el primer Admin (la contraseña temporal se muestra una vez):
   ```sh
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secreta> \
     node scripts/produccion/crear-admin.mjs <correo> "<Nombre>"
   ```
4. Cargar los datos reales, sin demos ni usuarios de prueba (usa el psql del contenedor local):
   ```sh
   PROD_DB_URL='postgresql://postgres.<ref>:<clave>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' \
     bash scripts/produccion/cargar-datos.sh
   ```
   Carga, en orden: `base`, `excel`, `tipo_material`, `cuentas_items`, `historico` (a nombre del Admin),
   `prod1_historico` (marca de histórico) y `prod1_envio`. **No** carga `usuarios_locales`, `asignaciones`,
   `demo` ni los scripts `db:demo-*`.
5. Respaldos: activar los diarios del plan (o *Point in Time Recovery*).

Ensayado en local el 04/11/2026 con este mismo orden (base vacía → Admin → carga): 734 órdenes históricas,
1988 entregas históricas y todas las pantallas sin errores.

## 3. Vercel

1. Importar el repo de GitHub (framework Next.js, `npm run build`).
2. Variables de entorno (Production):

   | Variable | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | la clave pública (anon / publishable) |
   | `SUPABASE_SECRET_KEY` | la clave secreta (solo servidor: usuarios, firma, avisos push) |
   | `NEXT_PUBLIC_SUPABASE_DIRECTO` | `1`: el navegador habla directo con Supabase y `/sb` no existe |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | claves **nuevas** (`npx web-push generate-vapid-keys`) |
   | `VAPID_SUBJECT` | `mailto:<correo de contacto>` |

   **No** se definen: `NEXT_PUBLIC_USUARIOS_LOCALES` (botones de acceso rápido), `DEMO_ACCESO` (contraseña de
   la demo) ni `SERVER_ACTIONS_ORIGENES` (túnel).
3. Dominio: agregarlo en Vercel y apuntar el DNS.

## 4. Antes de abrirlo a todos

- Entrar con el Admin, cambiar su contraseña y crear los usuarios reales (con el DNI de Gerencia).
- Gerencia sube su firma («Mi firma») y revisa los ítems con detracción y su %.
- En Admin › Empresas: razón social, RUC (falta el de ARISANT), dirección fiscal y quién firma por cada una.
- Prueba de punta a punta con una o dos órdenes reales: OC, guía, factura, Tesorería, pago y constancia.
- Pendientes que no bloquean: recepción (con el rol de residente), quién firma por cada empresa, el pago de
  detracciones y retenciones (Contabilidad, fuera de prod 1).
