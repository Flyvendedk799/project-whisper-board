import { mergeAttributes, Node } from "@tiptap/react";

/**
 * An @mention inside the rich-text editor: an atom that stores the person's id
 * and the name at the time of writing, and serialises to
 *
 *     <span data-type="mention" data-id="…" data-label="Ada">@Ada</span>
 *
 * which is what `extractMentionIds` reads on the server and what
 * `sanitizeHtml` lets through. No suggestion plugin: the editor drives its own
 * small picker (see RichTextEditor), so nothing new is added to the bundle.
 */
export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => (attributes.id ? { "data-id": attributes.id } : {}),
      },
      label: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-label") ?? element.textContent?.replace(/^@/, "") ?? null,
        renderHTML: (attributes) => (attributes.label ? { "data-label": attributes.label } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mention"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "mention" }, HTMLAttributes),
      `@${node.attrs.label ?? "someone"}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label ?? "someone"}`;
  },
});
