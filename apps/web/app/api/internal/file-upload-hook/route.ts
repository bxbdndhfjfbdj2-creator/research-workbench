import { NextResponse } from "next/server";
import { createDbClient } from "@research-workbench/db/src/client";
import { handleTusHook } from "@research-workbench/application/src/files/tusd-hook";
import { loadFileUploadConfig } from "../../../../../../packages/config/src/env";
import { normalizeTusdHookRequest } from "./normalize";

type HookDbClient = ReturnType<typeof createDbClient>;

const globalHookDb = globalThis as typeof globalThis & {
  __researchWorkbenchFileHookDb?: HookDbClient;
};

function hookDb(): HookDbClient {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  globalHookDb.__researchWorkbenchFileHookDb ??= createDbClient(databaseUrl);
  return globalHookDb.__researchWorkbenchFileHookDb;
}

function preCreateRejected(): NextResponse {
  return NextResponse.json(
    {
      RejectUpload: true,
      HTTPResponse: {
        StatusCode: 400,
        Body: JSON.stringify({ message: "Upload rejected" }),
        Header: { "Content-Type": "application/json" },
      },
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "application/json required" }, { status: 415 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid hook JSON" }, { status: 400 });
  }

  const rawType =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).Type
      : null;

  try {
    const normalized = normalizeTusdHookRequest(
      raw,
      request.headers.get("x-workbench-upload-token"),
    );
    if (!normalized) return NextResponse.json({});

    const config = loadFileUploadConfig(process.env);
    const signingSecret = process.env[config.uploadSigningSecret.key]?.trim();
    if (!signingSecret) throw new Error("Upload signing secret is unavailable");

    await handleTusHook(
      hookDb().sql,
      normalized.hook,
      normalized.uploadToken,
      {
        quarantineBucket: config.quarantineBucket,
        quarantinePrefix: config.quarantinePrefix,
        maxFileBytes: config.maxFileBytes,
      },
      signingSecret,
    );

    return NextResponse.json({});
  } catch {
    if (rawType === "pre-create") return preCreateRejected();
    return NextResponse.json({}, { status: 500 });
  }
}
