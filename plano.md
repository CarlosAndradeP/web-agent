# Web Agent — Plano de Desenvolvimento

## Visao Geral

Plataforma multi-usuario de desenvolvimento web com agente de IA autonomo. Cada usuario tem workspace isolado, creditos, e pode criar projetos com chat vinculado e URL publica.

## Novo Modulo: Agente Autonomo Multi-Agent (Orchestrator)

### Contexto

Novo modulo que introduz um **agente autonomo multi-agent** para implementar projetos completos a partir de arquivos `.md` fornecidos pelo usuario. O agente principal `moonshotai/kimi-k2.6` ficara **sempre ativo**, orquestrando sub-agentes que agem de forma continua ate completar o projeto, se recuperando autonomamente de erros e falhas de acesso.

---

### Modelos de IA e Seus Papéis

| Modelo | Papel | Responsabilidade |
|--------|-------|------------------|
| `moonshotai/kimi-k2.6` | Orquestrador Principal | Planejamento, delegacao, analise de erros, recuperacao, visao global |
| `nvidia/nemotron-3-ultra-550b-a55b` | Auxiliar de Gerenciamento | Acompanhamento de progresso, geracao de checklists, coordenacao |
| `z-ai/glm-5.1` | Arquiteto de Software | Design de arquitetura, decisoes tecnicas, revisao de codigo |
| `deepseek-ai/deepseek-v4-pro` | Programador | Escrita de codigo, implementacao de features, refatoracao |

---

### Arquitetura do Modulo Autonomo

```
Usuario → Frontend (AutonomousPanel) → POST /api/orchestrator/start
                                               |
                                               v
                               [OrchestratorRunner] (worker continuo)
                                               |
                   +-----------+-----------+-----------+
                   |           |           |           |
                   v           v           v           v
           [Auxiliar]    [Arquiteto]  [Programador]
           Nemotron-3     GLM-5.1     DeepSeek-v4
                   |           |           |
                   +-----------+-----------+
                               |
                               v
                        [Workspace + DB]
```

---

## Fase 1: Banco de Dados (SQLite)

### Nova tabela: `orchestrator_sessions`

