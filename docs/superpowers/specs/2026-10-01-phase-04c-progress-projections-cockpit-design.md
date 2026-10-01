# Phase 4C — Progress Projections & Cockpit Foundation 设计规格

日期：2026-10-01

状态：**Design approved in conversation; written spec pending human review**

基线：

- Phase 3 Agent Runtime：`1a95b548f4a87eaf908df9ce46db1dd7de02e8d3`
- Phase 4A Files & Provenance：`5fabe937bc9258314e01253df9e5e94e5b8d55f8`
- Phase 4B Human/Hybrid Work & Review exact head：`48aed98433cb43597dc68fd6215aac91575b980e`
- 本规格设计分支：`phase/04c-progress-cockpit-design`

相关规格：

- `docs/superpowers/specs/2026-09-29-research-workbench-design.md`
- `docs/superpowers/plans/2026-09-29-research-workbench-roadmap.md`
- `docs/superpowers/specs/2026-09-30-phase-04a-files-provenance-design.md`
- `docs/superpowers/specs/2026-09-30-phase-04b-human-hybrid-work-review-design.md`
- `docs/superpowers/reviews/2026-09-30-phase-04b-verification.md`

---

## 1. 阶段定位

Phase 4C 的正式定位是：

**Progress Projection & Cockpit Foundation**

它把 Research Workbench 已经持久化的正式科研与工作流事实，安全、确定性、角色相关地投影成：

1. 现在明确轮到当前用户处理什么；
2. 当前可见项目有哪些需要关注的正式事实；
3. 最近发生了哪些重要正式变化。

本阶段不是新的业务事实层，也不是新的工作流引擎。

Phase 4C 必须坚持：

- Research Workbench PostgreSQL 仍是科研/工作流正式事实源；
- DeepSeek Harness 仍是 AI 执行事实平面；
- GitHub 仍是工程事实源；
- Cockpit 只是 Research Workbench 内部的 read-side projection；
- Phase 4C 不成为第四个 truth plane；
- projection 不能直接修改 `ResearchTask`、`ReviewRequest`、`ScientificDecision`、`AgentRun`、`FileVersion` 或任何正式科研状态；
- projection 读取本身不产生 `ResearchEvent`、Outbox、acknowledgment 或自动状态变化。

Phase 4C 是总设计中 cockpit 愿景的 foundation，而不是一次性完成所有组合管理能力。

---

## 2. 为什么现在做 4C

Phase 4A 和 4B 已经建立了稳定、可审计的事实边界：

- immutable FileVersion / provenance；
- ResearchTask 的 human accountable owner；
- TaskSubmission 的不可变提交版本；
- ordinary Review 与 ScientificDecision 的明确分离；
- AgentTask / AgentRun 的执行事实；
- ResearchEvent 的追加式历史；
- 多维科研状态；
- ResearchResult 与正式科研版本。

Phase 4C 的职责是消费这些事实，而不是重新定义这些事实。

如果 4C 直接发明新的“项目健康度”“完成百分比”或 AI priority，就会把 projection 变成新的解释性真相源，违背总架构“人负责科学含义、AI 负责受控执行”的原则。

---

## 3. 核心设计原则

### 3.1 On-demand read models

Phase 4C 采用 on-demand read model，不新增 mutable projection truth table，不新增 event-driven materialized projection worker。

首版固定 6 人团队、约 5 个并行项目，on-demand projection 可以避免：

- projection lag；
- replay complexity；
- projection rebuild semantics；
- 第四个隐式 truth source；
- 额外的缓存一致性问题。

未来规模增长后可以重新设计 materialized projection，但 canonical state 仍必须 authoritative，projection 必须可重建，lag 必须显式。

### 3.2 Deterministic attention，不做 AI ranking

Cockpit 只提供 deterministic lanes 和事实摘要。

明确禁止：

- progress percentage；
- project health score；
- risk score；
- Green / Amber / Red；
- on-track / off-track；
- AI priority score；
- “哪个项目最重要”的自动判断；
- 根据文件数量、Agent activity、提交数量推断科研完成度。

排序只用于可用性，不表达优先级判断。

### 3.3 Current state 与 historical transition 分离

固定规则：

> Current state 看 canonical tables；历史变化看 curated ResearchEvent。

例如：

