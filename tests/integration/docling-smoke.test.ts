import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configured = Boolean(process.env.DOCLING_BASE_URL);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Docling adapter smoke", () => {
  it.skipIf(!configured)(
    "converts an uploaded document into structured artifacts",
    async () => {
      const { DoclingRichDocumentParser } = await import(
        "../../packages/file-processing/src/docling"
      );
      const dir = await mkdtemp(join(tmpdir(), "rw-docling-"));
      dirs.push(dir);
      const path = join(dir, "notes.md");
      await writeFile(path, "# Research Workbench\n\nDocling smoke text.");
      const adapter = new DoclingRichDocumentParser({
        baseUrl: process.env.DOCLING_BASE_URL!,
        processorVersion: "1.35.0",
        timeoutMs: 60_000,
        maxOutputBytes: 5_000_000,
      });
      const result = await adapter.parse(
        {
          path,
          originalFilename: "notes.md",
          byteSize: (await stat(path)).size,
          sha256: "d".repeat(64),
        },
        "text/markdown",
      );

      expect(result.supported).toBe(true);
      expect(result.artifacts.length).toBeGreaterThan(0);
      expect(result.artifacts.map((item) => item.kind)).toContain("markdown");
    },
  );
});
