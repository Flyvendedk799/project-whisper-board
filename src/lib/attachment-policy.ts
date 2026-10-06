/**
 * What the agent attachment API accepts, as pure functions.
 *
 * `POST attachments/text`, `POST attachments/base64` and `GET attachments/:id/text` in
 * `routes/api.planner.$.ts` go through `lib/agent-attachments.ts`, which wires these
 * rules to storage and the database. Everything an agent can get wrong (a type, a
 * size, a byte that is not what the type says, a half-decoded character) is decided
 * here, so it is testable without a server.
 *
 * Deliberately narrower than the browser upload: an agent can attach what it
 * produces (screenshots, PDFs, Markdown and plain text), never SVG or HTML, and the
 * bytes have to match the declared type.
 */
import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/agent-api-input";
import { effectiveMimeType } from "@/lib/upload";

type Body = Record<string, unknown>;

const KIB = 1024;
const MIB = 1024 * KIB;

/** `attachments/text`: the UTF-8 size of `text`. */
export const MAX_TEXT_UPLOAD_BYTES = 256 * KIB;
/**
 * `attachments/base64`: the decoded size. 8 MiB fits screenshots and most PDFs, stays well
 * under the bucket's 25 MiB, and keeps the JSON body (base64 is 4/3 of that) around 11 MiB.
 */
export const MAX_BASE64_UPLOAD_BYTES = 8 * MIB;
/** Longest `data_base64` that can decode to at most MAX_BASE64_UPLOAD_BYTES. */
export const MAX_BASE64_CHARS = Math.ceil(MAX_BASE64_UPLOAD_BYTES / 3) * 4;
/** Request body caps, checked while reading so an oversized body is never held in memory. */
export const MAX_TEXT_BODY_BYTES = 2 * MIB;
export const MAX_BASE64_BODY_BYTES = MAX_BASE64_CHARS + 64 * KIB;

/** `GET attachments/:id/text` paging, in bytes of UTF-8. */
export const DEFAULT_TEXT_READ_BYTES = 64 * KIB;
export const MAX_TEXT_READ_BYTES = 256 * KIB;

export const MAX_FILE_NAME = 255;
export const MAX_PURPOSE = 500;
export const MAX_IDEMPOTENCY_KEY = 200;

export const TEXT_MIME_TYPES = ["text/markdown", "text/plain"] as const;
export const BASE64_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/markdown",
  "text/plain",
] as const;

export type TextMime = (typeof TEXT_MIME_TYPES)[number];
export type UploadMime = (typeof BASE64_MIME_TYPES)[number];

/** A name that a browser would render as active content, whatever type was declared. */
const ACTIVE_CONTENT_NAME = /\.(svg|svgz|html?|xhtml|xht|xml|js|mjs)$/i;

export type AttachmentTarget = { planId: string; taskId: null } | { planId: null; taskId: string };

export interface UploadIntent {
  /** When given it has to be the key's workspace; anything else is the same 404 as a missing plan. */
  workspaceId: string | null;
  target: AttachmentTarget;
  fileName: string;
  mimeType: UploadMime;
  bytes: Buffer;
  sharedWithAgents: boolean;
  purpose: string | null;
  idempotencyKey: string | null;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function parseTarget(body: Body): AttachmentTarget {
  const planId = body.plan_id ?? null;
  const taskId = body.task_id ?? null;
  if ((planId === null) === (taskId === null)) {
    throw new AppError(
      "validation",
      "Name exactly one of `plan_id` (a file on the plan itself) or `task_id`.",
    );
  }
  if (planId !== null) {
    if (!isUuid(planId)) throw new AppError("validation", "`plan_id` must be a uuid.");
    return { planId: planId.toLowerCase(), taskId: null };
  }
  if (!isUuid(taskId)) throw new AppError("validation", "`task_id` must be a uuid.");
  return { planId: null, taskId: (taskId as string).toLowerCase() };
}

function parseWorkspaceId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isUuid(value)) throw new AppError("validation", "`workspace_id` must be a uuid.");
  return value.toLowerCase();
}

