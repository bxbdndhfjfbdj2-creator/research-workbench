# Phase 5 — GitHub Engineering Truth Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, auditable GitHub engineering-truth plane so Research Workbench can resolve claimed GitHub provenance, deterministically verify exact commits against versioned policy, recover from webhook/API failures, and project current engineering attention without letting CI alter scientific state.

**Architecture:** Keep GitHub authoritative. Workbench persists untrusted `EngineeringVerificationTarget`s, GitHub-confirmed `GitHubReference`s, immutable verification-policy revisions, and a rebuildable `EngineeringVerification` projection. GitHub webhooks only request reconciliation through the existing `IntegrationInbox`/worker infrastructure; authoritative adapter reads plus a pure evaluator decide current verification state. Existing ResearchResult, ResearchTask, AgentRun, Review, ScientificDecision, and Phase 4C semantics remain authoritative in their own domains.

**Tech Stack:** TypeScript, Node >=22.19, pnpm 11.7, PostgreSQL 16, Drizzle schema + ordered SQL migrations, Next.js 15 Server Actions/Route Handlers, Vitest/Testcontainers, Playwright, pg-boss, `@octokit/app@16.1.4` pinned in `packages/github-adapter`.

**Spec:** `docs/superpowers/specs/2026-10-02-phase-05-github-engineering-truth-design.md`

## Global Constraints

- GitHub is authoritative engineering truth; Workbench must not mirror repository content, diffs, PR discussion, workflow logs, or raw webhook payloads.
- `EngineeringVerificationTarget` is untrusted Workbench-side input; `GitHubReference` is created only after authoritative GitHub resolution.
- ResearchResult git provenance remains immutable and distinct from engineering verification.
- Agent `github_hint` remains untrusted; generic `{ kind, value }` hints never directly create `verified` state.
- Phase 5 does not grant Agent GitHub write, push, PR-merge, policy, or force-verify authority.
- `verified` never completes ResearchTask, changes AgentRun state, approves Review, or approves ScientificDecision.
- GitHub timeout/5xx/429/auth-unavailable maps to `unknown`, never guessed success/failure.
- A commit is `verified` only for an exact-head merged PR to the active policy branch, a non-empty required-check policy, and current matching required evidence whose conclusion is exactly `success`.
- `skipped`, `neutral`, `cancelled`, `timed_out`, `stale`, and `action_required` are not PASS.
- Workbench Verification Policy is immutable/versioned; GitHub ruleset/branch-protection observations do not silently mutate it.
- Webhooks are reconcile hints only and must be signature-verified before normalized Inbox persistence.
- Duplicate, out-of-order, delayed, or missing webhooks must converge through authoritative reconciliation.
- Existing `/projects/[projectId]/evidence` remains the canonical project surface; do not add top-level navigation.
- Phase 4C may consume persisted verification facts only; cockpit rendering must never call GitHub.
- Conditional real GitHub checks report PASS/SKIP/FAIL truthfully; SKIP is never PASS.
- Existing Phase 1–4C browser acceptance and real tusd + SeaweedFS regression remain green.
- Implementation mode is Native / `superpowers:executing-plans`; independent AI reviewer is unavailable and must not be claimed.

## Review Focus

1. **Repository rename / old full-name provenance:** an old `owner/repo` locator that GitHub redirects to the same stable repository ID must reuse the existing binding instead of becoming `repository_not_bound`. Task 6 integration tests pin this.
2. **Conflicting status evidence:** two current observations with the same required context must never pass merely because one is `success`; policy source/workflow/event selection and conflict handling are pinned in Task 2.
3. **Webhook duplicate/order/loss:** delivery order must not become a state machine; duplicate/乱序/丢失 cases are pinned in Tasks 5–6.
4. **ResearchResult transaction during GitHub outage:** formal result creation must commit before external reconciliation and retain immutable provenance; Task 7 pins this.
5. **Current-scope cockpit deduplication:** one verification linked to Result + Task + AgentRun must render one project-attention item, and obsolete/superseded-only verification must disappear; Task 9 pins this.

---

### Task 1: Add the GitHub engineering domain and persistence model

