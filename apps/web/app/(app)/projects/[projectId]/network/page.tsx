import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../src/components/project-navigation";
import { ResearchGraphView } from "../../../../../src/components/research-graph/research-graph-view";
import {
  getProjectOverview,
  getProjectResearchGraph,
  requireCurrentMember,
} from "../../../../../src/server/queries";

export default async function ResearchNetworkPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const [project, graph] = await Promise.all([
    getProjectOverview(member, projectId),
    getProjectResearchGraph(member, projectId),
  ]);
  if (!project || !graph) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title="研究网络"
        description="节点、版本、关系和科研分支共同表达非线性探索；被否定或关闭的路线保留为可追溯研究历史。"
      />
      <ProjectNavigation projectId={projectId} active="研究网络" />
      <ResearchGraphView graph={graph} />
    </section>
  );
}
