import type { DecisionStatus } from "@research-workbench/domain/src/scientific-decision";

export type DecisionReviewStage = "project_lead" | "team_lead";

export type DecisionReviewEligibilityInput = {
  status: DecisionStatus;
  projectLeadMemberId: string;
  reviewerMemberId: string;
  reviewerOrganizationRole: "lead" | "researcher";
};

export function resolveScientificDecisionReviewStage(
  input: DecisionReviewEligibilityInput,
): DecisionReviewStage | null {
  if (
    (input.status === "proposed" || input.status === "needs_evidence") &&
    input.reviewerMemberId === input.projectLeadMemberId
  ) {
    return "project_lead";
  }

  if (
    input.status === "awaiting_lead" &&
    input.reviewerOrganizationRole === "lead"
  ) {
    return "team_lead";
  }

  return null;
}
