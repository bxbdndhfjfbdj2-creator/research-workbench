# Phase 4B — Human/Hybrid ResearchTask & Unified Review Verification

- Verification date: 2026-10-01
- Approved spec: `docs/superpowers/specs/2026-09-30-phase-04b-human-hybrid-work-review-design.md`
- Approved plan: `docs/superpowers/plans/2026-09-30-phase-04b-human-hybrid-work-review.md`
- Implementation branch: `phase/04b-native-implementation`
- Execution mode: Native / `superpowers:executing-plans`
- Independent AI reviewer: **unavailable**
- Review mode: coordinator/manual invariant review
- Phase 4C: **not started**
- Draft PR merge: **not performed**

## Verification status

The Phase 4B implementation tree is complete through Tasks 1–11.

Stable product-code implementation head:

`38b0469b0ea5fd7fdc5004ae6e2883a5c60dd9c7`

Task 11 checkpoint head (product tree unchanged; checkpoint documentation added):

`ea443fea1dab5d321c6a680a8522b451fc797553`

Fresh exact-head full CI on that checkpoint:

- workflow run: `36776898562`
- conclusion: **success**
- `pnpm test`: **53 test files passed, 3 skipped; 218 tests passed, 6 skipped**
- `pnpm typecheck`: **PASS**
- `pnpm lint`: **PASS**
- `pnpm build`: **PASS**
- Playwright browser installation: **PASS**
- `pnpm acceptance`: **29/29 browser tests passed (5.2m)**

This verification-record commit itself must receive a fresh exact-head CI success before Phase 4B is declared finally verified.

## Phase 4B browser acceptance

The full acceptance command includes `tests/acceptance/human-hybrid-work-review.spec.ts`. All nine approved Phase 4B scenarios are green:

1. pure-text Submission requires explicit human acceptance before an unreviewed task completes;
2. required Review enters `awaiting_review` and the owner cannot bypass approval;
3. the explicitly assigned reviewer can approve the immutable Submission and complete the task;
4. `request_changes` preserves Submission #1 / Review #1 and a new Submission #2 / Review #2 can be approved;
5. contributor/owner self-review is blocked while the explicitly assigned eligible reviewer can act;
6. hybrid work preserves human + completed AgentRun provenance and AgentRun completion alone does not complete the ResearchTask;
7. Review escalation keeps ScientificDecision governance separate: non-terminal Decision review does not resume ordinary Review, terminal resolution resumes it to `pending`, and final task completion still needs ordinary reviewer approval;
8. restricted FileVersion provenance exposes safe title/version/access-class metadata without restricted locator/access-policy leakage;
9. reopening a completed task preserves prior accepted history and requires a fresh Submission/review cycle.

Task 10 checkpoint `f816f7d0f18e174c9e4d8d5eda83a6bc0580ba7a` records the 9/9 browser scenario boundary. The final checkpoint full acceptance above re-ran the entire Phase 1–4B browser suite on the final product tree.

## Explicit SKIPs

SKIP is not PASS.

The exact-head unit/integration run contains six conditional real-smoke skips:

- `tests/integration/harness-sdk-smoke.test.ts`: 1 real-provider smoke skipped;
- `tests/integration/harness-code-subagent-smoke.test.ts`: 1 real-provider/subagent smoke skipped;
- `tests/integration/storage-seaweedfs-smoke.test.ts`: 1 standalone real SeaweedFS S3 smoke skipped;
- `tests/integration/clamav-smoke.test.ts`: real ClamAV smoke skipped;
- `tests/integration/tika-smoke.test.ts`: real Tika smoke skipped;
- `tests/integration/docling-smoke.test.ts`: real Docling smoke skipped.

Existing deterministic fake/contract coverage and the real tusd + SeaweedFS browser path remain required. No skipped real service/provider check is reported as passing.

## Manual invariant review

The current harness cannot dispatch an independent reviewer. The following is a coordinator/manual invariant review from the approved spec and implementation diff, not an independent-review pass.

### Human accountability and AI limits

Verified:

- workflow-v2 ResearchTask has a non-null human accountable owner;
- task creation/mutation paths use human actors;
- formal `submitResearchTask()` requires a human accountable owner;
- ordinary Review outcomes require a human actor and the current explicit reviewer;
- ScientificDecision review continues to require a human actor under the existing governance service;
- AgentRun can be provenance/contributor input but does not auto-submit, auto-review, auto-complete, or alter official scientific state.

### Submission and completion provenance

Verified:

- TaskSubmission, contributors, refs, ReviewAction, and ReviewDecisionLink use append-only database triggers;
- one task has unique monotonically allocated submission numbers;
- submitted-by is automatically included as a human contributor;
- every task completion records `RESEARCH_TASK_COMPLETED` with an explicit accepted `submissionId` and completion kind;
- unreviewed completion accepts only the latest Submission;
- after reopen, a previously accepted Submission cannot be reused to complete the task again; a new formal Submission is required.

### Review policy and self-review

Verified:

- `reviewPolicy` is editable only before the first formal Submission;
- required-review Submission creates ReviewRequest in the same transaction and moves the Task to `awaiting_review`;
- reviewer eligibility is recalculated server-side from active human/project access;
- any human contributor, including the submitter/accountable owner, is ineligible to review that Submission;
- reassignment is explicit and append-only history preserves previous/new reviewer identity.

### Review / ScientificDecision separation

Verified:

