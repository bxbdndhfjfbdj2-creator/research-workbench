import { readFile } from "node:fs/promises";
import type {
  LocalFileInput,
  RichDocumentArtifact,
  RichDocumentParseResult,
  RichDocumentParserPort,
} from "./types";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DoclingRichDocumentParserOptions = {
  baseUrl: string;
  processorVersion: string;
  timeoutMs: number;
  maxOutputBytes: number;
  fetchImpl?: FetchLike;
  readFileImpl?: (path: string) => Promise<Uint8Array>;
};

const SUPPORTED_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/tiff",
]);

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Docling base URL must use HTTP(S)");
  }
  return url.toString().replace(/\/$/, "");
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.ok) throw new Error(`DOCLING_HTTP_${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("DOCLING_OUTPUT_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("DOCLING_OUTPUT_TOO_LARGE");
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("DOCLING_INVALID_JSON");
  }
}

function documentPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("DOCLING_INVALID_RESPONSE");
  }
  const root = value as Record<string, unknown>;
  const candidate =
    root.document ??
    (Array.isArray(root.documents) ? root.documents[0] : undefined) ??
    root;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("DOCLING_INVALID_RESPONSE");
  }
  const record = candidate as Record<string, unknown>;
  const nested = record.document;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : record;
}

export class DoclingRichDocumentParser implements RichDocumentParserPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly readFileImpl: (path: string) => Promise<Uint8Array>;

  constructor(private readonly options: DoclingRichDocumentParserOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.readFileImpl = options.readFileImpl ?? readFile;
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("Docling timeout must be a positive integer");
    }
    if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
      throw new Error("Docling output cap must be a positive integer");
    }
  }

  async parse(
    input: LocalFileInput,
    mediaType: string,
  ): Promise<RichDocumentParseResult> {
    if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      return {
        supported: false,
        artifacts: [],
        processorVersion: this.options.processorVersion,
      };
    }

    const bytes = await this.readFileImpl(input.path);
    const form = new FormData();
    form.append(
      "files",
      new Blob([Buffer.from(bytes)], { type: mediaType }),
      input.originalFilename,
    );
    for (const format of ["json", "md", "html"]) form.append("to_formats", format);
    form.append("abort_on_error", "false");

    const payload = await boundedJson(
      await this.fetchImpl(`${this.baseUrl}/v1/convert/file`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      }),
      this.options.maxOutputBytes,
    );
    const document = documentPayload(payload);
    const encoder = new TextEncoder();
    const artifacts: RichDocumentArtifact[] = [];

    const jsonContent = document.json_content ?? document.json;
    if (jsonContent !== undefined && jsonContent !== null) {
      artifacts.push({
        kind: "json",
        bytes: encoder.encode(
          typeof jsonContent === "string"
            ? jsonContent
            : JSON.stringify(jsonContent),
        ),
      });
    }
    const markdown = document.md_content ?? document.markdown ?? document.md;
    if (typeof markdown === "string") {
      artifacts.push({ kind: "markdown", bytes: encoder.encode(markdown) });
    }
    const html = document.html_content ?? document.html;
    if (typeof html === "string") {
      artifacts.push({ kind: "html", bytes: encoder.encode(html) });
    }
    if (artifacts.length === 0) throw new Error("DOCLING_NO_ARTIFACTS");

    return {
      supported: true,
      artifacts,
      processorVersion: this.options.processorVersion,
    };
  }
}
