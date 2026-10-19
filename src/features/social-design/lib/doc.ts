// src/features/social-design/lib/doc.ts
// The post maker document (shared layers, per-size layouts), its parser, version upgrade and
// out-of-date hash. Pure and client-safe.

import {
  isColourKey,
  LOGOS,
  TEXT_PRESETS,
  type ColourKey,
  type LogoVariant,
  type TextPreset,
} from "@/features/social-design/lib/brand";
import { FORMATS, isFormatKey, type FormatKey } from "@/features/social-design/lib/formats";
import { isIconName } from "@/features/social-design/lib/icons";
import { isBlobImageUrl } from "@/shared/lib/blob-image";

export const DOC_VERSION = 1;

export const MAX_LAYERS = 200;
/** Request-body cap for a saved document, checked by the API before parsing. */
export const MAX_DOC_BYTES = 256 * 1024;
const MAX_NAME = 120;
const MAX_TEXT = 2_000;
const MAX_CAPTION = 2_200;
const MAX_ALT = 300;
const MAX_URL = 2_000;
const MAX_ITEMS = 8;
const MAX_ITEM = 200;
const MAX_ID = 40;
// Twice the largest format side, so a layer can hang off any edge.
const MAX_COORD = 6_000;

/** Where a layer sits on one size. x and y are the top-left corner before rotation. */
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the layer's centre. */
  rotation: number;
  /** Font size on this size, for layers that hold text. */
  fontSize?: number;
  hidden?: boolean;
  /** Linked layers follow edits on other sizes; "This size only" unlinks on that size. */
  linked: boolean;
}

/** What a layer is for, so templates and AI drafts know where words go. */
export type LayerRole = "headline" | "support" | "bullets" | "quote" | "photo" | "price" | "name";

const ROLES: readonly LayerRole[] = [
  "headline",
  "support",
  "bullets",
  "quote",
  "photo",
  "price",
  "name",
];

interface LayerBase {
  id: string;
  name: string;
  locked: boolean;
  /** 0-1. */
  opacity: number;
  role: LayerRole | null;
  /** Layers sharing a group id select and move together. */
  groupId: string | null;
  flipX: boolean;
  flipY: boolean;
  shadow: boolean;
}

export interface TextLayer extends LayerBase {
  type: "text";
  text: string;
  preset: TextPreset;
  weight: number;
  colour: ColourKey;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
  italic: boolean;
  /** Colour of a band drawn behind the text, or null for none. */
  highlight: ColourKey | null;
  /** Shrink the font until the text fits the box. */
  shrinkToFit: boolean;
}

export interface ImageLayer extends LayerBase {
  type: "image";
  /** Empty for a frame waiting for its photo, as templates start. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  fit: "cover" | "contain";
  /** Point of the photo kept in view when cropping, 0-1 on each axis. */
  focusX: number;
  focusY: number;
  /** 1 = the photo just covers or fits the frame. */
  zoom: number;
  radius: number;
  mask: "none" | "circle";
  /** -1 to 1, 0 = unchanged. */
  brightness: number;
  contrast: number;
  greyscale: boolean;
}

export interface LogoLayer extends LayerBase {
  type: "logo";
  variant: LogoVariant;
}

export interface BackdropLayer extends LayerBase {
  type: "backdrop";
  source: "brand" | "photo" | "solid" | "gradient";
  /** Photo for `source: "photo"`. */
  src: string | null;
  colour: ColourKey;
  /** Second gradient stop. */
  colour2: ColourKey;
  /** Blur radius for a photo backdrop, in pixels at 1080 wide. */
  blur: number;
  /** Strength of the light seasalt wash laid over the backdrop, 0-1. */
  wash: number;
}

export interface FrostedLayer extends LayerBase {
  type: "frosted";
  radius: number;
}

export interface ShapeLayer extends LayerBase {
  type: "shape";
  shape: "rect" | "circle" | "line" | "arrow";
  fill: ColourKey | null;
  stroke: ColourKey | null;
  strokeWidth: number;
  radius: number;
}

export interface BulletsLayer extends LayerBase {
  type: "bullets";
  items: string[];
  colour: ColourKey;
  tick: ColourKey;
}

export interface StarsLayer extends LayerBase {
  type: "stars";
  count: number;
  colour: ColourKey;
}

