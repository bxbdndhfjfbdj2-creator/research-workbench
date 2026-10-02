import { describe, expect, it } from "vitest";
import {
  COCKPIT_IDLE_MS,
  classifyProjectAttention,
  computeLastMeaningfulTaskActivity,
  selectLatestAgentRuns,
  sortActivityItems,
  sortAttentionItems,
} from "./cockpit-classification";
import type {
  AgentRunCurrentFact,
  CockpitActivityItem,
  CockpitViewer,
  ProjectAttentionFacts,
  ResearchTaskCurrentFact,
} from "./cockpit-types";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const viewer: CockpitViewer = {
  memberId: "member-1",
  teamId: "team-1",
  organizationRole: "researcher",
};

function task(
  overrides: Partial<ResearchTaskCurrentFact> = {},
): ResearchTaskCurrentFact {
  return {
    id: "task-1",
    projectId: "project-1",
    projectTitle: "研究一",
    title: "分析主结果",
    status: "in_progress",
    ownerMemberId: "member-1",
    ownerDisplayName: "研究员一",
    updatedAt: new Date(NOW.getTime() - COCKPIT_IDLE_MS),
    latestSubmissionAt: null,
    latestReviewAt: null,
    latestLinkedDecisionAt: null,
    latestAgentRunAt: null,
    currentReview: null,
    ...overrides,
  };
}

function run(
  overrides: Partial<AgentRunCurrentFact> = {},
): AgentRunCurrentFact {
  return {
    id: "run-1",
    agentTaskId: "agent-task-1",
    researchTaskId: "task-1",
    projectId: "project-1",
    projectTitle: "研究一",
    taskTitle: "分析主结果",
    attemptNumber: 1,
    state: "失败",
    updatedAt: new Date("2026-09-30T12:00:00.000Z"),
    ...overrides,
  };
}

function facts(overrides: Partial<ProjectAttentionFacts> = {}): ProjectAttentionFacts {
  return {
    now: NOW,
    viewer,
    tasks: [],
    decisions: [],
    agentRuns: [],
    fileParseFailures: [],
    ...overrides,
  };
}

