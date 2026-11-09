"use client";

import {
  ArrowLeft,
  Banknote,
  BookCheck,
  Building2,
  ClipboardList,
  FileText,
  Hammer,
  Lightbulb,
  Package,
  Receipt,
  Search,
  TrendingUp,
  Truck,
  Users,
  History,
  Landmark,
  Scale,
} from "lucide-react";
import { Avatar } from "./avatar";
import { CambiarContrasena } from "./cambiar-contrasena";
import { MiFirma } from "./mi-firma";
import { Campana } from "./campana";
import { CLAVE_ANTERIOR } from "./recordar-ruta";
import { destinoDe } from "@/lib/vistas";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { exportarExcel } from "@/app/excel/actions";
import { BotonSugerencia } from "./sugerencia";
import { cambiarRol } from "@/app/rol/actions";
import { ROLES_PROD1 } from "@/lib/prod1";
import { createClient } from "@/lib/supabase/client";
import type { Rol } from "@/lib/types";
import { ROL_LABEL } from "@/lib/usuarios";
import { Sheet } from "./ui/sheet";
import { ThemeSwitch } from "./theme-switch";
import { HuellaSheet, marcarSalida } from "./huella";

type NavItem = { href: string; label: string; icon: typeof Package; match?: (p: string, s: URLSearchParams) => boolean };

type ClaveModulo = "logistica" | "tesoreria" | "contabilidad" | "gerencia" | "operaciones" | "admin";

const MODULOS: Record<ClaveModulo, { label: string; roles: Rol[]; nav: NavItem[] }> = {
  logistica: {
    label: "Logística",
    roles: ["LOGISTICA"],
    nav: [
      { href: "/logistica?tipo=OC", label: "OC", icon: ClipboardList, match: (p, s) => p.startsWith("/logistica/ordenes") ? s.get("tipo") !== "OS" : p === "/logistica" && s.get("tipo") !== "OS" },
      { href: "/logistica?tipo=OS", label: "OS", icon: Hammer, match: (p, s) => (p === "/logistica" || p.startsWith("/logistica/ordenes")) && s.get("tipo") === "OS" },
      {
        href: "/logistica/proveedores",
        label: "Proveedores",
        icon: Truck,
        match: (p) => p.startsWith("/logistica/proveedores") || p.startsWith("/logistica/transportistas") || p.startsWith("/logistica/retenciones"),
      },
      { href: "/logistica/items", label: "Ítems", icon: Package },
    ],
  },
  tesoreria: {
    label: "Tesorería",
    roles: ["TESORERIA"],
    nav: [
      { href: "/tesoreria", label: "Pagos", icon: Banknote, match: (p) => p === "/tesoreria" || p.startsWith("/tesoreria/pago") },
      { href: "/tesoreria/consultas", label: "Presupuesto", icon: Search },
    ],
  },
  contabilidad: {
    label: "Contabilidad",
    roles: ["CONTABILIDAD", "ASISTENTE_CONTABILIDAD"],
    nav: [
      { href: "/contabilidad/compras", label: "Compras", icon: Receipt },
      { href: "/contabilidad/pagos", label: "Pagos", icon: Banknote },
      { href: "/contabilidad/op", label: "OP", icon: FileText },
      { href: "/contabilidad/impuestos", label: "Impuestos", icon: Landmark },
      { href: "/contabilidad/eeff", label: "EEFF", icon: Scale },
      { href: "/contabilidad", label: "Cuentas", icon: BookCheck, match: (p) => p === "/contabilidad" },
    ],
  },
  gerencia: {
    label: "Gerencia",
    roles: ["GERENCIA"],
    nav: [
      { href: "/gerencia/obras", label: "Obras", icon: Building2, match: (p) => p === "/gerencia" || p.startsWith("/gerencia/obras") },
      { href: "/gerencia/presupuesto", label: "Seguimiento", icon: TrendingUp },
      { href: "/gerencia/ordenes", label: "Órdenes", icon: ClipboardList },
      { href: "/gerencia/items", label: "Ítems", icon: Package },
    ],
  },
  operaciones: {
    label: "Operaciones",
    roles: ["JEFE_OPERACIONES", "OPERACIONES"],
    // Solo el seguimiento de compras: una pantalla, sin barra inferior.
    nav: [{ href: "/operaciones", label: "Seguimiento", icon: TrendingUp, match: (p) => p === "/operaciones" }],
  },
  admin: {
    label: "Administración",
    // Solo el Admin (que entra a todos los módulos).
    roles: [],
    nav: [
      { href: "/admin", label: "Usuarios", icon: Users, match: (p) => p === "/admin" },
      { href: "/admin/empresas", label: "Empresas", icon: Building2 },
      { href: "/admin/auditoria", label: "Auditoría", icon: History },
      { href: "/admin/sugerencias", label: "Sugerencias", icon: Lightbulb },
    ],
  },
};