- task 当前是否 blocked：看 `research_tasks.status`；
- Review 当前是否 pending：看 `review_requests.status`；
- Decision 当前轮到谁：看 `scientific_decisions.status` + canonical roles；
- Agent 当前异常：看每个 AgentTask 最新 attempt 的 `agent_runs.state`；
- File 当前 parse failure：看 `ResearchFile.currentVersionId` 对应 `FileVersion.parseStatus`。

不能因为历史存在一个 blocked/failed event 就判断当前仍是 blocked/failed。

### 3.4 Projection 只读 + deep links

Cockpit 不直接执行：

- approve/reject Review；
- approve/reject ScientificDecision；
- unblock/cancel/complete ResearchTask；
- 回答 Agent human interaction；
- retry AgentRun；
- 修改 FileVersion 或 parser 状态。

所有动作继续进入既有 canonical workflow 页面。

---

## 4. 信息架构

### 4.1 不新增一级导航

总设计明确“第一版不增加更多一级导航”。

Phase 4C 演进现有入口：

- `/portfolio` → role-aware portfolio cockpit；
- `/projects/[projectId]` → 增加 project-level attention / recent activity；
- `/reviews`、Decision、Research Work、Agent Work、Files 页面继续作为 canonical workflow/detail surfaces。

不新增独立 `/cockpit` 一级入口。

### 4.2 Portfolio 信息层级

`/portfolio` 固定回答三个问题：

1. 我的明确行动；
2. 项目当前关注；
3. 最近重要正式变化。

Organization Lead 和 researcher 使用同一产品结构，但可见范围不同。

Researcher：

- 只看到有 project membership 的项目；
- “我的明确行动”只显示真正属于本人的 Review / ScientificDecision；
- 项目关注来自本人可访问项目。

Organization Lead：

- 可看到本 team 全部项目；
- 但“我的明确行动”仍只显示真正轮到本人的事项；
- 其他人的 assigned Review 不能被错误写成“待我处理”。

### 4.3 Project Overview 信息层级

`/projects/[projectId]` 保留“项目首先是科研对象，而不是任务容器”的原则。

页面顺序：

1. PageHeader；
2. ProjectNavigation；
3. 多维科研状态；
4. 项目明确行动 / 项目关注；
5. Recent Activity；
6. 项目成员。

多维科研状态仍是项目总览核心，不被 task/attention 取代。

---

## 5. Projection 输入边界

Phase 4C 可以读取：

- `ResearchDimensionState`
- `ResearchTask`
- `TaskSubmission`
- `ReviewRequest`
- `ReviewAction`
- `ReviewDecisionLink`
- `ScientificDecision`
- `DecisionReview`
- `AgentTask`
- `AgentRun`
- `AgentHumanInteraction`
- `ResearchFile`
- `FileVersion`
- `FileProcessingRecord`
- `ResearchResult`
- curated allowlist `ResearchEvent`

Phase 4C 不直接消费外部系统当前状态。

Cockpit 请求路径不得为了补充 projection：

- 调 Harness；
- 调真实 Agent provider；
- 调 GitHub；
- 调 SeaweedFS；
- 调 ClamAV；
- 调 Tika；
- 调 Docling；
- 重新解析文件；
- 启动 background job。

外部系统只能通过既有受控集成先把事实写入 Workbench canonical DB，再由 4C 读取。

---

## 6. Attention taxonomy

Attention 分为两层语义：

### 6.1 我的明确行动

只有系统能够确定责任人就是当前用户的事项才能进入。

#### `my_review`

进入条件：

- `ReviewRequest.status = pending`
- `ReviewRequest.reviewerMemberId = currentMember.id`

退出条件：

- Review 不再 pending；
- reviewer 被 reassigned。

`awaiting_scientific_decision` 不算普通 Review actionable。

#### `my_scientific_decision`

进入条件：

- Decision status 为 `proposed` 或 `needs_evidence`，且当前用户是项目 canonical project lead；
- 或 Decision status 为 `awaiting_lead`，且当前用户是 organization lead。

该规则必须与真实 `reviewScientificDecision()` 状态机保持一致。

退出条件：

- Decision status 或审批阶段改变；
- 当前用户不再是该阶段合法 reviewer。

### 6.2 项目关注

这些事项是项目当前事实，不应被描述成“专门指派给我”。

#### `blocked_task`

进入：

- `ResearchTask.status = blocked`

退出：

- task 离开 blocked。

