import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../../src/components/project-navigation";
import { FileDetail } from "../../../../../../src/components/files/file-detail";
import {
  getProjectOverview,
  getResearchFileDetail,
  requireCurrentMember,
} from "../../../../../../src/server/queries";

export default async function ResearchFilePage({
  params,
}: {
  params: Promise<{ projectId: string; researchFileId: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId, researchFileId } = await params;
  const [project, file] = await Promise.all([
    getProjectOverview(member, projectId),
    getResearchFileDetail(member, researchFileId),
  ]);
  if (!project || !file || file.projectId !== projectId) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title={file.title}
        description="查看不可变版本、处理来源、预览与科研对象关联。"
      />
      <ProjectNavigation projectId={projectId} active="文件与资料" />
      <FileDetail file={file} />
    </section>
  );
}
