import type { NormalizedTusHook } from "@research-workbench/application/src/files/tusd-hook";

type UnknownRecord = Record<string, unknown>;

export type NormalizedTusdHookRequest = {
  hook: NormalizedTusHook;
  uploadToken: string;
};

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as UnknownRecord;
}

function asInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid ${label}`);
  return value as number;
}

function metadataRecord(value: unknown): Record<string, string> {
  const record = asRecord(value, "upload metadata");
  const result: Record<string, string> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (typeof nested !== "string") throw new Error("Invalid upload metadata value");
    result[key] = nested;
  }
  return result;
}

function headerValue(value: unknown, headerName: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const headers = value as UnknownRecord;
  const matched = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === headerName.toLowerCase(),
  );
  if (!matched) return null;
  const raw = matched[1];
  if (typeof raw === "string") return raw.trim() || null;
  if (!Array.isArray(raw)) return null;
  const first = raw.find((item) => typeof item === "string" && item.trim());
  return typeof first === "string" ? first.trim() : null;
}

export function normalizeTusdHookRequest(
  raw: unknown,
  forwardedUploadToken: string | null,
): NormalizedTusdHookRequest | null {
  const root = asRecord(raw, "tusd hook request");
  const type = root.Type;
  if (type !== "pre-create" && type !== "post-finish") return null;

  const event = asRecord(root.Event, "tusd hook event");
  const upload = asRecord(event.Upload, "tusd upload");
  const httpRequest = asRecord(event.HTTPRequest ?? {}, "tusd HTTP request");
  const uploadToken =
    headerValue(httpRequest.Header, "X-Workbench-Upload-Token") ??
    forwardedUploadToken?.trim() ??
    null;
  if (!uploadToken) throw new Error("Missing upload token");

  const metadata = metadataRecord(upload.MetaData ?? {});
  const size = asInteger(upload.Size, "upload size");
  const offset = asInteger(upload.Offset, "upload offset");

  if (type === "pre-create") {
    if (upload.ID !== null && upload.ID !== undefined) {
      throw new Error("Invalid pre-create upload id");
    }
    if (upload.Storage !== null && upload.Storage !== undefined) {
      throw new Error("Invalid pre-create storage facts");
    }
    return {
      uploadToken,
      hook: {
        type,
        upload: { id: null, size, offset, metadata },
      },
    };
  }

  if (typeof upload.ID !== "string" || !upload.ID.trim()) {
    throw new Error("Invalid post-finish upload id");
  }
  const storage = asRecord(upload.Storage, "tusd storage");
  if (
    typeof storage.Type !== "string" ||
    typeof storage.Bucket !== "string" ||
    typeof storage.Key !== "string"
  ) {
    throw new Error("Invalid post-finish storage facts");
  }

  return {
    uploadToken,
    hook: {
      type,
      upload: {
        id: upload.ID,
        size,
        offset,
        metadata,
        storage: {
          type: storage.Type,
          bucket: storage.Bucket,
          key: storage.Key,
        },
      },
    },
  };
}
