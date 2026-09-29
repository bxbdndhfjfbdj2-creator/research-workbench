import { notFound } from "next/navigation";
import { DimensionState, PageHeader } from "@research-workbench/ui";
import {
  getProjectOverview,
  requireCurrentMember,
} from "../../../../src/server/queries";

const PROJECT_NAV = [
  "总览",
  "研究网络",
  "证据与结果",
  "科学决策",
  "智能工作",
  "项目资产",
] as const;

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const project = await getProjectOverview(member, projectId);
  if (!project) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={`研究主理人 · ${project.leadName}`}
        title={project.title}
        description="科研状态可以并行、回退和重新开启；这里显示当前已登记的独立维度状态。"
      />
      <nav className="project-nav" aria-label="项目导航">
        {PROJECT_NAV.map((item, index) =>
          index === 0 ? (
            <span className="active" key={item}>{item}</span>
          ) : (
            <span aria-disabled="true" key={item}>{item}</span>
          ),
        )}
      </nav>

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