export interface QuoteMarkLayer extends LayerBase {
  type: "quote-mark";
  colour: ColourKey;
}

export interface QrLayer extends LayerBase {
  type: "qr";
  url: string;
  colour: ColourKey;
}

export interface IconLayer extends LayerBase {
  type: "icon";
  /** react-icons component name, like "FaWifi". */
  icon: string;
  colour: ColourKey;
}

/** Contact details read live from Settings at draw time. */
export interface ContactLayer extends LayerBase {
  type: "contact";
  fields: ContactField[];
  colour: ColourKey;
}

/** Promo wording read live from the running promo at draw time. */
export interface PromoLayer extends LayerBase {
  type: "promo";
  field: PromoField;
  colour: ColourKey;
  weight: number;
}

export type ContactField = "phone" | "email" | "website";
export type PromoField = "offer" | "ends" | "summary";

const CONTACT_FIELDS: readonly ContactField[] = ["phone", "email", "website"];
const PROMO_FIELDS: readonly PromoField[] = ["offer", "ends", "summary"];

export type Layer =
  | TextLayer
  | ImageLayer
  | LogoLayer
  | BackdropLayer
  | FrostedLayer
  | ShapeLayer
  | BulletsLayer
  | StarsLayer
  | QuoteMarkLayer
  | QrLayer
  | IconLayer
  | ContactLayer
  | PromoLayer;

export type LayerType = Layer["type"];

/** Layers whose geometry carries a font size. */
export const TEXT_LIKE: ReadonlySet<LayerType> = new Set(["text", "bullets", "contact", "promo"]);

/** Layout of every layer on one size, keyed by layer id. */
export type FormatLayout = Record<string, Geometry>;

/** A whole design. */
export interface DesignDoc {
  version: number;
  /** Sizes this design exports, in tab order. */
  formats: FormatKey[];
  /** Bottom layer first. */
  layers: Layer[];
  layouts: Partial<Record<FormatKey, FormatLayout>>;
  /** Post text handed to the composer. */
  caption: string;
  altText: string;
  /** Paid ads hide contact layers (Meta's own button carries the contact) and export at 2x. */
  paidAd: boolean;
}

/** Live values bound layers draw, from Settings and the running promo. */
export interface BoundValues {
  phone: string | null;
  email: string | null;
  website: string | null;
  promoOffer: string | null;
  promoEnds: string | null;
  promoSummary: string | null;
}

/** Thrown inside the parser; caught by {@link parseDesignDoc}. */
class DocError extends Error {}

/**
 * Reads a required string.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @param max - Longest allowed length.
 * @returns The string.
 */
function str(v: unknown, path: string, max: number): string {
  if (typeof v !== "string") throw new DocError(`${path} must be text.`);
  if (v.length > max) throw new DocError(`${path} is over ${max} characters.`);
  return v;
}

/**
 * Reads a finite number inside a range.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @param min - Smallest allowed value.
 * @param max - Largest allowed value.
 * @returns The number.
 */
function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new DocError(`${path} must be a number.`);
  if (v < min || v > max) throw new DocError(`${path} must be between ${min} and ${max}.`);
  return v;
}

/**
 * Reads a boolean, treating a missing value as the fallback.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @param fallback - Value when missing.
 * @returns The boolean.
 */
function bool(v: unknown, path: string, fallback = false): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") throw new DocError(`${path} must be true or false.`);
  return v;
}

/**
 * Reads one of a fixed set of strings.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @param allowed - Allowed values.
 * @returns The value.
 */
function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new DocError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return v as T;
}

/**
 * Reads a brand colour key.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @returns The key.
 */
function colour(v: unknown, path: string): ColourKey {
  if (!isColourKey(v)) throw new DocError(`${path} isn't a brand colour.`);
  return v;
}

/**
 * Reads an optional brand colour key, where null means none.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @returns The key or null.
 */
function colourOrNull(v: unknown, path: string): ColourKey | null {
  return v === null || v === undefined ? null : colour(v, path);
}

/**
 * Reads a Blob-store image URL.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @returns The URL.
 */
function blobUrl(v: unknown, path: string): string {
  const url = str(v, path, MAX_URL);
  if (!isBlobImageUrl(url)) throw new DocError(`${path} must be an uploaded picture.`);
  return url;
}

