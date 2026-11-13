# Resumo diário de vendas — revisão antes da ativação

Implementação preparada na branch `feat/daily-sales-automation`. Atendimento foi publicado separadamente na main. A alteração de banco desta branch ainda não foi aplicada.

## Comportamento

- Aba Automações apenas para o titular, com horário configurável em São Paulo.
- Gera o fechamento do dia anterior e salva pedidos não cancelados, unidades, valor bruto e cancelamentos por loja.
- Só consulta lojas ativas, com licença vigente e vinculadas ao titular no momento da execução.
- Começa pausada. Gerar manualmente não ativa a geração diária.
- Um registro por regra/data impede geração duplicada. Falhas têm até três tentativas; há concessão temporária e recuperação após reinício.
- O histórico não contém nomes, mensagens ou endereços dos compradores.

## Alteração de banco proposta

Arquivo `sql/operations_automations.sql`:

1. Cria `portal_automation_rules`, `portal_automation_runs` e `portal_automation_runtime` com RLS e acesso apenas para `service_role`. O backend aplica o escopo do titular; os JWTs próprios do portal não acessam estas tabelas diretamente.
2. Cria a função transacional de retirada da fila, usando `FOR UPDATE SKIP LOCKED` e token de concessão.
3. Habilita `pg_net` e usa o `pg_cron` já existente para enfileirar tarefas a cada minuto.
4. Gera um token aleatório exclusivo do agendador, guarda o valor no Vault e somente o hash na tabela de runtime.
5. Se houver tarefa pendente, chama por HTTPS apenas `https://app.caickrigato.com.br/api/internal/automations/tick`. O token desse callback não é uma chave do Supabase ou do Mercado Livre, nem autoriza consultas do cliente. Ele só permite acordar o worker que consome a fila já existente.

Nenhuma chave de serviço ou token do marketplace é enviada nessa chamada. Nenhum envio de e-mail ou mensagem externa é configurado. A função do cron roda como invocador; os objetos novos não concedem acesso a `anon` ou `authenticated`.

## Validação realizada

- Oito testes de regras, escopo, permissões, limites de paginação, fuso, cancelamentos, worker e rejeição de callback sem autenticação.
- Teste visual em navegador isolado, com dados simulados: salvar horário, gerar manualmente, histórico parcial, atalhos de atendimento, celular e tema escuro.
- Consulta real de atendimento validada em modo somente leitura.
- O SQL e o cron ainda precisam de aplicação e teste integrado em produção após aprovação; nenhuma execução automática real foi ativada.

## Reversão sem apagar histórico

Pausar as regras e desagendar o job `mlsh-daily-reports`, preservando tabelas e resultados. O deploy anterior permanece na main. A revisão automática bloqueou a primeira tentativa de alteração do banco por criar schema, agendamento e callback autenticado em produção; não foi feito novo envio da alteração.
