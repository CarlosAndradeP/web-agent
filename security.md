# Inventário de segurança — Web Agent

> Levantamento atualizado em 21/08/2026. A chave administrativa de proteções do agente está implementada; autenticação, ownership, workspace, segredos e assinaturas permanecem invariantes.

## Resumo executivo

O projeto possui agora uma política central para as proteções operacionais dos agentes. As demais proteções continuam distribuídas entre configuração de inicialização, middleware HTTP, autorização dentro dos endpoints, autenticação do Socket.IO, resolução de caminhos, limites de recursos, publicação de projetos e integrações externas.

Já existem três controles dinâmicos, mas independentes:

| Controle atual | Persistência | Painel/API | Alcance |
|---|---|---|---|
| `approval_mode` / `approval_tools` | tabela `config` | `ConfigPanel` e `PUT /api/config` | Somente ferramentas do agente principal |
| `registration_enabled` | tabela `config` | Admin > Ajustes e `PATCH /api/admin/settings` | Somente cadastro de novos usuários |
| `llm_rate_limit_enabled` | tabela `config` + memória | Admin > Ajustes e `PATCH /api/admin/settings` | Somente chamadas de saída ao provedor LLM |
| `agent_security_mode` | tabela `config` | Admin > Ajustes e `PATCH /api/admin/settings` | Agente principal, subagente e quatro papéis do orquestrador |

`src/services/security-policy.ts` converte `protected`/`permissive` em um snapshot imutável compartilhado. O padrão e o fallback são sempre `protected`.

### Limite recomendado para o futuro botão

“Desativar a segurança inteira” não deve significar remover autenticação, autorização entre usuários, isolamento de caminhos, validação de webhooks ou proteção de segredos. Essas camadas são fronteiras de dados e de infraestrutura; desligá-las permitiria que um usuário acessasse arquivos, sessões, créditos e processos de outros usuários ou do host.

A implementação separa:

- **Controles operacionais alternáveis:** aprovações humanas, bloqueio de comandos, filtro de código, SSRF do `webFetch`, sanitização de conteúdo, regras de prompt, instalação de pacotes e limites adicionais do agente.
- **Invariantes sempre ativos:** JWT, função de administrador, ownership/IDOR, isolamento de workspace e symlinks, assinatura de webhook/ONLYOFFICE, filtragem de segredos do ambiente, limites básicos de corpo/upload e validações de integridade.

Uma chave administrativa pode coordenar o primeiro grupo. O segundo deve permanecer `fail closed`, mesmo no modo permissivo.

## Mapa das camadas e bloqueios

### 1. Inicialização, segredos e configuração de implantação

| Local | O que faz | Natureza |
|---|---|---|
| `src/config.ts` | Carrega os segredos de access token, refresh token, administrador e ONLYOFFICE. Em produção encerra o processo se estiverem ausentes; em desenvolvimento usa valores inseguros com aviso. Também lê CORS e proxy confiável. | Invariante de implantação |
| `.env.example` | Documenta JWTs separados, senha administrativa, CORS, `TRUST_PROXY`, Mercado Pago e ONLYOFFICE. | Documentação/configuração |
| `docker-compose.yml` | Exige `JWT_SECRET`, `ADMIN_PASSWORD` e `ONLYOFFICE_JWT_SECRET`; não publica diretamente as portas internas com `ports`; habilita JWT no ONLYOFFICE. | Invariante de implantação |
| `Dockerfile` | Executa em produção, cria diretórios, usa `www-data` para workspace/projetos e define UID/GID 33 para comandos do agente. | Isolamento de processo |
| `.dockerignore` e `.gitignore` | Excluem `.env`, bancos, WAL, workspace, dados, dependências e artefatos do contexto Docker/Git. | Proteção contra vazamento |

Observação: `config.ts` não exige comprimento ou entropia mínima dos segredos; apenas presença em produção.

### 2. Autenticação HTTP e sessões

| Local | O que faz |
|---|---|
| `src/lib/jwt.ts` | Emite access token de 15 minutos e refresh token de 7 dias com segredos e claims de tipo separados; rejeita tipo de token incorreto. |
| `src/middleware/auth.ts` | Exige `Authorization: Bearer` e valida access token. Não aceita token na URL. |
| `src/api/auth.ts` | Login, cadastro, rotação de refresh token, logout, troca de senha, perfil e histórico. Hashes de refresh token ficam no banco; o token consumido é removido na rotação. |
| `src/db/repositories/users.ts` | Usa bcrypt, custo 10, para senha de usuário. |
| `src/server.ts` | Aplica limitador em memória: 5 requisições/minuto por IP em login/cadastro e 20/minuto em refresh. |

