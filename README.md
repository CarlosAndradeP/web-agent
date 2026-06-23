# Web Agent

Plataforma multi-usuário de desenvolvimento web com agente de IA autônomo. Cada usuário tem workspace isolado, sistema de créditos configurável por modelo, e pode criar projetos publicáveis com chat vinculado e URL pública.

## Stack

- **Backend**: Express v5 + TypeScript + SQLite (better-sqlite3)
- **Agent**: Vercel AI SDK v6 (ToolLoopAgent) + 10 ferramentas + sub-agente + autocorreção
- **Auth**: JWT (bcryptjs) com access token (15min) + refresh token (7 dias)
- **Frontend**: React 19 + Vite 8 + TailwindCSS 4 + shadcn/ui
- **Real-time**: SSE (streaming) + Socket.IO (créditos, arquivos, aprovações)
- **Projetos**: Static (express.static) / PHP (Apache 8080) / Node.js (spawn + proxy)
- **Docker**: `php:8.3-apache-bookworm` — Apache + Node.js no mesmo container

## Quick Start

### Docker (Produção)

```bash
cp .env.example .env
# Edite .env com API_BASE_URL, API_KEY, JWT_SECRET
docker compose up -d --build
# Acesse http://localhost:89
# Login padrão: admin / admin123
```

### Desenvolvimento Local

```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env

# Terminal 1 — Backend (porta 89)
npm run dev

# Terminal 2 — Frontend (porta 5173, proxy :89)
npm run dev:frontend
# Acesse http://localhost:5173
```

## Funcionalidades

### Multi-usuário
- Login/registro com JWT
- Admin pode pausar novos registros (toggle no painel Settings)
- Workspaces isolados por usuário (`workspace/<username>/`)
- Painel admin: gerenciar usuários, créditos, roles, configurações

### Sistema de Créditos
- Custo por step configurável por modelo (admin define no painel)
- Atualização em tempo real via Socket.IO (room-scoped por usuário)
- Tarefa abortada automaticamente se créditos esgotam
- Mensagem amigável "Créditos esgotados"
- Novo usuário: 100 créditos (configurável)
- Exibição do custo por step no seletor de modelo do chat

### Gerenciamento de Modelos (Admin)
- Habilitar/desabilitar modelos para usuários
- Definir custo por step para cada modelo
- Definir nome de exibição (displayName) customizado
- Modelos offline (não disponíveis na API) são sinalizados
- Alterações refletem imediatamente no chat dos usuários

### Projetos
- Sidebar mostra projetos (não sessões)
- Cada projeto tem chat vinculado = contexto do agente
- Cada projeto opera em sua subpasta no workspace (isolamento)
- URL pública: `/p/<uuid>/`
- 3 tipos: Static, PHP (Apache), Node.js (subprocess)
- Projetos Node.js são criados parados (start manual) — verificação de entrypoint antes de iniciar
- Publish direto do FileManager
- Projetos com falha de mount são marcados como `error` automaticamente

### FileManager
- Navegação estilo explorer com breadcrumbs clicáveis
- Duplo-clique em pasta para navegar dentro
- Botão voltar (nível acima)
- Escopado ao projeto ativo (não lista toda a workspace)
- Criar arquivo/pasta, renomear, deletar (arquivo e pasta)
- Upload drag & drop (arquivos e .zip)
- Download de pasta compactada em ZIP
- Extrair ZIP diretamente no gerenciador
- Publicar pasta como projeto

### Agente Autônomo
- 10 ferramentas: writeFile, readFile, listFiles, deleteFile, runCommand, executeCode, searchFiles, webFetch, installPackage, invokeSubAgent
- Sub-agente: delegar sub-tarefas a agente filho (5 tools, maxSteps limitado)
- Conhece a URL pública do projeto (via `PUBLIC_BASE_URL`)
- Autocorreção: analisa erros, corrige e tenta novamente
- Streaming em tempo real via SSE com indicadores contextuais por ferramenta
- Aprovação customizável (none/todas/custom) — padrão: `none` (execução imediata); usuário pode ativar na ConfigPanel
- Opera no escopo do projeto ativo (workspace do projeto, não raiz do usuário)

## Configuração

