import { readFile } from "node:fs/promises";
import type {
  LocalFileInput,
  MetadataExtractionResult,
  MetadataExtractorPort,
} from "./types";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TikaMetadataExtractorOptions = {
  baseUrl: string;
  processorVersion: string;
  timeoutMs: number;
  maxOutputBytes: number;
  fetchImpl?: FetchLike;
  readFileImpl?: (path: string) => Promise<Uint8Array>;
};

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Tika base URL must use HTTP(S)");
  }
  return url.toString().replace(/\/$/, "");
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`TIKA_HTTP_${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("TIKA_OUTPUT_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("TIKA_OUTPUT_TOO_LARGE");
  return bytes;
}

function safeFilename(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

export class TikaMetadataExtractor implements MetadataExtractorPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly readFileImpl: (path: string) => Promise<Uint8Array>;

  constructor(private readonly options: TikaMetadataExtractorOptions) {
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.readFileImpl = options.readFileImpl ?? readFile;
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error("Tika timeout must be a positive integer");
    }
    if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
      throw new Error("Tika output cap must be a positive integer");
    }
  }

  private async put(path: string, bytes: Uint8Array, filename: string): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeFilename(filename)}"`,
      },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
  }

  async extract(input: LocalFileInput): Promise<MetadataExtractionResult> {
    const bytes = await this.readFileImpl(input.path);
    const detectedBytes = await boundedBytes(
      await this.put("/detect", bytes, input.originalFilename),
      Math.min(this.options.maxOutputBytes, 16_384),
    );
    const mediaTypeDetected = new TextDecoder().decode(detectedBytes).trim();
    if (!mediaTypeDetected) throw new Error("TIKA_EMPTY_MEDIA_TYPE");

    const metadataArtifact = await boundedBytes(
      await this.put("/rmeta/text", bytes, input.originalFilename),
      this.options.maxOutputBytes,
    );

    let textArtifact: Uint8Array | null = null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(metadataArtifact)) as unknown;
      if (Array.isArray(parsed)) {
        const text = parsed
          .map((entry) =>
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>)["X-TIKA:content"]
              : null,
          )
          .filter((value): value is string => typeof value === "string")
          .join("\n");
        if (text) textArtifact = new TextEncoder().encode(text);
      }
    } catch {
      throw new Error("TIKA_INVALID_METADATA_RESPONSE");
    }

    return {
      mediaTypeDetected,
      metadataArtifact,
      textArtifact,
      processorVersion: this.options.processorVersion,
    };
  }
}