**Files:**
- Create: `packages/domain/src/github-engineering.ts`
- Create: `packages/db/src/schema/github-engineering.ts`
- Create: `packages/db/migrations/0003_github_engineering_truth.sql`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `tests/integration/db-foundation.test.ts`
- Create: `tests/integration/github-engineering-schema.test.ts`

**Interfaces:**
- Produces domain constants/types: `ENGINEERING_VERIFICATION_STATES`, `ENGINEERING_VERIFICATION_REASON_CODES`, `GITHUB_REFERENCE_TYPES`, `EngineeringVerificationState`, `EngineeringVerificationReasonCode`, `GitHubReferenceType`.
- Produces tables for `github_installations`, `project_github_repository_bindings`, `github_verification_policy_revisions`, `github_verification_policy_required_checks`, `engineering_verification_targets`, `github_references`, six explicit subject-link tables (target + confirmed-reference links for ResearchResult/AgentRun/ResearchTask), and `engineering_verifications`.
- Later tasks rely on `engineering_verifications.target_id` being unique and on optional `repository_binding_id`, `commit_reference_id`, `pull_request_reference_id`, `policy_revision_id`.

- [ ] **Step 1: Write failing schema/invariant tests**

Add tests asserting:
- Phase 5 tables exist after `initializeFoundationDatabase()`.
- `(provider, external_id)` Inbox uniqueness remains intact.
- `engineering_verification_targets` dedupe on `(project_id, claimed_repository_full_name, commit_sha)`.
- `github_references` dedupe on `(repository_binding_id, type, external_id)`.
- Subject link FKs reject orphan Result/Run/Task references.
- Policy revisions cannot be updated/deleted after creation; required-check rows are append-only with their revision.
- Repository bindings are retired, not deleted once referenced.
- verification state/reason checks reject unknown values.

- [ ] **Step 2: Run the schema tests and verify RED**

Run: `pnpm vitest run tests/integration/db-foundation.test.ts tests/integration/github-engineering-schema.test.ts`

Expected: FAIL because Phase 5 schema/migration/domain definitions do not exist.

- [ ] **Step 3: Implement domain constants, Drizzle schema, and migration**

Use the spec names exactly. Keep `claimed_repository_full_name` immutable on Target. Store stable GitHub repository ID on binding separately from current `repository_full_name`. Use real FKs for all explicit subject links; do not introduce generic `subject_type/subject_id` tables.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run tests/integration/db-foundation.test.ts tests/integration/github-engineering-schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/github-engineering.ts packages/db/src/schema/github-engineering.ts packages/db/src/schema/index.ts packages/db/migrations/0003_github_engineering_truth.sql tests/integration/db-foundation.test.ts tests/integration/github-engineering-schema.test.ts
git commit -m "feat: add GitHub engineering truth schema"
```

---

### Task 2: Implement the pure verification evaluator

**Files:**
- Create: `packages/application/src/github/verification-types.ts`
- Create: `packages/application/src/github/verification-evaluator.ts`
- Create: `packages/application/src/github/verification-evaluator.test.ts`

**Interfaces:**
- Produces `evaluateEngineeringVerification(input: EngineeringVerificationInput): EngineeringVerificationDecision`.
- `EngineeringVerificationInput` contains repository/binding facts, exact target SHA, qualifying PR candidates, immutable policy revision, and normalized current check/status observations; it performs no DB/network I/O.
- `EngineeringVerificationDecision` returns only `{ state, reasonCode, selectedPullRequestExternalId }` plus safe deterministic evidence identifiers needed by Task 6 persistence.

- [ ] **Step 1: Write the complete RED decision-table tests**

Pin all spec cases:
- repository-not-bound; commit-not-found;
- no PR/open PR/closed-not-merged/wrong branch;
- historical PR commit != exact merged PR head;
- zero required checks; missing check;
- queued/requested/waiting/pending/in-progress -> `pending_ci`;
- failure/cancelled/timed_out/skipped/neutral/stale/action_required -> `failed` with exact reason;
- latest attempt supersedes older attempt;
- workflow/event/integration selectors exclude same-context evidence from the wrong source;
- unresolved current same-context conflict -> `required_check_conflict`;
- Check Run + legacy Commit Status for the same required context must both satisfy current policy;
- all current required evidence exactly `completed/success` -> `verified`.

Include a regression matching the repository-observed shape: same SHA and context `quality`, one success and one failure, distinguished only by source/workflow/event identity; the evaluator must never choose success by existence.

- [ ] **Step 2: Run evaluator tests and verify RED**

Run: `pnpm vitest run packages/application/src/github/verification-evaluator.test.ts`

Expected: FAIL because evaluator files are absent.

- [ ] **Step 3: Implement evaluator and stable normalized types**

Keep selection deterministic: exact SHA, exact PR head, matching base branch, then source/workflow/event selector, then latest attempt. If current attempt cannot be determined safely, return `unknown` rather than guessing.

- [ ] **Step 4: Re-run evaluator tests**

Run: `pnpm vitest run packages/application/src/github/verification-evaluator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/github/verification-types.ts packages/application/src/github/verification-evaluator.ts packages/application/src/github/verification-evaluator.test.ts
git commit -m "feat: evaluate GitHub engineering verification"
```

---

### Task 3: Add the GitHub App adapter, fake adapter, and secret-safe configuration

**Files:**
- Create: `packages/github-adapter/package.json`
- Create: `packages/github-adapter/src/types.ts`
- Create: `packages/github-adapter/src/adapter.ts`
- Create: `packages/github-adapter/src/rest-adapter.ts`
- Create: `packages/github-adapter/src/fake-adapter.ts`
- Create: `packages/github-adapter/src/rest-adapter.test.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `GitHubEngineeringAdapter` with:
  - `getRepository(locator): Promise<GitHubRepositoryFact>`
  - `getCommit(binding, sha): Promise<GitHubCommitFact | null>`
  - `listPullRequestsForCommit(binding, sha): Promise<GitHubPullRequestFact[]>`
  - `getChecksForCommit(binding, sha): Promise<GitHubCheckFact[]>`
  - `getGovernanceObservation(binding, branch): Promise<GitHubGovernanceObservation>`
