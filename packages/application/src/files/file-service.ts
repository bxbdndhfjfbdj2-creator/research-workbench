import { randomUUID } from "node:crypto";
import type { DatabaseSql } from "@research-workbench/db/src/client";
import { assertHumanActor, type ActorRef } from "@research-workbench/domain/src/actor";
import {
  assertFileAccessClass,
  assertFileKind,
  assertSafeExternalLocator,
  type ExternalDataReference,
  type FileAccessClass,
  type FileKind,
  type FileVersion,
  type ResearchFile,
} from "@research-workbench/domain/src/research-file";
import { authorizeProjectAccess } from "../auth/authorize";
import { appendResearchEvent } from "../events/append-research-event";
import { enqueueOutbox } from "../outbox/enqueue-outbox";
import { runInTransaction, type TransactionSql } from "../transactions";

type ResearchFileRow = {
  id: string;
  project_id: string;
  title: string;
  file_kind: FileKind;
  description: string | null;
  current_version_id: string | null;
  access_class: FileAccessClass;
  lifecycle_state: string;
  created_by: string;
  created_at: Date;
};

type ExternalReferenceRow = {
  id: string;
  project_id: string;
  uri_or_locator: string;
  manifest_hash: string;
  access_policy_ref: string;
  license_or_agreement_ref: string | null;
  version_label: string;
  created_by: string;
  created_at: Date;
};

type FileVersionRow = {
  id: string;
  research_file_id: string;
  version_number: number;
  blob_id: string | null;
  external_reference_id: string | null;
  original_filename: string;
  media_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  source_kind: "upload" | "external_reference";
  source_metadata: Record<string, unknown>;
  change_summary: string | null;
  scan_status: "passed" | "not_applicable";
  parse_status: "parsed" | "failed" | "not_applicable";
  created_by: string;
  created_at: Date;
};

