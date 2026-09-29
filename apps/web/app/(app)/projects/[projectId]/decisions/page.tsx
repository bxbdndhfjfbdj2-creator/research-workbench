import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../src/components/project-navigation";
import { ScientificDecisionList } from "../../../../../src/components/decisions/scientific-decision-list";
import {
  getProjectDecisionCenter,
  getProjectOverview,
  requireCurrentMember,
} from "../../../../../src/server/queries";

export default async function ProjectDecisionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const [project, center] = await Promise.all([
    getProjectOverview(member, projectId),
    getProjectDecisionCenter(member, projectId),
  ]);
  if (!project || !center) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title="科学决策"
        description="AI 可以提出候选变更，但正式理论、核心问题、主数据、主模型等关键状态只能通过人工审批后的科学决策改变。"
      />
      <ProjectNavigation projectId={projectId} active="科学决策" />

      <section className="panel official-panel" data-testid="official-revisions">
        <h3>当前正式版本</h3>
        {center.currentOfficial.length === 0 ? (
          <p className="meta">尚未建立正式版本指针。</p>
        ) : (
          <div className="official-revision-list">
            {center.currentOfficial.map((item) => (
              <div className="official-revision-row" key={item.slot}>
                <span>{item.slot}</span>
                <strong>{item.summary}</strong>
                <small>版本 {item.revisionNumber}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="decision-section">
        <h3>决策记录</h3>
        <ScientificDecisionList items={center.decisions} />
      </section>

      <section className="panel" data-testid="official-history">
        <h3>历史正式版本</h3>
        <div className="official-history-list">
          {center.officialHistory.map((item) => (
            <div className="official-history-row" key={item.decisionId}>
              <span>{item.slot}</span>
              <strong>{item.summary}</strong>
              <small>版本 {item.revisionNumber}</small>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
