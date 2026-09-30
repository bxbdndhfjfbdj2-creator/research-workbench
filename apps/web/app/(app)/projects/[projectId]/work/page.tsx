import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../src/components/project-navigation";
import {
  CreateResearchTaskForm,
  ResearchTaskList,
} from "../../../../../src/components/research-work/research-task-list";
import {
  getProjectOverview,
  requireCurrentMember,
} from "../../../../../src/server/queries";
import { getProjectResearchWork } from "../../../../../src/server/work-queries";

export default async function ProjectResearchWorkPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const [project, work] = await Promise.all([
    getProjectOverview(member, projectId),
    getProjectResearchWork(member, projectId),
  ]);
  if (!project || !work) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title="研究工作"
        description="统一查看人工、Agent 与 hybrid 科研事项；正式提交与普通审核保持不可变 provenance，科学状态变更仍由 ScientificDecision 单独治理。"
      />
      <ProjectNavigation projectId={projectId} active="研究工作" />
      <CreateResearchTaskForm projectId={projectId} />
      <section className="research-work-section">
        <h3>项目科研事项</h3>
        <ResearchTaskList projectId={projectId} tasks={work.tasks} />
      </section>
    </section>
  );
}
