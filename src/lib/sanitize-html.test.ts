// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToText, sanitizeHtml } from "./sanitize-html";

const ID = "7d6f0c1e-1111-4a2b-8c3d-000000000001";

describe("sanitizeHtml", () => {
  it("keeps the markup the editor makes", () => {
    const html =
      "<p>Hello <strong>bold</strong> <em>it</em></p><ul><li>one</li></ul><pre><code>x</code></pre>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("drops scripts and styles with their content", () => {
    const out = sanitizeHtml(
      "<p>hi</p><script>alert(1)</script><style>p{}</style><SCRIPT>x()</SCRIPT>",
    );
    expect(out).toBe("<p>hi</p>");
  });

  it("strips event handlers and other attributes", () => {
    const out = sanitizeHtml(
      `<img src="https://x.test/a.png" onerror="alert(1)" style="x"><p onclick="x()" class="c">t</p>`,
    );
    expect(out).not.toMatch(/onerror|onclick|style|class/);
    expect(out).toContain('src="https://x.test/a.png"');
    expect(out).toContain("<p>t</p>");
  });

  it("drops an image without a web URL", () => {
    expect(sanitizeHtml(`<img src="x" onerror="alert(1)">`)).toBe("");
    expect(sanitizeHtml(`<img src="javascript:alert(1)">`)).toBe("");
    expect(sanitizeHtml(`<img src="data:image/svg+xml,<svg onload=alert(1)>">`)).toBe("");
  });

  it("unwraps links with javascript: and other unsafe URLs to their text", () => {
    expect(sanitizeHtml(`<a href="javascript:alert(1)">click</a>`)).toBe("click");
    expect(sanitizeHtml(`<a href=" JaVaScRiPt:alert(1)">click</a>`)).toBe("click");
    expect(sanitizeHtml(`<a href="data:text/html,x">click</a>`)).toBe("click");
    expect(sanitizeHtml(`<a>click</a>`)).toBe("click");
  });

  it("opens safe links in a new tab without the opener", () => {
    const out = sanitizeHtml(`<a href="https://example.com" onclick="x()">site</a>`);
    expect(out).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">site</a>',
    );
    expect(sanitizeHtml(`<a href="mailto:a@b.c">mail</a>`)).toContain('href="mailto:a@b.c"');
  });

  it("drops iframes, svg, forms and comments", () => {
    expect(sanitizeHtml(`<iframe srcdoc="<script>x()</script>"></iframe>ok`)).toBe("ok");
    expect(sanitizeHtml(`<svg><script>alert(1)</script></svg>`)).toBe("");
    expect(sanitizeHtml(`<form action="https://evil.test"><button>Go</button></form>ok`)).toBe(
      "ok",
    );
    expect(sanitizeHtml(`<p>a</p><!-- <script>x()</script> -->ok`)).toBe("<p>a</p>ok");
  });

  it("unwraps unknown tags to their text", () => {
    expect(sanitizeHtml("<div><marquee>hi</marquee></div>")).toBe("hi");
  });

  it("keeps a mention chip, rebuilt from its id and label", () => {
    const out = sanitizeHtml(
      `<span data-type="mention" data-id="${ID.toUpperCase()}" data-label="Ada" onclick="x()" style="color:red">@Ada</span>`,
    );
    expect(out).toBe(`<span data-type="mention" data-id="${ID}" data-label="Ada">@Ada</span>`);
  });

  it("unwraps any other span, and a mention with a bad id", () => {
    expect(sanitizeHtml(`<span style="x">plain</span>`)).toBe("plain");
    expect(sanitizeHtml(`<span data-type="mention" data-id="nope">@Ada</span>`)).toBe("@Ada");
  });

  it("escapes a mention label rather than parsing it", () => {
    const out = sanitizeHtml(
      `<span data-type="mention" data-id="${ID}" data-label="<img src=x onerror=alert(1)>">@x</span>`,
    );
    const parsed = new DOMParser().parseFromString(out, "text/html");
    expect(parsed.querySelector("img")).toBeNull();
    expect(parsed.querySelector("span")?.textContent).toBe("@<img src=x onerror=alert(1)>");
  });
});

describe("without a DOM (server render)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reduces markup to escaped text", () => {
    vi.stubGlobal("DOMParser", undefined);
    expect(sanitizeHtml("<p>a &lt;b&gt;</p><script>alert(1)</script><p>c</p>")).toBe(
      "a &lt;b&gt;<br>c",
    );
  });

  it("htmlToText keeps line breaks and decodes entities", () => {
    expect(htmlToText("<p>one</p><p>two &amp; three</p>")).toBe("one\ntwo & three");
  });
});
