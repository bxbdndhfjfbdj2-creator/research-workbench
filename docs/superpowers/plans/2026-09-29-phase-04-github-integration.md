# 第四阶段：GitHub 工程事实与持续集成语义 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把科研工程工作与 GitHub Issue/Branch/Commit/PR/Review/Workflow Run 可靠关联，并保证没有真实 Commit/CI 的编码工作不能被 Workbench 标记为工程验证完成。

**Architecture:** 使用 GitHub App + Octokit；Workbench 只保存 GitHubReference 与必要缓存，不复制 GitHub。Webhook 先写 IntegrationInbox，再异步 reconcile；所有工程验证状态以 GitHub API/Webhook 为事实。

**Tech Stack:** `@octokit/app`、`@octokit/rest`、PostgreSQL Inbox/Outbox、Next.js Route Handler、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- GitHub credentials 只从 secret reference/env 注入，不进入 ResearchEvent。
- Agent 不得直接写 `main`；工程工作必须有 branch。
- “已验证”要求：存在 Commit，关联 PR 已合并，要求的 CI checks 成功。
- GitHub 不可用时保持 pending/unknown，不推断成功。
- Webhook 重复、乱序均不得重复改变业务状态。

## Review Focus

1. 相同 delivery id 重复三次：只处理一次。
2. Webhook 先收到 workflow completed，后收到 PR merged：reconcile 后状态正确。
3. API 429/5xx：使用可重试错误，不标记工程完成。
4. Agent 声称有 commit 但 SHA 不存在：引用保持 unverified。
5. PR 合并后 required check 失败或被取消：工程验证状态不得为 verified。

---

### Task 1: 建立 GitHubReference 与工程验证模型

**Files:**
- Create: `packages/db/src/schema/github.ts`
- Create: `packages/domain/src/github.ts`
- Create: `packages/application/src/github/link-reference.ts`
- Test: `tests/integration/github-reference.test.ts`

**Interfaces:**
- `GitHubReferenceType = 'issue'|'branch'|'commit'|'pull_request'|'review'|'workflow_run'`。
- `linkGitHubReference(subject, reference, actor): Promise<GitHubReference>`。
- `EngineeringVerification = 'unverified'|'pending_ci'|'verified'|'failed'|'unknown'`。

- [ ] **Step 1: 写失败测试**

覆盖：同一 repo/type/externalId 幂等；引用可关联 AgentRun/ResearchTask/ResearchResult；不存在的 commit 不能被标记 verified。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/github-reference.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 schema/service**

GitHubReference 保存 owner/repo/type/externalId/url/verifiedAt/cache，不复制完整 diff。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/integration/github-reference.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/github.ts packages/domain/src/github.ts packages/application/src/github/link-reference.ts tests/integration/github-reference.test.ts
git commit -m "feat: add GitHub engineering references"
```

### Task 2: 实现 GitHub App adapter 与 Fake contract

**Files:**
- Create: `packages/github-adapter/src/types.ts`
- Create: `packages/github-adapter/src/adapter.ts`
- Create: `packages/github-adapter/src/fake-adapter.ts`
- Create: `packages/github-adapter/src/octokit-adapter.ts`
- Test: `packages/github-adapter/src/contract.test.ts`

**Interfaces:**
- `getCommit(repo, sha): Promise<GitCommit | null>`
- `getPullRequest(repo, number): Promise<GitPullRequest | null>`
- `getRequiredChecks(repo, ref): Promise<GitCheckSummary[]>`
- `createIssue(repo, input): Promise<GitIssue>`
- `createBranch(repo, base, name): Promise<GitBranch>`
- Workbench 不提供 `directCommitToMain` 方法。

- [ ] **Step 1: 写失败契约测试**

Fake 与 Octokit adapter 必须实现同一接口；GitHub App private key 不得出现在错误消息/日志。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/github-adapter/src/contract.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 GitHub App auth 和 adapter**

认证使用 App ID/private key/installation id 的 secret references；API 429/5xx 映射为 retryable integration error。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/github-adapter/src/contract.test.ts`  
Expected: PASS；有测试 App 凭据时额外执行真实 read-only smoke。

- [ ] **Step 5: Commit**

```bash
git add packages/github-adapter
git commit -m "feat: add GitHub App adapter"
```

### Task 3: 实现 GitHub Webhook 入口与 Inbox 去重

