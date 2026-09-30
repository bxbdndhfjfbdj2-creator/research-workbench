# Phase 4B — Human/Hybrid ResearchTask & Unified Review Design

- 日期：2026-09-30
- 状态：已批准（2026-09-30，二次设计复核通过）
- 设计分支：`phase/04b-human-hybrid-work-review`
- 产品主线：AI-native Research Workbench
- 适用团队：固定 6 人、单团队、私有部署
- 前置阶段：Phase 4A Files & Provenance 已完成实现与 exact-head full CI；Draft PR #5 仍保持人工合并闸门
- 设计路径：Superpowers architectural path
- 执行约束：当前只有单 Agent，可在未来实施阶段使用 Native / `superpowers:executing-plans`；不得声称存在 independent AI reviewer
- 相关规格：
  - `docs/superpowers/specs/2026-09-29-research-workbench-design.md`
  - `docs/superpowers/specs/2026-09-30-phase-04a-files-provenance-design.md`
- 相关验证：
  - `docs/superpowers/reviews/2026-09-30-phase-04a-verification.md`

## 1. 目标

Phase 4B 将现有 `ResearchTask` 从简单人工待办扩展为统一、可审计的科研工作单元，能够表达：

- human 执行；
- agent 执行；
- human + agent hybrid 执行；
- 人类承担最终工作责任；
- 不可变、多版本的正式任务提交；
- 普通交付物 Review；
- Review 必要时显式升级为现有 `ScientificDecision`；
- Review、ScientificDecision、正式科研状态三者之间清晰、不可绕过的治理边界。

本阶段的目标不是制造一个通用 workflow engine，也不是把所有科研治理统一成单一审批状态机。核心是建立一条稳定闭环：

```text
ResearchTask
    ↓ execution
Human / AgentTask+AgentRun / Hybrid
    ↓ human-controlled formal submission
Immutable TaskSubmission
    ↓ ordinary quality gate
ReviewRequest
    ↓ only when scientific meaning changes
ScientificDecision
    ↓ existing governance
Official scientific state
```

## 2. 非目标

Phase 4B 明确不实现：

- 多 reviewer quorum / all-of / any-of；
- reviewer delegation framework；
- deadline / SLA engine；
- notification preference center；
- 评论线程或 chat；
- task dependency DAG；
- GitHub Commit/PR 作为正式 Submission ref 类型；
- 自动 AI reviewer；
- AI 自动创建正式 TaskSubmission；
- AI 自动批准普通 Review；
- AI 自动批准 ScientificDecision；
- progress percentage；
- portfolio cockpit；
- attention ranking；
- 通用 workflow engine；
- 把 `ScientificDecision` 重构进 `ReviewRequest`；
- Phase 4C 的项目/组合进度投影。

GitHub 工程事实仍在后续 GitHub Engineering Truth 阶段处理。Phase 4B 不提前造半套 GitHub 语义。

## 3. 设计原则

### 3.1 Human accountability 不因 Agent 执行而消失

每个 Phase 4B workflow v2 `ResearchTask` 必须始终有一个 human accountable owner。

`executionMode=agent` 只代表主要执行策略，不代表 Agent 成为任务责任人。Agent 只能成为执行者、贡献者和 provenance source。

### 3.2 执行事实与执行意图分离

`ResearchTask.executionMode` 表达当前计划采用：

- `human`
- `agent`
- `hybrid`

真正“谁实际做了什么”不能从该字段推断，而必须来自：

- `TaskSubmissionContributor`
- `AgentRun`
- Submission refs
- ResearchEvent

executionMode 可以由有权限的人类显式切换；切换必须写 ResearchEvent。Agent actor 不能自行切换 executionMode。

### 3.3 正式提交必须由人类做出

AgentRun 完成只表示 AI 执行完成。

Agent 不得直接创建正式 `TaskSubmission`。只有 task accountable owner 可以执行正式 submit。其他人可以是 contributor，但第一版不实现通用 submit delegation。

### 3.4 TaskSubmission 是不可变审核边界

普通 Review 审核具体 `TaskSubmission.id`，而不是动态读取 ResearchTask 当前内容。

每次修改后重新提交必须创建新的 Submission。旧 Submission、旧 Review 和旧失败/修改历史永久保留。

### 3.5 普通 Review 与科学治理分离

`ReviewRequest` 只回答：

> 这份具体交付物是否达到任务要求？

`ScientificDecision` 继续回答：

> 这个科学变更是否允许改变正式科研状态？

普通 Review 可以显式升级为 ScientificDecision proposal，但 ScientificDecision 不被 ReviewRequest 取代。

### 3.6 科学批准不等于交付验收

ScientificDecision approved：

- 不自动 approve Review；
- 不自动 complete ResearchTask。

ScientificDecision rejected：

- 不自动 reject Submission。

Decision resolution 后，原普通 Review 必须恢复，由 reviewer 明确做最终普通验收。

