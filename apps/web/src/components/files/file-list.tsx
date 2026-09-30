import Link from "next/link";
import type { ProjectFileListItem } from "../../server/queries";

export function FileList({
  projectId,
  files,
}: {
  projectId: string;
  files: ProjectFileListItem[];
}) {
  if (files.length === 0) {
    return <p className="panel">尚无匹配的文件或资料。</p>;
  }
  return (
    <div className="panel">
      <h3>文件与资料</h3>
      <ul className="member-list">
        {files.map((file) => (
          <li key={file.id}>
            <div>
              <strong>
                <Link href={`/projects/${projectId}/files/${file.id}`}>
                  {file.title}
                </Link>
              </strong>
              <p className="meta">
                {file.fileKind} · {file.accessClass} · 当前版本 {file.currentVersionNumber ?? "—"}
              </p>
            </div>
            <span>
              {file.scanStatus ?? file.lifecycleState} / {file.parseStatus ?? "未解析"} · {file.linkCount} links
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
