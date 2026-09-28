# 第三阶段：智能代理运行与 DeepSeek Harness 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让科研事项可以形成可靠 AgentTask/AgentRun，通过稳定 HarnessAdapter 驱动 DeepSeek Harness，并支持上下文快照、故障重试、受控工具权限、人工暂停/继续和结构化科学变更提议。

**Architecture:** Workbench 先创建持久化 AgentTask/Run/ContextSnapshot，再经 Outbox 派发 Worker。HarnessAdapter 首先以 fake 固定契约，再实现 SDKAdapter；一个仓库内的外置 Harness bridge plugin 处理 Workbench 人工问答/一次性审批回桥，不修改 Harness Agent Loop。

**Tech Stack:** DeepSeek Harness TypeScript SDK；pg-boss；TypeScript；PostgreSQL；Harness out-of-tree plugin/profile patch；Vitest。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- Harness Session 不取代 AgentRun；每次正式 Run 必须有 ContextSnapshot。
- ContextSnapshot 不保存密码、token、private key 或模型隐藏推理。
- Harness 不可用时任务进入可重试失败/排队状态，不改变正式科研状态。
- Workbench 只允许 `read-only`、`workspace-write`、显式策略下的 `danger-full-access`。
- Harness/Agent 输出的科学变化只能转换为 ScientificDecision proposal。
- 第一版真实编码子代理验收至少通过 Codex 或 Claude Code 其中一种，另一个保持配置兼容。

## Review Focus

1. Outbox 重投导致同一 AgentRun 被启动两次：dispatch key 必须幂等。
2. Harness 启动后 Worker 崩溃：Run 可通过 session reference/reconciliation 标记，不伪造完成。
3. 运行期间需要人工输入：Run 持久化为 `waiting_human`，服务重启后仍可继续/重新派发。
4. Agent 返回非法或缺字段的结构化输出：Run 标记 failed/requires_review，不写 ResearchResult。
5. 快照与当前项目状态后来发生变化：Run 仍绑定原 snapshot，不静默使用最新正式版本。

---

### Task 1: 建立 AgentTask、AgentRun、AgentContextSnapshot 模型

**Files:**
- Create: `packages/db/src/schema/agent-runtime.ts`
- Create: `packages/domain/src/agent-runtime.ts`
- Create: `packages/application/src/agents/create-agent-task.ts`
- Create: `packages/application/src/agents/create-agent-run.ts`
- Create: `packages/application/src/agents/context-snapshot.ts`
- Test: `tests/integration/agent-runtime-model.test.ts`

**Interfaces:**
- `createAgentTask(researchTaskId, request, actor): Promise<AgentTask>`
- `createAgentRun(agentTaskId, executionPolicy, actor): Promise<AgentRun>`
- `buildAgentContextSnapshot(projectId, refs): Promise<AgentContextSnapshot>`
- Run state enum 逐字实现规格定义。

- [ ] 写失败测试：Run 无 snapshot 不能进入 queued；snapshot immutable；Run #1 failed 后可创建 #2 且 #1 保留。
- [ ] 运行失败。
- [ ] 实现 schema/service。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: add durable agent task and run model"`。

### Task 2: 定义 HarnessAdapter 稳定契约和 FakeAdapter

**Files:**
- Create: `packages/harness-adapter/src/types.ts`
- Create: `packages/harness-adapter/src/adapter.ts`
- Create: `packages/harness-adapter/src/fake-adapter.ts`
- Test: `packages/harness-adapter/src/contract.test.ts`

**Interfaces:**
- `interface HarnessAdapter { start(request: HarnessExecutionRequest): Promise<HarnessExecutionHandle>; resume(request: HarnessResumeRequest): Promise<HarnessExecutionHandle>; cancel(runId: string): Promise<void>; health(): Promise<HarnessHealth>; }`
- `HarnessExecutionRequest` 必含 project/task/run ids、snapshot、cwd、tool/subagent allowlist、sandboxPolicy、outputSchema。
- `HarnessExecutionResult` 只包含可见消息摘要、关键工具事实、artifact refs、GitHub hints、scientificChangeProposals、stopReason。

- [ ] 写契约测试：FakeAdapter 必须实现 start/resume/cancel/health，禁止返回 hiddenReasoning 字段。
- [ ] 运行失败。
- [ ] 实现类型和 FakeAdapter。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: define harness adapter contract"`。

### Task 3: 实现可靠 Agent dispatch/retry Worker

**Files:**
- Create: `packages/queue/src/agent-dispatch.ts`
- Create: `apps/worker/src/agent-worker.ts`
- Create: `packages/application/src/agents/run-lifecycle.ts`
- Test: `tests/integration/agent-dispatch-idempotency.test.ts`

**Interfaces:**
- `dispatchAgentRun(runId): Promise<void>` 幂等；唯一 execution key = AgentRun.id。
- `markRunState(runId, expectedState, nextState, details)` 使用 compare-and-swap。
- 失败重试创建 attempt metadata，但不创建新的 AgentRun；只有用户/系统明确“重新运行”才创建 Run #2。

- [ ] 写失败测试：同一 Outbox 两次投递只 start adapter 一次；adapter unavailable 时状态可重试。
- [ ] 运行失败。
- [ ] 实现 dispatch lifecycle。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: add reliable agent dispatch worker"`。

