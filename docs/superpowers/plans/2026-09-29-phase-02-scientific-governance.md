# 第二阶段：研究网络、证据与科学治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现非线性研究网络、节点版本、科研分支、不可变研究结果，以及一般/重大科学决策的双层审批和科学决策锁。

**Architecture:** 研究节点身份与 revision 分离；正式指针只能通过 application 用例改变；ScientificDecision/DecisionReview 状态机控制正式变更。研究图允许有向环以表达“回到”，但所有 revision 和 result 保持不可变。

**Tech Stack:** 延续阶段一；Drizzle/PostgreSQL；Vitest；Playwright。

**Spec:** `docs/superpowers/specs/2026-09-29-research-workbench-design.md`

## Global Constraints

- 旧 revision/result/branch 不因未采用而删除。
- AI actor 只能创建 proposal，不可提交 human approval。
- 重大变更：核心研究问题、正式理论、主测量、主样本、主数据版本、识别策略、主模型、探索→正式、论文核心主张。
- 项目主理人可批准一般决策；重大决策需主理人提议 + 总负责人批准。
- ResearchEdge 允许环，不把科研网络错误地当 DAG。

## Review Focus

1. AI actor 调用正式指针 API：必须 forbidden。
2. 主理人先批准重大变更但 lead 尚未批准：正式指针仍保持旧 revision。
3. 两个并发审批请求：只能有一个合法状态推进，不能重复产生 `OFFICIAL_REVISION_CHANGED`。
4. 已关闭失败分支重新开启：历史终止原因保留并产生新的 reopen event。
5. 已创建 ResearchResult 被 update/delete：repository API 不提供能力，数据库触发/策略拒绝变更。

---

### Task 1: 建立 ResearchNode/Revision/Edge/Branch 数据模型

**Files:**
- Create: `packages/db/src/schema/research-graph.ts`
- Create: `packages/domain/src/research-graph.ts`
- Create: `packages/application/src/research-graph/node-service.ts`
- Create: `packages/application/src/research-graph/branch-service.ts`
- Test: `tests/integration/research-graph.test.ts`

**Interfaces:**
- `createResearchNode(projectId, type, title, actor): Promise<ResearchNode>`
- `createNodeRevision(nodeId, content, status, actor): Promise<ResearchNodeRevision>`
- `linkResearchNodes(fromNodeId, toNodeId, relation, actor): Promise<ResearchEdge>`
- `createResearchBranch(projectId, name, originNodeId, actor): Promise<ResearchBranch>`
- `closeResearchBranch(branchId, reason, actor)` / `reopenResearchBranch(branchId, actor)`

- [ ] 写失败测试：revision 不可覆盖；edge 可形成 A→B→A；关闭/重开分支保留历史。
- [ ] Run: `pnpm vitest run tests/integration/research-graph.test.ts`，Expected: FAIL。
- [ ] 实现 schema 和服务，并写对应 ResearchEvent。
- [ ] 重跑测试，Expected: PASS。
- [ ] Commit: `git commit -am "feat: add nonlinear research graph"`。

### Task 2: 建立正式 revision 指针与变更提议边界

**Files:**
- Create: `packages/db/src/schema/official-revisions.ts`
- Create: `packages/application/src/research-graph/official-revision.ts`
- Test: `packages/application/src/research-graph/official-revision.test.ts`

**Interfaces:**
- `getOfficialRevision(projectId, slot): Promise<ResearchNodeRevision | null>`
- `proposeOfficialRevisionChange(input): Promise<ScientificDecision>`
- 内部方法 `applyApprovedOfficialRevisionChange(tx, decisionId): Promise<void>` 仅可由决策状态机调用，不导出到普通 UI/Agent API。

- [ ] 写失败测试：human 也不能绕过 decision 直接切换重大 slot；AI proposal 不改 pointer。
- [ ] 运行失败。
- [ ] 实现 pointer/read API 与仅内部 mutation。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: gate official research revisions"`。

### Task 3: 实现 ScientificDecision 与双层 DecisionReview 状态机

