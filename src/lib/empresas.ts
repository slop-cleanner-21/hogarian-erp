// Logos de las empresas (public/empresas). Sin logo propio: null (se muestra la inicial, no el de otra empresa).
const LOGOS: Record<string, string> = {
  MARBELEN: "/empresas/marbelen.png",
  ARIANT: "/empresas/ariant.png",
  ARISANT: "/empresas/arisant.svg",
  HOGARIAN: "/empresas/hogarian.svg",
};

export const logoEmpresa = (nombre: string): string | null => LOGOS[nombre.trim().toUpperCase()] ?? null;