### Task 4: 实现 DeepSeek Harness SDKAdapter 与运行 profile

**Files:**
- Create: `packages/harness-adapter/src/sdk-adapter.ts`
- Create: `infra/harness/workbench.cordis.yml`
- Create: `infra/harness/README.md`
- Test: `packages/harness-adapter/src/sdk-adapter.test.ts`
- Test: `tests/integration/harness-sdk-smoke.test.ts`

**Interfaces:**
- `SdkHarnessAdapter implements HarnessAdapter`。
- 通过 `@deepseek-ai/dsh-sdk-client` 启动 named profile；workspace cwd 和 env 白名单明确传入。
- 运行完成后保存 Harness session id；无 `DEEPSEEK_API_KEY` 时真实 smoke 测试 SKIP 并明确原因。

- [ ] 写 mock-process 契约失败测试。
- [ ] 运行失败。
- [ ] 实现 SDKAdapter/Profile。
- [ ] 运行无 key 契约测试 + 有 key 时 smoke。
- [ ] Commit: `git commit -am "feat: integrate DeepSeek Harness SDK"`。

### Task 5: 实现 Workbench Harness bridge plugin 的人工问答/审批回桥

**Files:**
- Create: `packages/harness-bridge-plugin/package.json`
- Create: `packages/harness-bridge-plugin/src/index.ts`
- Create: `packages/application/src/agents/human-interaction.ts`
- Create: `apps/web/app/api/internal/agent-interaction/route.ts`
- Modify: `infra/harness/workbench.cordis.yml`
- Test: `packages/harness-bridge-plugin/src/index.test.ts`
- Test: `tests/integration/agent-waiting-human.test.ts`

**Interfaces:**
- Harness plugin 只依赖公开 `userQuestions` / `approval` seam。
- Workbench internal request: `requestHumanInteraction({runId, kind, payload, nonce})`，返回 pending/answer。
- 使用每个 Run 的短期 callback credential reference；credential 值不得落 Session event 或 ResearchEvent。

- [ ] 写失败测试：问题产生后 Run→waiting_human；未回答时不默认批准；回答后 resume。
- [ ] 运行失败。
- [ ] 实现插件和内部 API。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: bridge Harness human interaction"`。

### Task 6: 结构化 Agent 输出、结果落库和科学变更提议

**Files:**
- Create: `packages/application/src/agents/result-ingestion.ts`
- Create: `packages/domain/src/agent-output.ts`
- Test: `packages/application/src/agents/result-ingestion.test.ts`

**Interfaces:**
- `ingestAgentResult(runId, result: HarnessExecutionResult): Promise<void>`。
- 科学变化映射为 `ScientificDecision` with actor type `agent`。
- ResearchResult 只有满足 schema、必要 refs、执行状态 completed 时才能创建。

- [ ] 写失败测试：非法 schema、缺 commit 的代码结果、scientific proposal 均不能直接改 official pointer。
- [ ] 运行失败。
- [ ] 实现 ingestion。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: ingest controlled agent outcomes"`。

### Task 7: 配置 Harness Codex/Claude Code 子代理并完成一种真实链路

**Files:**
- Modify: `infra/harness/workbench.cordis.yml`
- Create: `infra/harness/presets/research-execution.yml`
- Create: `tests/integration/harness-code-subagent-smoke.test.ts`

**Interfaces:**
- Provider names 固定：`codex`、`claude-code`。
- 默认编码任务只允许 workspace-write；danger full access 不出现在默认 preset。
- 真实验收通过环境变量选择 `RW_CODE_SUBAGENT=codex|claude-code`。

- [ ] 写 smoke test harness：要求子代理在临时 Git 工作区创建一个受测文件并返回最终摘要。
- [ ] 无 provider credential 时测试 SKIP；有配置时必须实际运行。
- [ ] 配置至少一个 provider 完成真实测试。
- [ ] 保存 workspace change facts 到 AgentRun artifact refs。
- [ ] Commit: `git commit -am "feat: enable Harness coding subagents"`。

### Task 8: 实现“智能工作”页面与阶段验收

**Files:**
- Create: `apps/web/app/(app)/agent-work/page.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/agent-work/page.tsx`
- Create: `apps/web/src/components/agent-runs/*`
- Test: `tests/acceptance/agent-runtime.spec.ts`

**Interfaces:**
- 页面区分 AgentTask 与 Run attempts；展示 snapshot refs、Harness session、状态、等待人工输入。
- 用户不必选择具体模型；高级详情可展开 provider/model/session。

- [ ] 写 E2E 失败测试：创建科研事项→AgentTask→Run→等待/完成→结果；失败 Run 保留且可“重新运行”生成 Run #2。
- [ ] 运行失败。
- [ ] 实现 UI。
- [ ] 阶段验证：`pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance/agent-runtime.spec.ts`；有 Harness 凭据时再跑真实 smoke。
- [ ] Commit: `git commit -am "feat: deliver controlled agent workbench"`。

## 第三阶段人工验收

- 用户可从科研事项创建 AgentTask，并看到每次 Run。
- 每个 Run 可查看冻结上下文与 Harness Session reference。
- Harness 不可用不会改变正式科研状态。
- 人工问答不会默认批准；等待和继续有持久状态。
- 至少 Codex/Claude Code 一条真实子代理链通过测试环境验收。
