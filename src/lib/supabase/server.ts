import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Database } from "@/lib/database.types";
import { rolEnProd1 } from "@/lib/prod1";
import type { Rol } from "@/lib/types";
import { COOKIE_SESION } from "./config";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: COOKIE_SESION,
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: el proxy refresca la sesión.
          }
        },
      },
    },
  );
}

export type Sesion = { userId: string; nombre: string; rol: Rol };

// La sesión sale del JWT, verificado localmente (getClaims, sin ir al servidor de auth). El rol y el
// nombre viajan en app_metadata (los copia un trigger desde perfiles); si el token es anterior a eso,
// se consultan. Una cuenta sin perfil no tiene rol: va a «Sin acceso» (antes se la trataba como Logística).
const getSesion = cache(async (): Promise<Sesion | "sin-perfil" | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const meta = (claims.app_metadata ?? {}) as { rol?: Rol; nombre?: string };
  if (meta.rol) return { userId: claims.sub, nombre: meta.nombre ?? claims.email ?? "", rol: meta.rol };
  const { data: perfil } = await supabase.from("perfiles").select("nombre, rol").eq("user_id", claims.sub).maybeSingle();
  if (!perfil) return "sin-perfil";
  return { userId: claims.sub, nombre: perfil.nombre ?? claims.email ?? "", rol: perfil.rol as Rol };
});

/**
 * Para lo que se hace con la clave secreta (usuarios, empresas, firma, huella): el rol vigente en la base, no el
 * del token. Un baneo o un cambio de rol rige al instante (el token dura hasta 1 h); sin esto, un Admin
 * desactivado podía reactivarse y crear cuentas mientras su token siguiera vigente.
 */
export async function requireSesionVigente(roles?: Rol[]): Promise<Sesion> {
  const sesion = await requireSesion(roles);
  const { data } = await (await createClient()).rpc("mi_rol");
  const rol = (data ?? "") as Rol | "";
  if (!rol || !rolEnProd1(rol)) redirect("/sin-acceso");
  if (roles && rol !== "ADMIN" && !roles.includes(rol)) redirect("/");
  return { ...sesion, rol };
}

export async function requireSesion(roles?: Rol[]): Promise<Sesion> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  if (sesion === "sin-perfil" || !rolEnProd1(sesion.rol)) redirect("/sin-acceso");
  if (roles && sesion.rol !== "ADMIN" && !roles.includes(sesion.rol)) redirect("/");
  return sesion;
}
