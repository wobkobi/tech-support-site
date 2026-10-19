// src/features/mailing/lib/blocks.ts
// Parses an email body into blocks and writes them back. renderBody uses the same blocks,
// so the editor and sent email agree. Pure and client-safe.

import {
  BOX_LINE_RE,
  BUTTON_LINE_RE,
  BUTTON_PLACEHOLDER_RE,
  DIRECTIVE_RE,
  DIVIDER_RE,
  IMAGE_LINE_RE,
  isDirective,
  isListLine,
  LINKED_IMAGE_LINE_RE,
  PICTURE_PLACEHOLDER_RE,
  QUOTE_LINE_RE,
  QUOTE_NAME_RE,
  QUOTE_STARS_RE,
  readBox,
} from "@/features/mailing/lib/body-syntax";

/** One block. `id` only keys the editor's list; it is never saved. */
export type Block =
  | { id: string; type: "heading"; text: string; size: "big" | "small" }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "list"; items: string[] }
  | { id: string; type: "button"; label: string; url: string }
  | { id: string; type: "picture"; alt: string; url: string; small: boolean; link: string }
  | { id: string; type: "quote"; stars: number; text: string; name: string }
  | {
      id: string;
      type: "box";
      photo: string;
      headline: string;
      /** Smaller lines under the headline, one per line. */
      line: string;
      label: string;
      url: string;
    }
  | { id: string; type: "promo" }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer" }
  | { id: string; type: "social" };

/** Every block type. */
export type BlockType = Block["type"];

/** Omit that keeps a union a union, so each block type keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Names the editor shows for each block type, in Add-menu order. */
export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: "Heading",
  text: "Text",
  list: "Bullet list",
  button: "Button",
  picture: "Picture",
  box: "Big box",
  promo: "Promo card",
  quote: "Review quote",
  divider: "Divider",
  spacer: "Space",
  social: "Social links",
};

let idCounter = 0;

/**
 * A fresh block id. Not crypto.randomUUID, which plain-http origins (LAN phone testing) lack.
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
    case "box":
      return { id, type, photo: "", headline: "", line: "", label: "", url: "" };
    default:
      return { id, type };
  }
}

/**
 * Parses a body into blocks. A blank line ends a paragraph, list or quote; anything else
 * unrecognised (even an unknown `::word`) becomes a Text block so nothing is lost.
 * Ids are prefix + position for stable hydration; re-parse with a fresh prefix on the client.
 * @param body - Body text.
 * @param idPrefix - Start of every id.
 * @returns The blocks, top to bottom.
 */
export function parseBlocks(body: string, idPrefix = "p"): Block[] {
  const blocks: Block[] = [];
  /**
   * The next block's id.
   * @returns The id.
   */
  const nextId = (): string => `${idPrefix}${blocks.length}`;
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let box: string[] = [];

  /** Closes the paragraph being collected. */
  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push({ id: nextId(), type: "text", text: paragraph.join("\n") });
    paragraph = [];
  }
  /** Closes the big box being collected, reading its photo, headline, lines and button. */
  function flushBox(): void {
    if (box.length === 0) return;
    const parts = readBox(box.filter(Boolean));
    box = [];
    blocks.push({
      id: nextId(),
      type: "box",
      photo: parts.photo,
      headline: parts.headline,
      line: parts.lines.join("\n"),
      label: parts.label,
      url: parts.url,
    });
  }
  /** Closes the bullet list being collected. */
  function flushList(): void {
    if (list.length === 0) return;
    blocks.push({ id: nextId(), type: "list", items: list });
    list = [];
  }
  /**
   * Closes the quote being collected: a leading stars line is the rating, a last `- Name` the author.
   */
  function flushQuote(): void {
    if (quote.length === 0) return;
    const lines = quote.filter(Boolean);
    quote = [];
    const stars = lines[0]?.match(QUOTE_STARS_RE)?.[1] ?? "";
    if (stars) lines.shift();
    const name = lines.length > 1 ? (lines.at(-1)?.match(QUOTE_NAME_RE)?.[1] ?? "") : "";
    if (name) lines.pop();
    blocks.push({
      id: nextId(),
      type: "quote",
      stars: stars.length,
      text: lines.join("\n"),
      name,
    });
  }
  /**
   * Adds a standalone block, closing any open paragraph first so ids stay in order.
   * @param block - The block, minus its id.
   */
  function push(block: DistributiveOmit<Block, "id">): void {
    flushParagraph();
    blocks.push({ ...block, id: nextId() });
  }

  for (const rawLine of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      flushQuote();
      flushBox();
      continue;
    }
    const boxed = line.match(BOX_LINE_RE);
    if (boxed) {
      flushParagraph();
      flushList();
      flushQuote();
      box.push(boxed[1]!.trim());
      continue;
    }
    flushBox();
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

    if (DIVIDER_RE.test(line)) {
      push({ type: "divider" });
      continue;
    }
    const directive = line.match(DIRECTIVE_RE);
    if (directive) {
      const word = directive[1]!;
      if (!isDirective(word)) push({ type: "text", text: line });
      else if (word === "promo") push({ type: "promo" });
      else if (word === "space") push({ type: "spacer" });
      else push({ type: "social" });
      continue;
    }
    const placeholder = line.match(PICTURE_PLACEHOLDER_RE);
    if (placeholder) {
      push({ type: "picture", alt: placeholder[1]!, url: "", small: false, link: "" });
      continue;
    }
    const linked = line.match(LINKED_IMAGE_LINE_RE);
    const image = linked ?? line.match(IMAGE_LINE_RE);
    if (image) {
      push({
        type: "picture",
        alt: image[1]!,
        url: image[2]!,
        small: Boolean(image[3]),
        link: linked ? linked[4]! : "",
      });
      continue;
    }
    const button = line.match(BUTTON_LINE_RE) ?? line.match(BUTTON_PLACEHOLDER_RE);
    if (button) {
      push({ type: "button", label: button[1]!, url: button[2] ?? "" });
      continue;
    }
    if (line.startsWith("## ")) {
      push({ type: "heading", text: line.slice(3).trim(), size: "small" });
      continue;
    }
    if (line.startsWith("# ")) {
      push({ type: "heading", text: line.slice(2).trim(), size: "big" });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushQuote();
  flushBox();
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
 * The body text for one block, or "" when empty. A button with a label but no link is
 * kept so the problems list can flag it.
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
      // No picture yet: a described one stays as a placeholder; a blank one is empty.
      if (!url) return block.alt.trim() ? `![${bracketSafe(block.alt)}]()` : "";
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
    case "box": {
      // No headline, no box: the photo and button wait in the editor until it has one.
      const headline = block.headline.replace(/\s+/g, " ").trim();
      if (!headline) return "";
      const photo = block.photo.trim();
      const label = bracketSafe(block.label);
      return [
        ...(photo ? [`![](${photo})`] : []),
        headline,
        ...linesOf(block.line),
        ...(label ? [`[${label}](${block.url.trim()})`] : []),
      ]
        .map((l) => `>> ${l}`)
        .join("\n");
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
 * Writes blocks back to body text, one blank line apart, leaving out empty blocks.
 * @param blocks - The blocks, top to bottom.
 * @returns Body text.
 */
export function serializeBlocks(blocks: readonly Block[]): string {
  return blocks.map(serializeBlock).filter(Boolean).join("\n\n");
}

/**
 * Whether a block is still empty (the editor hints; the body leaves it out).
 * @param block - The block.
 * @returns True when empty.
 */
export function isEmptyBlock(block: Block): boolean {
  return serializeBlock(block) === "";
}
