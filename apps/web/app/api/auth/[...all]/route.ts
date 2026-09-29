import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../src/auth";

if (!auth) {
  throw new Error("Better Auth server is unavailable in test mode");
}

export const { GET, POST } = toNextJsHandler(auth);
