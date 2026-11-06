-- Exportar el Excel de control de costos (06/11/2026). Bucket privado, sin políticas: solo el servidor (clave secreta) lee
-- la plantilla (el .xlsm original: tiene RUCs y cuentas reales, no va en el repo) y guarda lo exportado, que se baja con
-- un enlace firmado de 2 minutos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('excel', 'excel', false, 52428800, array['application/vnd.ms-excel.sheet.macroEnabled.12'])
on conflict (id) do nothing;