- Produces typed integration failures: `not_found`, `auth_unavailable`, `installation_suspended`, `rate_limited`, `temporarily_unavailable`.
- Produces `FakeGitHubEngineeringAdapter` with scripted authoritative state for deterministic tests.
- `loadGitHubIntegrationConfig(env)` returns non-secret settings plus `SecretRef`s for `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET`; actual secret strings enter only runtime constructors.

- [ ] **Step 1: Add RED adapter/config tests**

Assert:
- config serializes env key references, never private-key/webhook-secret values;
- repository facts expose stable repository ID + current full name;
- REST responses normalize commit/PR/check/status facts and do not leak raw Octokit response objects;
- 404 commit becomes `null`, while 429/5xx/auth errors become typed failures;
- repository rename/redirect returns the stable repository ID and current full name;
- fake adapter can switch current authoritative facts without changing evaluator code.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run packages/config/src/env.test.ts packages/github-adapter/src/rest-adapter.test.ts`

Expected: FAIL because adapter/config do not exist.

- [ ] **Step 3: Add `@octokit/app@16.1.4` and implement adapters/config**

Keep the existing repository-wide TypeScript `moduleResolution: "Bundler"`; do not perform a global tsconfig migration unless the focused TypeScript check proves this pinned package cannot resolve. Do not store installation access tokens in config or DB.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm vitest run packages/config/src/env.test.ts packages/github-adapter/src/rest-adapter.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/github-adapter packages/config/src/env.ts packages/config/src/env.test.ts pnpm-lock.yaml
git commit -m "feat: add GitHub App engineering adapter"
```

---

### Task 4: Add repository binding, immutable policy, target, and manual reconcile application services

**Files:**
- Create: `packages/application/src/github/repository-binding-service.ts`
- Create: `packages/application/src/github/verification-policy-service.ts`
- Create: `packages/application/src/github/verification-target-service.ts`
- Create: `packages/application/src/github/reconcile-request-service.ts`
- Create: `tests/integration/github-engineering-services.test.ts`

**Interfaces:**
- Produces `bindProjectGitHubRepository(sql, adapter, projectId, repositoryFullName, installationId, actor)`.
- Produces `retireProjectGitHubRepositoryBinding(sql, bindingId, actor)`.
- Produces `createVerificationPolicyRevision(sql, bindingId, input, actor)` and `activateVerificationPolicyRevision(sql, bindingId, revisionId, actor)`.
- Produces `ensureEngineeringVerificationTarget(sql, projectId, repositoryFullName, commitSha)` returning a shared target/verification pair.
- Produces `requestEngineeringReconcile(sql, verificationId, actor)` that only advances `reconcileRequestedAt`/due state; it never changes verification state.

