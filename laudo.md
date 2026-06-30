# Laudo de Análise de Falhas — Sistema de Agentes

**Data**: 29 de junho de 2026  
**Projeto**: Web Agent — Plataforma de desenvolvimento multi-usuário com agente AI autônomo  
**Escopo**: Sistema de orquestração e sub-agentes (orchestrator-runner, agentes, tools, provider)  
**Status**: Bug CRÍTICO corrigido — ver Apêndice A no final  

---

## Visão Geral

O sistema implementa um orquestrador autônomo (Kimi K2.6) que delega tarefas a 3 sub-agentes (Nemotron auxiliar, GLM-5.1 arquiteto, DeepSeek-v4 programador). Após análise completa de 30+ arquivos, identifiquei **problemas fatais de arquitetura**, **bugs críticos** e **falhas estruturais** que tornam este sistema fundamentalmente incapaz de funcionar de forma confiável.

---

## 1. PROBLEMA FATAL: O Orquestrador NÃO Tem Memória Entre Ciclos

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:408`

```typescript
const result = await orchestratorAgent.generate({
  messages: conversationMessages,
  abortSignal: this.abortController?.signal,
});
```

O orquestrador chama `generate()` com todo o histórico de `conversationMessages`. Mas aqui está o problema **crucial**: a SDK Vercel AI v6 `ToolLoopAgent.generate()` retorna um `GenerateTextResult`. O código faz:

```typescript
const responseMsgs = result.response?.messages ?? [];
if (responseMsgs.length > 0) {
  conversationMessages.push(...responseMsgs);
} else if (text) {
  conversationMessages.push({ role: 'assistant', content: text });
}
```

**Problema 1**: `result.response?.messages` — O `GenerateTextResult` na AI SDK v6 **NÃO tem uma propriedade `.response.messages`**. A propriedade correta seria `result.responseMessages` (ou os steps teriam as tool calls/results). Se `response` for undefined ou não tiver `.messages`, o código cai no `else if (text)`, que pusha apenas o texto final — **PERDENDO TODAS AS TOOL CALLS E TOOL RESULTS** do ciclo.

**Problema 2**: Sem as tool calls nos `conversationMessages`, na próxima iteração do loop o orquestrador recebe um contexto incompleto. O LLM não sabe que ferramentas foram chamadas, não sabe o resultado da delegação ao sub-agente, e tenta repetir as mesmas ações ou fica confuso.

**Consequência**: Após cada ciclo do `while`, o orquestrador "esquece" o que fez. É como se cada chamada fosse amnésica. O modelo recebe `[user prompt, ..., assistant text]` e depois um `"Continue implementing..."` — ele não vê as ferramentas que executou, então não tem como saber o progresso real.

---

## 2. PROBLEMA FATAL: O Loop de Continuação Força Comportamento Irrelevante

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:474-477`

```typescript
conversationMessages.push({
  role: 'user',
  content: 'Continue implementing the project. If you are done, say "PROJECT COMPLETE". Otherwise, keep using tools to make progress.',
});
```

Depois de cada `generate()`, o código automaticamente injecta uma mensagem "Continue implementing...". Isso é problemático por vários motivos:

1. **Se o orquestrador já completou todos os passos** num ciclo e retornou texto final sem "PROJECT COMPLETE" (porque a verificação de `checkCompletion` falha — veja problema 3), ele é forçado a continuar
2. **Se o orquestrador não pode fazer mais nada** (por exemplo, está esperando revisão humana), ele é forçado a inventar trabalho
3. **O prompt "keep using tools to make progress"** incentiviza o LLM a fazer chamadas de ferramenta desnecessárias — fazendo loops infinitos de readFile/listFile sem propósito

---

