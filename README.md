# Web Agent Autônomo

Agente de IA autônomo com painel web para execução de tarefas. O agente utiliza 9 ferramentas (arquivos, shell, código, web) e se autocorrige até completar a tarefa.

## Stack

- **Backend**: Express v5 + TypeScript 6 + SQLite (better-sqlite3)
- **Agent**: Vercel AI SDK v6 (`ToolLoopAgent`) + `@ai-sdk/openai-compatible`
- **Frontend**: React 19 + Vite 8 + TailwindCSS 4
- **Real-time**: SSE (streaming) + Socket.IO (aprovações, notificações)
- **Runtime**: Node.js 22 Alpine (Docker)

## Quick Start

### Docker (Produção)

```bash
cp .env.example .env
# Edite .env com sua API_KEY
docker compose up -d --build
# Acesse http://localhost:89
```

### Desenvolvimento Local

```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env
# Edite .env com sua API_KEY

# Terminal 1 — Backend (porta 89)
npm run dev

# Terminal 2 — Frontend (porta 5173, proxy para :89)
npm run dev:frontend
# Acesse http://localhost:5173
```

## Configuração

| Variável | Default | Descrição |
|----------|---------|-----------|
| `API_BASE_URL` | `http://192.168.3.5:11431/v1` | URL da API LLM (OpenAI-compatible) |
| `API_KEY` | — | Chave de API |
| `PORT` | `89` | Porta do servidor |
| `WORKSPACE_DIR` | `./workspace` | Diretório de trabalho do agente |
| `MAX_STEPS` | `100` | Limite de steps por tarefa |
| `DEFAULT_MODEL` | `meta/llama-3.1-405b-instruct` | Modelo padrão |
| `DATA_DIR` | `./data` | Diretório do banco SQLite |

Configurações também podem ser alteradas em runtime via painel web (`/api/config`), com persistência em SQLite.

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/chat` | Chat com agente (SSE stream) |
| `GET` | `/api/models` | Modelos disponíveis |
| `GET/POST` | `/api/tasks` | Listar/criar tarefas |
| `PATCH` | `/api/tasks/:id` | Atualizar tarefa (cancelar) |
| `GET` | `/api/tasks/:id/steps` | Steps do agente |
| `GET` | `/api/files` | Árvore de arquivos do workspace |
| `GET/PUT/DELETE` | `/api/files/content` | Ler/criar/deletar arquivo |
| `GET/PUT` | `/api/config` | Configurações |
| `GET/POST` | `/api/sessions` | Sessões de chat |
| `DELETE` | `/api/sessions/:id` | Deletar sessão (cascade) |

## Ferramentas do Agente

| Ferramenta | Descrição | Aprovação default |
|-----------|-----------|-------------------|
| `writeFile` | Criar/editar arquivos | — |
| `readFile` | Ler arquivos | — |
| `listFiles` | Listar diretórios | — |
| `deleteFile` | Remover arquivos | Sim |
| `runCommand` | Comandos shell | Sim |
| `executeCode` | Executar JS/TS/Python | Sim |
| `searchFiles` | Buscar conteúdo (grep) | — |
| `webFetch` | Requisições HTTP GET | — |
| `installPackage` | npm/pip install | Sim |

Modos de aprovação: `none` (autônomo), `all` (tudo requer aprovação), `custom` (apenas tools selecionadas).

## Projeto

```
web-agent/
├── src/              # Backend TypeScript
│   ├── server.ts     # Express + Socket.IO entry point
│   ├── agent/        # ToolLoopAgent + 9 tools + provider
│   ├── api/          # 6 REST routers (factory pattern)
│   ├── db/           # SQLite schema + repositories
│   ├── services/     # TaskManager, ApprovalManager, FileWatcher, ModelResolver
│   └── websocket/    # Socket.IO events
├── frontend/         # React + Vite + TailwindCSS
│   └── src/          # Components, hooks, libs, types
├── Dockerfile        # Multi-stage build
├── docker-compose.yml
├── plano.md          # Plano de desenvolvimento (status + bugs)
└── documentation.md  # Documentação técnica completa
```

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Backend com hot reload |
| `npm run build` | Compilar TypeScript |
| `npm run start` | Executar compilado |
| `npm run build:frontend` | Build do frontend |
| `npm run dev:frontend` | Frontend dev server |

## Bugs Conhecidos

Veja detalhes completos em [`documentation.md`](documentation.md#14-bugs-conhecidos-e-pendências).

| Severidade | Bug |
|-----------|-----|
| Crítico | Path mismatch no Docker (frontend em `./public` vs `frontend/dist`) |
| Crítico | Approval flow não pausa execução (tools executam sem aguardar aprovação) |
| Crítico | AbortController não conectado ao agent (cancelar não aborta LLM call) |
| Médio | `agent_steps` nunca populada (endpoint `/steps` retorna `[]`) |
| Médio | `search-files` usa `grep` (não funciona em Windows; shell injection) |
| Médio | Sem proteção contra path traversal nas tools |
