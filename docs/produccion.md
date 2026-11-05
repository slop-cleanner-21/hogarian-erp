# Paso a producción (Prod 1)

Vercel (la app) + Supabase en la nube (base, auth y archivos) + un repo de GitHub propio. Hasta el día del
paso, local sigue igual: accesos rápidos y contraseña de la demo. (El túnel se dio de baja: no se usa.)

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
   ```
   Auth (registro apagado: **en la nube arranca abierto**; sin confirmación por correo): `config push` desde una
   copia de `config.toml` con `site_url` y `additional_redirect_urls` del dominio de la app (el del repo apunta a
   local) y `max_frequency = "1m0s"`; revisar el diff antes (`yes n | npx supabase config push --workdir <copia>`).
   La clave secreta se copia del panel (Project Settings › API Keys): `supabase projects api-keys` la muestra
   enmascarada. Sirve también la `service_role` clásica.
3. Crear el primer Admin (la contraseña temporal se muestra una vez):
   ```sh
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<secreta> \
     node scripts/produccion/crear-admin.mjs <correo> "<Nombre>"
   ```
4. Cargar los datos reales, sin demos ni usuarios de prueba (usa el psql del contenedor local):
   ```sh
   PROD_DB_URL='postgresql://postgres.<ref>:<clave>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres' \
     bash scripts/produccion/cargar-datos.sh
   ```
   Carga, en orden: `base`, `excel`, `tipo_material`, `cuentas_items`, `historico` (a nombre del Admin),
   `prod1_historico` (marca de histórico) y `prod1_envio`. **No** carga `usuarios_locales`, `asignaciones`,
   `demo` ni los scripts `db:demo-*`.
5. Respaldos: activar los diarios del plan (o *Point in Time Recovery*).

Ensayado en local el 04/11/2026 con este mismo orden (base vacía → Admin → carga): 734 órdenes históricas,
1988 entregas históricas y todas las pantallas sin errores.

## 3. Vercel

1. Importar el repo de GitHub: cada push a `main` despliega. El proyecto debe decir framework **Next.js** (si se
   crea por la CLI queda sin framework y todo da 404). Las funciones corren en São Paulo (`vercel.json`,
   `regions: ["gru1"]`), junto a la base.
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
   la demo).
4. **CAPTCHA del ingreso (Cloudflare Turnstile)**, gratis:
   1. dash.cloudflare.com › Turnstile › *Add widget*: nombre «Hogarian ERP», dominio de la app (p. ej.
      `hogarian-erp.vercel.app`), modo **Managed**. Da la *site key* (pública) y la *secret key*.
   2. Vercel: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (la pública), `TURNSTILE_SECRET_KEY` (la secreta, sensible) y
      `CAPTCHA_EN_SUPABASE=1`.
   3. Supabase Auth › CAPTCHA (o `config push` desde la copia de `config.toml`): proveedor Turnstile con la misma
      secreta. Desde ahí todo ingreso con contraseña necesita el token: también quien llame directo a la API.
   4. Volver a desplegar (la pública se fija al compilar). Comprobar: `POST /auth/v1/token?grant_type=password`
      sin token responde «captcha» (no «credenciales»), y el login de la app entra.
   Sin esto, la app igual limita los reintentos (espera creciente desde el 3.er fallo por IP, y 10 por cuenta o 30
   por IP en 15 minutos), pero no muestra CAPTCHA.
3. Dominio: agregarlo en Vercel y apuntar el DNS. Las huellas (passkeys) van atadas al dominio: las activadas en
   `*.vercel.app` no sirven en el dominio propio, y cada usuario la activa de nuevo.

## Entorno de pruebas (04/11/2026)

En las cuentas personales hasta sacar el ERP a producción (05/11/2026: se decidió no transferir todavía). Luego se
transfieren (Supabase › Project Settings › General › Transfer project; Vercel › Settings › General › Transfer
Project; la URL de Supabase y la de Vercel no cambian, y las huellas siguen valiendo):

- **Costo en Supabase:** la organización `hogariangroup` es de pago y su crédito de cómputo ya lo usa
  `hogarian-comercial`: el ERP suma **$10/mes**. Tras transferirlo, subirlo a **Micro** (Compute and Disk) sin costo
  extra (reinicia la base unos 2 minutos).
- **Costo en Vercel:** el equipo Pro cobra **$20/mes por miembro que despliega**, no por proyecto (Viewer es gratis).
  El ERP no suma un fijo: sus builds y funciones salen de los $20 de crédito incluido. En un equipo Pro solo se
  despliegan los commits de autores que son miembros (el correo del commit debe estar en la cuenta de Vercel), y
  hay que revisar la conexión de Git (Settings › Git) tras el traspaso.

| | |
|---|---|
| App | https://hogarian-erp.vercel.app (Vercel `josev-7139/hogarian-erp`, conectado a `main`) |
| Supabase | proyecto `yqhdknwllnartyswbkoa` (organización personal, sa-east-1) |

## 4. Antes de abrirlo a todos

- Entrar con el Admin, cambiar su contraseña y crear los usuarios reales (con el DNI de Gerencia).
- Gerencia sube su firma («Mi firma») y revisa los ítems con detracción y su %.
- En Admin › Empresas: razón social, RUC (falta el de ARISANT), dirección fiscal y quién firma por cada una.
- Prueba de punta a punta con una o dos órdenes reales: OC, guía, factura, Tesorería, pago y constancia.
- Pendientes que no bloquean: recepción (con el rol de residente), quién firma por cada empresa, el pago de
  detracciones y retenciones (Contabilidad, fuera de prod 1).
