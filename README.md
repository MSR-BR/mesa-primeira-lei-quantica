# Expansão perturbativa da primeira lei — artigo em grupo

Área independente de colaboração, criada pelo gerador `group-article-workspace` 2.1.0.
Repositório configurado: `example-owner/example-article`; branch principal: `main`.

## O que já existe

- `article/main.tex`, `sections/`, `references.bib`: fonte do PDF.
- `article-workspace.json`: título da página, autores, repositório e orientação editorial.
- `web/`: manuscrito com PDF atual, formulário por seção, PDFs anteriores e guia de colaboração.
- `scripts/build.py`: compilação real em LaTeX, página e metadados de versão.
- `scripts/review.py`: revisão pela OpenAI Responses; abre um draft pull request, sem merge automático.
- `context/editorial-contract.md`: contrato específico que os autores devem adaptar antes da primeira revisão.
- `generation-receipt.json`: inventário inicial com hashes; não é uma lista de arquivos a sobrescrever no futuro.

O esqueleto inicial contém notas explícitas de redação, não um artigo científico concluído.
O gerador não produz resultados científicos nem valida referências. Não copia chaves ou dados do projeto de origem.

## Validar localmente

Requisitos: Python 3.9+, Node.js, Pandoc, latexmk/TeX Live e pdftoppm.

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
node --check web/app.js
python3 scripts/build.py
python3 scripts/preview.py --port 8088
```

Abra `http://localhost:8088`. O build falha quando a fonte não compila e nunca usa um PDF antigo como substituto.
Caso importe manuscrito existente, confira dependências LaTeX/fontes e mantenha o título/autores de `article-workspace.json` alinhados aos de `article/main.tex`.

## Publicar no GitHub (etapa separada)

1. Revise texto, autores, configuração e contrato editorial.
2. Crie ou escolha **seu próprio** repositório `example-owner/example-article`; o gerador não cria repositórios, contas ou credenciais.
3. Faça commit e push desta pasta na branch `main`, depois de autorizar seu conteúdo e sua visibilidade. O push inicia a automação de PDF e publicação; forks/PRs geram apenas artefatos de prévia.
4. Em Settings → Pages, selecione **GitHub Actions**. Pages exige um repositório público no plano gratuito; o site geralmente é público mesmo com repositório privado. `noindex` não protege o artigo.
5. Em Settings → Secrets and variables → Actions, cadastre **OPENAI_API_KEY**. Nunca coloque a chave no navegador da página, nos arquivos ou no chat.
6. Para a IA criar propostas, habilite **Allow GitHub Actions to create and approve pull requests** em Settings → Actions → General. O workflow não aprova nem incorpora propostas.
7. Adicione cada coautor em Settings → Collaborators. Não há convite automático.
8. Confira a conclusão de **Publicar artigo e PDF**, a URL retornada pelo deploy e o PDF antes de declarar a publicação concluída.

O repositório é o armazenamento compartilhado; o GitHub Pages é uma interface estática.
Editar uma seção abre o formulário da própria página. Com o serviço de login configurado, cada autor entra com GitHub, pede a revisão e salva pela página; não precisa copiar credenciais. O fluxo antigo de revisão do artigo inteiro por pull request permanece opcional.
Não há edição simultânea de texto rico nem servidor próprio de autenticação.

## Revisar e consolidar

Actions → **Revisar artigo com IA** → Run workflow: informe o foco. Um colaborador com escrita também pode comentar `/revisar` numa Issue.

A revisão só lê o texto consolidado. O segredo fica no job de revisão, nunca no job de PDF de PRs. A resposta é um relatório em português, com propostas no idioma do manuscrito. Cada trecho proposto precisa corresponder exatamente a um único trecho do arquivo. Trocas ambíguas e comandos TeX de leitura/escrita de arquivos não são aplicados pela automação.

O draft pull request inclui `reviews/*.json` e alterações propostas, e a execução anexa uma prévia do PDF. Os autores conferem, ajustam e fazem merge. A aba Revisões reúne os PDFs anteriores do manuscrito.