/**
 * Reads an object, rejecting arrays and null.
 * @param v - Raw value.
 * @param path - Where it sits, for the error.
 * @returns The object.
 */
function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new DocError(`${path} must be an object.`);
  }
  return v as Record<string, unknown>;
}

/**
 * Reads the fields every layer shares.
 * @param r - Raw layer.
 * @param path - Where it sits, for the error.
 * @returns The shared fields.
 */
function parseBase(r: Record<string, unknown>, path: string): LayerBase {
  const id = str(r.id, `${path}.id`, MAX_ID);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new DocError(`${path}.id has unexpected characters.`);
  const group = r.groupId ?? null;
  return {
    id,
    name: str(r.name, `${path}.name`, MAX_NAME),
    locked: bool(r.locked, `${path}.locked`),
    opacity: num(r.opacity ?? 1, `${path}.opacity`, 0, 1),
    role: r.role === null || r.role === undefined ? null : oneOf(r.role, `${path}.role`, ROLES),
    groupId: group === null ? null : str(group, `${path}.groupId`, MAX_ID),
    flipX: bool(r.flipX, `${path}.flipX`),
    flipY: bool(r.flipY, `${path}.flipY`),
    shadow: bool(r.shadow, `${path}.shadow`),
  };
}

/**
 * Reads one layer of any type.
 * @param raw - Raw layer.
 * @param path - Where it sits, for the error.
 * @returns The layer.
 */
function parseLayer(raw: unknown, path: string): Layer {
  const r = obj(raw, path);
  const base = parseBase(r, path);
  /**
   * Path of one field, for errors.
   * @param field - Field name.
   * @returns Full path.
   */
  const p = (field: string): string => `${path}.${field}`;
  switch (r.type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: str(r.text, p("text"), MAX_TEXT),
        preset: oneOf(r.preset, p("preset"), Object.keys(TEXT_PRESETS) as TextPreset[]),
        weight: num(r.weight, p("weight"), 100, 900),
        colour: colour(r.colour, p("colour")),
        align: oneOf(r.align, p("align"), ["left", "center", "right"] as const),
        lineHeight: num(r.lineHeight, p("lineHeight"), 0.6, 3),
        letterSpacing: num(r.letterSpacing, p("letterSpacing"), -20, 40),
        italic: bool(r.italic, p("italic")),
        highlight: colourOrNull(r.highlight, p("highlight")),
        shrinkToFit: bool(r.shrinkToFit, p("shrinkToFit")),
      };
    case "image":
      return {
        ...base,
        type: "image",
        src: r.src === "" ? "" : blobUrl(r.src, p("src")),
        naturalWidth: num(r.naturalWidth, p("naturalWidth"), 1, 20_000),
        naturalHeight: num(r.naturalHeight, p("naturalHeight"), 1, 20_000),
        fit: oneOf(r.fit, p("fit"), ["cover", "contain"] as const),
        focusX: num(r.focusX ?? 0.5, p("focusX"), 0, 1),
        focusY: num(r.focusY ?? 0.5, p("focusY"), 0, 1),
        zoom: num(r.zoom ?? 1, p("zoom"), 1, 8),
        radius: num(r.radius ?? 0, p("radius"), 0, 2_000),
        mask: oneOf(r.mask ?? "none", p("mask"), ["none", "circle"] as const),
        brightness: num(r.brightness ?? 0, p("brightness"), -1, 1),
        contrast: num(r.contrast ?? 0, p("contrast"), -1, 1),
        greyscale: bool(r.greyscale, p("greyscale")),
      };
    case "logo":
      return {
        ...base,
        type: "logo",
        variant: oneOf(r.variant, p("variant"), Object.keys(LOGOS) as LogoVariant[]),
      };
    case "backdrop": {
      const source = oneOf(r.source, p("source"), ["brand", "photo", "solid", "gradient"] as const);
      return {
        ...base,
        type: "backdrop",
        source,
        src: source === "photo" ? blobUrl(r.src, p("src")) : null,
        colour: colour(r.colour ?? "seasalt", p("colour")),
        colour2: colour(r.colour2 ?? "white", p("colour2")),
        blur: num(r.blur ?? 0, p("blur"), 0, 80),
        wash: num(r.wash ?? 0, p("wash"), 0, 1),
      };
    }
    case "frosted":
      return { ...base, type: "frosted", radius: num(r.radius, p("radius"), 0, 2_000) };
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: oneOf(r.shape, p("shape"), ["rect", "circle", "line", "arrow"] as const),
        fill: colourOrNull(r.fill, p("fill")),
        stroke: colourOrNull(r.stroke, p("stroke")),
        strokeWidth: num(r.strokeWidth ?? 0, p("strokeWidth"), 0, 200),
        radius: num(r.radius ?? 0, p("radius"), 0, 2_000),
      };
    case "bullets": {
      if (!Array.isArray(r.items)) throw new DocError(`${p("items")} must be a list.`);
      if (r.items.length > MAX_ITEMS)
        throw new DocError(`${p("items")} has over ${MAX_ITEMS} items.`);
      return {
        ...base,
        type: "bullets",
        items: r.items.map((item, i) => str(item, `${p("items")}[${i}]`, MAX_ITEM)),
        colour: colour(r.colour, p("colour")),
        tick: colour(r.tick, p("tick")),
      };
    }
    case "stars":
      return {
        ...base,
        type: "stars",
        count: Math.round(num(r.count, p("count"), 1, 5)),
        colour: colour(r.colour, p("colour")),
      };
    case "quote-mark":
      return { ...base, type: "quote-mark", colour: colour(r.colour, p("colour")) };
    case "qr": {
      const url = str(r.url, p("url"), MAX_URL);
      if (!/^https?:\/\/\S+$/.test(url)) throw new DocError(`${p("url")} must be a web address.`);
      return { ...base, type: "qr", url, colour: colour(r.colour, p("colour")) };
    }
    case "icon": {
      const icon = str(r.icon, p("icon"), 60);
      if (!isIconName(icon)) throw new DocError(`${p("icon")} isn't one of the icons on offer.`);
      return { ...base, type: "icon", icon, colour: colour(r.colour, p("colour")) };
    }
    case "contact": {
      if (!Array.isArray(r.fields) || r.fields.length === 0) {
        throw new DocError(`${p("fields")} must list at least one detail.`);
      }
      const fields = r.fields.map((f, i) => oneOf(f, `${p("fields")}[${i}]`, CONTACT_FIELDS));
      return {
        ...base,
        type: "contact",
        fields: [...new Set(fields)],
        colour: colour(r.colour, p("colour")),
      };
    }
    case "promo":
      return {
        ...base,
        type: "promo",
        field: oneOf(r.field, p("field"), PROMO_FIELDS),
        colour: colour(r.colour, p("colour")),
        weight: num(r.weight ?? 700, p("weight"), 100, 900),
      };
    default:
      throw new DocError(`${path}.type isn't a known layer type.`);
  }
}

