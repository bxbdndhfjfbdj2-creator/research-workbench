import type { ResearchFileDetailViewModel } from "../../server/queries";
import { PdfPreview } from "./pdf-preview";
import { FileLinkForm } from "./file-link-form";
import { FileUploadForm } from "./file-upload-form";

function isTextLike(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        ["application/json", "application/xml"].includes(mediaType)),
  );
}

export function FileDetail({ file }: { file: ResearchFileDetailViewModel }) {
  const current = file.versions.find((version) => version.id === file.currentVersionId) ?? file.versions[0];

  return (
    <>
      <section className="panel">
        <h3>{file.title}</h3>
        <p>{file.description ?? "未填写说明"}</p>
        <p className="meta">
          {file.fileKind} · {file.accessClass} · {file.lifecycleState}
        </p>
        {file.externalReference ? (
          <dl>
            <dt>Manifest</dt><dd>{file.externalReference.manifestHash}</dd>
            <dt>版本标签</dt><dd>{file.externalReference.versionLabel}</dd>
            <dt>Locator</dt><dd>{file.externalReference.uriOrLocator ?? "受限元数据"}</dd>
            <dt>Access policy</dt><dd>{file.externalReference.accessPolicyRef ?? "受限元数据"}</dd>
            <dt>Agreement</dt><dd>{file.externalReference.licenseOrAgreementRef ?? "受限元数据"}</dd>
          </dl>
        ) : null}
      </section>

      {current?.sourceKind === "upload" ? (
        <section className="panel">
          <h3>当前版本预览</h3>
          {current.mediaType === "application/pdf" ? (
            <PdfPreview fileVersionId={current.id} label={`${file.title} PDF preview`} />
          ) : current.extractedText ? (
            <pre>{current.extractedText}</pre>
          ) : isTextLike(current.mediaType) ? (
            <p>暂无可用的安全提取文本。</p>
          ) : (
            <p>复杂文档使用解析后的表示进行检视；当前暂无可展示的提取表示。</p>
          )}
          <p>
            <a href={`/api/files/${current.id}/content?download=1`}>下载原文件</a>
          </p>
        </section>
      ) : null}

      <section className="panel">
        <h3>不可变版本历史</h3>
        <ol>
          {file.versions.map((version) => (
            <li key={version.id} data-testid="file-version">
              <strong>v{version.versionNumber}</strong> · {version.originalFilename}
              <div className="meta">
                {version.mediaType ?? "external reference"} · {version.byteSize ?? "—"} bytes ·
                scan {version.scanStatus} · parse {version.parseStatus} · uploaded by{" "}
                <span>{version.createdBy}</span>
              </div>
              {version.sha256 ? <code>{version.sha256}</code> : null}
              {version.changeSummary ? <p>{version.changeSummary}</p> : null}
              {version.sourceKind === "upload" ? (
                <p>
                  <a href={`/api/files/${version.id}/content?download=1`}>下载此版本</a>
                </p>
              ) : null}
              {version.processing.length > 0 ? (
                <ul>
                  {version.processing.map((record) => (
                    <li key={record.id}>
                      {record.processorName}@{record.processorVersion} · {record.status}
                      {record.errorCode ? ` · ${record.errorCode}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {current ? (
        <>
          <FileUploadForm
            projectId={file.projectId}
            researchFileId={file.id}
            fileKind={file.fileKind}
            accessClass={file.accessClass}
            title={file.title}
          />
          <FileLinkForm
            projectId={file.projectId}
            fileVersionId={current.id}
            activeLinks={file.activeLinks}
          />
        </>
      ) : null}

      {file.retiredLinks.length > 0 ? (
        <section className="panel">
          <h3>关联审计历史</h3>
          <ul>
            {file.retiredLinks.map((link) => (
              <li key={link.id}>
                {link.relation} · {link.subjectType} · {link.subjectId} · 已退役：
                {link.retirementReason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
