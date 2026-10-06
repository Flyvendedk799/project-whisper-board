/**
 * Rich text from the database is shown as HTML, so it is cleaned first.
 *
 * Ticket descriptions and replies are written in TipTap, but the API, an AI
 * draft or an old row can put anything in those columns, and the text is shown
 * to everyone on the project. This keeps the handful of tags the editor makes
 * (and mention chips), drops every attribute that is not on the list, and
 * unwraps everything else to its text. Scripts, styles and event handlers never
 * survive.
 *
 * It uses the browser's own parser. On the server (where there is none, and
 * where the app shell renders no rich text anyway) the markup is reduced to text.
 */

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strike",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "head",
  "title",
  "form",
  "textarea",
  "select",
  "button",
]);

const SAFE_URL = /^(https?:|mailto:)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SAFE_URL.test(trimmed) ? trimmed : null;
}

function cleanElement(source: Element, doc: Document): Node | DocumentFragment | null {
  const tag = source.tagName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return null;

  const children = () => {
    const fragment = doc.createDocumentFragment();
    source.childNodes.forEach((child) => {
      const cleaned = cleanNode(child, doc);
      if (cleaned) fragment.appendChild(cleaned);
    });
    return fragment;
  };

  if (!ALLOWED_TAGS.has(tag)) return children();

  if (tag === "span") {
    // Only a mention chip keeps its span; any other span is unwrapped.
    const id = source.getAttribute("data-id");
    if (source.getAttribute("data-type") !== "mention" || !id || !UUID.test(id)) {
      return children();
    }
    const chip = doc.createElement("span");
    const label = (source.getAttribute("data-label") ?? source.textContent ?? "")
      .replace(/^@/, "")
      .slice(0, 120);
    chip.setAttribute("data-type", "mention");
    chip.setAttribute("data-id", id.toLowerCase());
    chip.setAttribute("data-label", label);
    chip.textContent = `@${label}`;
    return chip;
  }

  const element = doc.createElement(tag);
  if (tag === "a") {
    const href = safeUrl(source.getAttribute("href"));
    if (!href) return children();
    element.setAttribute("href", href);
    element.setAttribute("target", "_blank");
    element.setAttribute("rel", "noopener noreferrer nofollow");
  }
  if (tag === "img") {
    const src = safeUrl(source.getAttribute("src"));
    if (!src || src.startsWith("mailto:")) return null;
    element.setAttribute("src", src);
    element.setAttribute("alt", source.getAttribute("alt") ?? "");
    element.setAttribute("loading", "lazy");
    element.setAttribute("referrerpolicy", "no-referrer");
    return element;
  }
  if ((tag === "td" || tag === "th") && source.getAttribute("colspan")) {
    const span = Number(source.getAttribute("colspan"));
    if (Number.isInteger(span) && span > 1 && span < 50) element.setAttribute("colspan", `${span}`);
  }
  if (tag === "ol" && source.getAttribute("start")) {
    const start = Number(source.getAttribute("start"));
    if (Number.isInteger(start)) element.setAttribute("start", `${start}`);
  }
  element.appendChild(children());
  return element;
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType === 1) return cleanElement(node as Element, doc);
  return null; // Comments, processing instructions, doctype.
}

/** Markup to text, for where there is no DOM. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/li|\/h[1-4])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Safe HTML for `dangerouslySetInnerHTML`. */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return escapeText(htmlToText(html)).replace(/\n/g, "<br>");
  }
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const container = out.createElement("div");
  parsed.body.childNodes.forEach((child) => {
    const cleaned = cleanNode(child, out);
    if (cleaned) container.appendChild(cleaned);
  });
  return container.innerHTML;
}