只表达“任务受阻”，不推断严重度。

#### `awaiting_scientific_decision`

进入：

- `ReviewRequest.status = awaiting_scientific_decision`

退出：

- Review 恢复 `pending` 或进入其他状态。

语义：ordinary Review 正等待 separate ScientificDecision governance。

#### `agent_waiting_human`

进入：

- 某 `AgentTask` 的 latest attempt 当前 `AgentRun.state = 等待人工输入`

退出：

- latest run 离开该状态；
- 或出现更新 attempt。

必须显示“等待人工输入”，不能写“等待你”，因为当前 Agent human interaction 没有独立 assignee。

#### `agent_run_failed`

进入：

- 某 `AgentTask` 的 latest attempt 当前 `AgentRun.state = 失败`

退出：

- 出现更新 attempt；
- 或当前 run state 改变。

历史失败 Run 永久保留，但不继续污染当前 attention。

#### `file_parse_failed`

进入：

- `ResearchFile.currentVersionId` 指向的当前 `FileVersion.parseStatus = failed`

退出：

- current version 改变；
- 或 current version parse status 不再 failed。

Parser failure 只能表达“当前文件版本解析失败”，不能写成“数据异常”或“科研数据无效”。

`FILE_SCAN_REJECTED`、upload `processing_failed` 等历史/操作事实进入 Recent Activity 和 Files canonical history，不在 4C 发明新的 acknowledgement 状态。

#### `long_idle_work`

进入：

- task status 为 `open` 或 `in_progress`；
- `lastMeaningfulActivityAt <= now - 14*24h`。

固定阈值：

- 14 × 24 hours；
- 不是跨过 14 个日历日期。

`lastMeaningfulActivityAt` 取以下最大值：

- `ResearchTask.updatedAt`
- 该 task 最新 `TaskSubmission.createdAt`
- 相关 `ReviewRequest.updatedAt`
- 通过 ReviewDecisionLink 关联的 `ScientificDecision.updatedAt`
- 该 task 下最新 `AgentRun.updatedAt`

退出：

- 新 meaningful activity；
- task 状态变化；
- task 进入 terminal；
- task 进入已有更明确 waiting/blocking 语义。

显示文案只能类似“X 天无记录活动”，不能写“停滞”“高风险”。

---

## 7. Attention 去重与排序

### 7.1 去重原则

Attention 内去重，Recent Activity 独立。

同一业务根因不重复占多个 attention lane。

主要 precedence：

1. 明确个人行动优先于同一根因的项目关注；
2. `blocked_task` 优先于 `long_idle_work`；
3. `awaiting_review` / awaiting scientific governance 不进入 `long_idle_work`；
4. `agent_waiting_human` 与 task-level attention 可以并存，因为它描述不同实体和责任边界；
5. Recent Activity 与 attention 可以同时存在，因为两者回答不同问题。

### 7.2 排序

不建立跨 lane 全局 priority ranking。

Lane 内：

- waiting/action 类：最老在前；
- Recent Activity：最新在前；
- 同 timestamp：stable ID 作为 tie-breaker。

---

## 8. Agent latest-attempt semantics

对每个 `AgentTask`：

> latest attempt = 最大 `attemptNumber`

数据库已有 `(agentTaskId, attemptNumber)` unique constraint。

例如：

- attempt #1 failed；
- attempt #2 completed；

则当前 `agent_run_failed = false`。

旧失败仍保留在 Agent history 和 Recent Activity。

一个 ResearchTask 可以对应多个 AgentTask。不同 AgentTask 各自独立产生当前 attention，不强行合并。

---

## 9. Recent Activity

Recent Activity 与 attention 完全分离。

### 9.1 时间窗口与数量

- 最近 14 天；
- 每项目最多 10 条；
- portfolio 项目卡只展示少量 preview；
- activity newest-first。

### 9.2 Curated semantic allowlist

Recent Activity 只投影重要正式事实，包括：

- TaskSubmission 创建；
- ResearchTask completed / reopened / blocked / unblocked；
- Review approve / request-changes / reject / escalation / reassignment 等实质状态变化；
- ScientificDecision proposed / evidence requested / stage approval / approved / rejected；
- `RESEARCH_STATE_CHANGED`；
- `ResearchResult` created / superseded；
- AgentRun waiting-human / completed / failed 等受控状态转换；
- ResearchFile / FileVersion 创建；
- `FILE_PARSE_FAILED`；
- `FILE_SCAN_REJECTED`。

