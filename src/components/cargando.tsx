// Esqueleto que se muestra al instante mientras llega la pantalla (loading.tsx de cada módulo).
export function Cargando({ filas = 7 }: { filas?: number }) {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <div className="sticky top-0 z-20 border-b border-line bg-bg/95">
        <div className="mx-auto flex h-15 max-w-2xl items-center px-4">
          <span className="h-6 w-44 rounded-control bg-sunken motion-safe:animate-pulse" />
        </div>
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3">
        <span className="h-12 rounded-field bg-sunken motion-safe:animate-pulse" />
        <ul className="overflow-hidden rounded-panel bg-surface">
          {Array.from({ length: filas }, (_, i) => (
            <li key={i} className="flex flex-col gap-2 border-b border-line px-4 py-3.5 last:border-0">
              <span className="h-5 w-2/5 rounded-control bg-sunken motion-safe:animate-pulse" />
              <span className="h-4 w-3/4 rounded-control bg-sunken motion-safe:animate-pulse" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
