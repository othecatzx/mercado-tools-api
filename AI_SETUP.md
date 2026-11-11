# Busca Universal e Assistente ML SH — ativação

## O que já está implementado
- Busca Universal (Ctrl + K no Windows/Linux ou Cmd + K no Mac; botão Buscar no portal).
- Navegação por páginas com verificação das permissões visíveis do usuário.
- Pesquisa local de IDs de pedidos, títulos e SKUs **já carregados** nas páginas de Vendas e Analytics.
- Assistente de IA na mesma janela, disponível somente após configurar Cloudflare.
- API autenticada, limite de 12 mensagens por dia por usuário no processo, intervalo mínimo de 5 segundos, timeout de 18 segundos.
- Respostas somente de leitura. Perguntas sobre faturamento, pedidos e produtos vendidos consultam o Mercado Livre automaticamente no servidor, utilizando as mesmas permissões do Analytics. Dados de pedidos pessoais não são enviados ao modelo Cloudflare.

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
- Consultas de vendas usam a rotina autenticada do endpoint `/api/portal/sales`, sem exigir que o usuário abra a página de Vendas. O resultado é calculado no backend, sem gastar cota da Cloudflare nessas perguntas. Consultas podem levar algum tempo dependendo da API Mercado Livre.
- Períodos aceitos nas perguntas: hoje, ontem, últimos 7 dias (padrão), últimos 30 dias e intervalo explícito DD/MM/AAAA até DD/MM/AAAA ou até hoje (até aproximadamente 89 dias para trás). Também responde à data de hoje sem chamar IA externa. Pedidos cancelados são excluídos dos totais, mas a situação reflete o status atual.
- O modo `aiMetrics=1` reutiliza a mesma autorização da API de vendas, mas retorna pedidos minimizados e evita consultas extras de envio; a sumarização e o filtro de datas ficam no servidor. Os nomes e motivos de falhas de conexão são exibidos para que o usuário saiba quando a resposta é parcial.
- A busca universal continua restrita a dados previamente carregados; o assistente consulta vendas diretamente no backend. O limite de consultas de vendas é 40 por usuário por dia no processo, com intervalo mínimo de 5 segundos.

## Novidades do Assistente (versão avançada)
- **Memória de sessão:** "Quanto a 4Show vendeu hoje?", "E ontem?", "Qual a diferença?". Guarda somente contexto de consulta (loja/período/pergunta), no sessionStorage do navegador e separado por usuário. Não armazena as respostas no servidor.
- **Gráfico por dia:** "Mostre um gráfico do faturamento dos últimos 15 dias". Desenha as barras no navegador com os números do backend, sem depender do modelo Cloudflare.
- **Filtros por linguagem natural:** "Quais notebooks Dell foram vendidos hoje acima de R$ 1.500 pela 4Show?". Filtros de produto, loja e mínimo de preço unitário. Usa apenas termos de catálogo reconhecidos; perguntas complexas fora desses padrões exigem novas regras.
- **Comparação:** "Compare as vendas de 01/11/2026 a 10/11/2026 com 01/10/2026 a 10/10/2026"; "Compare hoje com ontem"; "Compare últimos 7 dias com 7 anteriores".
- **Sugestões baseadas nos números:** "O que merece atenção nas vendas hoje?". Não afirma causas não comprovadas.
- **Favoritos:** ☆ Salvar pergunta / ★ Favoritas dentro da aba de IA. Só o texto da pergunta é salvo em localStorage, por usuário, neste navegador; não é sincronizado entre computadores.

Notas: toda consulta de números usa a rotina autenticada de vendas do Mercado Livre e respeita o escopo de licenças e a permissão de Analytics. Se uma loja não responder, a mensagem continua indicando que o resultado é parcial. Comparações e gráficos usam a data de criação dos pedidos; os valores de produtos filtrados são estimados por quantidade × preço unitário retornado. Nenhum desses cálculos exige uma chamada ao modelo Cloudflare. Quando a pergunta não corresponder às consultas estruturadas, o assistente segue usando a Cloudflare dentro dos limites atuais.
