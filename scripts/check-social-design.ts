// scripts/check-social-design.ts
// Post maker logic: size registry, doc parser, cross-size layout, editor edits, starter
// templates, stored pictures and the AI draft. Pure logic, no database or browser.
// Run with: npm test -- social-design

import { ICON_ART, iconDataUri } from "@/features/social-design/components/canvas/icon-art";
import {
  draftKindFor,
  draftRoom,
  fillDraft,
  fromBrief,
  POST_DRAFT_KINDS,
  readDesignDraft,
  readRoom,
  type DesignDraft,
} from "@/features/social-design/lib/ai-draft";
import { appCrops } from "@/features/social-design/lib/app-crops";
import { boundText } from "@/features/social-design/lib/bound";
import { blankDoc } from "@/features/social-design/lib/design-row";
import {
  docHash,
  parseDesignDoc,
  type BoundValues,
  type DesignDoc,
  type Geometry,
  type Layer,
  type TextLayer,
} from "@/features/social-design/lib/doc";
import {
  addFormat,
  addLayer,
  alignLayers,
  applyTextPreset,
  copyLayout,
  duplicateLayers,
  expandGroups,
  groupLayers,
  makeRoom,
  moveLayerTo,
  nearestFormat,
  onlyAddsSizes,
  pasteStyle,
  presetFontSize,
  relinkLayers,
  removeFormat,
  removeLayers,
  restack,
  setGeometry,
  setHidden,
  setTextHeights,
  startGeometry,
  styleOf,
} from "@/features/social-design/lib/editor-ops";
import {
  CORE_FORMATS,
  FORMAT_KEYS,
  FORMATS,
  safeRect,
  type FormatKey,
} from "@/features/social-design/lib/formats";
import { ICON_CHOICES } from "@/features/social-design/lib/icons";
import {
  align,
  autoPlace,
  canvasBox,
  distribute,
  fullBleed,
  isFullBleed,
  propagate,
  relinkSource,
} from "@/features/social-design/lib/layout";
import { makeLayer, type AddKind } from "@/features/social-design/lib/new-layer";
import {
  autoAltText,
  isRenderUrl,
  leftOffPaidAd,
  pictureFileName,
  pictureState,
} from "@/features/social-design/lib/pictures";
import {
  contrastIssues,
  contrastRatio,
  luminance,
  mergeContrast,
  styleChecks,
  withoutWords,
  wordLayersOn,
  type Pixels,
} from "@/features/social-design/lib/style-checks";
import { starterTemplates } from "@/features/social-design/templates/starters";
import { jpegSize } from "@/shared/lib/jpeg-size";
import { expect, finish } from "./lib/harness.js";

/**
 * Whether two numbers are within a pixel of each other (geometry rounds to 0.1px).
 * @param a - First number.
 * @param b - Second number.
 * @param slack - Allowed difference.
 * @returns True when close.
 */
function near(a: number, b: number, slack = 1): boolean {
  return Math.abs(a - b) <= slack;
}

/**
 * Deep copy with every object's keys in reverse order, to show key order doesn't matter.
 * @param value - Any JSON value.
 * @returns Reordered copy.
 */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    );
  }
  return value;
}

/**
 * JSON with keys sorted at every level, for comparing documents regardless of key order.
 * @param value - Any JSON value.
 * @returns Canonical JSON text.
 */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures poke at raw saved JSON on purpose
type RawDoc = Record<string, any>;

const NO_BOUND: BoundValues = {
  phone: "021 000 0000",
  email: "hi@example.nz",
  website: "example.nz",
  promoOffer: "$20 off",
  promoEnds: "31 October",
  promoSummary: "$20 off until 31 October",
};

/**
 * A headline layer with a geometry on every core size of a blank doc.
 * @param geom - Geometry on every listed size.
 * @returns Document with a backdrop and one text layer.
 */
function docWithText(geom: (key: FormatKey) => Geometry): DesignDoc {
  const doc = blankDoc();
  const text: TextLayer = {
    id: "head1",
    name: "Headline",
    type: "text",
    locked: false,
    opacity: 1,
    role: "headline",
    groupId: null,
    flipX: false,
    flipY: false,
    shadow: false,
    text: "Friendly local IT support",
    preset: "headline",
    weight: 800,
    colour: "russian-violet",
    align: "center",
    lineHeight: 1.05,
    letterSpacing: -2,
    italic: false,
    highlight: null,
    shrinkToFit: false,
  };
  doc.layers.push(text);
  for (const f of doc.formats) doc.layouts[f] = { ...doc.layouts[f], head1: geom(f) };
  return doc;
}

/** Size registry and safe zones. */
function checkFormats(): void {
  console.log("\nSizes");
  expect(
    "every size has a positive width and height",
    FORMAT_KEYS.every((k) => FORMATS[k].width > 0 && FORMATS[k].height > 0),
  );
  const story = safeRect("story");
  expect(
    "story safe area skips the top 14% and bottom 20%",
    near(story.y1, 1920 * 0.14) && near(story.y2, 1920 * 0.8),
  );
  const square = safeRect("square");
  expect(
    "square has no safe zone",
    square.x1 === 0 && square.y1 === 0 && square.x2 === 1080 && square.y2 === 1080,
  );
  expect(
    "Google size is exactly 4:3",
    FORMATS["google-4x3"].width / FORMATS["google-4x3"].height === 4 / 3,
  );
  expect(
    "feed size is 4:5 and at most 1440 wide for Instagram",
    FORMATS["feed-4x5"].width / FORMATS["feed-4x5"].height === 0.8 &&
      FORMATS["feed-4x5"].width <= 1440,
  );
}

