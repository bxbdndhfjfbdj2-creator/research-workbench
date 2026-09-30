import type { ProjectFileUploadStatus } from "../../server/queries";

export function FileUploadStatusList({
  uploads,
}: {
  uploads: ProjectFileUploadStatus[];
}) {
  if (uploads.length === 0) return null;

  return (
    <section className="panel" aria-label="上传处理记录">
      <h3>上传处理记录</h3>
      <ul className="member-list">
        {uploads.map((upload) => (
          <li key={upload.id} data-testid="file-upload-status">
            <div>
              <strong>{upload.title}</strong>
              <p className="meta">
                {upload.originalFilename} · {upload.fileKind} · {upload.accessClass}
              </p>
            </div>
            <span>{upload.state}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
