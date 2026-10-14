// src/features/social-design/lib/editor-ops.ts
// Every change the post maker editor makes to a design, as pure functions from one
// document to the next: adding, moving, restyling, reordering, grouping and pasting
// layers. Geometry edits on one size carry across to the sizes where the layer is
// still linked. Pure and client-safe; check-social-design covers them.

import { TEXT_PRESETS, type TextPreset } from "@/features/social-design/lib/brand";
import {
  newLayerId,
  TEXT_LIKE,
  type DesignDoc,
  type FormatLayout,
  type Geometry,
  type Layer,
} from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import {
  align,
  autoPlace,
  canvasBox,
  distribute,
  propagate,
  type AlignTo,
} from "@/features/social-design/lib/layout";

/** A rectangle in picture pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Which sizes an edit reaches: "all" carries it to every size where the layer is
 * linked, "this" changes only the size on screen and unlinks the layer there.
 */
export type EditScope = "all" | "this";

/** Layers and their places, as held on the editor's clipboard. */
export interface Clip {
  layers: Layer[];
  layouts: Partial<Record<FormatKey, FormatLayout>>;
}

/**
 * Index of a layer in the stack.
 * @param doc - Design.
 * @param id - Layer id.
 * @returns Index, or -1.
 */
function indexOf(doc: DesignDoc, id: string): number {
  return doc.layers.findIndex((l) => l.id === id);
}

/**
 * A layer by id.
 * @param doc - Design.
 * @param id - Layer id.
 * @returns The layer, or undefined.
 */
export function layerById(doc: DesignDoc, id: string): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

/**
 * Smallest box around several boxes.
 * @param boxes - Boxes to cover.
 * @returns The covering box, or null for none.
 */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Box around the given layers on one size.
 * @param doc - Design.
 * @param format - Size.
 * @param ids - Layer ids.
 * @returns The box, or null when none of them has a place there.
 */
export function selectionBox(doc: DesignDoc, format: FormatKey, ids: string[]): Box | null {
  const layout = doc.layouts[format] ?? {};
  return unionBox(ids.flatMap((id) => (layout[id] ? [layout[id]] : [])));
}

/**
 * Adds every member of a group when one member is picked, so a group always selects
 * as a whole.
 * @param doc - Design.
 * @param ids - Picked layer ids.
 * @returns Picked ids plus their group mates, in stack order.
 */
export function expandGroups(doc: DesignDoc, ids: string[]): string[] {
  const groups = new Set(
    ids.map((id) => layerById(doc, id)?.groupId).filter((g): g is string => !!g),
  );
  const picked = new Set(ids);
  return doc.layers
    .filter((l) => picked.has(l.id) || (l.groupId !== null && groups.has(l.groupId)))
    .map((l) => l.id);
}

/**
 * Applies a patch to some layers. The patch function sees each layer and returns the
 * fields to change, so one call can restyle a mixed selection.
 * @param doc - Design.
 * @param ids - Layers to change.
 * @param patch - Fields to change per layer.
 * @returns New design.
 */
export function updateLayers(
  doc: DesignDoc,
  ids: string[],
  patch: (layer: Layer) => Partial<Layer>,
): DesignDoc {
  const set = new Set(ids);
  return {
    ...doc,
    layers: doc.layers.map((l) => (set.has(l.id) ? ({ ...l, ...patch(l) } as Layer) : l)),
  };
}

/**
 * Writes new geometry for some layers on the size being edited. With "all", each
 * change carries to every other listed size where that layer is linked, as the same
 * move, resize and turn rather than a copy; with "this", only the edited size changes
 * and the layer becomes unlinked there.
 * @param doc - Design.
 * @param format - Size the edit was made on.
 * @param changes - New geometry per layer id on that size.
 * @param scope - Which sizes the edit reaches.
 * @returns New design.
 */
