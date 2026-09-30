# Phase 4B Native Execution Checkpoint — after Task 8

- Date: 2026-10-01
- Branch: `phase/04b-native-implementation`
- Stable implementation head before checkpoint: `4852893f93b17490a90dcbb921100e5b906c81b4`
- Stable CI run: `36741594526`
- Stable CI conclusion: `success`
- Execution mode: Native / `superpowers:executing-plans`
- Independent AI reviewer: unavailable
- Product code scope completed: Tasks 1–8
- Next batch: Tasks 9–10 browser acceptance
- Phase 4C: not started

## Completed checkpoints

1. Task 1 — Phase 4B domain types, migration, and DB invariants.
2. Task 2 — ResearchTask workflow v2, semantic permissions, legacy upgrade.
3. Task 3 — immutable TaskSubmission, contributors, refs, requirement snapshot.
4. Task 4 — reviewer eligibility and reassignment.
5. Task 5 — ordinary review outcomes, completion provenance, cancellation.
6. Task 6 — Review → ScientificDecision escalation and terminal-resolution outbox handler.
7. Task 7 — Research Work read models, Review Inbox, restricted FileVersion-safe projection.
8. Task 8 — web server actions, Research Work UI, Review Inbox UI/navigation.

## Recovery rule

On every resume:

1. Read the real GitHub branch head and recent Actions first.
2. If the branch has advanced beyond this checkpoint, inspect the newer exact head and do not replay completed tasks.
3. Only repair the failure attached to the current exact head.
4. Do not chase obsolete failed SHAs after a newer successful head exists.
5. Distinguish test-fixture failures from product failures before changing production code.
6. Keep one RED/GREEN concern per small batch.
7. After a batch turns GREEN, record a new checkpoint before beginning the next risk class.
8. If a timeout/interruption occurs, resume from the first missing/failed checkpoint only.

## Interruption analysis

Repeated interruptions were amplified by three patterns:

- chat state lagged behind GitHub, causing already-completed Tasks to look unfinished;
- broad RED batches sometimes mixed fixture defects with real product gaps;
- multiple historical CI runs were inspected after the branch had already advanced.

The corrected strategy is exact-head-only, checkpoint-first, and minimal-delta repair.

## Task 7 note

The first Task 7 RED was blocked by an invalid AgentRun seed that violated the existing Phase 3 snapshot invariant. The fixture was fixed first. Only after the failure became a clean missing-`work-queries` RED was product code implemented.

Restricted FileVersion projection deliberately does not join `external_data_references`; locator/access-policy metadata is therefore absent from the 4B read-model query surface rather than fetched and redacted later.

## Task 9–10 entry criteria

Begin browser acceptance only after this checkpoint commit itself has exact-head CI success.

Task 9 scenarios 1–5:
- pure-text human submission + unreviewed completion
- required review blocks completion
- approve completes task
- request changes preserves old cycles and creates Submission #2 / Review #2
- contributor cannot self-review

Task 10 scenarios 6–9:
- hybrid human + AgentRun provenance
- Review escalation keeps ScientificDecision governance separate
- restricted FileVersion remains redacted/authorized
- reopen preserves prior accepted history and creates a new submission cycle

## Drive sync

Checkpoint content is suitable for Drive sync because it contains only implementation state, commit/run identifiers, and recovery instructions; it must not include credentials, raw research content, restricted locators, or test secrets.

Drive sync is currently deferred because two Drive accounts are connected and neither has an existing `research-workbench` target, so the intended destination account cannot be inferred safely. This does not block GitHub execution.
