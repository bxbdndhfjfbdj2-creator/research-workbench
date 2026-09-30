# Phase 4B Human/Hybrid ResearchTask & Unified Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement human/agent/hybrid ResearchTask execution, immutable TaskSubmission provenance, ordinary ReviewRequest workflows, and explicit Review → ScientificDecision escalation without weakening existing scientific governance.

**Architecture:** Extend the existing ResearchTask model incrementally rather than replacing Phase 1–4A objects. ResearchTask remains current work responsibility/intent; AgentTask/AgentRun remain AI execution truth; immutable TaskSubmission becomes the formal human-controlled delivery boundary; ReviewRequest handles ordinary quality review; ScientificDecision remains the only path for official scientific state changes. Current state rows are paired with append-only provenance facts and ResearchEvent/Outbox records.

**Tech Stack:** TypeScript; Node.js >= 22.19; pnpm 11.7; Next.js + React; PostgreSQL; Drizzle ORM; Vitest; Playwright; existing pg-boss/Outbox worker; existing Agent runtime, ScientificDecision, Files & Provenance subsystems.

**Spec:** `docs/superpowers/specs/2026-09-30-phase-04b-human-hybrid-work-review-design.md`

## Global Constraints

- Fixed 6-person, single-team, private deployment; do not introduce multi-tenant/workflow-engine abstractions.
- Research Workbench remains scientific/governance truth; DeepSeek Harness remains AI execution truth; GitHub remains engineering truth.
- AI cannot create formal TaskSubmission, approve/reject ordinary Review, change accountable owner/execution mode, or approve ScientificDecision.
- `ReviewRequest` ordinary review and `ScientificDecision` formal scientific governance remain separate state machines.
- TaskSubmission, submission contributors/refs, ReviewAction, ReviewDecisionLink, ResearchEvent, and accepted-submission completion provenance are append-only facts.
- A workflow-v2 ResearchTask always has a human accountable owner.
- v2 formal submission is allowed only from `in_progress`.
- `reviewPolicy` is locked after the first formal TaskSubmission.
- Every Task → `completed` transition records the accepted `submissionId`.
- Active legacy v1 tasks upgrade to v2 on the first post-migration lifecycle mutation without fabricating historical submissions/reviews.
- Restricted FileVersion references never widen 4A file/locator/content permissions.
- Structured payloads use existing secret-key guards; free text is bounded formal business data and must not be copied into ResearchEvent, Outbox, ordinary logs, or raw error messages.
- No new third-party dependency is required for Phase 4B.
- TDD RED → GREEN; meaningful commits; no Draft PR merge or auto-merge.
- Current execution method is **Native / `superpowers:executing-plans`** because no independent subagent/reviewer is available. Final review must be recorded as coordinator/manual invariant review, not independent review.

## Review Focus

1. **Stale identity after page render:** an owner/reviewer who becomes inactive or loses project access before submit/review must be rejected by the application service; Task 2/4 tests pin this.
2. **Requirement/edit race with submit:** submission must lock the task and freeze the requirements that actually existed at commit time; Task 3 concurrency test pins this.
3. **Duplicate contributor/ref payloads:** repeated stable refs must not create duplicate provenance facts or permit self-review bypass; Task 3 tests pin this.
4. **Non-terminal ScientificDecision events:** `awaiting_lead` / `needs_evidence` outbox events must not resume Review; Task 6 tests pin this.
5. **Restricted file reference visibility:** adding a restricted FileVersion to a Submission must not reveal locator/access-policy/content beyond existing 4A authorization; Task 7/10 tests pin this.

---

## File Structure

Create or modify these responsibility boundaries:

