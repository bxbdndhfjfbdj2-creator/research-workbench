# Phase 4B Native Execution Checkpoint — after Task 9

- Date: 2026-10-01
- Branch: `phase/04b-native-implementation`
- Stable implementation head before checkpoint: `93b5c9d48002c5b9b9fd510dd90d1b6c946efc48`
- Stable CI run: `36746958011`
- Stable CI conclusion: `success`
- Browser acceptance: **25 passed (3.8m)**
- Product scope completed: Tasks 1–9
- Next batch: Task 10 browser acceptance scenarios 6–9
- Phase 4C: not started

## Task 9 acceptance now green

The Phase 4B acceptance suite covers:

1. pure-text human submission followed by explicit unreviewed completion;
2. required review enters `awaiting_review` and cannot be bypassed by the owner;
3. assigned reviewer approval completes the task while preserving immutable submission history;
4. `request_changes` preserves Submission #1 / Review #1 and allows Submission #2 / Review #2;
5. contributor/owner cannot self-review while the explicitly assigned reviewer can.

The Phase 4B spec is included in the full `pnpm acceptance` command, so these scenarios run together with the existing Phase 1–4A browser coverage.

## RED → GREEN finding

Initial Task 9 candidate `66759ce4bac99fe8230eaab02da608ee57279dc8` failed only the first Phase 4B browser scenario. Existing browser scenarios remained green.

Root cause was a real UI/form contract bug rather than a Playwright race:

- `refKind` defaulted to empty;
- `refId` defaulted to empty;
- `refRelation` incorrectly defaulted to `source`;
- the server correctly rejected this as a partially specified submission reference.

Fix `93b5c9d48002c5b9b9fd510dd90d1b6c946efc48` changed the UI relation default to empty and retained the server's fail-closed validation. Pure-text submissions now send all three reference fields empty.

## Recovery rule

On resume, verify the real branch head and recent Actions first.

- If a newer exact head is successful, do not replay Task 9.
- If a newer head failed, repair only that head's current failure.
- Historical failed run `36745718558` is superseded by successful run `36746958011`.
- Do not re-run or re-implement Tasks 1–9 solely because a conversation was interrupted.
- Keep Task 10 isolated from Task 11/security hardening.

## Drive sync status

This checkpoint is safe to mirror to Drive because it contains implementation state and CI evidence only.

Drive sync remains deferred: two Drive accounts are connected and neither has an existing `research-workbench` target, so the intended account cannot be inferred safely. GitHub remains the authoritative engineering checkpoint.