## 3. PROBLEMA FATAL: `checkCompletion` é Frágil Demais

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:559-561`

```typescript
private checkCompletion(text: string): boolean {
  return text.includes('PROJECT COMPLETE');
}
```

Isso verifica se **qualquer parte** do texto retornado contém "PROJECT COMPLETE". Mas:

1. **O orquestrador pode nunca emitir essa string** — Modelos LLM raramente seguem instruções de formato com 100% de fidelidade
2. **O texto pode conter "PROJECT COMPLETE" em outros contextos** (discussão, planos, etc) causando saída prematura
3. **O `stopWhen: stepCountIs(50)`** pode parar o agente ANTES de ele emitir "PROJECT COMPLETE" — se o agente usa 50 tool calls, o `generate()` retorna sem texto contendo essa string
4. **Se o orquestrador gera texto misturado com tool calls**, o `result.text` pode conter "PROJECT COMPLETE" num passo intermediário, mas ele continua executando tools

A combinação dos problemas 2 e 3 significa que: o orquestrador PODE completar o projeto mas NUNCA diz "PROJECT COMPLETE", então o loop continua para sempre até `MAX_TOTAL_STEPS = 500`.

---

## 4. BUG CRÍTICO: `invokedSubAgents` Bloqueia Re-chamadas Necessárias

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:68-82`

```typescript
if (this.invokedSubAgents.has(role) && role === 'auxiliar') {
  const previousResult = `Already delegated to ${role}. Do not call ${role} again — use the result you already received and proceed to implementation.`;
  return previousResult;
}
this.invokedSubAgents.add(role);
```

A lógica impede que `auxiliar` seja chamado mais de uma vez. Mas repare que **para `arquiteto` e `programador`**, o código faz `this.invokedSubAgents.add(role)` na primeira chamada, e NUNCA os remove até `stop()`. Mas o `invokeSubAgent` **não bloqueia re-chamadas** para arquiteto/programador porque a condição é `role === 'auxiliar'`.

No entanto, **o prompt do orquestrador diz** `"Invoke invokeArquiteto ONCE"` e `"Invoke invokeAuxiliar ONCE"`. O orquestrador é instruído a chamar o arquiteto APENAS uma vez, mas o código permite múltiplas chamadas. A lógica está inconsistente — o código só bloqueia `auxiliar`, mas o prompt bloqueia ambos. O modelo pode tentar chamar `arquiteto` múltiplas vezes (e terá sucesso), contrariando o workflow planejado.

---

