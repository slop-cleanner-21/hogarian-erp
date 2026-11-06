-- Prod 1: suspensión de 4ta con N° de operación. No siempre se tiene el PDF, pero el N° de operación del Formulario 1609 se valida
-- en SUNAT, así que basta uno de los dos. La suspensión rige desde el día siguiente al de su emisión: un recibo de ese mismo día
-- aún lleva retención.

alter table public.proveedores add column suspension_4ta_operacion text
  constraint proveedores_suspension_operacion_chk check (suspension_4ta_operacion ~ '^[0-9]{6,12}$');
grant select (suspension_4ta_operacion), insert (suspension_4ta_operacion), update (suspension_4ta_operacion) on public.proveedores to authenticated;
alter table public.proveedores drop constraint proveedores_suspension_4ta_chk;
alter table public.proveedores add constraint proveedores_suspension_4ta_chk
  check ((suspension_4ta_fecha is null) = (suspension_4ta_path is null and suspension_4ta_operacion is null));

create or replace function public.fn_retencion_4ta(p_proveedor_id bigint, p_tipo tipo_comprobante, p_fecha date, p_total numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case
           when p_tipo <> 'RXH' or not (p_total > 1500) then 0
           when pr.suspension_4ta_fecha is not null and p_fecha > pr.suspension_4ta_fecha
                and extract(year from p_fecha) = extract(year from pr.suspension_4ta_fecha) then 0
           else round(p_total * coalesce(pr.retencion_4ta_pct, 8) / 100, 2)
         end
    from proveedores pr where pr.id = p_proveedor_id
$$;

-- Las suspensiones conocidas, por RUC (aunque esa persona aún no sea proveedor). Solo las lee la base.
create table public.suspensiones_4ta (
  ruc text not null,
  fecha date not null,
  numero_operacion text not null,
  primary key (ruc, fecha)
);
alter table public.suspensiones_4ta enable row level security;
revoke all on public.suspensiones_4ta from anon, authenticated;
create trigger audit_suspensiones_4ta after insert or delete or update on public.suspensiones_4ta
  for each row execute function public.fn_audit();

create or replace function public.fn_proveedor_suspension() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_s suspensiones_4ta%rowtype;
begin
  -- Un proveedor nuevo (o que recibe su RUC) toma la suspensión conocida: el código puede ser el RUC o el DNI de una persona.
  if new.suspension_4ta_fecha is null and (tg_op = 'INSERT' or new.ruc_o_cod is distinct from old.ruc_o_cod) then
    select * into v_s from suspensiones_4ta s
     where new.ruc_o_cod in (s.ruc, substr(s.ruc, 3, 8)) order by s.fecha desc limit 1;
    if found then
      new.suspension_4ta_fecha := v_s.fecha;
      new.suspension_4ta_operacion := v_s.numero_operacion;
      return new;
    end if;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if new.suspension_4ta_fecha is not null and new.suspension_4ta_path is null and new.suspension_4ta_operacion is null then
    raise exception 'Sube la constancia de suspensión de 4ta o ingresa su N° de operación';
  end if;
  if new.suspension_4ta_path is not null and (tg_op = 'INSERT' or new.suspension_4ta_path is distinct from old.suspension_4ta_path) then
    if new.suspension_4ta_path not like 'proveedores/%'
       or not exists (select 1 from storage.objects where bucket_id = 'documentos' and name = new.suspension_4ta_path) then
      raise exception 'Sube la constancia de suspensión de 4ta';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.suspension_4ta_fecha is distinct from old.suspension_4ta_fecha) and new.suspension_4ta_fecha > current_date then
    raise exception 'La fecha de la constancia no puede ser futura';
  end if;
  return new;
end;
$$;

drop trigger proveedor_suspension on public.proveedores;
create trigger proveedor_suspension before insert or update of suspension_4ta_path, suspension_4ta_fecha, suspension_4ta_operacion, ruc_o_cod on public.proveedores
  for each row execute function public.fn_proveedor_suspension();