### 3.7 Phase 4C 只能投影，不得回写真相

4B 提供事实；4C 后续可以读取这些事实生成 cockpit / attention projections。

4C 不得通过 projection 直接修改 `ResearchTask`、`ReviewRequest` 或 `ScientificDecision` 正式状态。

## 4. ResearchTask 模型

### 4.1 当前字段语义

现有 `research_tasks.assignee_member_id` 在 Phase 4B 中升级为：

> human accountable owner

不新增重复 owner 字段。

workflow v2 中该字段必须非空，并且必须指向该项目可访问的 active human member；团队总负责人也可作为 owner。

### 4.2 新字段

`research_tasks` 增加：

- `execution_mode`: `human | agent | hybrid`
- `review_policy`: `none | required`
- `acceptance_criteria`: JSON string array，默认 `[]`
- `workflow_version`: integer

`acceptance_criteria` 是人类可读标准，不是 DSL。Phase 4B 不解析它自动决定必须有哪些 ref；是否满足标准由 human reviewer 判断。

### 4.3 workflow version 与 legacy 兼容

为避免伪造历史 provenance，同时避免 legacy active task 永久绕过新治理：

- Phase 4B migration 前已经存在的 ResearchTask → `workflow_version=1`
- migration 后新建 ResearchTask → `workflow_version=2`
- migration 本身不补造 Submission / Review / contributor 历史
- v1 已完成 task 若显式 reopen → 在同一事务升级为 v2，然后遵守 Phase 4B 新规则
- v1 `open | in_progress | blocked` task 在 migration 后发生第一次生命周期写操作时必须先原子升级为 v2，再执行该动作
- v1 `cancelled` task 保持历史终态，不自动升级
- legacy upgrade 只声明“从此刻开始采用 v2 workflow”，不对 migration 前的执行/交付历史作任何推断

内部 `ensureWorkflowV2ForMutation()`（或等价边界）负责 active legacy task 的升级。升级必须：

1. 锁 ResearchTask；
2. 验证当前 accountable owner 仍是 active、可访问该 project 的 human；
3. 若旧 owner 已无资格，则普通生命周期动作失败关闭；项目主理人/团队总负责人必须通过 owner reassignment 在同一事务指定合格 owner 并完成升级；
4. 保留默认 `executionMode=human`、`reviewPolicy=none`、`acceptanceCriteria=[]`，除非该升级动作本身显式改变它们；
5. 写 `RESEARCH_TASK_WORKFLOW_UPGRADED`，只记录 taskId/fromVersion/toVersion；
6. 不创建伪造的 TaskSubmission、ReviewRequest 或 completion provenance。

因此 migration 后不存在可长期继续使用 legacy direct-completion 语义的 active task。

### 4.4 executionMode

允许 human 显式切换：

```text
human ↔ agent ↔ hybrid
```

切换：

- 必须事件化；
- 不能由 Agent actor 发起；
- 不自动创建 AgentTask；
- 不自动启动 AgentRun；
- 不修改过去 Submission provenance。

task 处于 `awaiting_review` 时不允许改变 executionMode 或 reviewPolicy；应先完成当前 Review cycle。owner reassignment 仍可由项目主理人或团队总负责人进行，以处理人员变化。

### 4.5 reviewPolicy

每个 workflow v2 task 明确设置：

- `none`
- `required`

`none` 表示不强制普通 Review，但仍必须存在正式 Submission 后才允许完成。

`required` 表示必须有当前 Submission 对应的 approved Review 后才能 completed。

reviewPolicy 是任务级质量治理选择：

- 第一份正式 TaskSubmission 创建前，可由 accountable owner、项目主理人或团队总负责人显式修改；
- 第一份正式 TaskSubmission 一旦创建，reviewPolicy 对该 ResearchTask 永久锁定；
- 不允许在 Review 被拒绝/要求修改后把 `required` 改为 `none` 绕过审核；
- 若后续确需不同 reviewPolicy，应创建新的 ResearchTask，而不是改写已有审核历史。

### 4.6 ResearchTask 状态机

Phase 4B v2 状态：

```text
open
  → in_progress
  → blocked
  → in_progress

in_progress
  → awaiting_review      # required review + formal submission

in_progress
  → completed            # reviewPolicy=none + formal submission exists

awaiting_review
  → completed            # corresponding Review approved
  → in_progress          # changes_requested / rejected

open / in_progress / blocked
  → cancelled

completed
  → in_progress          # explicit reopen; history preserved
```

约束：