## 5. PROBLEMA FATAL: Compactação Destroi Contexto de Ferramentas

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:446-449`

```typescript
if (totalChars / 4 > 60000) {
  const summary = await this.compactConversationMessages(conversationMessages);
  conversationMessages.length = 0;
  conversationMessages.push({ role: 'system', content: `[Conversation summary]:\n${summary}` });
}
```

A compactação:

1. **Limpa TODAS as mensagens** e as substitui por um resumo de texto
2. O resumo é gerado pelo LLM que tenta condensar tool calls, resultados, e decisões num texto de 4096 tokens
3. **O resumo NÃO inclui IDs de ferramentas ou referências exatas** — o orquestrador perde a noção de quais arquivos existem exatamente, o que cada sub-agente fez passo a passo
4. **Se a compactação falha**, o fallback pega as primeiras 10 e últimas 10 linhas do texto — preservando ZERO informação estrutural

A heurística `totalChars / 4 > 60000` é aproximadamente 240k chars. Mas mensagens JSON de tool calls são muito densas. Um arquiteto que lê 20 arquivos + checklist do auxiliar + múltiplas respostas pode facilmente atingir esse limite em 2-3 ciclos.

**Consequência**: O orquestrador "esquece" o que foi feito e repete tarefas, ou perde contexto sobre arquivos que existem e tenta recriá-los.

---

## 6. BUG CRÍTICO: Sub-Agentes São Criados Sem `readFileCache`

O orquestrador tem `this.readFileCache = new Map<string, string>()` mas **nunca o popula** e **nunca o passa** para os sub-agentes. A cache é limpa em `invalidateCacheOnWrite()` (apenas quando `programador` é chamado) mas nunca é efetivamente usada. Isso é código morto que sugere que houve uma intenção de cachear leituras mas nunca foi implementada.

---

## 7. PROBLEMA ARQUITETURAL: O Modelo `ToolLoopAgent` Não Suporta o Workflow Planejado

O `ToolLoopAgent` da AI SDK v6 funciona assim:

1. Recebe `prompt` ou `messages` na chamada `generate()`/`stream()`
2. Faz um loop interno: chama o LLM → se o LLM retorna tool calls → executa as tools → envia os resultados de volta ao LLM → repete
3. Para quando `stopWhen` é satisfeito ou não há mais tool calls

**O problema**: Cada chamada a `generate()` com as `conversationMessages` cria um **novo ciclo completo**. O orquestrador, num único `generate()`, pode:

- Ler arquivos com readFile
- Chamar invokeArquiteto (que bloqueia por 5+ minutos esperando o sub-agente)
- Chamar invokeProgramador (mais 5+ minutos)
- Chamar invokeAuxiliar

Cada uma dessas delegações é uma tool call que **bloqueia o orquestrador inteiro**. Enquanto o programador está rodando, o orquestrador não pode fazer NADA mais. O `invokeParallel` ajuda, mas ele também bloqueia enquanto TODOS os sub-agentes paralelos terminam.

**Consequência**: O sistema é **sequencial por natureza** dentro de cada `generate()` — mesmo com `invokeParallel`, o orquestrador não pode "pensar" enquanto espera. E se o arquiteto + programador usam 30 steps cada, o orquestrador atinge `stepCountIs(50)` em apenas 1-2 delegações por ciclo.

---

## 8. PROBLEMA ARQUITETURAL: `stepCountIs(50)` Conta Tool Calls do Orquestrador, Não Sub-Agentes

**Arquivo**: `src/orchestrator/agents/orchestrator-agent.ts:76`

```typescript
stopWhen: stepCountIs(50),
```

O `stepCountIs(50)` para o loop do ToolLoopAgent após 50 interações de tool-call. Isso inclui:

- Cada `readFile` = 1 step
- Cada `listFiles` = 1 step
- Cada `invokeArquiteto` = 1 step (mas internamente o sub-agente pode ter usado 30 steps!)
- Cada `invokeProgramador` = 1 step

Então o orquestrador pode fazer: 5 readFiles + 1 invokeArquiteto + 5 readFiles para review + 1 invokeProgramador = 12 steps num ciclo. Mais dois ciclos e ele chega perto dos 50. Mas o `MAX_TOTAL_STEPS = 500` no runner conta steps do orquestrador (não sub-agente steps).

**Problema**: Os dois contadores são **inconsistentes**. O `stepCountIs(50)` para o `generate()` atual, mas o runner verifica `totalStepsUsed < MAX_TOTAL_STEPS` (500). Se o `generate()` retorna com `result.steps?.length`, o runner adiciona ao `totalStepsUsed`. Mas se cada generate retorna com ~20-50 steps, **o runner atinge 500 steps em ~10-25 ciclos**, que podem ser apenas 2-3 delegações reais (porque readFile/listFile contam como steps).

---

## 9. PROBLEMA FATAL: O Sub-Agente Retorna Apenas Texto, Não Estrutura

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:124`

```typescript
result = agentResult.text ?? 'Auxiliar completed with no output';
```

Todos os sub-agentes retornam `result.text` — apenas o texto gerado pelo LLM. Mas o `ToolLoopAgent` executa múltiplas tool calls internamente. O `result.text` é o **texto final do modelo**, não inclui os resultados intermediários das tools.

Isso significa que:

1. O arquiteto **lê arquivos** e **escreve architecture.md**, mas retorna APENAS o texto final
2. O programador **escreve múltiplos arquivos** e **roda comandos**, mas retorna APENAS o texto final
3. O orquestrador **NÃO SABE** quais arquivos foram criados/modificados a menos que o sub-agente mencione isso no texto

Se o programador cria 10 arquivos mas o texto final é "I've implemented the feature", o orquestrador não tem como saber quais arquivos existem sem chamar `listFiles` de novo.

---

## 10. PROBLEMA CRÍTICO: O Sub-Agente Nemotron (Auxiliar) Não Tem `writeFile`

**Arquivo**: `src/orchestrator/agents/auxiliar-agent.ts:11-15`

O auxiliar só tem `readFile`, `listFiles`, `searchFiles`. Ele NÃO pode criar arquivos. Isso é correto pela intenção (ele gera checklists), mas o prompt dele instrui: "Read architecture.md or other relevant files FIRST using readFile. THEN produce the checklist."

Se o arquiteto AINDA NÃO criou o `architecture.md`, o auxiliar lê arquivos que não existem, e gera um checklist baseado em nada. Não há nenhum fluxo que garanta que o arquiteto termina ANTES do auxiliar rodar.

