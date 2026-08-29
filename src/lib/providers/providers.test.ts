import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmailProvider, resetEmailProvider } from "./email";
import { getPaymentsProvider, resetPaymentsProvider } from "./payments";
import { getAiProvider, resetAiProvider } from "./ai";
import { captureError, resetErrorTracker, setErrorSink } from "./reporting";
import { AppError } from "@/lib/errors";

/**
 * These lock the contract the whole plan rests on: with no third-party keys
 * configured, nothing throws, nothing silently disappears, and every call still
 * returns something the caller can record. If one of these fails, "the app
 * works without API keys" has stopped being true.
 */

const KEYS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "AI_API_KEY",
  "LOVABLE_API_KEY",
  "SENTRY_DSN",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  resetEmailProvider();
  resetPaymentsProvider();
  resetAiProvider();
  resetErrorTracker();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe("with no keys configured", () => {
  it("email reports itself disabled and records why, rather than failing", async () => {
    const email = getEmailProvider();
    expect(email.enabled).toBe(false);
    expect(email.name).toBe("outbox");

    const result = await email.send({ to: "a@b.test", subject: "Hi", text: "Hello" });
    expect(result.delivered).toBe(false);
    expect(result.skippedReason).toBe("No email provider configured");
    expect(result.error).toBeUndefined();
  });

  it("payments falls back to recording payment by hand", async () => {
    const payments = getPaymentsProvider();
    expect(payments.enabled).toBe(false);
    expect(payments.name).toBe("manual");

    const checkout = await payments.createCheckout({
      invoiceId: "inv-1",
      invoiceNumber: "INV-0001",
      amountCents: 150000,
      currency: "USD",
      description: "Milestone 1",
      successUrl: "https://example.test/ok",
      cancelUrl: "https://example.test/no",
    });
    expect(checkout).toEqual({ mode: "manual" });
    expect(await payments.verifyWebhook("{}", null)).toBeNull();
  });

  it("AI reports itself disabled, and says so plainly if called anyway", async () => {
    const ai = getAiProvider();
    expect(ai.enabled).toBe(false);

    await expect(ai.chat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(AppError);
    await expect(ai.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
      /aren't configured on this workspace/,
    );
  });

  it("errors are still captured, fingerprinted and handed to the sink", () => {
    vi.useFakeTimers();
    const batches: unknown[][] = [];
    setErrorSink((batch) => batches.push(batch));

    captureError(new Error("boom"), { scope: "query" });
    captureError(new Error("boom again"), { scope: "query" });

    // Batched, so nothing has been handed over yet.
    expect(batches).toHaveLength(0);

    vi.advanceTimersByTime(1500);
    vi.useRealTimers();

    // One batch containing both, not one call per error.
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(batches[0][0]).toMatchObject({ message: "boom", side: "server" });
  });

  it("captures errors raised before a sink exists, rather than dropping them", () => {
    captureError(new Error("thrown during boot"));

    const batches: unknown[][] = [];
    setErrorSink((batch) => batches.push(batch));

    expect(batches.flat()).toHaveLength(1);
    expect(batches.flat()[0]).toMatchObject({ message: "thrown during boot" });
  });

  it("capture never throws, whatever it is handed", () => {
    expect(() => captureError(undefined)).not.toThrow();
    expect(() => captureError({ weird: true })).not.toThrow();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => captureError(circular)).not.toThrow();
  });

  it("a failing sink cannot resurrect the error it was reporting", () => {
    setErrorSink(() => {
      throw new Error("the sink is broken too");
    });
    expect(() => captureError(new Error("original"))).not.toThrow();
  });
});

describe("with keys configured", () => {
  it("email switches to Resend and reports enabled", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Consflow <hi@consflow.test>";
    resetEmailProvider();

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const email = getEmailProvider();
    expect(email.enabled).toBe(true);
    expect(email.name).toBe("resend");

    const result = await email.send({ to: "a@b.test", subject: "Hi", text: "Hello" });
    expect(result).toMatchObject({ delivered: true, providerMessageId: "msg_1" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("an API key alone is not enough to send from nowhere", async () => {
    process.env.RESEND_API_KEY = "re_test";
    resetEmailProvider();

    const email = getEmailProvider();
    expect(email.enabled).toBe(false);
    expect((await email.send({ to: "a@b.test", subject: "s", text: "t" })).skippedReason).toBe(
      "EMAIL_FROM is not set",
    );
  });

  it("a provider outage is reported as an error, not as a silent success", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "hi@consflow.test";
    resetEmailProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream is down", { status: 503 })),
    );

    const result = await getEmailProvider().send({ to: "a@b.test", subject: "s", text: "t" });
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("503");
    expect(result.skippedReason).toBeUndefined();
  });

  it("payments switches to Stripe and asks for a redirect", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    resetPaymentsProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "cs_1", url: "https://stripe.test/pay" }), {
            status: 200,
          }),
      ),
    );

    const result = await getPaymentsProvider().createCheckout({
      invoiceId: "inv-1",
      invoiceNumber: "INV-0001",
      amountCents: 150000,
      currency: "USD",
      description: "Milestone 1",
      successUrl: "https://example.test/ok",
      cancelUrl: "https://example.test/no",
    });
    expect(result).toEqual({
      mode: "redirect",
      url: "https://stripe.test/pay",
      providerRef: "cs_1",
    });
  });

  it("AI accepts the key the project originally shipped with", () => {
    process.env.LOVABLE_API_KEY = "lv_test";
    resetAiProvider();
    expect(getAiProvider().enabled).toBe(true);
  });

  it("AI maps rate limiting and exhausted credit to distinct messages", async () => {
    process.env.AI_API_KEY = "k";
    resetAiProvider();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    await expect(getAiProvider().chat([{ role: "user", content: "x" }])).rejects.toThrow(/busy/);

    resetAiProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 402 })),
    );
    await expect(getAiProvider().chat([{ role: "user", content: "x" }])).rejects.toThrow(/credits/);
  });

  it("AI treats an empty completion as a failure rather than an empty answer", async () => {
    process.env.AI_API_KEY = "k";
    resetAiProvider();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }))),
    );
    await expect(getAiProvider().chat([{ role: "user", content: "x" }])).rejects.toThrow(
      /returned nothing usable/,
    );
  });

  it("respects AI_MODEL and AI_BASE_URL", async () => {
    process.env.AI_API_KEY = "k";
    process.env.AI_MODEL = "anthropic/claude-sonnet-5";
    process.env.AI_BASE_URL = "https://ai.example.test/v1";
    resetAiProvider();

    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ai = getAiProvider();
    expect(ai.model).toBe("anthropic/claude-sonnet-5");
    await ai.chat([{ role: "user", content: "x" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ai.example.test/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("anthropic/claude-sonnet-5");
  });
});