- v2 正式 TaskSubmission 只允许从 `in_progress` 创建；`open` 必须先 start，`blocked` 必须先 unblock；
- v2 completed 必须存在至少一个正式 TaskSubmission；
- `reviewPolicy=none` 的 `completeUnreviewedTask(taskId, submissionId)` 必须显式指定且只接受该 task 的最新 Submission；
- 每一次 Task → `completed` 都必须在同一事务写 `RESEARCH_TASK_COMPLETED`，payload 至少包含 `researchTaskId`、`submissionId`、`completionKind=unreviewed_acceptance | review_approved`；这条 append-only event 是当前完成周期 accepted-submission provenance；
- required-review task 无 approved Review 时不能 completed；
- `awaiting_review` 必须能定位当前 Submission / Review；
- cancelled 不删除 Submission、Review、AgentRun；
- `awaiting_review` 且 Review 为 `pending` 时允许显式 cancel：Task 与 Review 在同一事务分别进入 `cancelled`，历史保留；
- `awaiting_scientific_decision` 时禁止取消 Task，必须先让已创建的 ScientificDecision 进入 terminal `approved | rejected`，普通 Review 恢复后才能取消；
- completed → reopen 必须写事件，不覆盖旧 accepted Submission；
- reopen 后必须产生新 Submission cycle 才能再次完成；
- 不再向 v2 caller 暴露“任意 set status”接口。

## 5. TaskSubmission

### 5.1 语义

`TaskSubmission` 是一个由 human owner 做出的正式、不可变、可审核交付包。

它允许：

- 不可变文字 summary；
- 0..N typed provenance refs；
- 0..N contributors；
- 冻结的 requirement snapshot。

纯文本任务允许零 refs。Phase 4B 不要求所有科研工作制造文件。

### 5.2 表结构

```text
task_submissions
├─ id
├─ research_task_id
├─ project_id
├─ submission_number
├─ summary
├─ requirement_snapshot jsonb
├─ requirement_snapshot_schema_version
├─ submitted_by_member_id
├─ created_at
└─ UNIQUE(research_task_id, submission_number)
```

整个表必须 immutable / append-only，禁止 UPDATE / DELETE。

`summary` 必须是 trim 后非空的 bounded text；即使主要交付是 FileVersion/ResearchResult，也要求 human submitter 用简短文字说明这次正式提交是什么。

### 5.3 requirement snapshot

创建 Submission 时冻结：

- `title`
- `description`
- `acceptanceCriteria`
- `executionMode`
- `reviewPolicy`

并保存 `requirement_snapshot_schema_version`。

ResearchTask 后续改变要求不会改变旧 Submission 审核含义。

snapshot 必须经过 `assertSecretSafe()`。

### 5.4 contributors

```text
task_submission_contributors
├─ id
├─ submission_id
├─ contributor_kind
│    human_member | agent_run
├─ contributor_ref
└─ created_at
```

约束：

- append-only；
- 建议唯一约束 `UNIQUE(submission_id, contributor_kind, contributor_ref)`，避免重复 contributor fact；
- `submitted_by_member_id` 自动加入 human contributor；
- human contributor 必须是 active、可访问该 project 的 human member；
- agent_run contributor 必须属于同 project；
- caller 不能通过遗漏 submittedBy contributor 绕过禁止自审。

### 5.5 typed refs

第一版允许：

- `file_version`
- `research_result`
- `research_node_revision`
- `agent_run`

```text
task_submission_refs
├─ id
├─ submission_id
├─ ref_kind
├─ ref_id
├─ relation
└─ created_at
```

relation 第一版固定为：

- `deliverable`
- `evidence`
- `source`
- `context`

建议唯一约束：

```text
UNIQUE(submission_id, ref_kind, ref_id, relation)
```

所有 refs 都是稳定 ID，不复制被引用对象内容。

创建时 application service 必须重新验证 project 一致性：

- FileVersion → ResearchFile.projectId
- ResearchResult.projectId
- ResearchNodeRevision → ResearchNode.projectId
- AgentRun.projectId

跨项目 stable-ID 注入必须 fail closed。

### 5.6 提交原子性

`submitResearchTask()`：

1. 锁 ResearchTask；
2. 验证 actor 是 accountable owner；
3. 验证 workflow v2 task 当前状态严格为 `in_progress`；
4. 验证 reviewPolicy 已满足锁定规则；
5. 验证 contributors；
6. 验证全部 refs；
7. 分配单调递增 submissionNumber；
8. 冻结 requirement snapshot；
9. 写 Submission / contributors / refs；
10. 根据 reviewPolicy 推进状态；
11. 写 ResearchEvent；
12. 写 Outbox。

required-review 时 reviewer 必须作为本次 submit 输入显式指定，并在同一事务创建 ReviewRequest 与 assignment history。

任何一步失败全部 rollback。

## 6. ReviewRequest

### 6.1 设计

普通 Review 每个 Submission 第一版只允许一个 ReviewRequest：

```text
UNIQUE(task_submission_id)
```

修改后不是重开旧 Review，而是创建新 Submission + 新 Review。

### 6.2 表结构