- `packages/domain/src/research-task.ts` — workflow-v2 task types/constants/validators.
- `packages/domain/src/task-review.ts` — immutable submission/review/ref/action domain types.
- `packages/db/migrations/0002_human_hybrid_work_review.sql` — additive schema/backfill/constraints/triggers.
- `packages/db/src/schema/research-task.ts` — extended ResearchTask row.
- `packages/db/src/schema/task-review.ts` — Submission/Review schema.
- `packages/db/src/schema/index.ts` — export new schema.
- `packages/application/src/tasks/task-permissions.ts` — 4B semantic authorization/eligibility helpers.
- `packages/application/src/tasks/research-task-service.ts` — lifecycle actions and legacy→v2 upgrade.
- `packages/application/src/tasks/task-submission-service.ts` — formal submission transaction.
- `packages/application/src/tasks/task-review-service.ts` — reassignment and ordinary review outcomes.
- `packages/application/src/tasks/task-review-escalation.ts` — Review ↔ ScientificDecision orchestration.
- `apps/worker/src/review-runtime.ts` — terminal ScientificDecision outbox handler.
- `apps/web/src/server/work-queries.ts` — Research Work / Review Inbox read models.
- `apps/web/src/server/work-actions.ts` — server action parsing and application calls.
- `apps/web/src/components/research-work/*` — task/submission/review UI.
- `apps/web/app/(app)/projects/[projectId]/work/page.tsx` — project work list/create page.
- `apps/web/app/(app)/projects/[projectId]/work/[taskId]/page.tsx` — task provenance/detail/actions.
- `apps/web/app/(app)/reviews/page.tsx` — team-level “waiting for me” inbox.
- `tests/integration/task-review-concurrency.test.ts` — duplicate/concurrency protection.
- `tests/integration/task-review-secret-safety.test.ts` — event/log payload boundaries.
- `tests/acceptance/human-hybrid-work-review.spec.ts` — nine Phase 4B browser scenarios.

---

### Task 1: Domain Types, Migration, and Database Invariants

**Files:**
- Modify: `packages/domain/src/research-task.ts`
- Create: `packages/domain/src/task-review.ts`
- Modify: `packages/db/src/schema/research-task.ts`
- Create: `packages/db/src/schema/task-review.ts`
- Modify: `packages/db/src/schema/index.ts`
- Create: `packages/db/migrations/0002_human_hybrid_work_review.sql`
- Modify: `tests/integration/db-foundation.test.ts`
- Create: `tests/integration/task-review-model.test.ts`

**Interfaces:**
- Produces `ResearchTaskExecutionMode = "human" | "agent" | "hybrid"`.
- Produces `ResearchTaskReviewPolicy = "none" | "required"`.
- Extends `ResearchTaskStatus` with `"awaiting_review"`.
- Extends `ResearchTask` with `executionMode`, `reviewPolicy`, `acceptanceCriteria: string[]`, `workflowVersion: 1 | 2`, and non-null `assigneeMemberId` after migration.
- Produces `TaskSubmissionRefKind`, `TaskSubmissionRefRelation`, `TaskSubmissionContributorKind`, `ReviewRequestStatus`, and `ReviewActionKind`.

- [ ] **Step 1: Write failing DB/domain tests**

Add tests asserting:
- 4B tables exist: `task_submissions`, `task_submission_contributors`, `task_submission_refs`, `review_requests`, `review_actions`, `review_decision_links`.
- TaskSubmission/contributor/ref/ReviewAction/ReviewDecisionLink reject UPDATE and DELETE.
- duplicate `(task_id, submission_number)`, duplicate contributor, duplicate ref tuple, second ReviewRequest for one Submission, and duplicate `scientific_decision_id` link fail.
- DB check constraints reject invalid execution mode/review policy/review status/ref kind/relation/action.
- a pre-0002 task with null assignee is backfilled to `created_by`, `workflow_version=1`, `execution_mode='human'`, `review_policy='none'`, `acceptance_criteria=[]`.
- new schema allows `awaiting_review`.

- [ ] **Step 2: Run the focused RED tests**

Run:
`pnpm vitest run tests/integration/db-foundation.test.ts tests/integration/task-review-model.test.ts packages/application/src/tasks/research-task-service.test.ts`

Expected: FAIL because the 4B schema/types/migration do not exist.

- [ ] **Step 3: Add domain constants and migration/schema**

Implement the exact enums above plus:
- submission ref relations: `deliverable | evidence | source | context`.
- review statuses: `pending | awaiting_scientific_decision | approved | changes_requested | rejected | cancelled`.
- review actions: `assigned | reassigned | approve | request_changes | reject | cancel | escalate_to_scientific_decision | scientific_decision_resolved`.
- migration default `workflow_version=1`; application code will explicitly create v2 tasks.
- backfill null assignee from `created_by`, then make `assignee_member_id NOT NULL`.
- immutable triggers for formal fact tables; `review_requests` stays mutable current state.

