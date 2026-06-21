# Web Agent Autônomo — Plano de Desenvolvimento

## Visão Geral

Aplicação Node.js com painel web para interação com agente autônomo que utiliza ferramentas (execução de código, criação de arquivos, comandos shell) para completar tarefas de forma incansável, autocorrigindo erros até concluir com perfeição.

## Status: IMPLEMENTADO

Todas as 7 fases foram completadas. O projeto compila sem erros (`tsc --noEmit` passa), o backend sobe na porta 89, todas as APIs REST respondem corretamente, e o frontend builda com sucesso. Ver **Bugs Conhecidos** abaixo para pendências.

## Stack Tecnológica

| Camada | Tecnologia | Versão Instalada |
|--------|-----------|-------------------|
| Agent Framework | Vercel AI SDK v6 (`ai`, `@ai-sdk/openai-compatible`) | `ai@6.0.208`, `@ai-sdk/openai-compatible@0.2.16` |
| API Provider | `@ai-sdk/openai-compatible` | `0.2.16` (retorna `LanguageModelV1`, requer cast `as any`) |
| Backend | Express.js v5 + TypeScript 6 | `express@5.2.1`, `typescript@6.0.3` |
| Frontend | React 19 + Vite 8 + TailwindCSS 4 | `vite@8.0.16`, `tailwindcss@4.3.1` |
| Comunicação Real-time | SSE (streaming) + Socket.IO (bidirecional) | `socket.io@4.8.3` |
| Persistência | SQLite via `better-sqlite3` | `better-sqlite3@12.11.1` |
| Sandbox | `child_process.execSync` com timeout 30s | — |
| Runtime | Node.js 22 Alpine (Docker) | — |

## Decisões de Arquitetura

- **Tudo no mesmo container**: backend, frontend buildado, SQLite, agent, workspace
- **Aprovação customizável**: modo configurável pelo painel web (nenhuma/todas/custom com checkboxes por tool) — **NOTA: veja bugs conhecidos, o fluxo de aprovação ainda não pausa a execução**
- **Sem sandbox Docker-in-Docker**: execução direta via `child_process.execSync` com timeout
- **Autocorreção**: system prompt instrui o agente a analisar erros, corrigir e tentar novamente
- **Persistência**: SQLite para tarefas, histórico de chat, configurações e steps do agente
- **ESM puro**: `type: "module"` no package.json, imports com `.js` em todos os arquivos TS
- **Factory pattern**: Routers, Tools e Provider usam factory functions para injeção de dependências

## Arquitetura