```text
review_requests
├─ id
├─ project_id
├─ task_submission_id
├─ reviewer_member_id
├─ status
│    pending
│    awaiting_scientific_decision
│    approved
│    changes_requested
│    rejected
│    cancelled
├─ created_by_member_id
├─ created_at
└─ updated_at
```

ReviewRequest current row 可更新状态/reviewer，用于快速查询；每一次变化必须同时写 append-only ReviewAction。

### 6.3 reviewer eligibility

reviewer 必须：

- 是 human；
- active；
- 是该 project 的有效成员，或团队总负责人；
- 不是该 Submission 的任何 human contributor。

如果当前没有合格 reviewer，操作失败关闭。不得自动允许自审。

### 6.4 assignment 与 reassignment

初始 reviewer：

- required-review Submission 创建时由 accountable owner 显式指定；
- 项目主理人或团队总负责人也可以在业务入口创建/纠正 assignment。

reassignment：

- 仅项目主理人或团队总负责人；
- 必须 append ReviewAction；
- 必须写 ResearchEvent；
- 不能删除旧 reviewer 历史。

### 6.5 Review 状态机

```text
pending
  → approved
  → changes_requested
  → rejected
  → cancelled
  → awaiting_scientific_decision

awaiting_scientific_decision
  → pending    # linked ScientificDecision terminal-resolved; ordinary review resumes
```

`approved`、`changes_requested`、`rejected`、`cancelled` 是该 ReviewRequest 的终态，不可再次修改。

`cancelled` 不是 reviewer 对交付质量的判断，而是 Task cancellation 的伴随事实：当 Task 正处于 pending Review，允许的 `cancelResearchTask()` 必须原子取消该 Review。

reviewer actions：

- `approve`
- `request_changes`
- `reject`
- `escalate_to_scientific_decision`

Task cancellation 另记录 `cancel` ReviewAction；它不是 reviewer decision action。

建议要求：

- `request_changes` comment 必填；
- `reject` comment 必填；
- `escalate_to_scientific_decision` 必须提供 decision title/reason，并可附 evidence/impact/change；
- `approve` comment 可选。

### 6.6 Task 对 Review 的响应

- approve → Task completed
- request_changes → Task in_progress
- reject → Task in_progress
- escalate → Task 保持 awaiting_review
- linked ScientificDecision terminal-resolved → Review 恢复 pending；Task 仍 awaiting_review
- Task 在 pending Review 时被合法取消 → Review cancelled + Task cancelled（同一事务）

reject 默认不取消 ResearchTask；cancel 也不伪装成 reject。

## 7. ReviewAction

所有普通审核历史使用 append-only：

```text
review_actions
├─ id
├─ review_request_id
├─ action
│    assigned
│    reassigned
│    approve
│    request_changes
│    reject
│    cancel
│    escalate_to_scientific_decision
│    scientific_decision_resolved
├─ actor_type
├─ actor_id
├─ previous_reviewer_member_id?
├─ new_reviewer_member_id?
├─ comment?
├─ resulting_status
└─ created_at
```

除系统记录 `scientific_decision_resolved` 外，ReviewAction actor 必须是 human。`cancel` 只能由 task cancellation service 在授权通过后写入，不允许 reviewer action endpoint 单独伪造。

整个表 immutable / append-only。

## 8. Review → ScientificDecision escalation

### 8.1 边界

采用：

> ReviewRequest 统一普通审核，ScientificDecision 保持独立治理锁，可从 Review 显式升级。

不允许：

- Review approved 直接改变 official pointer；
- ScientificDecision approved 自动 approve Review；
- ScientificDecision approved 自动 complete Task；
- ScientificDecision rejected 自动 reject Submission。

### 8.2 link

```text
review_decision_links
├─ id
├─ review_request_id
├─ scientific_decision_id
├─ created_by_member_id
└─ created_at
```

append-only。

建议：

- `UNIQUE(scientific_decision_id)`
- application service 保证一个 ReviewRequest 同时最多一个 unresolved ScientificDecision link

`ScientificDecision` 表本身不增加 `review_request_id`，避免基础科学治理对象反向依赖普通 Review。

### 8.3 escalation 事务

`escalateReviewToScientificDecision()` 在一个事务中：

1. 锁 ReviewRequest；
2. 验证 actor 是当前 reviewer；
3. 验证没有 unresolved linked Decision；
4. 创建 ScientificDecision proposal；
5. 创建 ReviewDecisionLink；
6. Review → awaiting_scientific_decision；
7. append ReviewAction；
8. append ResearchEvent；
9. enqueue Outbox。

任一步失败全部 rollback。

### 8.4 Decision resolution

ScientificDecision 完成后，通过明确 application orchestration / Outbox consumer 调用：

`resumeReviewAfterScientificDecision()`

要求：

