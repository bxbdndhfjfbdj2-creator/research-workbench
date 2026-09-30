import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: {
    id: "session-member",
    teamId: "team-1",
    displayName: "Session Member",
    organizationRole: "researcher" as const,
  },
  revalidatePath: vi.fn(),
  sql: { unsafe: vi.fn() },
  createResearchTask: vi.fn(),
  startResearchTask: vi.fn(),
  updateResearchTaskRequirements: vi.fn(),
  setResearchTaskReviewPolicy: vi.fn(),
  assignResearchTaskOwner: vi.fn(),
  setResearchTaskExecutionMode: vi.fn(),
  blockResearchTask: vi.fn(),
  unblockResearchTask: vi.fn(),
  cancelResearchTask: vi.fn(),
  reopenResearchTask: vi.fn(),
  completeUnreviewedTask: vi.fn(),
  submitResearchTask: vi.fn(),
  reassignReviewer: vi.fn(),
  approveSubmission: vi.fn(),
  requestSubmissionChanges: vi.fn(),
  rejectSubmission: vi.fn(),
  escalateReviewToScientificDecision: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./queries", () => ({
  requireCurrentMember: vi.fn(async () => mocks.member),
  getWebDbClient: vi.fn(() => ({ sql: mocks.sql })),
}));
vi.mock("@research-workbench/application/src/tasks/research-task-service", () => ({
  createResearchTask: mocks.createResearchTask,
  startResearchTask: mocks.startResearchTask,
  updateResearchTaskRequirements: mocks.updateResearchTaskRequirements,
  setResearchTaskReviewPolicy: mocks.setResearchTaskReviewPolicy,
  assignResearchTaskOwner: mocks.assignResearchTaskOwner,
  setResearchTaskExecutionMode: mocks.setResearchTaskExecutionMode,
  blockResearchTask: mocks.blockResearchTask,
  unblockResearchTask: mocks.unblockResearchTask,
  cancelResearchTask: mocks.cancelResearchTask,
  reopenResearchTask: mocks.reopenResearchTask,
  completeUnreviewedTask: mocks.completeUnreviewedTask,
}));
vi.mock("@research-workbench/application/src/tasks/task-submission-service", () => ({
  submitResearchTask: mocks.submitResearchTask,
}));
vi.mock("@research-workbench/application/src/tasks/task-review-service", () => ({
  reassignReviewer: mocks.reassignReviewer,
  approveSubmission: mocks.approveSubmission,
  requestSubmissionChanges: mocks.requestSubmissionChanges,
  rejectSubmission: mocks.rejectSubmission,
}));
vi.mock("@research-workbench/application/src/tasks/task-review-escalation", () => ({
  escalateReviewToScientificDecision: mocks.escalateReviewToScientificDecision,
}));

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("research work server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createResearchTask.mockResolvedValue({ id: "task-1" });
    mocks.startResearchTask.mockResolvedValue({ id: "task-1" });
    mocks.setResearchTaskExecutionMode.mockResolvedValue({ id: "task-1" });
    mocks.setResearchTaskReviewPolicy.mockResolvedValue({ id: "task-1" });
    mocks.submitResearchTask.mockResolvedValue({
      submission: { id: "submission-1" },
      reviewRequestId: null,
    });
    mocks.approveSubmission.mockResolvedValue({ id: "review-1" });
    mocks.escalateReviewToScientificDecision.mockResolvedValue({
      review: { id: "review-1" },
      decision: { id: "decision-1" },
    });
  });

  it("uses the authenticated member as actor and trims bounded task input", async () => {
    const actions = await import("./work-actions");
    await actions.createResearchTaskAction(form({
      projectId: "project-1",
      title: "  Robustness analysis  ",
      description: "  Explain sensitivity  ",
      executionMode: "hybrid",
      reviewPolicy: "required",
      acceptanceCriteria: " first criterion \n\n second criterion ",
      actorId: "forged-member",
    }));

    expect(mocks.createResearchTask).toHaveBeenCalledWith(
      mocks.sql,
      "project-1",
      {
        title: "Robustness analysis",
        description: "Explain sensitivity",
        executionMode: "hybrid",
        reviewPolicy: "required",
        acceptanceCriteria: ["first criterion", "second criterion"],
      },
      { type: "human", id: "session-member" },
    );

    await expect(
      actions.createResearchTaskAction(form({
        projectId: "project-1",
        title: "x".repeat(201),
        executionMode: "human",
        reviewPolicy: "none",
      })),
    ).rejects.toThrow(/title/i);
    expect(mocks.createResearchTask).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid execution/review enum values before application calls", async () => {
    const actions = await import("./work-actions");

    await expect(
      actions.setResearchTaskExecutionModeAction(form({
        projectId: "project-1",
        taskId: "task-1",
        executionMode: "robot",
      })),
    ).rejects.toThrow(/execution mode/i);
    expect(mocks.setResearchTaskExecutionMode).not.toHaveBeenCalled();

    await expect(
      actions.setResearchTaskReviewPolicyAction(form({
        projectId: "project-1",
        taskId: "task-1",
        reviewPolicy: "sometimes",
      })),
    ).rejects.toThrow(/review policy/i);
    expect(mocks.setResearchTaskReviewPolicy).not.toHaveBeenCalled();
  });

  it("validates submission provenance kinds/relations and passes stable refs to the service", async () => {
    const actions = await import("./work-actions");

    await expect(
      actions.submitResearchTaskAction(form({
        projectId: "project-1",
        taskId: "task-1",
        summary: "Delivery",
        refKind: "arbitrary_table",
        refId: "row-1",
        refRelation: "source",
      })),
    ).rejects.toThrow(/ref kind/i);
    expect(mocks.submitResearchTask).not.toHaveBeenCalled();

    await expect(
      actions.submitResearchTaskAction(form({
        projectId: "project-1",
        taskId: "task-1",
        summary: "Delivery",
        refKind: "file_version",
        refId: "version-1",
        refRelation: "owns",
      })),
    ).rejects.toThrow(/relation/i);
    expect(mocks.submitResearchTask).not.toHaveBeenCalled();

    await actions.submitResearchTaskAction(form({
      projectId: "project-1",
      taskId: "task-1",
      summary: "  Delivery  ",
      reviewerMemberId: "reviewer-1",
      agentRunContributorId: "run-1",
      refKind: "file_version",
      refId: "version-1",
      refRelation: "source",
      actorId: "forged-member",
    }));

    expect(mocks.submitResearchTask).toHaveBeenCalledWith(
      mocks.sql,
      "task-1",
      {
        summary: "Delivery",
        reviewerMemberId: "reviewer-1",
        contributors: [{ kind: "agent_run", runId: "run-1" }],
        refs: [{
          kind: "file_version",
          refId: "version-1",
          relation: "source",
        }],
      },
      { type: "human", id: "session-member" },
    );
  });

  it("parses escalation as a scientific-decision proposal without trusting browser actor identity", async () => {
    const actions = await import("./work-actions");
    await actions.escalateReviewAction(form({
      projectId: "project-1",
      taskId: "task-1",
      reviewRequestId: "review-1",
      decisionLevel: "major",
      decisionTitle: "  Change primary model  ",
      decisionReason: "  Robustness evidence changed interpretation  ",
      changeKind: "official_revision",
      officialSlot: "主模型",
      revisionId: "revision-2",
      actorId: "forged-reviewer",
    }));

    expect(mocks.escalateReviewToScientificDecision).toHaveBeenCalledWith(
      mocks.sql,
      "review-1",
      {
        level: "major",
        title: "Change primary model",
        reason: "Robustness evidence changed interpretation",
        evidence: [],
        impact: [],
        change: {
          kind: "official_revision",
          slot: "主模型",
          revisionId: "revision-2",
        },
      },
      { type: "human", id: "session-member" },
    );
  });

  it("does not reflect raw secret-bearing service errors back through a server action", async () => {
    mocks.approveSubmission.mockRejectedValueOnce(
      new Error("PostgresError password=super-secret sql=select * from review_requests"),
    );
    const actions = await import("./work-actions");

    let message = "";
    try {
      await actions.approveReviewAction(form({
        projectId: "project-1",
        taskId: "task-1",
        reviewRequestId: "review-1",
        comment: "",
      }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/research work action failed/i);
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("select *");
  });
});
