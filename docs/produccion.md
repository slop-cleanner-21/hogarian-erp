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
   La copia lleva lo mismo que el repo en contraseñas (`password_requirements = "letters_digits"`,
   `secure_password_change = true`), `otp_length = 10`, `otp_expiry = 300`, el hook `[auth.hook.send_email]`
   (`pg-functions://postgres/public/hook_sin_correo`: Auth no manda correos) y `token_verifications = 300`: todo ingreso canjea un enlace mágico desde el
   servidor (una sola IP para todos). Las contraseñas no están en Auth (`credenciales`): el primer Admin lo crea el
   script, que la guarda ahí.
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

Con cada Excel nuevo, también su plantilla para el export (el mismo archivo):
`node --env-file=.env.produccion.local scripts/subir-plantilla-excel.mjs <ruta>.xlsm`.

Para volver a cargar el Excel en una base ya en uso: `scripts/produccion/recargar-datos.sh`, en una sola transacción (si
falla, no cambia nada). Borra lo operativo y corre los mismos seeds; conserva cuentas, auditoría, catálogos, parámetros y
lo que el Admin puso en las empresas. Antes, un respaldo con `pg_dump`. Los links de cotización cambian y no borra archivos
del storage. Se usó el 05/11/2026: datos idénticos a los anteriores, salvo los accesos a links.

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
3. Dominio: agregarlo en Vercel y apuntar el DNS. Las huellas (passkeys) van atadas al dominio: las activadas en
   `*.vercel.app` no sirven en el dominio propio, y cada usuario la activa de nuevo.

## Producción en las cuentas de la empresa (06/11/2026)

| | |
|---|---|
| App | https://hogarian-erp.vercel.app (también https://hogarian-erp-phi.vercel.app; Vercel, equipo **HOGARIAN GROUP**, proyecto `hogarian-erp`, conectado a `main`) |
| Supabase | proyecto `fwdhevzbludhehoyfnho` (organización **hogariangroup**, sa-east-1, Micro) |
| Claves locales | `.env.produccion.local` (no se sube): contraseña de la base, URL, clave pública y secreta |

Se armaron nuevos (no transferidos): migraciones con `db push`, Auth con `config push` (copia de `config.toml` con la URL
de la app), y los datos copiados del entorno de pruebas tal cual (`pg_dump --data-only` de `public`, `auth.users` y
`auth.identities`, cargados con `session_replication_role = replica`: sin disparar auditoría ni el trigger de las
contraseñas, que viajan en `credenciales`). Las claves VAPID son nuevas. Las huellas van atadas al dominio: se activan de
nuevo en este.

- **Costo:** Supabase suma **$10/mes** (Micro, en la organización de pago). Vercel cobra por miembro que despliega, no
  por proyecto: el ERP sale de los $20 de crédito del equipo.
- En el equipo Pro solo se despliegan los commits de autores que son miembros (el correo del commit, en la cuenta de
  Vercel).
- `vercel.json` fija el framework (`nextjs`) y la región (`gru1`); `package.json`, Node 24.

El entorno de pruebas anterior (Vercel `josev-7139/hogarian-erp`, Supabase `yqhdknwllnartyswbkoa` en la organización
personal, sus claves en `.env.pruebas-personal.local`) quedó sin uso: el de Vercel se borró (así
`hogarian-erp.vercel.app` pasó al proyecto del equipo); el de Supabase se puede borrar.

## 4. Antes de abrirlo a todos

- Entrar con el Admin, cambiar su contraseña y crear los usuarios reales (con el DNI de Gerencia).
- Gerencia sube su firma («Mi firma») y revisa los ítems con detracción y su %.
- En Admin › Empresas: razón social, RUC (falta el de ARISANT), dirección fiscal y quién firma por cada una.
- Prueba de punta a punta con una o dos órdenes reales: OC, guía, factura, Tesorería, pago y constancia.
- Pendientes que no bloquean: recepción (con el rol de residente), quién firma por cada empresa, el pago de
  detracciones y retenciones (Contabilidad, fuera de prod 1).
