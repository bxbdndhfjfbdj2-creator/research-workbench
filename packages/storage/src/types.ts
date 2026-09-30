export type StorageObjectRef = {
  bucket: string;
  key: string;
};

export type ByteRange = {
  start: number;
  end?: number;
};

export type StoredObjectRead = {
  body: NodeJS.ReadableStream;
  contentLength: number;
  contentType: string | null;
  contentRange: string | null;
  etag: string | null;
};

export interface ObjectStoragePort {
  headObject(
    ref: StorageObjectRef,
  ): Promise<{ contentLength: number; contentType: string | null; etag: string | null } | null>;
  readObject(ref: StorageObjectRef, range?: ByteRange): Promise<StoredObjectRead>;
  putObject(
    ref: StorageObjectRef,
    body: NodeJS.ReadableStream | Uint8Array,
    contentType?: string | null,
  ): Promise<void>;
  copyObject(source: StorageObjectRef, destination: StorageObjectRef): Promise<void>;
  deleteObject(ref: StorageObjectRef): Promise<void>;
}