/**
 * Reads one layer's geometry on one size.
 * @param raw - Raw geometry.
 * @param path - Where it sits, for the error.
 * @param textLike - Whether the layer holds text, so it needs a font size.
 * @returns The geometry.
 */
function parseGeometry(raw: unknown, path: string, textLike: boolean): Geometry {
  const r = obj(raw, path);
  const g: Geometry = {
    x: num(r.x, `${path}.x`, -MAX_COORD, MAX_COORD),
    y: num(r.y, `${path}.y`, -MAX_COORD, MAX_COORD),
    w: num(r.w, `${path}.w`, 1, MAX_COORD),
    h: num(r.h, `${path}.h`, 1, MAX_COORD),
    rotation: num(r.rotation ?? 0, `${path}.rotation`, -360, 360),
    linked: bool(r.linked, `${path}.linked`, true),
  };
  if (r.hidden === true) g.hidden = true;
  if (textLike) g.fontSize = num(r.fontSize, `${path}.fontSize`, 4, 1_000);
  return g;
}

/**
 * Upgrades an older saved document to the current shape. Version 1 is the first, so this
 * only fills a missing version; future changes add a step here.
 * @param raw - Stored document.
 * @returns The document in the current version's shape (not yet checked).
 */
export function migrateDoc(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw.version === "number" ? raw.version : 1;
  return { ...raw, version };
}

/**
 * Checks a design document, dropping unknown fields. Layouts for unlisted sizes are kept so
 * toggling a size brings back its hand-made layout.
 * @param raw - Parsed JSON from a request or the database.
 * @returns The document, or the first problem found.
 */
