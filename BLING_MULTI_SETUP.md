# Integração Bling multi-contas — entrega de desenvolvimento

## Estado atual
Implementação adicionada ao backend e ao portal existente, sem modificar `bling.js` da extensão nem apagar rotas antigas. **Não foi implantada nem testada contra o Supabase/Render/Bling reais**. Os dois ambientes de API presentes no ZIP não têm migrações/versionamento completos do schema em produção. Execute primeiro em homologação.

## Arquivos modificados
- `server.js`: registro do novo módulo e preservação do corpo bruto para validação de assinatura.
- `portal/index.html`: novas entradas de navegação e script de páginas Bling.
- `package.json`: dependências para geração de PDF e QR Code.

## Arquivos criados
- `bling-multi.routes.js`: OAuth2, conexões, stock webhook, listagem, editor API, etiquetas PDF.
- `bling-multi.migration.sql`: quatro tabelas novas, índices, FKs, RLS.
- `portal/bling-multi.js`: gerenciamento de contas, seleção de entradas e modelos com prévia.
- `BLING_MULTI_SETUP.md`: este documento.

## SQL Supabase
1. Faça backup.
2. Confira tipo `portal_users.id` no banco real (a migration presume `uuid`).
3. Rode `bling-multi.migration.sql` no SQL Editor.
4. Revise políticas RLS, role de service key e nível de privilégios antes de disponibilizar a terceiros.

## Variáveis no Render (somente backend)
- `BLING_CLIENT_ID` e `BLING_CLIENT_SECRET`: aplicativo OAuth Bling.
- `BLING_TOKEN_ENCRYPTION_KEY`: chave hexadecimal de 32 bytes, por exemplo criada com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Reutiliza `JWT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` existentes.
- Nunca expor essas credenciais no frontend ou no repositório.

## Instalação
No diretório `mercado-tools-api`, execute `npm install` e faça deploy no serviço Render que já executa `node server.js`. O arquivo `package-lock.json` pré-existente foi omitido do pacote entregue para que `npm install` gere um lock atualizado com `pdfkit` e `qrcode` (commitá-lo depois). Não faça `npm ci` antes disso.

## Configuração Bling
1. No aplicativo OAuth já registrado no Bling, habilite permissões de empresas, produtos e estoque.
2. Registre a URL de retorno `https://SEU-DOMINIO/api/portal/bling/callback`.
3. Em Webhooks, habilite o recurso `stock` com `created` e `updated` e a URL `https://SEU-DOMINIO/api/webhooks/bling/stock`, versão `v1`.
4. O mesmo aplicativo pode ser autorizado por contas Bling diferentes. No portal, use **Integrações → Bling → Conectar Bling** e efetue login na conta escolhida. Repita para cada conta, inclusive Recitek.
5. Renomeie cada conexão. Caso o `companyId` emitido no webhook seja diferente de `id` retornado em `/empresas/me`, informe esse `companyId` na opção **Renomear** da conexão. A correspondência deve ser validada com um evento de homologação antes de ativar em produção.
6. Não há limite numérico de conexões no código. Cada conexão usa tokens criptografados independentemente.

## Testar movimentos de estoque
1. Faça uma movimentação física de **entrada** (`operacao = E`) na conta de homologação Bling.
2. Confirme no Render o recebimento HTTP 200 com assinatura `X-Bling-Signature-256` válida.
3. Confirme registro em `bling_stock_entries` com `bling_connection_id`, `event_id`, data e quantidade corretos.
4. Envie o mesmo webhook duas vezes e confirme só uma linha; envie evento de saída ou virtual e confirme que não entra na lista.
5. Em **Entradas de Estoque**, filtre pela conta, clique em **Atualizar** para enriquecer produto com nome/SKU/imagem. O enriquecimento está implementado sob demanda, não como fila automática. Em lista geral, cada entrada mostra a origem.
6. Confira em homologação se `/produtos/{id}` retorna `codigo`, `nome` e `imagemURL` conforme os escopos habilitados. Campos não retornados ficam vazios.

## Testar etiquetas
1. Em **Modelos de Etiquetas**, crie/edite um modelo, dimensões e elementos. Faça upload de logo pequeno (PNG/JPEG).
2. Em **Entradas de Estoque**, selecione entradas, escolha individualmente quantidades na coluna **Etiquetas** e clique **Gerar etiquetas**.
3. O servidor envia `application/pdf` com tamanho de página em mm convertido para pontos. Abra a aba do PDF e use imprimir/salvar PDF sem ajuste de escala. Para etiquetas térmicas configure mídia real e escala 100% no driver.
4. O QR Code contém **somente** o SKU (`codigo` do Bling), nunca uma URL.

## Limitações e pendências importantes
- O PDF de etiqueta citado no pedido **não estava entre os anexos recebidos**: o modelo inicial é uma aproximação configurável, não uma réplica validada do 4SHOW.
- A integração da extensão (`bling.js`) é um módulo de automação do navegador, não um fluxo OAuth multi-contas existente; foi preservada intencionalmente, sem uma migração de tokens inexistentes nesse módulo.
- O webhook valida HMAC e idempotência por evento, com data de evento fornecida pelo Bling. Para processamento fora de ordem, os eventos são tratados como registros históricos independentes; não há fila distribuída de retentativas de enriquecimento.
- Editor tem controles de posição/tamanho e prévia em tempo real, mas **não há drag-and-drop, margens globais/bordas configuráveis, nem histórico de impressão** nesta versão.
- PDF foi implementado mas **não foi validado com impressora real nem com dados reais do Bling**. A qualidade final depende de teste de QR, dimensões, fontes e driver.
- Rotação segura de refresh token em concorrência entre múltiplos servidores exige lock transacional ou RPC PostgreSQL; o controle atual é otimista.
- A revogação OAuth junto ao provedor não foi implementada: desconectar remove as credenciais utilizáveis da aplicação, sem afirmar revogação remota.
- Certifique-se da correspondência de `companyId` nos eventos. Caso haja contas distintas com o mesmo companyId em ambientes diferentes, separe aplicativos e credenciais por ambiente.
- Verifique limites de API e homologação do Bling antes de ativar em produção.

## Referências
- OAuth: https://developer.bling.com.br/aplicativos
- Webhooks: https://developer.bling.com.br/webhooks
- Referência de API: https://developer.bling.com.br/referencia
