import type {
  EngineeringVerificationDecision,
  EngineeringVerificationInput,
} from "./verification-types";

export function evaluateEngineeringVerification(
  _input: EngineeringVerificationInput,
): EngineeringVerificationDecision {
  return {
    state: "unverified",
    reasonCode: "repository_not_bound",
    selectedPullRequestExternalId: null,
    evidenceExecutionIds: [],
  };
}
