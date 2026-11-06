import "server-only";
import { desdeFecha, filtro } from "@/lib/filtros";
import { createClient } from "@/lib/supabase/server";

// Reporte de la auditoría (Admin): sesiones y cambios, con nombres legibles. Lo usan la pantalla y el CSV.

export const TABLA_LABEL: Record<string, string> = {
  sesion: "Sesión",
  sugerencias: "Sugerencia",
  huellas: "Huella",
  usuarios: "Cuenta de usuario",
  ordenes_compra: "Orden",
  oc_items: "Línea de orden",
  comprobantes: "Comprobante",
  comprobantes_historial: "Corrección de comprobante",
  pagos: "Pago",
  pago_aplicaciones: "Aplicación de pago",
  guias: "Guía de remisión",
  adjuntos: "Archivo",
  rechazos: "Rechazo",
  entregas: "Entrega",
  entrega_fotos: "Foto de entrega",
  obras: "Obra",
  obra_etapas: "Etapa de obra",
  partidas: "Partida del presupuesto",
  detracciones: "Detracción",
  parametros: "Parámetros",
  empresas: "Empresa",
  items: "Ítem",
  tipos_material: "Tipo de material",
  proveedores: "Proveedor",
  proveedor_cuentas: "Cuenta bancaria del proveedor",
  proveedor_contactos: "Contacto del proveedor",
  proveedor_tipos_material: "Lo que vende el proveedor",
  transportistas: "Transportista",
  perfiles: "Perfil de usuario",
  perfil_privado: "DNI o firma",
  perfil_obras: "Obras del residente",
  cuentas_contables: "Cuenta contable",
  asientos: "Asiento",
  asiento_lineas: "Línea de asiento",
  ordenes_pago: "Orden de pago",
  requerimientos: "Requerimiento",
};

export const ACCION_LABEL: Record<string, string> = {
  INSERT: "Creó",
  UPDATE: "Cambió",
  DELETE: "Borró",
  LOGIN: "Inició sesión",
  LOGIN_FALLIDO: "Intento de ingreso fallido",
  LOGOUT: "Cerró sesión",
  DESBLOQUEO: "Desbloqueó con huella",
  DESBLOQUEO_FALLIDO: "Desbloqueo fallido",
  CAPTCHA_IP: "La IP pide CAPTCHA desde ahora",
  CAMBIO_CONTRASENA: "Cambió su contraseña",
  CAMBIO_CONTRASENA_FALLIDO: "Cambio de contraseña fallido",
  CREAR_USUARIO: "Creó la cuenta",
  GENERAR_LINK: "Generó un link de acceso",
  BIENVENIDA: "Completó sus datos y creó su contraseña (link)",
  EDITAR_USUARIO: "Editó la cuenta",
  RESTABLECER_CONTRASENA: "Restableció la contraseña",
  DESACTIVAR: "Desactivó la cuenta",
  REACTIVAR: "Reactivó la cuenta",
};

const ACCIONES_SESION = ["LOGIN", "LOGIN_FALLIDO", "LOGOUT", "CAMBIO_CONTRASENA", "CAMBIO_CONTRASENA_FALLIDO", "DESBLOQUEO", "DESBLOQUEO_FALLIDO", "CAPTCHA_IP"];

export type Vista = "sesiones" | "cambios";
export type FilaAuditoria = {
  id: number;
  fecha: string;
  usuario: string;
  accion: string;
  tabla: string;
  registro: string | null;
  /** «Orden 100010 · MERCEDES A», «Cuenta de Ana Pérez»… */
  objeto: string;
  /** Campos cambiados («estado: EN_TESORERIA → FACTURADA») o lo creado o borrado, en pocas palabras. */
  resumen: string;
  ip: string | null;
  dispositivo: string | null;
  detalle: unknown;
  href: string | null;
};

