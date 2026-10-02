# Phase 5 — GitHub Engineering Truth Integration 设计规格

日期：2026-10-02

状态：**Conversational design approved; written spec pending human review**

基线：

- Phase 4C implementation exact head：`4bf90740930f8d2cf828cb95e020b6fdccd9b741`
- Phase 5 design branch：`phase/05-github-engineering-truth-design`

相关规格：

- `docs/superpowers/specs/2026-09-29-research-workbench-design.md`
- `docs/superpowers/plans/2026-09-29-research-workbench-roadmap.md`
- `docs/superpowers/specs/2026-10-01-phase-04c-progress-projections-cockpit-design.md`
- `docs/superpowers/reviews/2026-10-01-phase-04c-verification.md`

历史参考：

- `docs/superpowers/plans/2026-09-29-phase-04-github-integration.md`

该历史计划保留但不得直接执行；Phase 5 以本规格重新编号和重写。

---

## 1. 阶段定位

Phase 5 的正式定位是：

**GitHub Engineering Truth Integration**

目标不是复制 GitHub，也不是让 Workbench 变成 DevOps 平台，而是建立最小、可审计、可恢复的 GitHub 工程事实映射，使 Research Workbench 能够回答：

1. 一个 ResearchResult / ResearchTask / AgentRun 声称关联了什么 GitHub 工程对象；
2. GitHub 当前是否确认这些对象存在；
3. 某个 commit 是否满足当前版本化的工程验证规则；
4. Webhook 重复、乱序、丢失或 GitHub outage 时，Workbench 是否仍能收敛到正确工程事实；
5. 工程验证是否始终与科研完成、Agent 执行状态、科学审批保持分离。

三平面边界保持：

- Research Workbench = 科研/工作流事实；
- DeepSeek Harness = AI 执行事实；
- GitHub = 工程事实。

Phase 5 只负责 GitHub engineering truth 的 read/reconcile integration。

**Phase 5 不给 Agent 新增 GitHub write / merge credentials。**

未来若新增 Agent 自动写 GitHub、创建 PR 或 merge 能力，必须单独经过 branch/ruleset/no-bypass 治理设计与权限闸门。Phase 5 中“direct push 不算 verified”不是“已经阻止 direct push”的替代说法。

---

## 2. 核心不变量

### 2.1 Claim、Target、Reference、Verification 四层分离

必须严格区分：

```text
Agent/Human claim
    ↓
EngineeringVerificationTarget
    ↓ GitHub authoritative resolution
GitHubReference
    ↓ versioned policy evaluation
EngineeringVerification
```

- claim/hint = 未可信输入；
- EngineeringVerificationTarget = Workbench-side normalized immutable verification target；
- GitHubReference = GitHub 已确认的工程对象；
- EngineeringVerification = 当前可重算工程验证 projection。

### 2.2 科研语义不被工程验证写回

以下永远不成立：

```text
EngineeringVerification = verified
⇒ ResearchTask = completed

EngineeringVerification = verified
⇒ AgentRun = completed

EngineeringVerification = verified
⇒ ScientificDecision = approved
```

工程事实可以作为 Review/Decision evidence，但不能成为审批者。

### 2.3 GitHub 不可用时 fail closed

GitHub timeout / 5xx / 429 / auth unavailable 时：

```text
state = unknown
```

不得推断为 verified、failed 或 commit_not_found。

### 2.4 Agent hint 永远不是工程事实

Agent 可以产生：

```text
github_hint
```

但只有 GitHubAdapter 的权威读取可以产生 confirmed `GitHubReference`。

---

## 3. GitHubInstallation

Private repository 认证采用 GitHub App installation。