export function setGeometry(
  doc: DesignDoc,
  format: FormatKey,
  changes: Record<string, Geometry>,
  scope: EditScope,
): DesignDoc {
  const layouts = { ...doc.layouts };
  const here = { ...(layouts[format] ?? {}) };
  for (const [id, after] of Object.entries(changes)) {
    const before = here[id];
    if (!before) continue;
    here[id] = scope === "this" ? { ...after, linked: false } : { ...after, linked: before.linked };
    if (scope !== "all") continue;
    for (const other of doc.formats) {
      if (other === format) continue;
      const target = layouts[other]?.[id];
      if (!target?.linked) continue;
      layouts[other] = {
        ...layouts[other],
        [id]: propagate(target, before, after, format, other),
      };
    }
  }
  layouts[format] = here;
  return { ...doc, layouts };
}

/**
 * Updates the measured height of auto-height text layers without touching anything
 * else: no linking, no carrying across. A layer's text height depends on its width and
 * font size on each size, so each size gets its own.
 * @param doc - Design.
 * @param heights - Measured height per size per layer id.
 * @returns New design, or the same object when nothing changed by half a pixel or more.
 */
export function setTextHeights(
  doc: DesignDoc,
  heights: Partial<Record<FormatKey, Record<string, number>>>,
): DesignDoc {
  let changed = false;
  const layouts = { ...doc.layouts };
  for (const [format, byId] of Object.entries(heights) as [FormatKey, Record<string, number>][]) {
    const layout = layouts[format];
    if (!layout) continue;
    let next: FormatLayout | null = null;
    for (const [id, h] of Object.entries(byId)) {
      const g = layout[id];
      if (!g || Math.abs(g.h - h) < 0.5) continue;
      next ??= { ...layout };
      next[id] = { ...g, h: Math.max(1, Math.round(h * 10) / 10) };
    }
    if (next) {
      layouts[format] = next;
      changed = true;
    }
  }
  return changed ? { ...doc, layouts } : doc;
}

/**
 * Places a new layer: given geometry on the size on screen, auto-placed on every other
 * listed size, and put on top of the stack (or right above `above`).
 * @param doc - Design.
 * @param layer - New layer.
 * @param format - Size on screen.
 * @param g - Its geometry there.
 * @param above - Optional layer id to sit just above.
 * @returns New design.
 */
export function addLayer(
  doc: DesignDoc,
  layer: Layer,
  format: FormatKey,
  g: Geometry,
  above?: string,
): DesignDoc {
  const layouts = { ...doc.layouts };
  for (const f of doc.formats) {
    layouts[f] = { ...layouts[f], [layer.id]: f === format ? g : autoPlace(g, format, f) };
  }
  const layers = [...doc.layers];
  const at = above ? indexOf(doc, above) : -1;
  layers.splice(at === -1 ? layers.length : at + 1, 0, layer);
  return { ...doc, layers, layouts };
}

/**
 * Removes layers and their places on every size.
 * @param doc - Design.
 * @param ids - Layers to remove.
 * @returns New design.
 */
export function removeLayers(doc: DesignDoc, ids: string[]): DesignDoc {
  const gone = new Set(ids);
  const layouts: DesignDoc["layouts"] = {};
  for (const [f, layout] of Object.entries(doc.layouts) as [FormatKey, FormatLayout][]) {
    layouts[f] = Object.fromEntries(Object.entries(layout).filter(([id]) => !gone.has(id)));
  }
  return { ...doc, layers: doc.layers.filter((l) => !gone.has(l.id)), layouts };
}

/**
 * Copies layers with their places on every size, ready to paste.
 * @param doc - Design.
 * @param ids - Layers to copy.
 * @returns Clipboard contents, bottom layer first.
 */
export function copyLayers(doc: DesignDoc, ids: string[]): Clip {
  const set = new Set(ids);
  const layers = doc.layers.filter((l) => set.has(l.id));
  const layouts: Clip["layouts"] = {};
  for (const [f, layout] of Object.entries(doc.layouts) as [FormatKey, FormatLayout][]) {
    layouts[f] = Object.fromEntries(Object.entries(layout).filter(([id]) => set.has(id)));
  }
  return { layers, layouts };
}

/**
 * Pastes copied layers on top of the stack with fresh ids, shifted down and right so
 * the copy doesn't hide the original. Groups in the clip become new groups. A size the
 * clip has no place on (copied from a design without that size) is auto-placed from
 * the size on screen.
 * @param doc - Design.
 * @param clip - Clipboard contents.
 * @param format - Size on screen.
 * @param offset - Shift in pixels at 1080 wide; 0 pastes in place.
 * @returns New design and the pasted layer ids.
 */