const corto = (v: unknown) => {
  const s = v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

/** «Android · Chrome», «iPhone · Safari», «Windows · Edge»… */
export function dispositivo(agente: string | null | undefined) {
  if (!agente) return null;
  const so = /iPhone|iPad/.test(agente) ? "iPhone" : /Android/.test(agente) ? "Android" : /Windows/.test(agente) ? "Windows" : /Mac OS/.test(agente) ? "Mac" : /Linux/.test(agente) ? "Linux" : "Otro";
  const nav = /Edg\//.test(agente) ? "Edge" : /Chrome\//.test(agente) ? "Chrome" : /Firefox\//.test(agente) ? "Firefox" : /Safari\//.test(agente) ? "Safari" : "Navegador";
  return `${so} · ${nav}`;
}

export function filtrosDe(sp: Record<string, string | string[] | undefined>) {
  return {
    vista: (sp.vista === "cambios" ? "cambios" : "sesiones") as Vista,
    usuario: filtro(sp, "usuario"),
    fecha: filtro(sp, "fecha"),
    tabla: filtro(sp, "tabla"),
    accion: filtro(sp, "accion"),
    q: typeof sp.q === "string" ? sp.q.trim() : "",
  };
}

/** Las filas del reporte (las más recientes primero), con nombres y un resumen legible. */
export async function reporteAuditoria(f: ReturnType<typeof filtrosDe>, limite: number): Promise<FilaAuditoria[]> {
  const supabase = await createClient();
  let query = supabase.from("audit_log").select("id, user_id, tabla, registro, accion, detalle, created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limite);
  query = f.vista === "sesiones" ? query.in("accion", ACCIONES_SESION) : query.not("accion", "in", `(${ACCIONES_SESION.join(",")})`);
  if (f.usuario) query = query.eq("user_id", f.usuario);
  if (f.tabla && f.vista === "cambios") query = query.eq("tabla", f.tabla);
  if (f.accion) query = query.eq("accion", f.accion);
  // Buscar: en sesiones, por el correo; en cambios, por el registro (p. ej. «19/100010» o el N°).
  if (f.q) query = query.ilike(f.vista === "sesiones" ? "detalle->>email" : "registro", `%${f.q.replace(/[%,()]/g, " ")}%`);
  const rango = desdeFecha(f.fecha);
  if (rango) query = query.gte("created_at", `${rango[0]}T00:00:00-05:00`).lt("created_at", `${rango[1]}T00:00:00-05:00`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Nombres: de quien actúa y de las cuentas afectadas; obras de las órdenes.
  const usuarios = new Set<string>();
  const obras = new Set<number>();
  for (const r of data) {
    if (r.user_id) usuarios.add(r.user_id);
    if ((r.tabla === "usuarios" || r.tabla === "sesion" || r.tabla === "perfiles" || r.tabla === "perfil_privado") && r.registro) usuarios.add(r.registro);
    if (r.tabla === "ordenes_compra" && r.registro) obras.add(Number(r.registro.split("/")[0]));
  }
  const [{ data: perfiles }, { data: obrasN }] = await Promise.all([
    usuarios.size ? supabase.from("perfiles").select("user_id, nombre, rol").in("user_id", [...usuarios]) : Promise.resolve({ data: [] }),
    obras.size ? supabase.from("obras").select("id, nombre").in("id", [...obras]) : Promise.resolve({ data: [] }),
  ]);
  const nombre = new Map((perfiles ?? []).map((p) => [p.user_id, p.nombre]));
  const obra = new Map((obrasN ?? []).map((o) => [o.id, o.nombre]));

  return data.map((r) => {
    const det = (r.detalle ?? {}) as Record<string, unknown>;
    const quien = r.user_id
      ? (nombre.get(r.user_id) ?? "Usuario borrado")
      : r.accion === "LOGIN_FALLIDO" || r.accion === "CAPTCHA_IP"
        ? String(det.email ?? "—")
        : "Sistema";
    // Sin la clave de las tablas de una sola fila (parámetros: «true»).
    const reg = r.registro && r.registro !== "true" ? r.registro : null;
    let objeto = `${TABLA_LABEL[r.tabla] ?? r.tabla}${reg ? ` ${reg}` : ""}`;
    let href: string | null = null;
    if (r.tabla === "ordenes_compra" && r.registro) {
      const [obraId, numero] = r.registro.split("/");
      objeto = `Orden ${numero} · ${obra.get(Number(obraId)) ?? `obra ${obraId}`}`;
      href = `/consulta/orden/${obraId}/${encodeURIComponent(numero)}`;
    } else if (["usuarios", "perfiles", "perfil_privado"].includes(r.tabla) && r.registro) {
      objeto = `${TABLA_LABEL[r.tabla]} de ${nombre.get(r.registro) ?? "un usuario"}`;
    } else if (r.accion === "CAPTCHA_IP") {
      objeto = `IP ${String(det.ip ?? "—")}`;
    } else if (r.tabla === "sesion") {
      objeto = String(det.email ?? "");
    }
    let resumen = "";
    if (r.accion === "UPDATE") {
      resumen = Object.entries(det)
        .map(([k, v]) => `${k}: ${corto((v as { old?: unknown })?.old)} → ${corto((v as { new?: unknown })?.new)}`)
        .join(" · ");
    } else if (r.accion === "EDITAR_USUARIO") {
      const a = det.antes as Record<string, unknown> | undefined;
      const d = det.despues as Record<string, unknown> | undefined;
      resumen = a && d ? Object.keys(d).filter((k) => a[k] !== d[k]).map((k) => `${k}: ${corto(a[k])} → ${corto(d[k])}`).join(" · ") : "";
    } else if (r.accion === "CREAR_USUARIO") {
      resumen = `${det.nombre ?? ""} · ${det.rol ?? ""}`;
    } else if (r.accion === "LOGIN_FALLIDO") {
      resumen = [det.metodo === "huella" ? "con huella" : "", String(det.motivo ?? "")].filter(Boolean).join(" · ");
    } else if (r.accion === "LOGIN" && det.metodo === "huella") {
      resumen = "con huella";
    } else if (r.accion === "INSERT" || r.accion === "DELETE") {
      resumen = ["numero", "descripcion", "razon_social", "nombre", "serie", "tipo", "estado", "monto", "total", "cantidad", "motivo"]
        .filter((k) => det[k] != null)
        .slice(0, 4)
        .map((k) => `${k}: ${corto(det[k])}`)
        .join(" · ");
    }
    return {
      id: r.id,
      fecha: r.created_at,
      usuario: quien,
      accion: ACCION_LABEL[r.accion] ?? r.accion,
      tabla: TABLA_LABEL[r.tabla] ?? r.tabla,
      registro: r.registro,
      objeto,
      resumen,
      ip: (det.ip as string) ?? null,
      dispositivo: dispositivo(det.agente as string),
      detalle: r.detalle,
      href,
    };
  });
}