- ordinary Review approval changes task delivery state but does not write official scientific pointers;
- escalation creates a separate ScientificDecision plus immutable ReviewDecisionLink;
- Review enters `awaiting_scientific_decision` rather than becoming scientifically approved;
- the resolution worker re-reads the linked Decision and only `approved | rejected` are terminal;
- non-terminal `awaiting_lead` / `needs_evidence` events do not resume Review;
- terminal Decision resolution only returns Review to `pending`;
- ScientificDecision approval does not auto-approve ordinary Review and does not auto-complete the task.

### Legacy compatibility

Verified:

- migration backfills missing legacy assignee from `created_by`, applies `human/none/[]` defaults, and marks existing tasks workflow v1;
- migration does not fabricate historical TaskSubmission/Review facts;
- active v1 lifecycle mutation upgrades the task to v2 and records `RESEARCH_TASK_WORKFLOW_UPGRADED`;
- invalid/inactive legacy owner fails closed until an authorized lead reassigns a valid human owner;
- legacy completed task reopen upgrades into v2 semantics.

### Concurrency and idempotency

Verified by integration coverage and database constraints:

- concurrent formal submit cannot create two active cycles or duplicate submission numbers;
- concurrent double approve produces only one terminal approval/completion fact;
- duplicate/concurrent escalation cannot create multiple unresolved ScientificDecision facts;
- terminal Decision-resolution delivery is idempotent;
- unique constraints protect one ReviewRequest per Submission, contributor/ref duplicates, and one link per ScientificDecision.

### Restricted files and sensitive payloads

Verified:

- cross-project FileVersion/ResearchResult/ResearchNodeRevision/AgentRun refs fail closed;
- 4B restricted FileVersion read projection joins FileVersion/ResearchFile safe metadata and deliberately does **not** join `external_data_references`;
- restricted locator/access-policy metadata is absent from the 4B read-model surface;
- structured requirement/escalation payloads run through the existing credential-shaped-key guard;
- Submission summary and Review comment remain formal bounded business text but are not copied to ResearchEvent/Outbox;
- restricted locator/access-policy values are not copied to 4B Event/Outbox payloads;
- outbox dispatch failures persist a fixed safe `DispatchError` summary rather than raw exception text;
- server actions replace raw application/DB exceptions with the generic `Research work action failed` message.

### Scope review

No Phase 4C implementation drift was found.

Phase 4B adds Research Work and Review Inbox surfaces, but does not add portfolio progress percentages, attention ranking, project/portfolio cockpit projections, or a generic workflow engine.

## RED → GREEN / failure findings during implementation

### Pure-text Submission form contract

Initial Task 9 browser candidate:

`66759ce4bac99fe8230eaab02da608ee57279dc8`

failed because the browser sent empty `refKind/refId` but default `refRelation=source`, correctly triggering server partial-ref validation.

GREEN:

`93b5c9d48002c5b9b9fd510dd90d1b6c946efc48`

changed the UI to make the no-ref relation value empty while preserving fail-closed server validation.

### Phase 4B restricted-file fixture isolation

Initial Task 10 candidate:

`4e5f0856ba3aa6876df8886892f0cfa924304b83`

failed because a new restricted-file seed polluted the shared Phase 4A file acceptance fixture.

GREEN:

`6581fc3129136aa8e6a929d19a1b51618360f24c`

made the 4B work/review fixture opt-in, preserving existing Phase 4A acceptance semantics.

### Reopen accepted-submission reuse

Post-Task-11 manual/spec review found that a reopened unreviewed task could otherwise accept the previously accepted latest Submission again.

RED:

`e845053aaeae68fb84a11f9e20faf17c3035d0bf` — CI `36767321352` failed on the new invariant test.

GREEN:

`38b0469b0ea5fd7fdc5004ae6e2883a5c60dd9c7` — CI `36767609849` succeeded.

The completion service now requires a fresh formal Submission after reopen while preserving the old accepted completion event.

## Checkpoint / interruption recovery strategy

Repeated conversation interruptions were treated as state-recovery problems rather than reasons to restart implementation.

Stable checkpoints:

- after Task 8: `docs/superpowers/checkpoints/2026-10-01-phase-04b-native-task-08.md`
- after Task 9: `docs/superpowers/checkpoints/2026-10-01-phase-04b-native-task-09.md`
- after Task 10: `docs/superpowers/checkpoints/2026-10-01-phase-04b-native-task-10.md`
- after Task 11: `docs/superpowers/checkpoints/2026-10-01-phase-04b-native-task-11.md`

Recovery rule:

1. re-read real GitHub head and recent Actions;
2. trust the newest successful exact-head checkpoint over chat history;
3. repair only the current exact-head failure;
4. do not chase obsolete failed runs after a newer success exists;
5. isolate fixture failures from product defects before changing production code;
6. one risk class per batch;
7. after a successful batch, commit a checkpoint before the next risk class.

## Drive checkpoint synchronization

Checkpoint documents contain only engineering state/evidence and are safe to mirror to Drive.

Drive synchronization was intentionally deferred because two Drive accounts are connected and neither exposes an existing `research-workbench` destination. Choosing one account would be an unsupported guess. This is a documentation-sync limitation only; GitHub remains the authoritative engineering checkpoint, and no already-passed engineering work needs to be re-run when Drive synchronization is later completed.

## Known limitations / final gate

- Independent AI reviewer: unavailable.
- Real provider/service smokes listed above remain explicit SKIPs when their private dependencies are unavailable.
- Phase 4C is not started.
- Phase 4A PR #5 and its upstream Phase 3 PR remain Draft/open/unmerged.
- This verification record does not authorize merge.
- The record commit must pass fresh exact-head CI before final verification is declared.
- After that success, create a Draft Phase 4B PR stacked on `phase/04-research-operations`; do not auto-merge.
