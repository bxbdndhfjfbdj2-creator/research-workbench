import { Readable } from "node:stream";
import { getFileContentDescriptor } from "@research-workbench/application/src/files/content-access";
import type { ByteRange } from "@research-workbench/storage/src/types";
import { getFileStorage } from "../../../../../src/server/file-storage";
import {
  getWebDbClient,
  requireCurrentMember,
} from "../../../../../src/server/queries";

function parseRange(value: string | null, byteSize: number): ByteRange | null {
  if (!value) return null;
  const match = value.trim().match(/^bytes=(\d+)-(\d*)$/i);
  if (!match?.[1]) throw new Error("Invalid byte range");

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start >= byteSize ||
    (end !== undefined &&
      (!Number.isSafeInteger(end) || end < start || end >= byteSize))
  ) {
    throw new Error("Invalid byte range");
  }
  return end === undefined ? { start } : { start, end };
}

function contentDisposition(filename: string, download: boolean): string {
  const mode = download ? "attachment" : "inline";
  const encoded = encodeURIComponent(filename.replace(/[\r\n]/g, "_"));
  return `${mode}; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ fileVersionId: string }> },
): Promise<Response> {
  const member = await requireCurrentMember();
  const { fileVersionId } = await context.params;

  let descriptor;
  try {
    descriptor = await getFileContentDescriptor(
      getWebDbClient().sql,
      fileVersionId,
      member.id,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/forbidden/i.test(message)) {
      return Response.json({ status: "forbidden" }, { status: 403 });
    }
    return Response.json({ status: "not_found" }, { status: 404 });
  }

  let range: ByteRange | null;
  try {
    range = parseRange(request.headers.get("range"), descriptor.byteSize);
  } catch {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${descriptor.byteSize}`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  try {
    const stored = await getFileStorage().readObject(
      descriptor.storageRef,
      range ?? undefined,
    );
    const headers = new Headers({
      "Content-Type": descriptor.mediaType,
      "Content-Length": String(stored.contentLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": contentDisposition(
        descriptor.originalFilename,
        new URL(request.url).searchParams.get("download") === "1",
      ),
    });
    if (stored.contentRange) headers.set("Content-Range", stored.contentRange);
    if (stored.etag) headers.set("ETag", stored.etag);

    const body = Readable.toWeb(stored.body as Readable) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: range ? 206 : 200,
      headers,
    });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