- [ ] **Step 4: Run focused GREEN tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: add phase four B workflow schema"` plus newly created files.

---

### Task 2: ResearchTask v2 Lifecycle, Semantic Permissions, and Legacy Upgrade

**Files:**
- Create: `packages/application/src/tasks/task-permissions.ts`
- Modify: `packages/application/src/tasks/research-task-service.ts`
- Modify: `packages/application/src/tasks/research-task-service.test.ts`
- Remove the public `setResearchTaskStatus()` export; `pnpm typecheck` in this task is the authoritative check for any current-head caller that still depends on it. Do not preserve an arbitrary-status compatibility wrapper for v2.

**Interfaces:**
- `createResearchTask(sql, projectId, input, actor)` creates workflow v2; omitted owner defaults to actor; omitted execution/review settings default to `human` / `none`.
- `startResearchTask(sql, taskId, actor)`
- `updateResearchTaskRequirements(sql, taskId, {title, description, acceptanceCriteria}, actor)`
- `setResearchTaskReviewPolicy(sql, taskId, reviewPolicy, actor)`
- `assignResearchTaskOwner(sql, taskId, memberId, actor)`
- `setResearchTaskExecutionMode(sql, taskId, mode, actor)`
- `blockResearchTask(sql, taskId, actor)`
- `unblockResearchTask(sql, taskId, actor)`
- `cancelResearchTask(sql, taskId, actor)` initially covers open/in_progress/blocked; Task 5 adds pending-review atomic cancellation.
- `reopenResearchTask(sql, taskId, actor)`
- `completeUnreviewedTask(sql, taskId, submissionId, actor)` — accountable owner only; a project/team lead must explicitly reassign ownership before accepting an unreviewed Submission on that person's behalf.
- Internal `ensureWorkflowV2ForMutation(...)` in `research-task-service.ts` guarantees active v1 upgrade semantics; it is not exported outside that module.

- [ ] **Step 1: Write failing lifecycle/authorization tests**

