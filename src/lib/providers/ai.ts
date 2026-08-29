import { AppError } from "@/lib/errors";
import type { AiMessage, AiProvider } from "./types";

/**
 * The AI gateway was hardcoded — host, model and key all baked into
 * ai.functions.ts. That is the vendor lock you hit first, before email or
 * payments, so it belongs behind the same interface as the rest.
 *
 * With no key the provider reports `enabled: false` and every AI affordance
 * hides itself rather than failing when pressed. The forms all work without it;
 * AI drafts the ticket, it does not gate filing one.
 */

const DEFAULT_BASE_URL = "https://ai.gateway.lovable.dev/v1";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

function createDisabledAiProvider(): AiProvider {
  return {
    name: "disabled",
    enabled: false,
    model: "none",
    async chat(): Promise<string> {
      throw new AppError("ai_disabled", "AI features aren't configured on this workspace.", {
        status: 501,
      });
    },
  };
}

function createGatewayProvider(apiKey: string, baseUrl: string, model: string): AiProvider {
  return {
    name: "gateway",
    enabled: true,
    model,

    async chat(messages: AiMessage[], opts): Promise<string> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
            ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
            ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
      } catch (e) {
        throw new AppError("ai_unreachable", "Couldn't reach the AI service. Try again shortly.", {
          status: 502,
          context: { cause: e instanceof Error ? e.message : String(e) },
        });
      }

      if (!res.ok) {
        if (res.status === 429) {
          throw new AppError("ai_rate_limited", "The AI service is busy. Try again in a minute.", {
            status: 429,
          });
        }
        if (res.status === 402) {
          throw new AppError("ai_credits", "AI credits are exhausted. Top up to keep using it.", {
            status: 402,
          });
        }
        throw new AppError("ai_error", "The AI service couldn't complete that request.", {
          status: 502,
          context: { status: res.status, body: (await res.text()).slice(0, 500) },
        });
      }

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new AppError("ai_empty", "The AI returned nothing usable. Try again.", {
          status: 502,
        });
      }
      return content;
    },
  };
}

let cached: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  // LOVABLE_API_KEY is the name the project shipped with; keep accepting it.
  const apiKey = process.env.AI_API_KEY ?? process.env.LOVABLE_API_KEY;
  cached = apiKey
    ? createGatewayProvider(
        apiKey,
        process.env.AI_BASE_URL ?? DEFAULT_BASE_URL,
        process.env.AI_MODEL ?? DEFAULT_MODEL,
      )
    : createDisabledAiProvider();
  return cached;
}

/** Test seam. */
export function resetAiProvider() {
  cached = undefined;
}