export function parseDesignDoc(raw: unknown): { doc: DesignDoc } | { error: string } {
  try {
    const r = migrateDoc(obj(raw, "doc"));
    if (typeof r.version !== "number" || r.version > DOC_VERSION) {
      throw new DocError(
        "This design was saved by a newer version of the editor. Reload the page.",
      );
    }
    if (!Array.isArray(r.formats) || r.formats.length === 0) {
      throw new DocError("A design needs at least one size.");
    }
    const formats = [
      ...new Set(
        r.formats.map((f, i) => {
          if (!isFormatKey(f)) throw new DocError(`formats[${i}] isn't a known size.`);
          return f;
        }),
      ),
    ];

    if (!Array.isArray(r.layers)) throw new DocError("layers must be a list.");
    if (r.layers.length > MAX_LAYERS)
      throw new DocError(`A design can have up to ${MAX_LAYERS} layers.`);
    const layers = r.layers.map((l, i) => parseLayer(l, `layers[${i}]`));
    const ids = new Set<string>();
    for (const l of layers) {
      if (ids.has(l.id)) throw new DocError(`Two layers share the id ${l.id}.`);
      ids.add(l.id);
    }

    const rawLayouts = obj(r.layouts ?? {}, "layouts");
    const layouts: DesignDoc["layouts"] = {};
    for (const [key, rawLayout] of Object.entries(rawLayouts)) {
      if (!isFormatKey(key)) continue;
      const lr = obj(rawLayout, `layouts.${key}`);
      const layout: FormatLayout = {};
      for (const layer of layers) {
        const g = lr[layer.id];
        if (g === undefined) {
          if (formats.includes(key))
            throw new DocError(`${layer.name} has no place on ${FORMATS[key].label}.`);
          continue;
        }
        layout[layer.id] = parseGeometry(
          g,
          `layouts.${key}.${layer.id}`,
          TEXT_LIKE.has(layer.type),
        );
      }
      layouts[key] = layout;
    }
    for (const f of formats) {
      if (!layouts[f]) throw new DocError(`${FORMATS[f].label} has no layout.`);
    }

    return {
      doc: {
        version: DOC_VERSION,
        formats,
        layers,
        layouts,
        caption: str(r.caption ?? "", "caption", MAX_CAPTION),
        altText: str(r.altText ?? "", "altText", MAX_ALT),
        paidAd: bool(r.paidAd, "paidAd"),
      },
    };
  } catch (error) {
    if (error instanceof DocError) return { error: error.message };
    throw error;
  }
}

/**
 * Bound values a document draws, so an unused value changing doesn't stale its pictures.
 * @param doc - Design.
 * @param bound - Every live value.
 * @returns Only the values some layer uses.
 */
function usedBound(doc: DesignDoc, bound: BoundValues): Partial<BoundValues> {
  const used: Partial<BoundValues> = {};
  for (const layer of doc.layers) {
    if (layer.type === "contact") {
      for (const f of layer.fields) used[f] = bound[f];
    } else if (layer.type === "promo") {
      const key =
        layer.field === "offer"
          ? "promoOffer"
          : layer.field === "ends"
            ? "promoEnds"
            : "promoSummary";
      used[key] = bound[key];
    }
  }
  return used;
}

/**
 * JSON with keys sorted at every level, so equal documents give equal text.
 * @param value - Any JSON value.
 * @returns Canonical JSON text.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Fingerprint of everything in the exported pictures; a later mismatch means "Pictures are out
 * of date". Two seeded 32-bit FNV-1a passes keep it synchronous (no crypto.subtle).
 * @param doc - Design.
 * @param bound - Live values.
 * @returns 16 hex characters.
 */
export function docHash(doc: DesignDoc, bound: BoundValues): string {
  const layouts: Partial<Record<FormatKey, FormatLayout>> = {};
  for (const f of doc.formats) layouts[f] = doc.layouts[f];
  const text = canonicalJson({
    layers: doc.layers,
    layouts,
    paidAd: doc.paidAd,
    bound: usedBound(doc, bound),
  });
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/**
 * A short random layer id.
 * @returns Eight base-36 characters.
 */
export function newLayerId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}