Recent Activity 必须覆盖 ResearchResult 和 multidimensional research state，避免 4C 退化成纯任务管理 dashboard。

### 9.3 Canonical row 与 event 去重

同一业务变化如果同时存在 canonical row 和 `ResearchEvent`：

- 当前状态以 canonical row 为准；
- historical transition 才读取 allowlist event；
- UI 只产生一个 semantic activity item；
- raw `ResearchEvent.payload` 永远不进入 Web DTO。

未知 event type 默认不进入 allowlist。

---

## 10. Safe-summary data boundary

Cockpit DTO 采用最小必要信息 allowlist。

允许：

- stable ID；
- project/task/review/decision/run/file ID；
- safe title；
- canonical status；
- human display name；
- submission number；
- Agent attempt number；
- File version number；
- access class；
- timestamp；
- lane kind；
- canonical deep-link href。

禁止进入 Cockpit DTO：

- restricted `uriOrLocator`；
- `accessPolicyRef`；
- file extracted text；
- arbitrary `sourceMetadata`；
- processor raw output；
- TaskSubmission summary；
- Review comment；
- Decision reason；
- Decision evidence payload；
- Agent request payload；
- Agent human interaction payload；
- raw exception；
- arbitrary `ResearchEvent.payload`；
- credential-shaped values。

Safe summary 必须从 SQL/DTO 层成立，不能先把敏感数据送到 Web 再靠 CSS 隐藏。

---

## 11. Projection module boundary

Phase 4C 建议增加独立 application read-model seam：

~~~text
packages/application/src/projections/
├── cockpit-types.ts
├── cockpit-classification.ts
├── cockpit-query-service.ts
└── cockpit-query-service.test.ts

apps/web/src/server/
└── cockpit-queries.ts
~~~

职责：

### `cockpit-types.ts`

定义安全 discriminated union DTO。

### `cockpit-classification.ts`

尽量保持 pure functions：

- 14-day idle；
- latest-attempt；
- lane classification；
- precedence / dedup；
- deterministic sorting；
- recent cutoff。

### `cockpit-query-service.ts`

负责：

- authorized visible project scope；
- canonical SQL reads；
- curated event reads；
- consistent snapshot；
- safe DTO assembly。

### `apps/web/src/server/cockpit-queries.ts`

只负责：

- 当前登录 member；
- DB adapter；
- 调 application projection service；
- Web error adaptation。

Web 不重新实现分类规则。

---

## 12. Stable application query contract

首版只有两个稳定入口：

~~~ts
listPortfolioCockpit(sql, viewer, now)
getProjectCockpit(sql, viewer, projectId, now)
~~~

Application 层使用最小 viewer：

~~~ts
type CockpitViewer = {
  memberId: string;
  teamId: string;
  organizationRole: "lead" | "researcher";
};
~~~

不能反向依赖 Next.js 的 `CurrentMember` 类型。

`now` 必须显式注入，用于：

- `generatedAt`；
- 14-day idle；
- 14-day Recent Activity。

Classification 内部不得各自调用 `new Date()` 造成时间漂移。

---

## 13. DTO 形状

Attention 使用 discriminated union，而不是 nullable mega-object。

概念上：

~~~ts
type CockpitAttentionItem =
  | MyReviewAttention
  | MyScientificDecisionAttention
  | BlockedTaskAttention
  | AwaitingScientificDecisionAttention
  | AgentWaitingHumanAttention
  | AgentRunFailedAttention
  | FileParseFailedAttention
  | LongIdleWorkAttention;
~~~

共享最小字段：

~~~ts
type AttentionBase = {
  kind: AttentionKind;
  id: string;
  projectId: string;
  projectTitle: string;
  occurredOrWaitingSince: Date;
  href: string;
};
~~~

Recent Activity 使用独立 `CockpitActivityItem` union，不复用 attention DTO，不包含 severity / priority / actionable score。

Portfolio snapshot：

~~~ts
type PortfolioCockpit = {
  generatedAt: Date;
  myActions: CockpitAttentionItem[];
  projects: ProjectCockpitSummary[];
  recentActivity: CockpitActivityItem[];
};
~~~

Project snapshot：

