import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../src/components/project-navigation";
import {
  AgentTaskList,
  CreateAgentWorkForm,
} from "../../../../../src/components/agent-runs/agent-task-list";
import {
  getProjectAgentWork,
  getProjectOverview,
  requireCurrentMember,
} from "../../../../../src/server/queries";

export default async function ProjectAgentWorkPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const [project, work] = await Promise.all([
    getProjectOverview(member, projectId),
    getProjectAgentWork(member, projectId),
  ]);
  if (!project || !work) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title="智能工作"
        description="AgentTask 记录科研执行意图；每次 Run 是独立、可追溯的执行尝试。失败尝试、冻结上下文、Harness Session 与人工等待都不会被后续运行覆盖。"
      />
      <ProjectNavigation projectId={projectId} active="智能工作" />
      <CreateAgentWorkForm projectId={projectId} researchTasks={work.researchTasks} />
      <section className="agent-work-section">
        <h3>项目智能工作</h3>
        <AgentTaskList projectId={projectId} tasks={work.agentTasks} />
      </section>
    </section>
  );
}
