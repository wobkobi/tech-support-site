// src/features/social-design/templates/stack.ts
// Layout engine for the starter templates: content described as nested columns and
// rows, sized from its parts, then centred in a size's safe area inside a frosted card
// sized to fit, as build-ads lays out its cards. Text boxes are estimated from explicit
// line counts; the editor re-measures every text height when the design opens.

import type { FormatLayout, Geometry } from "@/features/social-design/lib/doc";
import { FORMATS, safeRect, type FormatKey } from "@/features/social-design/lib/formats";
import { fullBleed } from "@/features/social-design/lib/layout";
import { MIN_TEXT_PX } from "@/features/social-design/lib/style-checks";

/** One layer's box in a stack. */
export interface Box {
  id: string;
  w: number;
  h: number;
  fontSize?: number;
}

/** Children laid out top to bottom (centred across) or left to right (centred down). */
export interface Stack {
  dir: "col" | "row";
  gap: number;
  children: Node[];
}

export type Node = Box | Stack;

/** How big a template's words and pieces are on one size. */
export interface Frame {
  key: FormatKey;
  /** Scale against a 1080px-wide portrait post. */
  k: number;
  /** Two columns side by side rather than one stacked column. */
  wide: boolean;
  /** Card padding. */
  pad: number;
  /** Smallest font that still reads in a phone feed at this size's width. */
  minFont: number;
  /** Room inside the card for its content. */
  inner: { w: number; h: number };
}

// Scale per core size: the square and Google sizes are shorter, so their words shrink to
// keep the card off the edges; the landscape is shorter again.
const SCALE: Partial<Record<FormatKey, number>> = {
  "feed-4x5": 1,
  square: 0.82,
  story: 1.05,
  "google-4x3": 0.82,
  landscape: 0.6,
};

/**
 * The always-visible area of a size less a 6% margin, where the card goes.
 * @param key - Size.
 * @returns Edges of the area.
 */
function cardArea(key: FormatKey): { x1: number; y1: number; x2: number; y2: number } {
  const f = FORMATS[key];
  const m = Math.round(Math.min(f.width, f.height) * 0.06);
  const s = safeRect(key);
  return { x1: s.x1 + m, y1: s.y1 + m, x2: s.x2 - m, y2: s.y2 - m };
}

/**
 * Frame for a size.
 * @param key - Size.
 * @returns Scale, column mode and the card's inner room.
 */
export function frameFor(key: FormatKey): Frame {
  const k = SCALE[key] ?? 1;
  const a = cardArea(key);
  const pad = Math.round(64 * k);
  return {
    key,
    k,
    wide: FORMATS[key].width / FORMATS[key].height > 1.25,
    pad,
    minFont: Math.ceil((MIN_TEXT_PX * FORMATS[key].width) / 1080),
    inner: { w: a.x2 - a.x1 - pad * 2, h: a.y2 - a.y1 - pad * 2 },
  };
}

/**
 * A text box sized from its line count, as Konva measures it: lines x size x line height.
 * @param id - Layer id.
 * @param lines - Lines of words.
 * @param fontSize - Font size in pixels.
 * @param lineHeight - Line height multiple.
 * @param w - Box width; wide enough that no line wraps.
 * @returns Box.
 */
export function textBox(
  id: string,
  lines: number,
  fontSize: number,
  lineHeight: number,
  w: number,
): Box {
  return { id, w, h: lines * fontSize * lineHeight, fontSize };
}

/**
 * Bullet list box, matching the canvas bullet layout: rows 1.3 lines tall with a gap
 * of 0.45 of the font size between them, one line per item.
 * @param id - Layer id.
 * @param items - Number of items.
 * @param fontSize - Font size in pixels.
 * @param w - Box width.
 * @returns Box.
 */
export function bulletsBox(id: string, items: number, fontSize: number, w: number): Box {
  return { id, w, h: items * fontSize * 1.3 + (items - 1) * fontSize * 0.45, fontSize };
}

/**
 * Column of children.
 * @param gap - Space between children.
 * @param children - Children, top first.
 * @returns Stack.
 */
export function col(gap: number, ...children: Node[]): Stack {
  return { dir: "col", gap, children };
}

/**
 * Row of children.
 * @param gap - Space between children.
 * @param children - Children, left first.
 * @returns Stack.
 */
export function row(gap: number, ...children: Node[]): Stack {
  return { dir: "row", gap, children };
}

/**
 * Size a node takes up.
 * @param node - Box or stack.
 * @returns Width and height.
 */
function sizeOf(node: Node): { w: number; h: number } {
  if (!("dir" in node)) return { w: node.w, h: node.h };
  const sizes = node.children.map(sizeOf);
  const gaps = node.gap * Math.max(0, sizes.length - 1);
  return node.dir === "col"
    ? { w: Math.max(...sizes.map((s) => s.w)), h: sizes.reduce((t, s) => t + s.h, 0) + gaps }
    : { w: sizes.reduce((t, s) => t + s.w, 0) + gaps, h: Math.max(...sizes.map((s) => s.h)) };
}

/**
 * Writes every box in a node into a layout, the node's top-left corner at x, y.
 * @param node - Box or stack.
 * @param x - Left edge.
 * @param y - Top edge.
 * @param out - Layout written into.
 */
function place(node: Node, x: number, y: number, out: FormatLayout): void {
  if (!("dir" in node)) {
    const g: Geometry = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(node.w),
      h: Math.round(node.h),
      rotation: 0,
      linked: true,
    };
    if (node.fontSize !== undefined) g.fontSize = Math.round(node.fontSize);
    out[node.id] = g;
    return;
  }
  const outer = sizeOf(node);
  let at = node.dir === "col" ? y : x;
  for (const child of node.children) {
    const s = sizeOf(child);
    if (node.dir === "col") place(child, x + (outer.w - s.w) / 2, at, out);
    else place(child, at, y + (outer.h - s.h) / 2, out);
    at += (node.dir === "col" ? s.h : s.w) + node.gap;
  }
}

/**
 * Lays a template out on one size: the backdrop full-bleed, the content centred in the
 * safe area and the frosted card around it with the frame's padding.
 * @param frame - Size's frame.
 * @param ids - Backdrop and card layer ids.
 * @param ids.backdrop - Backdrop layer.
 * @param ids.card - Frosted card layer.
 * @param content - Content inside the card.
 * @returns Layout of every layer on the size.
 */
export function cardLayout(
  frame: Frame,
  ids: { backdrop: string; card: string },
  content: Node,
): FormatLayout {
  const a = cardArea(frame.key);
  const s = sizeOf(content);
  const x = (a.x1 + a.x2 - s.w) / 2;
  const y = (a.y1 + a.y2 - s.h) / 2;
  const out: FormatLayout = { [ids.backdrop]: fullBleed(frame.key) };
  place(
    { id: ids.card, w: s.w + frame.pad * 2, h: s.h + frame.pad * 2 },
    x - frame.pad,
    y - frame.pad,
    out,
  );
  place(content, x, y, out);
  return out;
}