export function pasteLayers(
  doc: DesignDoc,
  clip: Clip,
  format: FormatKey,
  offset = 24,
): { doc: DesignDoc; ids: string[] } {
  const idMap = new Map(clip.layers.map((l) => [l.id, newLayerId()]));
  const groupMap = new Map<string, string>();
  const layers = clip.layers.map((l): Layer => {
    let groupId: string | null = null;
    if (l.groupId) {
      groupId = groupMap.get(l.groupId) ?? newLayerId();
      groupMap.set(l.groupId, groupId);
    }
    return { ...l, id: idMap.get(l.id) ?? newLayerId(), groupId, locked: false };
  });
  const layouts = { ...doc.layouts };
  for (const f of doc.formats) {
    const shift = offset * (Math.min(FORMATS[f].width, FORMATS[f].height) / 1080);
    const next = { ...layouts[f] };
    for (const l of clip.layers) {
      const id = idMap.get(l.id);
      if (!id) continue;
      const own = clip.layouts[f]?.[l.id];
      const from = clip.layouts[format]?.[l.id] ? format : firstPlaced(clip, l.id);
      const src = from ? clip.layouts[from]?.[l.id] : undefined;
      const g = own ?? (src && from ? autoPlace(src, from, f) : null);
      if (!g) continue;
      next[id] = { ...g, x: g.x + shift, y: g.y + shift };
    }
    layouts[f] = next;
  }
  return { doc: { ...doc, layers: [...doc.layers, ...layers], layouts }, ids: [...idMap.values()] };
}

/**
 * First size in a clip that has a place for a layer.
 * @param clip - Clipboard contents.
 * @param id - Layer id in the clip.
 * @returns The size, or null.
 */
function firstPlaced(clip: Clip, id: string): FormatKey | null {
  for (const [f, layout] of Object.entries(clip.layouts) as [FormatKey, FormatLayout][]) {
    if (layout[id]) return f;
  }
  return null;
}

/**
 * Duplicates layers in place, each copy shifted a little.
 * @param doc - Design.
 * @param ids - Layers to copy.
 * @param format - Size on screen.
 * @returns New design and the copies' ids.
 */
export function duplicateLayers(
  doc: DesignDoc,
  ids: string[],
  format: FormatKey,
): { doc: DesignDoc; ids: string[] } {
  return pasteLayers(doc, copyLayers(doc, ids), format);
}

/** Stack moves. */
export type StackMove = "forward" | "backward" | "front" | "back";

/**
 * Moves layers up or down the stack, keeping their order among themselves. Forward and
 * backward step past one neighbour that isn't moving.
 * @param doc - Design.
 * @param ids - Layers to move.
 * @param how - Which way.
 * @returns New design.
 */
export function restack(doc: DesignDoc, ids: string[], how: StackMove): DesignDoc {
  const set = new Set(ids);
  const moving = doc.layers.filter((l) => set.has(l.id));
  const rest = doc.layers.filter((l) => !set.has(l.id));
  if (moving.length === 0) return doc;
  if (how === "front") return { ...doc, layers: [...rest, ...moving] };
  if (how === "back") return { ...doc, layers: [...moving, ...rest] };
  const layers = [...doc.layers];
  if (how === "forward") {
    for (let i = layers.length - 2; i >= 0; i--) {
      const a = layers[i];
      const b = layers[i + 1];
      if (a && b && set.has(a.id) && !set.has(b.id)) [layers[i], layers[i + 1]] = [b, a];
    }
  } else {
    for (let i = 1; i < layers.length; i++) {
      const a = layers[i - 1];
      const b = layers[i];
      if (a && b && set.has(b.id) && !set.has(a.id)) [layers[i - 1], layers[i]] = [b, a];
    }
  }
  return { ...doc, layers };
}

/**
 * Moves one layer to a stack position, for drag-to-reorder in the layers panel.
 * @param doc - Design.
 * @param id - Layer to move.
 * @param to - New index, bottom layer = 0.
 * @returns New design.
 */
