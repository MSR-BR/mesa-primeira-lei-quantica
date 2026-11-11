# Login GitHub da área do artigo

Serviço Node independente, sem dependências, para login OAuth de um GitHub App. A página permanece no GitHub Pages. O serviço troca o código de autorização no servidor e retorna à mesma aba com um bilhete cifrado de até 60 segundos, vinculado a uma prova gerada nessa aba. A página remove esse bilhete da URL e o troca pela sessão somente ao apresentar a prova. O token GitHub nunca é escrito em URL ou armazenamento do navegador. Nenhuma chave GPT passa por este serviço.

## Acesso

O GitHub App pede somente Contents e Actions: leitura/escrita, com Metadata: leitura. Instale exclusivamente no repositório do artigo. O app precisa ser público para permitir autorização de coautores externos; isso não torna colaboradores outros usuários nem libera escrita no artigo. Cada usuário precisa já ter permissão de escrita no repositório. O serviço valida a identidade, o acesso ao repositório e a instalação; o token recebe também `repository_id` na troca de autorização.

## Preparação administrativa única

1. Crie um projeto Vercel separado e configure as variáveis do `.env.example`, sem os valores de exemplo. `AUTH_STATE_KEY` deve ser uma chave aleatória de 32 bytes em base64; `AUTH_BASE_URL` deve ser o domínio estável de produção.
2. Para o cadastro automático do app, gere uma chave RSA local de uso único. Configure somente sua chave pública em `AUTH_SETUP_PUBLIC_KEY` e o SHA256 de um código aleatório em `AUTH_SETUP_CODE_HASH`. A chave privada fica em diretório temporário protegido; não vai ao repositório ou à Vercel.
3. Abra `/api/setup`, informe o código de configuração e confira o manifesto no GitHub. A criação e a instalação do app exigem a autorização do titular, somente no repositório escolhido.
4. O callback converte o manifesto no servidor e retorna apenas um envelope RSA-OAEP-SHA256 + AES-256-GCM criptografado. A automação local decifra esse envelope e configura `GITHUB_APP_CLIENT_ID` e `GITHUB_APP_CLIENT_SECRET` como variáveis secretas na Vercel, sem mostrá-las no chat. A chave privada do GitHub App não é necessária para este fluxo e não é persistida.
5. Remova as variáveis de bootstrap; com o client ID configurado, `/api/setup` já se desativa automaticamente. Refaça o deploy e instale o app somente no repositório do artigo.
6. Configure `auth-config.json` do workspace com `{"url":"https://YOUR-LOGIN-SERVICE.vercel.app"}` e publique. Cada autor clica em **Entrar com GitHub**, autoriza e retorna à mesma página.

## Sessão e verificação

O login usa estado criptografado autenticado, cookie HttpOnly/Secure/SameSite=Lax e PKCE S256. O retorno exige uma prova SHA256 gerada na aba original; o endpoint de troca permite somente a origem do artigo. Apenas essa prova temporária e o rascunho ficam em sessionStorage durante o redirecionamento, sendo removidos após o retorno. O token fica apenas na memória da aba, com duração máxima de 8 horas; **Sair** limpa a memória e pede revogação no GitHub. Recarregar a aba requer clicar novamente em Entrar com GitHub, sem copiar credenciais. Cancelamento, sessão expirada e falta de permissão mostram instruções na página.

Execute `npm test`. Antes de declarar o serviço pronto, verifique login real, revisão, salvamento de uma alteração LaTeX sem efeito editorial (comentário) e a geração/publicação do PDF. Confirme a autoria no commit. O segundo autor deve repetir o login com sua própria conta; não compartilhe a sessão do proprietário.