**Files:**
- Create: `apps/web/app/api/integrations/github/webhook/route.ts`
- Create: `packages/github-adapter/src/webhook.ts`
- Create: `packages/application/src/github/process-webhook.ts`
- Test: `tests/integration/github-webhook-idempotency.test.ts`

**Interfaces:**
- 校验 `X-Hub-Signature-256`。
- externalId 使用 GitHub delivery id。
- Route 只负责验证、持久化、快速返回；业务处理由 worker 异步完成。

- [ ] **Step 1: 写失败测试**

坏签名返回 401；同 delivery 三次只有一次 accepted；未知但签名合法的事件可记录为 ignored，不抛 500。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/github-webhook-idempotency.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 route/processor**

处理结果写回 IntegrationInbox；重复 delivery 不再次创建 Outbox。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/integration/github-webhook-idempotency.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/integrations/github/webhook packages/github-adapter/src/webhook.ts packages/application/src/github/process-webhook.ts tests/integration/github-webhook-idempotency.test.ts
git commit -m "feat: add reliable GitHub webhook ingestion"
```

### Task 4: 实现工程完成/验证状态机

**Files:**
- Create: `packages/application/src/github/verification.ts`
- Test: `packages/application/src/github/verification.test.ts`

**Interfaces:**
- `reconcileEngineeringVerification(subjectId): Promise<EngineeringVerification>`。
- 固定规则：无 commit→unverified；有 commit 但无 merged PR→unverified；PR merged 但 required checks 未全部 success→pending_ci/failed；全部满足→verified。
- GitHub API 不可用→unknown，并排队重试。

- [ ] **Step 1: 写失败测试**

覆盖规格中的“无 commit / CI fail / merged+pass”，并加入 webhook 乱序后 reconcile 收敛测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/application/src/github/verification.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 reconcile**

状态由 GitHubAdapter 实际读取，不使用 Agent 文本自报。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/application/src/github/verification.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/github/verification.ts packages/application/src/github/verification.test.ts
git commit -m "feat: verify engineering work from GitHub facts"
```

### Task 5: 关联 AgentRun 与 GitHub 工程对象

**Files:**
- Create: `packages/application/src/agents/github-linking.ts`
- Modify: `packages/application/src/agents/result-ingestion.ts`
- Test: `packages/application/src/agents/github-linking.test.ts`

**Interfaces:**
- Agent result 中的 GitHub hints 必须经过 GitHubAdapter 验证后才创建 verified reference。
- `linkAgentRunEngineering(runId, refs): Promise<void>` 不接受裸 URL 作为已验证 commit。

- [ ] **Step 1: 写失败测试**

虚假 SHA/PR、其他仓库同名 branch、Agent 自称 CI PASS 都不能产生 verified 工程状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/application/src/agents/github-linking.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 linking**

任何代码型 ResearchResult 创建前复用 Task 4 的 verification 结果。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/application/src/agents/github-linking.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/agents/github-linking.ts packages/application/src/agents/github-linking.test.ts packages/application/src/agents/result-ingestion.ts
git commit -m "feat: link agent runs to verified GitHub facts"
```

### Task 6: 实现工程事实 UI 与阶段验收

**Files:**
- Create: `apps/web/src/components/github-references/*`
- Modify: `apps/web/app/(app)/projects/[projectId]/agent-work/page.tsx`
- Test: `tests/acceptance/github-engineering-truth.spec.ts`

**Interfaces:**
- UI 展示 repo/branch/commit/PR/CI，不重复实现 GitHub diff。
- `verified` 状态只来自 server reconcile。

- [ ] **Step 1: 写 E2E 失败测试**

Agent 声称完成但无 commit→未验证；commit+PR+CI fail→未通过；merged+CI success→verified；GitHub unavailable→unknown。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm playwright test tests/acceptance/github-engineering-truth.spec.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 UI**

使用 FakeGitHubAdapter 跑 deterministic E2E。

- [ ] **Step 4: 阶段验证**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance/github-engineering-truth.spec.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/github-references apps/web/app/(app)/projects/[projectId]/agent-work tests/acceptance/github-engineering-truth.spec.ts
git commit -m "feat: expose GitHub engineering truth"
```

## 第四阶段人工验收

- 任一 Agent/人员的代码工作都能回到 GitHub branch/commit/PR。
- 没有 Commit 或 CI 失败时不能显示“工程验证通过”。
- Webhook 重复/乱序不会产生重复科研变化。
- GitHub 暂时不可用时 UI 显示 pending/unknown，不伪造成功。
