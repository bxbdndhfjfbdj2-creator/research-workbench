import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";

async function readAll(body: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("S3-compatible object storage", () => {
  it("provides the production S3 adapter", async () => {
    const modulePath = "../../packages/storage/src/s3";
    const module = await import(modulePath);
    expect(module.S3ObjectStorage).toBeTypeOf("function");
  });

  it.skipIf(!process.env.SEAWEEDFS_S3_ENDPOINT)(
    "round-trips and range-reads against the configured SeaweedFS S3 gateway",
    async () => {
      const { S3ObjectStorage } = await import("../../packages/storage/src/s3");
      const endpoint = process.env.SEAWEEDFS_S3_ENDPOINT!;
      const accessKeyId = process.env.SEAWEEDFS_S3_ACCESS_KEY ?? "any";
      const secretAccessKey = process.env.SEAWEEDFS_S3_SECRET_KEY ?? "any";
      const bucket = process.env.SEAWEEDFS_S3_BUCKET ?? "phase4a-storage-smoke";
      const storage = new S3ObjectStorage({
        endpoint,
        region: process.env.SEAWEEDFS_S3_REGION ?? "us-east-1",
        credentials: { accessKeyId, secretAccessKey },
        pathStyle: true,
      });
      const source = { bucket, key: `quarantine/smoke-${Date.now()}` };
      const ready = { bucket, key: `ready/smoke-${Date.now()}` };

      await storage.ensureBucket(bucket);
      await storage.putObject(source, Buffer.from("0123456789"), "text/plain");
      const head = await storage.headObject(source);
      expect(head).toMatchObject({ contentLength: 10, contentType: "text/plain" });

      const range = await storage.readObject(source, { start: 3, end: 6 });
      expect((await readAll(range.body)).toString()).toBe("3456");
      expect(range.contentRange).toBe("bytes 3-6/10");

      await storage.copyObject(source, ready);
      expect((await readAll((await storage.readObject(ready)).body)).toString()).toBe("0123456789");

      await storage.deleteObject(source);
      await storage.deleteObject(ready);
      expect(await storage.headObject(source)).toBeNull();
    },
  );
});