```ts
type GitHubInstallation = {
  id: string;
  githubInstallationId: string;
  accountId: string;
  accountLogin: string;
  status: "active" | "suspended" | "removed";
  lastObservedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

数据库只保存 installation identity，不保存 installation access token。

以下只来自 secret/env/secret manager：

- GitHub App private key；
- webhook secret；
- installation access token。

Installation token 按需生成并按 GitHub 生命周期刷新，不写入 ResearchEvent、Outbox、日志或普通 DB 字段。

---

## 4. ProjectGitHubRepositoryBinding

项目与 repository 的正式绑定是 GitHub engineering truth 的授权边界。

```ts
type ProjectGitHubRepositoryBinding = {
  id: string;
  projectId: string;
  githubInstallationId: string;

  repositoryId: string;
  repositoryFullName: string;

  activePolicyRevisionId: string | null;

  status: "active" | "retired";
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
  retiredAt: Date | null;
};
```

关键语义：

- `repositoryId` 是稳定 GitHub identity；
- `repositoryFullName` 是当前观察名称，可因 rename 更新；
- 已被引用的 binding 不 DELETE，只能 retired；
- repository rename 不创建第二个 identity；
- 一个 project 可绑定多个 repos；
- 同一个 repo 不强制只能服务一个 project。

---

## 5. EngineeringVerificationTarget

这是本规格相对 conversational design 的必要一致性修正。

因为 `GitHubReference` 只能在 GitHub 确认对象后创建，而 Workbench 必须在 commit 尚未确认、repo 未绑定或 GitHub outage 时仍能保存 verification 状态，所以增加：

```ts
type EngineeringVerificationTarget = {
  id: string;
  projectId: string;

  claimedRepositoryFullName: string;
  commitSha: string;

  createdAt: Date;
};
```

Target 只表示：

> Workbench 需要验证这个 project 下声称的 repository + immutable commit locator。

它不是 GitHub truth。

规则：

- ResearchResult 的 immutable git locator 可产生 Target；
- Agent hint 的原始契约是通用 `{ kind, value }`，不得假设一定直接携带 full SHA；
- 能直接解析为 repository + full SHA 的 hint 可创建/reuse Target；
- PR/branch/workflow/issue/review 等非 commit hint 先经过 GitHub authoritative resolution；确认后可创建对应 GitHubReference，若解析过程中得到需要工程验证的 commit locator，再创建/reuse Target；
- malformed / unresolvable hint 只保留原 hint，不创建 Target 或 confirmed GitHubReference；
- Target 可存在于 repository 未绑定、commit 不存在、GitHub unavailable 等状态；
- Target identity 首版按 `(projectId, normalized claimedRepositoryFullName, commitSha)` 幂等。

Repository rename 的 stable identity 由后续 GitHub resolution + binding.repositoryId 解释；原 claimed name 不回写。

---

## 6. GitHubReference

`GitHubReference` 只表示 GitHub 已确认存在的对象。

```ts
type GitHubReferenceType =
  | "issue"
  | "branch"
  | "commit"
  | "pull_request"
  | "review"
  | "workflow_run";

type GitHubReference = {
  id: string;
  projectId: string;
  repositoryBindingId: string;

  type: GitHubReferenceType;
  externalId: string;

  url: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
};
```

唯一约束：

```text
(repositoryBindingId, type, externalId)
```

其中：

- commit → full SHA；
- branch → branch/ref name；
- pull_request → PR number；
- review → GitHub review ID；
- workflow_run → GitHub run ID；
- issue → issue number。

URL 不是 identity。

---

## 7. Subject links

不采用 generic `subject_type + subject_id` polymorphic FK。

Verification relevance 使用显式 FK link：

```text
research_result_engineering_targets
agent_run_engineering_targets
research_task_engineering_targets
```

Confirmed GitHub objects 同样使用显式 subject links：

```text
research_result_github_references
agent_run_github_references
research_task_github_references
```

因此可以同时表达：

- 这个 subject 声称/需要验证哪个 commit target；
- GitHub 后来确认了哪些 commit/PR/workflow 等对象。

Agent hint 原记录永远保留，不因 confirmed reference 出现而删除。

---

## 8. EngineeringVerification

EngineeringVerification 与 `EngineeringVerificationTarget` 一对一，而不是强制依赖 confirmed commit reference。

```ts
type EngineeringVerificationState =
  | "unverified"
  | "awaiting_pr"
  | "pending_ci"
  | "verified"
  | "failed"
  | "unknown";

