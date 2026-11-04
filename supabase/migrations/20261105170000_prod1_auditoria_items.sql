-- Ítems: la auditoría solo registraba los cambios de cuenta contable y tipo de material (trigger del MVP,
-- audit_items_cuenta); el alta, la baja y los demás cambios no quedaban. En prod 1 los crea Gerencia: todo cambio
-- queda, como en el resto de las tablas del negocio (las cargas masivas siguen sin auditarse, app.skip_audit).
drop trigger if exists audit_items_cuenta on public.items;
create trigger audit_items after insert or update or delete on public.items
  for each row execute function public.fn_audit();