Pontos relevantes:

- O papel (`admin`/`user`) fica dentro do access token. Alteração de papel ou exclusão do usuário pode levar até 15 minutos para deixar de valer em rotas que confiam somente no token.
- `change-password` não remove as sessões de refresh existentes; `logout` remove todas do usuário.
- O limitador é por processo/contêiner, não compartilhado entre réplicas.
- O refresh compara no máximo 20 hashes bcrypt por usuário para limitar amplificação de CPU.

### 3. Autorização administrativa e ownership entre usuários

| Local | O que faz |
|---|---|
| `src/middleware/admin.ts` | Bloqueia qualquer requisição sem papel `admin`. |
| `src/server.ts` | Monta todo `/api/admin` atrás de `authMiddleware` + `adminMiddleware`; monta chat, modelos, tarefas, arquivos, config, sessões, projetos, orquestrador e Word atrás de autenticação. |
| `src/api/chat.ts` | Verifica dono da sessão, impede `system` vindo do cliente e exige que a mensagem mais recente seja de usuário. |
| `src/api/tasks.ts` | Filtra listagem por usuário e verifica dono ao consultar, cancelar e ler passos. |
| `src/api/sessions.ts` | Filtra listagem e verifica dono para mensagens, limpeza e exclusão. |
| `src/api/projects.ts` | Todas as operações exigem que `project.userId` seja o usuário autenticado. |
| `src/api/orchestrator.ts` | Verifica dono da sessão-pai no start/upload e aplica `isAdminOrOwner` em status, passos, tarefas, stop, pause, resume e upload. |
| `src/api/config.ts` | Usuário autenticado recebe configuração sem `apiKey`; atualização é exclusiva de administrador. |
| `src/api/payments.ts` | Operações Pix autenticadas são sempre filtradas pelo usuário dono. |
| `src/api/word.ts` | Resolve o usuário autenticado no banco e mantém um workspace Word por usuário. |

As falhas IDOR do orquestrador descritas na versão anterior deste documento foram corrigidas no código atual.

### 4. Socket.IO

| Local | O que faz |
|---|---|
| `src/websocket/index.ts` | Valida JWT no handshake, grava usuário no socket e conecta o cliente à sala `user:<id>`. |
| `src/websocket/events.ts` | Impede usuário comum de entrar em sala alheia, responder aprovação alheia, cancelar tarefa alheia ou assinar orquestração alheia. Administrador possui bypass explícito. |
| `src/services/approval-manager.ts` | Emite pedidos na sala do dono e nega por padrão respostas sem owner; administrador pode responder. |

Limitação atual: o handshake aceita `socket.handshake.auth.token` e, como fallback, `socket.handshake.query.token`. Token em query string pode aparecer em logs e histórico.

### 5. Isolamento de workspace e caminhos

| Local | O que faz |
|---|---|
| `src/agent/tools/sanitize.ts` | `safeWorkspacePath()` e `assertPathInsideWorkspace()` bloqueiam caminho absoluto/relativo fora da raiz, troca de drive e escape por symlink existente, usando `resolve`, `relative` e `realpath`. |
| `src/lib/workspace-paths.ts` | Valida username como segmento único e resolve pasta de usuário/projeto exclusivamente dentro de `WORKSPACE_BASE_DIR`. |
| `src/api/files.ts` | Todas as operações passam por workspace do usuário e `safeWorkspacePath`. |
| `src/api/projects.ts` | Resolve `folderPath` dentro do workspace do dono. |
| `src/api/orchestrator.ts` e `src/orchestrator/orchestrator-runner.ts` | Mantêm specs e arquivos gerados dentro do workspace resolvido. |
| `src/api/word.ts` | Restringe documentos e modelos ao subdiretório Word do usuário. |
| `src/agent/tools/write-file.ts`, `read-file.ts`, `list-files.ts`, `delete-file.ts`, `search-files.ts`, `execute-code.ts` | Reutilizam a mesma validação central. |

Esta é uma fronteira multiusuário e não é desligada pela chave administrativa.