- 幂等；
- 验证 link；
- 重新读取 linked ScientificDecision 当前状态；仅 `approved | rejected` 视为 terminal resolution；
- 对现有 `scientific.decision.reviewed` 非终态事件（如 `awaiting_lead` / `needs_evidence`）必须 no-op，不能提前恢复 Review；
- Review 仍处于 awaiting_scientific_decision；
- append 一次 `scientific_decision_resolved`，记录 decisionId 与 terminal status；
- Review → pending；
- 不自动决定 approve/reject。

## 9. 权限模型

第一版业务权限：

| 操作 | 允许主体 |
|---|---|
| 创建 ResearchTask | 有 project 访问权的 human member |
| 修改 v2 task title/description/acceptanceCriteria | accountable owner、项目主理人、团队总负责人 |
| 改 reviewPolicy | 第一份 Submission 前：accountable owner、项目主理人、团队总负责人；之后不可修改 |
| 改 executionMode | accountable owner、项目主理人、团队总负责人 |
| 改 accountable owner | 项目主理人、团队总负责人 |
| cancel open/in_progress/blocked task | accountable owner、项目主理人、团队总负责人 |
| cancel pending-review task | accountable owner、项目主理人、团队总负责人；必须同时取消 Review |
| cancel awaiting-scientific-decision task | 禁止，直到 linked Decision terminal-resolved |
| 创建 AgentTask | 沿用现有 human-only AgentTask 规则 |
| 创建 TaskSubmission | accountable owner |
| 初始指定 reviewer | accountable owner；项目主理人/团队总负责人可纠正 |
| reviewer reassignment | 项目主理人、团队总负责人 |
| 执行普通 Review | 当前显式 reviewer |
| escalation | 当前显式 reviewer |
| ScientificDecision review | 完全沿用现有治理规则 |

不要用现有粗粒度 `write` 直接替代所有 4B 语义。

application 层应新增清晰授权动作，例如：

- `task_write`
- `task_submit`
- `review`
- `review_assign`

这些可以是 application-level permission semantics，不要求第一版全部落成数据库枚举。

## 10. Application service 边界

目录建议：

```text
packages/application/src/tasks/
├─ research-task-service.ts
├─ task-submission-service.ts
├─ task-review-service.ts
└─ task-review-escalation.ts
```

### 10.1 research-task-service

负责：

- `createResearchTask()`
- `startResearchTask()`
- `updateResearchTaskRequirements()`
- `setResearchTaskReviewPolicy()`（仅第一份 Submission 前）
- `assignResearchTaskOwner()`
- `setResearchTaskExecutionMode()`
- `blockResearchTask()`
- `unblockResearchTask()`
- `cancelResearchTask()`（pending Review 时原子写 Review cancelled；awaiting ScientificDecision 时 fail closed）
- `reopenResearchTask()`
- legacy v1 compatibility completion path
- v2 `completeUnreviewedTask(taskId, submissionId)`

Phase 4B 后不向 v2 caller 暴露任意 `setResearchTaskStatus(taskId, status)`。

### 10.2 task-submission-service

负责：

- `submitResearchTask()`

并承担 Submission、contributors、refs、snapshot、required Review creation 的事务原子性。

### 10.3 task-review-service

负责：

- `reassignReviewer()`
- `approveSubmission()`
- `requestSubmissionChanges()`
- `rejectSubmission()`

所有入口重新验证：

- human actor；
- current reviewer；
- reviewer eligibility；
- self-review conflict；
- project ownership；
- current Review state。

### 10.4 task-review-escalation

负责：

- `escalateReviewToScientificDecision()`
- `resumeReviewAfterScientificDecision()`

普通 Review service 不直接复制 ScientificDecision 状态机逻辑。

## 11. ResearchEvent 与 Outbox

至少新增事件：

- `RESEARCH_TASK_REQUIREMENTS_CHANGED`
- `RESEARCH_TASK_OWNER_CHANGED`
- `RESEARCH_TASK_EXECUTION_MODE_CHANGED`
- `RESEARCH_TASK_WORKFLOW_UPGRADED`
- `RESEARCH_TASK_BLOCKED`
- `RESEARCH_TASK_REOPENED`
- `RESEARCH_TASK_COMPLETED`
- `RESEARCH_TASK_CANCELLED`
- `TASK_SUBMISSION_CREATED`
- `REVIEW_REQUEST_CREATED`
- `REVIEW_REASSIGNED`
- `REVIEW_APPROVED`
- `REVIEW_CHANGES_REQUESTED`
- `REVIEW_REJECTED`
- `REVIEW_CANCELLED`
- `REVIEW_ESCALATED`
- `REVIEW_SCIENTIFIC_DECISION_RESOLVED`

事件 payload 只保存稳定 ID 和必要低敏感度元数据。

不要把完整：

- Submission summary
- requirement snapshot
- review comment
- restricted locator
- parser/raw document text

复制到 ResearchEvent / Outbox。

所有 payload 继续经过 `assertSecretSafe()`。

## 12. 安全模型

### 12.1 secret safety

