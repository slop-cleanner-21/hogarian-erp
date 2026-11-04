# Pruebas e2e

Suite de Playwright contra la app en producción local (`npm run build && npm start`) y Supabase en Docker. Reemplaza a las auditorías manuales: lo que una auditoría verifica una vez queda aquí como prueba.

```bash
ERP_DEMO=… ERP_PASS=… npm run test:e2e                         # todo: 390 px claro y 360 px oscuro, en paralelo
ERP_DEMO=… ERP_PASS=… npm run test:e2e -- --grep @tesoreria     # un área (@smoke, @tesoreria, @contabilidad, @permisos, @roles, o un rol: @residente…)
ERP_DEMO=… ERP_PASS=… npm run test:e2e -- --project=m390        # un solo tamaño, mientras se itera
npx playwright show-report                                      # capturas y trazas de lo que falló
```

- Las claves van solo por variables de entorno (`ERP_DEMO`: pantalla de acceso; `ERP_PASS`: usuarios de prueba).
- `sesiones.setup.ts` inicia sesión una vez por rol y la guarda en `tests/e2e/.auth/` (ignorado por git); se reutiliza 40 minutos.
- `WORKERS` cambia el paralelismo (10 por defecto). `BASE` apunta a otro servidor.

## Cómo escribir una prueba

- `test`/`expect` de `./fixtures`: `abrir(rol, ruta)` abre la ruta con la sesión del rol y, al terminar la prueba, falla si hubo errores de consola o respuestas 4xx/5xx. `revisarPantalla(page)` exige sin desborde horizontal, sin `<select>` nativo y sin textos de error; los toques de menos de 44 px y el texto de menos de 13 px quedan como avisos en el reporte.
- `sql()` / `sql1()` de `./lib` para comparar con la base y para elegir los datos del caso (no fijar ids a mano).
- Cada prueba es independiente y corre en paralelo con las demás: lo que escriba en la base lo revierte ella misma (`try/finally`), y si dos proyectos podrían chocar, elige datos distintos según `test.info().project.name`.
- Etiqueta el `describe` con el área (`@contabilidad`) para poder correrla sola.

## Flujo con cambios de interfaz

1. Correr la suite (o el área) después del build: es la revisión rápida.
2. Para lo nuevo, agregar la prueba que lo verifica en la spec del área.
3. El `ui-auditor` solo revisa a mano lo que una prueba no puede juzgar (diseño, si algo sobra o se entiende) y deja como prueba lo que encuentre.