type EngineeringVerification = {
  id: string;
  targetId: string;

  state: EngineeringVerificationState;
  reasonCode: EngineeringVerificationReasonCode | null;

  repositoryBindingId: string | null;
  commitReferenceId: string | null;
  pullRequestReferenceId: string | null;
  policyRevisionId: string | null;

  lastReconciledAt: Date | null;
  lastSuccessfulReconcileAt: Date | null;
  verifiedAt: Date | null;

  reconcileRequestedAt: Date | null;
  reconcileClaimedAt: Date | null;
  nextReconcileAt: Date | null;
  reconcileAttempts: number;
  lastReconcileErrorCode: string | null;

  updatedAt: Date;
};
```

这样以下状态都可合法表达：

- repo 未绑定 → target 有、binding/ref 无；
- commit not found → binding 有、commit ref 无；
- GitHub unavailable → ref 可能有也可能无；
- commit 后来出现 → reconcile 创建 confirmed commit reference；
- 多个 subject 可共享同一 Target/Verification。

---

## 9. Verification reason codes

首版稳定安全枚举至少包括：

```text
repository_not_bound
commit_not_found
no_qualifying_pull_request
pull_request_not_merged
required_checks_not_configured
required_check_missing
required_checks_pending
required_check_failed
required_check_cancelled
required_check_timed_out
required_check_skipped
required_check_neutral
required_check_action_required
required_check_stale
required_check_conflict
github_unavailable
github_rate_limited
github_auth_unavailable
unsupported_merge_queue
```

不得把 raw GitHub HTTP body / workflow log / credential material 写入 reason。

---

## 10. Verification states

### unverified

GitHub/Workbench 已能明确判断基础工程证据不存在，例如：

- repository 未绑定；
- commit 在绑定 repo 中明确不存在。

### awaiting_pr

- commit 已确认；
- 没有 qualifying PR；
- PR open；
- PR closed but not merged；
- PR merged 到错误 verification branch。

### pending_ci

- qualifying PR 已 merged；
- matching required check 明确存在；
- 其当前状态仍 queued/requested/waiting/pending/in_progress。

### failed

GitHub 给出明确工程失败事实，例如：

- required check failure；
- cancelled；
- timed out；
- skipped；
- neutral；
- missing；
- conflicting current evidence；
- required checks 未配置。

### unknown

Workbench 当前无法可靠知道 GitHub truth，例如：

- timeout / 5xx；
- 429；
- GitHub App auth unavailable；
- installation unavailable；
- unsupported merge queue path。

### verified

必须满足完整 deterministic policy。

---

## 11. Versioned Verification Policy

Verification policy 不与 RepositoryBinding 混在一起。

```ts
type RequiredCheckPolicy = {
  context: string;
  integrationId: string | null;
  workflowId: string | null;
  acceptedEvents: Array<"pull_request" | "push" | "merge_group">;
};

type GitHubVerificationPolicyRevision = {
  id: string;
  repositoryBindingId: string;

  verificationBranch: string;
  requiredChecks: RequiredCheckPolicy[];

  createdByMemberId: string;
  createdAt: Date;
};
```

RepositoryBinding 指向：

```text
activePolicyRevisionId
```

Policy revision immutable，不原地修改。

激活新 revision 后：

- 旧 revision 永久保留；
- 相关 Verification 全部 schedule reconcile；
- Verification 记录当前 policyRevisionId；
- audit history 能解释 policy 变化。

requiredChecks 为空时不得 vacuous success：

```text
failed / required_checks_not_configured
```

---

## 12. Qualifying PR

Phase 5 v1 采用严格 exact-head 规则。

Qualifying PR 必须：

1. 属于同一 bound repository；
2. PR head SHA = verification target commit SHA；
3. PR 已 merged；
4. PR base branch = active policy verificationBranch。

因此：

```text
commit 只是 PR 历史 commit
≠ verified anchor
```

该限制有意保证 CI 对应的是精确 immutable commit。

Merge / squash / rebase 都允许；不要求 ResearchResult SHA 等于最终 merge commit SHA。

多个 qualifying PR 同时满足时，verification 结果只需任一完整链成立；展示 evidence 时确定性选择：

```text
earliest mergedAt
→ tie: lowest PR number
```

---

## 13. Required check evaluation

Workbench 比 GitHub merge semantics 更严格。

只有：

```text
status = completed
conclusion = success
```

才算 PASS。

以下全部不是 PASS：

- failure；
- cancelled；
- timed_out；
- skipped；
- neutral；
- stale；
- action_required。

历史 check attempt 保留，但 evaluator 只看 policy selector 下的 current/latest attempt。

同一 required context 的当前 evidence 若冲突：

```text
failed / required_check_conflict
```

如果无法可靠确定 current attempt：

```text
unknown
```

Checks 与 legacy Commit Statuses 都要 normalize；如果 policy context 同时存在当前 Check Run 与 Commit Status，则 fail closed，相关当前 evidence 必须全部满足。

---

## 14. Pure verification evaluator

Evaluator 不调用 GitHub、不读 DB。

固定顺序：

```text
1. matching repository binding?
   no → unverified / repository_not_bound

