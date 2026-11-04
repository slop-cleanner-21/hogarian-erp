// Latido del bloqueo con huella: la app lo manda cada minuto mientras está a la vista. El proxy renueva el
// «desbloqueado» (o responde 401 si venció: la app se bloquea).
export function POST() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
