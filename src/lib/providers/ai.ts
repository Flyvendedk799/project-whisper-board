import {
  anthropicSubscriptionOptions,
  withClaudeCodeIdentity,
  type SystemBlock,
} from "@flyvendedk799/ai-auth";
import {
  describeProviderError,
  modelSpec,
  providerErrorFacts,
} from "@flyvendedk799/ai-auth/registry";
import { AppError } from "@/lib/errors";
import { claudeAccounts } from "@/lib/ai-auth/claude";
import { antigravityAccounts } from "@/lib/ai-auth/antigravity";
import type { AiContent, AiMessage, AiProvider } from "./types";

/**
 * AI, talking straight to whoever owns the model.
 *
 * This used to point at a hosted gateway whose host, model and key were baked
 * into the call site. There are now two ways a call gets paid for, tried in this
 * order:
 *
 *  1. **The signed-in person's own Claude subscription**, connected from
 *     Settings. Each account brings its own plan, so a call costs the person who
 *     asked for it rather than whoever set the deployment up.
 *  2. **An API key** from the environment, billed to the deployment as a whole.
 *
 * With neither, the provider reports `enabled: false` and every AI affordance
 * hides itself rather than failing when pressed. The forms all work without it;
 * AI drafts the ticket, it does not gate filing one.
 *
 * SERVER ONLY. The subscription path reaches `node:crypto` through the account
 * store, which is why this is exported from `providers/server.ts` rather than
 * from the client-safe barrel.
 */

type Wire = "anthropic" | "openai" | "gemini";

const DEFAULT_MODEL = "claude-sonnet-5";

/** Anthropic requires an explicit cap; OpenAI does not, so one default serves both. */
const DEFAULT_MAX_TOKENS = 4096;

const WIRE_BASE_URL: Record<Wire, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

/** Where each wire's key lives when `AI_API_KEY` is not set. Matches ai-auth's own names. */
const WIRE_KEY_ENV: Record<Wire, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
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
  if (spec?.wire === "anthropic" || spec?.wire === "openai" || spec?.wire === "gemini")
    return spec.wire;

  const configured = process.env.AI_WIRE;
  if (configured === "anthropic" || configured === "openai" || configured === "gemini")
    return configured as Wire;

  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o\d)/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "gemini";
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

/**
 * How this call is being paid for.
 *
 * A metered key and a subscription token go to the same endpoint but are not
 * interchangeable: they use different headers, and the subscription additionally
 * has to identify itself (see below). Resolving the credential per call rather
 * than per provider is deliberate — a subscription access token expires, and the
 * account store refreshes it on the way out.
 */
type AnthropicAuth =
  | { kind: "key"; credential: () => Promise<string> }
  | { kind: "subscription"; credential: () => Promise<string> };

