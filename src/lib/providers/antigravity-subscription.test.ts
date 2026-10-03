import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A connected Antigravity (agy) subscription talks to Google's Cloud Code endpoint, which is not
 * the public Gemini API: the method hangs off the version with a colon, the request wraps the
 * usual body in `{ model, request }`, and the reply comes back wrapped in `{ response }`. Getting
 * any of that wrong is a 404 or an "empty" answer, so these assert the wire rather than our logic.
 */

const status = vi.hoisted(() => vi.fn());
const token = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai-auth/antigravity", () => ({
  antigravityAccounts: () => ({ status, token }),
}));
vi.mock("@/lib/ai-auth/claude", () => ({ claudeAccounts: () => null }));

import { getAiProviderFor, resetAiProvider } from "./ai";

const ENV = ["AI_API_KEY", "AI_BASE_URL", "ANTIGRAVITY_SUBSCRIPTION_MODEL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  status.mockReset();
  token.mockReset();
  status.mockResolvedValue({ connected: true, projectId: null });
  token.mockResolvedValue("agy-token");
  resetAiProvider();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wrapped = (...parts: Array<{ text: string; thought?: boolean }>) =>
  new Response(JSON.stringify({ response: { candidates: [{ content: { parts } }] } }));

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sent = (fetchMock: ReturnType<typeof stubFetch>) => ({
  url: fetchMock.mock.calls[0][0],
  init: fetchMock.mock.calls[0][1],
  body: JSON.parse(String(fetchMock.mock.calls[0][1].body)),
});

describe("a connected Antigravity subscription", () => {
  it("is the provider for that person", async () => {
    stubFetch(wrapped({ text: "ok" }));
    expect((await getAiProviderFor("user-1")).name).toBe("antigravity-subscription");
  });

  it("posts to the Cloud Code method with a colon, as a bearer token", async () => {
    const fetchMock = stubFetch(wrapped({ text: "ok" }));
    const ai = await getAiProviderFor("user-1");
    await ai.chat([{ role: "user", content: "hi" }]);

    const { url, init } = sent(fetchMock);
    expect(url).toMatch(/\/v1internal:generateContent$/);
    // The prod host false-429s personal tokens; only `daily` answers them properly.
    expect(url).toContain("daily-cloudcode-pa.googleapis.com");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer agy-token");
  });

  it("sends no project, even when the account has one, like AirEddy", async () => {
    status.mockResolvedValue({ connected: true, projectId: "my-project-123" });
    const fetchMock = stubFetch(wrapped({ text: "ok" }));
    const ai = await getAiProviderFor("user-1");
    await ai.chat([{ role: "user", content: "hi" }]);

    const { init, body } = sent(fetchMock);
    expect(body.project).toBeUndefined();
    expect(init.headers as Record<string, string>).not.toHaveProperty("x-goog-user-project");
  });

  it("asks for the one flash id Cloud Code knows", async () => {
    process.env.ANTIGRAVITY_SUBSCRIPTION_MODEL = "gemini-3.1-flash";
    const fetchMock = stubFetch(wrapped({ text: "ok" }));
    const ai = await getAiProviderFor("user-1");
    await ai.chat([{ role: "user", content: "hi" }]);
    expect(sent(fetchMock).body.model).toBe("gemini-3-flash");
  });

  it("wraps the turns in { model, request } with the system prompt beside them", async () => {
    const fetchMock = stubFetch(wrapped({ text: "ok" }));
    const ai = await getAiProviderFor("user-1");
    await ai.chat([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
    ]);

    const { body } = sent(fetchMock);
    expect(body.model).toBe("gemini-3.1-pro-low");
    expect(body.request.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
    expect(body.request.systemInstruction.parts).toEqual([{ text: "Be brief." }]);
    expect(body.request.generationConfig).toBeUndefined();
  });

  it("calls the assistant's earlier turns `model`, and passes a token limit on", async () => {
    const fetchMock = stubFetch(wrapped({ text: "ok" }));
    const ai = await getAiProviderFor("user-1");
    await ai.chat(
      [
        { role: "user", content: "one" },
        { role: "assistant", content: "two" },
        { role: "user", content: "three" },
      ],
      { maxTokens: 800 },
    );

    const { body } = sent(fetchMock);
    expect(body.request.contents.map((c: { role: string }) => c.role)).toEqual([
      "user",
      "model",
      "user",
    ]);
    expect(body.request.generationConfig).toEqual({ maxOutputTokens: 800 });
  });

  it("reads the wrapped reply, leaving out the model's thinking", async () => {
    stubFetch(
      wrapped({ text: "weighing options", thought: true }, { text: "The " }, { text: "answer" }),
    );
    const ai = await getAiProviderFor("user-1");
    expect(await ai.chat([{ role: "user", content: "hi" }])).toBe("The answer");
  });

  it("still reads an unwrapped reply", async () => {
    stubFetch(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "plain" }] } }] })),
    );
    const ai = await getAiProviderFor("user-1");
    expect(await ai.chat([{ role: "user", content: "hi" }])).toBe("plain");
  });

  it("says the AI returned nothing when only thinking came back", async () => {
    stubFetch(wrapped({ text: "hmm", thought: true }));
    const ai = await getAiProviderFor("user-1");
    await expect(ai.chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "ai_empty",
    });
  });

  it("logs what the provider answered, because the person only sees one sentence", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(new Response("model not found", { status: 404 }));
    const ai = await getAiProviderFor("user-1");

    await expect(ai.chat([{ role: "user", content: "hi" }])).rejects.toMatchObject({
      code: "ai_error",
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("answered 404"), "model not found");
  });
});