/** The file's display name. Kept as given (the storage path gets a slug), but never a path. */
export function parseFileName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new AppError("validation", "`file_name` is required.");
  if (name.length > MAX_FILE_NAME) {
    throw new AppError("validation", `\`file_name\` is at most ${MAX_FILE_NAME} characters.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[/\\\u0000-\u001f\u007f]/.test(name) || name === "." || name === "..") {
    throw new AppError(
      "validation",
      "`file_name` is a plain name such as review.md, without folders or control characters.",
    );
  }
  if (ACTIVE_CONTENT_NAME.test(name)) {
    throw new AppError(
      "unsupported_type",
      "SVG, HTML, XML and script files cannot be attached through the API.",
      { status: 415 },
    );
  }
  return name;
}

/** `text/markdown; charset=utf-8` -> `text/markdown`; `.md` with no type -> `text/markdown`. */
export function normalizeMime(value: unknown, fileName: string): string {
  const raw = typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
  return effectiveMimeType(fileName, raw).toLowerCase();
}

function parseMime<T extends string>(value: unknown, fileName: string, allowed: readonly T[]): T {
  const mime = normalizeMime(value, fileName);
  if (!mime) throw new AppError("validation", "`mime_type` is required.");
  if (!(allowed as readonly string[]).includes(mime)) {
    throw new AppError(
      "unsupported_type",
      `${mime} cannot be attached here. Allowed: ${allowed.join(", ")}.`,
      { status: 415 },
    );
  }
  return mime as T;
}

function parseOptionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppError("validation", `${label} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new AppError("validation", `${label} is at most ${max} characters.`);
  return text;
}

function parseIdempotencyKey(value: unknown): string | null {
  const key = parseOptionalText(value, "`idempotency_key`", MAX_IDEMPOTENCY_KEY);
  // eslint-disable-next-line no-control-regex
  if (key && /[\u0000-\u001f\u007f]/.test(key)) {
    throw new AppError("validation", "`idempotency_key` cannot contain control characters.");
  }
  return key;
}

function parseShared(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "boolean") {
    throw new AppError("validation", "`shared_with_agents` is true or false.");
  }
  return value;
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/** One character class and a padding tail: linear on megabytes, unlike a grouped pattern. */
const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Standard base64 with padding, nothing else: no `data:` prefix, no whitespace or line
 * breaks, no URL-safe alphabet. Checked before decoding, because Node's decoder skips
 * anything it does not understand instead of failing.
 */
export function decodeStrictBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("validation", "`data_base64` is required.");
  }
  if (/^data:/i.test(value)) {
    throw new AppError(
      "validation",
      "Send only the base64 in `data_base64`, without a `data:...;base64,` prefix.",
    );
  }
  if (value.length > MAX_BASE64_CHARS) {
    throw new AppError(
      "too_large",
      `The file is over the ${formatLimit(MAX_BASE64_UPLOAD_BYTES)} limit for base64 uploads.`,
      { status: 413 },
    );
  }
  const invalid = () =>
    new AppError(
      "validation",
      "`data_base64` is not valid base64: use the standard alphabet with = padding and no whitespace.",
    );
  if (value.length % 4 !== 0 || !BASE64_ALPHABET.test(value)) throw invalid();
  const bytes = Buffer.from(value, "base64");
  // Canonical only: unused bits in the last character must be zero, so one file has one encoding.
  if (bytes.toString("base64") !== value) throw invalid();
  return bytes;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** True when the bytes really are the declared type: magic numbers for binaries, UTF-8 for text. */
export function bytesMatchMime(mime: UploadMime, bytes: Uint8Array): boolean {
  switch (mime) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"));
    case "image/webp":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8);
    case "application/pdf":
      return startsWith(bytes, ascii("%PDF-"));
    case "text/markdown":
    case "text/plain":
      return isCleanUtf8(bytes);
  }
}