2. commit confirmed?
   no → unverified / commit_not_found

3. exact-head PR for verification branch?
   no → awaiting_pr / no_qualifying_pull_request

4. PR merged?
   no → awaiting_pr / pull_request_not_merged

5. active policy has required checks?
   no → failed / required_checks_not_configured

6. every required check has matching current evidence?
   no → failed / required_check_missing

7. any required check currently pending?
   yes → pending_ci

8. any current required evidence non-success/conflict?
   yes → failed + precise reason

9. all current required evidence exactly success?
   yes → verified
```

GitHub external failures bypass该 evaluator，直接映射为 unknown typed integration result。

---

## 15. GitHubAdapter

新增稳定 package：

```text
packages/github-adapter/
├── src/types.ts
├── src/github-client.ts
├── src/auth.ts
├── src/rest-adapter.ts
└── src/fake-adapter.ts
```

Application 只消费 normalized facts，例如：

```ts
interface GitHubEngineeringAdapter {
  getRepository(...): Promise<GitHubRepositoryFact>;
  getCommit(...): Promise<GitHubCommitFact | null>;
  listPullRequestsForCommit(...): Promise<GitHubPullRequestFact[]>;
  getVerificationPolicyObservation(...): Promise<GitHubGovernanceFact>;
  getChecksForCommit(...): Promise<GitHubCheckFact[]>;
}
```

禁止向 application/domain 暴露：

- Octokit response；
- raw GitHub JSON；
- raw webhook payload。

Adapter failure 归一化：

```text
not_found
auth_unavailable
installation_suspended
rate_limited
temporarily_unavailable
```

---

## 16. Webhook ingress

入口：

```text
POST /api/integrations/github/webhook
```

HTTP request 只做：

1. 读取 raw bytes；
2. 验证 `X-Hub-Signature-256`；
3. 读取 `X-GitHub-Delivery`；
4. normalize minimal envelope；
5. 写 IntegrationInbox；
6. 快速返回 2xx。

坏签名：

- 401/403；
- 不写 IntegrationInbox；
- 不 schedule reconcile。

---

## 17. IntegrationInbox envelope

复用现有：

```text
(provider, external_id) UNIQUE
```

GitHub：

```text
provider = github
externalId = X-GitHub-Delivery
```

Inbox 不保存完整 webhook body，只保存必要 trigger metadata：

```ts
type GitHubWebhookEnvelope = {
  deliveryId: string;
  event: string;
  action: string | null;
  installationId: string | null;
  repositoryId: string | null;
  repositoryFullName: string | null;

  pullRequestNumber?: number;
  workflowRunId?: string;
  checkRunId?: string;
};
```

不保存 PR body、review comment、workflow logs 或任意 raw webhook JSON。

---

## 18. Reliable inbox / reconcile worker

不新增第二套 queue infrastructure。

扩展现有 IntegrationInbox operational claim 字段：

```text
status
attempts
availableAt
claimedAt
processedAt
lastErrorCode
```

worker 用 PostgreSQL：

```sql
FOR UPDATE SKIP LOCKED
```

支持 crash reclaim。

数据流：

```text
Webhook
  ↓
IntegrationInbox
  ↓
Inbox worker
  ↓
