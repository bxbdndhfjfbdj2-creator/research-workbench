"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type PdfPreviewProps = {
  fileVersionId: string;
  label?: string;
};

export function PdfPreview({
  fileVersionId,
  label = "PDF preview",
}: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjs.getDocument({
      url: `/api/files/${encodeURIComponent(fileVersionId)}/content`,
      withCredentials: true,
    });

    async function renderFirstPage() {
      try {
        const document = await loadingTask.promise;
        const page = await document.getPage(1);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const viewport = page.getViewport({ scale: 1.25 });
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context is unavailable");

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void renderFirstPage();
    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [fileVersionId]);

  return (
    <figure aria-label={label}>
      <canvas ref={canvasRef} aria-hidden={status !== "ready"} />
      {status === "loading" ? <p>正在加载 PDF 预览…</p> : null}
      {status === "error" ? (
        <p role="status">PDF 预览暂不可用，可使用原文件下载。</p>
      ) : null}
    </figure>
  );
}
