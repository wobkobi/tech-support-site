// src/features/mailing/lib/blocks.ts
// The block editor's view of an email body. The body text stays the saved format: this
// reads it into blocks and writes blocks back, walking lines exactly as renderBody does,
// so a parse and re-serialise always renders the same email. Pure and client-safe.

import {
  BUTTON_LINE_RE,
  DIRECTIVE_RE,
  DIVIDER_RE,
  IMAGE_LINE_RE,
  isDirective,
  isListLine,
  LINKED_IMAGE_LINE_RE,
  QUOTE_LINE_RE,
  QUOTE_NAME_RE,
  QUOTE_STARS_RE,
} from "@/features/mailing/lib/body-syntax";

/** One block. `id` only keys the editor's list; it is never saved. */
export type Block =
  | { id: string; type: "heading"; text: string; size: "big" | "small" }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "button"; label: string; url: string }
  | { id: string; type: "picture"; alt: string; url: string; small: boolean; link: string }
  | { id: string; type: "quote"; stars: number; text: string; name: string }
  | { id: string; type: "promo" }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer" }
  | { id: string; type: "social" };

/** Every block type. */
export type BlockType = Block["type"];

/** Names the editor shows for each block type, in Add-menu order. */
export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  list: "Bullet list",
  button: "Button",
  picture: "Picture",
  promo: "Promo card",
  quote: "Review quote",
  divider: "Divider",
  spacer: "Space",
  social: "Social links",
};

let idCounter = 0;

/**
 * A fresh block id. Not crypto.randomUUID: that is missing on plain-http
 * origins, such as the admin opened on a phone over the local network.
 * @returns A unique id for this page session.
 */
