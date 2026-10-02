import { describe, expect, it } from "vitest";
import {
  buildContextMessages,
  buildPickFilesMessages,
  capContext,
  filterRepoPaths,
  fitFiles,
  keywordsOf,
  parsePickedFiles,
  rankPaths,
  treeListing,
  truncateFile,
} from "./repo-context";

const blob = (path: string, size = 1000) => ({ path, type: "blob", size });

describe("filterRepoPaths", () => {
  it("keeps code, docs and config and drops the rest", () => {
    const kept = filterRepoPaths([
      blob("src/app.ts"),
      blob("README.md"),
      blob("package.json"),
      blob("Dockerfile"),
      blob("logo.png"),
      blob("package-lock.json"),
      blob("node_modules/x/index.js"),
      blob("dist/bundle.js"),
      blob("src/vendor.min.js"),
      blob("src/routeTree.gen.ts"),
      blob("big.ts", 900_000),
      { path: "src", type: "tree" },
      blob(".github/workflows/ci.yml"),
    ]);
    expect(kept).toEqual(["src/app.ts", "README.md", "package.json", "Dockerfile"]);
  });

  it("accepts entries without a size or type", () => {
    expect(filterRepoPaths([{ path: "a/b.py" }])).toEqual(["a/b.py"]);
  });
});

describe("rankPaths and treeListing", () => {
  const paths = [
    "README.md",
    "src/billing/invoice.ts",
    "src/auth/login.ts",
    "src/deep/a/b/c/util.ts",
    "docs/x.md",
  ];

  it("puts paths that share words with the task first", () => {
    expect(keywordsOf("Fix the Invoice rounding for billing")).toEqual([
      "fix",
      "invoice",
      "rounding",
      "billing",
    ]);
    const ranked = rankPaths(paths, "Fix the invoice rounding for billing");
    expect(ranked.slice(0, 2)).toEqual(["src/billing/invoice.ts", "README.md"]);
    expect(rankPaths(paths, "anything", 2)).toHaveLength(2);
  });

  it("cuts the listing at a size and reports how many fit", () => {
    const listing = treeListing(paths, 40);
    expect(listing.text.length).toBeLessThanOrEqual(40);
    expect(listing.shown.length).toBeLessThan(paths.length);
    expect(listing.total).toBe(paths.length);
    expect(listing.text.split("\n")).toEqual(listing.shown);
  });
});

describe("parsePickedFiles", () => {
  const allowed = new Set(["a.ts", "b.ts", "c.ts", "d.ts"]);

  it("holds the model to the paths it was offered", () => {
    expect(
      parsePickedFiles('{"files":["a.ts","./b.ts","/etc/passwd","nope.ts"]}', allowed),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("dedupes, caps, and reads objects or a bare array", () => {
    expect(parsePickedFiles('["a.ts","a.ts","b.ts","c.ts"]', allowed, 2)).toEqual(["a.ts", "b.ts"]);
    expect(parsePickedFiles('{"files":[{"path":"d.ts"}]}', allowed)).toEqual(["d.ts"]);
    expect(parsePickedFiles("no idea", allowed)).toEqual([]);
    expect(parsePickedFiles('{"files":"a.ts"}', allowed)).toEqual([]);
  });
});

describe("truncating files", () => {
  it("leaves a small file alone and marks a cut one", () => {
    expect(truncateFile("short", 100)).toEqual({ text: "short", truncated: false });
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const cut = truncateFile(big, 300);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toMatch(/… \[truncated: \d+ more characters\]$/);
    expect(cut.text.length).toBeLessThan(400);
    // It cuts at a line end, not mid-word.
    expect(cut.text.split("\n")[cut.text.split("\n").length - 2]).toMatch(/^line \d+$/);
  });

  it("holds each file and the total to their limits and skips binaries", () => {
    const files = [
      { path: "a", content: "a".repeat(5000) },
      { path: "b", content: "b".repeat(5000) },
      { path: "bin", content: "x\u0000y" },
      { path: "c", content: "c".repeat(5000) },
    ];
    const fitted = fitFiles(files, { perFile: 3000, total: 10_000 });
    expect(fitted.map((f) => f.path)).toEqual(["a", "b", "c"]);
    expect(fitted[0].truncated).toBe(true);
    expect(fitted.reduce((sum, f) => sum + f.text.length, 0)).toBeLessThanOrEqual(10_000);
    expect(fitFiles(files, { perFile: 3000, total: 1000 })).toEqual([]);
  });
});

describe("prompts", () => {
  const task = { title: "Add rate limiting", description: "Limit the API", acceptance: null };

  it("tells the model to choose only from the list and reply in JSON", () => {
    const [system, user] = buildPickFilesMessages(task, {
      text: "a.ts\nb.ts",
      total: 50,
      shown: 2,
    });
    expect(system.content).toContain("up to 8 files");
    expect(system.content).toContain('{"files"');
    expect(user.content).toContain("Add rate limiting");
    expect(user.content).toContain("2 of 50 shown");
    expect(user.content).toContain("a.ts\nb.ts");
  });

  it("asks for the four sections and includes every file", () => {
    const [system, user] = buildContextMessages(task, "acme/app", [
      { path: "src/a.ts", text: "export const a = 1;", truncated: false },
    ]);
    for (const heading of ["What exists", "Where to change", "Risks", "Suggested approach"]) {
      expect(system.content).toContain(heading);
    }
    expect(user.content).toContain("Repository: acme/app");
    expect(user.content).toContain("--- src/a.ts ---\nexport const a = 1;");
  });

  it("holds the stored context to a size", () => {
    expect(capContext("  fine  ")).toBe("fine");
    const long = capContext("x".repeat(20_000), 1000);
    expect(long.length).toBeLessThan(1100);
    expect(long).toContain("cut to fit");
  });
});
