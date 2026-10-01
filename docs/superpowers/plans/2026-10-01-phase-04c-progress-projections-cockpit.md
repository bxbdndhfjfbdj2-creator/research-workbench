# Phase 4C Progress Projection & Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Subagent-driven execution is not selected for this phase.

**Goal:** Build a deterministic, read-only, role-aware progress projection and cockpit over existing Research Workbench facts without creating a new truth source, priority score, or mutation path.

**Architecture:** Add a focused projection seam under `packages/application/src/projections`, backed by PostgreSQL canonical state plus a curated ResearchEvent allowlist. Current state comes from canonical tables, historical transitions from curated events, all inside one repeatable-read/read-only snapshot. The Web layer only adapts authenticated member context and renders safe DTOs into the existing `/portfolio` and project overview surfaces.

**Tech Stack:** TypeScript, Node.js, postgres.js, PostgreSQL 16, Vitest 3, Next.js App Router, React 19, Playwright 1.55.

**Spec:** `docs/superpowers/specs/2026-10-01-phase-04c-progress-projections-cockpit-design.md`

## Global Constraints

- Phase 4C is a **Progress Projection & Cockpit Foundation**, not a new workflow engine or truth plane.
- Workbench PostgreSQL remains scientific/workflow truth; Harness remains AI execution truth; GitHub remains engineering truth.
- Projection is read-only: no formal-state writes, ResearchEvent, Outbox, acknowledgement state, cache worker, or background refresh.
- No progress percentage, health/risk score, Green/Amber/Red, on-track/off-track, AI priority score, or automated project ranking.
- Do not infer scientific completion from file count, Agent activity, submission count, or similar proxies.
- `long_idle_work` uses exactly `14 * 24 hours`; Recent Activity uses exactly 14 days and at most 10 items per project.
- Current state comes from canonical tables; historical transitions come from a fixed curated ResearchEvent allowlist.
- Restricted locator/access-policy metadata, extracted text, free-text review/submission/decision content, raw exceptions, Agent request/interaction payloads, and raw ResearchEvent payloads must not enter cockpit DTOs.
- `agent_waiting_human` says “等待人工输入”, never “等待你”.
- Agent current attention uses latest attempt = maximum `attemptNumber` per `AgentTask`.
- File parse attention uses only `ResearchFile.currentVersionId`.
- Empty and unavailable are distinct; projection failure must never be rendered as “no attention”.
- Cockpit actions are deep links only; mutations remain in canonical workflow pages.
- Organization Lead scope is current team only; researcher scope is project memberships only.
- Existing Phase 1–4B behavior must remain green.
- Conditional real-service/provider SKIPs remain SKIP.
- Implementation mode: Native / `superpowers:executing-plans`.
- Final verification must state `independent AI reviewer: unavailable`.
- Draft PR remains Draft; do not auto-merge or auto-mark ready.

## Review Focus

1. **ScientificDecision reviewer drift** — Task 1 makes write path, existing Decision UI, and 4C share one pure review-stage rule.
2. **Historical-event/current-state confusion** — Tasks 3–5 prove old block/failure events do not create current attention after canonical state changes.
3. **Restricted/free-text leakage** — Tasks 4–5 and Task 8 prove sensitive fields never enter safe query DTOs or rendered cockpit HTML.
4. **Unavailable masquerading as empty** — Tasks 5–8 prove projection errors become explicit unavailable states.
5. **Superseded operational state** — Tasks 3–5 and Task 8 prove latest Agent attempt/current FileVersion clear stale alerts while history remains visible.

---

## File Map

**Create**
- `packages/application/src/decisions/review-eligibility.ts`
- `packages/application/src/decisions/review-eligibility.test.ts`
- `packages/application/src/projections/cockpit-types.ts`
- `packages/application/src/projections/cockpit-classification.ts`
- `packages/application/src/projections/cockpit-classification.test.ts`
- `packages/application/src/projections/cockpit-current-query.ts`
- `packages/application/src/projections/cockpit-activity-query.ts`
- `packages/application/src/projections/cockpit-query-service.ts`
- `packages/application/src/projections/cockpit-query-service.test.ts`
- `apps/web/src/server/cockpit-queries.ts`
- `apps/web/src/components/cockpit/attention-section.tsx`
- `apps/web/src/components/cockpit/recent-activity.tsx`
- `apps/web/src/components/cockpit/project-cockpit-card.tsx`
- `tests/acceptance/progress-cockpit.spec.ts`
- `docs/superpowers/reviews/2026-10-01-phase-04c-verification.md`

