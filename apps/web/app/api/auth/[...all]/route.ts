import { toNextJsHandler } from "better-auth/next-js";
import { getWorkbenchAuth } from "../../../../src/auth";

async function dispatch(request: Request) {
  const handlers = toNextJsHandler(getWorkbenchAuth());
  const handler = request.method === "GET" ? handlers.GET : handlers.POST;
  return handler(request);
}

export const GET = dispatch;
export const POST = dispatch;