/** Document parser. */
function checkParse(): void {
  console.log("\nParser");
  const blank = blankDoc();
  const parsed = parseDesignDoc(JSON.parse(JSON.stringify(blank)));
  expect("a blank design parses", "doc" in parsed, "error" in parsed ? parsed.error : "");

  const withText = docWithText((f) => ({
    x: 90,
    y: 200,
    w: FORMATS[f].width - 180,
    h: 300,
    rotation: 0,
    fontSize: 96,
    linked: true,
  }));
  const round = parseDesignDoc(JSON.parse(JSON.stringify(withText)));
  expect(
    "a design with text parses back to the same document",
    "doc" in round && sortedJson(round.doc) === sortedJson(withText),
  );

  const extra = JSON.parse(JSON.stringify(withText)) as Record<string, unknown> & {
    layers: Record<string, unknown>[];
  };
  extra.layers[1].sneaky = "<script>";
  extra.sneaky = 1;
  const stripped = parseDesignDoc(extra);
  expect(
    "unknown fields are dropped",
    "doc" in stripped && !("sneaky" in stripped.doc) && !("sneaky" in stripped.doc.layers[1]),
  );

  /**
   * Parses a mutated copy of the text design and expects an error.
   * @param label - Case name.
   * @param mutate - Change to make.
   * @param mention - Text the error should contain.
   */
  function rejects(label: string, mutate: (d: RawDoc) => void, mention: string): void {
    const copy = JSON.parse(JSON.stringify(withText)) as RawDoc;
    mutate(copy);
    const res = parseDesignDoc(copy);
    expect(
      label,
      "error" in res && res.error.includes(mention),
      "error" in res ? res.error : "parsed",
    );
  }

  rejects(
    "a photo from another host is refused",
    (d) => {
      d.layers.push({
        ...d.layers[1],
        id: "img1",
        type: "image",
        src: "https://evil.example.com/a.jpg",
        naturalWidth: 10,
        naturalHeight: 10,
        fit: "cover",
      });
      for (const f of d.formats)
        d.layouts[f].img1 = { x: 0, y: 0, w: 10, h: 10, rotation: 0, linked: true };
    },
    "uploaded picture",
  );
  rejects("a non-brand colour is refused", (d) => (d.layers[1].colour = "#ff00ff"), "brand colour");
  rejects(
    "an unknown layer type is refused",
    (d) => (d.layers[1].type = "video"),
    "known layer type",
  );
  rejects(
    "a missing layout on a listed size is refused",
    (d) => delete d.layouts.story.head1,
    "no place on Story",
  );
  rejects(
    "a text layer without a font size is refused",
    (d) => delete d.layouts.square.head1.fontSize,
    "fontSize",
  );
  rejects(
    "two layers sharing an id are refused",
    (d) => (d.layers[1].id = d.layers[0].id),
    "share the id",
  );
  rejects("a design from a newer editor is refused", (d) => (d.version = 99), "newer version");
  rejects("a design with no sizes is refused", (d) => (d.formats = []), "at least one size");
  rejects(
    "over 200 layers is refused",
    (d) => {
      d.layers = Array.from({ length: 201 }, (_, i) => ({ ...d.layers[0], id: `b${i}` }));
    },
    "up to 200",
  );
  rejects(
    "a QR code that isn't a web address is refused",
    (d) => {
      d.layers.push({
        ...d.layers[0],
        id: "qr1",
        type: "qr",
        url: "javascript:alert(1)",
        colour: "russian-violet",
      });
      for (const f of d.formats)
        d.layouts[f].qr1 = { x: 0, y: 0, w: 10, h: 10, rotation: 0, linked: true };
    },
    "web address",
  );

  const offAndOn = JSON.parse(JSON.stringify(withText)) as RawDoc;
  offAndOn.formats = offAndOn.formats.filter((f: string) => f !== "story");
  const kept = parseDesignDoc(offAndOn);
  expect(
    "a size turned off keeps its layout for turning back on",
    "doc" in kept &&
      kept.doc.layouts.story?.head1 !== undefined &&
      !kept.doc.formats.includes("story"),
  );
  const unversioned = JSON.parse(JSON.stringify(withText)) as RawDoc;
  delete unversioned.version;
  const migrated = parseDesignDoc(unversioned);
  expect(
    "a design with no version opens as version 1",
    "doc" in migrated && migrated.doc.version === 1,
  );
}

/**
 * Whether a geometry fits inside a size.
 * @param g - Geometry.
 * @param key - Size.
 * @returns True when inside (to a pixel).
 */
function inside(g: Geometry, key: FormatKey): boolean {
  const f = FORMATS[key];
  return g.x >= -1 && g.y >= -1 && g.x + g.w <= f.width + 1 && g.y + g.h <= f.height + 1;
}

/** Placing layers on another size, for every pair of sizes. */
function checkAutoPlace(): void {
  console.log("\nPlacing on another size (every pair)");
  let fullBleedOk = true;
  let centredOk = true;
  let insideOk = true;
  let leftOk = true;
  let fontOk = true;
  const problems: string[] = [];
  for (const from of FORMAT_KEYS) {
    const a = FORMATS[from];
    for (const to of FORMAT_KEYS) {
      if (from === to) continue;
      const b = FORMATS[to];
      if (!isFullBleed(autoPlace(fullBleed(from), from, to), to)) {
        fullBleedOk = false;
        problems.push(`full-bleed ${from} > ${to}`);
      }
      const centred: Geometry = {
        x: a.width * 0.2,
        y: a.height * 0.35,
        w: a.width * 0.6,
        h: a.height * 0.3,
        rotation: 0,
        fontSize: 80,
        linked: true,
      };
      const c = autoPlace(centred, from, to);
      if (!near(c.x + c.w / 2, b.width / 2) || !near(c.y + c.h / 2, b.height / 2)) {
        centredOk = false;
        problems.push(`centre ${from} > ${to}`);
      }
      if (!inside(c, to)) {
        insideOk = false;
        problems.push(`inside ${from} > ${to}`);
      }
      const shortRatio = Math.min(b.width, b.height) / Math.min(a.width, a.height);
      if (c.fontSize === undefined || c.fontSize > 80 * shortRatio + 0.1) {
        fontOk = false;
        problems.push(`font ${from} > ${to}`);
      }
      // A small logo in the top-left corner stays in the top-left corner.
      const corner: Geometry = {
        x: a.width * 0.05,
        y: a.height * 0.05,
        w: 100,
        h: 100,
        rotation: 0,
        linked: true,
      };
      const k = autoPlace(corner, from, to);
      if (!(k.x < b.width * 0.2 && k.y < b.height * 0.2) || !inside(k, to)) {
        leftOk = false;
        problems.push(`corner ${from} > ${to}`);
      }
    }
  }
  expect("full-bleed layers stay full-bleed", fullBleedOk, problems.join(", "));
  expect("centred layers stay centred", centredOk, problems.join(", "));
  expect("placed layers stay inside the picture", insideOk, problems.join(", "));
  expect(
    "font size follows the shorter side, and never grows past it",
    fontOk,
    problems.join(", "),
  );
  expect("a top-left layer stays top-left", leftOk, problems.join(", "));

  const wide: Geometry = { x: 54, y: 900, w: 972, h: 200, rotation: 0, linked: true };
  const toLandscape = autoPlace(wide, "feed-4x5", "landscape");
  expect(
    "a layer spanning 90% of the width keeps that share",
    near(toLandscape.w / 1200, 972 / 1080, 0.01),
    `w=${toLandscape.w}`,
  );
  const hidden = autoPlace({ ...wide, hidden: true }, "feed-4x5", "square");
  expect("a hidden layer stays hidden", hidden.hidden === true);
  const rotated = autoPlace({ ...wide, rotation: 15 }, "feed-4x5", "square");
  expect("rotation carries over", rotated.rotation === 15);
}

/** Carrying an edit on one size across to the linked sizes. */
function checkPropagate(): void {
  console.log("\nLinked edits");
  const before: Geometry = {
    x: 100,
    y: 100,
    w: 400,
    h: 200,
    rotation: 0,
    fontSize: 60,
    linked: true,
  };
  const target: Geometry = {
    x: 300,
    y: 50,
    w: 300,
    h: 150,
    rotation: 0,
    fontSize: 45,
    linked: true,
  };

  const moved = propagate(target, before, { ...before, x: 100 + 108 }, "feed-4x5", "landscape");
  expect(
    "moving 10% of the width moves the other size 10% of its width",
    near(moved.x, 300 + 120) && moved.y === 50 && moved.w === 300,
    JSON.stringify(moved),
  );

  const grown = propagate(
    target,
    before,
    { ...before, w: 800, h: 400, fontSize: 120 },
    "feed-4x5",
    "story",
  );
  const cxBefore = before.x + before.w / 2;
  const grownCentreShift = (before.x + 800 / 2 - cxBefore) / 1080;
  expect(
    "doubling the size doubles it on the other size, font included",
    near(grown.w, 600) && near(grown.h, 300) && near(grown.fontSize ?? 0, 90),
    JSON.stringify(grown),
  );
  expect(
    "the other size's centre moves by the same share as the edited one",
    near(grown.x + grown.w / 2, target.x + target.w / 2 + grownCentreShift * 1080),
  );

  const turned = propagate(target, before, { ...before, rotation: 30 }, "square", "story");
  expect("rotating turns the other size by the same angle", turned.rotation === 30);

  const hid = propagate(target, before, { ...before, hidden: true }, "square", "story");
  expect("hiding carries over", hid.hidden === true);
  const shown = propagate(
    { ...target, hidden: true },
    { ...before, hidden: true },
    before,
    "square",
    "story",
  );
  expect("showing again carries over", shown.hidden === undefined);

  const doc = docWithText((f) => ({
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    rotation: 0,
    fontSize: 40,
    linked: f !== "feed-4x5",
  }));
  expect(
    "re-link takes its place from the first linked size",
    relinkSource(doc, "head1", "story") === "square",
  );
  expect(
    "re-link falls back to the first other size",
    relinkSource(doc, "head1", "feed-4x5") === "square",
  );
}