Pin:
- new task is v2 and owner defaults to creator.
- only human actors can create/mutate.
- owner/project lead/team lead can edit task requirements/mode; unrelated reader cannot.
- only project lead/team lead can change owner.
- inactive/removed owner is rejected at action time, not trusted from stale UI.
- `reviewPolicy` changes before first Submission but is locked after one exists.
- v2 transitions use business actions; invalid start/block/unblock/reopen/complete transitions fail.
- active v1 first post-migration mutation writes one `RESEARCH_TASK_WORKFLOW_UPGRADED` and does not create fake Submission/Review.
- v1 with invalid owner fails upgrade until authorized owner reassignment.
- completed legacy v1 reopen upgrades to v2.
- `completeUnreviewedTask` rejects `reviewPolicy=required`, non-latest Submission, and wrong task Submission.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run packages/application/src/tasks/research-task-service.test.ts`

Expected: FAIL on missing v2 fields/actions.

- [ ] **Step 3: Implement semantic task permissions and lifecycle actions**

Use row locks for mutations. Keep project-access checks server-side. Replace generic status updates with explicit state transitions and emit narrow ResearchEvent/Outbox payloads.

Use bounded validation constants:
- title ≤ 200 chars;
- description ≤ 4,000 chars;
- max 20 acceptance criteria;
- each criterion trim-nonempty and ≤ 1,000 chars.

- [ ] **Step 4: Run GREEN and compile callers**

Run:
`pnpm vitest run packages/application/src/tasks/research-task-service.test.ts && pnpm typecheck`

Expected: PASS; no current-head caller remains bound to the removed arbitrary-status API.

- [ ] **Step 5: Commit**

`git commit -am "feat: enforce research task workflow v2"`

---

### Task 3: Immutable TaskSubmission, Contributors, Refs, and Requirement Snapshot

**Files:**
- Create: `packages/application/src/tasks/task-submission-service.ts`
- Create: `packages/application/src/tasks/task-submission-service.test.ts`
- Modify: `packages/application/src/tasks/task-permissions.ts`
- Create or modify: `tests/integration/task-review-concurrency.test.ts`

**Interfaces:**
- `TaskSubmissionContributorInput = { kind: "human_member"; memberId: string } | { kind: "agent_run"; runId: string }`
- `TaskSubmissionRefInput = { kind: TaskSubmissionRefKind; refId: string; relation: TaskSubmissionRefRelation }`
- `submitResearchTask(sql, taskId, input, actor) -> Promise<{ submission: TaskSubmission; reviewRequestId: string | null }>`
- input: `{ summary: string; contributors?: TaskSubmissionContributorInput[]; refs?: TaskSubmissionRefInput[]; reviewerMemberId?: string | null }`
- Task 3 adds `assertEligibleReviewer(tx: TransactionSql, projectId: string, submissionId: string, reviewerMemberId: string): Promise<void>` to `task-permissions.ts`; required-review Submission creation must call it before the transaction commits.
- `reviewPolicy=required` requires a non-null `reviewerMemberId`; `reviewPolicy=none` requires it to be omitted/null and rejects a non-null reviewer value.

- [ ] **Step 1: Write failing submission tests**

Assert:
- only accountable owner/human can formally submit.
- task must be v2 + `in_progress`.
- summary trim-nonempty and ≤ 8,000 chars.
- submittedBy is automatically a contributor.
- contributor/ref duplicates collapse before insert and DB uniqueness remains a backstop.
- human contributor must be active with project access.
- AgentRun contributor/ref must belong to same project.
- FileVersion/ResearchResult/ResearchNodeRevision refs must belong to same project.
- cross-project stable IDs roll back the whole transaction.
- snapshot contains exact title/description/acceptanceCriteria/executionMode/reviewPolicy at commit time.
- later task edits do not mutate old snapshot.
- the initial required reviewer passes the same human/active/project-access/non-contributor eligibility rules later reused by reassignment.
- two concurrent submits for the same task cannot both create the active cycle; submission numbers remain unique/monotonic.
- a task requirement update racing submit cannot produce a half-old/half-new snapshot because both lock the same task row.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run packages/application/src/tasks/task-submission-service.test.ts tests/integration/task-review-concurrency.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `submitResearchTask()`**

One transaction: lock task → authorize owner → validate state/refs/contributors → freeze schema-versioned requirement snapshot → allocate number → insert immutable facts → for `reviewPolicy=required` create initial ReviewRequest + `assigned` ReviewAction + Task `awaiting_review`; otherwise leave Task `in_progress` for explicit `completeUnreviewedTask`.

Do not copy summary/snapshot into ResearchEvent/Outbox.

- [ ] **Step 4: Run GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: add immutable task submissions"`

---

### Task 4: Reviewer Eligibility and Reassignment

**Files:**
- Create: `packages/application/src/tasks/task-review-service.ts`
- Create: `packages/application/src/tasks/task-review-service.test.ts`
- Modify: `packages/application/src/tasks/task-permissions.ts`

**Interfaces:**
- Consumes the Task 3 `assertEligibleReviewer(...)` helper; Task 4 broadens its regression coverage rather than redefining eligibility.
- `reassignReviewer(sql, reviewRequestId, reviewerMemberId, actor) -> Promise<ReviewRequest>`.
- Initial assignment remains inside `submitResearchTask()`; do not add a free-floating “create review later” path.

- [ ] **Step 1: Write failing reviewer tests**

Pin:
- reviewer must be active human and project member or team lead.
- submitter and every human contributor are ineligible.
- reviewer deactivated/removed after page render cannot review/reassign successfully.
- no eligible reviewer fails closed.
- only project lead/team lead can reassign.
- reassignment writes append-only `reassigned` action with previous/new reviewer and `REVIEW_REASSIGNED`; old history survives.
- reassignment cannot target a contributor.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run packages/application/src/tasks/task-review-service.test.ts packages/application/src/tasks/task-submission-service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement reviewer eligibility and reassignment**

Lock ReviewRequest for reassignment; recalculate eligibility from current DB state every time.

