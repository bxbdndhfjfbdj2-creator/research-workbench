import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type {
  ByteRange,
  ObjectStoragePort,
  StorageObjectRef,
  StoredObjectRead,
} from "./types";

type StoredEntry = {
  bytes: Uint8Array;
  contentType: string | null;
  etag: string;
};

function refKey(ref: StorageObjectRef): string {
  if (!ref.bucket.trim() || !ref.key.trim()) {
    throw new Error("Storage bucket and key are required");
  }
  return `${ref.bucket}\u0000${ref.key}`;
}

function computeEtag(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function toBytes(body: NodeJS.ReadableStream | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return Uint8Array.from(body);

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<unknown>) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Uint8Array) {
      chunks.push(chunk);
    } else {
      throw new Error("Unsupported storage stream chunk");
    }
  }
  return Buffer.concat(chunks);
}

function normalizeRange(range: ByteRange, size: number): { start: number; end: number } {
  if (!Number.isInteger(range.start) || range.start < 0 || range.start >= size) {
    throw new Error("Invalid storage byte range start");
  }
  const end = range.end ?? size - 1;
  if (!Number.isInteger(end) || end < range.start || end >= size) {
    throw new Error("Invalid storage byte range end");
  }
  return { start: range.start, end };
}

export class FakeObjectStorage implements ObjectStoragePort {
  readonly #objects = new Map<string, { ref: StorageObjectRef; entry: StoredEntry }>();

  async headObject(
    ref: StorageObjectRef,
  ): Promise<{ contentLength: number; contentType: string | null; etag: string | null } | null> {
    const stored = this.#objects.get(refKey(ref));
    if (!stored) return null;
    return {
      contentLength: stored.entry.bytes.byteLength,
      contentType: stored.entry.contentType,
      etag: stored.entry.etag,
    };
  }

  async readObject(ref: StorageObjectRef, range?: ByteRange): Promise<StoredObjectRead> {
    const stored = this.#objects.get(refKey(ref));
    if (!stored) throw new Error("Storage object not found");

    const total = stored.entry.bytes.byteLength;
    if (!range) {
      return {
        body: Readable.from([stored.entry.bytes]),
        contentLength: total,
        contentType: stored.entry.contentType,
        contentRange: null,
        etag: stored.entry.etag,
      };
    }

    const normalized = normalizeRange(range, total);
    const bytes = stored.entry.bytes.slice(normalized.start, normalized.end + 1);
    return {
      body: Readable.from([bytes]),
      contentLength: bytes.byteLength,
      contentType: stored.entry.contentType,
      contentRange: `bytes ${normalized.start}-${normalized.end}/${total}`,
      etag: stored.entry.etag,
    };
  }

  async putObject(
    ref: StorageObjectRef,
    body: NodeJS.ReadableStream | Uint8Array,
    contentType: string | null = null,
  ): Promise<void> {
    const bytes = await toBytes(body);
    const canonicalRef = { bucket: ref.bucket, key: ref.key };
    this.#objects.set(refKey(canonicalRef), {
      ref: canonicalRef,
      entry: {
        bytes: Uint8Array.from(bytes),
        contentType,
        etag: computeEtag(bytes),
      },
    });
  }

  async copyObject(source: StorageObjectRef, destination: StorageObjectRef): Promise<void> {
    const stored = this.#objects.get(refKey(source));
    if (!stored) throw new Error("Storage source object not found");
    const canonicalRef = { bucket: destination.bucket, key: destination.key };
    this.#objects.set(refKey(canonicalRef), {
      ref: canonicalRef,
      entry: {
        bytes: Uint8Array.from(stored.entry.bytes),
        contentType: stored.entry.contentType,
        etag: stored.entry.etag,
      },
    });
  }

  async deleteObject(ref: StorageObjectRef): Promise<void> {
    this.#objects.delete(refKey(ref));
  }

  listObjectRefs(): StorageObjectRef[] {
    return [...this.#objects.values()]
      .map(({ ref }) => ({ ...ref }))
      .sort((left, right) =>
        left.bucket === right.bucket
          ? left.key.localeCompare(right.key)
          : left.bucket.localeCompare(right.bucket),
      );
  }
}
