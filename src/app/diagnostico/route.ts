// Lo que manda el navegador (components/diagnostico.tsx): va a los logs del servidor. Solo con sesión (lo exige el proxy).
export async function POST(request: Request) {
  const texto = (await request.text()).slice(0, 3000);
  console.warn(`[diagnostico] ${texto}`);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