- [ ] **Step 4: Run GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: enforce task reviewer assignment"`

---

### Task 5: Ordinary Review Outcomes, Completion Provenance, and Cancellation

**Files:**
- Modify: `packages/application/src/tasks/task-review-service.ts`
- Modify: `packages/application/src/tasks/task-review-service.test.ts`
- Modify: `packages/application/src/tasks/research-task-service.ts`
- Modify: `packages/application/src/tasks/research-task-service.test.ts`
- Modify: `tests/integration/task-review-concurrency.test.ts`

**Interfaces:**
- `approveSubmission(sql, reviewRequestId, comment, actor)`
- `requestSubmissionChanges(sql, reviewRequestId, comment, actor)`
- `rejectSubmission(sql, reviewRequestId, comment, actor)`
- `cancelResearchTask(...)` gains pending-review atomic cancellation.
- Required completion writes `RESEARCH_TASK_COMPLETED` with `completionKind:"review_approved"`; unreviewed completion uses `"unreviewed_acceptance"`.

- [ ] **Step 1: Write failing ordinary-review tests**

Assert:
- only current reviewer can act; contributor/self-review fails even if UI is bypassed.
- approve → Review approved + Task completed + exactly one completion event containing submissionId.
- request_changes/reject require non-empty bounded comment (≤ 4,000), terminate old Review, return Task to `in_progress`, preserve old Submission/Review.
- next submit creates Submission #2 + Review #2; old rows unchanged.
- Review actions do not alter official revisions.
- concurrent double approve yields exactly one terminal ReviewAction/event/completion.
- pending Review task cancel by owner/project lead/team lead atomically writes Review `cancelled`, ReviewAction `cancel`, Task `cancelled`, and both cancellation events.
- awaiting-scientific-decision task cancellation fails closed.
- reopen preserves prior completion event/accepted submission and requires a new submission cycle.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run packages/application/src/tasks/task-review-service.test.ts packages/application/src/tasks/research-task-service.test.ts tests/integration/task-review-concurrency.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement ordinary review transitions and cancellation orchestration**

Use `SELECT ... FOR UPDATE` on ReviewRequest plus Task in the same transaction. Do not reopen finalized Review rows.

- [ ] **Step 4: Run GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: add ordinary research task review"`

---

### Task 6: Review Escalation to ScientificDecision and Terminal Resolution Worker

**Files:**
- Create: `packages/application/src/tasks/task-review-escalation.ts`
- Create: `packages/application/src/tasks/task-review-escalation.test.ts`
- Create: `apps/worker/src/review-runtime.ts`
- Create: `apps/worker/src/review-runtime.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`
- Modify: `tests/acceptance/support/environment.ts` only to expose a controller that runs the same review-resolution handler through `runOutboxPass`; acceptance support must not mutate Review rows directly.

**Interfaces:**
- `escalateReviewToScientificDecision(sql, reviewRequestId, proposal: Omit<DecisionProposal,"projectId">, actor)`.
- `resumeReviewAfterScientificDecision(sql, decisionId) -> Promise<"resumed" | "not_linked" | "not_terminal" | "already_resolved">`.
- `createReviewResolutionOutboxHandler(sql): BooleanOutboxHandler` handles only `scientific.decision.reviewed`.
- The current repo has no separate production dispatcher bootstrap beyond injectable `startWorker(databaseUrl, dispatch)`; prove the handler composes through existing `createWorkerDispatch(...handlers)` instead of inventing a new deployment entry point.

- [ ] **Step 1: Write failing escalation tests**

Pin:
- current reviewer only.
- escalation creates ScientificDecision + ReviewDecisionLink + ReviewAction + Review state atomically.
- duplicate/concurrent escalation produces one unresolved Decision.
- official_revision proposal still obeys existing project/revision/major-decision validation.
- Review stays `awaiting_scientific_decision` while Decision becomes `awaiting_lead` or `needs_evidence`.
- non-terminal `scientific.decision.reviewed` returns `not_terminal` and does not resume Review.
- terminal approved/rejected resumes Review to pending exactly once.
- Decision approved does not auto-approve Review or complete Task.
- Decision rejected does not auto-reject Submission.
- outbox handler is idempotent on retry.
- acceptance support processes resolution via `runOutboxPass(..., createWorkerDispatch(createReviewResolutionOutboxHandler(sql)))`; it must not call `resumeReviewAfterScientificDecision()` as a shortcut.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run packages/application/src/tasks/task-review-escalation.test.ts apps/worker/src/review-runtime.test.ts apps/worker/src/main.test.ts tests/integration/decision-concurrency.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement escalation and worker handler**

