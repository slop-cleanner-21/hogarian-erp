import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RetomarRuta } from "@/components/recordar-ruta";
import { COOKIE_ULTIMA, seRetoma } from "@/lib/ultima-ruta";
import { HOME_BY_ROL } from "@/lib/nav";
import { requireSesion } from "@/lib/supabase/server";

export default async function Home() {
  const { rol } = await requireSesion();
  const inicio = HOME_BY_ROL[rol];
  // ADMIN entra a todos los módulos; los demás solo retoman pantallas de su módulo. Solo rutas internas.
  // Nunca a una pantalla que no se retoma (una cookie vieja podía guardar el bloqueo y dejarlo en un bucle).
  const valida = (ruta: string) =>
    seRetoma(ruta) && (rol === "ADMIN" || ruta === inicio || ruta.startsWith(`${inicio}/`) || ruta.startsWith(`${inicio}?`));

  // Con la última pantalla en la cookie, se abre directo desde el servidor (sin pantalla en blanco).
  const cookie = (await cookies()).get(COOKIE_ULTIMA)?.value;
  if (cookie) {
    let ruta = "";
    try {
      ruta = decodeURIComponent(cookie);
    } catch {}
    redirect(valida(ruta) ? ruta : inicio);
  }
  // Sin cookie (versión anterior de la app): se retoma desde el navegador.
  return <RetomarRuta inicio={inicio} prefijos={rol === "ADMIN" ? null : [inicio]} />;
}
