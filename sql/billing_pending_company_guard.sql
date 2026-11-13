-- Evita checkouts concorrentes para a mesma nova empresa.
create unique index if not exists checkout_pending_company on public.checkout_sessions(portal_user_id,lower(trim(company_name))) where license_id is null and status='pending';