Reuse `createScientificDecisionInTransaction()`; do not duplicate ScientificDecision state logic. Worker must re-read the linked Decision and resume only for `approved | rejected`.

- [ ] **Step 4: Run GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: bridge task reviews to scientific decisions"`

---

### Task 7: Research Work Read Models, Review Inbox, and Restricted Ref Projection

**Files:**
- Create: `apps/web/src/server/work-queries.ts`
- Create: `apps/web/src/server/work-queries.test.ts`.
- Reuse: `apps/web/src/server/queries.ts` exports `CurrentMember`, `getWebDbClient()`, and 4A file authorization behavior without exposing raw restricted metadata.

**Interfaces:**
- `getProjectResearchWork(member, projectId) -> ProjectResearchWorkViewModel | null`.
- `getResearchTaskDetail(member, taskId) -> ResearchTaskDetailViewModel | null`.
- `listMyReviewInbox(member) -> ReviewInboxItem[]`.
- Detail model exposes stable ref IDs, safe display labels, Submission/Review/Decision timeline, AgentRun state, and file access class; it does **not** expose restricted locator/access-policy fields.

- [ ] **Step 1: Write failing read-model tests**

Assert:
- only visible project tasks/reviews are returned.
- reviewer inbox contains only current pending reviews assigned to that member; awaiting-scientific-decision is visible but not actionable.
- task detail preserves all Submission/Review history in sequence.
- hybrid provenance shows human contributors + AgentRun refs.
- restricted FileVersion ref returns safe title/version/access-class metadata only; locator/accessPolicyRef are absent.
- a reviewer with ordinary project access cannot gain file content/locator permissions from the work query.

- [ ] **Step 2: Run RED**

Run the focused query test file.

Expected: FAIL.

- [ ] **Step 3: Implement query read models**

Keep the query file read-only; never infer formal acceptance from current Task status alone—use Review/completion provenance.

- [ ] **Step 4: Run GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: add research work read models"`

---

### Task 8: Web Actions and Research Work / Review UI

**Files:**
- Create: `apps/web/src/server/work-actions.ts`
- Create: `apps/web/src/server/work-actions.test.ts`
- Create: `apps/web/src/components/research-work/research-task-list.tsx`
- Create: `apps/web/src/components/research-work/research-task-detail.tsx`
- Create: `apps/web/src/components/research-work/review-inbox.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/work/page.tsx`
- Create: `apps/web/app/(app)/projects/[projectId]/work/[taskId]/page.tsx`
- Create: `apps/web/app/(app)/reviews/page.tsx`
- Modify: `apps/web/src/components/project-navigation.tsx`
- Modify: `packages/ui/src/index.tsx`

**Interfaces:**
- Server actions call application services only; no direct business-state UPDATE SQL.
- Forms cover create/start/block/unblock/cancel/reopen, requirements/mode/policy/owner before lock, formal submit, unreviewed completion, reviewer reassignment, approve/request-changes/reject/escalate.
- ProjectNavigation adds `研究工作` → `/projects/[projectId]/work`.
- `packages/ui/src/index.tsx` MAIN_NAVIGATION adds enabled `待我审核` → `/reviews`; do not merge this entry into `科学决策`.

- [ ] **Step 1: Write failing action/input tests**

Pin:
- invalid enum/status/ref kind/relation rejected before application call.
- free text is trimmed/bounded; no raw application/DB exception payload is reflected.
- actor identity always comes from `requireCurrentMember()`, never form fields.
- project/task/review IDs supplied by browser are revalidated in application services.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run apps/web/src/server/work-actions.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement server actions/components/pages**