必须精确区分结构化 payload guard 与自由文本：

- `assertSecretSafe()` 继续用于结构化 JSON payload，例如 requirement snapshot、escalation evidence/impact/change、ResearchEvent、Outbox；它检测 credential-shaped **key**，不声称能识别任意自然语言中的秘密；
- task title/description、acceptanceCriteria string、Submission summary、Review comment 属于正式业务自由文本，必须有明确长度上限与 trim/empty 校验，但 Phase 4B 不伪装成具有通用 DLP/secret scanning 能力；
- 自由文本不得复制进入 ResearchEvent、Outbox、普通结构化日志或错误消息；这些面只保留稳定 ID、状态和低敏感度元数据；
- server action/application error 不回显数据库 raw payload、restricted locator 或外部 adapter 内部错误。

### 12.2 restricted FileVersion

Submission 可以引用 restricted FileVersion，但：

- ref 的存在不扩大文件访问权限；
- Review 页面必须继续使用 4A 既有授权/redaction；
- ordinary reviewer 不因能看 Submission 自动获得 restricted external locator；
- 原始文件下载仍走 authenticated content route。

### 12.3 cross-project injection

任何客户端提供的 stable ID 都必须在 server-side / application service 重新验证同 project。

禁止依赖 UI dropdown 作为安全边界。

### 12.4 AI restrictions

Agent actor 不得：

- 创建正式 TaskSubmission；
- 改 accountable owner；
- 改 executionMode；
- 指定/reassign reviewer；
- approve/reject/request_changes 普通 Review；
- 通过 Review 绕过 ScientificDecision；
- approve ScientificDecision。

AI 可以继续：

- 运行 AgentTask/AgentRun；
- 生成可见产物；
- 创建 ResearchResult；
- 提出 ScientificDecision proposal；
- 成为 Submission contributor/ref。

## 13. 并发与幂等

### 13.1 Submission

同一 ResearchTask 创建 Submission 时：

- 锁 task row 或等价 advisory lock；
- submissionNumber 唯一、单调递增；
- required task 在 awaiting_review 期间不能创建新正式 Submission；
- 并发双 submit 只能一个成功。

### 13.2 Review

review action：

- 锁 ReviewRequest；
- terminal action 只能成功一次；
- 并发 double approve 只能产生一次：
  - ReviewAction
  - REVIEW_APPROVED
  - Task completion

重复请求可返回 already-finalized，不能复制事实。

### 13.3 Escalation

同一个 ReviewRequest：

- 同时最多一个 unresolved linked ScientificDecision；
- double escalation 不能创建两个 Decision；
- Decision resolution consumer 可重复投递但只产生一次 resolution action。

## 14. 错误处理

- 权限不足 → fail closed；
- 无合格 reviewer → fail closed，不允许自审；
- stable ref 不存在/跨项目 → 整个 Submission rollback；
- required Submission 创建成功但 Review 创建失败 → 整个事务 rollback；
- escalation 中 Decision/link/state/action 任一步失败 → 整个事务 rollback；
- Outbox 通知失败 → 已提交正式 DB facts 不回滚，按现有 Outbox retry；
- AgentRun 失败 → 不影响已存在 Submission/Review 历史；
- ScientificDecision unresolved/non-terminal → Review 保持 awaiting_scientific_decision；
- pending Review task cancel → Review cancelled 与 Task cancelled 原子提交；
- awaiting-scientific-decision task cancel → fail closed；
- duplicate callback/outbox → 幂等，不复制正式事实。

## 15. 数据库迁移

新增 migration：

`packages/db/migrations/0002_human_hybrid_work_review.sql`

不得改写历史 `0000_foundation.sql` / `0001_files_provenance.sql`。

migration 需要：

1. 扩展 research_tasks；
2. 回填 legacy owner；
3. 设置 workflow_version；
4. 添加 TaskSubmission / contributor / ref；
5. 添加 ReviewRequest / ReviewAction / ReviewDecisionLink；
6. 添加 check/unique/FK；
7. 添加 immutable triggers；
8. 添加必要 index。

旧 task：

- assignee null → 用 created_by 回填（仅保证 FK/non-null，不宣称该成员仍具 v2 owner 资格）；
- executionMode → human；
- reviewPolicy → none；
- acceptanceCriteria → []；
- workflowVersion → 1。

新 task application create → workflowVersion 2。

active v1 task 在第一次 post-migration lifecycle mutation 时必须按 4.3 原子升级 v2；若回填 owner 已 inactive/失去项目访问，则先由项目主理人/团队总负责人指定合格 owner，再完成升级。migration 不伪造此前 provenance。

## 16. Web 产品结构

项目导航新增：

```text
总览
研究工作
研究网络
证据与结果
科学决策
智能工作
文件与资料
```

### 16.1 项目研究工作

路径：

`/projects/[projectId]/work`

回答：