export function newBlockId(): string {
  idCounter += 1;
  return `b${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A new, empty block of a type, as the Add menu inserts it.
 * @param type - Block type.
 * @returns The block.
 */
export function emptyBlock(type: BlockType): Block {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type, text: "", size: "big" };
    case "text":
      return { id, type, text: "" };
    case "list":
      return { id, type, items: [""] };
    case "button":
      return { id, type, label: "", url: "" };
    case "picture":
      return { id, type, alt: "", url: "", small: false, link: "" };
    case "quote":
      return { id, type, stars: 5, text: "", name: "" };
    default:
      return { id, type };
  }
}

/**
 * Parses a body into blocks. Lines are grouped the way renderBody groups them:
 * a blank line ends a paragraph, list or quote, and every other block stands
 * alone on its line. Text that isn't any block, including an unknown `::word`,
 * becomes a Text block, so nothing the operator typed is lost.
 * @param body - Body text.
 * @returns The blocks, top to bottom.
 */
export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];

  /** Closes the paragraph being collected. */
  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push({ id: newBlockId(), type: "text", text: paragraph.join("\n") });
    paragraph = [];
  }
  /** Closes the bullet list being collected. */
  function flushList(): void {
    if (list.length === 0) return;
    blocks.push({ id: newBlockId(), type: "list", items: list });
    list = [];
  }
  /** Closes the quote being collected, reading stars and name as renderBody does. */
  function flushQuote(): void {
    if (quote.length === 0) return;
    const lines = quote.filter(Boolean);
    quote = [];
    const stars = lines[0]?.match(QUOTE_STARS_RE)?.[1] ?? "";
    if (stars) lines.shift();
    const name = lines.length > 1 ? (lines.at(-1)?.match(QUOTE_NAME_RE)?.[1] ?? "") : "";
    if (name) lines.pop();
    blocks.push({
      id: newBlockId(),
      type: "quote",
      stars: stars.length,
      text: lines.join("\n"),
      name,
    });
  }
  /**
   * Adds a block that stands alone on its line, closing any open paragraph.
   * @param block - The block.
   */
  function push(block: Block): void {
    flushParagraph();
    blocks.push(block);
  }

  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    const quoted = line.match(QUOTE_LINE_RE);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!.trim());
      continue;
    }
    flushQuote();
    if (isListLine(line)) {
      flushParagraph();
      list.push(line.slice(2).trim());
      continue;
    }
    flushList();

    const id = newBlockId();
    if (DIVIDER_RE.test(line)) {
      push({ id, type: "divider" });
      continue;
    }
    const directive = line.match(DIRECTIVE_RE);
    if (directive) {
      const word = directive[1]!;
      if (!isDirective(word)) push({ id, type: "text", text: line });
      else if (word === "promo") push({ id, type: "promo" });
      else if (word === "space") push({ id, type: "spacer" });
      else push({ id, type: "social" });
      continue;
    }
    const linked = line.match(LINKED_IMAGE_LINE_RE);
    const image = linked ?? line.match(IMAGE_LINE_RE);
    if (image) {
      push({
        id,
        type: "picture",
        alt: image[1]!,
        url: image[2]!,
        small: Boolean(image[3]),
        link: linked ? linked[4]! : "",
      });
      continue;
    }
    const button = line.match(BUTTON_LINE_RE);
    if (button) {
      push({ id, type: "button", label: button[1]!, url: button[2]! });
      continue;
    }
    if (line.startsWith("## ")) {
      push({ id, type: "heading", text: line.slice(3).trim(), size: "small" });
      continue;
    }
    if (line.startsWith("# ")) {
      push({ id, type: "heading", text: line.slice(2).trim(), size: "big" });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushQuote();
  return blocks;
}

/**
 * Text that can sit inside `[...]` without closing it early or breaking the line.
 * @param text - Label or alt text.
 * @returns The text with `]` and line breaks removed.
 */
function bracketSafe(text: string): string {
  return text.replace(/[\]\r\n]/g, " ").trim();
}

/**
 * Non-blank, trimmed lines of a multi-line field.
 * @param text - Field text.
 * @returns Its lines.
 */
function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The body text for one block, or an empty string when the block is still empty
 * and should be left out. A button with a label but no link is kept, so the
 * problems list can point it out instead of it silently vanishing.
 * @param block - The block.
 * @returns Its lines.
 */
export function serializeBlock(block: Block): string {
  switch (block.type) {
    case "heading": {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (!text) return "";
      return `${block.size === "small" ? "##" : "#"} ${text}`;
    }
    case "text":
      return block.text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((l) => l.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    case "list":
      return block.items
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((item) => `- ${item}`)
        .join("\n");
    case "button": {
      const label = bracketSafe(block.label);
      const url = block.url.trim();
      if (!label && !url) return "";
      return `[${label}](${url})`;
    }
    case "picture": {
      const url = block.url.trim();
      if (!url) return "";
      const img = `![${bracketSafe(block.alt)}](${url}${block.small ? ' "small"' : ""})`;
      const link = block.link.trim();
      return link ? `[${img}](${link})` : img;
    }
    case "quote": {
      const text = linesOf(block.text);
      if (text.length === 0) return "";
      const stars = Math.max(0, Math.min(5, Math.round(block.stars)));
      const name = block.name.replace(/\s+/g, " ").trim();
      return [
        ...(stars > 0 ? [`> ${"★".repeat(stars)}`] : []),
        ...text.map((l) => `> ${l}`),
        ...(name ? [`> - ${name}`] : []),
      ].join("\n");
    }
    case "promo":
      return "::promo";
    case "divider":
      return "---";
    case "spacer":
      return "::space";
    case "social":
      return "::social";
  }
}

/**
 * Writes blocks back to body text, one blank line between blocks. Empty blocks
 * are left out.
 * @param blocks - The blocks, top to bottom.
 * @returns Body text.
 */
export function serializeBlocks(blocks: readonly Block[]): string {
  return blocks.map(serializeBlock).filter(Boolean).join("\n\n");
}

/**
 * Whether a block has nothing in it yet, so the editor shows a hint and the
 * body leaves it out.
 * @param block - The block.
 * @returns True when empty.
 */
export function isEmptyBlock(block: Block): boolean {
  return serializeBlock(block) === "";
}
