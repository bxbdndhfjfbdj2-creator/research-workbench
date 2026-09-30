# Phase 4B Native Execution Checkpoint — after Task 11

- Date: 2026-10-01
- Branch: `phase/04b-native-implementation`
- Stable implementation head before checkpoint: `38b0469b0ea5fd7fdc5004ae6e2883a5c60dd9c7`
- Stable CI run: `36767609849`
- Stable CI conclusion: `success`
- Execution mode: Native / `superpowers:executing-plans`
- Independent AI reviewer: unavailable
- Product-code scope completed: Tasks 1–11
- Next batch: Task 12 final verification/review/record/Draft PR
- Phase 4C: not started

## Completed since Task 10 checkpoint

- Task 11 security/concurrency regression hardening completed at `b2788c46f01b45723c3d00e2e4a76ea933ee27ac`, CI `36765488194` success.
- Additional invariant gap found after Task 11: a completed task that was reopened could otherwise reuse the previously accepted latest Submission to complete again without a new Submission.
- RED: `e845053aaeae68fb84a11f9e20faf17c3035d0bf`, CI `36767321352` failure.
- GREEN: `38b0469b0ea5fd7fdc5004ae6e2883a5c60dd9c7`, CI `36767609849` success.
- The repair requires a new formal Submission after every reopen before unreviewed completion can succeed; prior completion/accepted-submission provenance remains historical fact.

## Stable completed scope

Tasks 1–11 are complete:

1. schema/domain invariants
2. ResearchTask workflow v2 and legacy upgrade
3. immutable TaskSubmission/provenance
4. reviewer eligibility/reassignment
5. ordinary review/completion/cancellation
6. Review → ScientificDecision escalation + terminal-resolution outbox
7. Research Work read models + restricted-file-safe projection
8. server actions + Research Work/Review Inbox UI
9. browser scenarios 1–5
10. browser scenarios 6–9
11. concurrency/secret/event/outbox hardening

## Recovery rule

On resume:

1. Re-read the real branch head and recent GitHub Actions.
2. If a newer exact head has success, never replay this checkpoint's completed work.
3. Task 12 is the only remaining planned task.
4. During Task 12, keep the implementation tree stationary while collecting final verification evidence.
5. If final review finds a defect, create a focused RED → minimal GREEN pair, establish a new stable implementation checkpoint, then restart only Task 12 verification.
6. Do not begin Phase 4C and do not merge Draft PRs.

## Interruption strategy

The recurring interruption problem is treated as state-recovery, not as an implementation restart:

- GitHub exact head is authoritative.
- Checkpoint docs preserve the last known-good boundary.
- Historical failed runs are diagnostic only once a newer success exists.
- Test-fixture defects are corrected before production code.
- One risk class per batch.
- Timeouts resume from the first missing checkpoint only.

## Drive sync

This checkpoint contains no credentials, raw research content, restricted locators, or test secrets and is safe to mirror to Drive.

Drive synchronization remains deferred because two Drive accounts are connected and neither has an existing `research-workbench` target, so the intended account cannot be inferred safely. This is a non-blocking documentation sync gap; it does not invalidate GitHub checkpoints or CI evidence.
