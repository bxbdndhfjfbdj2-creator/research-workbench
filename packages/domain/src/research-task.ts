export const RESEARCH_TASK_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;

export type ResearchTaskStatus = (typeof RESEARCH_TASK_STATUSES)[number];

export type ResearchTask = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: ResearchTaskStatus;
  assigneeMemberId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
