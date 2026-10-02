# Phase 4C — Progress Projection & Cockpit Foundation Verification

- Verification date: 2026-10-02
- Approved spec: `docs/superpowers/specs/2026-10-01-phase-04c-progress-projections-cockpit-design.md`
- Approved implementation plan: `docs/superpowers/plans/2026-10-01-phase-04c-progress-projections-cockpit.md`
- Implementation branch: `phase/04c-native-implementation`
- Draft implementation PR: #9
- Execution mode: Native / `superpowers:executing-plans`
- Independent AI reviewer: **unavailable**
- Review mode: coordinator/manual invariant review
- Draft PR merge: **not performed**
- Draft PR ready-for-review transition: **not performed**

## Verification status

Phase 4C implementation is complete through Tasks 1–8.

Stable implementation/acceptance head before this verification record:

`2285b2eb5f32b682c364d69c8bee376d9629dbee`

Fresh exact-head full CI on that product checkpoint:

- workflow run: `36904923987`
- conclusion: **success**
- `pnpm test`: **57 test files passed, 3 skipped; 248 tests passed, 6 skipped**
- `pnpm typecheck`: **PASS**
- `pnpm lint`: **PASS**
- `pnpm build`: **PASS**
- Playwright browser installation: **PASS**
- `pnpm acceptance`: **39/39 browser tests passed (7.5m)**
- Phase 4C browser boundary: **10/10 scenarios passed**

This verification-record commit itself still requires a fresh exact-head CI success before Phase 4C is declared finally verified.

## Phase 4C browser acceptance

The full acceptance command includes `tests/acceptance/progress-cockpit.spec.ts`. The ten approved Phase 4C scenarios are green:

1. portfolio cockpit preserves organization-lead team scope, researcher membership scope, and the existing top-level navigation;
2. “我的明确行动” contains only Review/ScientificDecision work formally assigned to the current member;
3. project overview preserves multidimensional scientific state ahead of cockpit attention/recent activity and keeps project members visible;
4. project cockpit projects current blocked, long-idle, Agent waiting-human/latest-failure, and current FileVersion parse-failure facts without restricted locator/access-policy leakage;
5. project cockpit deep-links only to canonical Research Work, Scientific Decision, Agent Work, and File workflows;
6. Recent Activity is curated, capped at ten per project, newest-first, includes Task/Decision/ResearchResult/research-state/file facts, excludes >14-day history, and does not surface raw event payload sentinels;
7. canonical unblock removes current blocked attention while preserving the historical unblock fact;
8. a new formal TaskSubmission resets long-idle projection;
9. retrying a failed AgentRun makes the newer attempt authoritative for current attention, while cockpit surfaces remain read-only/minimal and do not expose sensitive free text or scoring/ranking controls;
10. an invalid projection-critical canonical dimension state fails closed to an explicit unavailable surface rather than being rendered as empty/healthy.

The full Phase 1–4C browser suite passed 39/39, so existing Phase 1–4B acceptance behavior remains regression-green. The real tusd + SeaweedFS browser path remains part of that required acceptance gate and passed.

## Explicit SKIPs

SKIP is not PASS.

The exact-head unit/integration run contains six conditional real-service/provider skips:

- `tests/integration/harness-sdk-smoke.test.ts`: 1 real-provider smoke skipped;
- `tests/integration/harness-code-subagent-smoke.test.ts`: 1 real-provider/subagent smoke skipped;
- `tests/integration/storage-seaweedfs-smoke.test.ts`: 1 standalone real SeaweedFS S3 smoke skipped;
- `tests/integration/clamav-smoke.test.ts`: 1 real ClamAV smoke skipped;
- `tests/integration/tika-smoke.test.ts`: 1 real Tika smoke skipped;
- `tests/integration/docling-smoke.test.ts`: 1 real Docling smoke skipped.

No skipped real service/provider check is reported as passing.

## Manual invariant review

The current tool environment cannot dispatch an independent AI reviewer. The following is coordinator/manual invariant review against the approved Phase 4C spec and final implementation diff.

### Truth-plane and mutability boundary

Verified:

- Phase 4C adds no new scientific/workflow truth table, projection table, Redis cache, background refresh worker, or acknowledgement state;
- application projection modules contain no formal-state `insert`, `update`, or `delete` path;
- cockpit reads do not append `ResearchEvent` or enqueue Outbox events;
- portfolio/project cockpit UI exposes links only; canonical workflow pages retain all Review, ScientificDecision, ResearchTask, Agent and File mutations;
- no new top-level `/cockpit` route was added.

### Consistent read model

Verified:

