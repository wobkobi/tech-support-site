// src/features/social-design/components/canvas/text-layout.ts
// How text-holding layers lay out, shared by the canvas (which draws them) and the
// reflow step (which measures them on every size so each layer's box height matches its
// words). Both go through the same Konva text maths, so a measured box always fits
// what is drawn.

import { boundText } from "@/features/social-design/lib/bound";
import { hexOf, TEXT_PRESETS } from "@/features/social-design/lib/brand";
import type {
  BoundValues,
  BulletsLayer,
  ContactLayer,
  DesignDoc,
  Geometry,
  PromoLayer,
  TextLayer,
} from "@/features/social-design/lib/doc";
import { setTextHeights } from "@/features/social-design/lib/editor-ops";
import type { FormatKey } from "@/features/social-design/lib/formats";
import Konva from "konva";

/** Konva text attributes for one block of words. */
export interface TextSpec {
  text: string;
  fontSize: number;
  fontStyle: string;
  lineHeight: number;
  letterSpacing: number;
  align: "left" | "center" | "right";
  fill: string;
  padding: number;
  width: number;
}

// Smallest font shrink-to-fit goes down to, in pixels.
const MIN_FIT_FONT = 8;

let measurer: Konva.Text | null = null;

/**
 * Height a block of words takes when wrapped to its width.
 * @param spec - Text attributes.
 * @param family - Font-family list.
 * @returns Height in pixels.
 */
export function measure(spec: TextSpec, family: string): number {
  measurer ??= new Konva.Text({ wrap: "word" });
  measurer.setAttrs({ ...spec, fontFamily: family, height: undefined });
  return measurer.height();
}

/**
 * Attributes of a text layer, before any shrink-to-fit.
 * @param layer - Text layer.
 * @param g - Its geometry on the size drawn.
 * @returns Text attributes.
 */
function textLayerSpec(layer: TextLayer, g: Geometry): TextSpec {
  const fontSize = g.fontSize ?? 40;
  return {
    text: layer.text,
    fontSize,
    fontStyle: `${layer.italic ? "italic " : ""}${layer.weight}`,
    lineHeight: layer.lineHeight,
    // Tracking is set in pixels at the preset's own size, so it scales with the font.
    letterSpacing: layer.letterSpacing * (fontSize / TEXT_PRESETS[layer.preset].fontSize),
    align: layer.align,
    fill: hexOf(layer.colour),
    // A highlight band needs room around the words.
    padding: layer.highlight ? Math.round(fontSize * 0.18) : 0,
    width: g.w,
  };
}

/**
 * Attributes of any single-block text layer: text, contact details or promo wording.
 * A shrink-to-fit text layer gets the largest font (down to its set size) that fits
 * its box height.
 * @param layer - Text, contact or promo layer.
 * @param g - Its geometry on the size drawn.
 * @param bound - Live values for contact and promo layers.
 * @param family - Font-family list, for shrink-to-fit measuring.
 * @returns Text attributes.
 */
export function textSpec(
  layer: TextLayer | ContactLayer | PromoLayer,
  g: Geometry,
  bound: BoundValues,
  family: string,
): TextSpec {
  if (layer.type === "text") {
    const spec = textLayerSpec(layer, g);
    if (!layer.shrinkToFit) return spec;
    // Step down 4% at a time; 60 steps reach under 9% of the start size.
    let size = spec.fontSize;
    for (let i = 0; i < 60 && size > MIN_FIT_FONT; i++) {
      const fitted = { ...spec, fontSize: size, padding: layer.highlight ? size * 0.18 : 0 };
      if (measure(fitted, family) <= g.h) return fitted;
      size *= 0.96;
    }
    return { ...spec, fontSize: Math.max(MIN_FIT_FONT, size) };
  }
  const fontSize = g.fontSize ?? 40;
  return {
    text: boundText(layer, bound),
    fontSize,
    fontStyle: layer.type === "promo" ? String(layer.weight) : "600",
    lineHeight: layer.type === "contact" ? 1.4 : 1.2,
    letterSpacing: 0,
    align: "center",
    fill: hexOf(layer.colour),
    padding: 0,
    width: g.w,
  };
}

/** One bullet row: where it starts and its words. */
export interface BulletRow {
  y: number;
  /** Top of the tick badge within the row. */
  badgeY: number;
  spec: TextSpec;
}

/** A laid-out bullet list. */
export interface BulletsLayout {
  badge: number;
  indent: number;
  rows: BulletRow[];
  height: number;
}

/**
 * Lays out a bullet list: a round tick badge, then the words wrapped beside it, each
 * row as tall as its words, with a gap of under half a line between rows. The badge
 * centres on the first line of its row.
 * @param layer - Bullets layer.
 * @param g - Its geometry on the size drawn.
 * @param family - Font-family list.
 * @returns Rows and total height.
 */
export function bulletsLayout(layer: BulletsLayer, g: Geometry, family: string): BulletsLayout {
  const fontSize = g.fontSize ?? 40;
  const badge = fontSize * 1.1;
  const indent = badge + fontSize * 0.5;
  const gap = fontSize * 0.45;
  const lineHeight = 1.3;
  let y = 0;
  const rows: BulletRow[] = layer.items.map((text) => {
    const spec: TextSpec = {
      text,
      fontSize,
      fontStyle: "500",
      lineHeight,
      letterSpacing: 0,
      align: "left",
      fill: hexOf(layer.colour),
      padding: 0,
      width: Math.max(10, g.w - indent),
    };
    const textH = measure(spec, family);
    const row = { y, badgeY: (fontSize * lineHeight - badge) / 2, spec };
    y += Math.max(textH, badge) + gap;
    return row;
  });
  return { badge, indent, rows, height: Math.max(badge, y - gap) };
}

/**
 * Re-measures every auto-height text layer on every listed size and writes the heights
 * into the layouts. Shrink-to-fit text keeps the box height the operator set.
 * @param doc - Design.
 * @param bound - Live values.
 * @param family - Font-family list.
 * @returns The design with heights updated, or the same object when none changed.
 */
export function reflowText(doc: DesignDoc, bound: BoundValues, family: string): DesignDoc {
  const heights: Partial<Record<FormatKey, Record<string, number>>> = {};
  for (const f of doc.formats) {
    const layout = doc.layouts[f];
    if (!layout) continue;
    const byId: Record<string, number> = {};
    for (const layer of doc.layers) {
      const g = layout[layer.id];
      if (!g) continue;
      if (layer.type === "bullets") byId[layer.id] = bulletsLayout(layer, g, family).height;
      else if (layer.type === "contact" || layer.type === "promo")
        byId[layer.id] = measure(textSpec(layer, g, bound, family), family);
      else if (layer.type === "text" && !layer.shrinkToFit)
        byId[layer.id] = measure(textSpec(layer, g, bound, family), family);
    }
    heights[f] = byId;
  }
  return setTextHeights(doc, heights);
}
