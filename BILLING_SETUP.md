# Planos e pagamentos

Implementação da confirmação de pagamentos e da tela do titular. Novas compras começam pausadas e não são aceitas em Sandbox. Nenhuma cobrança real foi criada durante a implementação.

## Fluxo

- A conta do portal deve estar autenticada. Subusuários não iniciam compras.
- O preço e o plano são consultados no banco, e o checkout é reservado com uma chave única da solicitação antes de chamar o Asaas.
- A página hospedada pelo Asaas coleta dados de pagamento; o portal não recebe cartão, CVV ou senha bancária.
- Os retornos de sucesso/cancelamento/expiração levam ao próprio portal e não liberam acesso.
- O webhook valida `asaas-access-token`, registra um evento mínimo e recupera o estado atual da cobrança na API do Asaas.
- A função `mlsh_apply_verified_payment` cria a empresa/licença/vínculo com o titular ou renova uma licença existente. O pagamento e a alteração de acesso são salvos na mesma transação.
- IDs de eventos e de cobranças impedem renovação duplicada entre PAYMENT_CONFIRMED/PAYMENT_RECEIVED e reenvios. O checkout é travado durante a transação.
- Valor, cliente do provedor, assinatura, ambiente e vínculo da licença são conferidos. Valores divergentes, bloqueios administrativos, estornos e contestações geram revisão, sem concessão automática adicional de acesso.
- Uma renovação recorrente acrescenta um mês ao período restante; cobranças avulsas, quando conciliadas, usam a duração registrada no checkout.
- Trocas de plano e cancelamentos de assinatura são feitos pelo suporte nesta versão. Estornos/chargebacks são sinalizados para revisão administrativa; não há política automática de revogação nesta entrega.

## Configuração

Variáveis de servidor já existentes: `ASAAS_API_URL`, `ASAAS_API_KEY`, `JWT_SECRET` e credenciais Supabase. A URL só aceita os hosts oficiais definidos em `billing.routes.js`.

O token do webhook é independente da API Key do Asaas. Pode ser configurado por `ASAAS_WEBHOOK_TOKEN` ou por seu SHA-256 em `billing_runtime.webhook_token_hash`, na linha do ambiente correspondente. A validação usa comparação em tempo constante. Nunca colocar token ou API Key no frontend ou neste documento.

Endpoint de recebimento: `https://app.caickrigato.com.br/api/webhooks/asaas`.

Eventos necessários: PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_REFUNDED, PAYMENT_PARTIALLY_REFUNDED, PAYMENT_CHARGEBACK_REQUESTED, PAYMENT_CHARGEBACK_DISPUTE, PAYMENT_REFUND_IN_PROGRESS, CHECKOUT_PAID, CHECKOUT_CANCELED, CHECKOUT_EXPIRED.

Para produção: configurar a API Key/URL de produção no servidor, cadastrar o webhook autenticado da conta de produção, validar uma compra piloto autorizada e somente então habilitar a linha `production` em `billing_runtime`. Não ativar compras reais usando credenciais de Sandbox.

## Proteções de dados

Tabelas novas têm RLS e acesso exclusivo do backend/service_role. A função transacional não pode ser executada por anon/authenticated. Planos ativos permanecem consultáveis, mas usuários anônimos/autenticados não podem alterar preços. A rota `/api/asaas-status` exige autenticação administrativa.

## Validação

- Nove testes Node de formato de evento, autenticação, consulta ao provedor, repetição, falha de persistência, titular, preço, compra pausada e bloqueio de Sandbox.
- Teste SQL com service_role e rollback: primeira liberação, vínculo ao titular, repetição da cobrança, renovação recorrente, valor divergente, estorno e pagamento sem vínculo. Não deixa registros de teste.
- Navegador isolado com dados simulados: seleção de plano/empresa, histórico, retorno do checkout, encaminhamento simulado, modo de testes, celular e tema escuro.
- Testes anteriores de operações e atendimento devem continuar passando.

## Referências oficiais

- https://docs.asaas.com/docs/sobre-os-webhooks
- https://docs.asaas.com/reference/recuperar-uma-unica-cobranca
- https://docs.asaas.com/reference/criar-novo-checkout
- https://docs.asaas.com/docs/create-new-webhook-via-api
