import type { DatabaseSql } from "@research-workbench/db/src/client";
import type { ClaimedOutboxRecord } from "@research-workbench/queue/src/outbox-dispatcher";
import { S3ObjectStorage } from "@research-workbench/storage/src/s3";
import { ClamAvScannerAdapter } from "@research-workbench/file-processing/src/clamav";
import { TikaMetadataExtractor } from "@research-workbench/file-processing/src/tika";
import { DoclingRichDocumentParser } from "@research-workbench/file-processing/src/docling";
import { createFileOutboxHandler } from "./file-worker";
import type { OutboxDispatchHandler } from "./outbox-worker";

export type FileRuntimeConfig = {
  s3Endpoint: string;
  s3Region: string;
  s3ForcePathStyle: boolean;
  quarantineBucket: string;
  readyBucket: string;
  readyPrefix: string;
  derivedPrefix: string;
  clamavEndpoint: { socketPath: string } | { host: string; port: number };
  tikaBaseUrl: string;
  doclingBaseUrl: string;
  maxFileBytes: number;
  maxExtractedSearchBytes: number;
};

export type BooleanOutboxHandler = (
  record: ClaimedOutboxRecord,
) => Promise<boolean>;

export class UnhandledOutboxEvent extends Error {
  constructor(eventType: string) {
    super(`Unhandled outbox event: ${eventType}`);
    this.name = "UnhandledOutboxEvent";
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  if (isPrivateIpv4(normalized)) return true;
  if (!normalized.includes(".")) return true;
  return (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function validatePrivateHttpUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid private HTTP(S) URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use private HTTP(S)`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not embed credentials, query parameters, or fragments`);
  }
  if (!isPrivateHostname(parsed.hostname)) {
    throw new Error(`${label} must resolve through a private service endpoint`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requirePrefix(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.startsWith("/") || !normalized.endsWith("/")) {
    throw new Error(`${label} must be a relative prefix ending in /`);
  }
  return normalized;
}

function validateClamAvEndpoint(
  endpoint: FileRuntimeConfig["clamavEndpoint"],
): FileRuntimeConfig["clamavEndpoint"] {
  if ("socketPath" in endpoint) {
    if (!endpoint.socketPath.trim() || !endpoint.socketPath.startsWith("/")) {
      throw new Error("ClamAV socket path must be an absolute private path");
    }
    return endpoint;
  }
  if (!isPrivateHostname(endpoint.host)) {
    throw new Error("ClamAV host must be a private service endpoint");
  }
  requirePositiveInteger(endpoint.port, "ClamAV port");
  if (endpoint.port > 65535) throw new Error("ClamAV port must be <= 65535");
  return endpoint;
}

function validateRuntimeConfig(config: FileRuntimeConfig): FileRuntimeConfig {
  return {
    ...config,
    s3Endpoint: validatePrivateHttpUrl(config.s3Endpoint, "S3 endpoint"),
    tikaBaseUrl: validatePrivateHttpUrl(config.tikaBaseUrl, "Tika endpoint"),
    doclingBaseUrl: validatePrivateHttpUrl(config.doclingBaseUrl, "Docling endpoint"),
    quarantineBucket: config.quarantineBucket.trim() || (() => { throw new Error("Quarantine bucket is required"); })(),
    readyBucket: config.readyBucket.trim() || (() => { throw new Error("Ready bucket is required"); })(),
    readyPrefix: requirePrefix(config.readyPrefix, "Ready prefix"),
    derivedPrefix: requirePrefix(config.derivedPrefix, "Derived prefix"),
    clamavEndpoint: validateClamAvEndpoint(config.clamavEndpoint),
    maxFileBytes: requirePositiveInteger(config.maxFileBytes, "Maximum file size"),
    maxExtractedSearchBytes: requirePositiveInteger(
      config.maxExtractedSearchBytes,
      "Maximum extracted search size",
    ),
  };
}

export function composeOutboxHandlers(
  ...handlers: BooleanOutboxHandler[]
): OutboxDispatchHandler {
  return async (record) => {
    for (const handler of handlers) {
      if (await handler(record)) return;
    }
    throw new UnhandledOutboxEvent(record.eventType);
  };
}

export function createProductionFileOutboxHandler(
  sql: DatabaseSql,
  config: FileRuntimeConfig,
  secrets: { s3AccessKeyId: string; s3SecretAccessKey: string },
): BooleanOutboxHandler {
  const validated = validateRuntimeConfig(config);
  if (!secrets.s3AccessKeyId.trim() || !secrets.s3SecretAccessKey.trim()) {
    throw new Error("S3 credentials are required");
  }

  const storage = new S3ObjectStorage({
    endpoint: validated.s3Endpoint,
    region: validated.s3Region,
    pathStyle: validated.s3ForcePathStyle,
    credentials: {
      accessKeyId: secrets.s3AccessKeyId,
      secretAccessKey: secrets.s3SecretAccessKey,
    },
  });

  return createFileOutboxHandler(sql, {
    storage,
    scanner: new ClamAvScannerAdapter({
      endpoint: validated.clamavEndpoint,
      timeoutMs: 30_000,
    }),
    metadataExtractor: new TikaMetadataExtractor({
      baseUrl: validated.tikaBaseUrl,
      processorVersion: "4.0.0",
      timeoutMs: 30_000,
      maxOutputBytes: 16 * 1024 * 1024,
    }),
    richParser: new DoclingRichDocumentParser({
      baseUrl: validated.doclingBaseUrl,
      processorVersion: "1.35.0",
      timeoutMs: 60_000,
      maxOutputBytes: 64 * 1024 * 1024,
    }),
    quarantineBucket: validated.quarantineBucket,
    readyBucket: validated.readyBucket,
    readyPrefix: validated.readyPrefix,
    derivedPrefix: validated.derivedPrefix,
    maxExtractedSearchBytes: validated.maxExtractedSearchBytes,
    metrics: {
      increment() {},
      observe() {},
    },
  });
}
