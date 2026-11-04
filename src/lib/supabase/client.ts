import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { COOKIE_SESION, urlNavegador } from "./config";

export function createClient() {
  return createBrowserClient<Database>(
    urlNavegador(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: COOKIE_SESION },
  );
}