| Variável | Default | Descrição |
|----------|---------|-----------|
| `API_BASE_URL` | `http://192.168.3.5:11431/v1` | URL da API LLM (OpenAI-compatible) |
| `API_KEY` | — | Chave de API |
| `PORT` | `89` | Porta do servidor |
| `WORKSPACE_BASE_DIR` | `./workspace` | Base para workspaces per-user |
| `DATA_DIR` | `./data` | Diretório do SQLite |
| `MAX_STEPS` | `100` | Limite de steps por tarefa |
| `DEFAULT_MODEL` | `z-ai/glm-5.1` | Modelo padrão |
| `JWT_SECRET` | `web-agent-jwt-...` | Secret para JWT |
| `ADMIN_PASSWORD` | `admin123` | Senha do admin bootstrap |
| `INITIAL_CREDITS` | `100` | Créditos para novos usuários |
| `PUBLIC_BASE_URL` | — | URL base pública do servidor (ex: `http://myserver.com`) — usada para gerar URLs de projetos |

## API

### Auth (público + autenticado)
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/register` | Registro (cria workspace) |
| `POST` | `/api/auth/refresh` | Refresh token rotation |
| `GET` | `/api/auth/me` | Dados do usuário logado |
| `POST` | `/api/auth/logout` | Logout |
| `POST` | `/api/auth/change-password` | Trocar senha (auth) |
| `GET` | `/api/auth/credits/history` | Histórico de créditos próprio (auth) |
| `PATCH` | `/api/auth/profile` | Atualizar email (auth) |

### Chat + Core (autenticado)
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/chat` | Chat com agente (SSE, credit check) |
| `GET` | `/api/models` | Modelos disponíveis (habilitados, com costPerStep) |
| `GET/POST` | `/api/tasks` | Listar/criar tarefas |
| `PATCH` | `/api/tasks/:id` | Atualizar/cancelar tarefa |
| `GET/PUT/DELETE/POST` | `/api/files/*` | Operações de arquivo (per-user) |
| `GET/PUT` | `/api/config` | Configurações |
| `GET/POST` | `/api/sessions` | Sessões (filtradas por user) |
| `GET/POST` | `/api/projects` | Projetos (auto-cria sessão + pasta) |

### Admin (auth + admin role)
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/admin/users` | Listar usuários |
| `POST` | `/api/admin/users/:id/credits` | Adicionar créditos |
| `PATCH` | `/api/admin/users/:id/role` | Alterar role |
| `DELETE` | `/api/admin/users/:id` | Deletar usuário |
| `GET` | `/api/admin/users/:id/credits/history` | Histórico de créditos |
| `GET` | `/api/admin/stats` | Estatísticas globais (ampliadas) |
| `GET` | `/api/admin/models` | Listar todos os modelos com config |
| `PUT` | `/api/admin/models/:modelId` | Configurar modelo (enabled, costPerStep, displayName) |
| `DELETE` | `/api/admin/models/:modelId` | Remover configuração de modelo |
| `PATCH` | `/api/admin/models/batch` | Habilitar/desabilitar modelos em lote |
| `PATCH` | `/api/admin/users/:id` | Atualizar email do usuário |
| `POST` | `/api/admin/users/:id/reset-password` | Resetar senha do usuário |
| `GET` | `/api/admin/node-processes` | Listar processos Node.js ativos |
| `POST` | `/api/admin/node-processes/:uuid/stop` | Parar processo Node.js |
| `POST` | `/api/admin/node-processes/:uuid/restart` | Reiniciar processo Node.js |
| `GET` | `/api/admin/settings` | Configurações do sistema (registration toggle) |
| `PATCH` | `/api/admin/settings` | Atualizar configurações |

### Projetos (público por UUID)
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/p/<uuid>/*` | Servir projeto publicado (static, php, node) |

## Ferramentas do Agente

| Ferramenta | Descrição | Aprovação se custom |
|-----------|-----------|-------------------|
| `writeFile` | Criar/editar arquivos | — |
| `readFile` | Ler arquivos | — |
| `listFiles` | Listar diretórios | — |
| `deleteFile` | Remover arquivos/dirs | Sim |
| `runCommand` | Comandos shell | Sim |
| `executeCode` | JS/TS/Python | Sim |
| `searchFiles` | Buscar conteúdo (grep) | — |
| `webFetch` | HTTP GET | — |
| `installPackage` | npm/pip install | Sim |
| `invokeSubAgent` | Delegar sub-tarefa a agente filho (5 tools, max 30 steps) | — |

> **Nota:** Approval mode padrão é `none` — todas as ferramentas executam imediatamente. Mude para `all` ou `custom` na ConfigPanel para ativar aprovação.