**Modify**
- `packages/application/src/decisions/review-decision.ts`
- `apps/web/src/server/queries.ts`
- `packages/application/src/transactions.ts`
- `packages/application/src/transactions.test.ts`
- `packages/application/src/auth/authorize.ts`
- `apps/web/app/(app)/portfolio/page.tsx`
- `apps/web/app/(app)/projects/[projectId]/page.tsx`
- `apps/web/src/components/agent-runs/agent-task-list.tsx`
- `apps/web/app/globals.css`
- `tests/acceptance/support/environment.ts`
- `package.json`

---

### Task 1: Share ScientificDecision review eligibility

**Files**
- Create `packages/application/src/decisions/review-eligibility.ts`
- Create `packages/application/src/decisions/review-eligibility.test.ts`
- Modify `packages/application/src/decisions/review-decision.ts`
- Modify `apps/web/src/server/queries.ts`

**Interfaces**
- Produces:
~~~ts
export type DecisionReviewStage = "project_lead" | "team_lead";

export function resolveScientificDecisionReviewStage(input: {
  status: DecisionStatus;
  projectLeadMemberId: string;
  reviewerMemberId: string;
  reviewerOrganizationRole: "lead" | "researcher";
}): DecisionReviewStage | null;
~~~
- Task 4/5 consume this rule.

- [ ] **Step 1: Write the failing pure-rule test**

Cover:
- `proposed` + project lead → `project_lead`
- `needs_evidence` + project lead → `project_lead`
- `awaiting_lead` + organization lead → `team_lead`
- wrong reviewer → `null`
- `approved | rejected` → `null`

- [ ] **Step 2: Verify RED**

~~~bash
pnpm exec vitest run packages/application/src/decisions/review-eligibility.test.ts
~~~

Expected: module/function missing.

- [ ] **Step 3: Implement the pure rule**

Only encode review-stage eligibility. Same-team/active-human authorization remains with callers.

- [ ] **Step 4: Refactor `reviewScientificDecision()` to use the helper**

Preserve exact existing errors/transitions/events/outbox:
- wrong project-lead stage → existing project-lead-required error
- wrong team-lead stage → existing organization-lead-required error
- terminal → existing finalized error

- [ ] **Step 5: Refactor existing Decision UI eligibility**

Replace local `canProjectLeadReview/canTeamLeadReview` duplication in `apps/web/src/server/queries.ts`; keep existing DTO unchanged.

- [ ] **Step 6: Verify GREEN**

~~~bash
pnpm exec vitest run packages/application/src/decisions/review-eligibility.test.ts packages/application/src/decisions/decision-state-machine.test.ts
pnpm typecheck
~~~

- [ ] **Step 7: Commit**

~~~bash
git add packages/application/src/decisions/review-eligibility.ts   packages/application/src/decisions/review-eligibility.test.ts   packages/application/src/decisions/review-decision.ts   apps/web/src/server/queries.ts
git commit -m "refactor: share scientific decision review eligibility"
~~~

---

### Task 2: Add repeatable-read/read-only snapshot support

**Files**
- Modify `packages/application/src/transactions.ts`
- Create/modify `packages/application/src/transactions.test.ts`

**Interface**
~~~ts
export async function runInReadOnlySnapshot<T>(
  sql: DatabaseSql,
  work: (tx: TransactionSql) => Promise<T>,
): Promise<T>;
~~~

- [ ] **Step 1: Write failing tests**

Using `tests/integration/support/postgres.ts`:
1. a write inside `runInReadOnlySnapshot()` is rejected;
2. first read inside snapshot → external connection updates row → second read inside snapshot still sees first value → new read after snapshot sees update;
3. snapshot acquisition has a bounded timeout and a late-resolving reserved connection is released rather than leaked.

- [ ] **Step 2: Verify RED**

~~~bash
pnpm exec vitest run packages/application/src/transactions.test.ts
~~~

- [ ] **Step 3: Implement helper without shared-pool `sql.begin()`**

The repository is pinned to `postgres@3.4.9`. Do **not** implement this helper with shared-pool `sql.begin()`: upstream issue #1189 documents a current reservation race in that release.

