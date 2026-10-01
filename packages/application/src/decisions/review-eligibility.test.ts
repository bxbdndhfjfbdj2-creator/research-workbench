import { describe, expect, it } from "vitest";
import { resolveScientificDecisionReviewStage } from "./review-eligibility";

describe("resolveScientificDecisionReviewStage", () => {
  it.each([
    {
      label: "project lead reviews a proposed decision",
      status: "proposed" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "project-lead",
      reviewerOrganizationRole: "researcher" as const,
      expected: "project_lead",
    },
    {
      label: "project lead reviews a decision that needs evidence",
      status: "needs_evidence" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "project-lead",
      reviewerOrganizationRole: "researcher" as const,
      expected: "project_lead",
    },
    {
      label: "organization lead reviews the team-lead stage",
      status: "awaiting_lead" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "organization-lead",
      reviewerOrganizationRole: "lead" as const,
      expected: "team_lead",
    },
    {
      label: "project lead cannot review the team-lead stage",
      status: "awaiting_lead" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "project-lead",
      reviewerOrganizationRole: "researcher" as const,
      expected: null,
    },
    {
      label: "organization lead cannot take the project-lead stage when they are not project lead",
      status: "proposed" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "organization-lead",
      reviewerOrganizationRole: "lead" as const,
      expected: null,
    },
    {
      label: "approved decisions have no current reviewer stage",
      status: "approved" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "organization-lead",
      reviewerOrganizationRole: "lead" as const,
      expected: null,
    },
    {
      label: "rejected decisions have no current reviewer stage",
      status: "rejected" as const,
      projectLeadMemberId: "project-lead",
      reviewerMemberId: "organization-lead",
      reviewerOrganizationRole: "lead" as const,
      expected: null,
    },
  ])("$label", ({
    status,
    projectLeadMemberId,
    reviewerMemberId,
    reviewerOrganizationRole,
    expected,
  }) => {
    expect(
      resolveScientificDecisionReviewStage({
        status,
        projectLeadMemberId,
        reviewerMemberId,
        reviewerOrganizationRole,
      }),
    ).toBe(expected);
  });
});
