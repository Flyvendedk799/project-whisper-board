import { describe, expect, it } from "vitest";
import {
  attachmentKindOf,
  attachmentPath,
  canMarkUpMime,
  describeOutcome,
  effectiveMimeType,
  fileExtensionLabel,
  formatBytes,
  isPlanAttachmentPath,
  markedUpFileName,
  MAX_FILE_BYTES,
  MAX_RECORDING_BYTES,
  partitionUploadable,
  planAttachmentPath,
  slugifyFileName,
  validateFile,
  validateFileMeta,
} from "./upload";
import type { TicketAttachment } from "@/data/types";

const file = (name: string, size: number, type: string) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("attachmentPath", () => {
  /**
   * The storage policy is `(storage.foldername(name))[1] = auth.uid()::text`.
   * Both original call sites led with the project or ticket id, so every
   * non-admin upload was rejected. This is the regression lock for that.
   */
  it("puts the uploader's id first, which is what the storage policy checks", () => {
    const path = attachmentPath("user-1", "ticket-9", "screenshot.png");
    expect(path.split("/")[0]).toBe("user-1");
    expect(path.split("/")[1]).toBe("ticket-9");
  });

  it("gives every upload a distinct path, so identical names cannot collide", () => {
    const a = attachmentPath("u", "t", "shot.png");
    const b = attachmentPath("u", "t", "shot.png");
    expect(a).not.toBe(b);
  });

  it("cannot be walked out of its folder by a hostile filename", () => {
    const path = attachmentPath("u", "t", "../../../etc/passwd");
    expect(path.split("/")).toHaveLength(3);
    expect(path).not.toContain("..");
  });
});

describe("slugifyFileName", () => {
  it("keeps the name recognisable", () => {
    expect(slugifyFileName("Checkout Bug.png")).toBe("checkout-bug.png");
    expect(slugifyFileName("report_v2.final.pdf")).toBe("report_v2.final.pdf");
  });

  it("strips separators and leading dots", () => {
    expect(slugifyFileName("a/b/c.png")).toBe("a-b-c.png");
    expect(slugifyFileName("...hidden")).toBe("hidden");
  });

  it("always returns something", () => {
    expect(slugifyFileName("///")).toBe("file");
    expect(slugifyFileName("")).toBe("file");
  });
});

describe("validateFile", () => {
  it("accepts an ordinary screenshot", () => {
    expect(validateFile(file("a.png", 1024, "image/png"), "attachments")).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(validateFile(file("a.png", 0, "image/png"), "attachments")).toMatch(/empty/);
  });

  it("applies a larger limit to recordings than to files", () => {
    const big = file("r.webm", MAX_FILE_BYTES + 1, "video/webm");
    expect(validateFile(big, "attachments")).toMatch(/limit is/);
    expect(validateFile(big, "recordings")).toBeNull();
    expect(
      validateFile(file("r.webm", MAX_RECORDING_BYTES + 1, "video/webm"), "recordings"),
    ).toMatch(/limit is/);
  });

  it("rejects a type that has no business being attached", () => {
    expect(validateFile(file("x.exe", 100, "application/x-msdownload"), "attachments")).toMatch(
      /can't be attached/,
    );
  });

  it("allows an unknown type, which is what some drag sources report", () => {
    expect(validateFile(file("notes", 100, ""), "attachments")).toBeNull();
  });

  it("names the file in the message, so a batch failure is diagnosable", () => {
    expect(validateFile(file("holiday.mov", 0, "video/quicktime"), "attachments")).toContain(
      "holiday.mov",
    );
  });
});

describe("describeOutcome", () => {
  const row = (id: string) => ({ id }) as TicketAttachment;

  it("says nothing when everything worked", () => {
    expect(describeOutcome({ uploaded: [row("a")], failed: [] })).toBeNull();
  });

  it("reports a partial failure rather than claiming success", () => {
    const message = describeOutcome({
      uploaded: [row("a"), row("b")],
      failed: [{ name: "c.png", reason: "c.png is 40.0 MB — the limit is 25.0 MB." }],
    });
    expect(message).toContain("2 attached");
    expect(message).toContain("1 failed");
    expect(message).toContain("c.png");
  });

  it("gives the actual reason when a single file failed on its own", () => {
    expect(
      describeOutcome({ uploaded: [], failed: [{ name: "c.png", reason: "c.png is empty." }] }),
    ).toBe("c.png is empty.");
  });

  it("summarises when everything failed", () => {
    expect(
      describeOutcome({
        uploaded: [],
        failed: [
          { name: "a", reason: "a" },
          { name: "b", reason: "b" },
        ],
      }),
    ).toMatch(/None of the 2 files/);
  });
});