Instead:
1. acquire an isolated connection with `sql.reserve()`;
2. bound acquisition (5 seconds) so a stalled reserve becomes an explicit projection failure;
3. if a timed-out reserve later resolves, immediately `release()` it;
4. on the reserved connection run `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
5. invoke `work({ unsafe: reserved.unsafe.bind(reserved) })`;
6. `COMMIT` on success, `ROLLBACK` on failure;
7. always `release()` in `finally`.

This also explicitly mitigates the current upstream reserve-stall failure mode (#1195) at the request boundary. Keep `runInTransaction()` unchanged.

- [ ] **Step 4: Verify GREEN**

~~~bash
pnpm exec vitest run packages/application/src/transactions.test.ts
pnpm typecheck
~~~

- [ ] **Step 5: Commit**

~~~bash
git add packages/application/src/transactions.ts packages/application/src/transactions.test.ts
git commit -m "feat: add read-only repeatable snapshot helper"
~~~

---

### Task 3: Define safe DTOs and pure deterministic classification

**Files**
- Create `packages/application/src/projections/cockpit-types.ts`
- Create `packages/application/src/projections/cockpit-classification.ts`
- Create `packages/application/src/projections/cockpit-classification.test.ts`

**Interfaces**
- Constants:
~~~ts
export const COCKPIT_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
export const COCKPIT_RECENT_MS = 14 * 24 * 60 * 60 * 1000;
~~~
- Types:
  - `CockpitViewer`
  - `AttentionKind`
  - `CockpitAttentionItem` discriminated union
  - `CockpitActivityItem` discriminated union
  - `SafeProjectSummary`
  - `CockpitLaneSummary`
  - `ProjectCockpitSummary`
  - `ProjectCockpit`
  - `PortfolioCockpit`
  - internal current-fact types consumed by Tasks 4–5
- Functions:
~~~ts
export function computeLastMeaningfulTaskActivity(...): Date;
export function selectLatestAgentRuns(...): AgentRunCurrentFact[];
export function classifyProjectAttention(...): CockpitAttentionItem[];
export function sortAttentionItems(...): CockpitAttentionItem[];
~~~

Every attention item shares:

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

No DTO may contain generic `payload`, locator, access policy, extracted text, raw exception, submission summary, review comment, decision reason/evidence, Agent request/interaction payload.

- [ ] **Step 1: Write RED classification tests**

Cover:
1. `13d23h59m59s` not idle;
2. exactly 14×24h idle;
3. latest Submission/Review/linked Decision/AgentRun resets idle;
4. completed/cancelled excluded;
5. blocked suppresses idle;
6. review/scientific-governance waiting suppresses idle;
7. Agent #1 failed + #2 completed → no current failure;
8. Agent #1 failed + #2 waiting-human → current waiting-human;
9. two AgentTasks stay independent;
10. explicit scientific-decision action suppresses duplicate linked awaiting-decision attention;
11. attention oldest-first + stable-ID tiebreak;
12. activity newest-first + stable-ID tiebreak.

- [ ] **Step 2: Verify RED**

~~~bash
pnpm exec vitest run packages/application/src/projections/cockpit-classification.test.ts
~~~

- [ ] **Step 3: Implement types**

Attention kinds exactly:
- `my_review`
- `my_scientific_decision`
- `blocked_task`
- `awaiting_scientific_decision`
- `agent_waiting_human`
- `agent_run_failed`
- `file_parse_failed`
- `long_idle_work`

Portfolio lane summary:

~~~ts
export type CockpitLaneSummary = {
  kind: AttentionKind;
  totalCount: number;
  preview: CockpitAttentionItem[];
};
~~~

- [ ] **Step 4: Implement classification**

`lastMeaningfulActivityAt = max(task.updatedAt, latestSubmissionAt, latestReviewAt, latestLinkedDecisionAt, latestAgentRunAt)`.

Idle only for `open | in_progress`. Latest Agent attempt is maximum `attemptNumber`, never latest timestamp.

No score/severity/health/risk field exists.

- [ ] **Step 5: Verify GREEN**

~~~bash
pnpm exec vitest run packages/application/src/projections/cockpit-classification.test.ts
pnpm typecheck
~~~

- [ ] **Step 6: Commit**

~~~bash
git add packages/application/src/projections
git commit -m "feat: add cockpit projection types and classification"
~~~

---

### Task 4: Load authorized, safe current-state facts

**Files**
- Create `packages/application/src/projections/cockpit-current-query.ts`
- Create `packages/application/src/projections/cockpit-query-service.test.ts`
- Modify `packages/application/src/auth/authorize.ts`

**Interfaces**
~~~ts
export async function loadVisibleProjectIds(
  tx: TransactionSql,
  viewer: CockpitViewer,
): Promise<string[]>;

export async function loadCurrentProjectFacts(
  tx: TransactionSql,
  viewer: CockpitViewer,
  projectIds: readonly string[],
): Promise<ProjectCurrentFacts[]>;
~~~

- [ ] **Step 1: Write RED visibility tests**

Seed two teams and three projects:
- team-A lead sees all team-A projects only;
- researcher sees membership projects only;
- neither sees team-B project.

- [ ] **Step 2: Write RED safe-current-fact tests**

Seed:
- pending Review assigned to viewer and another reviewer;
- linked awaiting ScientificDecision;
- Decision in project-lead/team-lead stages;
- blocked task;
- AgentTask with multiple attempts;
- current FileVersion parse failure;
- old non-current FileVersion parse failure;
- restricted external reference with sentinel locator/access policy.

Assert current facts serialize without sentinel secrets; old non-current parse failure is not current attention input.

- [ ] **Step 3: Verify RED**

~~~bash
pnpm exec vitest run packages/application/src/projections/cockpit-query-service.test.ts
~~~

- [ ] **Step 4: Make project authorization transaction-safe**

Change only `authorizeProjectAccess` input type from full `DatabaseSql` to `Pick<DatabaseSql, "unsafe">` (or named equivalent). Do not alter authorization behavior.

- [ ] **Step 5: Implement visible-project query**

Always enforce team scope. Lead sees team projects; researcher requires project membership. Stable order by project creation then ID.

- [ ] **Step 6: Implement batch current-fact queries**

For authorized project IDs batch-load:
- project title/lead;
- dimension states;
- tasks/owner/updatedAt;
- latest Submission timestamp;
- current Review reviewer/status/updatedAt;
- linked Decision safe fields/status/updatedAt;
- standalone current Decisions safe title/status;
- AgentTask + AgentRun attempt/state/update fields only;
- current ResearchFile/current FileVersion title/version/accessClass/parseStatus only.

Explicitly do **not** join/select:
- `external_data_references`;
- `file_search_documents.extracted_text`;
- TaskSubmission summary;
- Review comment;
- Decision reason/evidence/impact;
- Agent request, interaction payload, artifacts, context payload.

Use Task 1 helper for Decision stage.

- [ ] **Step 7: Fail closed on unknown canonical status**

Validate all projection-critical canonical enums against domain constants:
- task status against `RESEARCH_TASK_STATUSES`;
- Review status against `REVIEW_REQUEST_STATUSES`;
- Decision status against `DECISION_STATUSES`;
- Agent state against `AGENT_RUN_STATES`;
- research dimension name/state against `RESEARCH_DIMENSIONS` and `RESEARCH_DIMENSION_STATES`;
- current FileVersion parse status against the exact local set `["parsed", "failed", "not_applicable"]`;
- file access class against `FILE_ACCESS_CLASSES`.

Any unknown current value throws `CockpitProjectionInconsistencyError`. Historical unknown event types remain non-fatal and are simply excluded unless allowlisted.

- [ ] **Step 8: Verify GREEN**

~~~bash
pnpm exec vitest run packages/application/src/projections/cockpit-query-service.test.ts
pnpm typecheck
~~~

- [ ] **Step 9: Commit**

~~~bash
git add packages/application/src/auth/authorize.ts   packages/application/src/projections/cockpit-current-query.ts   packages/application/src/projections/cockpit-query-service.test.ts
git commit -m "feat: load safe current cockpit facts"
~~~

---

### Task 5: Add curated Recent Activity and public cockpit service

**Files**
- Create `packages/application/src/projections/cockpit-activity-query.ts`
- Create `packages/application/src/projections/cockpit-query-service.ts`
- Modify `packages/application/src/projections/cockpit-query-service.test.ts`

**Public API**
~~~ts
export async function listPortfolioCockpit(
  sql: DatabaseSql,
  viewer: CockpitViewer,
  now: Date,
): Promise<PortfolioCockpit>;

export async function getProjectCockpit(
  sql: DatabaseSql,
  viewer: CockpitViewer,
  projectId: string,
  now: Date,
): Promise<ProjectCockpit>;
~~~

- [ ] **Step 1: Write RED activity tests**

Exact event allowlist:

`TASK_SUBMISSION_CREATED`,
`RESEARCH_TASK_COMPLETED`,
`RESEARCH_TASK_REOPENED`,
`RESEARCH_TASK_BLOCKED`,
`RESEARCH_TASK_UNBLOCKED`,
`REVIEW_APPROVED`,
`REVIEW_CHANGES_REQUESTED`,
`REVIEW_REJECTED`,
`REVIEW_REASSIGNED`,
`REVIEW_ESCALATED`,
`REVIEW_SCIENTIFIC_DECISION_RESOLVED`,
`SCIENTIFIC_DECISION_CREATED`,
`SCIENTIFIC_DECISION_EVIDENCE_REQUESTED`,
`SCIENTIFIC_DECISION_PROJECT_LEAD_APPROVED`,
`SCIENTIFIC_DECISION_APPROVED`,
`SCIENTIFIC_DECISION_REJECTED`,
`RESEARCH_STATE_CHANGED`,
`RESEARCH_RESULT_CREATED`,
`RESEARCH_RESULT_SUPERSEDED`,
`AGENT_RUN_WAITING_HUMAN`,
`AGENT_RUN_COMPLETED`,
`AGENT_RUN_FAILED`,
`RESEARCH_FILE_CREATED`,
`FILE_VERSION_CREATED`,
`FILE_PARSE_FAILED`,
`FILE_SCAN_REJECTED`.

Assert unknown event absent, >14-day event absent, newest-first, max 10/project, ResearchResult/state changes present, raw payload absent.

- [ ] **Step 2: Write RED current-vs-history tests**

- historical blocked event + current in_progress → activity may show block; no current blocked attention.
- historical Agent failure + newer attempt → activity may show failure; current attention follows newer attempt.
- historical file parse failure + newer current parsed version → activity may show failure; no current file alert.

- [ ] **Step 3: Write RED portfolio/project assembly tests**

Assert:
- `generatedAt === now`;
- portfolio previews max 3/lane with full `totalCount`;
- project cockpit full attention not preview-truncated;
- my actions contain only viewer responsibility;
- no global score/priority field.

- [ ] **Step 4: Write RED service-level consistency/read-only tests**

Within one service call coordinate a concurrent mutation between internal reads and prove the returned snapshot is consistent. Count `research_events` and `outbox_events` before/after and prove unchanged.

- [ ] **Step 5: Verify RED**

~~~bash
pnpm exec vitest run packages/application/src/projections/cockpit-query-service.test.ts
~~~

- [ ] **Step 6: Implement activity translation**

Read only allowlisted event types within `now - COCKPIT_RECENT_MS`.

Map IDs in event payload to safe canonical labels inside the snapshot; never return raw payload.

For `FILE_SCAN_REJECTED` where no ResearchFile exists, use generic “文件扫描拒绝” and do not expose SHA/payload.

- [ ] **Step 7: Implement public orchestration in one read-only snapshot**

`listPortfolioCockpit()`: visible IDs → current facts → activity → classify/dedupe/sort → per-project lane totals/previews → `myActions`.

`getProjectCockpit()`: authorize project inside snapshot → current facts → activity → classify/dedupe/sort → full project DTO.

Do not catch projection errors here; Web owns unavailable mapping.

- [ ] **Step 8: Verify GREEN**

~~~bash
pnpm exec vitest run   packages/application/src/decisions/review-eligibility.test.ts   packages/application/src/transactions.test.ts   packages/application/src/projections/cockpit-classification.test.ts   packages/application/src/projections/cockpit-query-service.test.ts
pnpm typecheck
~~~

- [ ] **Step 9: Commit**

~~~bash
git add packages/application/src/projections/cockpit-activity-query.ts   packages/application/src/projections/cockpit-query-service.ts   packages/application/src/projections/cockpit-query-service.test.ts
git commit -m "feat: assemble cockpit projections"
~~~

---

### Task 6: Build the role-aware portfolio cockpit

**Files**
- Create `apps/web/src/server/cockpit-queries.ts`
- Create `apps/web/src/components/cockpit/attention-section.tsx`
- Create `apps/web/src/components/cockpit/project-cockpit-card.tsx`
- Create `apps/web/src/components/cockpit/recent-activity.tsx`
- Modify `apps/web/app/(app)/portfolio/page.tsx`
- Modify `apps/web/app/globals.css`
- Modify `tests/acceptance/support/environment.ts`
- Create `tests/acceptance/progress-cockpit.spec.ts`

**Web result**
~~~ts
type PortfolioCockpitPageData =
  | { status: "ready"; data: PortfolioCockpit }
  | { status: "unavailable" };

export async function loadPortfolioCockpitForPage(
  member: CurrentMember,
): Promise<PortfolioCockpitPageData>;
~~~

- [ ] **Step 1: Add isolated Phase 4C acceptance fixture**

Add `cockpitFixtures?: boolean` to `startAcceptanceEnvironment()`; default false.

When enabled, create via application APIs where possible:
- blocked task;
- in-progress task for idle aging;
- pending required-review Submission assigned to researcher #2;
- retain existing proposed Decision and Agent runs;
- direct-DB current parse-failure fixture only because no public API creates that operational state.

Expose opt-in controller:
~~~ts
type CockpitAcceptanceController = {
  blockedTaskId: string;
  idleTaskId: string;
  pendingReviewTaskId: string;
  currentParseFailureFileId: string;
  currentParseFailureLocator: string;
  currentParseFailureAccessPolicyRef: string;
  ageTask(taskId: string, isoTime: string): Promise<void>;
  setRawTaskStatus(taskId: string, status: string): Promise<void>;
};
~~~

No default fixture pollution.

- [ ] **Step 2: Write RED portfolio visibility test**

Lead sees five project cockpit cards. Primary researcher sees only accessible projects. No new top-level cockpit navigation item.

- [ ] **Step 3: Write RED explicit-action test**

- researcher #2 sees assigned pending Review in “我的明确行动”;
- researcher #1 does not see that Review as theirs;
- researcher #1 sees proposed ScientificDecision action;
- lead does not see that project-lead-stage Decision as their personal action.

- [ ] **Step 4: Verify RED**

~~~bash
pnpm exec playwright test tests/acceptance/progress-cockpit.spec.ts --grep "portfolio|明确行动"
~~~

- [ ] **Step 5: Implement Web adapter**

Map `CurrentMember` → `CockpitViewer`; call Task 5 with one `new Date()`.

Catch query/projection errors only here, log fixed safe diagnostic metadata, return `unavailable`, never `[]`.

- [ ] **Step 6: Implement read-only components**

`AttentionSection`: links only, no mutation forms; exact copy:
- idle → “X 天无记录活动”
- waiting human → “等待人工输入”
- file parse → “当前文件版本解析失败”

`ProjectCockpitCard`: title/lead/dimensions/lane counts/max-3 previews/latest activity; no score/health/risk. Preserve `data-testid="project-card"` and the project-title link to `/projects/{projectId}` so existing Phase 1 selectors/behavior remain stable.

`RecentActivity`: semantic label/timestamp/link only.

- [ ] **Step 7: Replace legacy portfolio body**

Order:
1. 我的明确行动
2. project cockpit cards
3. 最近重要正式变化

Unavailable copy: “科研关注投影暂时不可用。”
Ready-empty copy: “当前没有明确等待你处理的事项。”

Never use “全部正常”“没有风险”“进展顺利”.

- [ ] **Step 8: Add neutral responsive CSS**

No severity-color semantics or score visualization.

- [ ] **Step 9: Verify GREEN**

~~~bash
pnpm exec playwright test tests/acceptance/progress-cockpit.spec.ts --grep "portfolio|明确行动"
pnpm --filter @research-workbench/web build
~~~

- [ ] **Step 10: Commit**

~~~bash
git add apps/web/src/server/cockpit-queries.ts   apps/web/src/components/cockpit   apps/web/app/'(app)'/portfolio/page.tsx   apps/web/app/globals.css   tests/acceptance/support/environment.ts   tests/acceptance/progress-cockpit.spec.ts
git commit -m "feat: add role-aware portfolio cockpit"
~~~

---

### Task 7: Add project cockpit and canonical deep links

**Files**
- Modify `apps/web/src/server/cockpit-queries.ts`
- Modify `apps/web/app/(app)/projects/[projectId]/page.tsx`
- Modify `apps/web/src/components/agent-runs/agent-task-list.tsx`
- Modify `tests/acceptance/progress-cockpit.spec.ts`

**Web result**
~~~ts
type ProjectCockpitPageData =
  | { status: "ready"; data: ProjectCockpit }
  | { status: "unavailable" };
~~~

- [ ] **Step 1: Write RED project overview order test**

Keep existing dimensions visible, then attention/recent activity, then members.

- [ ] **Step 2: Write RED current-attention test**

Assert:
- blocked task shown, not duplicated as idle;
- 14-day idle copy;
- Agent waiting-human says “等待人工输入” not “等待你”;
- latest failed AgentRun shown;
- current parse-failed file shown;
- restricted locator/access-policy sentinel from `environment.cockpit.currentParseFailureLocator/currentParseFailureAccessPolicyRef` absent from `page.content()`.

- [ ] **Step 3: Write RED deep-link test**

Exact destinations:
- Review item → `/projects/{projectId}/work/{taskId}`
- Decision → `/projects/{projectId}/decisions`
- blocked/idle/awaiting-decision → task detail
- Agent → `/projects/{projectId}/agent-work#agent-run-{runId}`
- file parse → `/projects/{projectId}/files/{researchFileId}`