function toResearchFile(row: ResearchFileRow): ResearchFile {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    fileKind: row.file_kind,
    description: row.description,
    currentVersionId: row.current_version_id,
    accessClass: row.access_class,
    lifecycleState: row.lifecycle_state,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toExternalReference(row: ExternalReferenceRow): ExternalDataReference {
  return {
    id: row.id,
    projectId: row.project_id,
    uriOrLocator: row.uri_or_locator,
    manifestHash: row.manifest_hash,
    accessPolicyRef: row.access_policy_ref,
    licenseOrAgreementRef: row.license_or_agreement_ref,
    versionLabel: row.version_label,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toFileVersion(row: FileVersionRow): FileVersion {
  return {
    id: row.id,
    researchFileId: row.research_file_id,
    versionNumber: Number(row.version_number),
    blobId: row.blob_id,
    externalReferenceId: row.external_reference_id,
    originalFilename: row.original_filename,
    mediaType: row.media_type,
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    sha256: row.sha256,
    sourceKind: row.source_kind,
    sourceMetadata: row.source_metadata,
    changeSummary: row.change_summary,
    scanStatus: row.scan_status,
    parseStatus: row.parse_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function requireText(value: string | undefined | null, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

async function insertResearchFile(
  tx: TransactionSql,
  projectId: string,
  input: { title: string; fileKind: FileKind; description?: string | null; accessClass: FileAccessClass },
  actor: ActorRef,
): Promise<ResearchFileRow> {
  const id = randomUUID();
  const rows = (await tx.unsafe(
    `insert into research_files
      (id, project_id, title, file_kind, description, access_class, lifecycle_state, created_by)
     values ($1, $2, $3, $4, $5, $6, 'draft', $7)
     returning id, project_id, title, file_kind, description, current_version_id,
               access_class, lifecycle_state, created_by, created_at`,
    [
      id,
      projectId,
      requireText(input.title, "Research file title"),
      input.fileKind,
      input.description?.trim() || null,
      input.accessClass,
      actor.id,
    ],
  )) as readonly ResearchFileRow[];

  await appendResearchEvent(tx, {
    id: randomUUID(),
    projectId,
    eventType: "RESEARCH_FILE_CREATED",
    actor,
    payload: {
      researchFileId: id,
      fileKind: input.fileKind,
      accessClass: input.accessClass,
    },
  });
  await enqueueOutbox(tx, {
    id: randomUUID(),
    eventType: "research.file.created",
    payload: { projectId, researchFileId: id },
  });

  const row = rows[0];
  if (!row) throw new Error("Research file insert returned no row");
  return row;
}

export async function createResearchFile(
  sql: DatabaseSql,
  projectId: string,
  input: { title: string; fileKind: FileKind; description?: string | null; accessClass: FileAccessClass },
  actor: ActorRef,
): Promise<ResearchFile> {
  assertHumanActor(actor);
  assertFileKind(input.fileKind);
  assertFileAccessClass(input.accessClass);
  requireText(input.title, "Research file title");
  await authorizeProjectAccess(sql, actor.id, projectId, "file_write");

  return runInTransaction(sql, async (tx) =>
    toResearchFile(await insertResearchFile(tx, projectId, input, actor)),
  );
}

export async function registerExternalDataVersion(
  sql: DatabaseSql,
  projectId: string,
  input: {
    researchFileId?: string;
    title?: string;
    fileKind: FileKind;
    accessClass: FileAccessClass;
    uriOrLocator: string;
    manifestHash: string;
    accessPolicyRef: string;
    licenseOrAgreementRef?: string | null;
    versionLabel: string;
    changeSummary?: string | null;
  },
  actor: ActorRef,
): Promise<{
  researchFile: ResearchFile;
  externalReference: ExternalDataReference;
  fileVersion: FileVersion;
}> {
  assertHumanActor(actor);
  assertFileKind(input.fileKind);
  assertFileAccessClass(input.accessClass);
  assertSafeExternalLocator(input.uriOrLocator);
  if ("rawBytes" in (input as unknown as Record<string, unknown>) || "bytes" in (input as unknown as Record<string, unknown>)) {
    throw new Error("Raw bytes are not accepted by the external-reference API");
  }

  const manifestHash = requireText(input.manifestHash, "Manifest hash");
  const accessPolicyRef = requireText(input.accessPolicyRef, "Access policy reference");
  const versionLabel = requireText(input.versionLabel, "Version label");
  await authorizeProjectAccess(sql, actor.id, projectId, "file_write");

  return runInTransaction(sql, async (tx) => {
    let fileRow: ResearchFileRow;

    if (input.researchFileId) {
      const rows = (await tx.unsafe(
        `select id, project_id, title, file_kind, description, current_version_id,
                access_class, lifecycle_state, created_by, created_at
         from research_files
         where id = $1
         for update`,
        [input.researchFileId],
      )) as readonly ResearchFileRow[];
      const existing = rows[0];
      if (!existing) throw new Error("Research file not found");
      if (existing.project_id !== projectId) throw new Error("Research file belongs to a different project");
      if (existing.file_kind !== input.fileKind || existing.access_class !== input.accessClass) {
        throw new Error("New version must preserve the logical file kind and access class");
      }
      requireText(input.changeSummary, "Change summary");
      fileRow = existing;
    } else {
      fileRow = await insertResearchFile(
        tx,
        projectId,
        {
          title: requireText(input.title, "Research file title"),
          fileKind: input.fileKind,
          accessClass: input.accessClass,
        },
        actor,
      );
    }

    const externalReferenceId = randomUUID();
    const referenceRows = (await tx.unsafe(
      `insert into external_data_references
        (id, project_id, uri_or_locator, manifest_hash, access_policy_ref,
         license_or_agreement_ref, version_label, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, project_id, uri_or_locator, manifest_hash, access_policy_ref,
                 license_or_agreement_ref, version_label, created_by, created_at`,
      [
        externalReferenceId,
        projectId,
        input.uriOrLocator.trim(),
        manifestHash,
        accessPolicyRef,
        input.licenseOrAgreementRef?.trim() || null,
        versionLabel,
        actor.id,
      ],
    )) as readonly ExternalReferenceRow[];

    const versionRows = await tx.unsafe(
      "select coalesce(max(version_number), 0)::int + 1 as next_version from file_versions where research_file_id = $1",
      [fileRow.id],
    );
    const versionNumber = Number(versionRows[0]?.next_version ?? 1);
    const fileVersionId = randomUUID();
    const insertedVersions = (await tx.unsafe(
      `insert into file_versions
        (id, research_file_id, version_number, external_reference_id, original_filename,
         source_kind, source_metadata, change_summary, scan_status, parse_status, created_by)
       values ($1, $2, $3, $4, $5, 'external_reference', $6::jsonb, $7, 'not_applicable', 'not_applicable', $8)
       returning id, research_file_id, version_number, blob_id, external_reference_id,
                 original_filename, media_type, byte_size, sha256, source_kind, source_metadata,
                 change_summary, scan_status, parse_status, created_by, created_at`,
      [
        fileVersionId,
        fileRow.id,
        versionNumber,
        externalReferenceId,
        versionLabel,
        JSON.stringify({ versionLabel }),
        input.changeSummary?.trim() || null,
        actor.id,
      ],
    )) as readonly FileVersionRow[];

    const updatedRows = (await tx.unsafe(
      `update research_files
       set current_version_id = $2, lifecycle_state = 'active'
       where id = $1
       returning id, project_id, title, file_kind, description, current_version_id,
                 access_class, lifecycle_state, created_by, created_at`,
      [fileRow.id, fileVersionId],
    )) as readonly ResearchFileRow[];

    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "EXTERNAL_DATA_REFERENCE_CREATED",
      actor,
      payload: {
        externalDataReferenceId: externalReferenceId,
        researchFileId: fileRow.id,
        manifestHash,
        versionLabel,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "external.data.reference.created",
      payload: { projectId, externalDataReferenceId: externalReferenceId, researchFileId: fileRow.id },
    });
    await appendResearchEvent(tx, {
      id: randomUUID(),
      projectId,
      eventType: "FILE_VERSION_CREATED",
      actor,
      payload: {
        researchFileId: fileRow.id,
        fileVersionId,
        versionNumber,
        sourceKind: "external_reference",
        manifestHash,
      },
    });
    await enqueueOutbox(tx, {
      id: randomUUID(),
      eventType: "file.version.created",
      payload: { projectId, researchFileId: fileRow.id, fileVersionId, versionNumber },
    });

    const referenceRow = referenceRows[0];
    const versionRow = insertedVersions[0];
    const updatedFile = updatedRows[0];
    if (!referenceRow || !versionRow || !updatedFile) {
      throw new Error("External data registration returned incomplete rows");
    }

    return {
      researchFile: toResearchFile(updatedFile),
      externalReference: toExternalReference(referenceRow),
      fileVersion: toFileVersion(versionRow),
    };
  });
}
