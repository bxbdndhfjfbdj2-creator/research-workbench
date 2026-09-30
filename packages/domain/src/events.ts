import type { ActorRef } from "./actor";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ResearchEventInput = {
  id: string;
  projectId: string | null;
  eventType: string;
  actor: ActorRef;
  payload: JsonValue;
};

export type ResearchEventRecord = ResearchEventInput & {
  createdAt: Date;
};

export type OutboxInput = {
  id: string;
  eventType: string;
  payload: JsonValue;
};

export type OutboxRecord = OutboxInput & {
  status: "pending";
  attempts: number;
  createdAt: Date;
};

const RESERVED_SECRET_KEYS = new Set([
  "password",
  "passwd",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "clientsecret",
  "privatekey",
  "apikey",
  "authorization",
  "cookie",
  "accesskeyid",
  "secretaccesskey",
  "awsaccesskeyid",
  "awssecretaccesskey",
  "sessiontoken",
  "securitytoken",
  "awssecuritytoken",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function assertSecretSafe(value: JsonValue): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) assertSecretSafe(item);
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (RESERVED_SECRET_KEYS.has(normalizeKey(key))) {
      throw new Error(`Sensitive credential field is not allowed in research payloads: ${key}`);
    }
    assertSecretSafe(nested);
  }
}