- [ ] **Step 1: Write RED integration tests**

Pin:
- only Project Lead / Organization Lead may bind/retire repo, activate policy, or request manual reconcile;
- repository bind performs an authoritative adapter lookup and stores stable repository ID/current full name;
- binding to an unresolvable repo fails without creating a partial binding;
- policy revision is immutable and activation schedules all binding verifications for reconcile;
- zero required checks may be persisted as a revision but will evaluate as failure, never implicit success;
- Target normalization validates owner/name + immutable full SHA and dedupes across subjects;
- manual reconcile changes only operational scheduling fields.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run tests/integration/github-engineering-services.test.ts`

Expected: FAIL because services are absent.

- [ ] **Step 3: Implement services using existing authorization and transaction helpers**

Do not add GitHub-specific human roles. Repository binding is the only synchronous GitHub authoritative read in this task; no page-render query may call GitHub.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run tests/integration/github-engineering-services.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/github tests/integration/github-engineering-services.test.ts
git commit -m "feat: manage GitHub bindings and verification policy"
```

---

### Task 5: Make GitHub webhook ingress and IntegrationInbox reliable

**Files:**
- Modify: `packages/db/src/schema/integration-inbox.ts`
- Modify: `packages/db/migrations/0003_github_engineering_truth.sql`
- Modify: `packages/queue/src/inbox.ts`
- Create: `packages/queue/src/inbox-dispatcher.ts`
- Create: `packages/queue/src/inbox-dispatcher.test.ts`
- Create: `apps/web/src/server/github-webhook.ts`
- Create: `apps/web/app/api/integrations/github/webhook/route.ts`
- Create: `apps/web/app/api/integrations/github/webhook/route.test.ts`

**Interfaces:**
- Extends Inbox operational fields to `status`, `attempts`, `availableAt`, `claimedAt`, `processedAt`, `lastErrorCode` while preserving `(provider, external_id)` uniqueness.
- Produces `verifyGitHubWebhookSignature(rawBody: Uint8Array, signature: string, secret: string): boolean` using HMAC-SHA256 and timing-safe comparison.
- Produces `normalizeGitHubWebhookEnvelope(headers, parsedPayload): GitHubWebhookEnvelope` with only delivery/event/action/installation/repository and safe numeric IDs required to request reconciliation.
- Produces `claimInboxBatch`, `markInboxProcessed`, `markInboxFailed` using `FOR UPDATE SKIP LOCKED` and stale-claim recovery.

- [ ] **Step 1: Write RED signature/idempotency/claim tests**

Assert valid/invalid/missing signatures, body mutation failure, duplicate `X-GitHub-Delivery` idempotency, normalized payload excludes PR body/review text/raw JSON, concurrent claims cannot claim the same row, and a stale processing claim is reclaimable.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run packages/queue/src/inbox-dispatcher.test.ts apps/web/app/api/integrations/github/webhook/route.test.ts tests/integration/db-foundation.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement route and Inbox reliability**

