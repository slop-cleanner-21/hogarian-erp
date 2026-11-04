-- Re-auditoría de seguridad (05/11/2026). Propio de prod 1.

-- ── Rutas de archivos sin «..» (path traversal) ──
-- adjuntos.path lo arma el cliente y la política solo miraba sus dos primeros tramos: con «40/x/../../../comprobantes/…»
-- el link del proveedor (que lee con la clave secreta) entregaba cualquier archivo de cualquier bucket.
alter table public.adjuntos add constraint adjuntos_path_seguro
  check (position('..' in path) = 0 and position('//' in path) = 0 and position('\' in path) = 0
         and position('%' in path) = 0 and left(path, 1) <> '/');
alter table public.comprobantes add constraint comprobantes_archivo_seguro
  check (archivo_path is null or (position('..' in archivo_path) = 0 and position('//' in archivo_path) = 0
         and position('\' in archivo_path) = 0 and position('%' in archivo_path) = 0 and left(archivo_path, 1) <> '/'));
alter table public.guias add constraint guias_archivo_seguro
  check (archivo_path is null or (position('..' in archivo_path) = 0 and position('//' in archivo_path) = 0
         and position('\' in archivo_path) = 0 and position('%' in archivo_path) = 0 and left(archivo_path, 1) <> '/'));

-- ── Precios de la cotización: números de verdad ──
-- «NaN» pasaba (NaN <= 0 es falso) y dejaba la orden con total NaN; Infinity o 1e30 daban un error interno.
do $$
declare
  f text := pg_get_functiondef('public.enviar_cotizacion'::regproc);
begin
  if position('r.pu is null or r.pu <= 0' in f) = 0 then raise exception 'enviar_cotizacion: no se encontró la validación del precio'; end if;
  execute replace(f, 'r.pu is null or r.pu <= 0', 'r.pu is null or not (r.pu > 0 and r.pu < 100000000)');
end $$;
alter table public.oc_items add constraint oc_items_pu_valido
  check ((pu_cotizado is null or (pu_cotizado > 0 and pu_cotizado < 100000000))
     and (pu_aprobado is null or (pu_aprobado > 0 and pu_aprobado < 100000000)));

-- ── El link solo da el contrato de una OS con contrato (no las de retención ni de valorización) ──
do $$
declare
  f text := pg_get_functiondef('public.archivo_link'::regproc);
  a text := $a$elsif p_tipo = 'CONTRATO' and v_o.tipo = 'OS' then$a$;
begin
  if position(a in f) = 0 then raise exception 'archivo_link: no se encontró el contrato'; end if;
  f := replace(f, a, $b$elsif p_tipo = 'CONTRATO' and v_o.tipo = 'OS' and not v_o.es_retencion and v_o.valorizacion_id is null then$b$);
  -- Devuelve si hay contrato (para generarlo cuando aún no está firmado).
  a := $a$return jsonb_build_object('obra_id', v_o.obra_id, 'numero', v_o.numero, 'tipo', v_o.tipo, 'path', v_path);$a$;
  if position(a in f) = 0 then raise exception 'archivo_link: no se encontró el retorno'; end if;
  f := replace(f, a, $b$return jsonb_build_object('obra_id', v_o.obra_id, 'numero', v_o.numero, 'tipo', v_o.tipo, 'path', v_path,
    'con_contrato', v_o.tipo = 'OS' and not v_o.es_retencion and v_o.valorizacion_id is null);$b$);
  execute f;
end $$;

-- ── Huella: tablas solo para el servidor ──
-- Las protegía solo la RLS sin políticas (tenían todos los permisos, incluido TRUNCATE).
revoke all on public.huellas, public.huella_desafios from anon, authenticated;

-- Desafíos para entrar: con la IP, para limitarlos por IP (300 en total se agotaban con un script y nadie podía
-- entrar con huella).
alter table public.huella_desafios add column if not exists ip text;
create index if not exists huella_desafios_ip_idx on public.huella_desafios (ip) where user_id is null;