## Estrutura

```
web-agent/
├── src/                    # Backend TypeScript
│   ├── server.ts           # Express + Socket.IO + auth bootstrap + project remount
│   ├── agent/              # ToolLoopAgent + 9 tools + provider
│   ├── api/                # REST routers (auth, admin, chat, models, tasks, files, config, sessions, projects)
│   ├── db/                 # Schema + migration + 8 repositories (incl. ModelConfigRepository)
│   ├── middleware/          # Auth + Admin middleware
│   ├── lib/                # JWT utilities
│   ├── services/           # TaskManager, CreditManager, ProjectRouter, etc.
│   └── websocket/          # Socket.IO events (room-scoped)
├── frontend/               # React + Vite + TailwindCSS
│   └── src/
│       ├── components/     # 17+ components (AdminPanel, UserPanel, FileManager com explorer)
│       ├── contexts/       # AuthContext (auth + credits listener + localStorage sync)
│       ├── hooks/          # 6 hooks (useChat, useProjects, useFiles com basePath, etc.)
│       └── lib/            # api.ts, auth-api.ts
├── apache/                 # Apache config (ports, vhost)
├── Dockerfile              # php:8.3-apache-bookworm multi-stage
├── docker-compose.yml
├── fix.md                  # Documentação dos bugs corrigidos
├── documentation.md         # Documentação técnica completa
└── plano.md                # Plano de desenvolvimento
```

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Backend com hot reload (tsx watch) |
| `npm run build` | Compilar TypeScript |
| `npm run start` | Executar compilado |
| `npm run build:frontend` | Build do frontend |
| `npm run dev:frontend` | Frontend dev server (porta 5173) |

## Bugs Conhecidos (pendentes)

| Severidade | Bug |
|-----------|-----|
| Crítico | Approval flow não pausa execução do agente |
| Crítico | AbortController não aborta LLM call em andamento |
| Médio | `search-files` usa `grep` (não funciona em Windows) |
| Médio | Sem path traversal protection nas agent tools |
| Baixo | `execution-sandbox.ts` é código morto |
| ~~Baixo~~ | ~~Node.js projects sem restart-on-crash~~ ✅ (start stopped + entrypoint check) |

## Bugs Corrigidos

Veja detalhes completos em [`fix.md`](fix.md).

| Severidade | Bug | Resumo |
|-----------|-----|--------|
| Crítico | Créditos nunca eram deduzidos | `mapRow()` não mapeava `user_id`/`workspace_dir` |
| Crítico | Agente escrevia no workspace global | Mesma causa — fallback para `appConfig.workspaceDir` |
| Crítico | Rotas admin sem proteção de role | `adminMiddleware` não aplicado |
| Crítico | Créditos não atualizam em tempo real | `creditManager.setIo()` nunca era chamado |
| Crítico | Links de projetos não funcionam (PHP/Node/Static) | Proxy PHP sem mapeamento UUID→caminho; pathRewrite morto; query strings perdidas |
| Crítico | ERR_TOO_MANY_REDIRECTS em `/p/<uuid>/` | `subPath === ''` causava redirect loop infinito |
| Médio | Projetos sem `index.html` carregavam SPA | `next()` no project-router caía no catch-all |
| Médio | Projetos com falha de mount ficavam "active" | Status não atualizado no `catch` do startup |
| Médio | Steps duplicados em `agent_steps` | Inserção no `onStepFinish` + `eventStream` |
| Médio | Créditos broadcastados para todos os usuários | `io.emit()` → `io.to(user:ID).emit()` |
| Baixo | Cache de créditos stale no localStorage | `updateCredits()` não sincronizava |
| Médio | Popup de aprovação exibia JSON completo | Resumido: ícone + ação + resumo; detalhes em accordion |
| Config | Approval mode padrão era `custom` | Mudado para `none`; migration atualiza DBs existentes |

## Schema — Tabela model_config

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | TEXT PK | UUID interno |
| `model_id` | TEXT UNIQUE | ID do modelo (ex: `z-ai/glm-5.1`) |
| `enabled` | INTEGER | 1=habilitado, 0=desabilitado (default 1) |
| `cost_per_step` | REAL | Créditos por step (default 1) |
| `display_name` | TEXT | Nome de exibição customizado |
| `created_at` | DATETIME | |
| `updated_at` | DATETIME | |