```
┌──────────────────────────────────────────────────────────┐
│                    Docker (Port 89)                       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Express Server (src/server.ts)                  │    │
│  │                                                    │    │
│  │  /api/chat        → Chat com agente (SSE)        │    │
│  │  /api/models      → Listar modelos disponíveis   │    │
│  │  /api/tasks       → CRUD de tarefas              │    │
│  │  /api/files       → Gerenciador de arquivos      │    │
│  │  /api/config      → Configurações do ambiente     │    │
│  │  /api/sessions    → Sessões de chat               │    │
│  │                                                    │    │
│  │  Socket.IO   → Real-time bidirecional            │    │
│  │    - task:progress  (progresso de tarefa)         │    │
│  │    - task:step      (cada step do agente)         │    │
│  │    - task:complete  (tarefa concluída)            │    │
│  │    - task:error     (erro + autocorreção)         │    │
│  │    - file:changed   (arquivo criado/modificado)   │    │
│  │    - approval:request (solicitar aprovação)       │    │
│  │    - approval:respond (resposta do usuário)       │    │
│  │                                                    │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  Agent Engine (src/agent/)                 │  │    │
│  │  │                                             │  │    │
│  │  │  ToolLoopAgent (ai@6.0.208)                │  │    │
│  │  │  ├── Tools: 9 ferramentas                  │  │    │
│  │  │  │   ├── writeFile      (criar/editar)     │  │    │
│  │  │  │   ├── readFile       (ler arquivos)      │  │    │
│  │  │  │   ├── listFiles       (listar diretório) │  │    │
│  │  │  │   ├── deleteFile      (remover arquivo) │  │    │
│  │  │  │   ├── runCommand     (shell commands)    │  │    │
│  │  │  │   ├── executeCode    (executar código)   │  │    │
│  │  │  │   ├── searchFiles    (buscar conteúdo)  │  │    │
│  │  │  │   ├── webFetch       (requisições HTTP) │  │    │
│  │  │  │   └── installPackage  (npm/pip install) │  │    │
│  │  │  │                                        │  │    │
│  │  │  ├── Instructions: sistema autocorretivo  │  │    │
│  │  │  ├── stopWhen: stepCountIs(maxSteps)      │  │    │
│  │  │  ├── maxOutputTokens: 4096                │  │    │
│  │  │  └── model: provider.chatModel() as any   │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  │                                                    │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  SQLite (better-sqlite3, modo WAL)          │  │    │
│  │  │  └── ./data/web-agent.db                   │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  │                                                    │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  Workspace (./workspace/)                  │  │    │
│  │  │  └── Diretório isolado p/ arquivos criados│  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  React Frontend (frontend/dist - servido Express)│    │
│  │                                                    │    │
│  │  ┌────────┐ ┌──────────┐ ┌──────────┐           │    │
│  │  │  Chat  │ │ Tarefas  │ │ Arquivos │           │    │
│  │  │  Panel │ │ Manager  │ │ Manager  │           │    │
│  │  └────────┘ └──────────┘ └──────────┘           │    │
│  │  ┌────────────────────────────────────┐          │    │
│  │  │  Config: modelo, steps, aprovações│          │    │
│  │  └────────────────────────────────────┘          │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│   NVIDIA NIMS API                        │
│   http://192.168.3.5:11431/v1            │
│   (OpenAI-compatible mirror)             │
└──────────────────────────────────────────┘
```

## Estrutura de Diretórios (Implementada)

