// src/features/social-design/lib/editor-ops.ts
// Every post maker edit as a pure document-to-document function. Geometry edits carry to sizes
// where the layer is still linked. Covered by check-social-design.

import { TEXT_PRESETS, type TextPreset } from "@/features/social-design/lib/brand";
import {
  newLayerId,
  TEXT_LIKE,
  type DesignDoc,
  type FormatLayout,
  type Geometry,
  type Layer,
} from "@/features/social-design/lib/doc";
import { FORMAT_KEYS, FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import {
  align,
  autoPlace,
  canvasBox,
  distribute,
  isFullBleed,
  propagate,
  relinkSource,
  type AlignTo,
} from "@/features/social-design/lib/layout";

/** A rectangle in picture pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Edit reach: "all" carries to every linked size; "this" changes only this size and unlinks it. */
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
 * Adds every group mate of a picked layer, so groups always select as a whole.
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
 * Applies a per-layer patch to some layers, so one call can restyle a mixed selection.
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
 * Writes new geometry on the edited size. "all" carries the same move, resize and turn to
 * every linked size; "this" or an already-unlinked layer changes only the edited size.
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
    if (scope !== "all" || !before.linked) continue;
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
 * Updates measured heights of auto-height text layers per size, with no linking or carrying.
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

/** Slack in pixels when testing whether one box sits inside or below another. */
const ROOM_SLACK = 2;

/**
 * Whether box `a` lies within box `b`, give or take {@link ROOM_SLACK}.
 * @param a - Inner box.
 * @param b - Outer box.
 * @returns True when inside.
 */
function within(a: Box, b: Box): boolean {
  return (
    a.x >= b.x - ROOM_SLACK &&
    a.y >= b.y - ROOM_SLACK &&
    a.x + a.w <= b.x + b.w + ROOM_SLACK &&
    a.y + a.h <= b.y + b.h + ROOM_SLACK
  );
}

/**
 * Makes room for text or bullet layers whose height changed: layers below in the same column
 * move by the difference. A layer's card grows with it and the column shifts up by half, so a
 * centred card stays centred. Side layers and full-bleed layers stay put; places come from
 * `before`, so several changes in one column add up.
 * @param before - Design before the change, measured.
 * @param after - Design after the change, measured.
 * @returns `after` with the room made, or `after` itself when no height changed.
 */
export function makeRoom(before: DesignDoc, after: DesignDoc): DesignDoc {
  let changed = false;
  const layouts = { ...after.layouts };
  for (const format of after.formats) {
    const was = before.layouts[format];
    const now = after.layouts[format];
    if (!was || !now) continue;
    const dy: Record<string, number> = {};
    const dh: Record<string, number> = {};
    const free = after.layers.filter((l) => {
      const g = was[l.id];
      return g && now[l.id] && !g.hidden && l.type !== "backdrop" && !isFullBleed(g, format);
    });
    for (const grown of free) {
      if (grown.type !== "text" && grown.type !== "bullets") continue;
      const box = was[grown.id]!;
      const d = now[grown.id]!.h - box.h;
      if (Math.abs(d) < 0.5) continue;
      const card = free
        .filter(
          (l) =>
            l.id !== grown.id &&
            (l.type === "frosted" || (l.type === "shape" && l.shape === "rect")) &&
            within(box, was[l.id]!),
        )
        .sort((a, b) => was[a.id]!.w * was[a.id]!.h - was[b.id]!.w * was[b.id]!.h)[0];
      const cardBox = card ? was[card.id]! : null;
      const shift = cardBox ? -d / 2 : 0;
      for (const l of free) {
        if (l.id === card?.id) continue;
        const g = was[l.id]!;
        if (cardBox && !within(g, cardBox)) continue;
        const column = g.x < box.x + box.w && box.x < g.x + g.w;
        if (!column) continue;
        const below = l.id !== grown.id && g.y >= box.y + box.h - ROOM_SLACK;
        dy[l.id] = (dy[l.id] ?? 0) + shift + (below ? d : 0);
      }
      if (card) {
        dy[card.id] = (dy[card.id] ?? 0) + shift;
        dh[card.id] = (dh[card.id] ?? 0) + d;
      }
    }
    const ids = new Set([...Object.keys(dy), ...Object.keys(dh)]);
    if (ids.size === 0) continue;
    const next: FormatLayout = { ...now };
    for (const id of ids) {
      const g = now[id]!;
      next[id] = {
        ...g,
        y: Math.round((g.y + (dy[id] ?? 0)) * 10) / 10,
        h: Math.max(1, Math.round((g.h + (dh[id] ?? 0)) * 10) / 10),
      };
    }
    layouts[format] = next;
    changed = true;
  }
  return changed ? { ...after, layouts } : after;
}

/**
 * Places a new layer on the size on screen, auto-placed elsewhere, on top (or above `above`).
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
 * Pastes copied layers on top with fresh ids, shifted so they don't hide the originals. Clip
 * groups become new groups; sizes without a place are auto-placed from the size on screen.
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
 * Moves layers up or down, keeping their order; forward and backward pass one non-moving neighbour.
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
 * Groups layers, pulling them just under the topmost so the group sits as one block.
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
 * Aligns one layer to the picture, or several to their box. Locked layers stay put.
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
 * Applies a copied look to every matching style field, so a headline's look on a shape only
 * carries opacity, shadow and flips.
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
 * Switches a text layer's preset; font size on each size scales by its shorter side.
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
 * Starting geometry for a new layer: centred, sized as a share of the shorter side.
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

/**
 * Hides or shows layers on one size only; never carries across or unlinks.
 * @param doc - Design.
 * @param format - Size on screen.
 * @param ids - Layers to hide or show.
 * @param hidden - Whether to hide them.
 * @returns New design.
 */
export function setHidden(
  doc: DesignDoc,
  format: FormatKey,
  ids: string[],
  hidden: boolean,
): DesignDoc {
  const here = { ...(doc.layouts[format] ?? {}) };
  for (const id of ids) {
    const g = here[id];
    if (!g) continue;
    const next = { ...g };
    if (hidden) next.hidden = true;
    else delete next.hidden;
    here[id] = next;
  }
  return { ...doc, layouts: { ...doc.layouts, [format]: here } };
}

/**
 * Width over height of a size.
 * @param key - Size.
 * @returns Aspect ratio.
 */
function ratioOf(key: FormatKey): number {
  return FORMATS[key].width / FORMATS[key].height;
}

/**
 * The listed size nearest in shape, by aspect ratio on a log scale so 2:1 and 1:2 are equally
 * far from square.
 * @param doc - Design.
 * @param key - Size being added or laid out.
 * @returns The nearest other listed size, or null when there is none.
 */
export function nearestFormat(doc: DesignDoc, key: FormatKey): FormatKey | null {
  const r = ratioOf(key);
  /**
   * Log-scale shape difference from the new size.
   * @param f - Size to compare.
   * @returns Distance between the two ratios.
   */
  const gap = (f: FormatKey): number => Math.abs(Math.log(ratioOf(f) / r));
  return doc.formats.filter((f) => f !== key).sort((a, b) => gap(a) - gap(b))[0] ?? null;
}

/**
 * Lays every layer out on one size from another, all linked. Layers missing on the source keep
 * their place or take it from the first size that has one.
 * @param doc - Design.
 * @param from - Size to copy from.
 * @param to - Size to lay out.
 * @returns The new layout for `to`.
 */
function layoutFrom(doc: DesignDoc, from: FormatKey | null, to: FormatKey): FormatLayout {
  const out: FormatLayout = {};
  for (const l of doc.layers) {
    const src = from ? doc.layouts[from]?.[l.id] : undefined;
    if (src && from) {
      out[l.id] = autoPlace(src, from, to);
      continue;
    }
    const own = doc.layouts[to]?.[l.id];
    if (own) {
      out[l.id] = own;
      continue;
    }
    const other = doc.formats.find((f) => f !== to && doc.layouts[f]?.[l.id]);
    const g = other ? doc.layouts[other]?.[l.id] : undefined;
    if (other && g) out[l.id] = autoPlace(g, other, to);
  }
  return out;
}

/**
 * Adds a size laid out from the nearest-shaped listed size, kept in tab order.
 * @param doc - Design.
 * @param key - Size to add.
 * @returns New design, or the same one when the size is already listed.
 */
export function addFormat(doc: DesignDoc, key: FormatKey): DesignDoc {
  if (doc.formats.includes(key)) return doc;
  const layout = layoutFrom(doc, nearestFormat(doc, key), key);
  return {
    ...doc,
    formats: FORMAT_KEYS.filter((f) => f === key || doc.formats.includes(f)),
    layouts: { ...doc.layouts, [key]: layout },
  };
}

/**
 * Removes a size and its layout. The last size can't be removed.
 * @param doc - Design.
 * @param key - Size to remove.
 * @returns New design, or the same one when it is the only size or isn't listed.
 */
export function removeFormat(doc: DesignDoc, key: FormatKey): DesignDoc {
  if (!doc.formats.includes(key) || doc.formats.length <= 1) return doc;
  const layouts = { ...doc.layouts };
  delete layouts[key];
  return { ...doc, formats: doc.formats.filter((f) => f !== key), layouts };
}

/**
 * Replaces one size's layout with another's, re-placed to fit and re-linked.
 * @param doc - Design.
 * @param from - Size to copy from.
 * @param to - Size to lay out.
 * @returns New design.
 */
export function copyLayout(doc: DesignDoc, from: FormatKey, to: FormatKey): DesignDoc {
  if (from === to || !doc.formats.includes(from) || !doc.formats.includes(to)) return doc;
  return { ...doc, layouts: { ...doc.layouts, [to]: layoutFrom(doc, from, to) } };
}

/**
 * Re-links layers on one size, re-placing each from a linked size; hidden state is kept.
 * @param doc - Design.
 * @param format - Size to re-link on.
 * @param ids - Layers to re-link.
 * @returns New design.
 */
export function relinkLayers(doc: DesignDoc, format: FormatKey, ids: string[]): DesignDoc {
  const here = { ...(doc.layouts[format] ?? {}) };
  for (const id of ids) {
    const own = here[id];
    const from = relinkSource(doc, id, format);
    const src = from ? doc.layouts[from]?.[id] : undefined;
    if (!own || !from || !src) continue;
    const next = autoPlace(src, from, format);
    if (own.hidden) next.hidden = true;
    else delete next.hidden;
    here[id] = next;
  }
  return { ...doc, layouts: { ...doc.layouts, [format]: here } };
}
