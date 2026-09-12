import { AppError } from "@/lib/errors";
import {
  describeProviderError,
  modelSpec,
  providerErrorFacts,
} from "@flyvendedk799/ai-auth/registry";
import type { AiContent, AiMessage, AiProvider } from "./types";

/**
 * AI, talking straight to the provider that owns the model.
 *
 * This used to point at a hosted gateway whose host, model and key were baked
 * into the call site. It now goes to Anthropic or OpenAI directly, with the
 * credential read from the environment, so the only party in the request is the
 * one actually running the model.
 *
 * Which wire to speak is derived from the model id rather than configured
 * separately — `@flyvendedk799/ai-auth/registry` owns that mapping, along with
 * the catalogue and the error wording. It is imported from `/registry` and not
 * from the package root on purpose: the root reaches for `node:crypto`, and this
 * module is reachable from the browser bundle through `providers/index.ts`.
 *
 * With no key the provider reports `enabled: false` and every AI affordance
 * hides itself rather than failing when pressed. The forms all work without it;
 * AI drafts the ticket, it does not gate filing one.
 */

type Wire = "anthropic" | "openai";

const DEFAULT_MODEL = "claude-sonnet-5";

/** Anthropic requires an explicit cap; OpenAI does not, so one default serves both. */
const DEFAULT_MAX_TOKENS = 4096;

const WIRE_BASE_URL: Record<Wire, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
};

/** Where each wire's key lives when `AI_API_KEY` is not set. Matches ai-auth's own names. */
const WIRE_KEY_ENV: Record<Wire, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const ANTHROPIC_VERSION = "2023-06-01";

/**
 * The wire a model id speaks.
 *
 * The registry answers for every model it knows. A model it does not know is not
 * a failure — new ids ship faster than this catalogue does — so fall back to
 * `AI_WIRE`, then to the naming convention, and only then give up.
 */
function wireFor(model: string): Wire | null {
  const spec = modelSpec(model);
  if (spec?.wire === "anthropic" || spec?.wire === "openai") return spec.wire;

  const configured = process.env.AI_WIRE;
  if (configured === "anthropic" || configured === "openai") return configured;

  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o\d)/i.test(model)) return "openai";
  return null;
}

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

/**
 * Shared failure mapping, so both wires fail the same way for the same reason.
 *
 * A `Response` is already the shape the registry's error reader expects — it
 * takes `status` off the object and uses `headers.get()` — so it can be handed
 * over almost as-is, with the body attached as `message` to let the provider's
 * own sentence through. Those facts arrive in *headers*: a 429 with
 * `retry-after: 4` is a burst throttle that clears in seconds, while a 429 from
 * an exhausted plan is not, and they want opposite advice.
 */
async function failFromResponse(res: Response, wire: Wire, model: string): Promise<never> {
  const body = (await res.text()).slice(0, 500);
  const errorLike = { status: res.status, headers: res.headers, message: body };
  const facts = providerErrorFacts(errorLike);

  if (res.status === 429) {
    throw new AppError("ai_rate_limited", "The AI service is busy. Try again in a minute.", {
      status: 429,
      context: { retryAfter: facts.retryAfter, planStatus: facts.planStatus },
    });
  }
  if (res.status === 402) {
    throw new AppError("ai_credits", "AI credits are exhausted. Top up to keep using it.", {
      status: 402,
    });
  }
  throw new AppError("ai_error", "The AI service couldn't complete that request.", {
    status: 502,
    context: {
      status: res.status,
      // The registry turns a bare status into something a human can act on —
      // "the key was rejected" reads very differently from "502".
      explanation: describeProviderError(errorLike, wire, model),
      body,
    },
  });
}

function failUnreachable(cause: unknown): never {
  throw new AppError("ai_unreachable", "Couldn't reach the AI service. Try again shortly.", {
    status: 502,
    context: { cause: cause instanceof Error ? cause.message : String(cause) },
  });
}

function failEmpty(): never {
  throw new AppError("ai_empty", "The AI returned nothing usable. Try again.", { status: 502 });
}

/** Anthropic takes the system prompt beside the turns, not as one of them. */
function splitSystem(messages: AiMessage[]): { system: string; turns: AiMessage[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : contentToText(m.content)))
    .join("\n\n");
  return { system, turns: messages.filter((m) => m.role !== "system") };
}

function contentToText(content: AiContent): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

/** Our shared content shape, in Anthropic's block vocabulary. */
function toAnthropicContent(content: AiContent): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", source: { type: "url", url: part.image_url.url } },
  );
}

function createAnthropicProvider(apiKey: string, baseUrl: string, model: string): AiProvider {
  return {
    name: "anthropic",
    enabled: true,
    model,

    async chat(messages: AiMessage[], opts): Promise<string> {
      const { system, turns } = splitSystem(messages);
      // Anthropic has no `response_format`, so JSON is asked for in words. Said
      // in the system prompt it holds far better than appended to the last turn.
      const systemPrompt = opts?.json
        ? [system, "Respond with a single valid JSON object and nothing else."]
            .filter(Boolean)
            .join("\n\n")
        : system;

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/messages`, {
          method: "POST",
          headers: {
            // `x-api-key`, not a bearer token: the bearer form is for OAuth
            // subscription tokens, and Anthropic validates whichever it is sent.
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            messages: turns.map((m) => ({
              role: m.role,
              content: toAnthropicContent(m.content),
            })),
          }),
        });
      } catch (e) {
        failUnreachable(e);
      }

      if (!res.ok) await failFromResponse(res, "anthropic", model);

      const body = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = body.content?.find((b) => b.type === "text")?.text;
      if (typeof text !== "string" || text.length === 0) failEmpty();
      return text;
    },
  };
}

function createOpenAiProvider(apiKey: string, baseUrl: string, model: string): AiProvider {
  return {
    name: "openai",
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
            // `max_completion_tokens`, not `max_tokens`: the reasoning models
            // reject the older name outright, and the rest accept both.
            ...(opts?.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
            ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
      } catch (e) {
        failUnreachable(e);
      }

      if (!res.ok) await failFromResponse(res, "openai", model);

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) failEmpty();
      return content;
    },
  };
}

let cached: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (cached) return cached;

  const model = process.env.AI_MODEL ?? DEFAULT_MODEL;
  const wire = wireFor(model);
  // An unrecognisable model is a configuration mistake, but it must not take the
  // app down: report disabled, exactly as a missing key does.
  const apiKey = wire ? (process.env.AI_API_KEY ?? process.env[WIRE_KEY_ENV[wire]]) : undefined;

  if (!wire || !apiKey) {
    cached = createDisabledAiProvider();
    return cached;
  }

  // `AI_BASE_URL` stays supported so the traffic can be pointed at a proxy that
  // speaks the same wire without touching code.
  const baseUrl = process.env.AI_BASE_URL ?? WIRE_BASE_URL[wire];
  cached =
    wire === "anthropic"
      ? createAnthropicProvider(apiKey, baseUrl, model)
      : createOpenAiProvider(apiKey, baseUrl, model);
  return cached;
}

/** Test seam. */
export function resetAiProvider() {
  cached = undefined;
}