```
web-agent/
├── Dockerfile                    # Multi-stage: frontend build → backend tsc → node:22-alpine
├── docker-compose.yml             # Port 89, volumes: workspace + data
├── package.json                   # type: module, ESM, todas as deps
├── tsconfig.json                  # ES2022, ESNext, bundler resolution, strict
├── .env.example                   # 7 variáveis com defaults
├── .gitignore
├── plano.md                       # Este arquivo
├── documentation.md               # Documentação técnica completa
├── src/
│   ├── server.ts                  # Express v5 + Socket.IO + rotas + SPA catch-all
│   ├── config.ts                  # Config centralizado (env vars + defaults)
│   │
│   ├── agent/
│   │   ├── index.ts               # createAgent() factory → ToolLoopAgent
│   │   ├── provider.ts            # createProvider() → createOpenAICompatible
│   │   ├── instructions.ts        # AUTOCORRECTIVE_SYSTEM_PROMPT
│   │   └── tools/
│   │       ├── index.ts           # buildToolSet() com lógica de aprovação
│   │       ├── write-file.ts      # writeFileSync + mkdirSync
│   │       ├── read-file.ts        # readFileSync
│   │       ├── list-files.ts       # readdirSync + statSync (recursive)
│   │       ├── delete-file.ts      # rmSync recursive
│   │       ├── run-command.ts      # execSync com timeout 30s
│   │       ├── execute-code.ts     # tmp file + execSync (node/tsx/python)
│   │       ├── search-files.ts     # execSync("grep -rn ...")
│   │       ├── web-fetch.ts        # fetch() com AbortSignal.timeout(15s)
│   │       └── install-package.ts  # npm install --prefix / pip install
│   │
│   ├── api/
│   │   ├── chat.ts                # POST / → SSE streaming (text/event-stream)
│   │   ├── models.ts              # GET / → lista modelos com cache 5min
│   │   ├── tasks.ts               # GET /, POST /, GET /:id, PATCH /:id, GET /:id/steps
│   │   ├── files.ts               # GET /, GET /content, PUT /, DELETE /
│   │   ├── config.ts              # GET /, PUT /
│   │   └── sessions.ts            # GET /, POST /, GET /:id/messages, DELETE /:id
│   │
│   ├── db/
│   │   ├── index.ts               # initDatabase() → WAL + FK + schema
│   │   ├── schema.ts              # 5 tabelas (sessions, messages, tasks, agent_steps, config)
│   │   └── repositories/
│   │       ├── tasks.ts            # CRUD + updateStatus + incrementStep
│   │       ├── messages.ts         # create + findBySession
│   │       ├── sessions.ts         # CRUD completo
│   │       └── config.ts           # Key-value com defaults + UPSERT
│   │
│   ├── services/
│   │   ├── task-manager.ts         # createTask, streamTask, cancelTask + AbortController
│   │   ├── model-resolver.ts       # Fetch /models com cache 5min + fallback hardcoded
│   │   ├── file-watcher.ts         # Chokidar watcher → socket file:changed
│   │   ├── execution-sandbox.ts    # ⚠ Código morto — nunca importado
│   │   └── approval-manager.ts     # Promise-based approval com timeout 5min
│   │
│   ├── websocket/
│   │   ├── index.ts                # setupWebSocket() → injeta IO nos services
│   │   └── events.ts               # session:join, task:subscribe, approval:respond, task:cancel
│   │
│   └── types/
│       └── index.ts                # ApprovalMode, TaskStatus, Session, Message, Task, etc.
│
├── frontend/
│   ├── index.html
│   ├── package.json                # Vite 8, React 19, TailwindCSS 4, TypeScript 6
│   ├── vite.config.ts              # Proxy /api + /socket.io → :89
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── index.css              # @import "tailwindcss"
│   │   ├── types/
│   │   │   └── index.ts            # Tipos compartilhados (duplicado do backend)
│   │   ├── components/
│   │   │   ├── Layout.tsx          # Sidebar + tabs (Chat, Tarefas, Arquivos, Config)
│   │   │   ├── ChatPanel.tsx       # SSE streaming + seletor de modelo
│   │   │   ├── MessageBubble.tsx   # Render Markdown + tool calls inline
│   │   │   ├── ToolCallDisplay.tsx # Accordion para tool inputs/outputs
│   │   │   ├── ProgressLog.tsx     # Barra de progresso (step X de maxSteps)
│   │   │   ├── TaskManager.tsx     # CRUD de tarefas + log de steps
│   │   │   ├── FileManager.tsx     # Árvore de arquivos + preview de conteúdo
│   │   │   ├── ConfigPanel.tsx     # Modelo, steps, aprovação, API URL/Key
│   │   │   ├── ApprovalDialog.tsx  # Modal de aprovação de ferramentas
│   │   │   └── Sidebar.tsx         # Navegação lateral
│   │   ├── hooks/
│   │   │   ├── useSocket.ts       # Conexão Socket.IO singleton
│   │   │   ├── useChat.ts         # SSE fetch + messages state + cancel
│   │   │   ├── useTasks.ts        # CRUD de tarefas com Socket.IO updates
│   │   │   └── useFiles.ts        # Tree + content + Socket.IO file:changed
│   │   └── lib/
│   │       ├── api.ts             # Cliente REST (fetch wrapper)
│   │       └── socket.ts          # Socket.IO client (não usado pelos componentes)
│   └── public/
│       └── favicon.svg
│
├── workspace/
│   └── .gitkeep
└── data/
    └── .gitkeep
```

## Schema SQLite (Implementado)

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'meta/llama-3.1-405b-instruct',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  step_number INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  max_steps INTEGER DEFAULT 100,
  current_step INTEGER DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  reasoning TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Config keys: `default_model`, `max_steps`, `approval_mode`, `approval_tools` (JSON array), `api_base_url`, `api_key`, `workspace_dir`

