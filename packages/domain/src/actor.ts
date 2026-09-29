export type ActorType = "human" | "agent" | "system";

export type ActorRef = {
  type: ActorType;
  id: string;
};

export function assertHumanActor(actor: ActorRef): asserts actor is ActorRef & { type: "human" } {
  if (actor.type !== "human") {
    throw new Error("Formal research state changes require a human actor");
  }
}