### 6. Política de comandos e ambiente de subprocessos

| Local | O que faz |
|---|---|
| `src/agent/tools/command-policy.ts` | `validateCommand()` bloqueia padrões destrutivos, leitura de segredos, rede interna, eval, expansão `$()`, elevação de privilégio, reverse shell e acesso ao app/banco. Analisa tokens e rejeita paths fora do workspace. |
| `src/agent/tools/command-policy.ts` | `buildSafeEnv()` cria allowlist de variáveis; `buildWorkspaceEnv()` redefine HOME/caches para o workspace; `getUnprivilegedExecOptions()` usa UID/GID configurado ou `www-data` quando o processo Unix roda como root. |
| `src/agent/tools/run-command.ts` | Aplica política, executa no workspace, usa ambiente reduzido, timeout e buffer máximo. |
| `src/agent/tools/install-package.ts` | Valida nome, bloqueia metacaracteres/pacotes conhecidos, usa `execFile`; npm recebe `--ignore-scripts`, pip instala no workspace. |
| `src/services/project-router.ts` | Projetos Node recebem ambiente reduzido por `buildSafeEnv()`. |

Limitações atuais:

- `runCommand` ainda usa shell (`exec`) e uma denylist regex; não é uma sandbox forte e pode haver variantes não cobertas.
- Em Windows `getUnprivilegedExecOptions()` não reduz usuário/SID.
- O agente-filho normal (`src/agent/tools/sub-agent.ts`) reutiliza ferramentas protegidas por path/política, mas não herda o fluxo de aprovação do agente pai.

### 7. Execução de código do agente

| Local | O que faz |
|---|---|
| `src/agent/tools/execute-code.ts` | Bloqueia imports, rede, processo, caminhos absolutos/traversal e geração dinâmica. JavaScript usa `vm`, permissões do Node e wrapper; Python usa `-I`, wrapper de `open` e allowlist de imports. Ambos usam ambiente reduzido, timeout e limpeza de temporários. |

Esta proteção é defesa em profundidade, não um limite de virtualização. Regex, `node:vm` e monkey-patching de Python não devem ser tratados como sandbox equivalente a contêiner/microVM.

### 8. SSRF e conteúdo não confiável

| Local | O que faz |
|---|---|
| `src/agent/tools/web-fetch.ts` | Aceita somente HTTP/HTTPS; bloqueia localhost, IPs privados, link-local, metadata, formatos alternativos de IP e IPv6 privado; resolve DNS antes do fetch e repete uma checagem próxima da requisição; timeout de 15s e resposta máxima enviada ao agente de 50 mil caracteres. |
| `src/agent/tools/content-sanitize.ts` | Substitui linhas que parecem injeção de prompt em inglês, português e espanhol por `[FILTERED]`. |
| `src/agent/tools/read-file.ts` e `web-fetch.ts` | Aplicam `sanitizeForPrompt()` antes de devolver conteúdo ao modelo. |
| `src/agent/prompts/shared-security.ts` | Injeta regras não negociáveis de workspace, segredos, persistência, exfiltração e conteúdo não confiável. |
| `src/agent/prompts/development-prompt.ts`, `word-prompt.ts`, `sub-agent-prompt.ts` | Incorporam as regras compartilhadas aos perfis do agente. |

O `webFetch` segue no máximo cinco redirects manualmente e revalida URL e DNS em cada salto. No modo permissivo, redes RFC1918/ULA são aceitas, mas localhost, loopback, link-local, metadata e formatos ambíguos de IP continuam bloqueados.

### 9. Aprovação humana

| Local | O que faz |
|---|---|
| `src/db/repositories/config.ts` | Persiste `approval_mode` (`none`, `custom`, `all`) e a lista `approval_tools`. O padrão atual é `none`. |
| `src/agent/tools/index.ts` | Envolve ferramentas selecionadas e aguarda `requestApproval()` antes de executar. `all` envolve todas; `custom` somente a lista; `none` executa imediatamente. |
| `src/services/approval-manager.ts` | Mantém aprovações pendentes, espera até 5 minutos, nega em timeout e valida o respondente. |
| `src/websocket/events.ts` | Recebe `approval:respond` e repassa identidade/papel. |
| `frontend/src/components/ApprovalDialog.tsx` | Interface do usuário para aprovar/negar. |
| `frontend/src/components/ConfigPanel.tsx` | Interface atual para escolher modo e ferramentas. |