Verify the HMAC against raw request bytes before JSON normalization/persistence. Return 2xx for duplicate authenticated deliveries, but never create duplicate reconcile work.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run packages/queue/src/inbox-dispatcher.test.ts apps/web/app/api/integrations/github/webhook/route.test.ts tests/integration/db-foundation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/integration-inbox.ts packages/db/migrations/0003_github_engineering_truth.sql packages/queue/src/inbox.ts packages/queue/src/inbox-dispatcher.ts packages/queue/src/inbox-dispatcher.test.ts apps/web/src/server/github-webhook.ts apps/web/app/api/integrations/github/webhook
git commit -m "feat: ingest GitHub webhooks reliably"
```

---

### Task 6: Implement authoritative reconciliation and worker recovery

**Files:**
- Create: `packages/application/src/github/reconcile-engineering-verification.ts`
- Create: `packages/application/src/github/reconcile-engineering-verification.test.ts`
- Create: `packages/application/src/github/github-inbox-processor.ts`
- Create: `packages/application/src/github/github-inbox-processor.test.ts`
- Create: `apps/worker/src/github-runtime.ts`
- Create: `apps/worker/src/github-runtime.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`

**Interfaces:**
- Produces `reconcileEngineeringVerification(sql, adapter, verificationId, now): Promise<EngineeringVerificationState>`.
- Produces `processGitHubInboxRecord(sql, envelope): Promise<void>` that only marks affected verifications due; webhook action/order never directly sets state.
- Produces worker passes for Inbox and due Verification claims with safe retry scheduling.

- [ ] **Step 1: Write RED reconciliation tests**

Pin:
- full read order: binding/installation -> repository identity -> commit -> PR candidates -> active policy -> checks/statuses -> evaluator;
- duplicate and out-of-order webhook sequences converge to the adapter's current facts;
- no webhook + periodic due reconcile still converges;
- 429 respects retry-after/reset when setting `nextReconcileAt`;
- timeout/5xx/auth -> `unknown` with safe reason;
- verified -> unknown -> verified is legal and appends safe `ENGINEERING_VERIFICATION_CHANGED` events;
- repository rename: old target full-name redirect resolving to the same stable repository ID reuses the existing binding and updates only observed binding full name;
- one current verification is shared across linked subjects;
- no ResearchTask/Review/ScientificDecision/AgentRun/ResearchResult immutable columns change during reconcile.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run packages/application/src/github/reconcile-engineering-verification.test.ts packages/application/src/github/github-inbox-processor.test.ts apps/worker/src/github-runtime.test.ts apps/worker/src/main.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement reconcile and worker composition**

Use current DB facts every time; do not transition from webhook payload state. Coalesce webhook storms by advancing `reconcileRequestedAt`, not by creating one permanent job per event. Keep current verification mutable/rebuildable and audit transitions append-only.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run packages/application/src/github/reconcile-engineering-verification.test.ts packages/application/src/github/github-inbox-processor.test.ts apps/worker/src/github-runtime.test.ts apps/worker/src/main.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/github apps/worker/src/github-runtime.ts apps/worker/src/github-runtime.test.ts apps/worker/src/main.ts apps/worker/src/main.test.ts
git commit -m "feat: reconcile GitHub engineering truth"
```

---

### Task 7: Link ResearchResult, Agent hints, and ResearchTask to engineering targets/references

**Files:**
- Create: `packages/application/src/github/subject-link-service.ts`
- Create: `packages/application/src/github/result-engineering-outbox.ts`
- Create: `packages/application/src/github/agent-hint-resolution.ts`
- Create: `tests/integration/github-subject-linking.test.ts`
- Modify: `apps/worker/src/main.ts`
- Modify: `apps/worker/src/main.test.ts`

**Interfaces:**
- Produces `linkResearchResultEngineeringTarget`, `linkAgentRunEngineeringTarget`, `linkResearchTaskEngineeringTarget` and confirmed-reference counterparts, all FK-safe/idempotent.
- Produces an Outbox handler for existing `research.result.created` that re-reads immutable provenance, creates/reuses Target, links it, and requests reconcile.
- Produces `resolveAgentGitHubHints(sql, adapter, runId)` that preserves raw `github_hint` artifacts, resolves supported kinds authoritatively, creates confirmed reference only when confirmed, and creates a Target only when resolution yields a verification commit locator.

- [ ] **Step 1: Write RED integration tests**

Pin:
- creating a code ResearchResult while adapter is unavailable still commits the ResearchResult transaction and immutable locator;
- processing its Outbox later creates Target/link and yields unknown/retry rather than rolling back the result;
- wrong/unbound repo keeps the original ResearchResult locator and produces unverified `repository_not_bound`;
- malformed/unresolvable Agent hint remains as artifact and creates no Target/reference;
- PR/branch/workflow hint can create a confirmed non-commit reference and then a Target only if authoritative resolution yields a commit locator;
- Agent text such as “CI passed” never changes verification state;
- the same target linked to Result + Run + Task still has one Verification row.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run tests/integration/github-subject-linking.test.ts apps/worker/src/main.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement subject linking and handlers**

