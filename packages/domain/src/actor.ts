export type ActorType = "human" | "agent" | "system";

export type ActorRef = {
  type: ActorType;
  id: string;
};