describe("formatBytes", () => {
  it("picks a unit a person can read", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("plan attachments", () => {
  it("classifies files by type", () => {
    expect(attachmentKindOf("image/png")).toBe("image");
    expect(attachmentKindOf("video/mp4")).toBe("video");
    expect(attachmentKindOf("audio/mpeg")).toBe("audio");
    expect(attachmentKindOf("application/pdf")).toBe("doc");
    expect(attachmentKindOf(null)).toBe("doc");
  });

  it("validates a name, size and type without needing a File", () => {
    expect(validateFileMeta({ name: "a.png", size: 1024, type: "image/png" })).toBeNull();
    expect(validateFileMeta({ name: "a.png", size: 0, type: "image/png" })).toBe("a.png is empty.");
    expect(
      validateFileMeta({ name: "big.mp4", size: MAX_FILE_BYTES + 1, type: "video/mp4" }),
    ).toMatch(/The limit is 25\.0 MB/);
    expect(validateFileMeta({ name: "x.exe", size: 10, type: "application/x-msdownload" })).toMatch(
      /can't be attached/,
    );
    // Drag-and-drop sometimes reports no type; that is allowed, as for tickets.
    expect(validateFileMeta({ name: "notes", size: 10, type: "" })).toBeNull();
    expect(validateFileMeta({ name: "edge", size: MAX_FILE_BYTES, type: "text/plain" })).toBeNull();
  });

  it("splits a dropped batch into uploadable files and reasons", () => {
    const { ok, problems } = partitionUploadable([
      { name: "ok.png", size: 10, type: "image/png" },
      { name: "empty.txt", size: 0, type: "text/plain" },
      { name: "bad.exe", size: 10, type: "application/x-msdownload" },
    ]);
    expect(ok.map((f) => f.name)).toEqual(["ok.png"]);
    expect(problems).toHaveLength(2);
  });

  it("builds a path that starts with the uploader and is checkable later", () => {
    const path = planAttachmentPath("u1", "p1", "t1", "My Screenshot (1).PNG");
    const [user, plan, task, leaf] = path.split("/");
    expect([user, plan, task]).toEqual(["u1", "p1", "t1"]);
    expect(leaf).toMatch(/^[0-9a-f-]{36}-my-screenshot-1-.png$/);
    expect(isPlanAttachmentPath(path, { userId: "u1", planId: "p1", taskId: "t1" })).toBe(true);
    expect(isPlanAttachmentPath(path, { userId: "u2", planId: "p1", taskId: "t1" })).toBe(false);
    expect(isPlanAttachmentPath(path, { userId: "u1", planId: "p1", taskId: "t2" })).toBe(false);
    expect(
      isPlanAttachmentPath("u1/p1/t1/../../etc", { userId: "u1", planId: "p1", taskId: "t1" }),
    ).toBe(false);
  });

  it("files on the plan itself get a path that cannot pass for a task's", () => {
    const path = planAttachmentPath("u1", "p1", null, "Brief.pdf");
    expect(path.split("/").slice(0, 3)).toEqual(["u1", "p1", "plan"]);
    expect(isPlanAttachmentPath(path, { userId: "u1", planId: "p1", taskId: null })).toBe(true);
    // The two kinds are not interchangeable, either way round.
    expect(isPlanAttachmentPath(path, { userId: "u1", planId: "p1", taskId: "t1" })).toBe(false);
    const taskPath = planAttachmentPath("u1", "p1", "t1", "Brief.pdf");
    expect(isPlanAttachmentPath(taskPath, { userId: "u1", planId: "p1", taskId: null })).toBe(
      false,
    );
    expect(isPlanAttachmentPath(path, { userId: "u1", planId: "p2", taskId: null })).toBe(false);
  });

  it("labels files and names marked-up copies", () => {
    expect(fileExtensionLabel("report.final.pdf")).toBe("PDF");
    expect(fileExtensionLabel("README")).toBe("FILE");
    expect(fileExtensionLabel("data.json")).toBe("JSON");
    expect(markedUpFileName("shot.jpeg")).toBe("shot-marked.png");
    expect(markedUpFileName("shot-marked.png")).toBe("shot-marked.png");
    expect(canMarkUpMime("image/png")).toBe(true);
    expect(canMarkUpMime("image/svg+xml")).toBe(false);
    expect(canMarkUpMime("video/mp4")).toBe(false);
  });
});

describe("Markdown files", () => {
  it("are allowed, by type or by a .md name the browser gave no type", () => {
    expect(validateFileMeta({ name: "review.md", size: 10, type: "text/markdown" })).toBeNull();
    expect(validateFileMeta({ name: "review.md", size: 10, type: "" })).toBeNull();
    expect(validateFileMeta({ name: "review.md", size: 10, type: "text/x-markdown" })).toBeNull();
  });

  it("are stored as text/markdown whatever the browser reported", () => {
    expect(effectiveMimeType("review.md", "")).toBe("text/markdown");
    expect(effectiveMimeType("NOTES.MARKDOWN", "text/x-markdown")).toBe("text/markdown");
    expect(effectiveMimeType("shot.png", "image/png")).toBe("image/png");
    expect(effectiveMimeType("data.bin", "")).toBe("");
  });

  it("do not make an unknown type acceptable", () => {
    expect(validateFileMeta({ name: "page.md", size: 10, type: "text/html" })).toMatch(
      /text\/html/,
    );
  });
});
