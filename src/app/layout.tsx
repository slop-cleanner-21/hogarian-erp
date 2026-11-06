import { Diagnostico } from "@/components/diagnostico";
import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { APP_CORTO, APP_DESCRIPCION, APP_NOMBRE } from "@/lib/marca";
import { Suspense } from "react";
import { BarraCarga } from "@/components/barra-carga";
import { BarrasSistema } from "@/components/barras-sistema";
import { BloqueoHuella } from "@/components/huella";
import { RecordarRuta } from "@/components/recordar-ruta";
import { BLOQUEO_SCRIPT } from "@/lib/bloqueo";
import { COLOR_BARRA, THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  // Sin 700: ningún rótulo lo usa (cada grosor es un archivo más en la primera carga).
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: { default: APP_NOMBRE, template: `%s | ${APP_NOMBRE}` },
  description: APP_DESCRIPCION,
  applicationName: APP_NOMBRE,
  appleWebApp: { capable: true, title: APP_CORTO, statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  // Sistema interno: fuera de buscadores.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: COLOR_BARRA.light },
    { media: "(prefers-color-scheme: dark)", color: COLOR_BARRA.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <head>
        {/* Aplica el tema guardado antes del primer pintado (evita parpadeo). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Con la huella activada y la app recién abierta, no muestra la pantalla hasta el bloqueo. */}
        <script dangerouslySetInnerHTML={{ __html: BLOQUEO_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {children}
        <BarrasSistema />
        <BloqueoHuella />
        <Suspense fallback={null}>
          <RecordarRuta />
          <BarraCarga />
        </Suspense>
        <Diagnostico />
      </body>
    </html>
  );
}
