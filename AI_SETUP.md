# Busca Universal e Assistente ML SH — ativação

## O que já está implementado
- Busca Universal (Ctrl + K no Windows/Linux ou Cmd + K no Mac; botão Buscar no portal).
- Navegação por páginas com verificação das permissões visíveis do usuário.
- Pesquisa local de IDs de pedidos, títulos e SKUs **já carregados** nas páginas de Vendas e Analytics.
- Assistente de IA na mesma janela, disponível somente após configurar Cloudflare.
- API autenticada, limite de 12 mensagens por dia por usuário no processo, intervalo mínimo de 5 segundos, timeout de 18 segundos.
- Respostas somente de leitura. **Nesta primeira versão a IA não tem números nem status de vendas em tempo real.**

## Como ativar a IA gratuita
1. Abra Cloudflare > Workers AI > Use REST API.
2. Obtenha o **Account ID** e crie um token de API dedicado com permissão Workers AI apropriada.
3. Em Render > seu serviço > Environment, crie:
   - `CLOUDFLARE_ACCOUNT_ID` = seu Account ID
   - `CLOUDFLARE_AI_API_TOKEN` = token criado para Workers AI
4. Salve as variáveis para reiniciar/publicar o serviço e abra seu portal.
5. Pressione Ctrl + K > Assistente IA. O indicador mostrará se a configuração está disponível.

**Não coloque tokens em arquivos HTML/JS, não envie tokens pelo chat e não faça commit do .env.**

## Modelo e franquia
Modelo usado: `@cf/meta/llama-3.1-8b-instruct-fp8`, na API REST da Cloudflare.
Cloudflare Workers AI tem alocação gratuita diária sujeita a limites e alteração pelo provedor. Mantenha o plano gratuito se desejar evitar cobrança. Caso a conta esteja em plano pago, a Cloudflare pode cobrar uso acima da franquia: o limite local de requisições **não** é uma garantia de custo zero.
O contador de 12 perguntas é por processo: reinicializações/múltiplas instâncias podem reiniciá-lo.
Documentação: https://developers.cloudflare.com/workers-ai/get-started/rest-api/
Preços: https://developers.cloudflare.com/workers-ai/platform/pricing/

## Segurança e limitações
- Backend consulta apenas os nomes das lojas licenciadas/autorizadas para dar contexto à IA.
- Não envia tokens Mercado Livre, Bling, dados pessoais de compradores ou pedidos.
- Evita armazenamento das perguntas no Supabase.
- Não executa alterações. Nenhuma nova tabela ou migration.
- A busca universal local não realiza novas consultas, para evitar lentidão e não contornar permissões.
- Para criar respostas com números reais de vendas, será necessário um endpoint separado de métricas agregadas, com verificação de permissões no servidor e privacidade de dados.
