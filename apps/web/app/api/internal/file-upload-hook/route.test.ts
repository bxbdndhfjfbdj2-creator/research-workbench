import { describe, expect, it } from "vitest";

describe("file upload hook HTTP boundary", () => {
  it("normalizes pre-create with null id, no storage and token from the client-request header", async () => {
    const modulePath = "./route";
    const route = await import(modulePath);

    const normalized = route.normalizeTusdHookRequest(
      {
        Type: "pre-create",
        Event: {
          Upload: {
            ID: null,
            Size: 42,
            Offset: 0,
            MetaData: { workbenchUploadId: "intent-1" },
          },
          HTTPRequest: {
            Header: {
              "X-Workbench-Upload-Token": ["token-from-client"],
              "Tus-Resumable": ["1.0.0"],
            },
          },
        },
      },
      null,
    );

    expect(normalized).toEqual({
      uploadToken: "token-from-client",
      hook: {
        type: "pre-create",
        upload: {
          id: null,
          size: 42,
          offset: 0,
          metadata: { workbenchUploadId: "intent-1" },
        },
      },
    });
    expect(JSON.stringify(normalized)).not.toContain("Tus-Resumable");
  });

  it("normalizes post-finish S3 facts and can use an explicitly forwarded direct header", async () => {
    const modulePath = "./route";
    const route = await import(modulePath);

    const normalized = route.normalizeTusdHookRequest(
      {
        Type: "post-finish",
        Event: {
          Upload: {
            ID: "tus-123",
            Size: 42,
            Offset: 42,
            MetaData: { workbenchUploadId: "intent-1" },
            Storage: {
              Type: "s3store",
              Bucket: "rw-quarantine",
              Key: "uploads/opaque",
            },
          },
          HTTPRequest: { Header: {} },
        },
      },
      "forwarded-token",
    );

    expect(normalized).toEqual({
      uploadToken: "forwarded-token",
      hook: {
        type: "post-finish",
        upload: {
          id: "tus-123",
          size: 42,
          offset: 42,
          metadata: { workbenchUploadId: "intent-1" },
          storage: {
            type: "s3store",
            bucket: "rw-quarantine",
            key: "uploads/opaque",
          },
        },
      },
    });
  });

  it("ignores unrelated hook types instead of persisting them", async () => {
    const modulePath = "./route";
    const route = await import(modulePath);

    expect(
      route.normalizeTusdHookRequest(
        {
          Type: "post-receive",
          Event: {
            Upload: { ID: "tus-123", Size: 42, Offset: 10, MetaData: {} },
            HTTPRequest: { Header: {} },
          },
        },
        null,
      ),
    ).toBeNull();
  });
});
