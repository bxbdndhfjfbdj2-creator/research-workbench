import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: {
    id: "member-from-session",
    teamId: "team-1",
    displayName: "Researcher",
    organizationRole: "researcher" as const,
  },
  createFileUploadIntent: vi.fn(),
  registerExternalDataVersion: vi.fn(),
  createFileLink: vi.fn(),
  retireFileLink: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("./queries", () => ({
  requireCurrentMember: vi.fn(async () => mocks.member),
  getWebDbClient: vi.fn(() => ({ sql: { unsafe: vi.fn() } })),
}));

vi.mock("@research-workbench/application/src/files/upload-intent", () => ({
  createFileUploadIntent: mocks.createFileUploadIntent,
}));

vi.mock("@research-workbench/application/src/files/file-service", () => ({
  registerExternalDataVersion: mocks.registerExternalDataVersion,
}));

vi.mock("@research-workbench/application/src/files/file-links", () => ({
  createFileLink: mocks.createFileLink,
  retireFileLink: mocks.retireFileLink,
}));

describe("file server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FILE_UPLOAD_SIGNING_SECRET = "test-upload-signing-secret";
    process.env.FILE_STORAGE_ACCESS_KEY_ID = "unused-access-key";
    process.env.FILE_STORAGE_SECRET_ACCESS_KEY = "unused-secret-key";
    process.env.TUS_ENDPOINT = "http://tusd.internal:8080/files/";
    process.env.FILE_QUARANTINE_BUCKET = "rw-quarantine";
    process.env.FILE_QUARANTINE_PREFIX = "uploads/";
    process.env.FILE_MAX_BYTES = "1048576";
    process.env.FILE_UPLOAD_HOOK_TTL_SECONDS = "900";

    mocks.createFileUploadIntent.mockResolvedValue({
      uploadIntentId: "intent-1",
      uploadToken: "signed-upload-token",
      expiresAt: new Date("2026-09-30T00:15:00Z"),
    });
    mocks.registerExternalDataVersion.mockResolvedValue({
      researchFile: { id: "file-1" },
      externalReference: { id: "external-1" },
      fileVersion: { id: "version-1" },
    });
    mocks.createFileLink.mockResolvedValue({ id: "link-1" });
    mocks.retireFileLink.mockResolvedValue({ id: "retirement-1" });
  });

  it("validates new-file upload metadata without accepting raw bytes", async () => {
    const actions = await import("./file-actions");

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        title: "",
        fileKind: "literature",
        accessClass: "project",
        originalFilename: "paper.pdf",
        byteSize: 12,
      }),
    ).toThrow(/title/i);

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        title: "Paper",
        fileKind: "unknown",
        accessClass: "project",
        originalFilename: "paper.pdf",
        byteSize: 12,
      }),
    ).toThrow(/file kind/i);

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        title: "Paper",
        fileKind: "literature",
        accessClass: "public",
        originalFilename: "paper.pdf",
        byteSize: 12,
      }),
    ).toThrow(/access class/i);

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        title: "Paper",
        fileKind: "literature",
        accessClass: "project",
        originalFilename: "",
        byteSize: 12,
      }),
    ).toThrow(/filename/i);

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        title: "Paper",
        fileKind: "literature",
        accessClass: "project",
        originalFilename: "paper.pdf",
        byteSize: 0,
      }),
    ).toThrow(/size/i);

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        title: "Paper",
        fileKind: "literature",
        accessClass: "project",
        originalFilename: "paper.pdf",
        byteSize: 12,
        rawBytes: new Uint8Array([1, 2, 3]),
      } as never),
    ).toThrow(/raw bytes/i);
  });

  it("requires a change summary when creating a new version", async () => {
    const actions = await import("./file-actions");

    expect(() =>
      actions.parseFileUploadIntentRequest({
        projectId: "project-1",
        researchFileId: "file-1",
        fileKind: "literature",
        accessClass: "project",
        originalFilename: "paper-v2.pdf",
        byteSize: 12,
        changeSummary: "   ",
      }),
    ).toThrow(/change summary/i);
  });

  it("uses the current member as upload actor and ignores caller-supplied actor identity", async () => {
    const actions = await import("./file-actions");

    const result = await actions.requestFileUploadIntentAction({
      projectId: "project-1",
      title: "Paper",
      fileKind: "literature",
      accessClass: "project",
      originalFilename: "paper.pdf",
      byteSize: 12,
      declaredMediaType: "application/pdf",
      actorId: "forged-actor",
    } as never);

    expect(result).toEqual({
      uploadIntentId: "intent-1",
      uploadToken: "signed-upload-token",
      expiresAt: "2026-09-30T00:15:00.000Z",
      tusEndpoint: "http://tusd.internal:8080/files/",
    });
    expect(mocks.createFileUploadIntent).toHaveBeenCalledWith(
      expect.anything(),
      "project-1",
      expect.objectContaining({
        originalFilename: "paper.pdf",
        byteSize: 12,
      }),
      { type: "human", id: "member-from-session" },
      "test-upload-signing-secret",
      900,
      1048576,
    );
  });

  it("registers an external reference without any raw-file field and rejects credential locators", async () => {
    const actions = await import("./file-actions");
    const invalid = new FormData();
    invalid.set("projectId", "project-1");
    invalid.set("title", "Restricted dataset");
    invalid.set("fileKind", "dataset");
    invalid.set("accessClass", "restricted");
    invalid.set("uriOrLocator", "https://catalog.example/data?token=secret");
    invalid.set("manifestHash", "manifest-1");
    invalid.set("accessPolicyRef", "policy-1");
    invalid.set("versionLabel", "v1");

    await expect(actions.registerExternalDataAction(invalid)).rejects.toThrow(
      /credential|secret/i,
    );
    expect(mocks.registerExternalDataVersion).not.toHaveBeenCalled();

    const valid = new FormData();
    valid.set("projectId", "project-1");
    valid.set("title", "Restricted dataset");
    valid.set("fileKind", "dataset");
    valid.set("accessClass", "restricted");
    valid.set("uriOrLocator", "secure-datalake://study-42/release-1");
    valid.set("manifestHash", "manifest-1");
    valid.set("accessPolicyRef", "policy-1");
    valid.set("licenseOrAgreementRef", "agreement-1");
    valid.set("versionLabel", "v1");
    valid.set("actorId", "forged-actor");

    await actions.registerExternalDataAction(valid);
    const serviceInput = mocks.registerExternalDataVersion.mock.calls[0]?.[2];
    expect(serviceInput).not.toHaveProperty("rawBytes");
    expect(serviceInput).not.toHaveProperty("file");
    expect(mocks.registerExternalDataVersion.mock.calls[0]?.[3]).toEqual({
      type: "human",
      id: "member-from-session",
    });
  });

  it("accepts only approved file-link subject and relation values", async () => {
    const actions = await import("./file-actions");

    const invalidSubject = new FormData();
    invalidSubject.set("projectId", "project-1");
    invalidSubject.set("fileVersionId", "version-1");
    invalidSubject.set("subjectType", "arbitrary_table");
    invalidSubject.set("subjectId", "row-1");
    invalidSubject.set("relation", "documents");
    await expect(actions.createFileLinkAction(invalidSubject)).rejects.toThrow(
      /subject type/i,
    );

    const invalidRelation = new FormData();
    invalidRelation.set("projectId", "project-1");
    invalidRelation.set("fileVersionId", "version-1");
    invalidRelation.set("subjectType", "project");
    invalidRelation.set("subjectId", "project-1");
    invalidRelation.set("relation", "owns");
    await expect(actions.createFileLinkAction(invalidRelation)).rejects.toThrow(
      /relation/i,
    );
  });
});
