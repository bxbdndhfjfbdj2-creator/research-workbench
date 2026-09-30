import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../../src/components/project-navigation";
import { ResearchTaskDetail } from "../../../../../../src/components/research-work/research-task-detail";
import {
  getProjectOverview,
  listTeamMembers,
  requireCurrentMember,
} from "../../../../../../src/server/queries";
import { getResearchTaskDetail } from "../../../../../../src/server/work-queries";

export default async function ResearchTaskDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; taskId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId, taskId } = await params;
  const [project, task, teamMembers] = await Promise.all([
    getProjectOverview(member, projectId),
    getResearchTaskDetail(member, taskId),
    listTeamMembers(member),
  ]);
  if (!project || !task || task.projectId !== projectId) notFound();

  const candidateMap = new Map<string, { id: string; displayName: string }>();
  for (const projectMember of project.members) {
    candidateMap.set(projectMember.id, {
      id: projectMember.id,
      displayName: projectMember.displayName,
    });
  }
  for (const teamMember of teamMembers) {
    if (teamMember.organizationRole === "lead") {
      candidateMap.set(teamMember.id, {
        id: teamMember.id,
        displayName: teamMember.displayName,
      });
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title={task.title}
        description="任务进度、不可变 Submission、普通 Review 与必要的 ScientificDecision 升级在这里形成完整审计链。"
      />
      <ProjectNavigation projectId={projectId} active="研究工作" />
      <ResearchTaskDetail
        task={task}
        project={project}
        member={member}
        reviewerCandidates={[...candidateMap.values()]}
      />
    </section>
  );
}
