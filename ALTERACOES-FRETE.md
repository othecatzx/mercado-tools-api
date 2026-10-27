# Atualização — Frete por conta do comprador

## Correção principal
A consulta de anúncios agora usa `search_type=scan` com `scroll_id` para percorrer todas as páginas retornadas pelo Mercado Livre. A paginação anterior por `offset` parava em 1.000 IDs, o que podia deixar anúncios elegíveis fora da página.

## Compatibilidade da API
A consulta em lote de detalhes foi migrada de `/items?ids=` para `/items/bulk?ids=` e lê `status_code` (mantendo compatibilidade com `code`).

## Diagnóstico por MLB
Na página **Frete comprador**, há o campo **Consultar anúncio por MLB**, preenchido inicialmente com `MLB5243952883`. O diagnóstico consulta as contas Mercado Livre vinculadas e mostra preço, status, frete grátis, modalidade, logística, tags e motivo de não elegibilidade.

## Instalação
Substitua os arquivos do projeto pelos arquivos deste ZIP e faça o deploy normalmente no Render. Mantenha as variáveis de ambiente já configuradas no Render. O arquivo `.env` local e a pasta `.git` não foram incluídos neste ZIP.

## Observação
A correção amplia a busca além dos primeiros 1.000 anúncios. O diagnóstico por MLB depende de a conta proprietária estar conectada e autorizada no portal. Nenhum anúncio foi alterado durante esta atualização.
