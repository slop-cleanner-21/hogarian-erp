"use client";

// Falla del layout raíz: sin estilos de la app, así que lleva los suyos.
export default function ErrorGlobal({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f4f5f2", color: "#1a201d" }}>
        <title>Hogarian ERP</title>
        <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>No se pudo cargar la app</h1>
          <p style={{ margin: 0, color: "#5f6762" }}>Revisa la conexión e inténtalo de nuevo.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ minHeight: 48, padding: "0 24px", borderRadius: 10, border: 0, background: "#0a3e68", color: "white", fontSize: 16, fontWeight: 600 }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