Reuse existing Outbox composition. Do not add GitHub network calls to `createResearchResult()` or its transaction.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run tests/integration/github-subject-linking.test.ts apps/worker/src/main.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/github apps/worker/src/main.ts apps/worker/src/main.test.ts tests/integration/github-subject-linking.test.ts
git commit -m "feat: link research work to GitHub evidence"
```

---

### Task 8: Add the canonical Engineering Evidence UI and project actions

**Files:**
- Create: `packages/application/src/github/engineering-evidence-query.ts`
- Create: `packages/application/src/github/engineering-evidence-query.test.ts`
- Create: `apps/web/src/server/github-queries.ts`
- Create: `apps/web/src/server/github-actions.ts`
- Create: `apps/web/src/server/github-runtime.ts`
- Create: `apps/web/src/components/github/engineering-evidence-view.tsx`
- Modify: `apps/web/app/(app)/projects/[projectId]/evidence/page.tsx`
- Modify: `apps/web/src/components/research-graph/evidence-results-view.tsx`
- Modify: `apps/web/src/server/queries.ts`
- Modify: `apps/web/src/components/agent-runs/agent-task-list.tsx`
- Modify: `apps/web/src/components/research-work/research-task-detail.tsx`

**Interfaces:**
- Produces safe project evidence DTOs for bindings, active/old policy revisions, target/verification chains, and subject links. DTOs contain safe GitHub URLs/IDs/status metadata only—no raw webhook/error/log payload.
- Server Actions: `bindGitHubRepositoryAction`, `retireGitHubRepositoryBindingAction`, `createAndActivateVerificationPolicyAction`, `requestEngineeringReconcileAction`.
- `apps/web/src/server/github-runtime.ts` creates the real adapter in production and allows a deterministic fake runtime only when `NODE_ENV !== "production"`; acceptance uses this seam.

- [ ] **Step 1: Write RED query/component/action tests**

Assert reader vs Project/Organization Lead permissions; provenance and verification render separately; Agent hints and confirmed references render separately; no force-verify control; manual reconcile only schedules; old policy revisions remain visible/read-only; restricted/raw GitHub payload fields are absent from DTOs.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm vitest run packages/application/src/github/engineering-evidence-query.test.ts apps/web/src/server/github-actions.test.ts`

Expected: FAIL; create `apps/web/src/server/github-actions.test.ts` with this step.

- [ ] **Step 3: Implement query/UI/actions**

Keep `/projects/[projectId]/evidence` as the canonical page and preserve existing ResearchResult evidence content. No repository browser, diff viewer, workflow-log mirror, or new top-level nav.

- [ ] **Step 4: Re-run focused tests and web build**

Run: `pnpm vitest run packages/application/src/github/engineering-evidence-query.test.ts apps/web/src/server/github-actions.test.ts && pnpm --filter @research-workbench/web build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/github/engineering-evidence-query.ts packages/application/src/github/engineering-evidence-query.test.ts apps/web/src/server/github-queries.ts apps/web/src/server/github-actions.ts apps/web/src/server/github-actions.test.ts apps/web/src/server/github-runtime.ts apps/web/src/components/github apps/web/app/\(app\)/projects/\[projectId\]/evidence/page.tsx apps/web/src/components/research-graph/evidence-results-view.tsx apps/web/src/server/queries.ts apps/web/src/components/agent-runs/agent-task-list.tsx apps/web/src/components/research-work/research-task-detail.tsx
git commit -m "feat: show GitHub engineering evidence"
```

---

### Task 9: Project engineering verification into Phase 4C cockpit safely

**Files:**
- Modify: `packages/application/src/projections/cockpit-types.ts`
- Modify: `packages/application/src/projections/cockpit-current-query.ts`
- Modify: `packages/application/src/projections/cockpit-classification.ts`
- Modify: `packages/application/src/projections/cockpit-classification.test.ts`
- Modify: `packages/application/src/projections/cockpit-activity-query.ts`
- Modify: `packages/application/src/projections/cockpit-query-service.ts`
- Modify: `packages/application/src/projections/cockpit-query-service.test.ts`
- Modify: `apps/web/src/components/cockpit/cockpit-sections.tsx` if present; otherwise modify the existing component that currently renders `project-attention` / recent activity.

