import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../src/components/project-navigation";
import { EvidenceResultsView } from "../../../../../src/components/research-graph/evidence-results-view";
import {
  getProjectEvidence,
  getProjectOverview,
  requireCurrentMember,
} from "../../../../../src/server/queries";

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const [project, evidence] = await Promise.all([
    getProjectOverview(member, projectId),
    getProjectEvidence(member, projectId),
  ]);
  if (!project || !evidence) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title="证据与结果"
        description="研究结果是不可变事实记录；新运行通过替代关系连接旧结果，并保留数据版本、分析版本、运行与代码提交来源。"
      />
      <ProjectNavigation projectId={projectId} active="证据与结果" />
      <EvidenceResultsView evidence={evidence} />
    </section>
  );
}
