import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configured = Boolean(process.env.TIKA_BASE_URL);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("Tika adapter smoke", () => {
  it.skipIf(!configured)(
    "detects media type and extracts recursive metadata text",
    async () => {
      const { TikaMetadataExtractor } = await import(
        "../../packages/file-processing/src/tika"
      );
      const dir = await mkdtemp(join(tmpdir(), "rw-tika-"));
      dirs.push(dir);
      const path = join(dir, "notes.txt");
      await writeFile(path, "Research Workbench Tika smoke text");
      const adapter = new TikaMetadataExtractor({
        baseUrl: process.env.TIKA_BASE_URL!,
        processorVersion: "4.0.0",
        timeoutMs: 15_000,
        maxOutputBytes: 1_000_000,
      });
      const result = await adapter.extract({
        path,
        originalFilename: "notes.txt",
        byteSize: (await stat(path)).size,
        sha256: "c".repeat(64),
      });

      expect(result.mediaTypeDetected).toMatch(/^text\/plain/);
      expect(new TextDecoder().decode(result.metadataArtifact)).toContain(
        "Content-Type",
      );
      expect(new TextDecoder().decode(result.textArtifact!)).toContain(
        "Research Workbench Tika smoke text",
      );
    },
  );
});