```sql
CREATE TABLE IF NOT EXISTS orchestrator_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle', -- idle, running, paused, completed, failed
  objective TEXT NOT NULL,
  current_step TEXT DEFAULT NULL,
  progress_percent INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  auto_recover INTEGER DEFAULT 1,
  workspace_dir TEXT DEFAULT NULL,
  md_files TEXT DEFAULT NULL,         -- JSON array of uploaded .md file paths
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Nova tabela: `orchestrator_steps`

```sql
CREATE TABLE IF NOT EXISTS orchestrator_steps (
  id TEXT PRIMARY KEY,
  orchestrator_session_id TEXT NOT NULL REFERENCES orchestrator_sessions(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  role TEXT NOT NULL,            -- orchestrator, auxiliar, arquiteto, programador
  model TEXT NOT NULL,
  action TEXT NOT NULL,          -- plan, delegate, review, fix, read, write, run
  input TEXT NOT NULL,
  output TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  error_message TEXT DEFAULT NULL,
  duration_ms INTEGER DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME DEFAULT NULL
);
```

### Nova tabela: `orchestrator_state`

```sql
CREATE TABLE IF NOT EXISTS orchestrator_state (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  is_running INTEGER DEFAULT 0,
  last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
  current_session_id TEXT DEFAULT NULL REFERENCES orchestrator_sessions(id),
  total_steps_completed INTEGER DEFAULT 0
);
```

---

## Fase 2: Tipos TypeScript

### Backend: `src/types/index.ts` (adicionar)

```typescript
export type OrchestratorSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';
export type OrchestratorStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type OrchestratorRole = 'orchestrator' | 'auxiliar' | 'arquiteto' | 'programador';
export type OrchestratorAction = 'plan' | 'delegate' | 'review' | 'fix' | 'read' | 'write' | 'run';

export interface OrchestratorSession {
  id: string;
  sessionId: string;
  userId?: string;
  status: OrchestratorSessionStatus;
  objective: string;
  currentStep: string | null;
  progressPercent: number;
  errorCount: number;
  autoRecover: boolean;
  workspaceDir: string | null;
  mdFiles: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorStep {
  id: string;
  orchestratorSessionId: string;
  stepNumber: number;
  role: OrchestratorRole;
  model: string;
  action: OrchestratorAction;
  input: string;
  output: string | null;
  status: OrchestratorStepStatus;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OrchestratorState {
  id: string;
  isRunning: boolean;
  lastHeartbeat: string;
  currentSessionId: string | null;
  totalStepsCompleted: number;
}
```

### Frontend: `frontend/src/types/index.ts` (adicionar)

```typescript
export type OrchestratorSessionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';
export type OrchestratorRole = 'orchestrator' | 'auxiliar' | 'arquiteto' | 'programador';

export interface OrchestratorSessionInfo {
  id: string;
  sessionId: string;
  status: OrchestratorSessionStatus;
  objective: string;
  currentStep: string | null;
  progressPercent: number;
  errorCount: number;
  autoRecover: boolean;
  mdFiles: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorStepInfo {
  id: string;
  orchestratorSessionId: string;
  stepNumber: number;
  role: OrchestratorRole;
  model: string;
  action: string;
  input: string;
  output: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OrchestratorStatusInfo {
  isRunning: boolean;
  lastHeartbeat: string;
  currentSessionId: string | null;
  totalStepsCompleted: number;
  session?: OrchestratorSessionInfo;
}
```

---

## Fase 3: Repository

### `src/db/repositories/orchestrator.ts`

CRUD completo para as 3 tabelas:

- `OrchestratorSessionsRepository`
  - `create(sessionId, userId, objective, workspaceDir)` → `OrchestratorSession`
  - `findById(id)` → `OrchestratorSession | undefined`
  - `findBySessionId(sessionId)` → `OrchestratorSession | undefined`
  - `findActive()` → `OrchestratorSession | undefined` (status = 'running')
  - `listByUserId(userId)` → `OrchestratorSession[]`
  - `listRunning()` → `OrchestratorSession[]` (para recovery no boot)
  - `updateStatus(id, status)` → void
  - `updateProgress(id, percent, currentStep)` → void
  - `incrementErrorCount(id)` → void
  - `updateMdFiles(id, mdFilesJson)` → void
  - `delete(id)` → void

- `OrchestratorStepsRepository`
  - `create(orchestratorSessionId, stepNumber, role, model, action, input)` → `OrchestratorStep`
  - `findBySession(orchestratorSessionId)` → `OrchestratorStep[]`
  - `findById(id)` → `OrchestratorStep | undefined`
  - `updateResult(id, output, status, errorMessage?, durationMs?)` → void
  - `countBySession(orchestratorSessionId)` → number

- `OrchestratorStateRepository`
  - `get()` → `OrchestratorState`
  - `setRunning(isRunning, sessionId?)` → void
  - `updateHeartbeat()` → void
  - `incrementSteps(count)` → void

---

## Fase 4: Prompts dos Agentes

### `src/orchestrator/prompts/orchestrator-prompt.ts` — moonshotai/kimi-k2.6

System prompt para o orquestrador principal com:
- Instrucoes de planejamento e delegacao
- Regras de auto-recovery (3 falhas → re-planejar)
- Regras de seguranca (mesmas do chat: `safeWorkspacePath`, `command-policy`)
- Formato de saida: JSON com campos `role`, `action`, `task`, `prompt`
- Instrucao para NUNCA parar — sempre chamar uma tool ate completar
- Conhecimento de que tem 3 sub-agentes disponiveis via tools `invokeAuxiliar`, `invokeArquiteto`, `invokeProgramador`

### `src/orchestrator/prompts/auxiliar-prompt.ts` — nvidia/nemotron-3-ultra-550b-a55b

System prompt para o auxiliar com:
- Foco em gerenciamento e organizacao
- Geracao de checklists e acompanhamento de progresso
- Ferramentas limitadas: readFile, listFiles, searchFiles

### `src/orchestrator/prompts/arquiteto-prompt.ts` — z-ai/glm-5.1

System prompt para o arquiteto com:
- Foco em design de arquitetura e decisoes tecnicas
- Revisao de codigo e avaliacao de estrutura
- Ferramentas: readFile, listFiles, searchFiles, writeFile (apenas para arquivos de documentacao de arquitetura)

### `src/orchestrator/prompts/programador-prompt.ts` — deepseek-ai/deepseek-v4-pro

System prompt para o programador com:
- Foco em implementacao de codigo
- Regras de seguranca (command-policy, safeWorkspacePath)
- Regra de PORT (usar process.env.PORT, nunca hardcode)
- Regra de BASE_PATH para projetos Node.js
- Todas as tools disponiveis: writeFile, readFile, listFiles, deleteFile, searchFiles, runCommand, executeCode, installPackage

---

## Fase 5: Agentes

### `src/orchestrator/agents/orchestrator-agent.ts`

Factory que cria `ToolLoopAgent` com `moonshotai/kimi-k2.6`:
- Tools: `invokeAuxiliar`, `invokeArquiteto`, `invokeProgramador`, `readFile`, `listFiles`, `searchFiles`
- System prompt do orquestrador
- `maxSteps: 50` por ciclo, `maxOutputTokens: 16384`

### `src/orchestrator/agents/auxiliar-agent.ts`

Factory que cria `ToolLoopAgent` com `nvidia/nemotron-3-ultra-550b-a55b`:
- Tools: `readFile`, `listFiles`, `searchFiles`
- System prompt do auxiliar
- `maxSteps: 20`, `maxOutputTokens: 8192`

### `src/orchestrator/agents/arquiteto-agent.ts`

Factory que cria `ToolLoopAgent` com `z-ai/glm-5.1`:
- Tools: `readFile`, `listFiles`, `searchFiles`, `writeFile`
- System prompt do arquiteto
- `maxSteps: 30`, `maxOutputTokens: 16384`

### `src/orchestrator/agents/programador-agent.ts`

Factory que cria `ToolLoopAgent` com `deepseek-ai/deepseek-v4-pro`:
- Tools: `writeFile`, `readFile`, `listFiles`, `deleteFile`, `searchFiles`, `runCommand`, `executeCode`, `installPackage`
- System prompt do programador
- `maxSteps: 40`, `maxOutputTokens: 16384`

---

## Fase 6: OrchestratorRunner

### `src/orchestrator/orchestrator-runner.ts`

Classe `OrchestratorRunner` — o core do sistema autonomo:

**State Machine:**
```
idle → [start] → planning → delegating → executing → reviewing → completed
                    ↑           |            |            |
                    |      error → recovering ────────────┘
                    |           |
                    └───────────┘ (3 falhas → re-plan)
```

**Loop autonomo:**
1. **Analyze**: Le todos os `.md` do usuario para entender o projeto
2. **Plan**: O Orquestrador (kimi-k2.6) gera um plano detalhado com tarefas
3. **Delegate Architecture**: Delega o desenho da arquitetura ao Arquiteto (glm-5.1)
4. **Delegate Management**: Delega a geracao de checklist ao Auxiliar (nemotron-3)
5. **Loop**: Para cada tarefa, delega ao Programador (deepseek-v4), revisa resultado
6. **Review**: Orquestrador revisa resultado de cada passo
7. **Error Recovery**: Se erro → orquestrador analisa → decide retry ou novo plano. Apos 3 falhas consecutivas na mesma tarefa → re-planeja
8. **Finish**: Marca como completed
9. **Auto-recovery**: Toda falha incrementa `error_count`; estado persistente permite recovery apos restart

**Mecanismo de delegacao:**
- O orquestrador chama tools `invokeAuxiliar`, `invokeArquiteto`, `invokeProgramador`
- Cada tool invoca o agente respectivo com prompt gerado pelo orquestrador
- O resultado volta ao orquestrador para analise e decisao do proximo passo

**Compaction:**
- Reutiliza `CompactionService` quando o contexto do orquestrador ultrapassar 60k tokens
- Cada sub-agente opera com historico limitado (recebe apenas o prompt do orquestrador)

**Cache de readFile:**
- Cache em memoria (Map<path, content>) no OrchestratorRunner
- Evita leituras redundantes do mesmo arquivo entre passos
- Invalidado quando o programador escreve no mesmo arquivo

**Limite de seguranca:**
- Max 500 steps total por sessao do orchestrator
- Se atingir, marca como failed com mensagem de limite excedido

---

## Fase 7: Heartbeat & Auto-Recovery

### `src/orchestrator/heartbeat.ts`

Classe `OrchestratorHeartbeat`:
- Verifica heartbeat a cada 30 segundos
- Se `last_heartbeat` > 60s sem atualizacao → mata runner e relanca
- No boot do servidor, carrega sessoes com `status = 'running'` e reinicia o loop
- Se `orchestrator_state.is_running = 1` mas nao ha sessao running → reseta estado
- Emite eventos Socket.IO: `orchestrator:status`, `orchestrator:heartbeat`

**Fluxo de Recovery:**
```
Servidor inicia
    → heartbeat.start()
    → busca orchestrator_sessions WHERE status = 'running'
    → para cada sessao pendente:
        → cria novo OrchestratorRunner
        → retoma do ultimo step (le orchestrator_steps)
        → continua loop autonomo
```

---

## Fase 8: API REST

### `src/api/orchestrator.ts`

```typescript
// POST /api/orchestrator/start
//   Body: { sessionId, objective, mdFiles?: string[] }
//   → Cria orchestrator_session, inicia OrchestratorRunner
//   Response: { session: OrchestratorSession }

// POST /api/orchestrator/:sessionId/stop
//   → Para o runner, marca status = 'idle'

// POST /api/orchestrator/:sessionId/pause
//   → Pausa o runner, marca status = 'paused'

// POST /api/orchestrator/:sessionId/resume
//   → Retoma o runner paused, marca status = 'running'

// GET /api/orchestrator/status
//   → Estado global + sessao ativa

// GET /api/orchestrator/:sessionId/status
//   → Status e progresso da sessao

// GET /api/orchestrator/:sessionId/steps
//   → Lista de passos executados (paginado com limit/offset)

// POST /api/orchestrator/:sessionId/upload-md
//   Body: FormData com arquivos .md
//   → Faz upload dos .md para o workspace, atualiza md_files na sessao
```

Todos os endpoints requerem autenticacao (`authMiddleware`).
Apenas o dono da sessao ou admin pode stop/pause/resume.

---

## Fase 9: Eventos Socket.IO

### Eventos servidor → cliente

| Evento | Dados | Descricao |
|--------|-------|------------|
| `orchestrator:status` | `{ sessionId, status, progressPercent }` | Atualizacao de status |
| `orchestrator:step` | `{ sessionId, stepNumber, role, model, action, input, output, status, durationMs }` | Novo passo executado |
| `orchestrator:progress` | `{ sessionId, progressPercent, currentStep }` | Atualizacao de progresso (%) |
| `orchestrator:log` | `{ sessionId, role, message, timestamp }` | Log de atividade |
| `orchestrator:error` | `{ sessionId, error, role }` | Erro ocorreu |
| `orchestrator:complete` | `{ sessionId, status }` | Sessao terminou |

### Eventos cliente → servidor

| Evento | Dados | Descricao |
|--------|-------|------------|
| `orchestrator:subscribe` | `{ sessionId }` | Inscreve-se em atualizacoes da sessao |
| `orchestrator:unsubscribe` | `{ sessionId }` | Cancela inscricao |

### Integracao em `src/websocket/events.ts`

Registrar os novos eventos no `registerSocketEvents`, com verificacao de ownership (user so pode se inscrever nas proprias sessoes, admin pode em todas).

---

## Fase 10: Integracao no Server

### `src/server.ts` (modificar)

```typescript
// 1. Importar
import { OrchestratorRunner } from './orchestrator/orchestrator-runner.js';
import { OrchestratorHeartbeat } from './orchestrator/heartbeat.js';
import { createOrchestratorRouter } from './api/orchestrator.js';
import { OrchestratorSessionsRepository, OrchestratorStepsRepository, OrchestratorStateRepository } from './db/repositories/orchestrator.js';

// 2. Instanciar repos
const orchestratorSessionsRepo = new OrchestratorSessionsRepository(db);
const orchestratorStepsRepo = new OrchestratorStepsRepository(db);
const orchestratorStateRepo = new OrchestratorStateRepository(db);

// 3. Instanciar runner + heartbeat
const orchestratorRunner = new OrchestratorRunner(db, taskManager, creditManager, configRepo);
const orchestratorHeartbeat = new OrchestratorHeartbeat(orchestratorRunner, orchestratorStateRepo);

// 4. Montar router
app.use('/api/orchestrator', authMiddleware, createOrchestratorRouter(
  orchestratorRunner, orchestratorSessionsRepo, orchestratorStepsRepo, orchestratorStateRepo
));

// 5. Iniciar heartbeat (recupera sessoes pendentes automaticamente)
orchestratorHeartbeat.start();

// 6. Endpoint de healthcheck para Docker
app.get('/health', (req, res) => {
  res.json({ status: 'ok', orchestrator: orchestratorRunner.isRunning() });
});

// 7. Shutdown limpo
process.on('SIGINT', () => {
  orchestratorHeartbeat.stop();
  orchestratorRunner.shutdown();
  // ... resto do shutdown existente
});
```

---

## Fase 11: Frontend — Hook

### `frontend/src/hooks/useOrchestrator.ts`

```typescript
function useOrchestrator() {
  // State
  const [status, setStatus] = useState<OrchestratorStatusInfo | null>(null);
  const [steps, setSteps] = useState<OrchestratorStepInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Socket.IO — escuta eventos orchestrator:*
  useEffect(() => { /* subscribe, listen, update state */ }, []);

  // Actions
  const start = async (objective: string, mdFiles?: File[]) => { ... };
  const stop = async () => { ... };
  const pause = async () => { ... };
  const resume = async () => { ... };
  const uploadMd = async (files: File[]) => { ... };
  const refresh = async () => { ... };

  return { status, steps, logs, isLoading, start, stop, pause, resume, uploadMd, refresh };
}
```

---

## Fase 12: Frontend — API Client

### `frontend/src/lib/api.ts` (adicionar)

```typescript
orchestrator: {
  status: () => fetchJSON<OrchestratorStatusInfo>(`${BASE}/orchestrator/status`),
  sessionStatus: (sessionId: string) =>
    fetchJSON<{ session: OrchestratorSessionInfo }>(`${BASE}/orchestrator/${sessionId}/status`),
  start: (data: { sessionId: string; objective: string; mdFiles?: string[] }) =>
    fetchJSON<{ session: OrchestratorSessionInfo }>(`${BASE}/orchestrator/start`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  stop: (sessionId: string) =>
    fetchJSON<{ success: boolean }>(`${BASE}/orchestrator/${sessionId}/stop`, { method: 'POST' }),
  pause: (sessionId: string) =>
    fetchJSON<{ success: boolean }>(`${BASE}/orchestrator/${sessionId}/pause`, { method: 'POST' }),
  resume: (sessionId: string) =>
    fetchJSON<{ success: boolean }>(`${BASE}/orchestrator/${sessionId}/resume`, { method: 'POST' }),
  steps: (sessionId: string, limit?: number, offset?: number) =>
    fetchJSON<{ steps: OrchestratorStepInfo[]; total: number }>(`${BASE}/orchestrator/${sessionId}/steps?limit=${limit ?? 50}&offset=${offset ?? 0}`),
  uploadMd: async (sessionId: string, files: File[]) => {
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    const res = await fetch(`${BASE}/orchestrator/${sessionId}/upload-md`, {
      method: 'POST', headers: getAuthHeadersNoContentType(), body: formData,
    });
    if (!res.ok) throw new Error(`Upload error: ${res.status}`);
    return res.json();
  },
},
```

---

## Fase 13: Frontend — Componentes

### `frontend/src/components/AutonomousPanel.tsx`

Painel principal com:
```
+--------------------------------------------------------------------+
|  🧠 Autonomous Agent          | Status: Running | Progress: 45%     |
+--------------------------------------------------------------------+
|  Objective: [input field + upload .md button]                      |
+----+--------------------------------------------------------------+
|    | Agentes Ativos:                                            |
|    | [🧠 kimi-k2.6] [🤝 Nemotron] [🏗️ GLM] [💻 DeepSeek]        |
| S  +--------------------------------------------------------------+
| i  | Log de Atividades (scrollable)                              |
| d  | [step 1] orchestrator: Analisando requisitos...              |
| e  | [step 2] arquiteto: Desenhando arquitetura...               |
| b  | [step 3] programador: Implementando auth.ts...              |
| a  | [step 4] orchestrator: Revisando implementacao...           |
| r  | ...                                                         |
|    +--------------------------------------------------------------+
|    | [Start]  [Pause]  [Resume]  [Stop]                          |
+----+--------------------------------------------------------------+
```

### `frontend/src/components/OrchestratorHeader.tsx`

Barra superior com:
- Nome do modelo orquestrador + indicador de status (dot animado)
- Barra de progresso percentual
- Badge de erros (se errorCount > 0)

### `frontend/src/components/OrchestratorLog.tsx`

Lista scrollavel de steps com:
- Cor por role (orchestrator=blue, auxiliar=green, arquiteto=amber, programador=purple)
- Duracao de cada step
- Expandir/collapsar input e output
- Badge de status (pending/running/completed/failed)

### `frontend/src/components/OrchestratorControls.tsx`

Barra de controles com:
- Botao Start (com campo de objetivo)
- Botao Pause/Resume (toggle)
- Botao Stop (com confirmacao)
- Botao Upload .md (file picker)
- Badges dos 4 agentes (ativo/inativo por cor)

---

## Fase 14: Sidebar + Layout

### `frontend/src/components/Sidebar.tsx` (modificar)

Adicionar tab apos `chat`:
```typescript
{ id: 'autonomous', label: 'Autonomous', icon: BrainCircuit }
```

### `frontend/src/components/Layout.tsx` (modificar)

```typescript
type Tab = 'chat' | 'autonomous' | 'tasks' | 'files' | 'config' | 'admin' | 'account';

// Na area de conteudo:
<div className={activeTab === 'autonomous' ? 'h-full' : 'h-full hidden'}>
  <AutonomousPanel />
</div>
```

---

## Fase 15: Docker

### `docker-compose.yml` (modificar)

```yaml
services:
  web-agent:
    restart: unless-stopped
    healthcheck:
      test: curl -f http://localhost:89/health || exit 1
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

### Endpoint de Health

`GET /health` (sem autenticacao) retorna:
```json
{ "status": "ok", "orchestrator": { "isRunning": true, "lastHeartbeat": "..." } }
```

O Docker healthcheck usa este endpoint. Se o servidor estiver vivo, retorna 200.

### Persistencia

- Estado do orquestrador no SQLite (volume `./data:/app/data`)
- Sessoes com `status = 'running'` persistidas no banco
- Ao reiniciar container, `OrchestratorHeartbeat` recarrega sessoes pendentes

---

## Fase 16: Build & Verificacao

1. `npx tsc` — verificar tipos sem erros
2. `cd frontend && npx vite build` — build de producao do frontend
3. Validar schema SQLite (criar DB temporario, rodar schema + migrate)
4. Testar fluxo completo manualmente:
   - Upload de .md → Start → verificar logs → Pause → Resume → Stop
   - Simular erro (modelo indisponivel) → verificar auto-recovery
   - Reiniciar servidor → verificar recovery de sessao pendente

---

## Fluxo Completo do Usuario

```
1. Usuario acessa tab "Autonomous" na sidebar
2. Digita objetivo do projeto no campo de texto
3. (Opcional) Faz upload de arquivos .md com especificacao detalhada
4. Clica "Start"
5. Backend:
   a. Cria orchestrator_session no database
   b. Orquestrador (kimi-k2.6) le os .md e gera plano detalhado
   c. Arquiteto (glm-5.1) desenha arquitetura e estrutura de arquivos
   d. Auxiliar (nemotron-3) gera checklist de tarefas
   e. Loop autonomo: Programador (deepseek-v4) implementa → Orquestrador revisa → Testa
   f. Se erro: diagnostica e corrige autonomamente (retry ou re-plan)
   g. Apos 3 falhas na mesma tarefa: arquiteto reavalia e gera novo plano
   h. Tarefas concluidas → status = completed
6. Frontend recebe atualizacoes em tempo real via Socket.IO
7. Usuario pode acompanhar progresso, pausar, ou parar a qualquer momento
```

---

## Tratamento de Erros e Auto-Recovery

| Cenario | Acao |
|---------|------|
| Erro de execucao (tool falha) | Orquestrador analisa stack trace, decide se e erro de codigo ou config |
| Erro de compilacao | Programador tenta fixar; apos 3 tentativas → arquiteto reavalia |
| Erro de API (modelo indisponivel) | Retry com backoff exponencial (1s, 2s, 4s, 8s, 16s), max 5 tentativas; se persiste → pausa e notifica |
| Servidor reinicia | No boot, carrega sessoes `running` e reinicia o loop autonomo |
| Heartbeat travado (>60s) | Mata runner e relanca automaticamente |
| Container cai | `restart: unless-stopped` + healthcheck a cada 30s |
| Erros de rede | Retry com exponential backoff, max 5 tentativas |
| 3 falhas consecutivas na mesma tarefa | Orquestrador pede novo plano ao arquiteto |
| Max 500 steps atingido | Marca sessao como failed com mensagem de limite |

---

## Consideracoes de Seguranca e Performance

- O orquestrador usa as mesmas protecoes do chat (`command-policy.ts`, `safeWorkspacePath`)
- Limitar numero de passos continuos para evitar loops infinitos (max 500 steps)
- Cachear respostas de `readFile` entre passos para evitar redundancia
- Compactar historico do orquestrador quando ultrapassar limite de tokens (reutilizar `CompactionService` existente)
- Cada delegacao a sub-agente respeita o `maxSteps` individual
- Sub-agentes nao podem chamar outros sub-agentes (sem invokeSubAgent nos sub-agentes)
- Verificacao de ownership: usuario so pode gerenciar proprias sessoes; admin pode tudo
- Creditos: cada step de cada agente deduz creditos do usuario (usando `CreditManager` existente)
- AbortController para cancelamento limpo (stop/pause interrompe o loop)

---

## Arquivos a Criar / Modificar

### Arquivos Novos (18)

| Arquivo | Descricao |
|---------|-----------|
| `src/db/repositories/orchestrator.ts` | Repository para 3 tabelas do orchestrator |
| `src/orchestrator/types.ts` | Tipos especificos do modulo |
| `src/orchestrator/orchestrator-runner.ts` | Loop autonomo + state machine |
| `src/orchestrator/heartbeat.ts` | Monitoramento + auto-recovery |
| `src/orchestrator/agents/orchestrator-agent.ts` | Factory: agente kimi-k2.6 |
| `src/orchestrator/agents/auxiliar-agent.ts` | Factory: agente nemotron-3 |
| `src/orchestrator/agents/arquiteto-agent.ts` | Factory: agente glm-5.1 |
| `src/orchestrator/agents/programador-agent.ts` | Factory: agente deepseek-v4 |
| `src/orchestrator/prompts/orchestrator-prompt.ts` | System prompt do orquestrador |
| `src/orchestrator/prompts/auxiliar-prompt.ts` | System prompt do auxiliar |
| `src/orchestrator/prompts/arquiteto-prompt.ts` | System prompt do arquiteto |
| `src/orchestrator/prompts/programador-prompt.ts` | System prompt do programador |
| `src/api/orchestrator.ts` | API REST do orchestrator |
| `frontend/src/components/AutonomousPanel.tsx` | Painel principal |
| `frontend/src/components/OrchestratorHeader.tsx` | Header com status + progresso |
| `frontend/src/components/OrchestratorLog.tsx` | Log de passos |
| `frontend/src/components/OrchestratorControls.tsx` | Botoes Start/Pause/Stop/Upload |
| `frontend/src/hooks/useOrchestrator.ts` | Hook de controle |

### Arquivos a Modificar (10)

| Arquivo | Mudanca |
|---------|---------|
| `src/db/schema.ts` | Adicionar 3 tabelas do orchestrator |
| `src/db/migrate.ts` | Migracao para tabelas novas (ALTER TABLE para DBs existentes) |
| `src/types/index.ts` | Adicionar tipos OrchestratorSession, OrchestratorStep, OrchestratorState |
| `src/server.ts` | Instanciar OrchestratorRunner, Heartbeat, montar router + /health |
| `src/websocket/events.ts` | Registrar eventos orchestrator:* |
| `frontend/src/types/index.ts` | Adicionar tipos do orchestrator |
| `frontend/src/lib/api.ts` | Adicionar chamadas orchestrator.* |
| `frontend/src/components/Sidebar.tsx` | Adicionar tab 'autonomous' com icone BrainCircuit |
| `frontend/src/components/Layout.tsx` | Adicionar tipo 'autonomous' no Tab + renderizar AutonomousPanel |
| `docker-compose.yml` | Adicionar healthcheck e start_period |

---

## Stack Tecnologica

| Camada | Tecnologia | Versao |
|--------|-----------|--------|
| Agent Framework | Vercel AI SDK v6 | `ai@6.0.208` |
| API Provider | `@ai-sdk/openai-compatible` | `^2.0.51` |
| Backend | Express.js v5 + TypeScript 6 | `express@5.2.1` |
| Frontend | React 19 + Vite 8 + TailwindCSS 4 | — |
| Real-time | SSE + Socket.IO | `socket.io@4.8.3` |
| Persistencia | SQLite (better-sqlite3, WAL) | `^12.11.1` |
| Auth | JWT (bcryptjs + jsonwebtoken) | — |
| Docker Base | php:8.3-apache-bookworm | Debian bookworm |
| Runtime | Node.js 22 + Apache 2 + PHP 8.3 | — |

---

## Estrutura de Diretorios (Novos arquivos marcados com ★)

```
web-agent/
├── Dockerfile
├── docker-compose.yml            ★ (modificado: healthcheck)
├── docker-start.sh
├── package.json
├── tsconfig.json
├── .env.example
│
├── src/
│   ├── server.ts                 ★ (modificado: orchestrator + /health)
│   ├── config.ts
│   │
│   ├── agent/
│   │   ├── index.ts
│   │   ├── provider.ts
│   │   ├── instructions.ts
│   │   └── tools/
│   │       ├── index.ts
│   │       ├── write-file.ts
│   │       ├── read-file.ts
│   │       ├── list-files.ts
│   │       ├── delete-file.ts
│   │       ├── run-command.ts
│   │       ├── execute-code.ts
│   │       ├── search-files.ts
│   │       ├── web-fetch.ts
│   │       ├── install-package.ts
│   │       └── sub-agent.ts
│   │
│   ├── orchestrator/             ★ NOVO MODULO
│   │   ├── orchestrator-runner.ts   ★ Loop autonomo + state machine
│   │   ├── heartbeat.ts             ★ Monitoramento + auto-recovery
│   │   ├── types.ts                  ★ Tipos internos
│   │   ├── agents/
│   │   │   ├── orchestrator-agent.ts  ★ kimi-k2.6
│   │   │   ├── auxiliar-agent.ts      ★ nemotron-3
│   │   │   ├── arquiteto-agent.ts     ★ glm-5.1
│   │   │   └── programador-agent.ts   ★ deepseek-v4
│   │   └── prompts/
│   │       ├── orchestrator-prompt.ts  ★ Orquestrador
│   │       ├── auxiliar-prompt.ts      ★ Auxiliar
│   │       ├── arquiteto-prompt.ts      ★ Arquiteto
│   │       └── programador-prompt.ts    ★ Programador
│   │
│   ├── api/
│   │   ├── orchestrator.ts       ★ API REST do orchestrator
│   │   ├── auth.ts
│   │   ├── admin.ts
│   │   ├── chat.ts
│   │   ├── models.ts
│   │   ├── tasks.ts
│   │   ├── files.ts
│   │   ├── config.ts
│   │   ├── sessions.ts
│   │   └── projects.ts
│   │
│   ├── db/
│   │   ├── index.ts
│   │   ├── schema.ts             ★ (modificado: 3 tabelas novas)
│   │   ├── migrate.ts             ★ (modificado: migracao novas)
│   │   └── repositories/
│   │       ├── orchestrator.ts     ★ Repository do orchestrator
│   │       ├── users.ts
│   │       ├── credits.ts
│   │       ├── projects.ts
│   │       ├── sessions.ts
│   │       ├── messages.ts
│   │       ├── tasks.ts
│   │       └── config.ts
│   │
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── admin.ts
│   │
│   ├── lib/
│   │   └── jwt.ts
│   │
│   ├── services/
│   │   ├── task-manager.ts
│   │   ├── credit-manager.ts
│   │   ├── project-router.ts
│   │   ├── approval-manager.ts
│   │   ├── compaction-service.ts
│   │   ├── model-resolver.ts
│   │   ├── file-watcher.ts
│   │   └── logger.ts
│   │
│   ├── websocket/
│   │   ├── index.ts
│   │   └── events.ts            ★ (modificado: eventos orchestrator:*)
│   │
│   └── types/
│       └── index.ts             ★ (modificado: tipos orchestrator)
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── types/
│   │   │   └── index.ts          ★ (modificado: tipos orchestrator)
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx
│   │   ├── components/
│   │   │   ├── AutonomousPanel.tsx    ★ Painel do agente autonomo
│   │   │   ├── OrchestratorHeader.tsx ★ Header com progresso
│   │   │   ├── OrchestratorLog.tsx    ★ Log de passos
│   │   │   ├── OrchestratorControls.tsx ★ Botoes Start/Pause/Stop
│   │   │   ├── Layout.tsx            ★ (modificado: tab autonomous)
│   │   │   ├── Sidebar.tsx           ★ (modificado: tab autonomous)
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── FileManager.tsx
│   │   │   ├── ConfigPanel.tsx
│   │   │   ├── AdminPanel.tsx
│   │   │   └── ui/
│   │   ├── hooks/
│   │   │   ├── useOrchestrator.ts     ★ Hook de controle
│   │   │   ├── useChat.ts
│   │   │   ├── useFiles.ts
│   │   │   ├── useProjects.ts
│   │   │   ├── useSessions.ts
│   │   │   ├── useSocket.ts
│   │   │   └── useResizable.ts
│   │   └── lib/
│   │       ├── api.ts          ★ (modificado: chamadas orchestrator.*)
│   │       ├── auth-api.ts
│   │       └── utils.ts
│   └── public/
│
├── workspace/
└── data/
    └── web-agent.db
```
