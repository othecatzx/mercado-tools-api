# Plano único e renovação em lote

## Administração

`/admin` → Pagamentos concentra os preços do plano único ML SH Support, nos períodos Mensal (1 mês), Semestral (6 meses) e Anual (12 meses). Todos oferecem as mesmas funções. Os três valores começam sem definição; nenhum preço dos antigos planos foi reaproveitado. As antigas categorias foram desativadas como oferta, preservando seus registros históricos.

O administrador também acompanha lotes, distribuição dos valores por empresa e eventos para revisão. A ativação de pagamentos exige ambiente de produção configurado; Sandbox continua bloqueado para compras reais.

## Portal do titular

O cliente acompanha os vencimentos das licenças que registrou, seleciona empresas, escolhe o período e confere uma cotação antes de gerar o pagamento único. Não administra planos, preços, ambiente do gateway ou dados financeiros de outros clientes. Subusuários continuam sem permissão de renovação financeira.

Não existe mais contratação de empresa/plano avulso pelo portal. A inclusão de licenças continua pelo fluxo de registro existente.

## Data única e proporcionalidade

1. A referência é o maior vencimento selecionado, ou hoje caso todas as licenças estejam expiradas.
2. Acrescentam-se 1, 6 ou 12 meses a essa referência, respeitando o calendário.
3. Cada licença paga os dias entre seu vencimento atual (ou hoje, se expirou) e a data única.
4. O valor é o preço do período multiplicado pelos dias adicionais, dividido pelos dias do período de referência. Cada item é arredondado em centavos; o total é a soma dos itens.
5. Após o pagamento confirmado, todas as licenças selecionadas recebem o mesmo vencimento, ao final daquela data em São Paulo.

Isso preserva o tempo já pago. A licença com maior vencimento paga um período completo; as anteriores incluem também os dias de alinhamento. A cotação mostra a data, os dias e o valor de cada empresa.

## Pagamento e proteção

Um checkout Asaas avulso, com Pix ou cartão, contém um item por empresa. Não cria uma assinatura recorrente para cada licença. A cotação é assinada, limitada ao titular e válida por dez minutos. Preços ou vencimentos alterados exigem nova cotação antes da criação do checkout.

Uma licença não participa de dois lotes pendentes. A confirmação consulta a API do Asaas, verifica o total e aplica todas as renovações em uma única transação. Eventos repetidos não alteram novamente os vencimentos. Se uma licença mudar durante o pagamento, o lote inteiro exige revisão administrativa; nenhuma é renovada parcialmente.

Estornos, contestações, cobrança adicional de um lote já pago e divergências exigem revisão. Não há estorno automático nesta entrega. Licenças com assinatura recorrente anterior precisam ser tratadas pelo administrador antes de entrar no lote.

Novas tabelas e funções são exclusivas de `service_role`, com RLS e sem execução por anon/authenticated. O token do webhook permanece separado da API Key. Não há dados de cartão no portal.

## Validação

`test/billing-batch.test.cjs` verifica cotação do titular, pagamento único, soma dos itens, preço controlado pelo servidor, recálculo, isolamento de usuários, administração protegida e bloqueio de Sandbox. Os testes do webhook, atendimento e automações permanecem no projeto.

`sql/batch_transaction_test.sql` usa service_role em uma transação com rollback para verificar proporcionalidade, data comum, reserva única, um único registro de pagamento, repetição, titular incorreto e ausência de renovação parcial. Não altera clientes reais nem deixa registros de teste.

Preços reais devem ser definidos no `/admin`. A configuração de produção e uma compra piloto autorizada continuam necessárias antes de liberar cobranças reais.