> **NOTA**: A tabela `agent_steps` está no schema mas nenhuma rota ou serviço insere dados nela. O endpoint `GET /api/tasks/:id/steps` sempre retorna array vazio.

## Dependências Instaladas

### Backend (Production)
```
@ai-sdk/openai-compatible@0.2.16
ai@6.0.208
better-sqlite3@12.11.1
chokidar@5.0.0
cors@2.8.6
dotenv@17.4.2
express@5.2.1
socket.io@4.8.3
uuid@14.0.1
zod@3.25.76
```

### Backend (Dev)
```
@types/better-sqlite3@7.6.13
@types/cors@2.8.19
@types/express@5.0.6
@types/node@26.0.0
@types/uuid@10.0.0
tsx@4.22.4
typescript@6.0.3
```

### Frontend (Dev only)
```
@tailwindcss/vite@4.3.1
@types/react@19.2.17
@types/react-dom@19.2.3
@vitejs/plugin-react@6.0.2
react@19.x
react-dom@19.x
socket.io-client@4.x
tailwindcss@4.3.1
typescript@6.0.3
vite@8.0.16
```

## Dockerfile (Implementado)

```dockerfile
FROM node:22-alpine AS builder-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:22-alpine AS builder-backend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY --from=builder-backend /app/dist ./dist
COPY --from=builder-backend /app/node_modules ./node_modules
COPY --from=builder-backend /app/package*.json ./
COPY --from=builder-frontend /app/frontend/dist ./public
RUN mkdir -p /app/workspace /app/data
EXPOSE 89
ENV PORT=89
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
```

> **BUG**: O Dockerfile copia frontend para `./public`, mas `server.ts` procura em `frontend/dist`. No container Docker, a SPA não será servida. Ver documentação para correção.

## docker-compose.yml (Implementado)

```yaml
services:
  web-agent:
    build: .
    container_name: web-agent
    ports:
      - "89:89"
    volumes:
      - ./workspace:/app/workspace
      - ./data:/app/data
    env_file: .env
    environment:
      - NODE_ENV=production
    restart: unless-stopped
```

## .env.example (Implementado)

```env
API_BASE_URL=http://192.168.3.5:11431/v1
API_KEY=your-key-here
PORT=89
WORKSPACE_DIR=./workspace
MAX_STEPS=100
DEFAULT_MODEL=meta/llama-3.1-405b-instruct
DATA_DIR=./data
```

## Scripts (package.json)

| Script | Comando | Descrição |
|--------|---------|-----------|
| `dev` | `tsx watch src/server.ts` | Backend com hot reload |
| `build` | `tsc` | Compilar TypeScript |
| `start` | `node dist/server.js` | Executar compilado |
| `build:frontend` | `cd frontend && npm run build` | Build do frontend |
| `dev:frontend` | `cd frontend && npm run dev` | Frontend dev server (porta 5173, proxy :89) |

---

## Bugs Conhecidos

### Críticos (bloqueiam funcionalidade em produção)

1. **Static file path mismatch no Docker** — `server.ts` serve de `join(process.cwd(), 'frontend', 'dist')` mas o Dockerfile copia para `./public`. No container, a SPA não carrega.
   - **Correção**: Trocar `server.ts` para servir de `./public` em produção, ou alinhar o Dockerfile.

2. **Fluxo de aprovação incompleto** — `needsApproval: true` é setado nos tool objects mas o `ToolLoopAgent` não pausa a execução para pedir aprovação. A `ApprovalManager` e o frontend dialog existem, mas não há middleware entre "tool marcada como needsApproval" e "execução efetiva da tool".
   - **Correção**: Implementar hook no pipeline do agent que chama `ApprovalManager.requestApproval()` antes de executar tools com `needsApproval`.

3. **AbortController não conectado** — Criado em `task-manager.ts` e `abort()` chamado no cancel, mas o `agent.stream()`/`agent.generate()` nunca recebe o signal. Cancelar uma tarefa não interrompe a chamada LLM em andamento.