describe("cockpit deterministic classification", () => {
  it("starts long-idle at exactly 14x24h, not one second earlier", () => {
    const almostIdle = task({
      id: "task-almost",
      updatedAt: new Date(NOW.getTime() - COCKPIT_IDLE_MS + 1_000),
    });
    const exactlyIdle = task({
      id: "task-exact",
      updatedAt: new Date(NOW.getTime() - COCKPIT_IDLE_MS),
    });

    const items = classifyProjectAttention(
      facts({ tasks: [almostIdle, exactlyIdle] }),
    );

    expect(items.filter((item) => item.kind === "long_idle_work").map((item) => item.id))
      .toEqual(["long-idle:task-exact"]);
  });

  it("uses the latest formal task activity timestamp", () => {
    const timestamps = [
      new Date("2026-09-12T00:00:00.000Z"),
      new Date("2026-09-13T00:00:00.000Z"),
      new Date("2026-09-14T00:00:00.000Z"),
      new Date("2026-09-15T00:00:00.000Z"),
      new Date("2026-09-16T00:00:00.000Z"),
    ];
    expect(
      computeLastMeaningfulTaskActivity(
        task({
          updatedAt: timestamps[0],
          latestSubmissionAt: timestamps[1],
          latestReviewAt: timestamps[2],
          latestLinkedDecisionAt: timestamps[3],
          latestAgentRunAt: timestamps[4],
        }),
      ),
    ).toEqual(timestamps[4]);
  });

  it.each(["completed", "cancelled"] as const)(
    "does not classify %s tasks as idle",
    (status) => {
      expect(
        classifyProjectAttention(
          facts({
            tasks: [
              task({
                id: `task-${status}`,
                status,
                updatedAt: new Date("2026-08-01T00:00:00.000Z"),
              }),
            ],
          }),
        ).some((item) => item.kind === "long_idle_work"),
      ).toBe(false);
    },
  );

  it("lets blocked status suppress long-idle", () => {
    const items = classifyProjectAttention(
      facts({
        tasks: [
          task({
            status: "blocked",
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
          }),
        ],
      }),
    );

    expect(items.map((item) => item.kind)).toEqual(["blocked_task"]);
  });

  it("lets review or scientific-governance waiting suppress long-idle", () => {
    const items = classifyProjectAttention(
      facts({
        tasks: [
          task({
            id: "task-review",
            status: "awaiting_review",
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
            currentReview: {
              id: "review-1",
              status: "pending",
              reviewerMemberId: "member-2",
              submissionNumber: 1,
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
              updatedAt: new Date("2026-09-01T00:00:00.000Z"),
              linkedDecisionId: null,
            },
          }),
          task({
            id: "task-decision",
            status: "awaiting_review",
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
            currentReview: {
              id: "review-2",
              status: "awaiting_scientific_decision",
              reviewerMemberId: "member-2",
              submissionNumber: 2,
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
              updatedAt: new Date("2026-09-02T00:00:00.000Z"),
              linkedDecisionId: "decision-1",
            },
          }),
        ],
      }),
    );

    expect(items.some((item) => item.kind === "long_idle_work")).toBe(false);
    expect(items.some((item) => item.kind === "awaiting_scientific_decision")).toBe(true);
  });

  it("selects the maximum Agent attempt number rather than the newest timestamp", () => {
    const selected = selectLatestAgentRuns([
      run({
        id: "run-attempt-1",
        attemptNumber: 1,
        state: "失败",
        updatedAt: new Date("2026-10-01T11:00:00.000Z"),
      }),
      run({
        id: "run-attempt-2",
        attemptNumber: 2,
        state: "完成",
        updatedAt: new Date("2026-10-01T10:00:00.000Z"),
      }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.id).toBe("run-attempt-2");
    expect(
      classifyProjectAttention(facts({ agentRuns: selected })).some(
        (item) => item.kind === "agent_run_failed",
      ),
    ).toBe(false);
  });

  it("projects waiting-human from the latest Agent attempt", () => {
    const items = classifyProjectAttention(
      facts({
        agentRuns: [
          run({ id: "run-1", attemptNumber: 1, state: "失败" }),
          run({
            id: "run-2",
            attemptNumber: 2,
            state: "等待人工输入",
          }),
        ],
      }),
    );

    expect(items.map((item) => item.kind)).toEqual(["agent_waiting_human"]);
  });

  it("keeps different AgentTasks independent", () => {
    const items = classifyProjectAttention(
      facts({
        agentRuns: [
          run({ id: "run-a", agentTaskId: "agent-task-a", state: "失败" }),
          run({
            id: "run-b",
            agentTaskId: "agent-task-b",
            state: "等待人工输入",
          }),
        ],
      }),
    );

    expect(items.map((item) => item.kind).sort()).toEqual([
      "agent_run_failed",
      "agent_waiting_human",
    ]);
  });

  it("suppresses linked awaiting-decision attention when that decision is my explicit action", () => {
    const items = classifyProjectAttention(
      facts({
        tasks: [
          task({
            status: "awaiting_review",
            currentReview: {
              id: "review-1",
              status: "awaiting_scientific_decision",
              reviewerMemberId: "member-2",
              submissionNumber: 1,
              createdAt: new Date("2026-09-20T00:00:00.000Z"),
              updatedAt: new Date("2026-09-20T00:00:00.000Z"),
              linkedDecisionId: "decision-1",
            },
          }),
        ],
        decisions: [
          {
            id: "decision-1",
            projectId: "project-1",
            projectTitle: "研究一",
            title: "升级正式理论",
            status: "proposed",
            updatedAt: new Date("2026-09-20T00:00:00.000Z"),
            reviewStage: "project_lead",
          },
        ],
      }),
    );

    expect(items.filter((item) => item.kind === "my_scientific_decision")).toHaveLength(1);
    expect(items.filter((item) => item.kind === "awaiting_scientific_decision")).toHaveLength(0);
  });

  it("sorts attention oldest-first with stable id tie-break", () => {
    const base = classifyProjectAttention(
      facts({
        tasks: [
          task({
            id: "task-b",
            status: "blocked",
            updatedAt: new Date("2026-09-02T00:00:00.000Z"),
          }),
          task({
            id: "task-a",
            status: "blocked",
            updatedAt: new Date("2026-09-01T00:00:00.000Z"),
          }),
          task({
            id: "task-c",
            status: "blocked",
            updatedAt: new Date("2026-09-01T00:00:00.000Z"),
          }),
        ],
      }),
    );

    expect(sortAttentionItems(base).map((item) => item.id)).toEqual([
      "blocked:task-a",
      "blocked:task-c",
      "blocked:task-b",
    ]);
  });

  it("sorts recent activity newest-first with stable id tie-break", () => {
    const activities: CockpitActivityItem[] = [
      {
        kind: "task_status_changed",
        id: "activity-b",
        projectId: "project-1",
        projectTitle: "研究一",
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
        label: "任务状态变化",
        href: "/projects/project-1/work/task-1",
      },
      {
        kind: "task_status_changed",
        id: "activity-a",
        projectId: "project-1",
        projectTitle: "研究一",
        occurredAt: new Date("2026-09-30T00:00:00.000Z"),
        label: "任务状态变化",
        href: "/projects/project-1/work/task-2",
      },
      {
        kind: "task_status_changed",
        id: "activity-new",
        projectId: "project-1",
        projectTitle: "研究一",
        occurredAt: new Date("2026-10-01T00:00:00.000Z"),
        label: "任务状态变化",
        href: "/projects/project-1/work/task-3",
      },
    ];

    expect(sortActivityItems(activities).map((item) => item.id)).toEqual([
      "activity-new",
      "activity-a",
      "activity-b",
    ]);
  });
});
