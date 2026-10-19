// src/features/social-design/lib/layout.ts
// Post maker layout maths: placing on a new size, carrying edits to linked sizes, align moves.
// Pure; check-social-design covers every size pair.

import type { DesignDoc, Geometry } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";

// A layer within 2% of covering the whole picture counts as full-bleed (a backdrop or
// a cover photo), and stays full-bleed on every size instead of being scaled.
const FULL_BLEED_SLACK = 0.02;
// A layer whose centre is within 3% of the picture's centre line is centred on it.
const CENTRE_SLACK = 0.03;
// A layer at least 90% of the picture's width or height keeps that share on other sizes.
const SPAN_SHARE = 0.9;

/**
 * Geometry that exactly covers a size.
 * @param key - Size.
 * @returns Full-size geometry, linked.
 */
export function fullBleed(key: FormatKey): Geometry {
  const f = FORMATS[key];
  return { x: 0, y: 0, w: f.width, h: f.height, rotation: 0, linked: true };
}

/**
 * Whether a geometry covers its whole size.
 * @param g - Geometry.
 * @param key - Size it is on.
 * @returns True for a full-bleed layer.
 */
export function isFullBleed(g: Geometry, key: FormatKey): boolean {
  const f = FORMATS[key];
  const sx = f.width * FULL_BLEED_SLACK;
  const sy = f.height * FULL_BLEED_SLACK;
  return (
    g.rotation === 0 &&
    g.x <= sx &&
    g.y <= sy &&
    g.x + g.w >= f.width - sx &&
    g.y + g.h >= f.height - sy
  );
}

/** Which side of the picture a layer keeps its distance to on one axis. */
type Anchor = "start" | "centre" | "end";

/**
 * Picks the anchor on one axis: centre when on the centre line, else the nearer edge.
 * @param pos - Layer start on the axis.
 * @param size - Layer length on the axis.
 * @param total - Picture length on the axis.
 * @returns The anchor.
 */
function anchorOf(pos: number, size: number, total: number): Anchor {
  const centre = pos + size / 2;
  if (Math.abs(centre - total / 2) <= total * CENTRE_SLACK) return "centre";
  return pos <= total - (pos + size) ? "start" : "end";
}

/**
 * Places a length on a new axis, keeping its distance to its anchor scaled.
 * @param pos - Start on the old axis.
 * @param size - Length on the old axis.
 * @param oldTotal - Old axis length.
 * @param newSize - Length on the new axis.
 * @param newTotal - New axis length.
 * @param scale - How much distances shrink or grow.
 * @returns Start on the new axis.
 */
function placeOnAxis(
  pos: number,
  size: number,
  oldTotal: number,
  newSize: number,
  newTotal: number,
  scale: number,
): number {
  const anchor = anchorOf(pos, size, oldTotal);
  if (anchor === "start") return pos * scale;
  if (anchor === "end") return newTotal - (oldTotal - pos - size) * scale - newSize;
  const offset = pos + size / 2 - oldTotal / 2;
  return newTotal / 2 + offset * scale - newSize / 2;
}

/**
 * Nudges a layer back inside the picture from the edge it crosses; one too big is centred.
 * @param pos - Start on the axis.
 * @param size - Length on the axis.
 * @param total - Picture length on the axis.
 * @returns Adjusted start.
 */
function keepInside(pos: number, size: number, total: number): number {
  if (size >= total) return (total - size) / 2;
  return Math.min(Math.max(pos, 0), total - size);
}

/**
 * Places a layer on another size. Full-bleed stays full-bleed; others scale by the shorter-side
 * ratio and keep their anchor distance, a 90%+ span keeps its share, and the result is nudged
 * back inside.
 * @param g - Geometry on the source size.
 * @param from - Source size.
 * @param to - Target size.
 * @returns Geometry on the target size, linked.
 */
export function autoPlace(g: Geometry, from: FormatKey, to: FormatKey): Geometry {
  const a = FORMATS[from];
  const b = FORMATS[to];
  const placed: Geometry = isFullBleed(g, from)
    ? fullBleed(to)
    : (() => {
        const scale = Math.min(b.width, b.height) / Math.min(a.width, a.height);
        let w = g.w * scale;
        let h = g.h * scale;
        if (g.w >= a.width * SPAN_SHARE) w = (g.w / a.width) * b.width;
        if (g.h >= a.height * SPAN_SHARE) h = (g.h / a.height) * b.height;
        // A layer that only fit because the old size was bigger shrinks to fit, keeping
        // its shape.
        const fit = Math.min(1, b.width / w, b.height / h);
        w *= fit;
        h *= fit;
        const x = placeOnAxis(g.x, g.w, a.width, w, b.width, scale * fit);
        const y = placeOnAxis(g.y, g.h, a.height, h, b.height, scale * fit);
        const out: Geometry = {
          x: keepInside(x, w, b.width),
          y: keepInside(y, h, b.height),
          w,
          h,
          rotation: g.rotation,
          linked: true,
        };
        if (g.fontSize !== undefined) out.fontSize = g.fontSize * scale * fit;
        return out;
      })();
  // A full-bleed text layer still scales its font with the shorter side.
  if (g.fontSize !== undefined && placed.fontSize === undefined) {
    placed.fontSize = (g.fontSize * Math.min(b.width, b.height)) / Math.min(a.width, a.height);
  }
  if (g.hidden) placed.hidden = true;
  return round(placed);
}

