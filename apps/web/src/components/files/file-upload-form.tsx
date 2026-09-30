"use client";

import { useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import Tus from "@uppy/tus";
import type { FileAccessClass, FileKind } from "@research-workbench/domain/src/research-file";
import { requestFileUploadIntentAction } from "../../server/file-actions";

type UploadMeta = {
  workbenchUploadId: string;
};

export function FileUploadForm({
  projectId,
  researchFileId,
  fileKind,
  accessClass,
  title,
}: {
  projectId: string;
  researchFileId?: string;
  fileKind?: FileKind;
  accessClass?: FileAccessClass;
  title?: string;
}) {
  const uppyRef = useRef<Uppy<UploadMeta> | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedKind, setSelectedKind] = useState<FileKind>(fileKind ?? "general_attachment");
  const [selectedAccess, setSelectedAccess] = useState<FileAccessClass>(accessClass ?? "project");
  const [newTitle, setNewTitle] = useState(title ?? "");
  const [changeSummary, setChangeSummary] = useState("");
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<"idle" | "uploading" | "processing" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    return () => {
      uppyRef.current?.destroy();
      uppyRef.current = null;
    };
  }, []);

  async function uploadSelected() {
    if (!selectedFile) {
      setState("error");
      setMessage("请选择要上传的文件。");
      return;
    }
    if (!researchFileId && !newTitle.trim()) {
      setState("error");
      setMessage("请输入资料标题。");
      return;
    }
    if (researchFileId && !changeSummary.trim()) {
      setState("error");
      setMessage("新版本必须填写变更摘要。");
      return;
    }

    setState("uploading");
    setMessage("");
    try {
      let uppy = uppyRef.current;
      if (!uppy) {
        const intent = await requestFileUploadIntentAction({
          projectId,
          ...(researchFileId ? { researchFileId } : {}),
          ...(!researchFileId ? { title: newTitle.trim() } : {}),
          fileKind: selectedKind,
          accessClass: selectedAccess,
          originalFilename: selectedFile.name,
          byteSize: selectedFile.size,
          declaredMediaType: selectedFile.type || null,
          ...(researchFileId ? { changeSummary: changeSummary.trim() } : {}),
        });

        uppy = new Uppy<UploadMeta>({
          autoProceed: false,
          allowMultipleUploadBatches: false,
          restrictions: {
            maxNumberOfFiles: 1,
          },
        });
        uppy.use(Tus, {
          endpoint: intent.tusEndpoint,
          headers: {
            "X-Workbench-Upload-Token": intent.uploadToken,
          },
          allowedMetaFields: ["workbenchUploadId"],
          retryDelays: [0, 1000, 3000, 5000],
          chunkSize: 1024 * 1024,
        });
        uppy.on("progress", (value: number) => setProgress(value));
        uppy.addFile({
          name: selectedFile.name,
          type: selectedFile.type || undefined,
          data: selectedFile,
          meta: { workbenchUploadId: intent.uploadIntentId },
        });
        uppyRef.current = uppy;
      }

      const result = state === "error" ? await uppy.retryAll() : await uppy.upload();
      if (result?.failed?.length) {
        throw new Error("Upload failed");
      }
      setProgress(100);
      setState("processing");
      setMessage("上传完成，正在进行安全扫描与解析。");
    } catch {
      setState("error");
      setMessage("上传未完成。可以保留当前文件并重试可恢复上传。");
    }
  }

  function selectFile(file: File | null) {
    if (uppyRef.current) {
      uppyRef.current.destroy();
      uppyRef.current = null;
    }
    setSelectedFile(file);
    setProgress(0);
    setState("idle");
    setMessage("");
  }

  return (
    <section className="panel" aria-label={researchFileId ? "上传新版本" : "上传资料"}>
      <h3>{researchFileId ? "上传新版本" : "上传文件"}</h3>
      {!researchFileId ? (
        <>
          <label>
            资料标题
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              name="title"
            />
          </label>
          <label>
            资料类型
            <select value={selectedKind} onChange={(event) => setSelectedKind(event.target.value as FileKind)}>
              <option value="literature">文献</option>
              <option value="data_documentation">数据文档</option>
              <option value="dataset">数据集</option>
              <option value="analysis_output">分析输出</option>
              <option value="code_archive">代码归档</option>
              <option value="research_design">研究设计</option>
              <option value="manuscript">稿件</option>
              <option value="review_material">审阅材料</option>
              <option value="meeting_note">会议记录</option>
              <option value="ethics_or_license">伦理/许可</option>
              <option value="presentation">演示</option>
              <option value="general_attachment">一般附件</option>
            </select>
          </label>
          <label>
            访问级别
            <select value={selectedAccess} onChange={(event) => setSelectedAccess(event.target.value as FileAccessClass)}>
              <option value="project">项目内</option>
              <option value="restricted">受限</option>
            </select>
          </label>
        </>
      ) : (
        <label>
          变更摘要
          <input
            value={changeSummary}
            onChange={(event) => setChangeSummary(event.target.value)}
            name="changeSummary"
          />
        </label>
      )}
      <label>
        文件
        <input
          type="file"
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {selectedFile ? (
        <p className="meta">
          {selectedFile.name} · {selectedFile.size.toLocaleString()} bytes
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void uploadSelected()}
        disabled={state === "uploading" || state === "processing"}
      >
        {state === "error" && uppyRef.current ? "重试上传" : researchFileId ? "上传新版本" : "开始上传"}
      </button>
      {state === "uploading" ? <p role="status">上传进度 {progress}%</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