~~~ts
type ProjectCockpit = {
  generatedAt: Date;
  project: SafeProjectSummary;
  explicitActions: CockpitAttentionItem[];
  attention: CockpitAttentionItem[];
  recentActivity: CockpitActivityItem[];
};
~~~

`generatedAt` 只是本次 on-demand observation time，不是持久化 projection version。

---

## 14. 授权模型

### 14.1 Project-level

`getProjectCockpit()` 必须先走现有：

~~~ts
authorizeProjectAccess(sql, memberId, projectId, "read")
~~~

### 14.2 Portfolio scope

Organization Lead：

- 只读本 team 项目。

Researcher：

- 只读有 project membership 的项目。

所有后续 SQL 必须从 authorized project IDs 开始约束，不能先读全表再在 JavaScript 过滤。

### 14.3 Explicit action responsibility

即使 organization lead 能看到全 team 项目，也不能把他人的 Review 归入自己的 `my_review`。

ScientificDecision eligibility 必须复用/提取现有写路径状态机的同一 pure rule，避免 read/write drift。

### 14.4 Deep link 不是授权凭据

进入 canonical workflow 页面后必须重新执行该页面原有授权。

---

## 15. Consistent read snapshot

一次 cockpit 请求必须对应一个 transactionally consistent read snapshot。

首选：

- PostgreSQL `REPEATABLE READ READ ONLY`；
- 或当前 DB abstraction 可提供的等价一致读语义。

目的：

- totalCount 与 preview item 不漂移；
- 同一次 snapshot 内各 lane 使用同一 canonical observation；
- 并发 mutation 只在下一次请求可见。

所有时间判断使用 service 入口捕获的同一个 `now`。

数据库时间按 absolute instant 比较；用户时区只影响 UI formatting。

---

## 16. 查询策略与性能边界

首版规模小，但仍避免 project × task × submission N+1。

Query service 默认按 authorized visible project IDs 批量读取：

- task/current review；
- latest Agent attempts；
- current FileVersion parse failures；
- Decision state；
- research dimensions；
- recent curated events/facts。

然后在 application memory 中 deterministic classify / deduplicate / aggregate。

本阶段不需要 projection table migration。

只有实际 query plan 证明现有 index 不足时，才允许增加纯性能 index；index 不得改变领域语义。

---

## 17. UI 行为

### 17.1 Portfolio

顺序：

1. 我的明确行动；
2. 项目事实摘要 + 当前关注；
3. 最近重要正式变化。

Project card 可以展示：

- project title；
- lead；
- multidimensional research states；
- lane total counts；
- 每 lane 最多 3 条 preview；
- latest meaningful formal activity time。

不显示综合分数。

### 17.2 Project Overview

Project attention 可以比 portfolio preview 更完整，但仍不是审计历史页。

完整历史继续在 Task / Review / Decision / Agent / Files canonical pages。

### 17.3 Deep-link mapping

- `my_review` → Review Inbox 或对应 task detail；
- `my_scientific_decision` → project Decision page；
- `blocked_task` → ResearchTask detail；
- `awaiting_scientific_decision` → task/review detail；
- `agent_waiting_human` → Agent Work/run；
- `agent_run_failed` → AgentRun；
- `file_parse_failed` → ResearchFile detail；
- `long_idle_work` → ResearchTask detail；
- result/state/file activity → 对应 canonical page。

不新增 `/cockpit/action/*` workflow。

### 17.4 Empty state

只能表达 query 事实，例如：

- “当前没有明确等待你处理的事项。”
- “最近 14 天没有符合 cockpit allowlist 的正式变化。”

禁止：

- “全部正常”；
- “没有风险”；
- “项目进展顺利”。

---

## 18. Failure semantics

### 18.1 Empty 与 unavailable 不得混淆

必须区分：

- 当前没有 attention；
- 当前无法确认是否有 attention。

Application projection 要么返回完整成功 snapshot，要么失败。

禁止：

~~~ts
catch {
  return [];
}
~~~

Projection 失败时 UI 应显示：

- “科研关注投影暂时不可用。”

不能伪装成：

- “没有关注事项。”

### 18.2 No stale fallback

首版不使用：

- projection table；
- Redis cockpit cache；
- stale-while-error snapshot；
- background refresh worker。

DB 读取失败时明确 unavailable。

### 18.3 Fail-closed，但不扩大故障范围

Project canonical overview 可以继续显示已成功读取的原有科研状态。