**Mais grave**: O orquestrador chama o auxiliar com `invokeAuxiliar` e passa o `task` com a descrição do objetivo. Mas o auxiliar **recebe isso como um `prompt` de geração única** — ele não tem contexto da conversa anterior, não sabe o que o arquiteto decidiu, não tem acesso ao `architecture.md` a não ser que leia explicitamente.

---

## 11. PROBLEMA CRÍTICO: O `safeWorkspacePath` Tem Bypass no Windows

**Arquivo**: `src/agent/tools/sanitize.ts:3-9`

```typescript
export function safeWorkspacePath(workspaceDir: string, relativePath: string): string {
  const fullPath = resolve(workspaceDir, relativePath);
  const normalizedWorkspace = resolve(workspaceDir);
  if (!fullPath.startsWith(normalizedWorkspace)) {
    throw new Error(`Path traversal blocked`);
  }
  return fullPath;
}
```

No Windows, `resolve()` normaliza barras. Mas `startsWith()` é uma verificação de string. Se `workspaceDir` é `C:\Users\carlos\workspace` e `relativePath` é `..\..\..\etc\passwd`, o `resolve()` resolve para `C:\etc\passwd`, que corretamente falha o `startsWith`. Mas e se o caminho é `C:\Users\carlos\workspace-evil\file`? Ele **passa** no `startsWith` porque `C:\Users\carlos\workspace-evil` começa com `C:\Users\carlos\workspace`.

Isso é uma vulnerabilidade de path traversal clássica. O `startsWith` sem trailing separator permite acesso a diretórios irmãos que compartilham o prefixo.

**Correção sugerida**: Adicionar `sep` (path separator) ao final do workspaceDir na verificação:

```typescript
const normalizedWorkspace = resolve(workspaceDir) + sep;
if (!fullPath.startsWith(normalizedWorkspace) && fullPath !== resolve(workspaceDir)) {
  throw new Error(`Path traversal blocked`);
}
```

---

## 12. PROBLEMA ARQUITETURAL: Singleton Orquestrador = Deadlock Potencial

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:23-49` e `src/server.ts:136`

Existe apenas **UMA instância** de `OrchestratorRunner` para todo o servidor. Se dois usuários tentarem iniciar o orquestrador, o segundo recebe `409 Conflict` porque `runner.isRunning()` retorna true.

Isso significa que **apenas um projeto pode ser construído por vez** em todo o sistema multi-usuário. E se o orquestrador travar (o que é quase certo dado os outros bugs), TODOS os outros usuários ficam bloqueados.

---

## 13. PROBLEMA CRÍTICO: O `callWithRetry` Pode Amplificar Falhas

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:589-610`

O `callWithRetry` tenta até 5 vezes, com delays de 1s a 16s. Se o sub-agente falha porque a API retorna um erro de quota/rate-limit, o retry pode piorar a situação. E se o erro é de lógica (prompt mal formatado, modelo não suporta tools), 5 retries não resolvem nada — apenas desperdiçam créditos e tempo.

Não há distinção entre **erros transientes** (network, timeout, 429) e **erros permanentes** (400, 401, 403, modelo não suporta tools).

---

## 14. PROBLEMA FATAL: A Promessa "Sub-Agentes em Paralelo" é Ilusória

**Arquivo**: `src/orchestrator/orchestrator-runner.ts:226-259`

O `invokeSubAgentsParallel` usa `Promise.all` para rodar sub-agentes em paralelo. Isso funciona **tecnicamente**, mas há problemas práticos:

1. **Compartilham o mesmo workspace** — Se dois programadores tentam escrever o mesmo arquivo simultaneamente, o resultado é **data corruption**
2. **Compartilham a mesma API** — Se a API tem rate limiting, duas chamadas paralelas podem causar `429 Too Many Requests`
3. **Compartilham o mesmo `creditManager`** — A dedução de créditos não é serializada entre os paralelos; pode haver race condition no check `credits >= ?`
4. **O `invokedSubAgents.add(role)` dentro de `invokeSubAgent`** não é thread-safe — se dois paralelos chamam `invokeSubAgent('programador', ...)`, ambos passam no check de `role === 'auxiliar'`, e ambos adicionam 'programador' ao Set (que já estava lá), causando comportamento inconsistente

---

## 15. PROBLEMA ARQUITETURAL: O Prompt do Orquestrador É Incompatível com o Comportamento Real