export function moveLayerTo(doc: DesignDoc, id: string, to: number): DesignDoc {
  const from = indexOf(doc, id);
  if (from === -1 || from === to) return doc;
  const layers = [...doc.layers];
  const [layer] = layers.splice(from, 1);
  if (!layer) return doc;
  layers.splice(Math.max(0, Math.min(to, layers.length)), 0, layer);
  return { ...doc, layers };
}

/**
 * Groups layers so they select and move together. Grouped layers are pulled together
 * in the stack, just under the topmost one, so the group sits as one block.
 * @param doc - Design.
 * @param ids - Layers to group (two or more).
 * @returns New design.
 */
export function groupLayers(doc: DesignDoc, ids: string[]): DesignDoc {
  if (ids.length < 2) return doc;
  const groupId = newLayerId();
  const set = new Set(ids);
  const top = Math.max(...ids.map((id) => indexOf(doc, id)));
  const members = doc.layers.filter((l) => set.has(l.id)).map((l) => ({ ...l, groupId }));
  const below = doc.layers.slice(0, top + 1).filter((l) => !set.has(l.id));
  const above = doc.layers.slice(top + 1);
  return { ...doc, layers: [...below, ...members, ...above] };
}

/**
 * Takes layers out of their groups.
 * @param doc - Design.
 * @param ids - Layers to ungroup.
 * @returns New design.
 */
export function ungroupLayers(doc: DesignDoc, ids: string[]): DesignDoc {
  return updateLayers(doc, ids, () => ({ groupId: null }));
}

/**
 * Aligns layers: one layer against the picture, several against the box around them.
 * Locked layers stay put.
 * @param doc - Design.
 * @param format - Size on screen.
 * @param ids - Layers to align.
 * @param how - Which edge or centre line.
 * @param scope - Which sizes the edit reaches.
 * @param toCanvas - Align against the picture even with several layers picked.
 * @returns New design.
 */
export function alignLayers(
  doc: DesignDoc,
  format: FormatKey,
  ids: string[],
  how: AlignTo,
  scope: EditScope,
  toCanvas = false,
): DesignDoc {
  const free = ids.filter((id) => !layerById(doc, id)?.locked);
  const layout = doc.layouts[format] ?? {};
  // A group moves as one block, so several layers aligned to the picture keep their
  // places relative to each other.
  const box = free.length > 1 && !toCanvas ? selectionBox(doc, format, free) : canvasBox(format);
  if (!box) return doc;
  const changes: Record<string, Geometry> = {};
  if (free.length > 1 && toCanvas) {
    const sel = selectionBox(doc, format, free);
    if (!sel) return doc;
    const moved = align({ ...sel, rotation: 0, linked: true }, how, box);
    for (const id of free) {
      const g = layout[id];
      if (g) changes[id] = { ...g, x: g.x + moved.x - sel.x, y: g.y + moved.y - sel.y };
    }
  } else {
    for (const id of free) {
      const g = layout[id];
      if (g) changes[id] = align(g, how, box);
    }
  }
  return setGeometry(doc, format, changes, scope);
}

/**
 * Spaces three or more layers evenly along one axis.
 * @param doc - Design.
 * @param format - Size on screen.
 * @param ids - Layers to space.
 * @param axis - "x" or "y".
 * @param scope - Which sizes the edit reaches.
 * @returns New design.
 */
export function distributeLayers(
  doc: DesignDoc,
  format: FormatKey,
  ids: string[],
  axis: "x" | "y",
  scope: EditScope,
): DesignDoc {
  const layout = doc.layouts[format] ?? {};
  const items = ids
    .filter((id) => !layerById(doc, id)?.locked)
    .flatMap((id) => (layout[id] ? [{ id, g: layout[id] }] : []));
  return setGeometry(doc, format, Object.fromEntries(distribute(items, axis)), scope);
}

/**
 * Moves layers by a number of pixels.
 * @param doc - Design.
 * @param format - Size on screen.
 * @param ids - Layers to move.
 * @param dx - Pixels right.
 * @param dy - Pixels down.
 * @param scope - Which sizes the edit reaches.
 * @returns New design.
 */