/**
 * Carries an edit to another size as a change, not a copy, so a hand-tuned layout keeps its
 * shape: centre moves by the same share, size scales by the same factor, rotation by the same angle.
 * @param target - The layer's geometry on the other size.
 * @param before - Geometry on the edited size before the edit.
 * @param after - Geometry on the edited size after the edit.
 * @param from - Edited size.
 * @param to - Other size.
 * @returns New geometry on the other size.
 */
export function propagate(
  target: Geometry,
  before: Geometry,
  after: Geometry,
  from: FormatKey,
  to: FormatKey,
): Geometry {
  const a = FORMATS[from];
  const b = FORMATS[to];
  const sw = after.w / before.w;
  const sh = after.h / before.h;
  const w = target.w * sw;
  const h = target.h * sh;
  const dcx = (after.x + after.w / 2 - (before.x + before.w / 2)) / a.width;
  const dcy = (after.y + after.h / 2 - (before.y + before.h / 2)) / a.height;
  const cx = target.x + target.w / 2 + dcx * b.width;
  const cy = target.y + target.h / 2 + dcy * b.height;
  const out: Geometry = {
    ...target,
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    rotation: normaliseAngle(target.rotation + after.rotation - before.rotation),
  };
  if (target.fontSize !== undefined && before.fontSize && after.fontSize) {
    out.fontSize = target.fontSize * (after.fontSize / before.fontSize);
  }
  if (after.hidden !== before.hidden) {
    if (after.hidden) out.hidden = true;
    else delete out.hidden;
  }
  return round(out);
}

/** Where an align button puts a layer. */
export type AlignTo = "left" | "centre-x" | "right" | "top" | "centre-y" | "bottom" | "centre";

/**
 * Aligns a layer's unrotated box against the picture or a multi-selection's bounds.
 * @param g - Layer geometry.
 * @param how - Which edge or centre line.
 * @param box - Box to align against.
 * @param box.x - Box left.
 * @param box.y - Box top.
 * @param box.w - Box width.
 * @param box.h - Box height.
 * @returns Moved geometry.
 */
export function align(
  g: Geometry,
  how: AlignTo,
  box: { x: number; y: number; w: number; h: number },
): Geometry {
  const out = { ...g };
  if (how === "left") out.x = box.x;
  if (how === "right") out.x = box.x + box.w - g.w;
  if (how === "top") out.y = box.y;
  if (how === "bottom") out.y = box.y + box.h - g.h;
  if (how === "centre-x" || how === "centre") out.x = box.x + (box.w - g.w) / 2;
  if (how === "centre-y" || how === "centre") out.y = box.y + (box.h - g.h) / 2;
  return round(out);
}

/**
 * The whole picture as an align box.
 * @param key - Size.
 * @returns Box covering the picture.
 */
export function canvasBox(key: FormatKey): { x: number; y: number; w: number; h: number } {
  return { x: 0, y: 0, w: FORMATS[key].width, h: FORMATS[key].height };
}

/**
 * Spaces three or more layers evenly between the outermost two along one axis.
 * @param items - Layer ids with their geometry.
 * @param axis - "x" for left-to-right, "y" for top-to-bottom.
 * @returns New geometry per id; the outermost two don't move.
 */
export function distribute(
  items: { id: string; g: Geometry }[],
  axis: "x" | "y",
): Map<string, Geometry> {
  const out = new Map<string, Geometry>();
  const size = axis === "x" ? "w" : "h";
  const sorted = [...items].sort((p, q) => p.g[axis] - q.g[axis]);
  const first = sorted[0]?.g;
  const last = sorted.at(-1)?.g;
  if (sorted.length < 3 || !first || !last) return out;
  const span = last[axis] + last[size] - first[axis];
  const used = sorted.reduce((sum, i) => sum + i.g[size], 0);
  const gap = (span - used) / (sorted.length - 1);
  let pos = first[axis];
  for (const item of sorted) {
    out.set(item.id, round({ ...item.g, [axis]: pos }));
    pos += item.g[size] + gap;
  }
  return out;
}

/**
 * Source size for re-linking: the first other size where the layer is linked, else the first
 * other size.
 * @param doc - Design.
 * @param layerId - Layer being re-linked.
 * @param key - Size it is being re-linked on.
 * @returns Source size, or null when the design has only one size.
 */
export function relinkSource(doc: DesignDoc, layerId: string, key: FormatKey): FormatKey | null {
  const others = doc.formats.filter((f) => f !== key);
  return others.find((f) => doc.layouts[f]?.[layerId]?.linked) ?? others[0] ?? null;
}

/**
 * Keeps an angle in -180 to 180.
 * @param deg - Angle in degrees.
 * @returns Equivalent angle.
 */
function normaliseAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Rounds geometry to tenths of a pixel to keep documents short and stop float drift.
 * @param g - Geometry.
 * @returns Rounded copy.
 */
function round(g: Geometry): Geometry {
  /**
   * Rounds one number to tenths.
   * @param n - Number.
   * @returns Rounded number.
   */
  const r = (n: number): number => Math.round(n * 10) / 10;
  const out: Geometry = {
    ...g,
    x: r(g.x),
    y: r(g.y),
    w: r(g.w),
    h: r(g.h),
    rotation: r(g.rotation),
  };
  if (g.fontSize !== undefined) out.fontSize = r(g.fontSize);
  return out;
}
