-- Clientes acessam estas tabelas pela API; o backend usa service_role.
-- Fechar acesso direto anônimo sem alterar os registros existentes.
alter table public.payments enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.mercadolivre_accounts enable row level security;
