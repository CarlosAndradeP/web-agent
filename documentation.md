# Web Agent Autônomo — Documentação Técnica

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura do Sistema](#2-arquitetura-do-sistema)
3. [Agent Engine](#3-agent-engine)
4. [Ferramentas do Agente](#4-ferramentas-do-agente)
5. [Sistema de Autocorreção](#5-sistema-de-autocorreção)
6. [APIs REST](#6-apis-rest)
7. [Comunicação Real-time (Socket.IO)](#7-comunicação-real-time-socketio)
8. [Banco de Dados (SQLite)](#8-banco-de-dados-sqlite)
9. [Frontend](#9-frontend)
10. [Configuração e Variáveis de Ambiente](#10-configuração-e-variáveis-de-ambiente)
11. [Sistema de Aprovação](#11-sistema-de-aprovação)
12. [Deployment (Docker)](#12-deployment-docker)
13. [Desenvolvimento Local](#13-desenvolvimento-local)
14. [Bugs Conhecidos e Pendências](#14-bugs-conhecidos-e-pendências)
15. [Workarounds e Decisões Técnicas](#15-workarounds-e-decisões-técnicas)

---

## 1. Visão Geral

O **Web Agent Autônomo** é uma aplicação full-stack que permite a um usuário interagir com um agente de IA autônomo através de um painel web. O agente utiliza o Vercel AI SDK v6 (`ToolLoopAgent`) para executar um loop de raciocínio + ação, onde:

1. O modelo LLM decide qual ferramenta usar
2. A ferramenta é executada
3. O resultado é enviado de volta ao modelo
4. O modelo decide a próxima ação (ou conclui)

Este ciclo se repete até que a tarefa seja completada ou o limite de steps seja atingido. O agente se autocorrige em caso de erros, possibilitando completar tarefas complexas sem intervenção humana.

### Características Principais

- **Autonomia**: O agente trabalha sozinho até concluir a tarefa
- **Autocorreção**: Analisa erros, corrige e tenta novamente
- **Streaming em tempo real**: Progresso visualizado instantaneamente no painel via SSE
- **9 ferramentas**: Execução de código, manipulação de arquivos, comandos shell, etc.
- **Aprovação customizável**: Controle fino sobre quais ferramentas requerem aprovação (UI pronta, fluxo de pausa pendente)
- **Persistência**: SQLite (WAL mode) para tarefas, histórico e configurações
- **Multi-modelo**: Seleção de qualquer modelo disponível na API NVIDIA NIMS

### Stack Instalada

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Agent Framework | Vercel AI SDK v6 | `ai@6.0.208` |
| API Provider | `@ai-sdk/openai-compatible` | `0.2.16` |
| Backend | Express.js v5 + TypeScript 6 | `express@5.2.1` |
| Frontend | React 19 + Vite 8 + TailwindCSS 4 | `vite@8.0.16` |
| Real-time | Socket.IO | `socket.io@4.8.3` |
| Persistência | better-sqlite3 | `12.11.1` |
| Runtime | Node.js 22 Alpine | — |

---

## 2. Arquitetura do Sistema

### Componentes

```
┌─────────────────────────────────────────┐
│           Browser (Frontend)             │
│  React 19 + Vite 8 + TailwindCSS 4       │
│  - ChatPanel (SSE streaming)             │
│  - TaskManager                           │
│  - FileManager                           │
│  - ConfigPanel                           │
│  - Socket.IO client (hooks/useSocket)   │
└──────────┬──────────────┬───────────────┘
           │              │
     HTTP/SSE          WebSocket
           │              │
┌──────────▼──────────────▼───────────────┐
│        Express Server (Port 89)          │
│                                          │
│  ┌─────────────┐  ┌──────────────────┐   │
│  │  REST APIs  │  │   Socket.IO      │   │
│  │  /api/*     │  │   events          │   │
│  └──────┬──────┘  └────────┬─────────┘   │
│         │                  │             │
│  ┌──────▼──────────────────▼──────────┐  │
│  │         Services Layer             │  │
│  │  - TaskManager (streamTask)          │  │
│  │  - ApprovalManager                  │  │
│  │  - ModelResolver (cache 5min)       │  │
│  │  - FileWatcher (chokidar)           │  │
│  └──────────────┬──────────────────────┘  │
│                  │                        │
│  ┌──────────────▼──────────────────────┐  │
│  │         Agent Engine                │  │
│  │  ToolLoopAgent (ai@6.0.208)        │  │
│  │  - 9 tools (inputSchema)           │  │
│  │  - Auto-corrective instructions    │  │
│  │  - stopWhen: stepCountIs(maxSteps) │  │
│  │  - maxOutputTokens: 4096           │  │
│  │  - model: provider.chatModel() as any │
│  └──────────────┬──────────────────────┘  │
│                  │                        │
│  ┌──────────────▼──────────────────────┐  │
│  │  @ai-sdk/openai-compatible@0.2.16  │  │
│  │  baseURL: configurável              │  │
│  │  headers: Authorization: Bearer     │  │
│  └──────────────┬──────────────────────┘  │
│                  │                        │
│  ┌──────────────▼──┐  ┌────────────────┐  │
│  │  SQLite (WAL)   │  │  Workspace     │  │
│  │  better-sqlite3  │  │  ./workspace   │  │
│  └─────────────────┘  └────────────────┘  │
└──────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│   NVIDIA NIMS API                        │
│   http://192.168.3.5:11431/v1           │
│   (OpenAI-compatible mirror)             │
└──────────────────────────────────────────┘
```

### Fluxo de Dados

```
User Input → POST /api/chat → TaskManager.createTask()
  → TaskManager.streamTask()
    → ToolLoopAgent.stream()
      → LLM Call (NVIDIA NIMS API)
        → Tool Call Decision
          → Tool Execution (execSync/readFileSync/writeFileSync no workspace)
            → Result back to LLM
              → Repeat until done ou stepCountIs(maxSteps)
    → SSE text/event-stream → Frontend ChatPanel
    → Socket.IO → Task progress + file changes + approvals
```

---

## 3. Agent Engine

### ToolLoopAgent (Vercel AI SDK v6)

O agente é criado via `createAgent()` em `src/agent/index.ts`:

```typescript
import { ToolLoopAgent, stepCountIs } from 'ai';

export interface CreateAgentOptions {
  model: string;
  maxSteps: number;
  sessionId: string;
  workspaceDir: string;
  approvalMode: ApprovalMode;
  approvalTools: string[];
  apiBaseUrl: string;
  apiKey: string;
  onStep?: (step: AgentStep) => void;  // Aceito mas não conectado ao agent
}

export function createAgent(options: CreateAgentOptions) {
  const provider = createProvider(options.apiBaseUrl, options.apiKey);
  const tools = buildToolSet({
    workspaceDir: options.workspaceDir,
    approvalMode: options.approvalMode,
    approvalTools: options.approvalTools,
  });

  const agent = new ToolLoopAgent({
    model: provider.chatModel(options.model) as any,  // Type mismatch workaround
    instructions: AUTOCORRECTIVE_SYSTEM_PROMPT,
    tools,
    stopWhen: stepCountIs(options.maxSteps),
    maxOutputTokens: 4096,
  });

  return agent;
}
```

### Provider

`src/agent/provider.ts` — Provider OpenAI-compatible customizado:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export function createProvider(apiBaseUrl: string, apiKey: string) {
  return createOpenAICompatible({
    name: 'nvidia-nims',
    baseURL: apiBaseUrl,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}
```

**Notas:**
- NÃO usa `apiKey` nomeado (não suportado pelo `@ai-sdk/openai-compatible@0.2`)
- NÃO usa `includeUsage` (não suportado pelo `@ai-sdk/openai-compatible@0.2`)
- Headers `Authorization` injetados manualmente, apenas se `apiKey` é truthy
- `provider.chatModel(modelId)` retorna `LanguageModelV1`, mas `ToolLoopAgent` espera `LanguageModelV2/V3` — daí o `as any`

### Streaming

`TaskManager.streamTask()` retorna `AsyncIterable<string>` via `agent.stream().textStream`:

```typescript
async *streamTask(taskId: string): AsyncIterable<string> {
  const task = this.tasksRepo.findById(taskId);
  const agent = createAgent({ ... });

  this.controllers.set(taskId, new AbortController());

  try {
    const result = agent.stream("");  // TODO: passar mensagens reais
    for await (const textPart of result.textStream) {
      yield textPart;
    }
  } catch (err) {
    // Marcar task como failed
  }
}
```

> **NOTA**: O `AbortController` é criado e armazenado mas o signal não é passado ao agent, portanto cancelar uma tarefa não aborta a chamada LLM em andamento.

---

## 4. Ferramentas do Agente

Todas as ferramentas usam a API `tool()` do AI SDK v6 com `inputSchema` (não `parameters`):

### 4.1 writeFile

```typescript
// src/agent/tools/write-file.ts
tool({
  description: 'Create or overwrite a file in the workspace',
  inputSchema: z.object({
    path: z.string().describe('Relative path within workspace'),
    content: z.string().describe('File content to write'),
  }),
  execute: async ({ path, content }) => {
    const fullPath = resolve(workspaceDir, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return { success: true, path };
  },
})
```

### 4.2 readFile

```typescript
// src/agent/tools/read-file.ts
tool({
  description: 'Read the contents of a file from the workspace',
  inputSchema: z.object({
    path: z.string().describe('Relative path within workspace'),
  }),
  execute: async ({ path }) => {
    const fullPath = resolve(workspaceDir, path);
    const content = readFileSync(fullPath, 'utf-8');
    return { content, path };
  },
})
```

### 4.3 listFiles

```typescript
// src/agent/tools/list-files.ts
tool({
  description: 'List files and directories in the workspace',
  inputSchema: z.object({
    path: z.string().optional().describe('Directory path (default: workspace root)'),
    recursive: z.boolean().optional().describe('List recursively (default: false)'),
  }),
  execute: async ({ path = '.', recursive = false }) => {
    const fullPath = resolve(workspaceDir, path);
    return listDir(fullPath, recursive);  // Função helper local
  },
})
```

> **NOTA**: A função `listDir()` está duplicada em `src/api/files.ts`. Deveria ser módulo compartilhado.

### 4.4 deleteFile

```typescript
// src/agent/tools/delete-file.ts
tool({
  description: 'Delete a file or directory from the workspace',
  inputSchema: z.object({
    path: z.string().describe('Relative path within workspace'),
  }),
  execute: async ({ path }) => {
    const fullPath = resolve(workspaceDir, path);
    rmSync(fullPath, { recursive: true, force: true });
    return { success: true, path };
  },
})
```

### 4.5 runCommand

```typescript
// src/agent/tools/run-command.ts
tool({
  description: 'Execute a shell command in the workspace directory',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
  }),
  execute: async ({ command, timeout = 30 }) => {
    const result = execSync(command, {
      cwd: workspaceDir,
      timeout: timeout * 1000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: result, stderr: '', exitCode: 0 };  // BUG: stderr sempre vazio em sucesso
  },
})
```

### 4.6 executeCode

```typescript
// src/agent/tools/execute-code.ts
tool({
  description: 'Execute JavaScript/TypeScript/Python code and return the result',
  inputSchema: z.object({
    code: z.string().describe('Code to execute'),
    language: z.enum(['javascript', 'typescript', 'python']),
    timeout: z.number().optional().describe('Timeout in seconds (default: 30)'),
  }),
  execute: async ({ code, language, timeout = 30 }) => {
    // Cria .tmp-exec/ no workspace
    // Escreve código em temp file
    // Executa: node / npx tsx / python
    // Remove temp file em finally
    // Retorna { stdout, stderr, exitCode }
  },
})
```

### 4.7 searchFiles

```typescript
// src/agent/tools/search-files.ts
tool({
  description: 'Search for patterns in files within the workspace',
  inputSchema: z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('Directory to search in'),
    include: z.string().optional().describe('File pattern to include (e.g., "*.ts")'),
  }),
  execute: async ({ pattern, path = '.', include }) => {
    // Executa: grep -rn --include -E <pattern> <path> || true
    // Limita a 100 resultados, timeout 15s
    // ⚠ Não funciona em Windows (sem grep)
    // ⚠ Shell injection: pattern interpolado sem sanitização completa
  },
})
```

### 4.8 webFetch

```typescript
// src/agent/tools/web-fetch.ts
tool({
  description: 'Fetch content from a URL via HTTP GET',
  inputSchema: z.object({
    url: z.string().describe('URL to fetch'),
    format: z.enum(['text', 'html', 'json']).optional(),  // ⚠ Declarado mas ignorado
  }),
  execute: async ({ url, format = 'text' }) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const content = await response.text();  // Sempre text(), ignora format
    return {
      content: content.slice(0, 50000),
      status: response.status,
      truncated: content.length > 50000,
    };
  },
})
```

### 4.9 installPackage

```typescript
// src/agent/tools/install-package.ts
tool({
  description: 'Install an npm or pip package in the workspace',
  inputSchema: z.object({
    package: z.string().describe('Package name'),
    manager: z.enum(['npm', 'pip']).describe('Package manager'),
  }),
  execute: async ({ package: pkg, manager }) => {
    const command = manager === 'npm'
      ? `npm install --prefix "${workspaceDir}" ${pkg}`  // ⚠ --prefix cria node_modules aninhado
      : `pip install ${pkg}`;
    const result = execSync(command, { timeout: 60000, encoding: 'utf-8' });
    return { success: true };
  },
})
```

### Registro Central de Tools

`src/agent/tools/index.ts` — `buildToolSet()` agrega todas as tools com lógica de aprovação:

```typescript
export function buildToolSet(options: {
  workspaceDir: string;
  approvalMode: ApprovalMode;
  approvalTools: string[];
}): Record<string, any> {
  const allTools = {
    writeFile: createWriteFileTool(options.workspaceDir),
    readFile: createReadFileTool(options.workspaceDir),
    listFiles: createListFilesTool(options.workspaceDir),
    deleteFile: createDeleteFileTool(options.workspaceDir),
    runCommand: createRunCommandTool(options.workspaceDir),
    executeCode: createExecuteCodeTool(options.workspaceDir),
    searchFiles: createSearchFilesTool(options.workspaceDir),
    webFetch: createWebFetchTool(),
    installPackage: createInstallPackageTool(options.workspaceDir),
  };

  if (options.approvalMode === 'none') return allTools;

  if (options.approvalMode === 'all') {
    for (const key of Object.keys(allTools)) {
      allTools[key] = { ...allTools[key], needsApproval: true };
    }
    return allTools;
  }

  // custom: apenas as listadas
  for (const toolName of options.approvalTools) {
    if (allTools[toolName]) {
      allTools[toolName] = { ...allTools[toolName], needsApproval: true };
    }
  }
  return allTools;
}
```

> **NOTA IMPORTANTE**: O `needsApproval` é spread no objeto da tool, mas o `ToolLoopAgent` do AI SDK não reconhece esta propriedade nativamente. Tools marcadas com `needsApproval: true` executam imediatamente sem pedir aprovação. O fluxo completo de aprovação está descrito na seção 11.

---

## 5. Sistema de Autocorreção

### System Prompt

O system prompt em `src/agent/instructions.ts` instrui o agente a ser persistente e autocorretivo:

```
You are an autonomous development agent. Your mission is to complete tasks
fully and impeccably. Follow these rules:

BEHAVIOR RULES:
1. NEVER give up on a task. If something fails, analyze the error, fix it,
   and try again.
2. ALWAYS verify your work. After creating or modifying code, test it.
3. If a test fails, read the error, fix the code, and re-run the test.
   Repeat until all tests pass.
4. If you encounter a permission error, try an alternative approach.
5. If a package is not found, install it first.
6. Before writing code, ALWAYS read existing files to understand the
   codebase and follow existing patterns.
7. After creating files, verify they exist and contain the expected content.
8. Communicate your progress clearly: what you're doing, what worked,
   what failed, and what you're trying next.

WORKFLOW:
1. ANALYZE: Read the task description. Break it into sub-tasks.
2. PLAN: Identify what files need to be created/modified.
3. EXECUTE: Create/modify files one at a time.
4. VERIFY: Run the code. Check for errors.
5. FIX: If errors, read the error message, fix the code, re-run.
6. COMPLETE: Only declare done when everything works.

CONSTRAINTS:
- All file paths are relative to the workspace directory.
- Use the tools available. Do not ask the user to do things manually.
- If you need information, use the search and read tools.
- Keep your responses concise. Show progress, not verbosity.
- Maximum autonomy: solve problems yourself.
```

### Ciclo de Autocorreção

```
Step N:   Agent calls runCommand("npm test")
Step N+1: Tool retorna { exitCode: 1, stderr: "TypeError: ..." }
Step N+2: Agent lê o arquivo com erro (readFile)
Step N+3: Agent identifica o bug e corrige (writeFile)
Step N+4: Agent re-roda os testes (runCommand("npm test"))
Step N+5: Tool retorna { exitCode: 0, stdout: "All tests passed" }
Step N+6: Agent reporta conclusão
```

### Contexto — Prevenção de Estouro

O `createAgent` aceita `maxSteps` que é passado como `stopWhen: stepCountIs(maxSteps)`. O `maxOutputTokens` é fixado em 4096. O `prepareStep` para compressão de mensagens antigas está previsto mas **ainda não implementado** no `createAgent`.

---

## 6. APIs REST

Todas as rotas usam factory pattern: `createXxxRouter(db, ...service)` para injeção de dependências.

### 6.1 POST /api/chat

Inicia ou continua uma conversa com o agente. Retorna SSE stream.

**Request:**
```json
{
  "sessionId": "uuid (opcional — auto-resolvido se omitido)",
  "model": "meta/llama-3.1-405b-instruct",
  "messages": [
    { "role": "user", "content": "Crie um servidor Express simples" }
  ],
  "maxSteps": 100
}
```

**Response:** `text/event-stream` com eventos:
- `task-start` — `{ taskId }`
- `text-delta` — Texto incremental da resposta
- `finish` — Tarefa completa
- `error` — Erro com mensagem

**Implementação** (`src/api/chat.ts`):
- Auto-resolve sessionId do BD se não fornecido
- Cria task via `taskManager.createTask()`
- Itera sobre `taskManager.streamTask()` e escreve SSE chunks
- Em caso de erro, emite evento `error` e marca task como `failed`

### 6.2 GET /api/models

Lista modelos disponíveis na API.

**Response:**
```json
{
  "models": [
    { "id": "meta/llama-3.1-405b-instruct", "name": "Llama 3.1 405B" }
  ]
}
```

**Cache:** 5 minutos via `ModelResolver`. Fallback para `meta/llama-3.1-405b-instruct` em caso de erro.

### 6.3 GET /api/tasks

Lista todas as tarefas.

**Response:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "sessionId": "uuid",
      "description": "Crie um servidor Express",
      "status": "completed",
      "model": "meta/llama-3.1-405b-instruct",
      "maxSteps": 100,
      "currentStep": 23,
      "result": "Servidor criado em workspace/server.js",
      "error": null,
      "createdAt": "2026-06-21T10:00:00Z",
      "updatedAt": "2026-06-21T10:05:00Z"
    }
  ]
}
```

### 6.4 POST /api/tasks

Cria uma nova tarefa. Auto-associa à primeira sessão existente se `sessionId` omitido.

**Request:**
```json
{
  "description": "Crie um servidor Express simples",
  "sessionId": "uuid (opcional)",
  "model": "meta/llama-3.1-405b-instruct",
  "maxSteps": 100
}
```

### 6.5 GET /api/tasks/:id

Busca tarefa por ID.

### 6.6 PATCH /api/tasks/:id

Atualiza tarefa. Usado para cancelar: `{ "status": "cancelled" }`.

### 6.7 GET /api/tasks/:id/steps

Lista steps do agente para uma tarefa.

> **NOTA**: Atualmente retorna `[]` pois a tabela `agent_steps` nunca é populada.

### 6.8 GET /api/files

Lista árvore de arquivos do workspace.

**Query params:** `?path=.&recursive=true`

**Response:**
```json
{
  "tree": [
    { "name": "server.js", "type": "file", "size": 1234 },
    { "name": "src", "type": "directory", "children": [...] }
  ]
}
```

### 6.9 GET /api/files/content

Lê conteúdo de um arquivo do workspace.

**Query params:** `?path=server.js`

**Response:**
```json
{ "path": "server.js", "content": "const express = require('express');..." }
```

### 6.10 PUT /api/files

Cria ou sobrescreve um arquivo no workspace.

**Request:**
```json
{ "path": "test.txt", "content": "hello world" }
```

### 6.11 DELETE /api/files

Deleta um arquivo ou diretório.

**Query params:** `?path=old-file.js`

### 6.12 GET /api/config

Retorna todas as configurações atuais (merge de SQLite + .env defaults).

**Response:**
```json
{
  "defaultModel": "meta/llama-3.1-405b-instruct",
  "maxSteps": 100,
  "approvalMode": "custom",
  "approvalTools": ["runCommand", "deleteFile", "installPackage", "executeCode"],
  "apiBaseUrl": "http://192.168.3.5:11431/v1",
  "apiKey": "test",
  "workspaceDir": "./workspace"
}
```

### 6.13 PUT /api/config

Atualiza configurações. Usa UPSERT no SQLite.

**Request:**
```json
{
  "maxSteps": 50,
  "approvalMode": "none"
}
```

### 6.14 GET /api/sessions

Lista sessões de chat.

### 6.15 POST /api/sessions

Cria nova sessão.

**Request:**
```json
{ "name": "Meu Projeto", "model": "meta/llama-3.1-405b-instruct" }
```

### 6.16 GET /api/sessions/:id/messages

Lista mensagens de uma sessão.

### 6.17 DELETE /api/sessions/:id

Deleta sessão (cascade: mensagens, tarefas, steps).

---

## 7. Comunicação Real-time (Socket.IO)

### Eventos Server → Client

| Evento | Dados | Descrição |
|--------|-------|-----------|
| `task:created` | `{ task }` | Nova tarefa criada |
| `task:step` | `{ taskId, step }` | Step do agente finalizado |
| `task:progress` | `{ taskId, currentStep, maxSteps }` | Atualização de progresso |
| `task:completed` | `{ taskId, result }` | Tarefa concluída com sucesso |
| `task:failed` | `{ taskId, error }` | Tarefa falhou |
| `task:cancelled` | `{ taskId }` | Tarefa cancelada |
| `file:changed` | `{ path, type }` | Arquivo no workspace modificado (`create`/`modify`/`delete`) |
| `approval:request` | `{ id, taskName, toolName, toolInput }` | Solicitação de aprovação |

### Eventos Client → Server

| Evento | Dados | Descrição |
|--------|-------|-----------|
| `session:join` | `{ sessionId }` | Entrar na room da sessão |
| `task:subscribe` | `{ taskId }` | Receber updates de uma tarefa |
| `approval:respond` | `{ id, approved: boolean }` | Responder a uma solicitação de aprovação |
| `task:cancel` | `{ taskId }` | Cancelar tarefa em execução |

### Rooms

Cada sessão tem uma room Socket.IO: `session:{sessionId}`. Clientes fazem join ao conectar.

### Configuração

```typescript
// src/websocket/index.ts
const io = new SocketServer(httpServer, {
  cors: { origin: '*' }  // CORS aberto
});

// Injeta instância IO nos services
approvalManager.setIO(io);
taskManager.setIO(io);
```

### Event Handlers

`src/websocket/events.ts` registra 4 handlers na conexão:
- `session:join` → `socket.join(session:${sessionId})`
- `task:subscribe` → `socket.join(task:${taskId})`
- `approval:respond` → `approvalManager.respond(id, approved)`
- `task:cancel` → `taskManager.cancelTask(taskId)`

---

## 8. Banco de Dados (SQLite)

### Localização

- Desenvolvimento: `./data/web-agent.db`
- Produção (Docker): `/app/data/web-agent.db`

### Inicialização

```typescript
// src/db/index.ts
import Database from 'better-sqlite3';

export function initDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}
```

### Repositories

Todos usam o padrão:
- Classe com `db` no construtor
- Queries com `this.db.prepare()` + `.bind()` + `.get()`/`.all()`/`.run()`
- Cast `as any` nas rows (better-sqlite3 não tipa resultados)
- Mapeamento manual de snake_case → camelCase

```typescript
// Exemplo: src/db/repositories/tasks.ts
export class TasksRepository {
  constructor(private db: Database.Database) {}

  create(sessionId: string, description: string, model: string | null, maxSteps: number): Task {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO tasks (id, session_id, description, status, model, max_steps)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, sessionId, description, model, maxSteps);
    return this.findById(id)!;
  }

  findById(id: string): Task | undefined { ... }
  findBySession(sessionId: string): Task[] { ... }
  list(): Task[] { ... }
  updateStatus(id: string, status: TaskStatus, result?: string, error?: string): void { ... }
  incrementStep(id: string): void { ... }
}
```

### Tabelas

#### sessions
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| name | TEXT | Nome da sessão |
| model | TEXT | Modelo selecionado (default: `meta/llama-3.1-405b-instruct`) |
| created_at | DATETIME | Data de criação |
| updated_at | DATETIME | Última atualização |

#### messages
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| session_id | TEXT FK | Referência à sessão (ON DELETE CASCADE) |
| role | TEXT | user/assistant/system/tool |
| content | TEXT | Conteúdo da mensagem |
| tool_calls | TEXT | JSON array de tool calls |
| tool_call_id | TEXT | ID do tool call (para resultados) |
| step_number | INTEGER | Step do agente |
| created_at | DATETIME | Timestamp |

#### tasks
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| session_id | TEXT FK | Referência à sessão (ON DELETE CASCADE) |
| description | TEXT | Descrição da tarefa |
| status | TEXT | pending/running/completed/failed/cancelled |
| model | TEXT | Modelo utilizado |
| max_steps | INTEGER | Limite de steps (default: 100) |
| current_step | INTEGER | Step atual |
| result | TEXT | Resultado final |
| error | TEXT | Mensagem de erro |
| created_at | DATETIME | Data de criação |
| updated_at | DATETIME | Última atualização |

#### agent_steps
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | TEXT PK | UUID |
| task_id | TEXT FK | Referência à tarefa (ON DELETE CASCADE) |
| step_number | INTEGER | Número do step |
| tool_name | TEXT | Nome da ferramenta |
| tool_input | TEXT | JSON com input |
| tool_output | TEXT | JSON com output |
| reasoning | TEXT | Raciocínio do modelo |
| duration_ms | INTEGER | Duração em ms |
| status | TEXT | success/error/needs_approval |
| created_at | DATETIME | Timestamp |

> **ATENÇÃO**: Esta tabela **nunca é populada** pelo código atual. Nenhum service ou rota insere rows em `agent_steps`.

#### config
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| key | TEXT PK | Nome da configuração |
| value | TEXT | Valor (string/JSON) |
| updated_at | DATETIME | Última atualização |

---

## 9. Frontend

### Layout

```
┌──────────┬────────────────────────────────────────┐
│          │  [Chat] [Tarefas] [Arquivos] [Config]  │
│ Sidebar  ├────────────────────────────────────────┤
│          │                                        │
│ ○ Chat   │   Content area based on active tab     │
│ ○ Tasks  │                                        │
│ ○ Files  │                                        │
│ ○ Config │                                        │
│          │                                        │
│ ─────── │────────────────────────────────────────│
│ Status   │  Progress bar (when agent running)     │
└──────────┴────────────────────────────────────────┘
```

### Componentes

| Componente | Arquivo | Funcionalidade |
|-----------|---------|---------------|
| Layout | `Layout.tsx` | Sidebar + tabs + roteamento |
| Sidebar | `Sidebar.tsx` | Navegação lateral com ícones |
| ChatPanel | `ChatPanel.tsx` | SSE streaming + seletor de modelo + multiline input |
| MessageBubble | `MessageBubble.tsx` | Render Markdown + tool calls inline |
| ToolCallDisplay | `ToolCallDisplay.tsx` | Accordion para tool inputs/outputs |
| ProgressLog | `ProgressLog.tsx` | Barra de progresso (step X de maxSteps) |
| TaskManager | `TaskManager.tsx` | CRUD de tarefas + log de steps + cancelar |
| FileManager | `FileManager.tsx` | Árvore de arquivos + preview de conteúdo |
| ConfigPanel | `ConfigPanel.tsx` | Modelo, steps, aprovação, API URL/Key |
| ApprovalDialog | `ApprovalDialog.tsx` | Modal de aprovação de ferramentas |

### Hooks

| Hook | Arquivo | Funcionalidade |
|------|---------|---------------|
| `useSocket` | `hooks/useSocket.ts` | Singleton Socket.IO connection |
| `useChat` | `hooks/useChat.ts` | SSE fetch + messages state + cancel + streaming flag |
| `useTasks` | `hooks/useTasks.ts` | CRUD de tarefas + Socket.IO updates |
| `useFiles` | `hooks/useFiles.ts` | Tree + content + Socket.IO `file:changed` |

### Libs

| Lib | Arquivo | Uso |
|-----|---------|-----|
| `api.ts` | `lib/api.ts` | Cliente REST (fetch wrapper com métodos GET/POST/PUT/PATCH/DELETE) |
| `socket.ts` | `lib/socket.ts` | **Não usado** — componentes usam `hooks/useSocket.ts` |

### Proxy de Desenvolvimento

`frontend/vite.config.ts` configura proxy para não ter CORS em dev:

```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:89',
      '/socket.io': {
        target: 'http://localhost:89',
        ws: true,
      },
    },
  },
});
```

---

## 10. Configuração e Variáveis de Ambiente

### .env

| Variável | Default | Descrição |
|----------|---------|-----------|
| `API_BASE_URL` | `http://192.168.3.5:11431/v1` | URL base da API LLM (NVIDIA NIMS) |
| `API_KEY` | — | Chave de API (opcional para endpoints locais) |
| `PORT` | `89` | Porta do servidor |
| `WORKSPACE_DIR` | `./workspace` | Diretório de trabalho do agente |
| `MAX_STEPS` | `100` | Limite máximo de steps do agente |
| `DEFAULT_MODEL` | `meta/llama-3.1-405b-instruct` | Modelo padrão |
| `DATA_DIR` | `./data` | Diretório do banco SQLite |

### Configurações Dinâmicas (SQLite)

Além das variáveis de ambiente, configurações podem ser alteradas em runtime via painel web e persistidas no SQLite:

| Chave | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `default_model` | string | (do .env) | Modelo padrão |
| `max_steps` | number | (do .env) | Limite de steps |
| `approval_mode` | enum | `custom` | none/all/custom |
| `approval_tools` | JSON | `["runCommand","deleteFile","installPackage","executeCode"]` | Tools que requerem aprovação |
| `api_base_url` | string | (do .env) | URL base da API |
| `api_key` | string | (do .env) | Chave de API |
| `workspace_dir` | string | (do .env) | Diretório workspace |

Valores no SQLite sempre têm precedência sobre .env. Se não existe no SQLite, usa default do .env.

### ConfigRepository

Usa `UPSERT` (`ON CONFLICT(key) DO UPDATE`) para persistir mudanças:

```typescript
set(key: string, value: string): void {
  this.db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}
```

---

## 11. Sistema de Aprovação

### Status Atual

O sistema de aprovação está **parcialmente implementado**:
- ✅ Frontend: `ApprovalDialog` modal com botões Aprovar/Rejeitar
- ✅ WebSocket: Eventos `approval:request` e `approval:respond` registrados
- ✅ Backend: `ApprovalManager` com Promise-based approval e timeout 5min
- ✅ Configuração: Modos none/all/custom via painel web
- ❌ **GAP**: O `needsApproval` é setado nos tool objects mas o `ToolLoopAgent` executa a tool sem pausar para aprovação

### Modos

| Modo | Comportamento |
|------|--------------|
| `none` | Nenhuma ferramenta requer aprovação. Agente 100% autônomo. |
| `all` | Todas as ferramentas com `needsApproval: true` (mas não pausa). |
| `custom` | Apenas ferramentas listadas em `approval_tools` (mas não pausa). |

### Fluxo Desejado (Pendente Implementação)

```
1. Agent decide chamar ferramenta (ex: runCommand)
2. Se needsApproval=true:
   a. Pausar execução do agente
   b. Criar entrada no ApprovalManager
   c. Emitir 'approval:request' via Socket.IO
   d. Frontend exibe ApprovalDialog modal
3. Usuário clica "Aprovar" ou "Rejeitar" no modal
4. Frontend emite 'approval:respond' via Socket.IO
5. ApprovalManager resolve/rejeita a Promise pendente
6. Se aprovado: ferramenta executa normalmente
7. Se rejeitado: agente recebe feedback e tenta abordagem alternativa
8. Se timeout (5min): rejeita automaticamente
```

### ApprovalManager (Implementado)

```typescript
export class ApprovalManager {
  private pending = new Map<string, {
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
  }>();
  private io!: SocketServer;

  setIO(io: SocketServer): void { this.io = io; }

  requestApproval(id: string, toolName: string, toolInput: any): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 300000); // 5min timeout
      this.pending.set(id, { resolve, timeout });
      this.io.emit('approval:request', { id, toolName, toolInput });
    });
  }

  respond(id: string, approved: boolean): void {
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timeout);
      entry.resolve(approved);
      this.pending.delete(id);
    }
  }
}
```

---

## 12. Deployment (Docker)

### Multi-stage Build

O Dockerfile usa 3 stages:

1. **builder-frontend** (`node:22-alpine`): Build do React com Vite → `frontend/dist/`
2. **builder-backend** (`node:22-alpine`): Compilação TypeScript → `dist/`
3. **runtime** (`node:22-alpine`): Apenas artefatos finais + node_modules

### Dockerfile Atual

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

### docker-compose.yml Atual

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

### Volumes

| Volume | Container Path | Propósito |
|--------|---------------|-----------|
| `./workspace` | `/app/workspace` | Arquivos criados pelo agente |
| `./data` | `/app/data` | Banco SQLite |

### ⚠ BUG: Path Mismatch

O Dockerfile copia frontend para `./public` mas `src/server.ts` procura em `join(process.cwd(), 'frontend', 'dist')`:

```typescript
// server.ts (atual)
const publicDir = join(process.cwd(), 'frontend', 'dist');
```

No container Docker, o cwd é `/app`, então procura `/app/frontend/dist` que não existe — os arquivos estão em `/app/public`.

**Correção proposta:**
```typescript
const publicDir = existsSync(join(process.cwd(), 'public'))
  ? join(process.cwd(), 'public')
  : join(process.cwd(), 'frontend', 'dist');
```

---

## 13. Desenvolvimento Local

### Requisitos

- Node.js 22+
- npm

### Setup

```bash
# Instalar dependências do backend
npm install

# Instalar dependências do frontend
cd frontend && npm install && cd ..

# Copiar .env
cp .env.example .env
# Editar .env com API_KEY real
```

### Execução

```bash
# Terminal 1: Backend (porta 89)
npm run dev
# Equivalente a: tsx watch src/server.ts

# Terminal 2: Frontend (porta 5173, proxy para :89)
npm run dev:frontend
# Equivalente a: cd frontend && npm run dev
```

Acesse `http://localhost:5173` em dev (Vite proxy) ou `http://localhost:89` em produção.

### Build

```bash
# Compilar backend
npm run build

# Compilar frontend
npm run build:frontend

# Docker (produção)
docker compose build
docker compose up -d
```

### Teste Manual (curl)

```bash
# Listar modelos
curl http://localhost:89/api/models

# Chat com agente (SSE stream)
curl -N -X POST http://localhost:89/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"meta/llama-3.1-405b-instruct","messages":[{"role":"user","content":"Crie um arquivo hello.txt"}]}'

# Listar tarefas
curl http://localhost:89/api/tasks

# Criar tarefa
curl -X POST http://localhost:89/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"description":"Crie um arquivo hello.txt"}'

# Listar arquivos do workspace
curl "http://localhost:89/api/files?recursive=true"

# Ver configurações
curl http://localhost:89/api/config

# Atualizar configurações
curl -X PUT http://localhost:89/api/config \
  -H "Content-Type: application/json" \
  -d '{"maxSteps":50,"approvalMode":"none"}'
```

### Verificação de Tipos

```bash
npx tsc --noEmit  # Zero erros (verificado)
```

---

## 14. Bugs Conhecidos e Pendências

### Críticos (bloqueiam funcionalidade)

| # | Bug | Impacto | Local |
|---|-----|---------|-------|
| 1 | Static file path mismatch no Docker | SPA não carrega no container | `server.ts:55` vs `Dockerfile:14` |
| 2 | Fluxo de aprovação não pausa execução | Tools com `needsApproval` executam sem aprovação | `src/agent/tools/index.ts` |
| 3 | AbortController não conectado ao agent | Cancelar tarefa não aborta chamada LLM | `src/services/task-manager.ts` |

### Médios (funcionalidade parcial)

| # | Bug | Impacto | Local |
|---|-----|---------|-------|
| 4 | Tabela `agent_steps` nunca populada | Endpoint `/tasks/:id/steps` sempre retorna `[]` | Todos os services |
| 5 | `search-files.ts` usa `grep` shell | Não funciona em Windows; shell injection | `src/agent/tools/search-files.ts` |
| 6 | `run-command.ts` stderr sempre vazio | Em sucesso, stderr não é capturado | `src/agent/tools/run-command.ts` |
| 7 | Sem proteção contra path traversal | Agente pode acessar arquivos fora do workspace | Todas as tools com `path` |
| 8 | `web-fetch.ts` ignora `format` | Parâmetro declarado mas não usado | `src/agent/tools/web-fetch.ts` |

### Baixos (código morto / cosmetic)

| # | Bug | Impacto | Local |
|---|-----|---------|-------|
| 9 | `execution-sandbox.ts` nunca importado | Código morto | `src/services/execution-sandbox.ts` |
| 10 | `lib/socket.ts` não usado pelos componentes | Conexão Socket.IO órfã | `frontend/src/lib/socket.ts` |
| 11 | `runTask()` (non-streaming) nunca é chamado | Método morto | `src/services/task-manager.ts` |
| 12 | `listDir()` duplicado | DRY violation | `list-files.ts` + `files.ts` |
| 13 | Tipos do frontend duplicados | Manutenção dupla | `frontend/src/types/index.ts` |
| 14 | `onStep` aceito mas não conectado | Dead parameter | `src/agent/index.ts` |
| 15 | `npm install --prefix` comportamento incorreto | Cria node_modules aninhado | `install-package.ts` |

---

## 15. Workarounds e Decisões Técnicas

### Type Mismatch: Provider ↔ Agent

`@ai-sdk/openai-compatible@0.2.16` retorna `LanguageModelV1` mas `ai@6.0.208` (`ToolLoopAgent`) espera `LanguageModelV2/V3`:

```typescript
// src/agent/index.ts
model: provider.chatModel(options.model) as any
```

**Motivo**: `@ai-sdk/openai-compatible@0.2.x` ainda está no provider V1. Quando versão 1.0+ for lançada com suporte V2/V3, o cast pode ser removido.

### Express v5: Wildcard Routes

Express v5 usa path-to-regexp v8 que requer wildcards nomeados:

```typescript
// Express 4 (antigo)
app.get('*', handler)

// Express 5 (atual)
app.get('{*path}', handler)
```

### AI SDK v6: tool() com inputSchema

AI SDK v6 mudou a propriedade de schema de `parameters` para `inputSchema`:

```typescript
// AI SDK v4/v5
tool({ parameters: z.object({...}), ... })

// AI SDK v6
tool({ inputSchema: z.object({...}), ... })
```

### Authorization Header Manual

`@ai-sdk/openai-compatible@0.2` não aceita `apiKey` como parâmetro nomeado nem `includeUsage`:

```typescript
// NÃO funciona:
createOpenAICompatible({ name: 'x', baseURL: '...', apiKey: '...', includeUsage: true })

// Funciona:
createOpenAICompatible({
  name: 'nvidia-nims',
  baseURL: apiBaseUrl,
  headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
})
```

### better-sqlite3: Rows Sem Tipo

better-sqlite3 retorna `unknown` para rows de query. Todos os repositories usam cast `as any`:

```typescript
const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
return {
  id: row.id,
  name: row.name,
  model: row.model,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
};
```

### I/O Síncrono nas Tools

Todas as tools usam `*Sync` (`readFileSync`, `writeFileSync`, `execSync`, etc.) dentro de `async execute`. Isso é seguro pois:
- better-sqlite3 é síncrono por design
- As tools rodam no Node.js event loop, e `execSync` bloqueia apenas a thread atual
- O `ToolLoopAgent` aguarda cada tool antes de prosseguir

### Sessão Padrão Auto-Criada

Se nenhuma sessão existe no DB, `server.ts` cria uma "Default Session":

```typescript
const existing = sessionsRepo.list();
if (existing.length === 0) {
  sessionsRepo.create('Default Session', config.defaultModel);
}
```

### Auto-Resolução de SessionId

Tanto `POST /api/chat` quanto `POST /api/tasks` auto-resolvem sessionId do primeiro registro no DB se não fornecido:

```typescript
if (!sessionId) {
  const sessions = sessionsRepo.list();
  if (sessions.length > 0) sessionId = sessions[0].id;
}
```
