import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import type {
  ByteRange,
  ObjectStoragePort,
  StorageObjectRef,
  StoredObjectRead,
} from "./types";

export type S3ObjectStorageOptions = {
  endpoint: string;
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  pathStyle: boolean;
};

function encodedCopySource(ref: StorageObjectRef): string {
  const bucket = encodeURIComponent(ref.bucket);
  const key = ref.key.split("/").map(encodeURIComponent).join("/");
  return `/${bucket}/${key}`;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    record.$metadata?.httpStatusCode === 404 ||
    record.name === "NotFound" ||
    record.name === "NoSuchKey"
  );
}

function rangeHeader(range: ByteRange): string {
  if (!Number.isInteger(range.start) || range.start < 0) {
    throw new Error("Storage byte range start must be a non-negative integer");
  }
  if (range.end !== undefined && (!Number.isInteger(range.end) || range.end < range.start)) {
    throw new Error("Storage byte range end must be an integer greater than or equal to start");
  }
  return `bytes=${range.start}-${range.end ?? ""}`;
}

export class S3ObjectStorage implements ObjectStoragePort {
  readonly #client: S3Client;

  constructor(options: S3ObjectStorageOptions) {
    const config: S3ClientConfig = {
      endpoint: options.endpoint,
      region: options.region,
      credentials: options.credentials,
      forcePathStyle: options.pathStyle,
    };
    this.#client = new S3Client(config);
  }

  async headObject(
    ref: StorageObjectRef,
  ): Promise<{ contentLength: number; contentType: string | null; etag: string | null } | null> {
    try {
      const response = await this.#client.send(
        new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
      );
      return {
        contentLength: Number(response.ContentLength ?? 0),
        contentType: response.ContentType ?? null,
        etag: response.ETag ?? null,
      };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  async readObject(ref: StorageObjectRef, range?: ByteRange): Promise<StoredObjectRead> {
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
        ...(range ? { Range: rangeHeader(range) } : {}),
      }),
    );
    if (!response.Body) throw new Error("S3 object response has no body");

    return {
      body: response.Body as unknown as NodeJS.ReadableStream,
      contentLength: Number(response.ContentLength ?? 0),
      contentType: response.ContentType ?? null,
      contentRange: response.ContentRange ?? null,
      etag: response.ETag ?? null,
    };
  }

  async putObject(
    ref: StorageObjectRef,
    body: NodeJS.ReadableStream | Uint8Array,
    contentType: string | null = null,
  ): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: ref.bucket,
        Key: ref.key,
        Body: body as never,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
  }

  async copyObject(source: StorageObjectRef, destination: StorageObjectRef): Promise<void> {
    await this.#client.send(
      new CopyObjectCommand({
        Bucket: destination.bucket,
        Key: destination.key,
        CopySource: encodedCopySource(source),
      }),
    );
  }

  async deleteObject(ref: StorageObjectRef): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );
  }

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.#client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (error && typeof error === "object") {
        const name = (error as { name?: string }).name;
        if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") return;
      }
      throw error;
    }
  }
}