A observação antiga de que a ferramenta executava antes da aprovação não é mais verdadeira: o wrapper atual aguarda a Promise e só então chama a execução original.

Lacunas:

- Os quatro agentes do orquestrador em `src/orchestrator/agents/*.ts` constroem ferramentas diretamente e não passam por `buildToolSet()`/`ApprovalManager`.
- `src/agent/tools/sub-agent.ts` também constrói seu conjunto diretamente.
- Portanto `approval_mode=all` não cobre todo o sistema.

### 10. Uploads, ZIP e limites de recursos

| Local | O que faz |
|---|---|
| `src/server.ts` | Limita JSON a 3 MB. |
| `src/api/files.ts` | Limita arquivo a 25 MB, 10 arquivos e total a 100 MB; preview/editor a 2 MB; ZIP a 2.000 entradas, 50 MB por entrada e 200 MB descompactado; árvore a 10 mil entradas/20 níveis. Sanitiza filename e valida cada entrada contra Zip Slip. |
| `src/api/orchestrator.ts` | Upload apenas `.md`, até 20 arquivos de 10 MB cada, nomes reduzidos a basename e destino validado. |
| `src/api/word.ts` | Aceita extensões Word definidas, até 10 arquivos de 50 MB; valida destino e downloads/callbacks. |
| `src/agent/tools/search-files.ts` | Limita resultados de busca a 100 e ignora ocultos/`node_modules`. |
| `src/agent/tools/web-fetch.ts` | Timeout de 15s e truncamento para o agente. |
| `src/orchestrator/orchestrator-runner.ts` | Máximo total de 500 passos, 3 tentativas por tarefa, 1 replanejamento e contexto de specs limitado a 100 mil caracteres. |

Os uploads do orquestrador e Word usam memória e não possuem limite total agregado menor que `número de arquivos × limite individual`.

### 11. Créditos e limitação de LLM

| Local | O que faz |
|---|---|
| `src/db/repositories/credits.ts` | Dedução atômica com `WHERE credits >= ?`, adição atômica e registro na mesma transação. |
| `src/services/credit-manager.ts` | Centraliza cobrança e isenta administrador. |
| `src/api/chat.ts` e `src/orchestrator/orchestrator-runner.ts` | Verificam crédito antes de iniciar/continuar trabalho. |
| `src/services/llm-rate-limiter.ts` | Fila FIFO dinâmica para chamadas LLM, configurável pelo admin. |
| `src/agent/provider.ts` | Adquire vaga no limitador antes da chamada ao provedor. |

Créditos e rate limit são controles de abuso/custo, não substituem as fronteiras de segurança.

### 12. HTTP, CORS, proxy e exposição pública

