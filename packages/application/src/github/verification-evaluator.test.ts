import { describe, expect, it } from "vitest";
import { evaluateEngineeringVerification } from "./verification-evaluator";
import type {
  EngineeringVerificationInput,
  GitHubCheckObservation,
  GitHubPullRequestFact,
  RequiredCheckPolicy,
} from "./verification-types";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

function policy(
  checks: RequiredCheckPolicy[] = [
    {
      context: "quality",
      integrationId: "github-actions",
      workflowId: "ci",
      acceptedEvents: ["pull_request"],
    },
  ],
) {
  return {
    revisionId: "policy-1",
    verificationBranch: "main",
    requiredChecks: checks,
  };
}

function mergedPr(
  overrides: Partial<GitHubPullRequestFact> = {},
): GitHubPullRequestFact {
  return {
    externalId: "42",
    headSha: SHA,
    baseBranch: "main",
    merged: true,
    mergedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function check(
  overrides: Partial<GitHubCheckObservation> = {},
): GitHubCheckObservation {
  return {
    context: "quality",
    sourceType: "check_run",
    integrationId: "github-actions",
    workflowId: "ci",
    workflowEvent: "pull_request",
    executionId: "run-100",
    attemptNumber: 1,
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function input(
  overrides: Partial<EngineeringVerificationInput> = {},
): EngineeringVerificationInput {
  return {
    repositoryBound: true,
    commitExists: true,
    targetSha: SHA,
    pullRequests: [mergedPr()],
    policy: policy(),
    checks: [check()],
    ...overrides,
  };
}

describe("evaluateEngineeringVerification", () => {
  it("fails closed when the claimed repository is not bound", () => {
    expect(
      evaluateEngineeringVerification(input({ repositoryBound: false })),
    ).toMatchObject({
      state: "unverified",
      reasonCode: "repository_not_bound",
      selectedPullRequestExternalId: null,
    });
  });

  it("distinguishes a confirmed missing commit from integration uncertainty", () => {
    expect(
      evaluateEngineeringVerification(input({ commitExists: false })),
    ).toMatchObject({
      state: "unverified",
      reasonCode: "commit_not_found",
    });
  });

  it.each([
    ["no PR", []],
    ["historical PR commit", [mergedPr({ headSha: OTHER_SHA })]],
    ["wrong target branch", [mergedPr({ baseBranch: "release" })]],
  ])("keeps %s in awaiting_pr", (_label, pullRequests) => {
    expect(
      evaluateEngineeringVerification(input({ pullRequests })),
    ).toMatchObject({
      state: "awaiting_pr",
      reasonCode: "no_qualifying_pull_request",
    });
  });

  it.each([
    ["open", false, null],
    ["closed-not-merged", false, "2026-10-01T12:00:00.000Z"],
  ])("keeps an exact-head %s PR in awaiting_pr", (_label, merged, mergedAt) => {
    expect(
      evaluateEngineeringVerification(
        input({ pullRequests: [mergedPr({ merged, mergedAt })] }),
      ),
    ).toMatchObject({
      state: "awaiting_pr",
      reasonCode: "pull_request_not_merged",
    });
  });

  it("rejects an empty required-check policy instead of vacuous success", () => {
    expect(
      evaluateEngineeringVerification(input({ policy: policy([]) })),
    ).toMatchObject({
      state: "failed",
      reasonCode: "required_checks_not_configured",
    });
  });

  it("fails when a required check has no matching current evidence", () => {
    expect(
      evaluateEngineeringVerification(input({ checks: [] })),
    ).toMatchObject({
      state: "failed",
      reasonCode: "required_check_missing",
    });
  });

  it.each(["queued", "requested", "waiting", "pending", "in_progress"])(
    "maps %s required evidence to pending_ci",
    (status) => {
      expect(
        evaluateEngineeringVerification(
          input({ checks: [check({ status, conclusion: null })] }),
        ),
      ).toMatchObject({
        state: "pending_ci",
        reasonCode: "required_checks_pending",
      });
    },
  );

  it.each([
    ["failure", "required_check_failed"],
    ["cancelled", "required_check_cancelled"],
    ["timed_out", "required_check_timed_out"],
    ["skipped", "required_check_skipped"],
    ["neutral", "required_check_neutral"],
    ["stale", "required_check_stale"],
    ["action_required", "required_check_action_required"],
  ])("maps conclusion %s to failed/%s", (conclusion, reasonCode) => {
    expect(
      evaluateEngineeringVerification(
        input({ checks: [check({ conclusion })] }),
      ),
    ).toMatchObject({ state: "failed", reasonCode });
  });

  it("uses the latest attempt and preserves older failures as history only", () => {
    expect(
      evaluateEngineeringVerification(
        input({
          checks: [
            check({
              executionId: "run-old",
              attemptNumber: 1,
              conclusion: "failure",
            }),
            check({ executionId: "run-new", attemptNumber: 2 }),
          ],
        }),
      ),
    ).toMatchObject({ state: "verified", reasonCode: null });
  });

  it("filters same-context evidence by integration/workflow/event before evaluating", () => {
    expect(
      evaluateEngineeringVerification(
        input({
          checks: [
            check({
              integrationId: "github-actions",
              workflowId: "ci",
              workflowEvent: "push",
              conclusion: "failure",
              executionId: "push-run",
            }),
            check({ executionId: "pr-run" }),
          ],
        }),
      ),
    ).toMatchObject({ state: "verified", reasonCode: null });
  });

  it("never chooses success by existence when current matching evidence conflicts", () => {
    expect(
      evaluateEngineeringVerification(
        input({
          policy: policy([
            {
              context: "quality",
              integrationId: null,
              workflowId: null,
              acceptedEvents: [],
            },
          ]),
          checks: [
            check({
              integrationId: null,
              workflowId: null,
              workflowEvent: null,
              sourceType: "check_run",
              executionId: "check-current",
              attemptNumber: 3,
              conclusion: "success",
            }),
            check({
              integrationId: null,
              workflowId: null,
              workflowEvent: null,
              sourceType: "check_run",
              executionId: "check-current-duplicate",
              attemptNumber: 3,
              conclusion: "failure",
            }),
          ],
        }),
      ),
    ).toMatchObject({
      state: "failed",
      reasonCode: "required_check_conflict",
    });
  });

  it("requires both a current Check Run and legacy Commit Status when both match a required context", () => {
    const openPolicy = policy([
      {
        context: "quality",
        integrationId: null,
        workflowId: null,
        acceptedEvents: [],
      },
    ]);

    expect(
      evaluateEngineeringVerification(
        input({
          policy: openPolicy,
          checks: [
            check({
              integrationId: null,
              workflowId: null,
              workflowEvent: null,
              sourceType: "check_run",
              executionId: "check-1",
            }),
            check({
              integrationId: null,
              workflowId: null,
              workflowEvent: null,
              sourceType: "commit_status",
              executionId: "status-1",
              attemptNumber: null,
              conclusion: "failure",
            }),
          ],
        }),
      ),
    ).toMatchObject({ state: "failed", reasonCode: "required_check_failed" });
  });

  it("verifies only when every required current evidence is completed/success", () => {
    const decision = evaluateEngineeringVerification(input());

    expect(decision).toEqual({
      state: "verified",
      reasonCode: null,
      selectedPullRequestExternalId: "42",
      evidenceExecutionIds: ["run-100"],
    });
  });

  it("selects a qualifying merged PR deterministically", () => {
    expect(
      evaluateEngineeringVerification(
        input({
          pullRequests: [
            mergedPr({
              externalId: "50",
              mergedAt: "2026-10-02T12:00:00.000Z",
            }),
            mergedPr({
              externalId: "41",
              mergedAt: "2026-10-01T12:00:00.000Z",
            }),
            mergedPr({
              externalId: "42",
              mergedAt: "2026-10-01T12:00:00.000Z",
            }),
          ],
        }),
      ),
    ).toMatchObject({ selectedPullRequestExternalId: "41" });
  });
});