/** Align and distribute. */
function checkAlign(): void {
  console.log("\nAlign and distribute");
  const g: Geometry = { x: 10, y: 20, w: 200, h: 100, rotation: 0, linked: true };
  const c = align(g, "centre", canvasBox("feed-4x5"));
  expect("centre puts the layer in the middle of the picture", c.x === 440 && c.y === 625);
  expect(
    "centre across leaves the height alone",
    align(g, "centre-x", canvasBox("square")).y === 20,
  );
  expect("right aligns the right edge", align(g, "right", canvasBox("square")).x === 880);
  expect("bottom aligns the bottom edge", align(g, "bottom", canvasBox("square")).y === 980);

  const items = [
    { id: "a", g: { ...g, x: 0, w: 100 } },
    { id: "c", g: { ...g, x: 900, w: 100 } },
    { id: "b", g: { ...g, x: 150, w: 100 } },
  ];
  const spread = distribute(items, "x");
  expect(
    "distribute spaces the middle layer evenly and leaves the ends",
    spread.get("a")?.x === 0 && spread.get("c")?.x === 900 && spread.get("b")?.x === 450,
    JSON.stringify([...spread]),
  );
  expect("distribute needs three layers", distribute(items.slice(0, 2), "x").size === 0);
}

/** The out-of-date hash. */
function checkHash(): void {
  console.log("\nOut-of-date hash");
  const doc = docWithText((f) => ({
    x: 90,
    y: 200,
    w: FORMATS[f].width - 180,
    h: 300,
    rotation: 0,
    fontSize: 96,
    linked: true,
  }));
  const h = docHash(doc, NO_BOUND);
  expect("the hash is 16 hex characters", /^[0-9a-f]{16}$/.test(h));

  expect(
    "key order doesn't change the hash",
    docHash(reverseKeys(doc) as DesignDoc, NO_BOUND) === h,
  );

  const edited = structuredClone(doc);
  (edited.layers[1] as TextLayer).text = "Friendly local tech help";
  expect("editing text changes the hash", docHash(edited, NO_BOUND) !== h);

  const moved = structuredClone(doc);
  moved.layouts.square!.head1.x += 5;
  expect("moving a layer changes the hash", docHash(moved, NO_BOUND) !== h);

  const offSize = structuredClone(doc);
  offSize.formats = offSize.formats.filter((f) => f !== "story");
  const offHash = docHash(offSize, NO_BOUND);
  offSize.layouts.story!.head1.x += 50;
  expect(
    "a layout on a size not exported doesn't change the hash",
    docHash(offSize, NO_BOUND) === offHash,
  );

  expect(
    "a new phone number doesn't matter to a design without contact details",
    docHash(doc, { ...NO_BOUND, phone: "022 111 1111" }) === h,
  );
  const withContact = structuredClone(doc);
  withContact.layers.push({
    ...withContact.layers[1],
    id: "contact1",
    type: "contact",
    fields: ["phone"],
    colour: "russian-violet",
  } as unknown as DesignDoc["layers"][number]);
  for (const f of withContact.formats) {
    withContact.layouts[f] = {
      ...withContact.layouts[f],
      contact1: { x: 0, y: 0, w: 10, h: 10, rotation: 0, fontSize: 30, linked: true },
    };
  }
  const ch = docHash(withContact, NO_BOUND);
  expect(
    "a new phone number makes contact pictures out of date",
    docHash(withContact, { ...NO_BOUND, phone: "022 111 1111" }) !== ch,
  );
  expect(
    "a new promo doesn't matter to a design without a promo",
    docHash(withContact, { ...NO_BOUND, promoOffer: "$30 off" }) === ch,
  );
  expect("the paid-ad switch changes the hash", docHash({ ...doc, paidAd: true }, NO_BOUND) !== h);
}

/**
 * Ids of a document's layers, bottom first, joined for easy comparison.
 * @param doc - Design.
 * @returns Joined layer ids.
 */
function order(doc: DesignDoc): string {
  return doc.layers.map((l) => l.id).join("");
}

