import { notFound } from "next/navigation";
import { DimensionState, PageHeader } from "@research-workbench/ui";
import {
  getProjectOverview,
  requireCurrentMember,
} from "../../../../src/server/queries";
import { ProjectNavigation } from "../../../../src/components/project-navigation";
import { AttentionSection } from "../../../../src/components/cockpit/attention-section";
import { RecentActivity } from "../../../../src/components/cockpit/recent-activity";
import { loadProjectCockpitForPage } from "../../../../src/server/cockpit-queries";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const project = await getProjectOverview(member, projectId);
  if (!project) notFound();
  const cockpit = await loadProjectCockpitForPage(member, projectId);

  return (
    <section>
      <PageHeader
        eyebrow={`研究主理人 · ${project.leadName}`}
        title={project.title}
        description="科研状态可以并行、回退和重新开启；这里显示当前已登记的独立维度状态。"
      />
      <ProjectNavigation projectId={projectId} active="总览" />

      <div className="panel">
        <h3>多维科研状态</h3>
        <div className="dimension-grid">
          {project.states.map((item) => (
            <DimensionState
              key={item.dimension}
              dimension={item.dimension}
              state={item.state}
            />
          ))}
        </div>
      </div>

      {cockpit.status === "unavailable" ? (
        <section className="panel cockpit-unavailable" data-testid="project-cockpit-unavailable">
          <h3>科研关注投影暂时不可用。</h3>
          <p className="meta">项目科研状态仍来自正式记录；请从现有工作流页面处理正式事项。</p>
        </section>
      ) : (
        <>
          <AttentionSection
            title="我的明确行动"
            items={cockpit.data.explicitActions}
            emptyMessage="当前没有明确等待你处理的事项。"
            testId="project-actions"
          />
          <AttentionSection
            title="项目关注"
            items={cockpit.data.attention}
            emptyMessage="当前没有项目关注事项。"
            testId="project-attention"
          />
          <RecentActivity items={cockpit.data.recentActivity} />
        </>
      )}

      <div className="panel">
        <h3>项目成员</h3>
        <ul className="member-list">
          {project.members.map((projectMember) => (
            <li key={projectMember.id}>
              <strong>{projectMember.displayName}</strong>
              <span>{projectMember.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
