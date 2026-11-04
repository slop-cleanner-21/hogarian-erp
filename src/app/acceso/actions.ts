"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_ACCESO, firmaAcceso } from "@/lib/acceso";

export async function entrarDemo(_: string | null, formData: FormData): Promise<string | null> {
  const clave = String(formData.get("clave") ?? "");
  if (!process.env.DEMO_ACCESO || clave !== process.env.DEMO_ACCESO) return "Contraseña incorrecta";
  (await cookies()).set(COOKIE_ACCESO, await firmaAcceso(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/login");
}
