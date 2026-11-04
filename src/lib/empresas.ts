// Logos de las empresas (public/empresas). Sin logo propio: null (se muestra la inicial, no el de otra empresa).
const LOGOS: Record<string, string> = {
  MARBELEN: "/empresas/marbelen.webp",
  ARIANT: "/empresas/ariant.webp",
  ARISANT: "/empresas/arisant.svg",
  HOGARIAN: "/empresas/hogarian.svg",
};

export const logoEmpresa = (nombre: string): string | null => LOGOS[nombre.trim().toUpperCase()] ?? null;

// Para los PDF (contratos): PNG con fondo blanco (react-pdf no lee WebP ni SVG), en public/empresas/pdf.
const LOGOS_PDF: Record<string, string> = {
  MARBELEN: "/empresas/pdf/marbelen.png",
  ARIANT: "/empresas/pdf/ariant.png",
  ARISANT: "/empresas/pdf/arisant.png",
  HOGARIAN: "/empresas/pdf/hogarian.png",
};

export const logoPdfEmpresa = (nombre: string): string | null => LOGOS_PDF[nombre.trim().toUpperCase()] ?? null;
