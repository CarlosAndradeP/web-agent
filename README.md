# Web Agent

Plataforma multi-usuário de desenvolvimento web com agente de IA autônomo. Cada usuário tem workspace isolado, sistema de créditos, e pode criar projetos publicáveis com chat vinculado e URL pública.

## Stack

- **Backend**: Express v5 + TypeScript + SQLite (better-sqlite3)
- **Agent**: Vercel AI SDK v6 (ToolLoopAgent) + 9 ferramentas + autocorreção
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
- Workspaces isolados por usuário (`workspace/<username>/`)
- Painel admin: gerenciar usuários, créditos, roles

### Sistema de Créditos
- 1 crédito por step do agente (cada tool use)
- Atualização em tempo real via Socket.IO
- Tarefa abortada automaticamente se créditos esgotam
- Mensagem amigável "Créditos esgotados"
- Novo usuário: 100 créditos (configurável)

### Projetos
- Sidebar mostra projetos (não sessões)
- Cada projeto tem chat vinculado = contexto do agente
- URL pública: `/p/<uuid>/`
- 3 tipos: Static, PHP (Apache), Node.js (subprocess)
- Publish direto do FileManager

### FileManager
- Árvore de arquivos com preview
- Criar arquivo/pasta, renomear, deletar (arquivo e pasta)
- Upload drag & drop
- Publicar pasta como projeto

### Agente Autônomo
- 9 ferramentas: writeFile, readFile, listFiles, deleteFile, runCommand, executeCode, searchFiles, webFetch, installPackage
- Autocorreção: analisa erros, corrige e tenta novamente
- Streaming em tempo real via SSE
- Aprovação customizável (nenhuma/todas/custom) — UI pronta, fluxo de pausa pendente

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

## API

### Auth (público)
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/register` | Registro (cria workspace) |
| `POST` | `/api/auth/refresh` | Refresh token rotation |
| `GET` | `/api/auth/me` | Dados do usuário logado |
| `POST` | `/api/auth/logout` | Logout |

### Chat + Core (autenticado)
| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/chat` | Chat com agente (SSE, credit check) |
| `GET` | `/api/models` | Modelos disponíveis |
| `GET/POST` | `/api/tasks` | Listar/criar tarefas |
| `PATCH` | `/api/tasks/:id` | Atualizar/cancelar tarefa |
| `GET/PUT/DELETE/POST` | `/api/files/*` | Operações de arquivo (per-user) |
| `GET/PUT` | `/api/config` | Configurações |
| `GET/POST` | `/api/sessions` | Sessões (filtradas por user) |
| `GET/POST` | `/api/projects` | Projetos (auto-cria sessão) |

### Admin (auth + admin role)
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/admin/users` | Listar usuários |
| `POST` | `/api/admin/users/:id/credits` | Adicionar créditos |
| `PATCH` | `/api/admin/users/:id/role` | Alterar role |
| `DELETE` | `/api/admin/users/:id` | Deletar usuário |
| `GET` | `/api/admin/stats` | Estatísticas globais |

### Projetos (público por UUID)
| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/p/<uuid>/*` | Servir projeto publicado |

## Ferramentas do Agente

| Ferramenta | Descrição | Aprovação default |
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

## Estrutura

```
web-agent/
├── src/                    # Backend TypeScript
│   ├── server.ts           # Express + Socket.IO + auth bootstrap
│   ├── agent/              # ToolLoopAgent + 9 tools + provider
│   ├── api/                # 9 REST routers (factory pattern)
│   ├── db/                 # Schema + migration + 7 repositories
│   ├── middleware/          # Auth + Admin middleware
│   ├── lib/                # JWT utilities
│   ├── services/           # TaskManager, CreditManager, ProjectRouter, etc.
│   └── websocket/          # Socket.IO events
├── frontend/               # React + Vite + TailwindCSS
│   └── src/
│       ├── components/     # 15+ components
│       ├── contexts/       # AuthContext (auth + credits listener)
│       ├── hooks/          # 6 hooks (useChat, useProjects, etc.)
│       └── lib/            # api.ts, auth-api.ts
├── apache/                 # Apache config (ports, vhost)
├── Dockerfile              # php:8.3-apache-bookworm multi-stage
├── docker-compose.yml
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

## Bugs Conhecidos

Veja detalhes em [`documentation.md`](documentation.md#15-bugs-conhecidos-e-pendências).

| Severidade | Bug |
|-----------|-----|
| Crítico | Approval flow não pausa execução do agente |
| Crítico | AbortController não aborta LLM call em andamento |
| Médio | `search-files` usa `grep` (não funciona em Windows) |
| Médio | Sem path traversal protection nas agent tools |
| Baixo | `execution-sandbox.ts` é código morto |
| Baixo | Node.js projects sem restart-on-crash |