mark EngineeringVerification reconcile-needed
  ↓
Reconcile worker
  ↓
GitHubAdapter
  ↓
pure evaluator
  ↓
persist current EngineeringVerification
```

Webhook 只是 reconcile hint，不直接 transition verification state。

---

## 19. Reconcile semantics

每次 reconcile 都从当前 GitHub authoritative facts 重新计算：

```text
target
→ resolve binding
→ resolve installation
→ repository identity
→ commit
→ PR candidates
→ qualifying merged PR
→ active Workbench policy
→ current checks/statuses
→ pure evaluator
→ current EngineeringVerification
```

因此 webhook：

- 可重复；
- 可乱序；
- 可延迟；
- 可丢失。

Periodic/manual reconcile 可恢复 drift。

建议 fallback：

- awaiting_pr / pending_ci → 5m；
- unknown → exponential backoff；
- terminal-looking current states → 6h safety reconcile。

GitHub 429 尊重 Retry-After/rate-limit reset。

---

## 20. Verification history

EngineeringVerification 是 current rebuildable projection，但状态变化产生安全 append-only audit：

```text
ENGINEERING_VERIFICATION_CHANGED
```

payload 只允许：

```text
verificationId
targetId
repositoryBindingId?
commitSha
previousState
nextState
reasonCode
previousPolicyRevisionId?
nextPolicyRevisionId?
```

禁止 raw GitHub payload。

---

## 21. ResearchResult integration

ResearchResult 已有 immutable：

```text
git_repository_full_name
git_commit_sha
```

Phase 5 不修改这些字段。

Code ResearchResult transaction 不等待 GitHub 网络。

正确链路：

```text
create ResearchResult
→ commit transaction
→ existing Outbox
→ create/reuse EngineeringVerificationTarget
→ link ResearchResult ↔ Target
→ request reconcile
→ GitHub resolution
→ confirmed GitHubReference
→ EngineeringVerification
```

GitHub outage 不得 rollback ResearchResult。

错误 provenance 也不自动修正；必要时通过新 ResearchResult/supersession 处理。

---

## 22. Agent integration

现有 `github_hint` 保留。

链路：

```text
github_hint
→ classify candidate kind/value
→ commit locator?
  yes → structurally valid repo + full SHA → create/reuse EngineeringVerificationTarget
  no  → authoritative GitHub resolve for PR/branch/workflow/issue/review
          ↓ confirmed object
       create GitHubReference
          ↓ if resolution yields a verification commit
       create/reuse EngineeringVerificationTarget
→ reconcile target
→ GitHub-confirmed commit/PR/check facts
→ EngineeringVerification
```

Agent 文本中的“CI passed”等声明永远不参与 evaluator。

Phase 5 不给 Agent：

- bind repository；
- change policy；
- force verify；
- merge PR；
- GitHub write credentials。

---

## 23. ResearchTask / AgentRun / ResearchResult display semantics

### ResearchResult

同时显示：

- recorded immutable git provenance；
- separate engineering verification。

二者不可合并成一个“Git commit ✓”。

### AgentRun

分开显示：

- Agent github hints；
- GitHub-confirmed references；
- associated verification chains。

不新增 `AgentRun.engineeringVerified` boolean。

### ResearchTask

展示关联 verification chains，但不计算 engineering progress % 或 aggregate engineering completion state。

---

## 24. Project Evidence UI

不增加一级导航。

Canonical surface 使用已有：

```text
/projects/[projectId]/evidence
```

页面结构：

```text
科研结果
工程证据
  ├── repository bindings
  ├── active verification policies
  └── verification chains
