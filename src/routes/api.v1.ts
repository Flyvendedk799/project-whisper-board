import { createFileRoute } from "@tanstack/react-router";
import { handleAccountRequest, requireAccountAccess } from "@/lib/account-api";

/** Workspace API index. Requires the `account` scope on the key. */
export const Route = createFileRoute("/api/v1")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAccountAccess(request);
        if (auth instanceof Response) return auth;
        return handleAccountRequest(request, auth.workspaceId, "");
      },
    },
  },
});