type Modulo = keyof typeof MODULOS;

function moduloActual(path: string): Modulo {
  return (Object.keys(MODULOS) as Modulo[]).find((m) => path.startsWith(`/${m}`)) ?? "logistica";
}

export function BottomNav() {
  const router = useRouter();
  const path = usePathname();
  const params = new URLSearchParams(useSearchParams().toString());
  const nav = MODULOS[moduloActual(path)].nav;
  const actual = `${path}?${params}`;
  // El destino tocado se marca al instante; al cambiar la URL manda la ruta real.
  const [tocado, setTocado] = useState<{ href: string; desde: string } | null>(null);
  const marcado = tocado && tocado.desde === actual ? tocado.href : null;
  // Flujos con barra de acción propia (orden, pago) y módulos sin navegación no la muestran.
  if (nav.length < 2 || path.includes("/ordenes/") || path.startsWith("/tesoreria/pago/")) return null;
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface">
      <ul className="mx-auto flex max-w-2xl">
        {nav.map(({ href, label, icon: Icon, match }) => {
          const active = marcado ? marcado === href : match ? match(path, params) : path.startsWith(href);
          // Ya estoy en esa lista (con sus filtros): el proxy la abriría en la vista guardada, que es esta misma,
          // y la URL no cambiaría (la barra de carga quedaba encendida). Tocarla solo sube al inicio.
          const [ruta, query = ""] = href.split("?");
          const aqui = ruta === path && [...new URLSearchParams(query)].every(([k, v]) => params.get(k) === v);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                data-aqui={aqui || undefined}
                onClick={(e) => {
                  if (aqui) {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    return;
                  }
                  setTocado({ href, desde: actual });
                  const destino = destinoDe(href);
                  if (destino !== href) {
                    e.preventDefault();
                    router.push(destino);
                  }
                }}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 text-[13px]",
                  active ? "font-semibold text-ink" : "text-ink-3",
                )}
              >
                {active && <span aria-hidden className="absolute inset-x-5 top-0 h-[3px] rounded-b-sm bg-primary" />}
                <Icon size={22} strokeWidth={active ? 2.2 : 1.7} className={active ? "text-primary" : undefined} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopBar({
  title,
  back,
  right,
}: {
  title: string;
  back?: string | true | (() => void);
  right?: ReactNode;
}) {
  const router = useRouter();
  // Si la pantalla anterior es el destino de «Volver» (la lista desde la que se abrió), se vuelve por el
  // historial: conserva sus filtros y su posición sin recargarla ni pasar por la lista sin filtros.
  const volver = (destino: string) => {
    let anterior: string | null = null;
    try {
      anterior = sessionStorage.getItem(CLAVE_ANTERIOR);
    } catch {}
    if (anterior && anterior.split("?")[0] === destino.split("?")[0] && window.history.length > 1) router.back();
    else router.push(destino);
  };
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg">
      <div className="mx-auto flex h-15 max-w-2xl items-center gap-1 px-1">
        {back ? (
          <button
            type="button"
            aria-label="Volver"
            onClick={() =>
              typeof back === "function" ? back() : back === true ? router.back() : volver(back)
            }
            className="flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
          >
            <ArrowLeft size={22} />
          </button>
        ) : (
          <span className="w-4" />
        )}
        <h1 className="rotulo flex-1 truncate text-[27px] font-semibold leading-[1.2]">{title}</h1>
        <BotonSugerencia />
        {right}
      </div>
    </header>
  );
}

export function UserMenu({ id, nombre, rol }: { id: string; nombre: string; rol: Rol }) {
  const [open, setOpen] = useState(false);
  const [contrasena, setContrasena] = useState(false);
  const [firma, setFirma] = useState(false);
  const [huella, setHuella] = useState(false);
  const [roles, setRoles] = useState<Rol[]>([]);
  const [errorRol, setErrorRol] = useState<string | null>(null);
  const [cambiando, startCambio] = useTransition();
  const [exportando, startExport] = useTransition();
  const [errorExcel, setErrorExcel] = useState<string | null>(null);
  const router = useRouter();
  const path = usePathname();
  const actual = moduloActual(path);
  // Sus roles, al abrir el menú (casi todos tienen uno solo: no se muestra nada).
  useEffect(() => {
    if (!open) return;
    let vigente = true;
    void createClient()
      .from("perfil_roles")
      .select("rol")
      .then(({ data }) => {
        if (vigente) setRoles(ROLES_PROD1.filter((r) => data?.some((d) => d.rol === r)));
      });
    return () => {
      vigente = false;
    };
  }, [open]);
  const disponibles = (Object.keys(MODULOS) as Modulo[]).filter(
    (m) => rol === "ADMIN" || MODULOS[m].roles.includes(rol),
  );
  return (
    <>
      <Campana userId={id} />
      <button
        type="button"
        aria-label="Usuario"
        onClick={() => setOpen(true)}
        className="flex h-12 w-12 items-center justify-center rounded-control active:bg-ink/8"
      >
        <Avatar semilla={id} nombre={nombre} size={34} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={nombre}>
        <div className="flex flex-col gap-1 p-3">
          <ThemeSwitch />
          <div className="h-2" />
          {roles.length > 1 && (
            <section aria-label="Rol" className="flex flex-col gap-1 border-b border-line pb-2">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={cambiando}
                  aria-current={r === rol || undefined}
                  onClick={() => {
                    if (r === rol) return setOpen(false);
                    startCambio(async () => setErrorRol(await cambiarRol(r)));
                  }}
                  className={cn("flex h-12 w-full items-center rounded-control px-3", r === rol ? "bg-sunken font-semibold" : "active:bg-ink/8")}
                >
                  {ROL_LABEL[r]}
                </button>
              ))}
              {errorRol && <p role="alert" className="px-3 text-danger">{errorRol}</p>}
            </section>
          )}
          {disponibles.length > 1 &&
            disponibles.map((m) => (
              <Link
                key={m}
                href={`/${m}`}
                // Ya en su pantalla principal: abriría la misma vista guardada (la URL no cambia), solo se cierra.
                data-aqui={path === `/${m}` || undefined}
                onClick={(e) => {
                  setOpen(false);
                  if (path === `/${m}`) return e.preventDefault();
                  // Directo a su vista guardada (sin la redirección del proxy).
                  const destino = destinoDe(`/${m}`);
                  if (destino !== `/${m}`) {
                    e.preventDefault();
                    router.push(destino);
                  }
                }}
                className={cn(
                  "flex h-12 items-center rounded-control px-3",
                  m === actual ? "bg-sunken font-semibold" : "active:bg-ink/8",
                )}
              >
                {MODULOS[m].label}
              </Link>
            ))}
          {(rol === "GERENCIA" || rol === "ADMIN") && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setFirma(true);
              }}
              className="flex h-12 w-full items-center rounded-control px-3 active:bg-ink/8"
            >
              Mi firma
            </button>
          )}
          {(["LOGISTICA", "TESORERIA", "GERENCIA", "CONTABILIDAD", "ASISTENTE_CONTABILIDAD", "ADMIN"] as Rol[]).includes(rol) && (
            <>
              <button
                type="button"
                disabled={exportando}
                onClick={() =>
                  startExport(async () => {
                    setErrorExcel(null);
                    const r = await exportarExcel();
                    if ("error" in r) return setErrorExcel(r.error);
                    window.location.assign(r.url);
                    setOpen(false);
                  })
                }
                className="flex h-12 w-full items-center rounded-control px-3 active:bg-ink/8 disabled:text-ink-3"
              >
                {exportando ? "Generando Excel…" : "Exportar Excel"}
              </button>
              {errorExcel && <p role="alert" className="px-3 text-danger">{errorExcel}</p>}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setContrasena(true);
            }}
            className="flex h-12 w-full items-center rounded-control px-3 active:bg-ink/8"
          >
            Cambiar contraseña
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setHuella(true);
            }}
            className="flex h-12 w-full items-center rounded-control px-3 active:bg-ink/8"
          >
            Huella
          </button>
          <form method="post" action="/login/salir" onSubmit={marcarSalida}>
            <button type="submit" className="flex h-12 w-full items-center rounded-control px-3 text-danger active:bg-ink/8">
              Cerrar sesión
            </button>
          </form>
        </div>
      </Sheet>
      {contrasena && <CambiarContrasena onClose={() => setContrasena(false)} />}
      {firma && <MiFirma onClose={() => setFirma(false)} />}
      {huella && <HuellaSheet userId={id} onClose={() => setHuella(false)} />}
    </>
  );
}
