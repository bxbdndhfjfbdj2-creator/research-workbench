import { readFile } from "node:fs/promises";
import type { DatabaseSql } from "../../../packages/db/src/client";
import { processCompletedUpload } from "../../../packages/application/src/files/process-upload";
import type {
  LocalFileInput,
  MalwareScannerPort,
  MetadataExtractorPort,
  RichDocumentParserPort,
} from "../../../packages/file-processing/src/types";
import { S3ObjectStorage } from "../../../packages/storage/src/s3";
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";

const ACCESS_KEY = "phase4a-acceptance-access";
const SECRET_KEY = "phase4a-acceptance-secret";
const REGION = "us-east-1";
const QUARANTINE_BUCKET = "rw-quarantine";
const READY_BUCKET = "rw-ready";
const QUARANTINE_PREFIX = "uploads/";
const READY_PREFIX = "ready/";
const DERIVED_PREFIX = "derived/";

async function contentText(input: LocalFileInput): Promise<string> {
  return (await readFile(input.path)).toString("utf8");
}

async function ensureAcceptanceBuckets(storage: S3ObjectStorage): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await storage.ensureBucket(QUARANTINE_BUCKET);
      await storage.ensureBucket(READY_BUCKET);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    `SeaweedFS S3 gateway did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

class AcceptanceScanner implements MalwareScannerPort {
  async scan(input: LocalFileInput) {
    const content = await contentText(input);
    const malware = content.includes("MALWARE_MARKER");
    return {
      verdict: malware ? ("malware" as const) : ("clean" as const),
      signatureName: malware ? "Acceptance-Malware-Marker" : null,
      scannerVersion: "clamav-acceptance",
      signatureDatabaseVersion: "1.0.0",
    };
  }
}

class AcceptanceMetadataExtractor implements MetadataExtractorPort {
  async extract(input: LocalFileInput) {
    const mediaTypeDetected = input.originalFilename.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : input.originalFilename.toLowerCase().endsWith(".txt")
        ? "text/plain"
        : "application/octet-stream";
    return {
      mediaTypeDetected,
      metadataArtifact: new TextEncoder().encode(
        JSON.stringify({ mediaTypeDetected, source: "acceptance" }),
      ),
      textArtifact: new TextEncoder().encode(
        "acceptance extracted text latent trust interview evidence",
      ),
      processorVersion: "1.0.0",
    };
  }
}

class AcceptanceRichParser implements RichDocumentParserPort {
  async parse(input: LocalFileInput, _mediaType: string) {
    const content = await contentText(input);
    if (content.includes("DOCLING_FAIL")) {
      throw new Error("ACCEPTANCE_DOCLING_FAILURE_WITH_SECRET_DETAILS");
    }
    return {
      supported: true,
      artifacts: [
        {
          kind: "markdown" as const,
          bytes: new TextEncoder().encode("# Acceptance parsed document"),
        },
        {
          kind: "json" as const,
          bytes: new TextEncoder().encode('{"type":"document","source":"acceptance"}'),
        },
      ],
      processorVersion: "1.0.0",
    };
  }
}

export type StartedFileAcceptanceServices = {
  tusEndpoint: string;
  webEnvironment: Record<string, string>;
  processLatestUpload: (
    sql: DatabaseSql,
    projectId: string,
  ) => Promise<{
    intentId: string;
    state: string;
    result: "ready" | "ready_with_parse_error" | "rejected_malware" | "already_terminal";
    researchFileId: string | null;
    fileVersionId: string | null;
  }>;
  getLatestUploadFacts: (
    sql: DatabaseSql,
    projectId: string,
  ) => Promise<{
    intentId: string;
    state: string;
    tusUploadId: string | null;
    researchFileId: string | null;
    inboxCount: number;
    completedOutboxCount: number;
    fileVersionCount: number;
  }>;
  stop: () => Promise<void>;
};

async function waitForLatestIntent(
  sql: DatabaseSql,
  projectId: string,
): Promise<{
  id: string;
  state: string;
  tus_upload_id: string | null;
  research_file_id: string | null;
}> {
  const deadline = Date.now() + 20_000;
  let latest:
    | {
        id: string;
        state: string;
        tus_upload_id: string | null;
        research_file_id: string | null;
      }
    | undefined;

  while (Date.now() < deadline) {
    const rows = await sql.unsafe(
      `select id, state, tus_upload_id, research_file_id
       from file_upload_intents
       where project_id = $1
       order by created_at desc, id desc
       limit 1`,
      [projectId],
    );
    const row = rows[0];
    if (row) {
      latest = {
        id: String(row.id),
        state: String(row.state),
        tus_upload_id: row.tus_upload_id ? String(row.tus_upload_id) : null,
        research_file_id: row.research_file_id ? String(row.research_file_id) : null,
      };
      if (
        [
          "uploaded_quarantine",
          "processing_failed",
          "ready",
          "ready_with_parse_error",
          "rejected_malware",
        ].includes(latest.state)
      ) {
        return latest;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Timed out waiting for completed tus upload intent: ${JSON.stringify(latest ?? null)}`,
  );
}

