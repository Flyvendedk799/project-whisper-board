import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard } from "@/lib/server-errors";
import type { AntigravityConnection } from "@/lib/ai-auth/antigravity";

export const antigravityConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AntigravityConnection> => {
    const { antigravityStatusFor } = await import("@/lib/ai-auth/antigravity");
    return guard("antigravity.status", () => antigravityStatusFor(context.userId));
  });

export const startAntigravityConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ url: string; expiresInSeconds: number }> => {
    const { beginAntigravityLogin } = await import("@/lib/ai-auth/antigravity");
    return guard("antigravity.login", async () => beginAntigravityLogin(context.userId));
  });

export const finishAntigravityConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      code: z.string().trim().min(1, "Paste the code or URL from the page."),
    }),
  )
  .handler(async ({ context, data }): Promise<AntigravityConnection> => {
    const { completeAntigravityLogin } = await import("@/lib/ai-auth/antigravity");
    return guard("antigravity.login.complete", () =>
      completeAntigravityLogin(context.userId, data.code),
    );
  });

export const removeAntigravityConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AntigravityConnection> => {
    const { disconnectAntigravity } = await import("@/lib/ai-auth/antigravity");
    return guard("antigravity.disconnect", () => disconnectAntigravity(context.userId));
  });