function createAnthropicProvider(auth: AnthropicAuth, baseUrl: string, model: string): AiProvider {
  return {
    name: auth.kind === "subscription" ? "claude-subscription" : "anthropic",
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

      const token = await auth.credential();

      let headers: Record<string, string>;
      let systemField: string | SystemBlock[] | undefined;

      if (auth.kind === "subscription") {
        // A subscription token authenticates as `Authorization: Bearer`, and
        // `x-api-key` must be absent entirely — Anthropic validates that header
        // whenever it is present, so sending both fails with "invalid x-api-key"
        // while carrying a perfectly good credential.
        headers = {
          Authorization: `Bearer ${token}`,
          ...anthropicSubscriptionOptions(token).defaultHeaders,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
        };
        // The identity block is load-bearing, not decoration: without it as the
        // FIRST system block, in its own block, the premium models answer 429 —
        // a rate-limit status on a plan nowhere near its limit. Haiku is exempt,
        // which is the trap, because it is the natural model to test with.
        systemField = withClaudeCodeIdentity(systemPrompt || []);
      } else {
        headers = {
          "x-api-key": token,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
        };
        systemField = systemPrompt || undefined;
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
            ...(systemField ? { system: systemField } : {}),
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

type AntigravityAuth =
  | { kind: "key"; credential: () => Promise<string> }
  | { kind: "subscription"; credential: () => Promise<string>; projectId: string | null };

function createAntigravityProvider(
  auth: AntigravityAuth,
  baseUrl: string,
  model: string,
): AiProvider {
  return {
    name: auth.kind === "subscription" ? "antigravity-subscription" : "antigravity",
    enabled: true,
    model,

    async chat(messages: AiMessage[], opts): Promise<string> {
      const { system, turns } = splitSystem(messages);
      const systemPrompt = opts?.json
        ? [system, "Respond with a single valid JSON object and nothing else."]
            .filter(Boolean)
            .join("\n\n")
        : system;

      const token = await auth.credential();

      let res: Response;
      try {
        if (auth.kind === "subscription") {
          const { antigravityCliOptions, toCodeAssistRequest } =
            await import("@flyvendedk799/ai-auth");
          const clientOptions = antigravityCliOptions(
            {
              accessToken: token,
              refreshToken: null,
              expiresAt: 0,
              email: null,
              projectId: auth.projectId,
              isDogfood: false,
            },
            baseUrl !== WIRE_BASE_URL.gemini ? baseUrl : undefined,
          );

          const req = toCodeAssistRequest(
            model,
            turns.map((m) => ({
              role: m.role as "user" | "model" | "system",
              parts: [{ text: contentToText(m.content) }],
            })),
            {
              projectId: auth.projectId || undefined,
              systemInstruction: systemPrompt || undefined,
            },
          );

          res = await fetch(`${clientOptions.baseURL}/generateContent`, {
            method: "POST",
            headers: clientOptions.defaultHeaders as Record<string, string>,
            body: JSON.stringify(req),
          });
        } else {
          // Standard Gemini API
          const { antigravityKeyOptions } = await import("@flyvendedk799/ai-auth");
          const clientOptions = antigravityKeyOptions(token, baseUrl);

          res = await fetch(`${clientOptions.baseURL}/models/${model}:generateContent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": token,
            },
            body: JSON.stringify({
              contents: turns.map((m) => ({
                role: m.role === "assistant" ? "model" : m.role,
                parts: [{ text: contentToText(m.content) }],
              })),
              ...(systemPrompt
                ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
                : {}),
            }),
          });
        }
      } catch (e) {
        failUnreachable(e);
      }

      if (!res.ok) await failFromResponse(res, "gemini", model);

      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string" || text.length === 0) failEmpty();
      return text;
    },
  };
}

let cached: AiProvider | undefined;

/**
 * What the deployment itself has configured, ignoring who is asking.
 *
 * This is the environment-key path only, and it is what the Settings page
 * reports: "is AI set up here at all". A person's own subscription is not part
 * of that answer, because it is not the deployment's to report.
 */
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
  const key = apiKey;
  cached =
    wire === "anthropic"
      ? createAnthropicProvider({ kind: "key", credential: async () => key }, baseUrl, model)
      : createOpenAiProvider(key, baseUrl, model);
  return cached;
}

/**
 * The provider for one person's request.
 *
 * Their own Claude subscription wins when they have connected one — that is the
 * whole point of connecting it. Otherwise this is the deployment's key, and
 * failing that, disabled. Not cached: the answer depends on who is asking and on
 * a token that expires.
 */
export async function getAiProviderFor(accountId: string): Promise<AiProvider> {
  const agyAccounts = antigravityAccounts();
  if (agyAccounts) {
    try {
      const status = await agyAccounts.status(accountId);
      if (status.connected) {
        const model = process.env.ANTIGRAVITY_SUBSCRIPTION_MODEL ?? "gemini-3.1-pro";
        return createAntigravityProvider(
          {
            kind: "subscription",
            credential: () => agyAccounts.token(accountId),
            projectId: status.projectId,
          },
          process.env.AI_BASE_URL ?? WIRE_BASE_URL.gemini,
          model,
        );
      }
    } catch {
      // ignore
    }
  }

  const accounts = claudeAccounts();
  if (accounts) {
    try {
      const status = await accounts.status(accountId);
      if (status.connected) {
        // An expired access token is not a disconnection — `token()` refreshes
        // it on the way out, once per account even under a burst.
        const model = process.env.CLAUDE_SUBSCRIPTION_MODEL ?? DEFAULT_MODEL;
        return createAnthropicProvider(
          { kind: "subscription", credential: () => accounts.token(accountId) },
          process.env.AI_BASE_URL ?? WIRE_BASE_URL.anthropic,
          model,
        );
      }
    } catch {
      // A store that cannot be read must not take AI down for someone who also
      // has a deployment key to fall back on.
    }
  }
  return getAiProvider();
}

/** Test seam. */
export function resetAiProvider() {
  cached = undefined;
}