UI requirements:
- project work list shows owner/mode/policy/status/latest submission/current reviewer/current review/latest AgentRun state;
- detail page shows immutable provenance timeline;
- action controls render only when likely applicable, but server remains authoritative;
- ordinary Review and ScientificDecision appear as separate visual sections;
- Agent Work page remains separate.

- [ ] **Step 4: Run GREEN plus typecheck**

Run:
`pnpm vitest run apps/web/src/server/work-actions.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "feat: add research work and review UI"`

---

### Task 9: Acceptance Fixture and Browser Scenarios 1–5

**Files:**
- Modify: `tests/acceptance/support/environment.ts`
- Create: `tests/acceptance/human-hybrid-work-review.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Extend acceptance environment with stable IDs/users for Phase 4B tasks, submissions, reviewers, and a second eligible reviewer.
- Add the new spec to the `pnpm acceptance` command; do not remove existing Phase 1–4A specs.

- [ ] **Step 1: Add acceptance RED scenarios 1–5**

Implement browser tests:
1. human task → pure-text Submission → reviewPolicy none → explicit completion; immutable history visible.
2. required task → submit → awaiting_review; owner cannot bypass Review completion.
3. assigned reviewer approves → Task completed.
4. request_changes preserves Submission #1/Review #1; owner creates Submission #2; Review #2 approves.
5. contributor cannot review own Submission; a different explicitly assigned reviewer can.

- [ ] **Step 2: Run focused RED**

Run:
`pnpm playwright test tests/acceptance/human-hybrid-work-review.spec.ts --grep "pure-text|awaiting_review|approves|request_changes|contributor"`

Expected: at least one failing scenario before fixture/UI completion.

- [ ] **Step 3: Complete fixture/UI wiring needed by scenarios 1–5**

Do not change domain rules to satisfy browser timing. Diagnose UI/test races separately from product invariants.

- [ ] **Step 4: Run focused GREEN**

Run the Step 2 command.

Expected: all selected scenarios PASS.

- [ ] **Step 5: Commit**

`git commit -am "test: cover phase four B core review workflow"`

---

### Task 10: Browser Scenarios 6–9 — Hybrid, Escalation, Restricted Files, Reopen

**Files:**
- Modify: `tests/acceptance/support/environment.ts`
- Modify: `tests/acceptance/human-hybrid-work-review.spec.ts`
- Modify relevant 4B UI/query files only if scenarios expose a real product gap.

**Interfaces:**
- Reuse existing AgentRun/ScientificDecision/4A restricted file seed capabilities; do not add mock semantics that differ from production application services.

- [ ] **Step 1: Add acceptance RED scenarios 6–9**

6. hybrid task displays human + AgentRun provenance; completed AgentRun alone does not complete Task.
7. Review escalation creates ScientificDecision; official pointer remains unchanged through non-terminal governance; after Decision approval Review still requires final ordinary approve.
8. restricted FileVersion reference remains redacted/authorized under 4A rules.
9. completed Task reopen preserves old accepted Submission/Review and creates a new Submission cycle.

- [ ] **Step 2: Run focused RED**

Run:
`pnpm playwright test tests/acceptance/human-hybrid-work-review.spec.ts --grep "hybrid|escalat|restricted|reopen"`

Expected: FAIL until the complete cross-subsystem UI path is wired.

- [ ] **Step 3: Implement only gaps exposed by these scenarios**

Keep the existing ScientificDecision lock and FileVersion security path unchanged; 4B should call into them, not duplicate them.

- [ ] **Step 4: Run focused GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "test: cover hybrid review provenance flows"`

---

### Task 11: Concurrency, Secret-Safety, and Cross-Subsystem Regression Hardening

**Files:**
- Modify: `tests/integration/task-review-concurrency.test.ts`
- Create: `tests/integration/task-review-secret-safety.test.ts`
- Modify: `packages/application/src/tasks/*` only for defects proven by new RED tests.

**Interfaces:**
- No new product surface; this task hardens the approved contracts.

- [ ] **Step 1: Add focused RED regressions**

