"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { enlaceValido } from "@/lib/asistente/urls";
import { cn } from "@/lib/format";

// Las respuestas de Hogariano en Markdown (subtítulos, negritas, listas, tablas). Sin HTML crudo (react-markdown lo
// escapa) ni imágenes (una foto con instrucciones podría pedir una imagen con datos en su URL). Los enlaces solo abren
// pantallas de Tesorería; cualquier otro queda como texto.

const quitar = ["img", "pre", "hr"];

export default function RespuestaMarkdown({ texto, onEnlace }: { texto: string; onEnlace: (url: string) => void }) {
  const componentes: Components = {
    h1: ({ children }) => <p className="mt-2 text-[16px] font-semibold first:mt-0">{children}</p>,
    h2: ({ children }) => <p className="mt-2 text-[16px] font-semibold first:mt-0">{children}</p>,
    h3: ({ children }) => <p className="mt-2 text-[15px] font-semibold first:mt-0">{children}</p>,
    h4: ({ children }) => <p className="mt-2 font-semibold first:mt-0">{children}</p>,
    p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-1 list-disc pl-5 marker:text-ink-3">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 list-decimal pl-5 marker:text-ink-3">{children}</ol>,
    li: ({ children }) => <li className="my-0.5 pl-0.5">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    code: ({ children }) => <span className="num">{children}</span>,
    blockquote: ({ children }) => <div className="my-1 border-l-2 border-line pl-2 text-ink-2">{children}</div>,
    a: ({ href, children }) =>
      href && enlaceValido(href) ? (
        <a
          href={href}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            onEnlace(href);
          }}
          className="whitespace-nowrap font-semibold text-primary underline decoration-primary/40 underline-offset-2"
        >
          {children}
        </a>
      ) : (
        <>{children}</>
      ),
    // Tablas: al ancho del panel; los nombres bajan de línea y los montos (columnas a la derecha) no se parten. Si aun así
    // no caben (muchas columnas), se deslizan de lado.
    table: ({ children }) => (
      <div className="-mx-1 my-2 overflow-x-auto overscroll-x-contain">
        <table className="w-full border-collapse text-[14px] leading-tight">{children}</table>
      </div>
    ),
    th: ({ children, style }) => (
      <th style={style} className={cn("border-b border-line px-1.5 py-1.5 text-left font-semibold text-ink-2", style?.textAlign === "right" && "whitespace-nowrap")}>
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className={cn("border-b border-line/60 px-1.5 py-1.5 align-top [overflow-wrap:normal]", style?.textAlign === "right" && "num whitespace-nowrap")}>
        {children}
      </td>
    ),
  };
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={componentes} disallowedElements={quitar} unwrapDisallowed skipHtml>
      {texto}
    </Markdown>
  );
}