Cada push consolidado gera PDF, versão com número/data/commit e Release. A área web exibe apenas o PDF atual, com links diretos para abrir/baixar.

A IA usa a API OpenAI com `store: false`, gera cobrança e não dispõe de busca externa. Modelo padrão `gpt-5.4`, substituível pela variável de Actions `OPENAI_MODEL`; a compatibilidade e o acesso precisam ser conferidos na conta do novo projeto. Não há submissão editorial automática.

## Recuperação

Para reverter uma mudança de texto ou interface, reverta o commit correspondente e publique novamente. Não execute o gerador sobre esta pasta para atualizar: ele recusa destinos existentes. Compare atualizações futuras numa pasta separada e incorpore somente o diff revisado.

## Revisão no formulário
Em cada seção, use **Editar e revisar com IA**. Entre pelo botão **Entrar com GitHub**, confira a comparação, aceite no formulário e salve quando estiver de acordo. O salvamento preserva autoria e verifica a versão para impedir sobrescritas concorrentes. A chave GPT fica no GitHub Actions.

## Login sem copiar credenciais — versão 2.0.0
O pacote inclui `auth-service/`, um serviço Node independente para OAuth de um GitHub App. A página continua no Pages; o segredo de cliente fica somente no servidor. Cada coautor entra com a própria conta e precisa de acesso de escrita ao repositório. Configure e instale a integração somente no repositório do novo artigo, seguindo `auth-service/README.md`, e informe `--auth-url https://SEU-SERVICO.vercel.app` na geração (ou `authUrl` em article-workspace.json). A geração não instala apps, não cria serviços nem copia credenciais. Sem configurar o serviço, leitura e comparação de propostas públicas permanecem disponíveis, mas as ações de escrita pedem login.

## Organização da mesa de trabalho
O cabeçalho de **01 Manuscrito** reúne o PDF atual e o login. Abstract e seções usam o mesmo formulário de sugestão, edição e revisão por IA; editar o Abstract altera somente seu conteúdo dentro de main.tex, preservando título, autores e restante do arquivo. **02 Revisões** contém somente links diretos aos PDFs de versões anteriores distintas do manuscrito: reconstruções que mudam apenas a interface não duplicam a lista. **03 Como colaborar** explica o fluxo pela página.

## Escopo desta prévia

Análise de dados contém as contas até segunda ordem, em aprovação coletiva. O Manuscrito começa vazio. Os fontes foram importados do PDF de 19 de outubro de 2026. A dinâmica reduzida será incorporada posteriormente. Para abrir a prévia já compilada, use `python3 scripts/preview.py --port 8088` a partir desta pasta e acesse `http://localhost:8088`. O repositório de exemplo deve ser substituído antes da publicação.


## Editor da análise e manuscrito

Use Abrir editor na seção ou subseção de Análise de dados. Adicione referências no campo manual ou selecione resultados do Research Starter. As fontes acompanham o pedido e o registro da revisão. Cadastre novas citações aprovadas em article/references.bib.

Para habilitar a busca, cadastre RESEARCH_STARTER_API_KEY nos segredos de Actions do repositório. A busca envia somente a consulta visível ao Research Starter. A revisão envia o trecho e as referências escolhidas à IA.

Use Levar para o manuscrito para copiar o texto atual e as referências para uma seção existente ou criar outra com nome e posição próprios. Na prévia local, o rascunho fica no navegador. No GitHub, ele é salvo em manuscript.json.

Use Salvar seção para registrar a edição. Use Gerar PDF no cabeçalho para compilar a versão atual e Baixar PDF para obter o arquivo. O botão de geração usa GitHub Actions na mesa publicada e scripts/preview.py na prévia local.

## Atualização da mesa compartilhada

A mesa usa um único repositório do artigo. Salvamentos na análise ou no manuscrito atualizam o site pela branch principal e preservam o PDF mais recente. Depois que a publicação terminar, os coautores podem recarregar a mesa para ver o conteúdo salvo. Use Gerar PDF para compilar o PDF da análise sob demanda. O histórico no GitHub identifica quem salvou cada alteração.
