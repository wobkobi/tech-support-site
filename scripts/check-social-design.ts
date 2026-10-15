// scripts/check-social-design.ts
// Post maker logic the editor and exports rely on: the size registry, the design
// document parser, placing layers on another size (every size pair), carrying linked
// edits across sizes, the align and distribute moves, the out-of-date hash, and the
// editor's edits (add, move, restack, group, paste, restyle) plus every new-layer kind.
// Pure logic, no database and no browser.
// Run with: npm test -- social-design

import { appCrops } from "@/features/social-design/lib/app-crops";
import { boundText } from "@/features/social-design/lib/bound";
import { blankDoc } from "@/features/social-design/lib/design-row";
import {
  docHash,
  parseDesignDoc,
  type BoundValues,
  type DesignDoc,
  type Geometry,
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
  moveLayerTo,
  nearestFormat,
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
  FORMAT_KEYS,
  FORMATS,
  safeRect,
  type FormatKey,
} from "@/features/social-design/lib/formats";
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

let failures = 0;

/**
 * Records one assertion, so every case runs even after one fails.
 * @param label - Human-readable case name.
 * @param ok - Whether the case passed.
 * @param detail - Extra output shown on failure.
 */
function expect(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
    failures++;
  }
}

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
  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