/** The editor's edits and every kind of new layer. */
function checkEditorOps(): void {
  console.log("\nEditor edits");
  const base = docWithText((f) => ({
    x: 90,
    y: 200,
    w: FORMATS[f].width - 180,
    h: 300,
    rotation: 0,
    fontSize: 96,
    linked: true,
  }));

  // Every Add menu kind makes a layer the parser accepts once placed.
  const kinds: AddKind[] = [
    { kind: "text", preset: "headline" },
    { kind: "text", preset: "small" },
    {
      kind: "image",
      src: "https://abc.public.blob.vercel-storage.com/social-design/a.jpg",
      naturalWidth: 1600,
      naturalHeight: 1200,
    },
    { kind: "logo", variant: "full" },
    { kind: "backdrop", source: "gradient" },
    {
      kind: "backdrop",
      source: "photo",
      src: "https://abc.public.blob.vercel-storage.com/social-design/b.jpg",
    },
    { kind: "frosted" },
    { kind: "shape", shape: "rect" },
    { kind: "shape", shape: "arrow" },
    { kind: "bullets" },
    { kind: "stars" },
    { kind: "quote-mark" },
    { kind: "contact", fields: ["phone", "email"] },
    { kind: "promo", field: "offer" },
  ];
  let all = base;
  for (const add of kinds) {
    const { layer, share, ratio } = makeLayer(add);
    all = addLayer(all, layer, "feed-4x5", startGeometry(layer, "feed-4x5", share, ratio));
  }
  const parsed = parseDesignDoc(all);
  expect(
    "every Add menu kind places a layer the parser accepts",
    "doc" in parsed,
    "error" in parsed ? parsed.error : "",
  );
  const added = all.layers.at(-1)?.id ?? "";
  expect(
    "a new layer gets a place on every size",
    all.formats.every((f) => !!all.layouts[f]?.[added]),
  );

  // Linked edits reach linked sizes only; "this size" edits unlink.
  const before = base.layouts["feed-4x5"]!.head1!;
  const shifted = { head1: { ...before, x: before.x + 100 } };
  const unlinked = structuredClone(base);
  unlinked.layouts.square!.head1!.linked = false;
  const moved = setGeometry(unlinked, "feed-4x5", shifted, "all");
  expect(
    "a move in all sizes reaches a linked size",
    moved.layouts.story!.head1!.x !== base.layouts.story!.head1!.x,
  );
  expect(
    "a move in all sizes leaves an unlinked size alone",
    sortedJson(moved.layouts.square!.head1) === sortedJson(unlinked.layouts.square!.head1),
  );
  const only = setGeometry(base, "feed-4x5", shifted, "this");
  expect(
    "a move on this size only changes nothing else and unlinks it here",
    only.layouts["feed-4x5"]!.head1!.linked === false &&
      sortedJson(only.layouts.story) === sortedJson(base.layouts.story),
  );

  // Removing and duplicating.
  const removed = removeLayers(base, ["head1"]);
  expect(
    "removing a layer clears its place on every size",
    !removed.layers.some((l) => l.id === "head1") &&
      Object.values(removed.layouts).every((l) => !l?.head1),
  );
  const dup = duplicateLayers(base, ["head1"], "feed-4x5");
  const copyId = dup.ids[0] ?? "";
  expect(
    "a duplicate gets a new id, sits on top and is shifted",
    copyId !== "head1" &&
      dup.doc.layers.at(-1)?.id === copyId &&
      dup.doc.layouts["feed-4x5"]![copyId]!.x === before.x + 24,
  );
  expect("a duplicate parses", "doc" in parseDesignDoc(dup.doc));

  // Stack order, bottom first.
  const text = base.layers[1]!;
  const stack: DesignDoc = {
    ...base,
    layers: ["a", "b", "c", "d"].map((id) => ({ ...text, id })),
  };
  expect("forward steps up one", order(restack(stack, ["b"], "forward")) === "acbd");
  expect("backward steps down one", order(restack(stack, ["c"], "backward")) === "acbd");
  expect("front goes to the top", order(restack(stack, ["a", "c"], "front")) === "bdac");
  expect("back goes to the bottom", order(restack(stack, ["d"], "back")) === "dabc");
  expect("forward at the top stays", order(restack(stack, ["d"], "forward")) === "abcd");
  expect("drag to a place moves one layer", order(moveLayerTo(stack, "d", 1)) === "adbc");

  // Groups.
  const grouped = groupLayers(stack, ["a", "c"]);
  /**
   * A layer's group in the grouped stack.
   * @param id - Layer id.
   * @returns Group id, or null.
   */
  const groupOf = (id: string): string | null =>
    grouped.layers.find((l) => l.id === id)?.groupId ?? null;
  expect(
    "grouping pulls members together under the top member",
    order(grouped) === "bacd" && !!groupOf("a") && groupOf("a") === groupOf("c"),
    order(grouped),
  );
  expect(
    "picking one group member picks the group",
    expandGroups(grouped, ["a"]).sort().join("") === "ac",
  );

  // Align leaves locked layers alone.
  const locked = structuredClone(base);
  locked.layers[1]!.locked = true;
  const aligned = alignLayers(locked, "feed-4x5", ["head1"], "left", "all");
  expect("align skips a locked layer", aligned.layouts["feed-4x5"]!.head1!.x === before.x);

  // Copy and paste style.
  const other: TextLayer = {
    ...(text as TextLayer),
    id: "t2",
    text: "Other",
    colour: "coquelicot",
  };
  const styled = pasteStyle(
    { ...base, layers: [...base.layers, other] },
    ["head1"],
    styleOf(other),
  );
  const head = styled.layers[1] as TextLayer;
  expect(
    "paste style copies the look but not the words",
    head.colour === "coquelicot" && head.text === "Friendly local IT support",
  );

  // Presets scale their font by each size's shorter side.
  const small = applyTextPreset(base, "head1", "support");
  expect(
    "a preset sets the font on every size, scaled",
    small.layouts["feed-4x5"]!.head1!.fontSize === presetFontSize("support", "feed-4x5") &&
      small.layouts.landscape!.head1!.fontSize === presetFontSize("support", "landscape") &&
      presetFontSize("support", "landscape") < presetFontSize("support", "feed-4x5"),
  );

  // Text heights.
  expect(
    "unchanged text heights return the same design",
    setTextHeights(base, { "feed-4x5": { head1: 300.2 } }) === base,
  );
  expect(
    "a new text height is written",
    setTextHeights(base, { "feed-4x5": { head1: 180 } }).layouts["feed-4x5"]!.head1!.h === 180,
  );

  // Bound words.
  const contact = makeLayer({ kind: "contact", fields: ["phone", "email"] }).layer;
  const promo = makeLayer({ kind: "promo", field: "ends" }).layer;
  expect(
    "contact details draw one per line",
    contact.type === "contact" && boundText(contact, NO_BOUND) === "021 000 0000\nhi@example.nz",
  );
  expect(
    "a missing promo draws a reminder",
    promo.type === "promo" &&
      boundText(promo, { ...NO_BOUND, promoEnds: null }) === "[No promo running]",
  );
}

/** Adding, removing and re-laying-out sizes, re-linking, hiding, and app crops. */
function checkSizes(): void {
  console.log("\nSizes in a design");
  const base = docWithText((f) => ({
    x: 90,
    y: 200,
    w: FORMATS[f].width - 180,
    h: 300,
    rotation: 0,
    fontSize: 96,
    linked: true,
  }));
  /**
   * Headline geometry on one size.
   * @param d - Design.
   * @param f - Size.
   * @returns The headline's geometry there, if laid out.
   */
  const head = (d: DesignDoc, f: FormatKey): Geometry | undefined => d.layouts[f]?.head1;

  expect("the closest shape to an X post is landscape", nearestFormat(base, "x") === "landscape");
  expect(
    "the closest shape to a profile picture is square",
    nearestFormat(base, "profile") === "square",
  );

  const withX = addFormat(base, "x");
  expect(
    "an added size is listed in tab order with every layer placed",
    withX.formats.at(-1) === "x" &&
      withX.layers.every((l) => !!withX.layouts.x?.[l.id]) &&
      head(withX, "x")?.linked === true,
  );
  expect("adding a size twice changes nothing", addFormat(withX, "x") === withX);
  expect("a design with an extra size parses", "doc" in parseDesignDoc(withX));

  // A design that went out may gain a size, but nothing it already has may change. The save
  // route compares both documents as parsed.
  /**
   * A design as the save route reads it.
   * @param d - Design.
   * @returns The parsed design.
   */
  const asSaved = (d: DesignDoc): DesignDoc => {
    const p = parseDesignDoc(JSON.parse(JSON.stringify(d)));
    if ("error" in p) throw new Error(p.error);
    return p.doc;
  };
  const stored = asSaved(base);
  expect("a design that went out may gain a size", onlyAddsSizes(stored, asSaved(withX)));
  expect(
    "re-measured text heights don't count as a change",
    onlyAddsSizes(stored, asSaved(setTextHeights(withX, { square: { head1: 340 } }))),
  );
  expect(
    "moving a layer on a size it had counts",
    !onlyAddsSizes(
      stored,
      asSaved(setGeometry(withX, "square", { head1: { ...head(base, "square")!, x: 10 } }, "this")),
    ),
  );
  expect(
    "changing its words counts",
    !onlyAddsSizes(
      stored,
      asSaved({
        ...withX,
        layers: withX.layers.map((l) => (l.type === "text" ? { ...l, text: "New words" } : l)),
      }),
    ),
  );
  expect(
    "taking a size away counts",
    !onlyAddsSizes(stored, asSaved(removeFormat(base, "square"))),
  );
  expect(
    "a new caption counts",
    !onlyAddsSizes(stored, asSaved({ ...withX, caption: "Different post text" })),
  );

  const lessSquare = removeFormat(base, "square");
  expect(
    "removing a size drops it and its layout",
    !lessSquare.formats.includes("square") && !lessSquare.layouts.square,
  );
  const one: DesignDoc = { ...base, formats: ["square"], layouts: { square: base.layouts.square } };
  expect("the last size can't be removed", removeFormat(one, "square") === one);

  // A hand-set layer stops pushing its edits to the other sizes.
  const handSet = setGeometry(
    base,
    "square",
    { head1: { ...head(base, "square")!, x: 10 } },
    "this",
  );
  const fromHandSet = setGeometry(
    handSet,
    "square",
    { head1: { ...head(handSet, "square")!, x: 300 } },
    "all",
  );
  expect(
    "a move on a size set by hand stays there",
    sortedJson(fromHandSet.layouts.story) === sortedJson(base.layouts.story) &&
      head(fromHandSet, "square")?.x === 300,
  );

  // Re-linking puts it back where the other sizes place it, keeping hidden as it was.
  const hidden = setHidden(handSet, "square", ["head1"], true);
  const relinked = relinkLayers(hidden, "square", ["head1"]);
  const expected = autoPlace(head(base, "feed-4x5")!, "feed-4x5", "square");
  expect(
    "re-linking places the layer from a linked size",
    head(relinked, "square")?.linked === true && near(head(relinked, "square")!.x, expected.x),
    JSON.stringify(head(relinked, "square")),
  );
  expect("re-linking keeps it hidden on that size", head(relinked, "square")?.hidden === true);

  // Hiding is one size only and doesn't unlink.
  expect(
    "hiding touches one size and keeps the link",
    head(hidden, "square")?.hidden === true &&
      head(hidden, "story")?.hidden === undefined &&
      head(setHidden(base, "story", ["head1"], true), "story")?.linked === true,
  );
  expect(
    "showing again clears the flag",
    head(setHidden(hidden, "square", ["head1"], false), "square")?.hidden === undefined,
  );

  // Copy layout re-places every layer from the source, linked.
  const copied = copyLayout(handSet, "feed-4x5", "square");
  expect(
    "copy layout replaces a hand-set place and links it",
    head(copied, "square")?.linked === true && near(head(copied, "square")!.x, expected.x),
  );
  expect("copy layout onto itself changes nothing", copyLayout(base, "square", "square") === base);

  // App crops agree with the composer's picture rules.
  const feed = appCrops("feed-4x5");
  expect(
    "a 4:5 picture is cut by Google only",
    feed.crops.length === 1 && feed.crops[0]?.label === "Google" && feed.refusedBy.length === 0,
  );
  const land = appCrops("landscape");
  const google = land.crops.find((c) => c.label === "Google");
  expect(
    "Google cuts a landscape picture to a centred 4:3",
    !!google && near(google.w / google.h, 4 / 3, 0.01) && near(google.x * 2 + google.w, 1200),
    JSON.stringify(google),
  );
  expect(
    "Facebook shows a landscape picture whole",
    !land.crops.some((c) => c.label.includes("Facebook")),
  );
  const story = appCrops("story");
  expect(
    "a story is cut by Facebook and refused by Instagram as a post",
    story.crops.some((c) => c.label.includes("Facebook")) && story.refusedBy.includes("Instagram"),
    JSON.stringify(story),
  );
  expect(
    "Google 4:3 shows whole on Google",
    !appCrops("google-4x3").crops.some((c) => c.label.includes("Google")),
  );
}

