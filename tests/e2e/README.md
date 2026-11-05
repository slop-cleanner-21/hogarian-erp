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
- `WORKERS` cambia el paralelismo (10 por defecto; 6 si el MVP corre a la vez). `BASE` apunta a otro servidor.
- La salida es una barra de avance (`progreso.ts`): pruebas hechas de cuántas, %, pasadas, fallidas (cada falla se
  muestra en cuanto ocurre), tiempo y lo que falta. `REPORTE=list` lista cada prueba.
- `flujo.spec.ts` (el flujo entero por las pantallas) es su propio proyecto y corre al final, cuando terminan los
  demás: crea una obra publicada y órdenes que otras pruebas, que comparan listas con la base, verían a medias.

## Cómo escribir una prueba

- `test`/`expect` de `./fixtures`: `abrir(rol, ruta)` abre la ruta con la sesión del rol y, al terminar la prueba, falla si hubo errores de consola o respuestas 4xx/5xx. `revisarPantalla(page)` exige sin desborde horizontal, sin `<select>` nativo y sin textos de error; los toques de menos de 44 px y el texto de menos de 13 px quedan como avisos en el reporte.
- `sql()` / `sql1()` de `./lib` para comparar con la base y para elegir los datos del caso (no fijar ids a mano).
- Cada prueba es independiente y corre en paralelo con las demás: lo que escriba en la base lo revierte ella misma (`try/finally`), y si dos proyectos podrían chocar, elige datos distintos según `test.info().project.name`.
- En paralelo, la base cambia mientras se lee:
  - el título de una prueba no lleva datos de la base (con un id, cada worker arma títulos distintos y Playwright
    aborta: «Test not found in the worker»); se resuelven dentro de la prueba (ver `smoke.spec.ts`);
  - el usuario de un rol, por su correo (`uidDe("LOGISTICA")`, `uidSql`), no «el primero con ese rol»;
  - los nombres de lo que se crea, con un sufijo al azar (no la hora: los workers arrancan en el mismo milisegundo);
  - para «la última obra» o un conteo global, excluir lo de pruebas (`E2E …`, `AUDIT …`) o lo reciente.
- Etiqueta el `describe` con el área (`@contabilidad`) para poder correrla sola.

## Flujo con cambios de interfaz

1. Correr la suite (o el área) después del build: es la revisión rápida.
2. Para lo nuevo, agregar la prueba que lo verifica en la spec del área.
3. El `ui-auditor` solo revisa a mano lo que una prueba no puede juzgar (diseño, si algo sobra o se entiende) y deja como prueba lo que encuentre.
- `ingreso.spec.ts` simula IPs con X-Forwarded-For y usa cuentas propias (3 fallidos por IP y cuenta, 10 por IP y 20 por cuenta desde dispositivos nuevos, en 10 minutos). En local la IP no cuenta: no fallar a propósito 20 veces con las cuentas compartidas; si se hace, borrar esos LOGIN_FALLIDO.
- `orden-listas.spec.ts`: cada «Ordenar por» y los filtros, con más de 100 resultados (y al cargar 100 más), dan las mismas filas y en el mismo orden que la base. Solo usa órdenes de hace más de una semana, para que las que crean otras pruebas no cambien el resultado.
- `concurrencia.spec.ts` (proyecto «flujo», después de los demás y una tras otra): dos sesiones de la base a la vez sobre la misma orden (dos pagos, pagar y rechazar, la cotización enviada dos veces) y quién recibe cada aviso y la campana. Deja las órdenes como estaban.
