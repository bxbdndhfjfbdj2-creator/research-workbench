import { describe, expect, it } from "vitest";

describe("file processing adapter contracts", () => {
  it("provides deterministic clean and malware scanner fakes", async () => {
    const modulePath = "./fakes";
    const { FakeMalwareScanner } = await import(modulePath);
    const input = {
      path: "/tmp/fixture.bin",
      originalFilename: "fixture.bin",
      byteSize: 12,
      sha256: "a".repeat(64),
    };

    const clean = new FakeMalwareScanner({
      verdict: "clean",
      scannerVersion: "fake-clamav-1",
      signatureDatabaseVersion: "fake-db-1",
    });
    await expect(clean.scan(input)).resolves.toEqual({
      verdict: "clean",
      signatureName: null,
      scannerVersion: "fake-clamav-1",
      signatureDatabaseVersion: "fake-db-1",
    });

    const malware = new FakeMalwareScanner({
      verdict: "malware",
      signatureName: "Eicar-Signature",
      scannerVersion: "fake-clamav-1",
      signatureDatabaseVersion: "fake-db-1",
    });
    await expect(malware.scan(input)).resolves.toMatchObject({
      verdict: "malware",
      signatureName: "Eicar-Signature",
    });
  });

  it("can force scanner and metadata failures without environment branching", async () => {
    const modulePath = "./fakes";
    const { FakeMalwareScanner, FakeMetadataExtractor } = await import(modulePath);
    const input = {
      path: "/tmp/failure.bin",
      originalFilename: "failure.bin",
      byteSize: 8,
      sha256: "b".repeat(64),
    };

    await expect(
      new FakeMalwareScanner({ errorCode: "SCANNER_UNAVAILABLE" }).scan(input),
    ).rejects.toThrow(/SCANNER_UNAVAILABLE/);

    await expect(
      new FakeMetadataExtractor({ errorCode: "TIKA_TIMEOUT" }).extract(input),
    ).rejects.toThrow(/TIKA_TIMEOUT/);
  });

  it("returns deterministic metadata artifacts", async () => {
    const modulePath = "./fakes";
    const { FakeMetadataExtractor } = await import(modulePath);
    const input = {
      path: "/tmp/paper.pdf",
      originalFilename: "paper.pdf",
      byteSize: 100,
      sha256: "c".repeat(64),
    };

    const extractor = new FakeMetadataExtractor({
      mediaTypeDetected: "application/pdf",
      metadataText: '{"title":"Paper"}',
      extractedText: "Research text",
      processorVersion: "fake-tika-1",
    });
    const result = await extractor.extract(input);

    expect(result.mediaTypeDetected).toBe("application/pdf");
    expect(new TextDecoder().decode(result.metadataArtifact)).toBe('{"title":"Paper"}');
    expect(new TextDecoder().decode(result.textArtifact!)).toBe("Research text");
    expect(result.processorVersion).toBe("fake-tika-1");
  });

  it("represents supported, unsupported and failed rich parsing", async () => {
    const modulePath = "./fakes";
    const { FakeRichDocumentParser } = await import(modulePath);
    const input = {
      path: "/tmp/paper.pdf",
      originalFilename: "paper.pdf",
      byteSize: 100,
      sha256: "d".repeat(64),
    };

    const supported = new FakeRichDocumentParser({
      supported: true,
      processorVersion: "fake-docling-1",
      artifacts: [
        { kind: "markdown", text: "# Paper" },
        { kind: "json", text: '{"type":"document"}' },
      ],
    });
    const parsed = await supported.parse(input, "application/pdf");
    expect(parsed.supported).toBe(true);
    expect(parsed.artifacts.map((item: { kind: string }) => item.kind)).toEqual([
      "markdown",
      "json",
    ]);
    expect(new TextDecoder().decode(parsed.artifacts[0]!.bytes)).toBe("# Paper");

    const unsupported = new FakeRichDocumentParser({
      supported: false,
      processorVersion: "fake-docling-1",
    });
    await expect(
      unsupported.parse(input, "application/octet-stream"),
    ).resolves.toEqual({
      supported: false,
      artifacts: [],
      processorVersion: "fake-docling-1",
    });

    await expect(
      new FakeRichDocumentParser({ errorCode: "DOCLING_FAILURE" }).parse(
        input,
        "application/pdf",
      ),
    ).rejects.toThrow(/DOCLING_FAILURE/);
  });
});
