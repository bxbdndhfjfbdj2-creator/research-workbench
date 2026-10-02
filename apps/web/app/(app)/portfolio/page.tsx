import { PageHeader } from "@research-workbench/ui";
import { AttentionSection } from "../../../src/components/cockpit/attention-section";
import { ProjectCockpitCard } from "../../../src/components/cockpit/project-cockpit-card";
import { RecentActivity } from "../../../src/components/cockpit/recent-activity";
import { loadPortfolioCockpitForPage } from "../../../src/server/cockpit-queries";
import { requireCurrentMember } from "../../../src/server/queries";

export default async function PortfolioPage() {
  const member = await requireCurrentMember();
  const cockpit = await loadPortfolioCockpitForPage(member);

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

      {cockpit.status === "unavailable" ? (
        <section className="panel cockpit-unavailable" data-testid="cockpit-unavailable">
          <h3>科研关注投影暂时不可用。</h3>
          <p className="meta">你仍可以通过现有研究工作、审核、科学决策与文件页面处理正式事项。</p>
        </section>
      ) : (
        <div className="cockpit-layout">
          <AttentionSection
            title="我的明确行动"
            items={cockpit.data.myActions}
            emptyMessage="当前没有明确等待你处理的事项。"
            testId="my-actions"
          />

          <section className="cockpit-projects" aria-labelledby="portfolio-projects-heading">
            <div className="cockpit-section-heading">
              <h3 id="portfolio-projects-heading">项目事实摘要与当前关注</h3>
            </div>
            <div className="project-grid">
              {cockpit.data.projects.map((project) => (
                <ProjectCockpitCard key={project.project.id} summary={project} />
              ))}
            </div>
          </section>

          <RecentActivity items={cockpit.data.recentActivity} />
        </div>
      )}
    </section>
  );
}