/**
 * Whether two boxes overlap by more than a pixel.
 * @param a - First box.
 * @param b - Second box.
 * @returns True when they overlap.
 */
function overlaps(a: Geometry, b: Geometry): boolean {
  return a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h;
}

/** Starter templates, icons and empty photo frames. */
function checkTemplates(): void {
  console.log("\nStarter templates");
  const bookingUrl = "https://example.co.nz/booking";
  const templates = starterTemplates({ bookingUrl });
  const keys = templates.map((t) => t.templateKey);
  expect("template keys are unique", new Set(keys).size === keys.length, keys.join(", "));
  expect(
    "template keys carry a version",
    keys.every((k) => /^[a-z]+@\d+$/.test(k)),
    keys.join(", "),
  );
  expect(
    "there's one template per kind",
    sortedJson(templates.map((t) => t.kind).sort()) ===
      sortedJson(["announcement", "promo", "review", "tip"]),
  );

  for (const t of templates) {
    const parsed = parseDesignDoc(JSON.parse(JSON.stringify(t.doc)));
    expect(
      `${t.name}: parses back to the same document`,
      "doc" in parsed && sortedJson(parsed.doc) === sortedJson(t.doc),
      "error" in parsed ? parsed.error : "",
    );
    expect(
      `${t.name}: has every core size`,
      sortedJson([...t.doc.formats].sort()) === sortedJson([...CORE_FORMATS].sort()),
      t.doc.formats.join(", "),
    );
    const [backdrop, card] = t.doc.layers;
    expect(
      `${t.name}: starts with a brand backdrop and a frosted card`,
      backdrop.type === "backdrop" && backdrop.source === "brand" && card.type === "frosted",
    );
    for (const f of CORE_FORMATS) {
      const layout = t.doc.layouts[f] ?? {};
      const missing = t.doc.layers.filter((l) => !layout[l.id]).map((l) => l.name);
      expect(`${t.name} on ${f}: every layer is laid out`, missing.length === 0, missing.join());
      const content = t.doc.layers.slice(2).filter((l) => layout[l.id]);
      const cardG = layout[card.id];
      const outside = content.filter((l) => {
        const g = layout[l.id];
        return (
          g.x < cardG.x - 1 ||
          g.y < cardG.y - 1 ||
          g.x + g.w > cardG.x + cardG.w + 1 ||
          g.y + g.h > cardG.y + cardG.h + 1
        );
      });
      expect(
        `${t.name} on ${f}: the card holds all its content`,
        outside.length === 0,
        outside.map((l) => l.name).join(),
      );
      const s = safeRect(f);
      expect(
        `${t.name} on ${f}: the card sits inside the canvas and the safe area`,
        inside(cardG, f) &&
          cardG.x >= s.x1 - 1 &&
          cardG.y >= s.y1 - 1 &&
          cardG.x + cardG.w <= s.x2 + 1 &&
          cardG.y + cardG.h <= s.y2 + 1,
        JSON.stringify(cardG),
      );
      const clashes: string[] = [];
      for (let i = 0; i < content.length; i++) {
        for (let j = i + 1; j < content.length; j++) {
          if (overlaps(layout[content[i].id], layout[content[j].id]))
            clashes.push(`${content[i].name}/${content[j].name}`);
        }
      }
      expect(`${t.name} on ${f}: nothing overlaps`, clashes.length === 0, clashes.join(", "));
      const tiny = content.filter((l) => {
        const size = layout[l.id].fontSize;
        return size !== undefined && size < 18;
      });
      expect(
        `${t.name} on ${f}: no text under 18px`,
        tiny.length === 0,
        tiny.map((l) => l.name).join(),
      );
    }
  }

  const promo = templates.find((t) => t.kind === "promo");
  const qr = promo?.doc.layers.find((l) => l.type === "qr");
  expect("the promo QR code opens the booking page", qr?.type === "qr" && qr.url === bookingUrl);
  const announcement = templates.find((t) => t.kind === "announcement");
  expect(
    "the announcement starts with an empty photo frame",
    announcement?.doc.layers.some((l) => l.type === "image" && l.src === "") === true,
  );

  const tip = templates.find((t) => t.kind === "tip");
  const badIcon = JSON.parse(JSON.stringify(tip?.doc)) as RawDoc & {
    layers: Record<string, unknown>[];
  };
  for (const l of badIcon.layers) if (l.type === "icon") l.icon = "FaNotAnIcon";
  const rejected = parseDesignDoc(badIcon);
  expect(
    "an icon not on offer is refused",
    "error" in rejected && rejected.error.includes("isn't one of the icons on offer"),
    "error" in rejected ? rejected.error : "parsed",
  );

  const offered = ICON_CHOICES.map((c) => c.name).sort();
  expect(
    "every icon on offer has artwork and nothing else does",
    sortedJson(offered) === sortedJson(Object.keys(ICON_ART).sort()),
  );
  const undrawn = offered.filter((n) => !iconDataUri(n, "#2b93a1")?.includes("2b93a1"));
  expect("every icon draws in the chosen colour", undrawn.length === 0, undrawn.join());
  expect("an unknown icon draws nothing", iconDataUri("FaNotAnIcon", "#000000") === null);
}

