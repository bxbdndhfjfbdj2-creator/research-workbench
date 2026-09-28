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

export function assertSecretSafe(_value: JsonValue): void {
  throw new Error("assertSecretSafe not implemented");
}
