import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configured =
  Boolean(process.env.CLAMAV_SOCKET_PATH) ||
  Boolean(process.env.CLAMAV_HOST && process.env.CLAMAV_PORT);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("ClamAV adapter smoke", () => {
  it.skipIf(!configured)(
    "distinguishes a clean file from the standard EICAR test signature",
    async () => {
      const { ClamAvScannerAdapter } = await import(
        "../../packages/file-processing/src/clamav"
      );
      const dir = await mkdtemp(join(tmpdir(), "rw-clamav-"));
      dirs.push(dir);
      const cleanPath = join(dir, "clean.txt");
      const eicarPath = join(dir, "eicar.com");
      const eicar =
        "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
      await writeFile(cleanPath, "Research Workbench clean fixture");
      await writeFile(eicarPath, eicar);

      const endpoint = process.env.CLAMAV_SOCKET_PATH
        ? { socketPath: process.env.CLAMAV_SOCKET_PATH }
        : {
            host: process.env.CLAMAV_HOST!,
            port: Number(process.env.CLAMAV_PORT),
          };
      const adapter = new ClamAvScannerAdapter({ endpoint, timeoutMs: 10_000 });

      const clean = await adapter.scan({
        path: cleanPath,
        originalFilename: "clean.txt",
        byteSize: (await stat(cleanPath)).size,
        sha256: "a".repeat(64),
      });
      const malware = await adapter.scan({
        path: eicarPath,
        originalFilename: "eicar.com",
        byteSize: (await stat(eicarPath)).size,
        sha256: "b".repeat(64),
      });

      expect(clean.verdict).toBe("clean");
      expect(malware.verdict).toBe("malware");
      expect(malware.signatureName).toMatch(/Eicar/i);
      expect(clean.scannerVersion).toBeTruthy();
      expect(clean.signatureDatabaseVersion).toBeTruthy();
    },
  );
});