/**
 * The smallest JPEG header the size reader needs: start of image, a JFIF block, then a
 * baseline frame header.
 * @param width - Width in the frame header.
 * @param height - Height in the frame header.
 * @param frame - Start-of-frame marker byte.
 * @returns Bytes.
 */
function jpegHeader(width: number, height: number, frame = 0xc0): Uint8Array {
  const jfif = [0xff, 0xe0, 0x00, 0x10, ...Array.from({ length: 14 }, () => 0)];
  const sof = [0xff, frame, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255];
  return new Uint8Array([0xff, 0xd8, ...jfif, ...sof, ...Array.from({ length: 9 }, () => 0)]);
}

/** Stored pictures: out-of-date state, paid ads, descriptions, file names, JPEG sizes. */
function checkPictures(): void {
  console.log("\nPictures");
  const [promo] = starterTemplates({ bookingUrl: "https://example.co.nz/booking" }).filter(
    (t) => t.kind === "promo",
  );
  const doc = promo.doc;
  const hash = docHash(doc, NO_BOUND);
  const none = pictureState(doc, NO_BOUND, []);
  expect(
    "no pictures: none, every size outdated",
    none.status === "none" && none.outdated.length === doc.formats.length,
  );
  const all = doc.formats.map((format) => ({ format, docHash: hash }));
  expect("every size current", pictureState(doc, NO_BOUND, all).status === "current");
  const oneOld = all.map((r) => (r.format === "story" ? { ...r, docHash: "0" } : r));
  const stale = pictureState(doc, NO_BOUND, oneOld);
  expect(
    "one old size: stale, only that size",
    stale.status === "stale" && sortedJson(stale.outdated) === sortedJson(["story"]),
  );
  const missing = pictureState(
    doc,
    NO_BOUND,
    all.filter((r) => r.format !== "square"),
  );
  expect("a missing size is outdated", sortedJson(missing.outdated) === sortedJson(["square"]));
  const newPhone = pictureState(doc, { ...NO_BOUND, phone: "09 000 0000" }, all);
  expect("a new phone number outdates a design showing it", newPhone.status === "stale");
  const paid = pictureState({ ...doc, paidAd: true }, NO_BOUND, all);
  expect("switching to a paid ad outdates the pictures", paid.status === "stale");
  const words = pictureState(
    { ...doc, caption: "New words", altText: "New description" },
    NO_BOUND,
    all,
  );
  expect("post words and description don't outdate the pictures", words.status === "current");

  const contact = doc.layers.find((l) => l.type === "contact");
  const headline = doc.layers.find((l) => l.role === "headline");
  expect("paid ads leave contact details off", !!contact && leftOffPaidAd(contact, true));
  expect("ordinary posts keep contact details", !!contact && !leftOffPaidAd(contact, false));
  expect("paid ads keep the headline", !!headline && !leftOffPaidAd(headline, true));

  expect(
    "promo description is its headline as a sentence",
    autoAltText(doc) === "Get your tech sorted.",
    autoAltText(doc),
  );
  const announcement = starterTemplates({ bookingUrl: "" }).find((t) => t.kind === "announcement");
  expect(
    "headline and short line join as sentences",
    autoAltText(announcement!.doc) === "Big news to share. Say what's new in a line or two here.",
    autoAltText(announcement!.doc),
  );
  expect("no words, no description", autoAltText(blankDoc()) === "");

  expect(
    "file name: slug, size label and pixels",
    pictureFileName("Spring promo!", "feed-4x5", 1, "jpg") ===
      "spring-promo-post-4-5-1080x1350.jpg",
    pictureFileName("Spring promo!", "feed-4x5", 1, "jpg"),
  );
  expect(
    "file name: macrons come off, 2x doubles the pixels",
    pictureFileName("Māngere tips", "story", 2, "png") === "mangere-tips-story-2160x3840.png",
    pictureFileName("Māngere tips", "story", 2, "png"),
  );
  expect(
    "file name: an empty name still names the file",
    pictureFileName("  ", "square", 1, "jpg").startsWith("design-"),
  );

  expect(
    "JPEG size: baseline",
    sortedJson(jpegSize(jpegHeader(1080, 1350))) === sortedJson({ width: 1080, height: 1350 }),
  );
  expect(
    "JPEG size: progressive",
    sortedJson(jpegSize(jpegHeader(1200, 900, 0xc2))) === sortedJson({ width: 1200, height: 900 }),
  );
  expect(
    "JPEG size: a PNG isn't read",
    jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0])) === null,
  );
  expect(
    "JPEG size: a cut-off file is null",
    jpegSize(jpegHeader(1080, 1350).slice(0, 12)) === null,
  );

  const blob = "https://abc.public.blob.vercel-storage.com";
  expect("an export is a render", isRenderUrl(`${blob}/social-design/render-story-AbC123.jpg`));
  expect("an uploaded photo isn't", !isRenderUrl(`${blob}/social-design/image-AbC123.jpg`));
  expect(
    "a render name further down the path isn't",
    !isRenderUrl(`${blob}/x/social-design/render-a.jpg`),
  );
}

