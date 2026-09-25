import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SMTP transport is stubbed rather than pointed at a local server: what is
 * under test is which provider gets chosen and how a refusal is reported, not
 * nodemailer's own wire behaviour.
 */
const sendMail = vi.hoisted(() =>
  vi.fn(async (_options: Record<string, unknown>) => ({ messageId: "msg_1" })),
);
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

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
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMTP_FROM_NAME",
  "EMAIL_FROM",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "AI_MODEL",
  "AI_BASE_URL",
  "AI_WIRE",
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
  it("email switches to the host's SMTP relay and reports enabled", async () => {
    process.env.SMTP_HOST = "smtp.relay.test";
    process.env.SMTP_FROM = "hi@consflow.test";
    process.env.SMTP_FROM_NAME = "Boared";
    resetEmailProvider();

    const email = getEmailProvider();
    expect(email.enabled).toBe(true);
    expect(email.name).toBe("smtp");

    const result = await email.send({ to: "a@b.test", subject: "Hi", text: "Hello" });
    expect(result).toMatchObject({ delivered: true, providerMessageId: "msg_1" });
    expect(sendMail).toHaveBeenCalledOnce();
    // The display name is folded into the envelope sender, not sent separately.
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      from: "Boared <hi@consflow.test>",
      to: "a@b.test",
      subject: "Hi",
    });
  });

  it("a relay host alone is not enough to send from nowhere", async () => {
    process.env.SMTP_HOST = "smtp.relay.test";
    resetEmailProvider();

    const email = getEmailProvider();
    expect(email.enabled).toBe(false);
    expect((await email.send({ to: "a@b.test", subject: "s", text: "t" })).skippedReason).toBe(
      "SMTP_FROM is not set",
    );
  });

  it("a relay outage is reported as an error, not as a silent success", async () => {
    process.env.SMTP_HOST = "smtp.relay.test";
    process.env.SMTP_FROM = "hi@consflow.test";
    resetEmailProvider();
    sendMail.mockRejectedValueOnce(new Error("535 authentication failed"));

    const result = await getEmailProvider().send({ to: "a@b.test", subject: "s", text: "t" });
    expect(result.delivered).toBe(false);
    expect(result.error).toContain("535");
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

  it("AI derives the wire from the model, and takes a per-wire key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    resetAiProvider();
    let ai = getAiProvider();
    expect(ai.enabled).toBe(true);
    // The default model is a Claude id, so the Anthropic wire is chosen and the
    // Anthropic-specific key is the one that counts.
    expect(ai.name).toBe("anthropic");

    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.AI_MODEL = "gpt-5";
    resetAiProvider();
    ai = getAiProvider();
    expect(ai.enabled).toBe(true);
    expect(ai.name).toBe("openai");

    // An Anthropic key does not unlock an OpenAI model.
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    resetAiProvider();
    expect(getAiProvider().enabled).toBe(false);
  });

  it("AI stays disabled for a model whose wire cannot be established", () => {
    process.env.AI_API_KEY = "k";
    process.env.AI_MODEL = "some-unreleased-model";
    resetAiProvider();
    expect(getAiProvider().enabled).toBe(false);

    // Naming the wire is enough to make an unknown model usable.
    process.env.AI_WIRE = "openai";
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
      vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "" }] }))),
    );
    await expect(getAiProvider().chat([{ role: "user", content: "x" }])).rejects.toThrow(
      /returned nothing usable/,
    );
  });

  it("speaks the Anthropic wire for a Claude model, system prompt beside the turns", async () => {
    process.env.AI_API_KEY = "k";
    resetAiProvider();

    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ai = getAiProvider();
    expect(ai.model).toBe("claude-sonnet-5");
    expect(
      await ai.chat([
        { role: "system", content: "be terse" },
        { role: "user", content: "x" },
      ]),
    ).toBe("ok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-sonnet-5");
    // The system turn is lifted out; only the user turn remains in `messages`.
    expect(body.system).toBe("be terse");
    expect(body.messages).toEqual([{ role: "user", content: "x" }]);
    // Anthropic refuses a request with no cap, so one is always sent.
    expect(body.max_tokens).toBeGreaterThan(0);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });

  it("respects AI_MODEL and AI_BASE_URL on the OpenAI wire", async () => {
    process.env.AI_API_KEY = "k";
    process.env.AI_MODEL = "gpt-5";
    process.env.AI_BASE_URL = "https://ai.example.test/v1";
    resetAiProvider();

    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ai = getAiProvider();
    expect(ai.model).toBe("gpt-5");
    await ai.chat([{ role: "user", content: "x" }], { maxTokens: 256 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ai.example.test/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5");
    // The reasoning models reject `max_tokens` outright.
    expect(body.max_completion_tokens).toBe(256);
    expect(body.max_tokens).toBeUndefined();
  });
});