- [ ] **Step 4: Verify RED**

~~~bash
pnpm exec playwright test tests/acceptance/progress-cockpit.spec.ts --grep "project|受阻|idle|Agent|解析|deep link"
~~~

- [ ] **Step 5: Add project adapter**

The project page keeps its existing `getProjectOverview(member, projectId)` + `notFound()` canonical access/not-found gate exactly as today. The cockpit adapter only maps cockpit projection/query failure to `unavailable`; it does not invent a second not-found contract.

- [ ] **Step 6: Add AgentRun anchor**

In `RunCard` add only:
~~~tsx
id={`agent-run-${run.id}`}
~~~

Do not alter actions.

- [ ] **Step 7: Wire project page**

Keep PageHeader/ProjectNavigation/dimensions/members. Insert explicit actions, project attention, Recent Activity between dimensions and members.

If projection unavailable, only that subsection says unavailable; canonical overview remains visible.

- [ ] **Step 8: Verify GREEN + Agent regression**

~~~bash
pnpm exec playwright test tests/acceptance/progress-cockpit.spec.ts --grep "project|受阻|idle|Agent|解析|deep link"
pnpm exec playwright test tests/acceptance/agent-runtime.spec.ts
~~~

- [ ] **Step 9: Commit**

~~~bash
git add apps/web/src/server/cockpit-queries.ts   apps/web/app/'(app)'/projects/'[projectId]'/page.tsx   apps/web/src/components/agent-runs/agent-task-list.tsx   tests/acceptance/progress-cockpit.spec.ts
git commit -m "feat: add project cockpit projections"
~~~