**Interfaces:**
- Adds `engineering_verification_attention` to `AttentionKind` and `ENGINEERING_VERIFICATION_CHANGED` to the curated activity allowlist.
- Current facts expose only safe fields: verification/target IDs, repository full name, short-able commit SHA, current state, safe reason, timestamps, canonical evidence href, and current-scope linkage flags.

- [ ] **Step 1: Write RED classifier/query tests**

Pin:
- `unverified`, `failed`, `unknown` -> one project attention item;
- `awaiting_pr`, `pending_ci`, `verified` -> no engineering attention;
- never enters `myActions` because there is no engineering assignee model;
- Result + Task + latest AgentRun links to one verification -> one item keyed by verification/target;
- superseded-only Result or obsolete AgentRun without other current links -> no current attention;
- transition to verified removes attention but remains eligible for curated Recent Activity;
- cockpit query performs DB reads only and never receives an adapter.

- [ ] **Step 2: Run Phase 4C focused tests and verify RED**

Run: `pnpm vitest run packages/application/src/projections/cockpit-classification.test.ts packages/application/src/projections/cockpit-query-service.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement safe current-fact loading, classification, and curated activity**

Do not expose full SHA/event payload beyond the safe DTO requirements; use the canonical evidence page href for drill-down.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run packages/application/src/projections/cockpit-classification.test.ts packages/application/src/projections/cockpit-query-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/projections apps/web/src/components/cockpit
git commit -m "feat: project GitHub verification into cockpit"
```

---

### Task 10: Add deterministic browser acceptance and conditional real GitHub smoke

**Files:**
- Create: `tests/acceptance/github-engineering-truth.spec.ts`
- Create: `tests/acceptance/support/github-engineering.ts`
- Modify: `tests/acceptance/support/environment.ts`
- Modify: `package.json`
- Create: `tests/integration/github-real-smoke.test.ts`
- Create: `tests/integration/github-webhook-real-smoke.test.ts`

**Interfaces:**
- Acceptance controller exposes deterministic fake authoritative state changes without direct DB mutation of verification state; it changes fake GitHub facts, then invokes the same reconcile path as production.
- Fake web runtime is test/development-only and must throw if configured in production.
- Real REST smoke consumes configured `GITHUB_SMOKE_REPOSITORY`, `GITHUB_SMOKE_COMMIT_SHA`, optional `GITHUB_SMOKE_PR_NUMBER`, plus GitHub App env secrets; absent prerequisites produce explicit SKIP.

- [ ] **Step 1: Add 12 RED Playwright scenarios from the spec**

Scenarios:
1. Project Lead binds repository; reader cannot mutate.
2. New policy revision activates while old revision remains read-only.
3. Code ResearchResult displays immutable provenance separately from verification.
4. Unbound repository shows `unverified` without changing locator.
5. Exact-head merged PR + required success -> `verified`.
6. Open PR + CI success -> `awaiting_pr`.
7. Required check pending -> `pending_ci`.
8. Required check failed or skipped -> `failed`; SKIP never PASS.
9. GitHub unavailable -> `unknown`, visibly distinct from failure.
10. Agent `github_hint` and confirmed reference display separately.
11. “重新验证” schedules reconcile only; state changes only after fake authoritative reconcile.
12. Cockpit shows one deduped project attention for failed/unverified/unknown and removes it after verified.

Also assert absence of force-verify, engineering progress %, AgentRun engineering score, automatic Task completion, and automatic ScientificDecision approval.

- [ ] **Step 2: Add real-smoke tests and update `pnpm acceptance`**

Real tests must report separate REST and webhook-delivery PASS/SKIP/FAIL semantics. No merge/push/ruleset/repository mutation is allowed.

- [ ] **Step 3: Run Phase 5 acceptance and smoke locally/CI-capable environment**

Run: `pnpm exec playwright test tests/acceptance/github-engineering-truth.spec.ts`

Expected: 12/12 PASS using fake authoritative GitHub facts.

Run: `pnpm vitest run tests/integration/github-real-smoke.test.ts tests/integration/github-webhook-real-smoke.test.ts`

Expected: PASS when configured; otherwise explicit SKIP with no success claim.