Cover:
- double submit;
- double approve;
- double escalation;
- duplicate terminal Decision-resolution delivery;
- non-terminal Decision event no-op;
- stale inactive owner/reviewer;
- cross-project FileVersion/ResearchResult/Revision/AgentRun injection;
- structured credential-shaped keys in snapshot/escalation payload rejected;
- Submission summary/review comment text is absent from ResearchEvent/Outbox payloads and persisted `last_error`;
- duplicate contributors/refs cannot create extra facts;
- restricted locator/access-policy never appears in 4B event/outbox payloads.

- [ ] **Step 2: Run RED**

Run:
`pnpm vitest run tests/integration/task-review-concurrency.test.ts tests/integration/task-review-secret-safety.test.ts tests/integration/decision-concurrency.test.ts tests/integration/file-event-secret-safety.test.ts`

Expected: any newly exposed defect fails narrowly.

- [ ] **Step 3: Apply minimal fixes one defect at a time**

Do not refactor unrelated Phase 2/3/4A code. Preserve exact-head diagnosis discipline.

- [ ] **Step 4: Run GREEN**

Run Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -am "test: harden phase four B workflow boundaries"`

---

### Task 12: Full Regression, Manual Invariant Review, Verification Record, and Draft PR

**Files:**
- Create: `docs/superpowers/reviews/2026-09-30-phase-04b-verification.md`
- GitHub metadata action: search for a Phase 4B PR from `phase/04b-human-hybrid-work-review`; create it as Draft if absent, otherwise update its body. Do not merge.

**Interfaces:**
- No product APIs; this is the phase gate.

- [ ] **Step 1: Run focused Phase 4B browser acceptance on the exact implementation head**

Run:
`pnpm playwright test tests/acceptance/human-hybrid-work-review.spec.ts`

Expected: 9/9 Phase 4B scenarios PASS.

- [ ] **Step 2: Run fresh full regression on the stationary exact head**

Run:
`pnpm test`
`pnpm typecheck`
`pnpm lint`
`pnpm build`
`pnpm acceptance`

Expected: all required tests PASS; any configured external provider/service absence remains explicit SKIP, never PASS.

- [ ] **Step 3: Perform coordinator/manual invariant review from the spec and diff**

Review at minimum:
- AI cannot submit/approve/change official scientific state.
- every completion binds submissionId.
- legacy active mutation upgrades v2 without fabricated history.
- reviewPolicy lock after first Submission.
- self-review impossible.
- Review/ScientificDecision separation.
- terminal-only Decision resume.
- restricted file access unchanged.
- concurrent duplicate facts blocked.
- event/outbox payloads avoid free research text/secrets.
- no Phase 4C progress/cockpit implementation drift.

Record explicitly: `independent AI reviewer: unavailable`.

- [ ] **Step 4: Write verification record and commit**

Record implementation head, exact commands/results, 9 browser scenarios, skips, review limitations, and known risks.

Commit:
`git commit -m "docs: record phase four B verification"`

- [ ] **Step 5: Run fresh exact-head CI for the verification-record commit**

Do not declare final verification until this exact head succeeds.

- [ ] **Step 6: Create/update a Draft Phase 4B PR**

Base it on the Phase 4A implementation branch/head required by the stacked-PR strategy; keep it Draft/open/unmerged. Include scope, invariants, exact CI evidence, explicit SKIPs, and `independent reviewer: unavailable`.

Do not auto-merge and do not begin Phase 4C implementation.

---

## Plan Self-Review Result

- **Spec coverage:** all approved Phase 4B sections map to Tasks 1–12; no Phase 4C implementation is included.
- **Type consistency:** task/review/submission names and enums match the approved spec; accepted submission provenance is represented by `RESEARCH_TASK_COMPLETED.submissionId`.
- **Review Focus:** all five high-risk classes are explicitly pinned to tests.
- **Legacy compatibility:** no fabricated historical Submission/Review; active v1 cannot remain a permanent bypass.
- **Scientific governance:** ordinary Review never writes official scientific pointers; escalation reuses existing ScientificDecision services.
- **Security:** restricted FileVersion permission remains a 4A concern and is only projected safely in 4B.
- **Execution:** implementation is intentionally deferred until human review of this plan; execution method remains Native / `superpowers:executing-plans`.