4C projection 子区域失败时只标记该区域 unavailable。

Cockpit failure 不应该把整个 Workbench 判死，但也不能美化成 healthy/empty。

### 18.4 Unknown canonical status

如果 projection 依赖的 canonical table 出现未知/非法状态：

- projection fail closed；
- 不静默忽略；
- 不把该 item 当成不存在。

Unknown event type 则默认不进入 Recent Activity allowlist。

---

## 19. 文件与 Agent 异常的解释边界

### 19.1 File

`file_parse_failed` 只说明当前 FileVersion 解析失败。

它不说明：

- 原始数据错误；
- 研究结论无效；
- 数据质量差。

Restricted file cockpit summary 绝不暴露 locator/access policy。

### 19.2 Agent

`agent_run_failed` 只说明当前 latest attempt 失败。

它不说明：

- ResearchTask 失败；
- 科研结论失败；
- 项目风险升高。

Agent old failed attempts 仍永久可审计。

---

## 20. 总设计中暂不进入 4C 的能力

总设计 §9 中还有合理的 cockpit 愿景，但当前缺少足够稳定 canonical model：

- 科学风险结构化模型；
- 数据/识别/理论/复现风险评价；
- 人员负载；
- 临时协作需求；
- 跨项目复用机会；
- 投稿/返修/内部审验 deadline；
- 自动生成组合会议 briefing。

Phase 4C 不得通过 heuristic 或 AI inference 假装这些对象已经存在。

正确顺序是：

1. 后续阶段先设计 canonical domain model；
2. 正式事实写入 Workbench；
3. cockpit 再消费这些正式事实。

---

## 21. 与 Knowledge / Ontology / Reasoning 的关系

Phase 4C 不成为 Knowledge source of truth。

未来 Knowledge/Ontology 可以消费：

- stable IDs；
- immutable versions；
- ResearchResult；
- ResearchEvent；
- ScientificDecision；
- TaskSubmission / Review history；
- FileVersion / provenance；
- ResearchDimensionState。

未来 reasoning engine 产出的内容如果要进入 cockpit：

- 必须先成为明确标记的 observation / proposal / 正式领域事实；
- 不能让模型推理文本直接被 cockpit 渲染成“事实”。

---

## 22. 测试策略

### 22.1 Pure classification tests

必须覆盖：

- 14-day idle boundary；
- meaningful activity reset；
- terminal task exclusion；
- blocked > long-idle precedence；
- review/governance exclusion from idle；
- latest Agent attempt；
- multiple AgentTask independence；
- attention dedup；
- stable sorting；
- 14-day Recent Activity cutoff；
- unknown event exclusion。

### 22.2 Application / DB integration

必须覆盖：

- researcher visibility；
- organization lead team scope；
- explicit Review action ownership；
- ScientificDecision real state-machine ownership；
- blocked current state；
- awaiting-scientific-decision separation；
- Agent waiting-human semantics；
- Agent failed → retry success clears current failure；
- current FileVersion parse failure；
- restricted file safe DTO；
- review/decision free-text redaction；
- curated activity canonical/event dedup；
- ResearchResult recent activity；
- research dimension recent activity；
- query read-only invariant；
- unknown canonical status fail-closed。

### 22.3 Consistent snapshot

并发 mutation 发生在内部多次读取之间时，同一 cockpit call 必须保持一致 snapshot。

下一次新 call 才观察到 mutation。

### 22.4 Browser acceptance

新增：

`tests/acceptance/progress-cockpit.spec.ts`

至少覆盖 10 个场景：

1. researcher / organization lead visible scope；
2. assigned pending Review 只进入正确用户“我的明确行动”；
3. ScientificDecision 两级审批责任正确；
4. blocked → unblocked，且 blocked 不重复显示 idle；
5. 14 天 idle 与新 Submission reset；
6. Agent waiting-human / failed / retry success；
7. current FileVersion parse failure + restricted metadata redaction；
8. Recent Activity 覆盖 Task/Decision/ResearchResult/research-state/file，遵守 14 天窗口；
9. Project Overview 保留科研状态并增加 attention/recent activity + canonical deep links；
10. projection failure 显示 unavailable，不伪装 empty/healthy。

### 22.5 Negative acceptance

自动化验证页面不存在：