**Arquivo**: `src/orchestrator/prompts/orchestrator-prompt.ts`

O prompt diz:

- "Invoke invokeArquiteto ONCE" — mas o código permite múltiplas chamadas
- "Invoke invokeAuxiliar ONCE. You already have the checklist. DO NOT call invokeAuxiliar again" — o código bloqueia, mas retorna uma mensagem genérica que confunde o LLM
- "After each implementation batch, use readFile to review generated code" — mas o orquestrador não sabe quais arquivos foram criados (problema 9)
- "Invoke PROGRAMMER TASKS IN PARALLEL when possible" — mas paralelo corrompe arquivos (problema 14)
- "When done, output 'PROJECT COMPLETE'" — mas `stepCountIs(50)` pode impedir que ele chegue a essa frase

O prompt descreve um workflow ideal que o código não suporta. O LLM tenta seguir as instruções, encontra inconsistências, e fica confuso — gerando respostas inesperadas ou entrando em loops.

---

## 16. PROBLEMA CRÍTICO: O `content-sanitize.ts` Filtra Próprias Instruções

**Arquivo**: `src/agent/tools/content-sanitize.ts:1-7`

O `sanitizeForPrompt` filtra padrões como "ignore previous instructions". Mas isso é aplicado ao CONTEÚDO DOS ARQUIVOS lidos pelo `readFile`. Se o workspace tem documentação legítima que contém "system prompt" ou "new instructions:" (comum em READMEs de bibliotecas), o conteúdo é corrompido com `[FILTERED]`. Isso pode quebrar a capacidade do agente de entender o código que está lendo.

---

## 17. PROBLEMA CRÍTICO: `writeFileSync` nas Tools Bloqueia o Event Loop

**Arquivo**: `src/agent/tools/write-file.ts:22`, `src/agent/tools/read-file.ts:22`, `src/agent/tools/delete-file.ts:18`

Todas as tools de arquivo usam I/O síncrono: `writeFileSync`, `readFileSync`, `rmSync`. O `instructions.ts` do projeto até diz "no sync I/O on event loop" como regra do Logger, mas as tools violam isso diretamente. Isso é especialmente problemático quando múltiplos sub-agentes rodam em paralelo — o event loop é bloqueado por I/O de arquivo síncrono.

---

## RESUMO: Por Que Este Projeto Nunca Vai Funcionar

A arquitetura fundamental tem contradições irresolveíveis:

1. **O orquestrador precisa de memória entre ciclos**, mas a implementação perde tool calls/results (problema 1)
2. **O sistema exige completude**, mas `checkCompletion` é um string search frágil (problema 3)
3. **O sistema exige paralelismo**, mas workspace compartilhado causa corrupção (problema 14)
4. **O sistema exige contexto crescente**, mas a compactação destrói tudo (problema 5)
5. **O sistema exige coordenação**, mas sub-agentes retornam apenas texto (problema 9)

Cada um desses problemas sozinho já seria suficiente para causar falhas intermitentes. Juntos, eles criam um sistema que:

- **Não sabe o que já fez** (problema 1 + 5)
- **Não sabe quando parar** (problema 3)
- **Não pode confiar nos resultados dos sub-agentes** (problema 9)
- **Corrompe dados ao tentar paralelizar** (problema 14)
- **Fica preso em loops** (problema 2 + 3 + 8)
- **Bloqueia todos os usuários quando um trava** (problema 12)

---

## Recomendação: Reescrever a Arquitetura

A conclusão é que este sistema não é consertável com patches individuais. A arquitetura precisa ser repensada fundamentalmente — abandonando o "orchestrator loop with tool delegations" em favor de algo como:

### Abordagem Recomendada

1. **Planner separado que gera um DAG de tarefas** — O arquiteto gera um plano estruturado (JSON) com dependências explícitas entre tarefas, não um texto livre em markdown
2. **Execução serial estrita com estado persistido em DB** — Cada tarefa tem estado no banco de dados; o orquestrador não depende de `conversationMessages` para saber o progresso
3. **Resultados estruturados (não texto livre) de cada sub-agente** — Sub-agentes retornam JSON com lista de arquivos criados/modificados, comandos executados, erros encontrados — não apenas texto descritivo
4. **Mecanismo de checkpoint/resume que não depende de `conversationMessages`** — O orquestrador consulta o banco de dados para saber o que já foi feito, não reconstrói contexto a partir de mensagens
5. **Workspace isolado por tarefa** — Cada sub-agente opera num subdiretório próprio, eliminando race conditions de escrita paralela
6. **Múltiplas instâncias de orquestrador** — Um por usuário, não um singleton global
7. **Detecção de completude baseada em verificação, não em string matching** — O orquestrador verifica critérios objetivos (todos os arquivos existem, testes passam, requisitos atendidos) em vez de procurar "PROJECT COMPLETE" no texto

