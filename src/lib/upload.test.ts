import { describe, expect, it } from "vitest";
import {
  attachmentPath,
  describeOutcome,
  formatBytes,
  MAX_FILE_BYTES,
  MAX_RECORDING_BYTES,
  slugifyFileName,
  validateFile,
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
