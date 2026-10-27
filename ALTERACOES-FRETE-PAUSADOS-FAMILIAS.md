# Alterações — Frete comprador (anúncios pausados e famílias)

## O que mudou
- A consulta da ferramenta busca anúncios `active` e `paused` em cada conta Mercado Livre conectada.
- A paginação usa `search_type=scan` e cursor `scroll_id` separadamente para cada status.
- A lista continua limitada a preço maior que zero e até R$ 78,99, com `shipping.free_shipping=true`.
- A lista identifica dados de catálogo/família quando a API retorna `catalog_product_id`, `catalog_listing`, `family_name` ou `parent_item_id`.
- O diagnóstico por MLB informa status e dados de catálogo/família.
- A alteração aceita anúncios ativos e pausados. Anúncios pausados não são reativados; o sistema apenas tenta atualizar `shipping.free_shipping=false`. Se a API do Mercado Livre bloquear a operação, o erro será exibido no resultado.
- Continua bloqueada a alteração quando a tag `mandatory_free_shipping` estiver presente.

## Arquivos alterados
- `portal.routes.js`
- `portal/index.html`

## Implantação
1. Faça backup da versão atual do projeto.
2. Extraia este ZIP e substitua os arquivos do projeto.
3. Preserve as variáveis de ambiente já configuradas no Render; este ZIP não contém `.env`.
4. Faça o deploy e abra a página **Frete comprador**.
5. Clique em **Atualizar anúncios**. Use **Diagnosticar anúncio** para verificar MLBs específicos.

## Observação importante
A ferramenta não altera o status do anúncio e não o reativa automaticamente. Anúncios de catálogo/família podem ter regras próprias do Mercado Livre; nesses casos, a API poderá recusar a mudança e o portal mostrará o erro individual.