---

### Task 8: Complete acceptance, failure semantics, and negative assertions

**Files**
- Modify `tests/acceptance/progress-cockpit.spec.ts`
- Modify `tests/acceptance/support/environment.ts`
- Modify `package.json`
- Modify production files only when a new RED test proves a real product defect.

- [ ] **Step 1: RED — unblock clears current block**

Use canonical workflow. Current block disappears after unblock; historical block/unblock may remain in Recent Activity.

- [ ] **Step 2: RED — new Submission resets idle**

Start with aged in-progress task, verify idle, create formal Submission through Research Work UI, return to cockpit, verify idle disappears.

- [ ] **Step 3: RED — newer Agent attempt clears old current failure**

Verify attempt #1 failure attention; retry through canonical Agent Work; attempt #2 makes old failure non-current; historical failure may remain activity.

- [ ] **Step 4: RED — Recent Activity coverage/window**

Verify task, Decision, ResearchResult, `RESEARCH_STATE_CHANGED`, and file activity. Insert one otherwise-valid allowlisted event older than 14 days and verify absent. Verify newest-first and max 10/project.

- [ ] **Step 5: RED — projection inconsistency is unavailable**

Use test-only `setRawTaskStatus(..., "projection_test_unknown")` last in the serial spec.

Assert:
- “科研关注投影暂时不可用” visible;
- empty-state copy not used as substitute;
- no “全部正常”“没有风险”“进展顺利”.