| Local | O que faz |
|---|---|
| `src/server.ts` | Configura allowlist CORS, `trust proxy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP, CORP e HSTS em produção. |
| `src/server.ts` | `/health` é público e informa estado/heartbeat do orquestrador. |
| `src/server.ts` e `src/services/project-router.ts` | `/p/<uuid>/...` é deliberadamente público, sem autenticação, e serve/proxy projetos publicados. |
| `apache/projects.conf` | Desabilita listagem de diretório, permite symlinks necessários e desabilita forward proxy. |

Lacunas atuais:

- Se `CORS_ORIGINS` e `PUBLIC_BASE_URL` estiverem vazios em produção, `getAllowedOrigins()` retorna `true`, abrindo CORS para qualquer origem.
- Não há CSP nem `Permissions-Policy`; não há `helmet`.
- Projetos publicados são públicos para quem conhecer o UUID. PHP e Node executam código criado pelo usuário/agente.

### 13. Execução e publicação de projetos

| Local | O que faz |
|---|---|
| `src/api/projects.ts` | Exige ownership para criar, iniciar, parar, promover e excluir. |
| `src/services/project-router.ts` | Usa portas internas em loopback, proxy por UUID, ambiente reduzido, reinício exponencial até 5 vezes e SIGTERM seguido de SIGKILL. |
| `src/preload/port-force.cjs` | Força projetos Node a ouvirem na porta atribuída. |
| `apache/projects.conf` | Publica PHP por symlink controlado no diretório de links. |

Risco relevante: se `package.json` possuir `scripts.start`, `ProjectRouter` executa `npm start` sem passar o script pela `command-policy`. Como o workspace é gravável pelo agente/usuário, esse é um caminho de execução de código fora da política de comandos. O ambiente é filtrado, mas o processo não recebe `getUnprivilegedExecOptions()` explicitamente e não é isolado por contêiner próprio.

### 14. ONLYOFFICE

| Local | O que faz |
|---|---|
| `src/api/word.ts` | Cria links JWT com propósito: conteúdo por 2h e callback por 24h; restringe arquivo ao Word workspace. |
| `src/api/word.ts` | Callback exige também JWT do Document Server, valida origem do URL de download contra ONLYOFFICE configurado, converte para URL interna confiável, rejeita redirect e limita arquivo a 50 MB. |
| `docker-compose.yml` | Compartilha segredo JWT com o Document Server; permite IP privado para integração interna e bloqueia metadata IP. |

Os tokens de conteúdo/callback ficam na URL e podem aparecer em logs, embora sejam assinados, tenham propósito e expiração.

### 15. Mercado Pago

| Local | O que faz |
|---|---|
| `src/api/payments.ts` | Exige autenticação nas operações de usuário; webhook público exige assinatura HMAC e usa `timingSafeEqual`; rejeita se o segredo não estiver configurado; confirma estado diretamente na API do Mercado Pago antes de creditar; crédito é idempotente/transacional. |

Assinatura de webhook e confirmação no provedor são invariantes e não devem obedecer a um modo permissivo global.

### 16. Banco, logs e encerramento

| Local | O que faz |
|---|---|
| `src/db/index.ts` | Executa integrity check, faz backup de banco corrompido, habilita WAL, foreign keys e busy timeout. |
| `src/db/schema.ts` e `src/db/migrate.ts` | Foreign keys, cascatas e índices de ownership/sessão. |
| `src/services/logger.ts` | Escrita assíncrona e separação diária; logs registram operações e decisões de bloqueio. |
| `src/server.ts` | Encerramento gracioso de orquestrador, watcher, projetos e banco. |

`uncaughtException` e `unhandledRejection` apenas registram e mantêm o processo ativo; após uma exceção fatal o estado do processo pode não ser confiável.

## Implementação da chave administrativa

Os pontos integrados são:

1. **Persistência:** `src/db/repositories/config.ts`, chave `agent_security_mode` com padrão `protected`.
2. **Política central:** `src/services/security-policy.ts`, que produz snapshots imutáveis e transforma prompts.
3. **API administrativa:** `src/api/admin.ts`, dentro de `GET/PATCH /settings`, com validação e auditoria em log.
4. **Tipos e cliente:** `src/types/index.ts`, `frontend/src/types/index.ts` e `frontend/src/lib/api.ts`.
5. **Botão único:** `frontend/src/components/AdminPanel.tsx`, aba Ajustes, com confirmação digitada e aviso persistente no painel.
6. **Agente principal:** `src/agent/index.ts`, `src/agent/tools/index.ts` e ferramentas afetadas.
7. **Agentes secundários:** `src/agent/tools/sub-agent.ts` e todos os `src/orchestrator/agents/*.ts` recebem o mesmo snapshot.
8. **Execuções em andamento:** mantêm o snapshot capturado no início; a alteração vale para novas execuções.
9. **Auditoria:** registra administrador, IP, valor anterior e novo sem registrar segredos.

### Comportamento da chave

| Camada | Modo protegido | Modo permissivo | Deve ser desligável? |
|---|---|---|---|
| Aprovação humana | Conforme configuração (`all/custom/none`) | `none` | Sim |
| Denylist de comandos | Ativa | Desativada | Sim, somente para agente |
| Filtro de `executeCode` | Ativo | Desativado; invólucros e isolamento de ambiente permanecem | Sim, somente em isolamento forte |
| SSRF de `webFetch` | Bloqueia redes internas | Permite RFC1918/ULA | Metadata, loopback e link-local nunca desligam |
| Sanitização de prompt | Ativa | Desativada | Sim |
| Regras de prompt | Estritas | Perfil permissivo explícito | Sim |
| Instalação de pacotes | Validada/sem scripts npm | Mais permissiva | Parcialmente |
| JWT e admin | Ativos | Ativos | Não |
| Ownership/IDOR | Ativo | Ativo | Não |
| Workspace/symlink | Ativo | Ativo | Não |
| Ambiente sem segredos | Ativo | Ativo | Não |
| Webhook/ONLYOFFICE signatures | Ativas | Ativas | Não |
| Limites básicos de upload/corpo | Ativos | Ativos | Não |

## Lacunas atuais priorizadas

| Prioridade | Lacuna | Local principal |
|---|---|---|
| Alta | `npm start` executa script gravável sem política/sandbox própria | `src/services/project-router.ts` |
| Alta | Aprovação não cobre subagente nem agentes do orquestrador | `src/agent/tools/sub-agent.ts`, `src/orchestrator/agents/*.ts` |
| Média | Política de shell é denylist e `runCommand` usa `exec` | `src/agent/tools/command-policy.ts`, `run-command.ts` |
| Média | `executeCode` é defesa em profundidade, não sandbox forte | `src/agent/tools/execute-code.ts` |
| Média | CORS fica aberto em produção se nenhuma origem for configurada | `src/server.ts` |
| Média | `maxSteps` de chat/tarefa não é validado nem limitado no backend; o cliente pode enviar valor negativo ou excessivo | `src/api/chat.ts`, `src/api/tasks.ts`, `src/db/repositories/tasks.ts` |
| Média | Endpoint admin de créditos aceita número negativo e pode reduzir/deixar saldo negativo pela rota de “adicionar” | `src/api/admin.ts`, `src/db/repositories/credits.ts` |
| Média | Troca de senha não revoga refresh tokens | `src/api/auth.ts` |
| Média | Papel/exclusão de usuário não é revalidado no banco a cada access token | `src/lib/jwt.ts`, `src/middleware/auth.ts` |
| Média | Projetos PHP/Node executam código do workspace no mesmo contêiner do servidor | `src/services/project-router.ts`, Apache/Docker |
| Média | Código crítico de segurança não possui testes automatizados, linter ou CI configurados | projeto inteiro |
| Baixa | Token Socket.IO pode ser enviado na query string | `src/websocket/index.ts` |
| Baixa | `/health` expõe estado e heartbeat do orquestrador | `src/server.ts` |
| Baixa | Não há CSP/Permissions-Policy | `src/server.ts` |
| Baixa | Segredos não têm comprimento mínimo validado | `src/config.ts` |
| Baixa | Exceções não tratadas são registradas sem finalizar processo | `src/server.ts` |

## Correções em relação ao documento anterior

O inventário anterior estava desatualizado nos seguintes pontos:

- ownership do orquestrador agora é verificado em start, status e steps;
- `.dockerignore` agora exclui `.env`, dependências, builds, Git, dados e workspace;
- CORS possui configuração de allowlist, embora ainda possa cair em modo aberto;
- existem cabeçalhos de segurança e limite JSON de 3 MB;
- arquivos lidos e páginas obtidas são sanitizados contra padrões de prompt injection;
- aprovação aguarda a decisão antes de executar;
- `executeCode` e a política de ambiente foram significativamente reforçados;
- no modo protegido, `installPackage` usa `execFile`, `--ignore-scripts` no npm e ambiente reduzido; no permissivo, scripts npm são aceitos, mas `execFile` e o ambiente reduzido permanecem;
- uploads e ZIP possuem limites e proteção contra Zip Slip;
- o documento atual contém 16 tabelas no schema, incluindo Pix e Word, não 14.

## Checklist da implementação

- [x] Usar o nome “Proteções do agente” e modos `protected`/`permissive`.
- [x] Manter autenticação, ownership, workspace, segredos e assinaturas sempre ativos.
- [x] Criar uma única fonte de verdade para agente principal, subagente e orquestrador.
- [x] Garantir atualização somente por administrador e fallback seguro.
- [x] Exibir aviso persistente e exigir confirmação digitada para o modo permissivo.
- [x] Registrar alterações da chave em log/auditoria.
- [x] Manter snapshot em execuções em andamento; processos Node publicados não são reiniciados.
- [ ] Criar testes para ambos os modos antes de disponibilizar o botão.
- [ ] Cobrir também regressões de path traversal/symlink, SSRF/redirect, comando, approval, ownership, upload/ZIP e limites de `maxSteps`.
- [ ] Testar Linux/Docker e Windows separadamente, pois a redução de UID/GID não existe no Windows.
