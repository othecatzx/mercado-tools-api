# Correção da fila operacional de vendas

Alterações incluídas nesta versão:

- A fila operacional consulta pedidos dos últimos 60 dias, alinhada ao período de dois meses exibido no Mercado Livre.
- Etiquetas já impressas permanecem em "Já separados" enquanto o envio ainda estiver aguardando despacho, mesmo que a venda tenha sido criada/atualizada em um dia anterior.
- A fila não depende mais de `date_last_updated` ser hoje para manter etiquetas impressas visíveis.
- Flex (`logistic_type=self_service`) é identificado e marcado na tabela.
- Um pedido só entra em "Cancelados" quando o envio também confirma cancelamento; `order.status=cancelled` isoladamente não é suficiente. Devoluções, reembolsos e reclamações continuam fora dessa categoria.
- O Express confia no proxy imediato do Render (`app.set('trust proxy', 1)`) para corrigir o aviso do `express-rate-limit`.

Observações:
- O ZIP não inclui `.env`, `.git` ou credenciais.
- Após substituir os arquivos no projeto, faça deploy e valide a fila com a conta Daphie.
- Se algum pedido específico continuar faltando, compare o `shipping.status`, `shipping.substatus` e `shipping.logistic_type` retornados pela API do Mercado Livre para aquele envio.
