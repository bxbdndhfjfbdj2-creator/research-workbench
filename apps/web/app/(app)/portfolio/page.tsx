import { PageHeader, ProjectCard } from "@research-workbench/ui";
import {
  listVisibleProjects,
  requireCurrentMember,
} from "../../../src/server/queries";

export default async function PortfolioPage() {
  const member = await requireCurrentMember();
  const projects = await listVisibleProjects(member);

  return (
    <section>
      <PageHeader
        eyebrow={member.organizationRole === "lead" ? "团队视角" : "我的研究"}
        title="研究组合"
        description={
          member.organizationRole === "lead"
            ? "聚焦整个团队当前需要科学判断与协调的研究。"
            : "只显示你直接参与的研究项目。"
        }
      />
      <div className="project-grid">
        {projects.map((project) => (
          <ProjectCard key={project.id} {...project} />
        ))}
      </div>
    </section>
  );
}