> 团队当前在做什么、谁负责、采用什么执行方式、提交到哪、谁在审核？

task list/card 展示：

- title；
- accountable owner；
- executionMode；
- reviewPolicy；
- task status；
- latest Submission；
- current reviewer；
- Review status；
- Agent work count / latest run state。

task detail 展示可读 provenance timeline：

```text
Requirements
↓
execution mode / owner changes
↓
AgentRuns / human contributors
↓
Submission #1
↓
Review #1
↓
Submission #2
↓
Review #2
↓
ScientificDecision link（如有）
```

### 16.2 智能工作页面继续独立

现有 `/projects/[projectId]/agent-work` 不合并进 Research Work。

Research Work 回答工作责任/交付/审核；Agent Work 回答 AI 运行事实。

### 16.3 Team-level Review Inbox

新增轻量：

`/reviews`

只回答：

> 哪些 Review 正在等我？

展示：

- project；
- task；
- Submission number；
- submitter；
- waiting duration；
- Review status；
- 是否等待 ScientificDecision。

点击进入 project task detail。

本页面不是 Phase 4C cockpit。

## 17. Phase 4C 前向接口

Phase 4B 必须提供稳定 query source，使 4C 以后可以读取：

- `ResearchTask.status`
- `ResearchTask.assigneeMemberId`
- `ReviewRequest.status`
- `ReviewRequest.reviewerMemberId`
- `TaskSubmission.createdAt`
- `AgentRun.state`
- `ScientificDecision.status`

4C 可以投影：

- 待我审核；
- blocked task；
- awaiting scientific decision；
- 长时间无动作；
- recent submission；
- recent completion；
- Agent waiting human。

但 4C projection 不得直接修改 4B 正式状态。

## 18. 测试策略

### 18.1 Domain/Application/DB tests

必须覆盖：

- v2 task owner 非空；
- executionMode 只允许 human actor 改；
- task requirement changes eventized；
- TaskSubmission immutable；
- Submission ref/contributor immutable；
- submittedBy 自动 contributor；
- cross-project ref rejection；
- wrong-project AgentRun contributor rejection；
- required task 无 approved Review 无法 completed；
- reviewPolicy none 仍要求正式 Submission 后才能 completed，并且 completion 必须绑定最新 Submission；
- reopen 后旧 completion event / accepted submission provenance 保留；
- reviewer human-only；
- reviewer 必须有项目访问权；
- contributor cannot self-review；
- reassignment event/history；
- old Submission requirement snapshot 不漂移；
- reviewPolicy 第一份 Submission 后不可降级/修改；
- v2 仅允许 `in_progress` task 创建正式 Submission；
- changes requested 后创建新 Submission；
- Review approved 不改变 official state；
- ScientificDecision approved 不自动 approve Review；
- Decision rejected 不自动 reject Submission；
- escalation atomicity；
- Decision resolution idempotency；
- concurrent double submit；
- concurrent double approve；
- concurrent double escalation；
- structured credential-shaped key rejection；
- 自由文本不被错误复制到 ResearchEvent/Outbox/普通日志；
- restricted file ref 不扩大 locator/content access；
- active legacy v1 首次 post-migration lifecycle mutation 原子升级 v2，不再允许 legacy direct completion；
- legacy owner 失效时升级 fail closed，直到 lead 指定合格 owner；
- legacy completed task reopen upgrades to v2；
- pending Review task cancellation 原子保存 Review cancelled + Task cancelled；
- awaiting-scientific-decision cancellation fail closed；
- non-terminal ScientificDecision reviewed event 不得提前 resume Review；
- required/unreviewed 两种完成路径都产生一次带 submissionId 的 RESEARCH_TASK_COMPLETED。

### 18.2 Browser acceptance

Phase 4B 至少覆盖 9 个 Playwright 场景：

1. human task → pure-text Submission → reviewPolicy none → explicit completion；Submission history 可见。
2. required-review task 提交后 awaiting_review；owner 无法绕过 Review 直接 completed。
3. 指定 reviewer approve → Submission accepted + Task completed。
4. request_changes → Submission #1 / Review #1 保留；Submission #2 + Review #2 approved。
5. contributor 登录不显示/不能执行自己 Submission 的 approval；另一指定 reviewer 可以。
6. hybrid task 展示 human + AgentRun provenance；AgentRun completed 本身不 complete Task。
7. Review escalation → ScientificDecision；official pointer 在既有科学审批完成前不变；Decision approved 后 Review 仍需 final approve。
8. restricted FileVersion ref 对普通 reviewer 保持 locator redaction / content authorization。
9. completed task explicit reopen 后旧 accepted Submission/Review 仍可见，并形成新 Submission cycle。

并发/重复投递优先放 integration tests，不用 Playwright 模拟。

### 18.3 Full regression

