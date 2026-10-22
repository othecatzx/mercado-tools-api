# ML SH Support — módulo de atendimento

## Incluído nesta versão

- Correção do cadastro de subusuário: o botão de criação agora abre o formulário em modo de criação (antes o evento de clique era interpretado como um usuário existente, deixando o e-mail bloqueado).
- Login de subusuários pela tela padrão `/portal`, usando o e-mail e a senha criados em **Equipe de atendimento**.
- Permissões verificadas no backend para visualizar/responder conversas, anexos, atribuição, encerramento, respostas rápidas e histórico.
- Caixa de entrada por licença com sincronização de mensagens pós-venda do Mercado Livre e pedidos recentes (janela inicial de 30 dias, até 25 pedidos por sincronização manual).
- Atualização periódica de conversas não lidas a cada 30 segundos enquanto a tela de atendimento estiver aberta.
- Envio de mensagens (limite de 350 caracteres, conforme API do Mercado Livre), upload/download de JPG, PNG, PDF e TXT (máximo 25 MB), atribuição local, encerramento/reabertura local.
- Respostas rápidas por licença (criar, editar, excluir e usar).
- Exportação CSV do histórico, impressão/Salvar como PDF pelo navegador e consulta de auditoria.
- Escopo isolado por licença e registros de auditoria.
- **Múltiplas lojas por subusuário:** no cadastro/edição, o administrador pode selecionar várias licenças ativas da própria conta; o atendente vê as lojas autorizadas na sua página inicial e pode abrir o atendimento de cada uma. O backend valida a permissão por licença em todas as rotas de conversa.

## Instalação

1. Faça backup da versão que está no servidor.
2. No Supabase SQL Editor, execute o arquivo completo `migration_atendimento.sql`. Ele cria as tabelas de conversas, mensagens e respostas rápidas além das tabelas iniciais de equipe/auditoria.
3. Publique os arquivos do ZIP no servidor, preservando as variáveis de ambiente existentes. Não substitua o `.env` do servidor pelo arquivo local.
4. Confirme que `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET` e o fluxo OAuth/redirect do Mercado Livre já estão configurados.
5. Reinicie a API e acesse `/portal`.
6. Entre com a conta principal, abra **Equipe de atendimento**, crie um subusuário com e-mail exclusivo e senha de pelo menos 8 caracteres. Depois saia e entre pela tela de login padrão com as credenciais do subusuário.
7. O subusuário verá as lojas selecionadas pelo administrador e poderá alternar entre elas no seletor do módulo **Atendimento**.
8. Ao atualizar de uma versão anterior, execute novamente o arquivo completo `migration_atendimento.sql`: ele adiciona a coluna `allowed_license_ids` e migra os subusuários existentes para manter a licença principal como acesso padrão.

## Observações importantes

- A sincronização usa a API oficial de mensagens pós-venda (`tag=post_sale`). O Mercado Livre só permite responder quando a conversa está disponível; conversas bloqueadas, pedidos cancelados, mediações e restrições da conta podem impedir envio.
- A API do Mercado Livre precisa estar autorizada para a conta e escopos necessários. Se a integração não tiver permissão de mensagens, o portal mostrará um erro de sincronização/envio; não há como contornar restrições da plataforma.
- O primeiro carregamento consulta mensagens não lidas e tenta descobrir conversas em até 25 pedidos recentes. A API de mensagens não fornece um endpoint universal para listar todo o histórico de todas as vendas; para histórico antigo, a conversa precisa ser descoberta/sincronizada.
- O status Encerrado/Reaberto é interno ao ML SH Support; não altera o estado da conversa na plataforma do Mercado Livre.
- Exportar PDF abre uma versão de impressão no navegador. Escolha **Salvar como PDF** na caixa de impressão.
- A seleção de várias lojas depende de essas licenças estarem ativas e vinculadas à mesma conta principal que criou o subusuário. Remover uma licença da conta administradora revoga o acesso do atendente a ela.
- O envio de mensagens e anexos não foi testado com tokens reais do usuário. A validação realizada aqui é estática/sintática; é necessário testar no ambiente com uma conta ML autorizada.
- Se já existirem subusuários duplicados com o mesmo e-mail em licenças diferentes, o login pode reportar ambiguidade. Os novos cadastros passam a exigir e-mail exclusivo.
