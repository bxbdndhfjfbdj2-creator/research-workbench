export const FILE_KINDS = [
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
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_ACCESS_CLASSES = ["project", "restricted"] as const;
export type FileAccessClass = (typeof FILE_ACCESS_CLASSES)[number];

export type FileSourceKind = "upload" | "external_reference";
export type FileScanStatus = "passed" | "not_applicable";
export type FileParseStatus = "parsed" | "failed" | "not_applicable";

export const FILE_UPLOAD_INTENT_STATES = [
  "initiated",
  "uploading",
  "uploaded_quarantine",
  "scanning",
  "rejected_malware",
  "accepted",
  "metadata_processing",
  "parsing",
  "ready",
  "ready_with_parse_error",
  "processing_failed",
] as const;
export type FileUploadIntentState = (typeof FILE_UPLOAD_INTENT_STATES)[number];

export const FILE_LINK_SUBJECT_TYPES = [
  "research_node_revision",
  "research_task",
  "research_result",
  "scientific_decision",
  "project",
  "data_version",
] as const;
export type FileLinkSubjectType = (typeof FILE_LINK_SUBJECT_TYPES)[number];

export const FILE_LINK_RELATIONS = [
  "documents",
  "input_to",
  "output_of",
  "supports",
  "challenges",
  "review_material",
  "source_for",
] as const;
export type FileLinkRelation = (typeof FILE_LINK_RELATIONS)[number];

export type ResearchFile = {
  id: string;
  projectId: string;
  title: string;
  fileKind: FileKind;
  description: string | null;
  currentVersionId: string | null;
  accessClass: FileAccessClass;
  lifecycleState: string;
  createdBy: string;
  createdAt: Date;
};

export type FileVersion = {
  id: string;
  researchFileId: string;
  versionNumber: number;
  blobId: string | null;
  externalReferenceId: string | null;
  originalFilename: string;
  mediaType: string | null;
  byteSize: number | null;
  sha256: string | null;
  sourceKind: FileSourceKind;
  sourceMetadata: Record<string, unknown>;
  changeSummary: string | null;
  scanStatus: FileScanStatus;
  parseStatus: FileParseStatus;
  createdBy: string;
  createdAt: Date;
};

export type FileBlob = {
  id: string;
  sha256: string;
  storageBackend: string;
  storageKey: string;
  byteSize: number;
  mediaTypeDetected: string | null;
  quarantineState: string;
  createdAt: Date;
};

export type ExternalDataReference = {
  id: string;
  projectId: string;
  uriOrLocator: string;
  manifestHash: string;
  accessPolicyRef: string;
  licenseOrAgreementRef: string | null;
  versionLabel: string;
  createdBy: string;
  createdAt: Date;
};

export type FileLink = {
  id: string;
  fileVersionId: string;
  subjectType: FileLinkSubjectType;
  subjectId: string;
  relation: FileLinkRelation;
  createdByType: "human" | "agent" | "system";
  createdById: string;
  createdAt: Date;
};

export type FileProcessingRecord = {
  id: string;
  fileVersionId: string;
  processorKind: string;
  processorName: string;
  processorVersion: string;
  status: "succeeded" | "failed";
  inputHash: string;
  outputRefs: string[];
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export function assertFileKind(value: string): asserts value is FileKind {
  if (!(FILE_KINDS as readonly string[]).includes(value)) {
    throw new Error("Unsupported file kind");
  }
}

export function assertFileAccessClass(value: string): asserts value is FileAccessClass {
  if (!(FILE_ACCESS_CLASSES as readonly string[]).includes(value)) {
    throw new Error("Unsupported file access class");
  }
}

const LOCATOR_SECRET_KEYS = new Set([
  "token",
  "secret",
  "password",
  "passwd",
  "credential",
  "signature",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
]);

function normalizeLocatorKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertSafeExternalLocator(value: string): void {
  const locator = value.trim();
  if (!locator) throw new Error("External locator is required");

  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    throw new Error("External locator must be an absolute controlled locator");
  }

  if (parsed.username || parsed.password) {
    throw new Error("External locator must not contain credentials");
  }

  for (const key of parsed.searchParams.keys()) {
    if (LOCATOR_SECRET_KEYS.has(normalizeLocatorKey(key))) {
      throw new Error("External locator must not contain secret credential parameters");
    }
  }
}
