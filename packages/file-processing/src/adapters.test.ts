import { describe, expect, it, vi } from "vitest";

const input = {
  path: "/tmp/paper.pdf",
  originalFilename: "paper.pdf",
  byteSize: 100,
  sha256: "a".repeat(64),
};

describe("production file processing adapters", () => {
  it("parses clamd replies and encodes INSTREAM chunks", async () => {
    const modulePath = "./clamav";
    const clamav = await import(modulePath);

    expect(clamav.parseClamdScanReply("stream: OK\0")).toEqual({
      verdict: "clean",
      signatureName: null,
    });
    expect(clamav.parseClamdScanReply("stream: Eicar-Signature FOUND\0")).toEqual({
      verdict: "malware",
      signatureName: "Eicar-Signature",
    });
    expect(
      clamav.parseClamdVersionReply(
        "ClamAV 1.5.4/27800/Mon Sep 28 00:00:00 2026\0",
      ),
    ).toEqual({
      scannerVersion: "1.5.4",
      signatureDatabaseVersion: "27800",
    });

    expect([...clamav.encodeClamdChunk(new Uint8Array([1, 2, 3]))]).toEqual([
      0, 0, 0, 3, 1, 2, 3,
    ]);
    expect([...clamav.encodeClamdChunk(new Uint8Array())]).toEqual([0, 0, 0, 0]);
  });

  it("uses Tika 4 detect and recursive metadata text endpoints", async () => {
    const modulePath = "./tika";
    const { TikaMetadataExtractor } = await import(modulePath);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/detect")) {
        return new Response("application/pdf\n", { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            "Content-Type": "application/pdf",
            "X-TIKA:content": "Research text",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new TikaMetadataExtractor({
      baseUrl: "http://tika:9998",
      processorVersion: "4.0.0",
      timeoutMs: 1_000,
      maxOutputBytes: 10_000,
      fetchImpl: fakeFetch,
      readFileImpl: async () => new Uint8Array([37, 80, 68, 70]),
    });
    const result = await adapter.extract(input);

    expect(calls.map((call) => call.url)).toEqual([
      "http://tika:9998/detect",
      "http://tika:9998/rmeta/text",
    ]);
    expect(calls.every((call) => call.init?.method === "PUT")).toBe(true);
    expect(result.mediaTypeDetected).toBe("application/pdf");
    expect(new TextDecoder().decode(result.textArtifact!)).toContain("Research text");
    expect(result.processorVersion).toBe("4.0.0");
  });

  it("posts one file to Docling v1 and returns requested structured artifacts", async () => {
    const modulePath = "./docling";
    const { DoclingRichDocumentParser } = await import(modulePath);
    const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("http://docling:5001/v1/convert/file");
      expect(init?.method).toBe("POST");
      const form = init?.body as FormData;
      expect(form.getAll("to_formats")).toEqual(["json", "md", "html"]);
      expect(form.get("files")).toBeInstanceOf(Blob);
      return new Response(
        JSON.stringify({
          document: {
            json_content: { schema_name: "DoclingDocument" },
            md_content: "# Paper",
            html_content: "<h1>Paper</h1>",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new DoclingRichDocumentParser({
      baseUrl: "http://docling:5001",
      processorVersion: "1.35.0",
      timeoutMs: 1_000,
      maxOutputBytes: 10_000,
      fetchImpl: fakeFetch,
      readFileImpl: async () => new Uint8Array([37, 80, 68, 70]),
    });
    const result = await adapter.parse(input, "application/pdf");

    expect(result.supported).toBe(true);
    expect(result.artifacts.map((item: { kind: string }) => item.kind).sort()).toEqual([
      "html",
      "json",
      "markdown",
    ]);
  });
});