- [ ] **Step 6: Add negative assertions**

Cockpit must contain no:
- progress percentage;
- health/risk score;
- Green/Amber/Red project judgement;
- AI priority/ranking;
- mutation buttons for approve/reject/unblock/answer/complete;
- restricted locator/access policy;
- raw ResearchEvent payload;
- raw Agent exception;
- Submission summary/Review comment/Decision reason/evidence.

- [ ] **Step 7: Run full Phase 4C spec and classify failures before code changes**

~~~bash
pnpm exec playwright test tests/acceptance/progress-cockpit.spec.ts
~~~

Classify each failure as product, SQL/auth, UI, fixture, selector, harness race, or environment. Do not modify production code for fixture/selector/harness defects.

- [ ] **Step 8: Add Phase 4C to full acceptance command**

Root `package.json` acceptance command must include:
`tests/acceptance/progress-cockpit.spec.ts`
after the existing Phase 4B spec.

- [ ] **Step 9: Verify Phase 4C + Phase 1 portfolio regression**

~~~bash
pnpm exec playwright test tests/acceptance/progress-cockpit.spec.ts tests/acceptance/phase-01.spec.ts
~~~

- [ ] **Step 10: Commit**

~~~bash
git add tests/acceptance/progress-cockpit.spec.ts   tests/acceptance/support/environment.ts   package.json
# Add production files only if a RED test proved a real product defect.
git commit -m "test: cover phase four C cockpit acceptance"
~~~