export function nudgeLayers(
  doc: DesignDoc,
  format: FormatKey,
  ids: string[],
  dx: number,
  dy: number,
  scope: EditScope,
): DesignDoc {
  const layout = doc.layouts[format] ?? {};
  const changes: Record<string, Geometry> = {};
  for (const id of ids) {
    const g = layout[id];
    if (g && !layerById(doc, id)?.locked) changes[id] = { ...g, x: g.x + dx, y: g.y + dy };
  }
  return setGeometry(doc, format, changes, scope);
}

// Fields that are a layer's content or identity rather than its look, so "Paste style"
// leaves them alone.
const NOT_STYLE = new Set([
  "id",
  "name",
  "type",
  "locked",
  "role",
  "groupId",
  "text",
  "items",
  "src",
  "naturalWidth",
  "naturalHeight",
  "focusX",
  "focusY",
  "zoom",
  "url",
  "icon",
  "fields",
  "field",
  "variant",
  "source",
]);

/** A copied look: the style fields of one layer. */
export type LayerStyle = Record<string, unknown>;

/**
 * The look of a layer, for "Copy style".
 * @param layer - Layer to copy from.
 * @returns Its style fields.
 */
export function styleOf(layer: Layer): LayerStyle {
  return Object.fromEntries(Object.entries(layer).filter(([k]) => !NOT_STYLE.has(k)));
}

/**
 * Applies a copied look to layers: every style field the target layer also has, so
 * pasting a headline's look onto a shape only carries opacity, shadow and flips.
 * @param doc - Design.
 * @param ids - Layers to restyle.
 * @param style - Copied look.
 * @returns New design.
 */
export function pasteStyle(doc: DesignDoc, ids: string[], style: LayerStyle): DesignDoc {
  return updateLayers(doc, ids, (l) =>
    Object.fromEntries(Object.entries(style).filter(([k]) => Object.hasOwn(l, k))),
  );
}

/**
 * Switches a text layer to another preset: its colour, weight, spacing and font size
 * on every size follow the preset, scaled by each size's shorter side.
 * @param doc - Design.
 * @param id - Text layer.
 * @param preset - New preset.
 * @returns New design.
 */
export function applyTextPreset(doc: DesignDoc, id: string, preset: TextPreset): DesignDoc {
  const p = TEXT_PRESETS[preset];
  const next = updateLayers(doc, [id], () => ({
    preset,
    weight: p.weight,
    colour: p.colour,
    lineHeight: p.lineHeight,
    letterSpacing: p.letterSpacing,
  }));
  const layouts = { ...next.layouts };
  for (const f of doc.formats) {
    const g = layouts[f]?.[id];
    if (!g) continue;
    layouts[f] = { ...layouts[f], [id]: { ...g, fontSize: presetFontSize(preset, f) } };
  }
  return { ...next, layouts };
}

/**
 * A preset's font size on one size, scaled from its 1080-wide value by the shorter side.
 * @param preset - Text preset.
 * @param format - Size.
 * @returns Font size in pixels.
 */
export function presetFontSize(preset: TextPreset, format: FormatKey): number {
  const f = FORMATS[format];
  return Math.round((TEXT_PRESETS[preset].fontSize * Math.min(f.width, f.height)) / 1080);
}

/**
 * Starting geometry for a new layer on the size on screen: centred, sized as a share
 * of the picture's shorter side, with a font size for text-like layers.
 * @param layer - New layer.
 * @param format - Size on screen.
 * @param share - Width as a share of the shorter side.
 * @param ratio - Width over height.
 * @returns Geometry.
 */
export function startGeometry(
  layer: Layer,
  format: FormatKey,
  share: number,
  ratio: number,
): Geometry {
  const f = FORMATS[format];
  const unit = Math.min(f.width, f.height);
  const w = Math.round(unit * share);
  const h = Math.max(1, Math.round(w / ratio));
  const g: Geometry = {
    x: Math.round((f.width - w) / 2),
    y: Math.round((f.height - h) / 2),
    w,
    h,
    rotation: 0,
    linked: true,
  };
  if (TEXT_LIKE.has(layer.type)) {
    g.fontSize =
      layer.type === "text" ? presetFontSize(layer.preset, format) : Math.round((40 * unit) / 1080);
  }
  return g;
}
