# ML SH Support — Atendimento (Etapa 1)

Esta etapa adiciona a gestão inicial de subusuários por licença ao portal existente.

## O que está incluído
- Nova seção **Equipe de atendimento** dentro do portal.
- Listagem das licenças ativas vinculadas ao titular autenticado.
- Criação de subusuários com senha armazenada em hash bcrypt.
- Permissões granulares iniciais para conversas, anexos, respostas rápidas e histórico.
- Ativação/desativação, edição de permissões/senha e remoção de subusuários.
- Registro de auditoria das ações administrativas.
- Verificação de titularidade da licença em todas as rotas desta etapa.

## Antes de publicar
1. No SQL Editor do Supabase, execute `migration_atendimento.sql`.
2. Confirme que `licenses.id` e `portal_users.id` são UUIDs, como esperado pelo esquema desta migration.
3. Publique a API e o portal juntos, preservando as variáveis de ambiente existentes no provedor.
4. Teste com duas contas titulares e confirme que cada uma só enxerga usuários das próprias licenças.

## Rotas adicionadas
- `GET /api/portal/atendimento/licenses`
- `GET /api/portal/atendimento/agents?license_id=...`
- `POST /api/portal/atendimento/agents`
- `PATCH /api/portal/atendimento/agents/:id`
- `DELETE /api/portal/atendimento/agents/:id`

Todas exigem o JWT do portal no cabeçalho `Authorization: Bearer ...`.

## Permissões da etapa 1
- `conversations.view`
- `conversations.reply`
- `conversations.assign`
- `conversations.close`
- `attachments.send`
- `quick_replies.use`
- `quick_replies.manage`
- `history.view`

As permissões ficam armazenadas no banco e são configuráveis pela interface. O fluxo de login dos subusuários e a aplicação dessas permissões nas rotas de conversas ainda fazem parte das próximas etapas; não habilite o chat de produção antes de implementar e testar essa autorização.

## Próximas etapas
1. Autenticação dos subusuários e middleware de autorização por licença/empresa.
2. Sincronização de mensagens do Mercado Livre e central de conversas.
3. Mensagens em tempo real e suporte a anexos conforme os recursos permitidos pela API do canal.
4. Respostas rápidas e exportação PDF/CSV.

## Segurança
O pacote distribuível não inclui `.env` nem o repositório `.git`. Configure segredos somente nas variáveis de ambiente do seu servidor. O backend usa Supabase Service Role e, portanto, as verificações de titularidade devem permanecer no servidor.