阶段末 fresh full CI：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm acceptance
```

必须继续覆盖：

- Phase 2 ScientificDecision；
- Phase 3 Agent runtime；
- Phase 4A Files & Provenance；
- Phase 4B 新场景。

真实 Agent provider smoke 继续遵守既有产品决定：服务/凭据缺失时明确 SKIP，绝不能报告 PASS。

## 19. 单 Agent 实施与审查策略

当前没有第二个 AI reviewer/subagent。

未来 Phase 4B 实施记录必须明确：

- execution mode: Native / `superpowers:executing-plans`
- independent AI reviewer: unavailable

风险补偿：

- 每个任务 RED → GREEN；
- 小而有意义的 commits；
- 每次恢复先核验真实 GitHub head / Actions；
- 只修当前 exact head 的当前失败；
- 不重复已经通过的层；
- 实现完成后从 spec 重新开始做 invariant/diff self-review；
- 最终 implementation tree fresh full CI；
- 写 `docs/superpowers/reviews/` verification record；
- Draft PR 保持人工 gate；
- 不 auto-merge。

self-review 可以称为 coordinator self-review / manual invariant review，不能称为 independent review。

## 20. Phase 4B 完成标准

Phase 4B 只有同时满足以下条件才完成：

1. workflow v2 ResearchTask 能表达 human / agent / hybrid 执行意图。
2. 每个 v2 task 始终有 human accountable owner。
3. Agent 不能直接创建正式 TaskSubmission。
4. TaskSubmission 不可变、多版本、可冻结 requirement snapshot。
5. Submission 可表达 human/AgentRun contributors 和稳定 refs。
6. required Review 无法绕过。
7. contributor 不得自审。
8. reviewer assignment/reassignment 可追踪。
9. Review escalation 与 ScientificDecision 显式关联但状态机分离。
10. ScientificDecision resolution 不自动决定普通 Review。
11. old Submission / Review / failed revision history 全部保留。
12. restricted file 权限不会通过 Review 泄漏。
13. concurrent submit/review/escalation 不产生重复正式事实。
14. legacy v1 task 不被伪造 provenance；reopen 后升级 v2。
15. Phase 2/3/4A 回归继续绿色。
16. final verification record 与 exact-head full CI 一致。
17. real provider/service SKIP 继续如实记录。
18. 当前无 independent reviewer 的限制明确记录。

## 21. 关键不变量清单

自动化测试必须固定：

1. AI 不能提交正式 TaskSubmission。
2. AI 不能批准普通 Review。
3. AI 不能批准 ScientificDecision。
4. v2 ResearchTask 必须有人类 accountable owner。
5. executionMode 不能作为实际 contributor provenance 的替代。
6. TaskSubmission / contributor / refs 不可修改或删除。
7. Review 始终绑定具体 immutable Submission。
8. required-review task 无 approved Review 不得 completed。
9. ordinary Review approved 不得改变 official scientific pointer。
10. ScientificDecision approved 不得自动 approve Review。
11. ScientificDecision approved 不得自动 complete Task。
12. reviewer 不能审核自己的 Submission。
13. Submission refs 必须与 Task 同 project。
14. requirement snapshot 在提交后不得漂移。
15. changes requested/rejected 不删除旧 Submission/Review。
16. reopen 不覆盖旧 accepted Submission。
17. review reassignment 不擦除旧 reviewer history。
18. duplicate external/async processing 不复制 resolution facts。
19. unreviewed completion 必须显式定位 accepted latest Submission，不能仅靠“当前 task 已完成”推断。
20. restricted FileVersion ref 不扩大访问权限.
21. 结构化 credential payload 必须经过 secret-key guard；自由文本不得复制到 Event/Outbox/普通日志。
22. active legacy task 不得永久停留在 v1 绕过新规则；首次 post-migration lifecycle mutation 必须升级 v2，但不得伪造旧 provenance。
23. pending Review cancellation 必须留下独立 cancelled 历史，不能伪装成 reviewer reject；awaiting ScientificDecision 时不得取消。
24. Decision resolution 只有 linked ScientificDecision 为 terminal approved/rejected 才能恢复 Review。
25. 每次 Task completed 都必须显式绑定 accepted submissionId。
26. 4C projection 不得成为 4B 正式状态的写入源。

## 22. 规格结论

Phase 4B 采用对现有领域的增量扩展，而不是重写 Phase 1–4A：

```text
ResearchTask       = 工作责任与当前执行意图
AgentTask/AgentRun = AI 执行事实
TaskSubmission     = 人类正式提交的不可变交付版本
ReviewRequest      = 普通质量/交付验收
ScientificDecision = 正式科学治理
ResearchEvent      = 为什么发生变化
Phase 4C           = 从上述事实做 projection
```

该结构保留 Research Workbench / Harness / GitHub 三个事实源的既有分工，并使 human、agent、hybrid 工作在不牺牲治理、审计和 provenance 的情况下汇流到同一个科研工作闭环。