/** Valid UTF-8 with no NUL bytes: what a text file is, and what a binary renamed `.md` is not. */
export function isCleanUtf8(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function formatLimit(bytes: number): string {
  return bytes >= MIB ? `${bytes / MIB} MiB` : `${bytes / KIB} KiB`;
}

function requireBytes(bytes: Buffer, mime: UploadMime, limit: number): Buffer {
  if (bytes.length === 0) throw new AppError("validation", "The file is empty.");
  if (bytes.length > limit) {
    throw new AppError("too_large", `The file is over the ${formatLimit(limit)} limit.`, {
      status: 413,
    });
  }
  if (!bytesMatchMime(mime, bytes)) {
    throw new AppError(
      "content_mismatch",
      mime.startsWith("text/")
        ? "The content is not valid UTF-8 text."
        : `The bytes are not a ${mime} file.`,
      { status: 415 },
    );
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function commonFields(body: Body) {
  const target = parseTarget(body);
  const fileName = parseFileName(body.file_name);
  return {
    workspaceId: parseWorkspaceId(body.workspace_id),
    target,
    fileName,
    sharedWithAgents: parseShared(body.shared_with_agents),
    purpose: parseOptionalText(body.purpose, "`purpose`", MAX_PURPOSE),
    idempotencyKey: parseIdempotencyKey(body.idempotency_key),
  };
}

/** `POST attachments/text`: Markdown or plain text sent as a string. */
export function parseTextUpload(body: Body): UploadIntent {
  const common = commonFields(body);
  const mimeType = parseMime(body.mime_type, common.fileName, TEXT_MIME_TYPES);
  if (typeof body.text !== "string" || body.text.length === 0) {
    throw new AppError("validation", "`text` is required.");
  }
  const bytes = requireBytes(Buffer.from(body.text, "utf8"), mimeType, MAX_TEXT_UPLOAD_BYTES);
  return { ...common, mimeType, bytes };
}

/** `POST attachments/base64`: an image, a PDF or a text file sent as base64. */
export function parseBase64Upload(body: Body): UploadIntent {
  const common = commonFields(body);
  const mimeType = parseMime(body.mime_type, common.fileName, BASE64_MIME_TYPES);
  const bytes = requireBytes(
    decodeStrictBase64(body.data_base64),
    mimeType,
    MAX_BASE64_UPLOAD_BYTES,
  );
  return { ...common, mimeType, bytes };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * The uuid segment of the storage path for an upload with an idempotency key. The same
 * key, uploader and target always give the same segment, so a retry finds the first
 * upload by its path, with no column of its own. It is formatted as a uuid so the path
 * keeps the bucket's `<uploader>/<plan>/<task|plan>/<uuid>-<name>` shape.
 */
export function idempotentSegment(
  key: string,
  scope: { workspaceId: string; userId: string; planId: string; taskId: string | null },
): string {
  const hex = createHash("sha256")
    .update(
      ["boared-attachment", scope.workspaceId, scope.userId, scope.planId, scope.taskId ?? "plan"]
        .concat(key)
        .join("\n"),
    )
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface StoredFacts {
  file_name: string;
  mime_type: string | null;
  sha256: string;
}

/** A retry with the same key is the same upload only when the file is the same file. */
export function sameUpload(existing: StoredFacts, intent: UploadIntent, sha256: string): boolean {
  return (
    existing.sha256 === sha256 &&
    existing.file_name === intent.fileName &&
    (existing.mime_type ?? "") === intent.mimeType
  );
}

// ---------------------------------------------------------------------------
// Reading text back
// ---------------------------------------------------------------------------

export function isTextAttachment(mime: string | null, fileName: string): boolean {
  return (TEXT_MIME_TYPES as readonly string[]).includes(normalizeMime(mime, fileName));
}

/** `?offset=&limit=` in bytes: offset from 0, limit default 64 KiB, at most 256 KiB. */
export function parseTextRange(params: URLSearchParams): { offset: number; limit: number } {
  const read = (name: string, fallback: number) => {
    const raw = params.get(name);
    if (raw === null || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) {
      throw new AppError("validation", `\`${name}\` is a whole number of bytes.`);
    }
    return Number(raw);
  };
  const offset = read("offset", 0);
  const limit = read("limit", DEFAULT_TEXT_READ_BYTES);
  if (limit < 1 || limit > MAX_TEXT_READ_BYTES) {
    throw new AppError("validation", `\`limit\` is from 1 to ${MAX_TEXT_READ_BYTES} bytes.`);
  }
  return { offset, limit };
}

const isContinuation = (byte: number | undefined) =>
  byte !== undefined && (byte & 0b1100_0000) === 0b1000_0000;

export interface TextPage {
  text: string;
  offset: number;
  next_offset: number | null;
  total_bytes: number;
  eof: boolean;
}

/**
 * One page of a UTF-8 file, never splitting a character: a start inside a character
 * moves forward to the next one, an end inside a character moves back to its start.
 * `next_offset` is where the following page starts, or null at the end.
 */
export function utf8Page(bytes: Uint8Array, offset: number, limit: number): TextPage {
  const total = bytes.length;
  let start = Math.min(offset, total);
  while (start < total && isContinuation(bytes[start])) start++;
  let end = Math.min(start + limit, total);
  if (end < total) {
    while (end > start && isContinuation(bytes[end])) end--;
    // A limit smaller than one character still makes progress.
    if (end === start) {
      end = start + 1;
      while (end < total && isContinuation(bytes[end])) end++;
    }
  }
  const text = new TextDecoder("utf-8").decode(bytes.subarray(start, end));
  const eof = end >= total;
  return { text, offset: start, next_offset: eof ? null : end, total_bytes: total, eof };
}

// ---------------------------------------------------------------------------
// Reading a capped body
// ---------------------------------------------------------------------------

/**
 * The JSON object in a request, read with a byte cap so an oversized upload is refused
 * with a 413 while it streams in, not after it has filled memory.
 */
export async function readJsonCapped(request: Request, maxBytes: number): Promise<Body> {
  const tooLarge = () =>
    new AppError(
      "too_large",
      `The request body is over ${formatLimit(maxBytes)}. Send a smaller file.`,
      { status: 413 },
    );
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const chunks: Uint8Array[] = [];
  let received = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  let body: unknown = null;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // falls through to the same message as a body of the wrong shape
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("validation", "Send a JSON object as the request body.");
  }
  return body as Body;
}
