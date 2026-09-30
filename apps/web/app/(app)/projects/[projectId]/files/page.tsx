import { notFound } from "next/navigation";
import { PageHeader } from "@research-workbench/ui";
import { ProjectNavigation } from "../../../../../src/components/project-navigation";
import { ExternalReferenceForm } from "../../../../../src/components/files/external-reference-form";
import { FileList } from "../../../../../src/components/files/file-list";
import { FileUploadForm } from "../../../../../src/components/files/file-upload-form";
import { FileUploadStatusList } from "../../../../../src/components/files/file-upload-status-list";
import {
  getProjectFiles,
  getProjectFileUploadStatuses,
  getProjectOverview,
  requireCurrentMember,
} from "../../../../../src/server/queries";

export default async function ProjectFilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const member = await requireCurrentMember();
  const { projectId } = await params;
  const { q } = await searchParams;
  const [project, files, uploads] = await Promise.all([
    getProjectOverview(member, projectId),
    getProjectFiles(member, projectId, { q }),
    getProjectFileUploadStatuses(member, projectId),
  ]);
  if (!project || !files || !uploads) notFound();

  return (
    <section>
      <PageHeader
        eyebrow={project.title}
        title="文件与资料"
        description="文件版本、受控外部数据、扫描/解析事实与科研对象关联都保留稳定 ID 和不可变来源。"
      />
      <ProjectNavigation projectId={projectId} active="文件与资料" />

      <form method="get" className="panel">
        <label>
          全文检索
          <input name="q" defaultValue={q ?? ""} placeholder="标题、文件名或提取文本" />
        </label>
        <button type="submit">搜索</button>
      </form>

      <FileList projectId={projectId} files={files} />
      <FileUploadStatusList uploads={uploads} />
      <FileUploadForm projectId={projectId} />
      <ExternalReferenceForm projectId={projectId} />
    </section>
  );
}
