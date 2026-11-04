"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { iniciarCarga } from "./barra-carga";
import { SearchSelect, type Option } from "./ui/search-select";

/** SearchSelect sincronizado con un parámetro de URL. */
export function UrlSelect({ param, label, options, value }: { param: string; label: string; options: Option[]; value: string | null }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  // El valor elegido se muestra al instante, sin esperar a que llegue la pantalla.
  const [elegido, setElegido] = useState<{ value: string; desde: string | null } | null>(null);
  return (
    <SearchSelect
      label={label}
      placeholder={label}
      options={options}
      value={elegido && elegido.desde === value ? elegido.value : value}
      onChange={(v) => {
        const next = new URLSearchParams(params.toString());
        next.set(param, v);
        setElegido({ value: v, desde: value });
        iniciarCarga();
        router.replace(`${path}?${next}`, { scroll: false });
      }}
    />
  );
}