```

不复制 GitHub diff、PR discussion、workflow logs、repo browser。

Manual “重新验证”只设置 reconcile requested，不同步调用 GitHub，不乐观修改 state。

---

## 25. Authorization

复用现有 project read/write semantics。

Project reader：

- 查看 engineering evidence。

Project Lead / Organization Lead：

- 创建/退休 repository binding；
- 创建/激活 policy revision；
- 请求 manual reconcile。

任何 human/Agent 均不能直接设置 verification state。

---

## 26. Phase 4C integration

Cockpit 不调用 GitHub。

只消费 persisted EngineeringVerification：

```text
GitHub
→ Phase 5 reconcile
→ EngineeringVerification
→ Phase 4C projection
```

新增统一 attention kind：

```text
engineering_verification_attention
```

只进入：

- unverified；
- failed；
- unknown。

不进入：

- awaiting_pr；
- pending_ci；
- verified。

该 attention：

- 属于项目关注，不属于“我的明确行动”；
- 以 verificationId/targetId 去重；
- 同一 verification 即使关联 Task + Result + AgentRun，也只显示一次；
- superseded ResearchResult / obsolete AgentRun 若无其他 current subject link，不继续污染 cockpit。

Recent Activity allowlist 增加：

```text
ENGINEERING_VERIFICATION_CHANGED
```

---

## 27. GitHub governance boundary

GitHub branch protection/ruleset 与 Workbench Verification Policy 是不同概念。

- Verification Policy 定义“Workbench 什么证据算通过”；
- GitHub ruleset/branch protection 定义“GitHub 仓库允许什么操作”。

Phase 5 可以读取 governance 作为 observation/drift 信息，但不得静默把 GitHub 配置变化转换成新的 Workbench Policy Revision。

如果 governance API unreadable：

```text
unknown/unreadable
≠ no branch protection
```

Phase 5 v1 不新增 Agent GitHub write credential，因此不声称已经解决未来 Agent write governance。

未来若允许 Agent 写 GitHub，必须单独设计并验证：

- target branch requires PR；
- force push blocked；
- Agent credential/integration 无 bypass；
- branch/ruleset enforcement 可审计。

---

## 28. Direct push

即使某 commit：

```text
on verification branch
+ required checks success
```

如果没有 qualifying merged PR：

```text
awaiting_pr
```

Phase 5 v1 不把 direct-push evidence 视为 verified。

---

## 29. Merge queue

首版不实现完整 merge-queue semantics。

如果检测到实际 verification path 必须依赖 merge queue，但 policy 尚不支持：

```text
unknown / unsupported_merge_queue
```

不把普通 PR-head verification 假装为等价。

---

## 30. 测试策略

### Pure evaluator

覆盖：

- repository_not_bound；
- commit_not_found；
- no PR/open PR/wrong branch；
- exact-head requirement；
- empty policy；
- missing/pending/failure/cancelled/timed_out/skipped/neutral/stale/action_required；
- check conflict；
- latest attempt；
- all exact success → verified。

### PostgreSQL integration

覆盖：

- binding/reference/target/link FKs；
- policy immutable revisions；
- one active policy per binding；
- subject link sharing；
- webhook delivery idempotency；
- inbox claim/retry/crash reclaim；
- read-only scientific-state invariants；
- ResearchResult non-blocking external integration。

### Fake GitHubAdapter

覆盖完整 state matrix、webhook乱序、webhook丢失、periodic reconcile、429/5xx/auth failure、repository rename。

### Browser acceptance

Phase 5 首版固定 12 个场景：

1. repository binding permissions；
2. policy revision activation；
3. ResearchResult provenance vs verification；
4. repository_not_bound；
5. merged exact-head PR + success → verified；
6. open PR + success → awaiting_pr；
7. pending check → pending_ci；
8. failed/skipped → failed，SKIP != PASS；
9. GitHub unavailable → unknown；
10. Agent hint vs confirmed refs；
11. manual reconcile only schedules；
12. Phase 4C engineering attention dedup/disappear after verified。

---

## 31. Security tests

必须验证：

- valid/invalid/missing webhook signature；
- modified body signature failure；
- raw body verified before JSON mutation；
- secret/token/private key 不进入 DB/event/outbox/log；
- raw webhook body 不进入 normalized Inbox；
- raw GitHub errors 不进入 domain DTO；
- Agent text cannot alter verification state。

---

## 32. Real GitHub smoke

Conditional real smoke 只做 read-only：

- resolve GitHub App installation；
- read configured repository；
- lookup known commit；
- read known PR metadata；
- read check runs/statuses；
- normalize adapter DTO。

不做 merge、push、ruleset mutation、repo creation/deletion。

分别记录：

```text
GitHub REST smoke: PASS/SKIP/FAIL
GitHub webhook-delivery smoke: PASS/SKIP/FAIL
```

依赖不可用时必须 SKIP，不得表示 PASS。

---

## 33. Full regression gate

最终稳定 checkpoint 执行：

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm acceptance
```

