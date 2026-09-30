"use server";

import { revalidatePath } from "next/cache";
import { createFileUploadIntent } from "@research-workbench/application/src/files/upload-intent";
import { registerExternalDataVersion } from "@research-workbench/application/src/files/file-service";
import {
  createFileLink,
  retireFileLink,
} from "@research-workbench/application/src/files/file-links";
import {
  FILE_LINK_RELATIONS,
  FILE_LINK_SUBJECT_TYPES,
  assertFileAccessClass,
  assertFileKind,
  assertSafeExternalLocator,
  type FileLinkRelation,
  type FileLinkSubjectType,
} from "@research-workbench/domain/src/research-file";
import { loadFileUploadConfig } from "../../../../packages/config/src/env";
import {
  getWebDbClient,
  requireCurrentMember,
} from "./queries";
import {
  parseFileUploadIntentRequest,
  type FileUploadIntentActionRequest,
} from "./file-action-input";

function requiredFormText(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalFormText(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? "").trim();
  return value || undefined;
}

function revalidateFileWorkspace(projectId: string, researchFileId?: string) {
  revalidatePath(`/projects/${projectId}/files`);
  if (researchFileId) {
    revalidatePath(`/projects/${projectId}/files/${researchFileId}`);
  }
}

export async function requestFileUploadIntentAction(
  input: FileUploadIntentActionRequest,
): Promise<{
  uploadIntentId: string;
  uploadToken: string;
  expiresAt: string;
  tusEndpoint: string;
}> {
  const member = await requireCurrentMember();
  const parsed = parseFileUploadIntentRequest(input);
  const config = loadFileUploadConfig(process.env);
  const signingSecret = process.env[config.uploadSigningSecret.key]?.trim();
  if (!signingSecret) {
    throw new Error("Upload signing secret is unavailable");
  }

  const intent = await createFileUploadIntent(
    getWebDbClient().sql,
    parsed.projectId,
    {
      ...(parsed.researchFileId ? { researchFileId: parsed.researchFileId } : {}),
      ...(parsed.title ? { title: parsed.title } : {}),
      fileKind: parsed.fileKind,
      accessClass: parsed.accessClass,
      originalFilename: parsed.originalFilename,
      byteSize: parsed.byteSize,
      ...(parsed.declaredMediaType
        ? { declaredMediaType: parsed.declaredMediaType }
        : {}),
      ...(parsed.changeSummary ? { changeSummary: parsed.changeSummary } : {}),
    },
    { type: "human", id: member.id },
    signingSecret,
    config.uploadHookTtlSeconds,
    config.maxFileBytes,
  );

  return {
    uploadIntentId: intent.uploadIntentId,
    uploadToken: intent.uploadToken,
    expiresAt: intent.expiresAt.toISOString(),
    tusEndpoint: config.tusEndpoint,
  };
}

export async function registerExternalDataAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const projectId = requiredFormText(formData, "projectId");
  const fileKind = requiredFormText(formData, "fileKind");
  const accessClass = requiredFormText(formData, "accessClass");
  const uriOrLocator = requiredFormText(formData, "uriOrLocator");
  assertFileKind(fileKind);
  assertFileAccessClass(accessClass);
  assertSafeExternalLocator(uriOrLocator);

  const result = await registerExternalDataVersion(
    getWebDbClient().sql,
    projectId,
    {
      ...(optionalFormText(formData, "researchFileId")
        ? { researchFileId: optionalFormText(formData, "researchFileId") }
        : {}),
      ...(optionalFormText(formData, "title")
        ? { title: optionalFormText(formData, "title") }
        : {}),
      fileKind,
      accessClass,
      uriOrLocator,
      manifestHash: requiredFormText(formData, "manifestHash"),
      accessPolicyRef: requiredFormText(formData, "accessPolicyRef"),
      ...(optionalFormText(formData, "licenseOrAgreementRef")
        ? { licenseOrAgreementRef: optionalFormText(formData, "licenseOrAgreementRef") }
        : {}),
      versionLabel: requiredFormText(formData, "versionLabel"),
      ...(optionalFormText(formData, "changeSummary")
        ? { changeSummary: optionalFormText(formData, "changeSummary") }
        : {}),
    },
    { type: "human", id: member.id },
  );

  revalidateFileWorkspace(projectId, result.researchFile.id);
}

export async function createFileLinkAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const projectId = requiredFormText(formData, "projectId");
  const fileVersionId = requiredFormText(formData, "fileVersionId");
  const subjectType = requiredFormText(formData, "subjectType");
  const subjectId = requiredFormText(formData, "subjectId");
  const relation = requiredFormText(formData, "relation");

  if (!(FILE_LINK_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    throw new Error("Unsupported file link subject type");
  }
  if (!(FILE_LINK_RELATIONS as readonly string[]).includes(relation)) {
    throw new Error("Unsupported file link relation");
  }

  await createFileLink(
    getWebDbClient().sql,
    {
      fileVersionId,
      subjectType: subjectType as FileLinkSubjectType,
      subjectId,
      relation: relation as FileLinkRelation,
    },
    { type: "human", id: member.id },
  );
  revalidateFileWorkspace(projectId);
}

export async function retireFileLinkAction(formData: FormData): Promise<void> {
  const member = await requireCurrentMember();
  const projectId = requiredFormText(formData, "projectId");
  const fileLinkId = requiredFormText(formData, "fileLinkId");
  const reason = requiredFormText(formData, "reason");

  await retireFileLink(
    getWebDbClient().sql,
    fileLinkId,
    reason,
    { type: "human", id: member.id },
  );
  revalidateFileWorkspace(projectId);
}
