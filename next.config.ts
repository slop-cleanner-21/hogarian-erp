import type { NextConfig } from "next";

// ERP 100% dinámico por usuario: se usa el modelo de caché previo (sin Cache Components).
const nextConfig: NextConfig = {
  cacheComponents: false,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    // Acceso por túnel público (demo desde el celular): se aceptan server actions de esos dominios
    // (SERVER_ACTIONS_ORIGENES, separados por coma; en .env.local). En producción no se define.
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: (process.env.SERVER_ACTIONS_ORIGENES ?? "").split(",").map((o) => o.trim()).filter(Boolean),
    },
  },
  // Link público del proveedor: el token no debe viajar en el Referer ni quedar indexado o cacheado.
  async headers() {
    return [
      {
        source: "/cotizar/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
  // Sin conexión directa (local, túnel), el navegador habla con Supabase a través de la app (ver
  // src/lib/supabase/config.ts). En producción (NEXT_PUBLIC_SUPABASE_DIRECTO=1) /sb no existe.
  async rewrites() {
    if (process.env.NEXT_PUBLIC_SUPABASE_DIRECTO === "1") return [];
    return [{ source: "/sb/:path*", destination: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/:path*` }];
  },
};

export default nextConfig;