---

### Task 9: Full regression and final verification checkpoint

**Files**
- Create `docs/superpowers/reviews/2026-10-01-phase-04c-verification.md`
- No product changes unless full regression proves a real defect; such a fix gets its own RED→GREEN checkpoint before the record.

- [ ] **Step 1: Run focused projection tests**

~~~bash
pnpm exec vitest run   packages/application/src/decisions/review-eligibility.test.ts   packages/application/src/transactions.test.ts   packages/application/src/projections/cockpit-classification.test.ts   packages/application/src/projections/cockpit-query-service.test.ts
~~~

- [ ] **Step 2: Run full non-browser gate**

~~~bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
~~~

Record exact PASS and SKIP counts. Never convert SKIP to PASS.

- [ ] **Step 3: Run full Phase 1–4C browser acceptance**

~~~bash
pnpm acceptance
~~~

Real tusd + SeaweedFS browser path must remain green.

- [ ] **Step 4: Perform coordinator/manual invariant review**

Confirm:
1. no projection write/Event/Outbox/acknowledgement;
2. no projection table/cache/worker;
3. no progress/health/risk/priority scoring;
4. current state from canonical tables;
5. historical activity only from allowlist;
6. Decision review eligibility is shared;
7. Agent latest-attempt/file current-version semantics hold;
8. sensitive fields absent from DTO/UI;
9. unavailable distinct from empty;
10. no new top-level cockpit route;
11. mutations remain canonical workflows;
12. Phase 1–4B invariants stay intact.

