import { origen } from "@/lib/auditoria";
import { captchaDisponible, captchaEnSupabase, captchaSitio, estadoIp } from "@/lib/captcha";
import { FormularioLogin } from "./formulario";

/** El ingreso: si la IP ya falló 3 veces, el CAPTCHA aparece desde el primer intento (para siempre). */
export default async function LoginPage() {
  const disponible = captchaDisponible();
  const marcada = disponible && (await estadoIp((await origen()).ip)).captcha;
  return <FormularioLogin sitekey={disponible ? captchaSitio() : null} marcada={marcada} siempre={disponible && captchaEnSupabase()} />;
}
