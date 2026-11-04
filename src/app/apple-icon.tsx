import { ImageResponse } from "next/og";
import { marcaSvg } from "@/lib/marca";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS redondea el ícono por su cuenta: se entrega cuadrado.
export default function AppleIcon() {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(marcaSvg({ redondeo: 0 }))}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img src={src} width={180} height={180} />,
    size,
  );
}