/** The AI draft: room per template, reading the reply, the review guard and the fill. */
function checkAiDraft(): void {
  console.log("\nAI draft");
  const starters = starterTemplates({ bookingUrl: "https://example.co.nz/booking" });
  /**
   * A starter template's design.
   * @param kind - Template kind.
   * @returns Its design.
   */
  const byKind = (kind: string): DesignDoc => starters.find((t) => t.kind === kind)!.doc;
  const [announcement, review, tip] = [byKind("announcement"), byKind("review"), byKind("tip")];

  const roomA = draftRoom(announcement);
  expect(
    "announcement has a headline and a short line, nothing else",
    roomA.headline && roomA.support && roomA.bullets === 0 && !roomA.quote && !roomA.name,
    JSON.stringify(roomA),
  );
  const roomR = draftRoom(review);
  expect(
    "review has a quote and a name, no headline",
    roomR.quote && roomR.name && !roomR.headline && roomR.bullets === 0,
    JSON.stringify(roomR),
  );
  const roomT = draftRoom(tip);
  expect("tip has a headline and 3 ticked points", roomT.headline && roomT.bullets === 3);
  const roomB = draftRoom(blankDoc());
  expect(
    "a blank design gets a headline and a short line",
    roomB.headline && roomB.support && roomB.bullets === 0 && !roomB.quote,
  );
  expect(
    "every design kind starts on a draft kind",
    (["announcement", "review", "tip", "promo", "blank"] as const).every((k) =>
      POST_DRAFT_KINDS.some((d) => d.key === draftKindFor(k)),
    ),
  );

  expect("a room reads back", sortedJson(readRoom(roomT)) === sortedJson(roomT));
  expect("a room with 9 points is refused", readRoom({ ...roomT, bullets: 9 }) === null);
  expect("a room missing a flag is refused", readRoom({ bullets: 0, headline: true }) === null);

  const brief = '"Sorted my printer and my email in no time, very patient." Margaret, Titirangi';
  expect("a cut quote is from the brief", fromBrief("Sorted my printer in no time", brief));
  expect(
    "a quote with new words isn't",
    !fromBrief("The best tech in Auckland, highly recommend", brief),
  );
  expect("a name from the brief is", fromBrief("Margaret, Titirangi", brief));
  expect("a made-up name isn't", !fromBrief("John, Henderson", brief));

  const reply = {
    headline: "Printer “sorted” — fast",
    support: "x",
    bullets: ["a", "b", "c", "d", "e"],
    quote: "Sorted my printer in no time",
    name: "Margaret, Titirangi",
    caption: "Thanks Margaret.",
  };
  const forReview = readDesignDraft(reply, roomR, brief);
  expect(
    "words with no room are dropped",
    forReview !== null &&
      forReview.headline === "" &&
      forReview.support === "" &&
      forReview.bullets.length === 0 &&
      forReview.quote === "Sorted my printer in no time",
  );
  const invented = readDesignDraft({ ...reply, quote: "Best tech in Auckland!" }, roomR, brief);
  expect("an invented quote is dropped", invented?.quote === "");
  const forTip = readDesignDraft(reply, roomT, brief);
  expect(
    "curly quotes and long dashes straightened",
    forTip?.headline === 'Printer "sorted" - fast',
    forTip?.headline,
  );
  expect("ticked points capped at 4", forTip?.bullets.length === 4);
  expect(
    "an empty reply is nothing to fill",
    readDesignDraft({ headline: "", caption: " " }, roomA, "") === null,
  );
  expect("a non-object reply is nothing", readDesignDraft("text", roomA, "") === null);

  const draft: DesignDraft = {
    headline: "Home visits in Titirangi",
    support: "Tuesdays and Thursdays, at your place.",
    bullets: ["One", "Two", "Three"],
    quote: "",
    name: "",
    caption: "I'm now coming to Titirangi.",
  };
  /**
   * Words of the first text layer with a role.
   * @param doc - Design.
   * @param role - Role.
   * @returns The words, or undefined with no such layer.
   */
  const textOf = (doc: DesignDoc, role: string): string | undefined => {
    const l = doc.layers.find((x) => x.type === "text" && x.role === role);
    return l?.type === "text" ? l.text : undefined;
  };
  const filledA = fillDraft(announcement, draft);
  expect(
    "announcement: headline, short line and post words filled",
    textOf(filledA.doc, "headline") === draft.headline &&
      textOf(filledA.doc, "support") === draft.support &&
      filledA.doc.caption === draft.caption &&
      filledA.missing.length === 0,
  );
  expect(
    "the fill leaves every layout alone",
    JSON.stringify(filledA.doc.layouts) === JSON.stringify(announcement.layouts),
  );
  const filledT = fillDraft(tip, draft);
  const list = filledT.doc.layers.find((l) => l.type === "bullets");
  expect(
    "tip: the ticked points are replaced",
    list?.type === "bullets" && sortedJson(list.items) === sortedJson(draft.bullets),
  );
  const filledR = fillDraft(review, { ...draft, headline: "", support: "" });
  expect(
    "review with no review words keeps its placeholder quote",
    textOf(filledR.doc, "quote") === textOf(review, "quote") && filledR.missing.length === 0,
  );
  const filledB = fillDraft(blankDoc(), draft);
  expect(
    "blank: the headline and short line are listed for adding",
    sortedJson(filledB.missing) === sortedJson(["headline", "support"]) &&
      filledB.doc.layers.length === blankDoc().layers.length,
  );
  const keepCaption = fillDraft({ ...announcement, caption: "Mine" }, { ...draft, caption: "" });
  expect("an empty caption keeps the one there", keepCaption.doc.caption === "Mine");

  // Making room: a quote 60px taller on 4:5 moves what's around it and grows its card.
  /**
   * The id of a design's first layer that matches.
   * @param doc - Design.
   * @param test - Match.
   * @returns The layer id.
   */
  const idOf = (doc: DesignDoc, test: (l: Layer) => boolean): string => doc.layers.find(test)!.id;
  const quoteId = idOf(review, (l) => l.role === "quote");
  const nameId = idOf(review, (l) => l.role === "name");
  const markId = idOf(review, (l) => l.type === "quote-mark");
  const cardId = idOf(review, (l) => l.type === "frosted");
  const backId = idOf(review, (l) => l.type === "backdrop");
  const was = review.layouts["feed-4x5"]!;
  const taller = setTextHeights(review, { "feed-4x5": { [quoteId]: was[quoteId]!.h + 60 } });
  const roomy = makeRoom(review, taller);
  const now = roomy.layouts["feed-4x5"]!;
  expect(
    "room: the name under the quote moves down by half",
    now[nameId]!.y === was[nameId]!.y + 30,
  );
  expect("room: the quote mark above moves up by half", now[markId]!.y === was[markId]!.y - 30);
  expect(
    "room: the card grows by the change and stays centred",
    now[cardId]!.h === was[cardId]!.h + 60 &&
      now[cardId]!.y + now[cardId]!.h / 2 === was[cardId]!.y + was[cardId]!.h / 2,
  );
  expect("room: the backdrop stays put", sortedJson(now[backId]) === sortedJson(was[backId]));
  expect(
    "room: the name no longer runs into the quote",
    now[nameId]!.y >= now[quoteId]!.y + now[quoteId]!.h,
  );
  expect(
    "room: other sizes are left alone",
    sortedJson(roomy.layouts.story) === sortedJson(review.layouts.story),
  );
  expect("room: nothing changed gives the same design", makeRoom(review, review) === review);
  const shorter = setTextHeights(review, { "feed-4x5": { [quoteId]: was[quoteId]!.h - 40 } });
  expect(
    "room: a shorter quote pulls the name up and shrinks the card",
    makeRoom(review, shorter).layouts["feed-4x5"]![nameId]!.y === was[nameId]!.y - 20 &&
      makeRoom(review, shorter).layouts["feed-4x5"]![cardId]!.h === was[cardId]!.h - 40,
  );
  // On a wide size the photo sits beside the words, so a longer headline leaves it be.
  const headId = idOf(announcement, (l) => l.role === "headline");
  const photoId = idOf(announcement, (l) => l.role === "photo");
  const wide = announcement.layouts.landscape!;
  const wideAfter = makeRoom(
    announcement,
    setTextHeights(announcement, { landscape: { [headId]: wide[headId]!.h + 50 } }),
  ).layouts.landscape!;
  expect(
    "room: a photo beside the words doesn't move",
    sortedJson(wideAfter[photoId]) === sortedJson(wide[photoId]),
  );
}