### Médios (funcionalidade parcial)

4. **Tabela `agent_steps` nunca populada** — Schema existe, API endpoint existe, mas nenhum código insere rows. `GET /api/tasks/:id/steps` sempre retorna `[]`.
   - **Correção**: Implementar `onStepFinish` no `createAgent` que insere em `agent_steps`.

5. **`search-files.ts` usa `grep`** — Não funciona em Windows e pode ter shell injection. `execSync` interpola o pattern do usuário no comando shell com escaping insuficiente.
   - **Correção**: Usar `child_process.execFileSync('grep', [...])` ou implementar busca pura em Node.js.

6. **`run-command.ts` não captura stderr** — Sempre retorna `stderr: ''` em sucesso. `execSync` com `stdio: ['pipe','pipe','pipe']` não separa stdout/stderr no caso de sucesso.

7. **Sem proteção contra path traversal** — Todas as tools resolvem `path` com `resolve(workspaceDir, path)` mas não verificam se o resultado fica dentro do workspace. Um agente pode usar `../` para ler/escrever/deletar arquivos fora do workspace.

8. **`web-fetch.ts` ignora parâmetro `format`** — O schema declara `format` (text/html/json) mas o `execute` sempre chama `response.text()`.

### Baixos (código morto / cosmetic)

9. **`execution-sandbox.ts` é código morto** — Nenhum arquivo importa este módulo. Lógica idêntica já existe em `run-command.ts`.

10. **`lib/socket.ts` (frontend) não é usado** — Componentes usam `hooks/useSocket.ts`. `lib/socket.ts` cria uma conexão Socket.IO independente que nunca é consumida.

11. **`runTask()` (non-streaming) nunca é chamado** — Apenas `streamTask()` é usado pelo chat endpoint.

12. **`listDir()` duplicado** — A mesma função existe em `src/agent/tools/list-files.ts` e `src/api/files.ts`, não compartilhada via módulo comum.

13. **Tipos do frontend duplicados** — `frontend/src/types/index.ts` é uma cópia de `src/types/index.ts` (sem monorepo package compartilhado).

---

## Workarounds Implementados

| Problema | Solução | Local |
|----------|---------|-------|
| `@ai-sdk/openai-compatible@0.2` retorna `LanguageModelV1`, mas `ai@6` espera V2/V3 | `provider.chatModel(model) as any` | `src/agent/index.ts` |
| Express v5 usa path-to-regexp v8 | Wildcard: `'{*path}'` (não `'*'`) | `src/server.ts` |
| AI SDK v6 `tool()` usa `inputSchema` (não `parameters`) | Todos os tools usam `inputSchema` | `src/agent/tools/*.ts` |
| `@ai-sdk/openai-compatible@0.2` não aceita `apiKey` nomeado nem `includeUsage` | Headers manuais: `Authorization: Bearer`, sem `includeUsage` | `src/agent/provider.ts` |
| better-sqlite3 retorna rows sem tipo | `as any` cast em todas as queries | `src/db/repositories/*.ts` |

---

## Próximos Passos (Pós-Implementação)

1. Corrigir static file path para funcionar no Docker
2. Implementar fluxo de aprovação completo (pausar agent antes de executar tool)
3. Conectar AbortController ao agent para cancelamento real
4. Popular tabela `agent_steps` via `onStepFinish`
5. Substituir `grep` shell por busca em Node.js puro
6. Adicionar verificação de path traversal nas tools
7. Consolidar `listDir()` em módulo compartilhado
8. Remover código morto (`execution-sandbox.ts`, `lib/socket.ts`, `runTask()`)
9. Testar Docker build completo (`docker compose build && docker compose up`)
10. Testar chat SSE streaming com API LLM real
11. Adicionar validação de input (Zod) nas rotas REST
12. Considerar `@ai-sdk/openai-compatible@1.0+` quando versão estável v6-compatible for lançada
