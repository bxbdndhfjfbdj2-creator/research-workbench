import "server-only";

import type {
  ByteRange,
  ObjectStoragePort,
  StorageObjectRef,
  StoredObjectRead,
} from "@research-workbench/storage/src/types";
import { S3ObjectStorage } from "@research-workbench/storage/src/s3";

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function booleanEnv(key: string): boolean {
  const value = requiredEnv(key).toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid ${key}: expected true or false`);
}

function httpEndpoint(key: string): string {
  const value = requiredEnv(key);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${key}: expected HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid ${key}: expected HTTP(S) URL`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`Invalid ${key}: endpoint must not embed credentials or query data`);
  }
  return parsed.toString().replace(/\/$/, "");
}

class ReadyFileStorage implements ObjectStoragePort {
  constructor(
    private readonly inner: ObjectStoragePort,
    private readonly readyBucket: string,
  ) {}

  private map(ref: StorageObjectRef): StorageObjectRef {
    if (ref.bucket !== "ready") {
      throw new Error("Unsupported logical file storage namespace");
    }
    return { bucket: this.readyBucket, key: ref.key };
  }

  headObject(ref: StorageObjectRef) {
    return this.inner.headObject(this.map(ref));
  }

  readObject(ref: StorageObjectRef, range?: ByteRange): Promise<StoredObjectRead> {
    return this.inner.readObject(this.map(ref), range);
  }

  putObject(
    ref: StorageObjectRef,
    body: NodeJS.ReadableStream | Uint8Array,
    contentType?: string | null,
  ): Promise<void> {
    return this.inner.putObject(this.map(ref), body, contentType);
  }

  copyObject(source: StorageObjectRef, destination: StorageObjectRef): Promise<void> {
    return this.inner.copyObject(this.map(source), this.map(destination));
  }

  deleteObject(ref: StorageObjectRef): Promise<void> {
    return this.inner.deleteObject(this.map(ref));
  }
}

const globalFileStorage = globalThis as typeof globalThis & {
  __researchWorkbenchFileStorage?: ObjectStoragePort;
};

export function getFileStorage(): ObjectStoragePort {
  globalFileStorage.__researchWorkbenchFileStorage ??= new ReadyFileStorage(
    new S3ObjectStorage({
      endpoint: httpEndpoint("FILE_S3_ENDPOINT"),
      region: requiredEnv("FILE_S3_REGION"),
      pathStyle: booleanEnv("FILE_S3_FORCE_PATH_STYLE"),
      credentials: {
        accessKeyId: requiredEnv("FILE_STORAGE_ACCESS_KEY_ID"),
        secretAccessKey: requiredEnv("FILE_STORAGE_SECRET_ACCESS_KEY"),
      },
    }),
    requiredEnv("FILE_READY_BUCKET"),
  );
  return globalFileStorage.__researchWorkbenchFileStorage;
}