**Files:**
- Create: `packages/db/src/schema/scientific-decision.ts`
- Create: `packages/domain/src/scientific-decision.ts`
- Create: `packages/application/src/decisions/create-decision.ts`
- Create: `packages/application/src/decisions/review-decision.ts`
- Create: `packages/application/src/decisions/apply-decision.ts`
- Test: `packages/application/src/decisions/decision-state-machine.test.ts`
- Test: `tests/integration/decision-concurrency.test.ts`

**Interfaces:**
- `createScientificDecision(input: DecisionProposal, actor): Promise<ScientificDecision>`
- `reviewScientificDecision(decisionId, action: 'approve'|'reject'|'request_evidence', actor): Promise<ScientificDecision>`
- `DecisionLevel = 'general'|'major'`。
- AI actor 只能调用 create，且 decision 永远从 `proposed` 开始。

- [ ] 写状态机失败测试，覆盖一般/重大/AI/并发。
- [ ] 运行失败。
- [ ] 实现状态机；重大决策只有 lead final approval 后调用 Task 2 internal mutation。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: add scientific decision lock"`。

### Task 4: 实现不可变 ResearchResult 与证据关联

**Files:**
- Create: `packages/db/src/schema/research-result.ts`
- Create: `packages/domain/src/research-result.ts`
- Create: `packages/application/src/results/create-result.ts`
- Create: `packages/application/src/results/link-evidence.ts`
- Test: `tests/integration/research-result-immutability.test.ts`

**Interfaces:**
- `createResearchResult(input): Promise<ResearchResult>`
- `supersedeResearchResult(newResultId, oldResultId, actor): Promise<void>`
- 结果至少保存 dataVersionRef、analysisRevisionId、codeCommitRef（代码型结果必需）、runRef、outputRefs。

- [ ] 写失败测试：创建后不能 update；supersedes 不删除旧 result；代码型正式结果无 commit 时拒绝。
- [ ] 运行失败。
- [ ] 实现 schema/service。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: add immutable research results"`。

### Task 5: 实现研究网络与证据/结果界面

**Files:**
- Create: `apps/web/app/(app)/projects/[projectId]/network/page.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/evidence/page.tsx`
- Create: `apps/web/src/components/research-graph/*`
- Test: `tests/acceptance/research-network.spec.ts`

**Interfaces:**
- 研究网络展示节点、revision 状态、edge、branch；明确标识“正式/候选/已否定/已关闭”。
- 失败分支仍可浏览；不提供删除失败路线按钮。

- [ ] 写 Playwright 失败测试：构造两条竞争机制和一条已关闭分支，UI 均可查看。
- [ ] 运行失败。
- [ ] 实现网络和证据页面。
- [ ] 验证 PASS。
- [ ] Commit: `git commit -am "feat: visualize research graph and evidence"`。

### Task 6: 实现科学决策中心和审批 UI

**Files:**
- Create: `apps/web/app/(app)/decisions/page.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/decisions/page.tsx`
- Create: `apps/web/src/components/decisions/*`
- Test: `tests/acceptance/scientific-decision-lock.spec.ts`

**Interfaces:**
- 主理人看到一般决策和重大决策提议。
- 总负责人看到等待 final approval 的重大决策。
- UI 展示触发原因、证据、影响、已有 reviews；按钮权限来自 server authorization，不只靠前端隐藏。

- [ ] 写 E2E 失败测试：AI proposal → 主理人 approve → pointer 不变 → lead approve → pointer 变化；旧 revision 仍可见。
- [ ] 运行失败。
- [ ] 实现 UI/server actions。
- [ ] 阶段验证：`pnpm typecheck && pnpm lint && pnpm test && pnpm playwright test tests/acceptance/scientific-decision-lock.spec.ts tests/acceptance/research-network.spec.ts`。
- [ ] Commit: `git commit -am "feat: deliver scientific governance workflow"`。

## 第二阶段人工验收

- 能从研究问题/理论/机制/测量/设计等节点形成非线性网络。
- 可以创建竞争分支、关闭失败分支、重新开启而不丢历史。
- AI 的科学变化只能成为 proposal。
- 重大变化必须经过两级人类批准。
- 正式 revision/result 旧版本始终可回看。
