# Phase 4B — Human/Hybrid ResearchTask & Unified Review Design

- 日期：2026-09-30
- 状态：书面规格待用户审阅
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

为避免伪造历史 provenance：

- Phase 4B migration 前已经存在的 ResearchTask → `workflow_version=1`
- migration 后新建 ResearchTask → `workflow_version=2`
- v1 task 保留 legacy completion 语义，不强迫补造 Submission
- v1 已完成 task 若显式 reopen → 在同一事务升级为 v2，然后遵守 Phase 4B 新规则
- 不允许通过创建伪 Submission/Review 来“补齐”迁移前历史

如果未来显式提供 legacy active task 升级功能，应作为独立业务动作设计；Phase 4B 第一版不自动升级尚未完成的 v1 task。

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

### 4.6 ResearchTask 状态机

Phase 4B v2 状态：

```text
open
  → in_progress
  → blocked
  → in_progress

in_progress
  → awaiting_review      # required review + formal submission

open / in_progress / blocked
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

- v2 completed 必须存在至少一个正式 TaskSubmission；
- required-review task 无 approved Review 时不能 completed；
- `awaiting_review` 必须能定位当前 Submission / Review；
- cancelled 不删除 Submission、Review、AgentRun；
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
3. 验证 task 当前允许提交；
4. 验证 contributors；
5. 验证全部 refs；
6. 分配单调递增 submissionNumber；
7. 冻结 requirement snapshot；
8. 写 Submission / contributors / refs；
9. 根据 reviewPolicy 推进状态；
10. 写 ResearchEvent；
11. 写 Outbox。

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
  → awaiting_scientific_decision

awaiting_scientific_decision
  → pending    # linked ScientificDecision resolved; ordinary review resumes
```

`approved`、`changes_requested`、`rejected` 是该 ReviewRequest 的终态，不可再次修改。

reviewer actions：

- `approve`
- `request_changes`
- `reject`
- `escalate_to_scientific_decision`

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
- linked ScientificDecision resolved → Review 恢复 pending；Task 仍 awaiting_review

reject 默认不取消 ResearchTask。

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

除系统记录 `scientific_decision_resolved` 外，普通 Review decision action 的 actor 必须是 human。

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
- Review 仍处于 awaiting_scientific_decision；
- append 一次 `scientific_decision_resolved`；
- Review → pending；
- 不自动决定 approve/reject。

## 9. 权限模型

第一版业务权限：

| 操作 | 允许主体 |
|---|---|
| 创建 ResearchTask | 有 project 访问权的 human member |
| 修改 v2 task requirements | accountable owner、项目主理人、团队总负责人 |
| 改 executionMode | accountable owner、项目主理人、团队总负责人 |
| 改 accountable owner | 项目主理人、团队总负责人 |
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
- `updateResearchTaskRequirements()`
- `assignResearchTaskOwner()`
- `setResearchTaskExecutionMode()`
- `blockResearchTask()`
- `cancelResearchTask()`
- `reopenResearchTask()`
- legacy v1 compatibility completion path
- v2 `completeUnreviewedTask()`

Phase 4B 后不向 v2 caller 暴露任意 `setResearchTaskStatus(taskId, status)`。

### 10.2 task-submission-service

负责：

- `submitResearchTask()`

并承担 Submission、contributors、refs、snapshot、required Review creation 的事务原子性。

### 10.3 task-review-service

负责：

- `assignReviewer()`
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
- `RESEARCH_TASK_BLOCKED`
- `RESEARCH_TASK_REOPENED`
- `TASK_SUBMISSION_CREATED`
- `REVIEW_REQUEST_CREATED`
- `REVIEW_REASSIGNED`
- `REVIEW_APPROVED`
- `REVIEW_CHANGES_REQUESTED`
- `REVIEW_REJECTED`
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

以下内容写入前均调用 `assertSecretSafe()`：

- task requirements；
- acceptanceCriteria；
- Submission summary；
- requirement snapshot；
- Review comment；
- escalation payload；
- ResearchEvent / Outbox payload。

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
- ScientificDecision unresolved → Review 保持 awaiting_scientific_decision；
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

- assignee null → 用 created_by 回填；
- executionMode → human；
- reviewPolicy → none；
- acceptanceCriteria → []；
- workflowVersion → 1。

新 task application create → workflowVersion 2。

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
- reviewPolicy none 仍要求正式 Submission 后才能 completed；
- reviewer human-only；
- reviewer 必须有项目访问权；
- contributor cannot self-review；
- reassignment event/history；
- old Submission requirement snapshot 不漂移；
- changes requested 后创建新 Submission；
- Review approved 不改变 official state；
- ScientificDecision approved 不自动 approve Review；
- Decision rejected 不自动 reject Submission；
- escalation atomicity；
- Decision resolution idempotency；
- concurrent double submit；
- concurrent double approve；
- concurrent double escalation；
- secret-shaped field rejection；
- ResearchEvent 不复制完整研究文本；
- restricted file ref 不扩大 locator/content access；
- legacy v1 completion compatibility；
- legacy completed task reopen upgrades to v2。

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
19. restricted FileVersion ref 不扩大访问权限。
20. secrets/raw sensitive research content 不得进入 Event/Outbox 普通载荷。
21. legacy task 不得通过伪造历史满足新模型。
22. 4C projection 不得成为 4B 正式状态的写入源。

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
