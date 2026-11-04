import { ImageResponse } from "next/og";
import { marcaSvg } from "@/lib/marca";

// Íconos PNG del manifiesto: /icono/192, /icono/512 y /icono/512-maskable
// (este último con margen para la zona segura de Android).
const VARIANTES = {
  "192": { lado: 192, escala: 0.19, redondeo: 14 },
  "512": { lado: 512, escala: 0.19, redondeo: 14 },
  "512-maskable": { lado: 512, escala: 0.14, redondeo: 0 },
} as const;

export function generateStaticParams() {
  return Object.keys(VARIANTES).map((variante) => ({ variante }));
}

export async function GET(_: Request, { params }: RouteContext<"/icono/[variante]">) {
  const v = VARIANTES[(await params).variante as keyof typeof VARIANTES];
  if (!v) return new Response("No encontrado", { status: 404 });
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(marcaSvg({ escala: v.escala, redondeo: v.redondeo }))}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} width={v.lado} height={v.lado} />,
    { width: v.lado, height: v.lado },
  );
}