Record: `independent AI reviewer: unavailable`.

- [ ] **Step 5: Write verification record**

Include:
- approved spec and plan paths;
- implementation branch/head;
- Native / `superpowers:executing-plans`;
- exact test/typecheck/lint/build/acceptance results;
- exact Phase 4C browser count;
- exact conditional SKIPs;
- manual invariant review;
- known limitations;
- Draft PRs not merged/ready;
- Drive mirror remains secondary to GitHub if still unresolved.

- [ ] **Step 6: Commit verification record only**

~~~bash
git add docs/superpowers/reviews/2026-10-01-phase-04c-verification.md
git commit -m "docs: record phase four C verification"
~~~

- [ ] **Step 7: Require fresh exact-head CI**

Re-read actual branch head, relevant Draft PR, and Actions for that exact SHA. Older success/failure runs are superseded by current exact-head evidence.

Final verification exists only after current exact head has completed `success`.

- [ ] **Step 8: Stop at Draft human gate**

Do not mark ready. Do not merge Phase 4C or upstream Phase 3/4A/4B Draft PRs.

---

## Execution Checkpoint Rules

Each task is one risk-class checkpoint. On interruption:

1. re-read GitHub branch head;
2. re-read Actions for that exact head;
3. re-read relevant Draft PR;
4. if last task already has exact-head success evidence, do not repeat it;
5. resume only first incomplete task;
6. distinguish fixture/selector/harness failure from product defect before production changes.

No meaningless commits. If a task produces no meaningful diff, do not create a checkpoint commit.

## Human Gate

This plan requires explicit human approval before Task 1.

After approval, implementation uses Native / `superpowers:executing-plans`. Product implementation must begin from the approved plan checkpoint, not from chat memory.