- progress %；
- health/risk score；
- Green/Amber/Red；
- AI priority ranking；
- unauthorized cross-project data；
- restricted locator/access policy；
- raw ResearchEvent payload；
- raw Agent exception；
- Submission/Review/Decision 敏感正文；
- cockpit 内 mutation controls。

---

## 23. Phase 4C 回归闸门

Implementation 完成后稳定 checkpoint 必须执行：

~~~text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm acceptance
~~~

`pnpm acceptance` 必须包含 Phase 1–4C 全部浏览器规格。

然后：

1. 写 Phase 4C verification record；
2. commit verification record；
3. 对包含 verification record 的 exact head 执行新的完整 CI；
4. 只有最终 exact-head success 才是 Phase 4C 最终工程验证证据。

旧成功 run 不能替代 final head。

Fixture/selector/harness race 必须先与 product defect 区分，再决定是否改 production code。

---

## 24. Real-service SKIP 语义

Phase 4C 本身不调用真实外部服务，因此不新增 real-provider 前置条件。

Phase 4B 既有 conditional real smokes 保持原语义：

- Harness/provider smoke；
- Harness/subagent smoke；
- standalone SeaweedFS S3 smoke；
- ClamAV smoke；
- Tika smoke；
- Docling smoke。

依赖不可用时：

**SKIP 仍然是 SKIP，绝不能报告 PASS。**

Real tusd + SeaweedFS browser regression 继续要求绿色。

---

## 25. 开发与审查纪律

本规格批准后才进入 `superpowers:writing-plans`。

Implementation plan 批准后才允许 product implementation。

实施原则继续沿用：

- Native / `superpowers:executing-plans`；
- TDD RED → GREEN；
- small meaningful commits；
- checkpoint-first；
- every resume re-read GitHub exact head / recent Actions / relevant PRs；
- newer successful exact-head evidence supersedes obsolete failures；
- one small batch per risk class；
- phase end fresh full CI + Playwright + verification record；
- Draft PR human gate；
- never auto-merge；
- never auto-mark ready-for-review。

当前工具环境没有 independent AI reviewer/subagent reviewer。

最终记录必须如实写：

**independent AI reviewer: unavailable**

最终审查可以做 coordinator/manual invariant review，但不能声称独立 AI reviewer 已执行。

---

## 26. Phase 4C 明确非目标

本阶段不实现：

- progress percentage；
- health/risk score；
- AI ranking；
- recommendation engine；
- automated project prioritization；
- mutation-capable cockpit；
- new notification acknowledgement workflow；
- customizable dashboard widgets；
- generic BI/reporting；
- projection cache / worker；
- Knowledge base；
- Ontology；
- reasoning engine；
- cross-project scientific inference；
- external-service live aggregation。

---

## 27. 完成标准

Phase 4C 只有同时满足以下条件才算完成：

1. `/portfolio` 成为 role-aware cockpit，且不新增一级导航；
2. `/projects/[projectId]` 增加 project projection，同时保留科研状态核心地位；
3. 所有 attention lanes 均来自 deterministic canonical facts；
4. Recent Activity 是 curated semantic projection；
5. ResearchResult、research dimension、Agent/file operational anomalies 得到正确投影；
6. 没有 progress percentage、health/risk score 或 AI ranking；
7. restricted/free-text/raw-payload 边界通过自动测试；
8. projection 不产生任何 formal-state mutation / Event / Outbox；
9. unavailable 与 empty 明确区分；
10. Phase 1–4B 回归继续绿色；
11. conditional real smokes 如实维持 PASS/SKIP 语义；
12. final verification record 与最终 exact-head CI 一致；
13. Draft PR 保持 Draft，不自动 merge，不自动 ready；
14. independent AI reviewer unavailable 如实记录。

---

## 28. 设计结论

Phase 4C 的职责可以压缩成一句话：

> 把 Research Workbench 已经知道的正式事实，安全、确定性、角色相关地投影成“现在需要谁看什么，以及最近发生了什么”，但绝不替研究者判断科学结论、项目健康度或优先级。

这保持了 Research Workbench 的核心方向：

- AI-native，但 human-governed；
- provenance-first；
- append-only / immutable history；
- explicit scientific decision locks；
- stable IDs；
- current-state / history 分离；
- failures preserved；
- projection 不反向污染 truth。

书面规格获得 human approval 之后，下一步才允许进入正式 implementation planning。
