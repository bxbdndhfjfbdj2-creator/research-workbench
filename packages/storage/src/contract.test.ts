import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";

async function readAll(body: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("ObjectStoragePort contract", () => {
  it("round-trips bytes and metadata through the fake adapter", async () => {
    const modulePath = "./fake";
    const { FakeObjectStorage } = await import(modulePath);
    const storage = new FakeObjectStorage();
    const ref = { bucket: "ready", key: "sha256/ab/opaque-object" };
    const bytes = Buffer.from("research-file");

    await storage.putObject(ref, bytes, "text/plain");

    expect(await storage.headObject(ref)).toMatchObject({
      contentLength: bytes.byteLength,
      contentType: "text/plain",
    });
    const read = await storage.readObject(ref);
    expect(Buffer.from(await readAll(read.body)).toString("utf8")).toBe("research-file");
    expect(read.contentLength).toBe(bytes.byteLength);
    expect(read.contentType).toBe("text/plain");
    expect(read.contentRange).toBeNull();
    expect(read.etag).toBeTruthy();
  });

  it("returns an exact inclusive byte range with content-range metadata", async () => {
    const modulePath = "./fake";
    const { FakeObjectStorage } = await import(modulePath);
    const storage = new FakeObjectStorage();
    const ref = { bucket: "ready", key: "sha256/ranged" };
    await storage.putObject(ref, Buffer.from("0123456789"), "application/octet-stream");

    const read = await storage.readObject(ref, { start: 2, end: 5 });

    expect(Buffer.from(await readAll(read.body)).toString("utf8")).toBe("2345");
    expect(read.contentLength).toBe(4);
    expect(read.contentRange).toBe("bytes 2-5/10");
  });

  it("copies idempotently without changing source content", async () => {
    const modulePath = "./fake";
    const { FakeObjectStorage } = await import(modulePath);
    const storage = new FakeObjectStorage();
    const source = { bucket: "quarantine", key: "uploads/upload-42" };
    const destination = { bucket: "ready", key: "sha256/42" };
    await storage.putObject(source, Buffer.from("same"), "text/plain");

    await storage.copyObject(source, destination);
    await storage.copyObject(source, destination);

    expect(Buffer.from(await readAll((await storage.readObject(source)).body)).toString()).toBe("same");
    expect(Buffer.from(await readAll((await storage.readObject(destination)).body)).toString()).toBe("same");
  });

  it("reports a missing object explicitly", async () => {
    const modulePath = "./fake";
    const { FakeObjectStorage } = await import(modulePath);
    const storage = new FakeObjectStorage();
    const missing = { bucket: "ready", key: "does-not-exist" };

    expect(await storage.headObject(missing)).toBeNull();
    await expect(storage.readObject(missing)).rejects.toThrow(/not found/i);
  });

  it("treats storage keys as opaque and never derives them from a filename", async () => {
    const modulePath = "./fake";
    const { FakeObjectStorage } = await import(modulePath);
    const storage = new FakeObjectStorage();
    const opaque = { bucket: "ready", key: "sha256/aa/bb" };
    await storage.putObject(opaque, Buffer.from("x"), "application/pdf");

    expect(storage.listObjectRefs()).toEqual([opaque]);
    expect(JSON.stringify(storage.listObjectRefs())).not.toContain("report.pdf");
  });
});
