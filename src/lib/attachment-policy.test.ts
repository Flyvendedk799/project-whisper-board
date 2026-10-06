import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  bytesMatchMime,
  decodeStrictBase64,
  idempotentSegment,
  isCleanUtf8,
  isTextAttachment,
  MAX_BASE64_CHARS,
  MAX_BASE64_UPLOAD_BYTES,
  MAX_TEXT_UPLOAD_BYTES,
  normalizeMime,
  parseBase64Upload,
  parseFileName,
  parseTextRange,
  parseTextUpload,
  readJsonCapped,
  sameUpload,
  sha256Hex,
  utf8Page,
} from "./attachment-policy";

const PLAN = "52775160-d2f1-484b-98f0-7750178519b8";
const TASK = "f07a7476-c8b8-475b-b238-8ddcc499f914";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);
const PDF = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");

/** The AppError a call throws, so a test can check its code and status. */
function failure(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

async function asyncFailure(action: () => Promise<unknown>): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

const textBody = (overrides: Record<string, unknown> = {}) => ({
  plan_id: PLAN,
  file_name: "review.md",
  mime_type: "text/markdown",
  text: "# Review\n\nAll good. Æøå ✓",
  ...overrides,
});

const base64Body = (bytes: Buffer, mime: string, overrides: Record<string, unknown> = {}) => ({
  task_id: TASK,
  file_name: "shot.png",
  mime_type: mime,
  data_base64: bytes.toString("base64"),
  ...overrides,
});

describe("parseTextUpload", () => {
  it("accepts Markdown on a plan, shared by default", () => {
    const intent = parseTextUpload(textBody());
    expect(intent.target).toEqual({ planId: PLAN, taskId: null });
    expect(intent.mimeType).toBe("text/markdown");
    expect(intent.sharedWithAgents).toBe(true);
    expect(intent.bytes.toString("utf8")).toBe("# Review\n\nAll good. Æøå ✓");
    expect(intent.idempotencyKey).toBeNull();
  });

  it("takes plain text on a task, with the optional fields", () => {
    const intent = parseTextUpload(
      textBody({
        plan_id: undefined,
        task_id: TASK,
        file_name: "notes.txt",
        mime_type: "text/plain; charset=utf-8",
        shared_with_agents: false,
        purpose: "  context for the task ",
        idempotency_key: "run-42",
        workspace_id: PLAN.toUpperCase(),
      }),
    );
    expect(intent.target).toEqual({ planId: null, taskId: TASK });
    expect(intent.mimeType).toBe("text/plain");
    expect(intent.sharedWithAgents).toBe(false);
    expect(intent.purpose).toBe("context for the task");
    expect(intent.idempotencyKey).toBe("run-42");
    expect(intent.workspaceId).toBe(PLAN);
  });

  it("needs exactly one of plan_id and task_id", () => {
    expect(failure(() => parseTextUpload(textBody({ task_id: TASK }))).message).toMatch(
      /exactly one/,
    );
    expect(failure(() => parseTextUpload(textBody({ plan_id: undefined }))).message).toMatch(
      /exactly one/,
    );
    expect(failure(() => parseTextUpload(textBody({ plan_id: "nope" }))).message).toMatch(/uuid/);
  });

  it("refuses types other than Markdown and plain text", () => {
    for (const mime of ["text/html", "image/svg+xml", "image/png", "application/json"]) {
      const error = failure(() =>
        parseTextUpload(textBody({ file_name: "a.txt", mime_type: mime })),
      );
      expect(error.status, mime).toBe(415);
    }
  });

  it("reads a .md name with no type as Markdown", () => {
    expect(parseTextUpload(textBody({ mime_type: undefined })).mimeType).toBe("text/markdown");
    expect(parseTextUpload(textBody({ mime_type: "text/x-markdown" })).mimeType).toBe(
      "text/markdown",
    );
  });

  it("enforces the 256 KiB UTF-8 limit in bytes, not characters", () => {
    const fits = "a".repeat(MAX_TEXT_UPLOAD_BYTES);
    expect(parseTextUpload(textBody({ text: fits })).bytes.length).toBe(MAX_TEXT_UPLOAD_BYTES);
    // 2 bytes per character: half as many characters already reach the limit.
    const over = "ø".repeat(MAX_TEXT_UPLOAD_BYTES / 2 + 1);
    const error = failure(() => parseTextUpload(textBody({ text: over })));
    expect(error.status).toBe(413);
  });

  it("refuses empty text, NUL bytes and a missing name", () => {
    expect(failure(() => parseTextUpload(textBody({ text: "" }))).message).toMatch(/text/);
    expect(failure(() => parseTextUpload(textBody({ text: "a\u0000b" }))).status).toBe(415);
    expect(failure(() => parseTextUpload(textBody({ file_name: " " }))).message).toMatch(
      /file_name/,
    );
  });

  it("checks shared_with_agents and idempotency_key", () => {
    expect(failure(() => parseTextUpload(textBody({ shared_with_agents: "yes" }))).message).toMatch(
      /true or false/,
    );
    expect(
      failure(() => parseTextUpload(textBody({ idempotency_key: "x".repeat(201) }))).message,
    ).toMatch(/200/);
  });
});

describe("parseFileName", () => {
  it("keeps an ordinary name as given", () => {
    expect(parseFileName("  Checkout flow (mobile).png ")).toBe("Checkout flow (mobile).png");
  });

  it("refuses paths and control characters", () => {
    for (const name of ["../etc/passwd", "a/b.md", "a\\b.md", "..", "a\nb.md"]) {
      expect(() => parseFileName(name), name).toThrow(AppError);
    }
  });

  it("refuses names a browser would render as active content", () => {
    for (const name of ["x.svg", "x.HTML", "x.htm", "x.xhtml", "x.js"]) {
      expect(failure(() => parseFileName(name)).status, name).toBe(415);
    }
  });
});

describe("parseBase64Upload", () => {
  it.each([
    ["image/png", PNG, "shot.png"],
    ["image/jpeg", JPEG, "shot.jpg"],
    ["image/gif", GIF, "shot.gif"],
    ["image/webp", WEBP, "shot.webp"],
    ["application/pdf", PDF, "doc.pdf"],
    ["text/markdown", Buffer.from("# hi"), "review.md"],
    ["text/plain", Buffer.from("hi"), "notes.txt"],
  ])("accepts %s whose bytes match", (mime, bytes, name) => {
    const intent = parseBase64Upload(base64Body(bytes, mime, { file_name: name }));
    expect(intent.mimeType).toBe(mime);
    expect(intent.bytes.equals(bytes)).toBe(true);
  });

  it("refuses bytes that are not the declared type", () => {
    expect(failure(() => parseBase64Upload(base64Body(JPEG, "image/png"))).code).toBe(
      "content_mismatch",
    );
    expect(failure(() => parseBase64Upload(base64Body(PNG, "application/pdf"))).status).toBe(415);
    // An SVG declared as a PNG is still not a PNG.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(failure(() => parseBase64Upload(base64Body(svg, "image/png"))).status).toBe(415);
  });

  it("refuses binary bytes declared as text", () => {
    expect(
      failure(() => parseBase64Upload(base64Body(PNG, "text/plain", { file_name: "a.txt" }))).code,
    ).toBe("content_mismatch");
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    expect(
      failure(() => parseBase64Upload(base64Body(latin1, "text/markdown", { file_name: "a.md" })))
        .message,
    ).toMatch(/UTF-8/);
  });

  it("refuses SVG and HTML types outright", () => {
    for (const mime of ["image/svg+xml", "text/html", "application/xhtml+xml"]) {
      expect(
        failure(() => parseBase64Upload(base64Body(PNG, mime, { file_name: "x.bin" }))).status,
        mime,
      ).toBe(415);
    }
  });
});

describe("decodeStrictBase64", () => {
  it("decodes standard padded base64", () => {
    expect(decodeStrictBase64("aGVsbG8=").toString()).toBe("hello");
    expect(decodeStrictBase64("aGk=").toString()).toBe("hi");
    expect(decodeStrictBase64("aGV5").toString()).toBe("hey");
  });

  it("refuses a data: prefix with a sentence that says so", () => {
    expect(failure(() => decodeStrictBase64("data:image/png;base64,aGk=")).message).toMatch(
      /data:/,
    );
  });

  it("refuses anything that is not strict base64", () => {
    for (const value of ["aGk", "aGk=\n", "aG k=", "aGk-", "a_k=", "aGk===", "aGl=", "===="]) {
      expect(() => decodeStrictBase64(value), JSON.stringify(value)).toThrow(/not valid base64/);
    }
    expect(() => decodeStrictBase64("")).toThrow(/required/);
  });

  it("refuses an encoding longer than the decoded cap allows, before decoding", () => {
    expect(MAX_BASE64_CHARS).toBeGreaterThanOrEqual((MAX_BASE64_UPLOAD_BYTES * 4) / 3);
    const error = failure(() => decodeStrictBase64("A".repeat(MAX_BASE64_CHARS + 4)));
    expect(error.status).toBe(413);
  });

  it("allows a screenshot of several megabytes", () => {
    const bytes = Buffer.alloc(5 * 1024 * 1024, 7);
    PNG.copy(bytes);
    const intent = parseBase64Upload(base64Body(bytes, "image/png"));
    expect(intent.bytes.length).toBe(bytes.length);
  });
});

describe("bytes and text helpers", () => {
  it("knows clean UTF-8 from binary", () => {
    expect(isCleanUtf8(Buffer.from("plain ✓"))).toBe(true);
    expect(isCleanUtf8(Buffer.from([0xc3]))).toBe(false);
    expect(isCleanUtf8(Buffer.from([0x61, 0x00]))).toBe(false);
    expect(bytesMatchMime("image/webp", Buffer.from("RIFF0000WAVE"))).toBe(false);
  });

  it("hashes with SHA-256", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("normalizes types and recognises text attachments", () => {
    expect(normalizeMime("Text/Plain; charset=UTF-8", "a.txt")).toBe("text/plain");
    expect(normalizeMime("", "a.markdown")).toBe("text/markdown");
    expect(isTextAttachment("text/markdown", "a.md")).toBe(true);
    expect(isTextAttachment(null, "notes.md")).toBe(true);
    expect(isTextAttachment("image/png", "a.png")).toBe(false);
    expect(isTextAttachment("text/csv", "a.csv")).toBe(false);
  });
});

describe("idempotency", () => {
  const scope = { workspaceId: "w", userId: "u", planId: PLAN, taskId: null };

  it("gives the same uuid-shaped segment for the same key and scope", () => {
    const segment = idempotentSegment("key-1", scope);
    expect(segment).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(idempotentSegment("key-1", scope)).toBe(segment);
  });

  it("gives a different segment for another key, owner, plan or task", () => {
    const segment = idempotentSegment("key-1", scope);
    expect(idempotentSegment("key-2", scope)).not.toBe(segment);
    expect(idempotentSegment("key-1", { ...scope, userId: "v" })).not.toBe(segment);
    expect(idempotentSegment("key-1", { ...scope, workspaceId: "x" })).not.toBe(segment);
    expect(idempotentSegment("key-1", { ...scope, taskId: TASK })).not.toBe(segment);
  });

  it("treats a retry as the same upload only when name, type and content match", () => {
    const intent = parseTextUpload(textBody());
    const sha = sha256Hex(intent.bytes);
    const stored = { file_name: "review.md", mime_type: "text/markdown", sha256: sha };
    expect(sameUpload(stored, intent, sha)).toBe(true);
    expect(sameUpload({ ...stored, sha256: "0" }, intent, sha)).toBe(false);
    expect(sameUpload({ ...stored, file_name: "other.md" }, intent, sha)).toBe(false);
    expect(sameUpload({ ...stored, mime_type: "text/plain" }, intent, sha)).toBe(false);
  });
});

describe("text paging", () => {
  it("parses the range with defaults and caps", () => {
    expect(parseTextRange(new URLSearchParams())).toEqual({ offset: 0, limit: 65536 });
    expect(parseTextRange(new URLSearchParams("offset=10&limit=100"))).toEqual({
      offset: 10,
      limit: 100,
    });
    expect(() => parseTextRange(new URLSearchParams("limit=262145"))).toThrow(/limit/);
    expect(() => parseTextRange(new URLSearchParams("limit=0"))).toThrow(/limit/);
    expect(() => parseTextRange(new URLSearchParams("offset=-1"))).toThrow(/offset/);
  });

  it("reads the whole file in one page when it fits", () => {
    const page = utf8Page(Buffer.from("hello"), 0, 100);
    expect(page).toEqual({
      text: "hello",
      offset: 0,
      next_offset: null,
      total_bytes: 5,
      eof: true,
    });
  });

  it("never splits a character, and the pages add up to the file", () => {
    const text = "aø€😀b".repeat(50);
    const bytes = Buffer.from(text);
    for (const limit of [1, 2, 3, 5, 7, 64]) {
      let offset: number | null = 0;
      let joined = "";
      while (offset !== null) {
        const page = utf8Page(bytes, offset, limit);
        expect(page.text).not.toContain("\uFFFD");
        joined += page.text;
        offset = page.next_offset;
      }
      expect(joined, `limit ${limit}`).toBe(text);
    }
  });

  it("moves an offset inside a character to the next one, and past the end is empty", () => {
    const bytes = Buffer.from("ø!");
    expect(utf8Page(bytes, 1, 10)).toMatchObject({ text: "!", offset: 2, eof: true });
    expect(utf8Page(bytes, 99, 10)).toMatchObject({ text: "", offset: 3, eof: true });
  });
});

describe("readJsonCapped", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://boared.test/api/planner/attachments/text", {
      method: "POST",
      body,
      headers,
    });

  it("reads a JSON object under the cap", async () => {
    expect(await readJsonCapped(post('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it("refuses a body over the cap with a 413, declared or not", async () => {
    const big = JSON.stringify({ text: "x".repeat(500) });
    expect((await asyncFailure(() => readJsonCapped(post(big), 100))).status).toBe(413);
    expect(
      (await asyncFailure(() => readJsonCapped(post("{}", { "content-length": "999" }), 100)))
        .status,
    ).toBe(413);
  });

  it("refuses something that is not a JSON object", async () => {
    for (const body of ["", "[1]", "nope", "null"]) {
      expect((await asyncFailure(() => readJsonCapped(post(body), 100))).message).toMatch(
        /JSON object/,
      );
    }
  });
});
