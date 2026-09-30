# Phase 4B Native Execution Checkpoint — after Task 10

- Date: 2026-10-01
- Branch: `phase/04b-native-implementation`
- Stable implementation head before checkpoint: `6581fc3129136aa8e6a929d19a1b51618360f24c`
- Stable CI run: `36758869285`
- Stable CI conclusion: `success`
- Full browser acceptance: **29 passed (5.4m)**
- Phase 4B browser scenarios: **9/9 green**
- Product scope completed: Tasks 1–10
- Next batch: Task 11 concurrency/secret-safety regression hardening
- Phase 4C: not started

## Task 10 scenarios now green

6. hybrid task preserves human + completed AgentRun provenance; completed AgentRun does not auto-complete the ResearchTask.
7. ordinary Review escalation creates a ScientificDecision; non-terminal governance does not resume Review, terminal approval resumes ordinary Review to `pending`, and final task completion still requires the assigned reviewer to approve.
8. restricted FileVersion provenance is visible only as safe title/version/access-class metadata in 4B task history; locator and access-policy metadata are absent from the 4B query surface.
9. reopening a completed task preserves the accepted first Submission/Review and creates a fresh Submission #2 / Review #2 cycle.

The escalation acceptance path uses the production `createReviewResolutionOutboxHandler` and targets only the relevant `scientific.decision.reviewed` outbox rows in the acceptance controller. It does not directly mutate Review state.

## Failure analysis and repair

Initial Task 10 candidate `4e5f0856ba3aa6876df8886892f0cfa924304b83` failed before the new Phase 4B scenarios ran.

The failure was fixture pollution, not a product defect:

- a restricted FileVersion fixture had been added to shared `seedBusinessData()`;
- `startFileAcceptanceEnvironment()` therefore started Phase 4A browser tests with a pre-existing file;
- the old first Phase 4A test's strict heading locator then matched both the page heading and a file-list section heading.

Fix `6581fc3129136aa8e6a929d19a1b51618360f24c` made the restricted fixture an explicit `workReviewFixtures` opt-in used only by the Phase 4B acceptance suite. Existing file acceptance semantics were left unchanged.

## Recovery rule

On resume:

1. verify the real branch head and recent Actions;
2. treat this checkpoint as the completed Tasks 1–10 baseline once this checkpoint commit itself is green;
3. do not replay Task 10 browser work after a newer successful exact head exists;
4. repair only the current exact-head failure;
5. keep Task 11 separate from browser acceptance work.

## Drive sync status

Drive sync remains deferred because two Drive accounts are connected and search did not identify a unique Research Workbench/Phase 4B project target. Search hits belonged to unrelated research projects. GitHub remains the authoritative engineering checkpoint; later Drive synchronization should copy checkpoint records only and must not trigger re-execution.