async function latestFacts(sql: DatabaseSql, projectId: string) {
  const intent = await waitForLatestIntent(sql, projectId);
  const inboxRows = await sql.unsafe(
    `select count(*)::int as count
     from integration_inbox
     where provider = 'tusd'
       and external_id = $1`,
    [intent.tus_upload_id ? `${intent.tus_upload_id}:post-finish` : "__none__"],
  );
  const outboxRows = await sql.unsafe(
    `select count(*)::int as count
     from outbox_events
     where event_type = 'file.upload.completed'
       and payload ->> 'uploadIntentId' = $1`,
    [intent.id],
  );
  const versionRows = intent.research_file_id
    ? await sql.unsafe(
        "select count(*)::int as count from file_versions where research_file_id = $1",
        [intent.research_file_id],
      )
    : [{ count: 0 }];

  return {
    intentId: intent.id,
    state: intent.state,
    tusUploadId: intent.tus_upload_id,
    researchFileId: intent.research_file_id,
    inboxCount: Number(inboxRows[0]?.count ?? 0),
    completedOutboxCount: Number(outboxRows[0]?.count ?? 0),
    fileVersionCount: Number(versionRows[0]?.count ?? 0),
  };
}

export async function startFileAcceptanceServices(): Promise<StartedFileAcceptanceServices> {
  const network: StartedNetwork = await new Network().start();
  let seaweedLogTail = "";
  let seaweed: StartedTestContainer | undefined;
  let tusd: StartedTestContainer | undefined;

  try {
    seaweed = await new GenericContainer("chrislusf/seaweedfs:4.47")
      .withNetwork(network)
      .withNetworkAliases("seaweedfs")
      .withCommand(["server", "-s3", "-s3.port=8333", "-s3.ip.bind=0.0.0.0"])
      .withExposedPorts(8333)
      .withLogConsumer((stream) => {
        stream.on("data", (chunk) => {
          seaweedLogTail = `${seaweedLogTail}${String(chunk)}`.slice(-12_000);
        });
      })
      .withWaitStrategy(
        Wait.forLogMessage(/Start Seaweed S3 API Server .* at http port 8333/),
      )
      .withStartupTimeout(120_000)
      .start();

    const s3Endpoint = `http://${seaweed.getHost()}:${seaweed.getMappedPort(8333)}`;
    const storage = new S3ObjectStorage({
      endpoint: s3Endpoint,
      region: REGION,
      credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
      pathStyle: true,
    });
    let s3Probe = "not-run";
    try {
      const response = await fetch(s3Endpoint, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      s3Probe = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch (error) {
      s3Probe = `ERROR ${error instanceof Error ? error.message : String(error)}`;
    }

    try {
      await ensureAcceptanceBuckets(storage);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nS3 probe: ${s3Probe}\nSeaweedFS logs:\n${seaweedLogTail}`,
      );
    }

    tusd = await new GenericContainer("ghcr.io/tus/tusd:v2.9.2")
      .withNetwork(network)
      .withNetworkAliases("tusd")
      .withExtraHosts([{ host: "host.testcontainers.internal", ipAddress: "host-gateway" }])
      .withEnvironment({
        AWS_ACCESS_KEY_ID: ACCESS_KEY,
        AWS_SECRET_ACCESS_KEY: SECRET_KEY,
        AWS_REGION: REGION,
      })
      .withCommand([
        "-host=0.0.0.0",
        "-port=1080",
        "-base-path=/files/",
        `-s3-bucket=${QUARANTINE_BUCKET}`,
        "-s3-endpoint=http://seaweedfs:8333",
        `-s3-object-prefix=${QUARANTINE_PREFIX}`,
        "-hooks-http=http://host.testcontainers.internal:3100/api/internal/file-upload-hook",
        "-hooks-enabled-events=pre-create,post-finish",
        "-hooks-http-retry=3",
        "-hooks-http-backoff=1s",
        "-max-size=16777216",
        "-disable-download",
        "-disable-termination",
        "-cors-allow-origin=http://127.0.0.1:3100",
        "-cors-allow-methods=POST,PATCH,HEAD,DELETE,OPTIONS",
        "-cors-allow-headers=Content-Type,Upload-Offset,Upload-Length,Upload-Metadata,Tus-Resumable,X-Workbench-Upload-Token",
        "-cors-expose-headers=Upload-Offset,Upload-Length,Location,Tus-Resumable,Tus-Version,Tus-Extension,Tus-Max-Size,Upload-Metadata",
      ])
      .withExposedPorts(1080)
      .withStartupTimeout(120_000)
      .start();

    const tusEndpoint = `http://${tusd.getHost()}:${tusd.getMappedPort(1080)}/files/`;
    const processingDeps = {
      storage,
      scanner: new AcceptanceScanner(),
      metadataExtractor: new AcceptanceMetadataExtractor(),
      richParser: new AcceptanceRichParser(),
      quarantineBucket: QUARANTINE_BUCKET,
      readyBucket: READY_BUCKET,
      readyPrefix: READY_PREFIX,
      derivedPrefix: DERIVED_PREFIX,
      maxExtractedSearchBytes: 4096,
      metrics: {
        increment(_name: string) {},
        observe(_name: string, _value: number) {},
      },
    };

    return {
      tusEndpoint,
      webEnvironment: {
        FILE_UPLOAD_SIGNING_SECRET: "phase4a-acceptance-upload-signing-secret",
        FILE_STORAGE_ACCESS_KEY_ID: ACCESS_KEY,
        FILE_STORAGE_SECRET_ACCESS_KEY: SECRET_KEY,
        TUS_ENDPOINT: tusEndpoint,
        FILE_QUARANTINE_BUCKET: QUARANTINE_BUCKET,
        FILE_QUARANTINE_PREFIX: QUARANTINE_PREFIX,
        FILE_MAX_BYTES: "16777216",
        FILE_UPLOAD_HOOK_TTL_SECONDS: "3600",
        FILE_S3_ENDPOINT: s3Endpoint,
        FILE_S3_REGION: REGION,
        FILE_S3_FORCE_PATH_STYLE: "true",
        FILE_READY_BUCKET: READY_BUCKET,
      },
      async processLatestUpload(sql, projectId) {
        const intent = await waitForLatestIntent(sql, projectId);
        const result = await processCompletedUpload(sql, intent.id, processingDeps);
        const facts = await latestFacts(sql, projectId);
        const currentRows = facts.researchFileId
          ? await sql.unsafe(
              "select current_version_id from research_files where id = $1",
              [facts.researchFileId],
            )
          : [];
        return {
          intentId: facts.intentId,
          state: facts.state,
          result,
          researchFileId: facts.researchFileId,
          fileVersionId: currentRows[0]?.current_version_id
            ? String(currentRows[0].current_version_id)
            : null,
        };
      },
      getLatestUploadFacts(sql, projectId) {
        return latestFacts(sql, projectId);
      },
      async stop() {
        await tusd?.stop();
        await seaweed?.stop();
        await network.stop();
      },
    };
  } catch (error) {
    await tusd?.stop().catch(() => undefined);
    await seaweed?.stop().catch(() => undefined);
    await network.stop().catch(() => undefined);
    throw error;
  }
}