### Stack Tecnológica Sugerida

- **Planner**: LLM gera JSON com schema validado (Zod), não texto livre
- **Executor**: State machine em TypeScript puro, não ToolLoopAgent com tool delegation
- **Sub-agentes**: Mantidos como ToolLoopAgent, mas retornam estrutura `{ filesCreated, filesModified, commandsRun, errors, outputSummary }`
- **Estado**: Tabela `orchestrator_tasks` no SQLite com campos `status`, `result_json`, `depends_on`, `artifact_paths`
- **Progresso**: Calculado a partir de tasks completadas / total de tasks, não de character count heurístico

---

## Apêndice A: Bug Crítico Corrigido — "Too many parameter values were provided"

### Erro Observado nos Logs

```
[OrchestratorRunner] Plan parsed successfully {"sessionId":"53b57a6f-...","count":15}
[OrchestratorRunner] Orchestrator phased workflow failed {"sessionId":"53b57a6f-...","error":"Too many parameter values were provided"}
```

O orquestrador parseava o plano com sucesso (15-16 tasks), mas ao tentar inserir as tasks no banco de dados, crashava com esse erro do SQLite.

### Causa Raiz

**Arquivo**: `src/db/repositories/orchestrator.ts:222-224`

```typescript
// ANTES (BUGADO) — 9 placeholders ? mas 10 argumentos no .run()
'INSERT INTO orchestrator_tasks (id, orchestrator_session_id, name, description, status, role, depends_on, result_json, output, error_message, step_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)'
).run(id, sessionId, input.name, input.description, 'pending', input.role, input.dependsOn ?? null, input.stepNumber, now, now);
```

A coluna `result_json` e suas vizinhas tinham `NULL` hardcoded na SQL. Isso resultava em:

- **13 colunas** no INSERT
- **9 placeholders `?`** + **3 `NULL` literais** = **12 valores**
- Mas `.run()` passava **10 argumentos** para **9 placeholders**

O SQLite (`better-sqlite3`) rejeita quando há mais argumentos do que placeholders.

### Correção Aplicada

```typescript
// DEPOIS (CORRIGIDO) — 13 placeholders ? para 13 colunas, 13 argumentos
'INSERT INTO orchestrator_tasks (id, orchestrator_session_id, name, description, status, role, depends_on, result_json, output, error_message, step_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
).run(id, sessionId, input.name, input.description, 'pending', input.role, input.dependsOn ?? null, null, null, null, input.stepNumber, now, now);
```

Agora todas as 13 colunas usam `?` e os 3 valores NULL são passados como `null` via `.run()`, totalizando 13 argumentos para 13 placeholders.

### Impacto

Sem essa correção, **o orquestrador NUNCA consegue executar nenhuma sessão** — ele crasha imediatamente após a fase de planejamento ao tentar persistir as tasks no banco. O sistema fica completamente inoperante para qualquer uso do orquestrador.

### Nota sobre a Revisão do Laudo

Após a correção deste bug e re-leitura do código atual, constato que a arquitetura foi **significativamente melhorada** desde a versão que analisei inicialmente:

1. O workflow agora é **faseado** (Plan → Execute → Verify) em vez do loop `while` amnésico
2. O estado é **persistido em DB** via `orchestrator_tasks` — não depende de `conversationMessages`
3. As tasks têm **retry com classificação de erros** (transiente vs permanente vs rate-limit)
4. O **progresso** é calculado a partir de tasks completadas, não de heurísticas
5. O orquestrador faz **scan do workspace** antes/depois de cada sub-agente para detectar mudanças

Os problemas teóricos do laudo ainda são válidos como **riscos arquiteturais**, mas a gravidade prática é menor do que a análise original sugeria. O bug SQL era o bloqueador real.