Phase 1–4C 全回归必须保持绿色。

Real tusd + SeaweedFS browser regression 继续要求绿色。

所有既有 conditional real provider/service SKIP 语义保持不变。

---

## 34. Verification record

阶段末创建：

```text
docs/superpowers/reviews/2026-10-02-phase-05-github-engineering-truth-verification.md
```

记录：

- approved spec / plan；
- implementation branch/head；
- exact test counts；
- exact browser count；
- fake adapter coverage；
- real GitHub smoke PASS/SKIP/FAIL；
- webhook smoke PASS/SKIP/FAIL；
- secret-safety review；
- no scientific-state writeback；
- no GitHub mirror；
- no Agent verification authority；
- known limitations；
- `independent AI reviewer: unavailable`；
- coordinator/manual invariant review。

Verification-record commit 后必须重新跑 fresh exact-head CI。

---

## 35. Phase 5 非目标

本阶段不实现：

- GitHub repository browser；
- diff viewer；
- PR discussion mirror；
- workflow log mirror；
- Agent GitHub write credentials；
- Agent merge authority；
- automatic main push；
- task engineering percentage；
- AgentRun engineering score；
- automatic ResearchTask completion；
- automatic ScientificDecision approval；
- merge queue full support；
- GitHub governance mutation；
- production deployment automation。

---

## 36. 完成标准

Phase 5 只有同时满足以下条件才算完成：

1. repository binding 使用 stable GitHub repository identity；
2. GitHub App installation identity 正确建模，token/secret 不持久化；
3. untrusted target 与 confirmed GitHubReference 分离；
4. EngineeringVerificationTarget 可以表达 unbound/not-found/outage；
5. confirmed GitHubReference 只由 GitHub authoritative resolution 创建；
6. explicit FK links 覆盖 ResearchResult/AgentRun/ResearchTask；
7. Verification Policy immutable/versioned；
8. exact-head merged PR + correct branch + non-empty required policy + all exact success 才 verified；
9. skipped/neutral/cancelled 等均不是 PASS；
10. webhook signature/delivery-id/inbox/retry/crash recovery 正确；
11. webhook 重复/乱序/丢失不导致永久 drift；
12. periodic/manual reconcile 可恢复；
13. GitHub outage → unknown；
14. ResearchResult transaction 不等待 GitHub；
15. Agent hint 不获得工程事实权限；
16. verification 不写回科研正式状态；
17. evidence page 是 canonical UI，不增加一级导航；
18. cockpit 只消费 persisted facts；
19. engineering attention 去重且不进入“我的明确行动”；
20. Phase 5 不新增 Agent GitHub write/merge credentials；
21. fake adapter deterministic tests 完整；
22. real smoke 如实 PASS/SKIP/FAIL；
23. Phase 1–4C regressions 保持绿色；
24. verification-record exact-head CI success；
25. Draft PR 保持 human gate；
26. independent AI reviewer unavailable 如实记录。

---

## 37. 设计结论

Phase 5 的职责：

> 把 GitHub 从“Agent 或人提到的链接”升级为 Research Workbench 可审计的工程事实平面映射，通过 untrusted verification target、GitHub-confirmed references、版本化 policy 和 deterministic reconcile，确认工程证据是否成立；同时不复制 GitHub、不阻塞科研事实持久化、不赋予 Agent 工程治理权，也不让 CI 取代科研治理。

最终边界：

```text
Claim / locator
   ↓
EngineeringVerificationTarget
   ↓
GitHub authoritative resolution
   ↓
GitHubReference
   ↓
Versioned Verification Policy
   ↓
EngineeringVerification
   ↓
Evidence UI / Phase 4C projection
```

并始终保持：

```text
CI success
≠ scientific truth

GitHub verified
≠ ResearchTask completed

Agent says passed
≠ GitHub says passed
```