/** Style checks: small text, too much text, covered words, buttons, emoji and contrast. */
function checkStyle(): void {
  console.log("\nStyle checks");
  for (const t of starterTemplates({ bookingUrl: "https://example.co.nz/booking" })) {
    const issues = styleChecks(t.doc, NO_BOUND);
    expect(
      `${t.name} passes its own style checks`,
      issues.length === 0,
      issues.map((i) => i.message).join(" | "),
    );
  }

  /**
   * A design with one headline at the same place on every size.
   * @param words - The headline's words.
   * @param fontSize - Its font size on every size.
   * @param at - Geometry changes.
   * @returns The design.
   */
  const withWords = (words: string, fontSize = 96, at: Partial<Geometry> = {}): DesignDoc => {
    const doc = docWithText(() => ({
      x: 100,
      y: 500,
      w: 800,
      h: 200,
      rotation: 0,
      linked: true,
      fontSize,
      ...at,
    }));
    doc.layers = doc.layers.map((l) => (l.type === "text" ? { ...l, text: words } : l));
    return doc;
  };
  /**
   * Kinds of issue a design has.
   * @param doc - Design.
   * @returns Kinds, sorted and joined.
   */
  const kinds = (doc: DesignDoc): string =>
    styleChecks(doc, NO_BOUND)
      .map((i) => i.kind)
      .sort()
      .join(",");

  expect("a clean headline has no issues", kinds(withWords("Friendly local IT support")) === "");
  const small = styleChecks(withWords("Name, Suburb", 26), NO_BOUND);
  expect(
    "26px is small on every size, one issue listing them all",
    small.length === 1 && small[0]!.kind === "small-text" && small[0]!.formats.length === 5,
    small.map((i) => i.message).join(" | "),
  );
  const at30 = styleChecks(withWords("Name, Suburb", 30), NO_BOUND);
  expect(
    "30px reads on 1080 wide but not on 1200 wide",
    at30.length === 1 &&
      sortedJson(at30[0]!.formats) === sortedJson(["google-4x3", "landscape"]) &&
      at30[0]!.message.includes("at least 32"),
    at30.map((i) => i.message).join(" | "),
  );
  const top = styleChecks(withWords("Big news", 96, { y: 40 }), NO_BOUND);
  expect(
    "words in a story's top band may be covered, on the story only",
    top.some((i) => i.kind === "covered" && sortedJson(i.formats) === sortedJson(["story"])),
  );
  const profile = withWords("Big news", 96, { x: 0, y: 0, w: 300, h: 120 });
  profile.formats = ["profile"];
  profile.layouts = { profile: profile.layouts["feed-4x5"] };
  expect("words in a profile picture's corner are cut by the circle", kinds(profile) === "covered");
  expect("tap words read like a button", kinds(withWords("Tap here to book")) === "button");
  expect("learn more reads like a button", kinds(withWords("Learn more")) === "button");
  expect("book now on its own is fine", kinds(withWords("Book now")) === "");
  const onBox = withWords("Book now", 96, { x: 300, y: 600, w: 480, h: 110 });
  const box: Layer = { ...makeLayer({ kind: "shape", shape: "rect" }).layer, id: "btn" };
  onBox.layers.splice(1, 0, box);
  for (const f of onBox.formats) {
    onBox.layouts[f] = {
      ...onBox.layouts[f],
      btn: { x: 280, y: 580, w: 520, h: 150, rotation: 0, linked: true },
    };
  }
  expect("short words on a small box read like a button", kinds(onBox) === "button");
  expect("an emoji is noted", kinds(withWords("Sorted \u{1F44D}")) === "emoji");

  /**
   * Adds a word layer at a free spot on every size.
   * @param doc - Design.
   * @param layer - Layer to add.
   * @param y - Top edge.
   * @returns The design.
   */
  const plus = (doc: DesignDoc, layer: Layer, y: number): DesignDoc => {
    const layouts = { ...doc.layouts };
    for (const f of doc.formats) {
      layouts[f] = {
        ...layouts[f],
        [layer.id]: { x: 100, y, w: 800, h: 60, rotation: 0, linked: true, fontSize: 40 },
      };
    }
    return { ...doc, layers: [...doc.layers, layer], layouts };
  };
  /**
   * A support text layer.
   * @param id - Layer id.
   * @param words - Its words.
   * @returns The layer.
   */
  const textLayer = (id: string, words: string): Layer =>
    ({ ...makeLayer({ kind: "text", preset: "support" }).layer, id, text: words }) as Layer;
  const busy = plus(
    plus(withWords("One"), textLayer("t2", "Two"), 750),
    textLayer("t3", "Three"),
    850,
  );
  expect("three pieces of text are fine", kinds(busy) === "");
  const contact: Layer = { ...makeLayer({ kind: "contact", fields: ["phone"] }).layer, id: "c1" };
  const withContact = plus(busy, contact, 950);
  expect("contact details don't count towards the limit", kinds(withContact) === "");
  const many = styleChecks(plus(busy, textLayer("t4", "Four"), 1000), NO_BOUND).filter(
    (i) => i.kind === "many-words",
  );
  expect(
    "a fourth piece of text is too many",
    many.length === 1 && many[0]!.layerId === null && many[0]!.message.startsWith("4 pieces"),
  );
  expect(
    "a paid ad's contact layer draws no words",
    wordLayersOn({ ...withContact, paidAd: true }, "feed-4x5", NO_BOUND).every(
      (w) => w.layer.type !== "contact",
    ),
  );
  expect(
    "the backdrop drawing has no word layers",
    withoutWords(withContact).layers.every(
      (l) => !["text", "bullets", "contact", "promo"].includes(l.type),
    ),
  );

  // Contrast, from made-up pixels at quarter scale.
  expect(
    "white on black is 21",
    near(contrastRatio(luminance(255, 255, 255), luminance(0, 0, 0)), 21, 0.01),
  );
  /**
   * A flat picture, optionally with a band of another colour from one row down.
   * @param rgb - Main colour.
   * @param band - Colour of the band, or null.
   * @param from - First row of the band.
   * @returns Pixels at 270 x 338 (a quarter of a 4:5 post).
   */
  const flat = (rgb: number[], band: number[] | null = null, from = 0): Pixels => {
    const width = 270;
    const height = 338;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = band && y >= from ? band : rgb;
        data.set([c[0]!, c[1]!, c[2]!, 255], (y * width + x) * 4);
      }
    }
    return { width, height, data };
  };
  const violet = withWords("Friendly local IT support");
  const white = [255, 255, 255];
  const night = [20, 18, 40];
  expect(
    "violet on white reads",
    contrastIssues(violet, "feed-4x5", flat(white), 0.25, NO_BOUND).length === 0,
  );
  expect(
    "violet on near-black doesn't",
    contrastIssues(violet, "feed-4x5", flat(night), 0.25, NO_BOUND).length === 1,
  );
  // The headline box covers rows 125-175 at quarter scale; the dark band takes its lower 30%.
  expect(
    "a dark patch behind part of the words counts",
    contrastIssues(violet, "feed-4x5", flat(white, night, 160), 0.25, NO_BOUND).length === 1,
  );
  const banded: DesignDoc = {
    ...violet,
    layers: violet.layers.map((l) =>
      l.type === "text" ? { ...l, colour: "white", highlight: "russian-violet" } : l,
    ),
  };
  expect(
    "words on a highlight band are measured against the band",
    contrastIssues(banded, "feed-4x5", flat(white), 0.25, NO_BOUND).length === 0,
  );
  const merged = mergeContrast(
    violet,
    [
      { kind: "contrast", layerId: "head1", formats: ["story"], message: "" },
      { kind: "contrast", layerId: "head1", formats: ["feed-4x5"], message: "" },
    ],
    NO_BOUND,
  );
  expect(
    "contrast issues merge per layer in tab order",
    merged.length === 1 && sortedJson(merged[0]!.formats) === sortedJson(["feed-4x5", "story"]),
  );
}

/** Runs every group and exits non-zero on any failure. */
function main(): void {
  checkFormats();
  checkParse();
  checkAutoPlace();
  checkPropagate();
  checkAlign();
  checkHash();
  checkEditorOps();
  checkSizes();
  checkTemplates();
  checkPictures();
  checkAiDraft();
  checkStyle();
  finish();
}

main();
