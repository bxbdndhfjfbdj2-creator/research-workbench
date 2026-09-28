# 第一阶段：基础工作台与科研事实底座 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可登录的六人内部工作台、研究项目/成员/多维状态、追加科研事件、事务发件箱/可靠收件箱和最小 Web 界面，为后续科研治理和 Agent 执行提供稳定事实底座。

**Architecture:** 以 pnpm workspace 建立模块化单体；`domain` 保持纯 TypeScript；`db` 使用 Drizzle + PostgreSQL；`application` 在单个数据库事务中同时写当前状态、ResearchEvent 和 OutboxEvent；`worker` 使用 pg-boss 处理可靠异步工作。Web 只调用 application API，不直接写表。

**Tech Stack:** TypeScript；Node.js >=22.19；pnpm 11.7；Next.js；Drizzle ORM；PostgreSQL；Better Auth；pg-boss；Vitest；Playwright。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- 固定 6 人、单团队、管理员预创建用户、无公众注册。
- 数据模型不把项目数量写死为 5。
- ResearchEvent 只追加；Outbox 与业务状态同事务提交。
- AI actor 与 human actor 必须可区分。
- 任何秘密不得进入 ResearchEvent、普通日志或上下文快照。
- 当前阶段不接 Harness、不接真实 GitHub、不做共享资产。

## Review Focus

1. 两个并发请求重复创建同一外部事件：`IntegrationInbox.externalId` 唯一约束只接受一次。
2. 数据库事务提交后 Worker 崩溃：Outbox 保持 pending，重启后可继续。
3. 普通成员访问未参与的项目：应用层授权返回 forbidden。
4. 管理员误创建第 7 个激活成员：第一版团队成员容量规则拒绝。
5. Secret-shaped 字段进入事件 payload：事件序列化器拒绝 `password`、`token`、`secret`、`privateKey` 等保留键。

---

### Task 1: 初始化 pnpm 工作区、质量脚本和最小应用

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `apps/web/package.json`
- Create: `apps/web/app/page.tsx`
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/main.ts`
- Create: `packages/config/package.json`
- Create: `packages/config/src/env.ts`
- Create: `packages/domain/package.json`
- Create: `packages/db/package.json`
- Create: `packages/application/package.json`
- Create: `packages/queue/package.json`
- Create: `tests/integration/vitest.config.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: 根脚本 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
- Produces: 基线 GitHub Actions CI，在每个 PR 上执行 lockfile install、typecheck、lint、test、build；第六阶段再增强镜像、安全和部署 gate。
- Produces: `loadConfig(env: NodeJS.ProcessEnv): AppConfig`，只返回已验证的非秘密元数据和 secret reference，不打印秘密。

- [ ] **Step 1: 写失败的工作区烟雾测试**

在 `packages/config/src/env.test.ts` 写测试：缺少 `DATABASE_URL` 时 `loadConfig` 抛错；存在必需变量时返回配置，错误文本不得包含 secret 值。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @research-workbench/config test`  
Expected: FAIL，因为 `loadConfig` 尚不存在。

- [ ] **Step 3: 实现最小工作区和 `loadConfig(env)`**

根 scripts 固定提供 `typecheck`、`lint`、`test`、`build`；Node engine 固定 `>=22.19`，packageManager 固定 `pnpm@11.7.0`。

- [ ] **Step 4: 验证**

Run: `pnpm install && pnpm typecheck && pnpm --filter @research-workbench/config test && pnpm build`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: initialize Research Workbench workspace and CI"
```

### Task 2: 建立核心数据库 schema 与迁移

**Files:**
- Create: `packages/db/src/schema/team.ts`
- Create: `packages/db/src/schema/member.ts`
- Create: `packages/db/src/schema/project.ts`
- Create: `packages/db/src/schema/research-event.ts`
- Create: `packages/db/src/schema/outbox.ts`
- Create: `packages/db/src/schema/integration-inbox.ts`
- Create: `packages/db/src/schema/index.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/migrations/*`
- Create: `tests/integration/support/postgres.ts`
- Test: `tests/integration/db-foundation.test.ts`

**Interfaces:**
- Produces: `DbClient`。
- Produces tables: `teams`, `members`, `research_portfolios`, `research_projects`, `project_memberships`, `research_dimension_states`, `research_events`, `outbox_events`, `integration_inbox`。
- `members.actorType` enum: `human | agent | system`；登录用户只能是 `human`。

- [ ] **Step 1: 写数据库失败测试**

