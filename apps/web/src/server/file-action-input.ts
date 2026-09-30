import {
  assertFileAccessClass,
  assertFileKind,
  type FileAccessClass,
  type FileKind,
} from "@research-workbench/domain/src/research-file";

export type FileUploadIntentActionRequest = {
  projectId: string;
  researchFileId?: string;
  title?: string;
  fileKind: string;
  accessClass: string;
  originalFilename: string;
  byteSize: number;
  declaredMediaType?: string | null;
  changeSummary?: string | null;
};

export type ParsedFileUploadIntentRequest = {
  projectId: string;
  researchFileId?: string;
  title?: string;
  fileKind: FileKind;
  accessClass: FileAccessClass;
  originalFilename: string;
  byteSize: number;
  declaredMediaType?: string | null;
  changeSummary?: string | null;
};

function requiredText(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function parseFileUploadIntentRequest(
  input: FileUploadIntentActionRequest,
): ParsedFileUploadIntentRequest {
  const raw = input as unknown as Record<string, unknown>;
  if ("rawBytes" in raw || "bytes" in raw || "file" in raw) {
    throw new Error("Raw bytes are not accepted by the upload-intent action");
  }

  const projectId = requiredText(input.projectId, "Project");
  const fileKind = requiredText(input.fileKind, "File kind");
  const accessClass = requiredText(input.accessClass, "Access class");
  const originalFilename = requiredText(input.originalFilename, "Original filename");
  assertFileKind(fileKind);
  assertFileAccessClass(accessClass);

  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    throw new Error("Upload size must be a positive safe integer");
  }

  const researchFileId = input.researchFileId?.trim() || undefined;
  const title = input.title?.trim() || undefined;
  const changeSummary = input.changeSummary?.trim() || undefined;

  if (researchFileId) {
    if (!changeSummary) throw new Error("Change summary is required for a new version");
  } else if (!title) {
    throw new Error("Title is required for a new research file");
  }

  return {
    projectId,
    ...(researchFileId ? { researchFileId } : {}),
    ...(title ? { title } : {}),
    fileKind,
    accessClass,
    originalFilename,
    byteSize: input.byteSize,
    ...(input.declaredMediaType?.trim()
      ? { declaredMediaType: input.declaredMediaType.trim() }
      : {}),
    ...(changeSummary ? { changeSummary } : {}),
  };
}