- every public cockpit request executes inside `runInReadOnlySnapshot()`;
- the helper reserves an isolated postgres.js connection and runs `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
- reservation is bounded and late-resolving reservations are released;
- `now` is injected once into the public service and reused for idle/recent-window classification;
- current facts come from canonical tables; historical transitions come from the curated ResearchEvent allowlist.

### Human governance and responsibility

Verified:

- ScientificDecision current-review eligibility is extracted into the shared pure `resolveScientificDecisionReviewStage()` rule;
- both `reviewScientificDecision()` and cockpit current-fact projection consume that same rule;
- pending ordinary Review enters “my review” only for the explicit reviewer;
- Agent human-interaction attention is labelled “等待人工输入”, not “等待你”, because the formal interaction has no separate assignee;
- projection never upgrades AI execution state into formal scientific completion or approval.

### Current-state supersession semantics

Verified:

- current Agent attention selects the maximum `attemptNumber` per AgentTask, so a newer retry supersedes an older failed attempt for current attention without deleting history;
- current file parse attention joins only `ResearchFile.currentVersionId`, so an old failed FileVersion does not remain a current alert after a new current version exists;
- blocked/current Review/ScientificDecision state is read from canonical rows rather than inferred from historical events;
- long-idle applies only to eligible open/in-progress tasks and uses exactly 14 × 24 hours since latest meaningful formal task activity.

### Authorization and sensitive-data boundary

Verified:

- portfolio visible-project scope is team-bounded for organization leads and membership-bounded for researchers;
- project cockpit retains the existing canonical project access gate;
- current fact queries do not join restricted external locators or extracted file text;
- safe cockpit DTOs do not contain restricted locator/access-policy fields, TaskSubmission summary, Review comment, Decision reason/evidence, Agent request/interaction payload, raw exception, or generic raw ResearchEvent payload;
- Recent Activity extracts only allowlisted identifiers/state fields needed to resolve safe canonical labels;
- acceptance verifies restricted locator/access-policy and raw event sentinels are absent from rendered cockpit HTML.

### Deterministic attention, not scoring

Verified:

- no progress percentage, project health score, risk score, Green/Amber/Red judgement, AI priority score, or cross-project ranking exists in the projection DTOs or UI;
- attention lanes are deterministic facts with stable sorting;
- project-card lane previews are capped while total counts remain explicit;
- Recent Activity is capped at ten per project and is not an unbounded social/activity feed;
- empty states use factual query wording and are distinct from unavailable projection failures.

### Scope / architecture review

No Phase 4C scope drift was found.

Phase 4C remains a **Progress Projection & Cockpit Foundation**. It does not invent canonical models for scientific risk, personnel load, collaboration demand, cross-project reuse opportunities, or deadline management. Those future cockpit capabilities still require explicit domain models before projection.

The Research Workbench / Harness / GitHub truth-plane separation remains unchanged.

## RED → GREEN and failure classification findings

### Shared ScientificDecision eligibility

Task 1 RED intentionally failed because the shared eligibility module did not yet exist. GREEN extracted one pure rule and refactored the write path plus existing Decision UI to consume it without changing state transitions, events, Outbox behavior, or existing error semantics.

### Read-only snapshot helper

Task 2 added repeatable-read/read-only snapshot coverage. The implementation deliberately avoided relying on shared-pool `sql.begin()` in the pinned postgres.js version and instead uses a bounded reserved connection plus explicit BEGIN/COMMIT/ROLLBACK/release lifecycle.

### Current-fact query repair

Task 4 testing found a real projection defect: the latest Submission lateral query selected `submission_number`, but the top-level SELECT initially omitted it, causing the mapped number to fall back to zero. The query was corrected.

A separate “unknown task status” test attempt was correctly classified as a fixture problem because PostgreSQL rejects that invalid task status before projection. Fail-closed coverage was moved to a projection-critical research-dimension state that the database permits the test fixture to corrupt.

### Acceptance harness / selector repairs

Several Phase 4C browser failures were classified as test infrastructure rather than product defects:

- acceptance teardown originally killed only the pnpm wrapper, allowing a Next.js descendant to outlive its database; teardown now terminates the full process group;
- the bootstrap auth pool is explicitly closed;
- cockpit file fixtures were repaired to use valid immutable backing/blob/input-hash relationships;
- the legacy Phase 1 project-link selector was scoped to `project-card` after new Recent Activity links made the old broad accessible-name selector ambiguous.

No production-state semantics were weakened to make those tests pass.

### Task 8 acceptance fixture type

The first Task 8 candidate used `executionKind: "human"` for a ResearchResult fixture. Typecheck correctly rejected it because the formal enum is `manual | code`. The fixture was corrected to `manual`; no production type was changed.

## Checkpoint / interruption recovery strategy

Repeated conversation interruptions and concurrent branch movement were treated as state-recovery problems, not reasons to restart implementation.

The applied rule was:

1. re-read the actual GitHub branch/PR head before every write;
2. re-read Actions for that exact SHA;
3. trust newer successful exact-head evidence over stale chat state or obsolete failures;
4. never repeat a Task with successful exact-head evidence;
5. on write conflicts, re-read the new head rather than force-updating;
6. classify product defects separately from fixture, selector, harness, environment, and connector-cache failures;
7. keep one risk class per meaningful checkpoint.

A GitHub connector job-log cache mismatch was also detected during Task 8; raw GitHub REST run/job endpoints were used for the authoritative current-run state instead of treating stale job logs as new evidence.

## Draft PR / dependency state

At the product checkpoint:

- PR #4 Phase 3: open, Draft, unmerged;
- PR #5 Phase 4A: open, Draft, unmerged;
- PR #6 Phase 4B: open, Draft, unmerged;
- PR #7 Phase 4C design: open, Draft, unmerged;
- PR #8 Phase 4C implementation plan: open, Draft, unmerged;
- PR #9 Phase 4C implementation: open, Draft, unmerged.

No PR was marked ready or merged.

## Drive checkpoint synchronization

GitHub remains the authoritative engineering source of truth.

Drive mirroring remains intentionally deferred because the previously connected Drive sources did not identify a unique Research Workbench destination. This documentation-sync limitation does not invalidate or require re-running already verified engineering work. A later explicit account/directory choice can mirror documentation only.

## Known limitations / final gate

- Independent AI reviewer: unavailable.
- Conditional real provider/service checks remain explicit SKIPs when private dependencies are unavailable.
- Phase 4C intentionally does not implement scientific-risk scoring, personnel-load modelling, collaboration-demand modelling, cross-project reuse inference, deadline modelling, Knowledge/Ontology, or reasoning-engine behavior.
- The written design/plan were explicitly human-approved before implementation; the implementation does not authorize merge.
- This verification record commit must receive fresh exact-head CI success before Phase 4C is declared finally verified.
- After that success, PR #9 remains Draft at the human gate; do not mark ready or merge it automatically.
