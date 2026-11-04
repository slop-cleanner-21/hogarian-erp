# Hogarian ERP · Prod 1

Versión de producción reducida: Logística, Tesorería, Gerencia (presupuestos y seguimiento) y el Jefe de Operaciones (seguimiento). Sin Contabilidad, Residente, Ingeniero de Operaciones ni RRHH. Decisiones y entorno en [`docs/prod1.md`](docs/prod1.md). Next.js 16 + Supabase local (Docker), separado del MVP (puertos 55xxx y :3100).

## Levantar en local

```bash
npm install
npx supabase start             # Studio en http://127.0.0.1:55323, correo local en :55324
npx supabase db reset          # migraciones + seeds (datos del Excel y obra DEMO)
npm run db:demo-entregas       # fotos de las entregas de la DEMO (van al storage)
npm run db:simular             # opcional: obra completa simulada (docs/simulacion.md)
npm run db:demo-archivos       # comprobantes y vouchers simulados (registrados en datos_demo)
npm run db:demo-fotos          # fotos de entregas de las obras demo: ilustraciones «FOTO DEMO»
npm run db:demo-requerimientos # requerimientos y adelantos de la obra simulada
npm run db:demo-tesoreria      # obra con un caso por estado de Tesorería y Logística (pide ERP_PASS)
npm run build && npm start     # http://localhost:3100
```

- `supabase/seed/excel.sql` no está en el repo (tiene RUCs y cuentas reales): se genera con `scripts/extract_excel.py` desde el Excel de control de costos.
- `.env.local` necesita `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY` (avisos push), `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, y para la demo `DEMO_ACCESO` y `NEXT_PUBLIC_USUARIOS_LOCALES=1`.
- Después de cambiar el esquema: `npm run db:types`.
- Memoria: `npm run dev`, `build` y `start` corren Node con 4 GB de heap (6 GB el build). En Windows, Docker Desktop toma el límite de `%USERPROFILE%\.wslconfig`; con 16 GB de RAM se usa `memory=10GB`, `swap=8GB` y `autoMemoryReclaim=dropCache` en `[experimental]`. Con 8 GB, arrancar Supabase con `-x studio,imgproxy,inbucket,postgres-meta,edge-runtime,logflare,vector,supavisor`.

## Usuarios de prueba

Clave `erp12345`: `logistica`, `contabilidad`, `tesoreria`, `residente`, `gerencia`, `operaciones` (Ingeniero de Operaciones), `jefeoperaciones`, `rrhh` y `admin` `@erp.local`. Con `NEXT_PUBLIC_USUARIOS_LOCALES=1` el login muestra un botón por rol.

## Documentos

Ver [`docs/README.md`](docs/README.md): manual por rol, flujos, simulación de una obra completa, arquitectura, modelo de datos y seguridad.
