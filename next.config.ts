import type { NextConfig } from "next";

// ERP 100% dinámico por usuario: se usa el modelo de caché previo (sin Cache Components).
const nextConfig: NextConfig = {
  cacheComponents: false,
  // Sin «X-Powered-By: Next.js».
  poweredByHeader: false,
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
    // Server actions desde otros dominios (no se usa: el túnel se dio de baja). Lista separada por comas
    // (SERVER_ACTIONS_ORIGENES, separados por coma; en .env.local). En producción no se define.
    serverActions: {
      bodySizeLimit: "10mb",
      allowedOrigins: (process.env.SERVER_ACTIONS_ORIGENES ?? "").split(",").map((o) => o.trim()).filter(Boolean),
    },
  },
  // Link público del proveedor: el token no debe viajar en el Referer ni quedar indexado o cacheado.
  async headers() {
    return [
      // Para toda la app: no se puede incrustar en otro sitio (clickjacking), sin adivinar tipos de archivo, sin la
      // URL en el Referer hacia otros dominios y sin cámara, micrófono ni ubicación desde otros orígenes.
      // (CSP solo con lo que no rompe Next: sin restringir scripts, que necesitarían nonces.)
      {
        // Sin /sb: los PDF de Supabase se abren en el visor del navegador (object-src lo bloquearía).
        source: "/((?!sb/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(), usb=()" },
        ],
      },
      // Archivos de Supabase servidos por la app (/sb, local o túnel): un XML, SVG o HTML con script no corre con el
      // origen de la app (sandbox) ni lee su sesión. (Sin sandbox en los PDF: Chrome no los mostraría.)
      { source: "/sb/storage/:path*", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
      {
        source: "/sb/storage/:path(.*\\.(?:xml|XML|svg|SVG|html?|HTML?|xhtml|XHTML))",
        headers: [{ key: "Content-Security-Policy", value: "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" }],
      },
      {
        source: "/cotizar/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      // Logos de las empresas (public/ se servía con max-age=0: se revalidaban en cada vista).
      { source: "/empresas/:archivo*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
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
