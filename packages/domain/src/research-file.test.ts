import { describe, expect, it } from "vitest";

describe("research file domain", () => {
  it("accepts the approved file kinds and rejects an unknown kind", async () => {
    const modulePath = "./research-file";
    const domain = await import(modulePath);
    const expectedKinds = [
      "literature",
      "data_documentation",
      "dataset",
      "analysis_output",
      "code_archive",
      "research_design",
      "manuscript",
      "review_material",
      "meeting_note",
      "ethics_or_license",
      "presentation",
      "general_attachment",
    ];

    expect(domain.FILE_KINDS).toEqual(expectedKinds);
    for (const kind of expectedKinds) {
      expect(() => domain.assertFileKind(kind)).not.toThrow();
    }
    expect(() => domain.assertFileKind("unknown_kind")).toThrow(/file kind/i);
  });

  it("validates access classes", async () => {
    const modulePath = "./research-file";
    const domain = await import(modulePath);

    expect(() => domain.assertFileAccessClass("project")).not.toThrow();
    expect(() => domain.assertFileAccessClass("restricted")).not.toThrow();
    expect(() => domain.assertFileAccessClass("public")).toThrow(/access class/i);
  });

  it("rejects credential-bearing external locators", async () => {
    const modulePath = "./research-file";
    const domain = await import(modulePath);

    const rejected = [
      "https://user:password@example.test/data",
      "https://example.test/data?token=secret",
      "https://example.test/data?api_key=secret",
      "https://example.test/data?signature=secret",
      "https://object.example.test/data?X-Amz-Credential=AKIA%2Fscope&X-Amz-Signature=deadbeef",
      "https://object.example.test/data?X-Amz-Security-Token=session-token",
    ];
    for (const locator of rejected) {
      expect(() => domain.assertSafeExternalLocator(locator)).toThrow(/credential|secret/i);
    }

    for (const locator of [
      "https://catalog.example.test/dataset/42",
      "s3://controlled-bucket/project/data-v1",
      "secure-datalake://study-42/release-7",
      "catalog:icpsr:12345:v2",
    ]) {
      expect(() => domain.assertSafeExternalLocator(locator)).not.toThrow();
    }
  });
});