断言：同一团队最多 6 个 active human members；`integration_inbox(provider, externalId)` 唯一；ResearchEvent 无 update/delete repository API。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/integration/db-foundation.test.ts`  
Expected: FAIL，schema/migration 尚不存在。

- [ ] **Step 3: 实现 schema、迁移和测试数据库 helper**

容量规则由 application 服务在 serializable transaction 中实现；数据库对 email/team、inbox externalId 建唯一约束。集成测试使用 `@testcontainers/postgresql` 启动隔离 PostgreSQL，不依赖开发者手工准备数据库。

- [ ] **Step 4: 验证**

Run: `pnpm db:migrate:test && pnpm vitest run tests/integration/db-foundation.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/db tests/integration
git commit -m "feat: add foundational research database"
```

### Task 3: 建立科研事件、Secret-safe payload 与事务发件箱服务

**Files:**
- Create: `packages/domain/src/actor.ts`
- Create: `packages/domain/src/events.ts`
- Create: `packages/application/src/events/append-research-event.ts`
- Create: `packages/application/src/outbox/enqueue-outbox.ts`
- Create: `packages/application/src/transactions.ts`
- Test: `packages/application/src/events/append-research-event.test.ts`
- Test: `tests/integration/outbox-atomicity.test.ts`

**Interfaces:**
- Produces: `appendResearchEvent(tx, event: ResearchEventInput): Promise<ResearchEventRecord>`。
- Produces: `enqueueOutbox(tx, event: OutboxInput): Promise<OutboxRecord>`。
- Produces: `assertSecretSafe(value: JsonValue): void`。
- `ResearchEventInput.actor` 必须是 `{ type: 'human'|'agent'|'system'; id: string }`。

- [ ] **Step 1: 写失败测试**

测试 secret 保留键被拒绝；同一 transaction 中项目状态更新失败时 ResearchEvent 和 Outbox 都不落库；成功时三者同时提交。

- [ ] **Step 2: 运行失败**

Run: `pnpm vitest run packages/application/src/events/append-research-event.test.ts tests/integration/outbox-atomicity.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现最小事务 API**

禁止提供 `updateResearchEvent` / `deleteResearchEvent`。

- [ ] **Step 4: 验证**

运行同一测试命令，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/domain packages/application tests/integration
git commit -m "feat: add append-only research events and outbox"
```

### Task 4: 实现固定六人内部身份与登录

**Files:**
- Create: `packages/application/src/auth/create-internal-member.ts`
- Create: `packages/application/src/auth/authorize.ts`
- Create: `apps/web/src/auth.ts`
- Create: `apps/web/app/login/page.tsx`
- Create: `scripts/bootstrap-team.ts`
- Test: `packages/application/src/auth/authorize.test.ts`
- Test: `tests/integration/auth-capacity.test.ts`

**Interfaces:**
- Produces: `createInternalMember(input: {email:string; displayName:string; organizationRole:'lead'|'researcher'}): Promise<Member>`。
- Produces: `authorizeProjectAccess(actorId, projectId, action): Promise<void>`。
- `bootstrap-team.ts` 创建 1 个 Team、1 个默认 `ResearchPortfolio`、1 lead + 5 researcher；密码只通过 Better Auth credential store 处理，不写入业务表。

- [ ] **Step 1: 写失败测试**

测试第 7 名 active human 被拒绝、没有 public signup route、非项目成员读取项目被拒绝、总负责人可读取全部项目。

- [ ] **Step 2: 运行失败**

Run: `pnpm vitest run packages/application/src/auth/authorize.test.ts tests/integration/auth-capacity.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 Better Auth 集成和 bootstrap**

不实现自助注册页面/API。

- [ ] **Step 4: 验证**

Run: `pnpm test && pnpm typecheck`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/application scripts
git commit -m "feat: add internal six-member authentication"
```

### Task 5: 实现研究项目、成员关系和多维科研状态

**Files:**
- Create: `packages/domain/src/research-dimensions.ts`
- Create: `packages/application/src/projects/create-project.ts`
- Create: `packages/application/src/projects/set-project-membership.ts`
- Create: `packages/application/src/projects/set-dimension-state.ts`
- Test: `packages/application/src/projects/project-service.test.ts`

**Interfaces:**
- Produces: `createProject(input: { portfolioId:string; title:string; leadMemberId:string }): Promise<ResearchProject>`。
- `ProjectMembershipRole = 'lead'|'collaborator'|'method_challenger'|'theory_replication_challenger'|'observer'`。
- Produces: `setProjectMembership(projectId, memberId, role: ProjectMembershipRole): Promise<ProjectMembership>`。
- Produces: `setDimensionState(projectId, dimension, state, actor): Promise<ResearchDimensionState>`。
- 维度与状态枚举必须逐字匹配批准规格。

- [ ] **Step 1: 写失败测试**

验证同一项目可同时处于 `理论=修订/探索中`、`数据=冻结`、`主分析=验证中`；状态不要求线性迁移；每次正式改变产生 `RESEARCH_STATE_CHANGED`。

- [ ] **Step 2: 运行失败**

Run: `pnpm --filter @research-workbench/application test -- project-service`  
Expected: FAIL。

- [ ] **Step 3: 实现三个用例服务**

所有写操作调用 Task 3 的事务/事件 API。

- [ ] **Step 4: 验证**

Run: `pnpm test`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/domain packages/application
git commit -m "feat: add projects memberships and research states"
```

