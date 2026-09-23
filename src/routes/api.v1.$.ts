import { createFileRoute } from "@tanstack/react-router";
import { handleAccountRequest, requireAccountAccess } from "@/lib/account-api";

/** Workspace API. Requires the `account` scope on the key. */
export const Route = createFileRoute("/api/v1/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params._splat),
      POST: ({ request, params }) => handle(request, params._splat),
      PATCH: ({ request, params }) => handle(request, params._splat),
    },
  },
});

async function handle(request: Request, splat?: string) {
  const auth = await requireAccountAccess(request);
  if (auth instanceof Response) return auth;
  return handleAccountRequest(request, auth.workspaceId, splat || "");
}