- [ ] **Step 4: Run the complete test/quality gate**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm acceptance
```

Expected: all deterministic checks PASS; existing Phase 1–4C acceptance remains green and real tusd + SeaweedFS regression remains green. Conditional external checks remain clearly PASS/SKIP/FAIL.

- [ ] **Step 5: Commit the stable product checkpoint**

```bash
git add tests/acceptance/github-engineering-truth.spec.ts tests/acceptance/support/github-engineering.ts tests/acceptance/support/environment.ts tests/integration/github-real-smoke.test.ts tests/integration/github-webhook-real-smoke.test.ts package.json
git commit -m "test: verify GitHub engineering truth acceptance"
```

---

### Task 11: Record Phase 5 verification and stop at the Draft human gate

**Files:**
- Create: `docs/superpowers/reviews/2026-10-03-phase-05-github-engineering-truth-verification.md`

**Interfaces:**
- Produces the authoritative Phase 5 verification record only after the stable product checkpoint passes the full deterministic gate.
- No product code changes belong in this task.

- [ ] **Step 1: Re-read the implementation branch exact head and its latest CI**

Confirm the stable product SHA, Draft PR status, all upstream Draft PR states, and exact PASS/SKIP counts. Do not use obsolete failed CI if a newer successful exact-head run exists.

- [ ] **Step 2: Perform coordinator/manual invariant review**

Record explicit checks for:
- GitHub remains authoritative; no GitHub mirror/raw payload storage;
- Target vs confirmed Reference trust boundary;
- no Agent GitHub write/merge/force-verify authority;
- no engineering-state writeback to Task/Review/Decision/AgentRun/ResearchResult immutable provenance;
- policy immutability and exact-head verification semantics;
- webhook signature/idempotency/recovery;
- secret safety;
- cockpit DB-only consumption/current-scope dedupe;
- `independent AI reviewer: unavailable`.

- [ ] **Step 3: Write the verification record with exact evidence**

Include approved spec/plan, implementation branch/head, exact `pnpm test` file/test counts, exact Playwright total and Phase 5 12/12 count, GitHub REST smoke status, webhook-delivery smoke status, all pre-existing conditional service/provider SKIPs, known limitations (including merge queue v1 fail-closed), and Draft/human-gate status.

- [ ] **Step 4: Commit the verification record**

```bash
git add docs/superpowers/reviews/2026-10-03-phase-05-github-engineering-truth-verification.md
git commit -m "docs: record phase five verification"
```

- [ ] **Step 5: Require fresh CI on the verification-record exact head**

Do not reuse stable-product CI because the head changed. The workflow containing the verification record must complete successfully at that exact SHA.

- [ ] **Step 6: Stop at the human gate**

Leave the implementation PR Draft/open/unmerged. Do not mark ready, merge, enable auto-merge, or modify upstream Phase 3/4A/4B/4C Draft PR states.

---

## Self-Review Notes

- **Spec coverage:** all approved sections are owned by a task: model/constraints (1), deterministic policy (2), GitHub App/secret boundary (3), binding/policy/target authorization (4), webhook/Inbox (5), reconciliation/recovery (6), Result/Agent/Task linkage (7), canonical Evidence UI (8), Phase 4C projection (9), browser/real smoke (10), exact-head verification/human gate (11).
- **Step granularity:** every task starts with RED tests, has a focused implementation boundary, reruns only its owning tests, and ends with one meaningful checkpoint commit.
- **Type consistency:** the persistence anchor is always `EngineeringVerificationTarget`; `GitHubReference` remains confirmed-only. `EngineeringVerification` is unique per target and may have null binding/commit/PR/policy refs until authoritative resolution.
- **Review Focus:** repository rename is pinned in Task 6; conflicting status evidence in Task 2; webhook duplicate/order/loss in Tasks 5–6; ResearchResult outage boundary in Task 7; cockpit dedupe/current-scope in Task 9.
- **Proportion/YAGNI:** no repository browser, PR/diff/log mirror, merge-queue implementation, engineering score, custom engineering assignee model, or Agent GitHub write path is introduced.

## Execution Handoff

Implementation method is already fixed by the project workflow: **Native / `superpowers:executing-plans`**. Do not begin implementation until this written plan is explicitly approved. After approval, start from the exact approved plan head, create a separate implementation branch, and execute Tasks 1–11 sequentially with fresh exact-head verification between risk-class checkpoints.