### Task 6: 实现 ResearchTask 科研事项

**Files:**
- Create: `packages/db/src/schema/research-task.ts`
- Create: `packages/domain/src/research-task.ts`
- Create: `packages/application/src/tasks/research-task-service.ts`
- Test: `packages/application/src/tasks/research-task-service.test.ts`

**Interfaces:**
- `ResearchTaskStatus = 'open'|'in_progress'|'blocked'|'completed'|'cancelled'`。
- `createResearchTask(projectId, input, actor): Promise<ResearchTask>`。
- `assignResearchTask(taskId, memberId, actor): Promise<ResearchTask>`。
- `setResearchTaskStatus(taskId, status, actor): Promise<ResearchTask>`。
- ResearchTask 是科研工作事项，不承载正式科学审批，也不替代 ScientificDecision。

- [ ] **Step 1: 写失败测试**

覆盖：项目成员可创建事项；无权成员 forbidden；任务状态变化产生科研事件；完成 ResearchTask 不自动改变任何正式研究节点或维度状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run packages/application/src/tasks/research-task-service.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 ResearchTask schema/service**

所有 mutation 使用阶段一授权和 ResearchEvent API；为第三阶段 AgentTask 保留稳定 `researchTaskId`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run packages/application/src/tasks/research-task-service.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/research-task.ts packages/domain/src/research-task.ts packages/application/src/tasks
git commit -m "feat: add research tasks"
```

### Task 7: 实现可靠 Outbox Worker 与通用 Inbox 去重

**Files:**
- Create: `packages/queue/src/outbox-dispatcher.ts`
- Create: `packages/queue/src/inbox.ts`
- Create: `apps/worker/src/outbox-worker.ts`
- Modify: `apps/worker/src/main.ts`
- Test: `tests/integration/outbox-retry.test.ts`
- Test: `tests/integration/inbox-idempotency.test.ts`

**Interfaces:**
- Produces: `claimOutboxBatch(limit: number): Promise<OutboxRecord[]>`。
- Produces: `markOutboxDelivered(id)` / `markOutboxFailed(id, error)`。
- Produces: `acceptExternalEvent(provider, externalId, payload): Promise<{accepted:boolean; inboxId:string}>`。
- pg-boss 只负责 Worker 作业生命周期；业务必须以 Outbox/Inbox 表为事实。

- [ ] **Step 1: 写失败测试**

模拟“业务 transaction commit 后、派发前进程崩溃”，重启 dispatcher 后事件仍执行一次；相同 externalId 三次投递只 accepted 一次。

- [ ] **Step 2: 运行失败**

Run: `pnpm vitest run tests/integration/outbox-retry.test.ts tests/integration/inbox-idempotency.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 dispatcher/inbox**

使用数据库锁避免两个 Worker 同时认领同一 Outbox。

- [ ] **Step 4: 验证**

同一测试命令，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/queue apps/worker tests/integration
git commit -m "feat: add reliable outbox and inbox processing"
```

### Task 8: 实现最小研究组合和项目 Web 外壳

**Files:**
- Create: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/app/(app)/portfolio/page.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/page.tsx`
- Create: `apps/web/app/(app)/team/page.tsx`
- Create: `apps/web/src/server/queries.ts`
- Create: `packages/ui/src/*`
- Test: `tests/acceptance/phase-01.spec.ts`

**Interfaces:**
- Portfolio 页面读取项目多维状态和需要当前用户处理的基础事项。
- Project 页面第一阶段只展示总览、成员、维度状态；其余正式导航项可以显示 disabled/coming in approved phase，不增加规格外一级导航。

- [ ] **Step 1: 写 Playwright 失败测试**

管理员 bootstrap 后：lead 登录可见五个项目占位/已创建项目；researcher 登录只看到参与项目；可进入项目并看到多维状态。

- [ ] **Step 2: 运行失败**

Run: `pnpm playwright test tests/acceptance/phase-01.spec.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现最小 Web UI**

不加入通用任务看板、聊天首页或规格外导航。

- [ ] **Step 4: 阶段验证**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance/phase-01.spec.ts && pnpm build`  
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/ui tests/acceptance
git commit -m "feat: deliver phase one research workbench shell"
```

## 第一阶段人工验收

- 1 名总负责人和 5 名研究成员均能使用预创建账户登录。
- 不存在公众注册入口。
- 能创建研究项目并分配主理人/协作者/挑战者。
- 总负责人能看到所有项目，成员只能看到有权访问的项目。
- 一个项目可同时显示不同维度状态而不是单一阶段。
- ResearchEvent、Outbox、Inbox 可在数据库中追踪。
- 重启 Worker 后未完成 Outbox 可继续处理。
