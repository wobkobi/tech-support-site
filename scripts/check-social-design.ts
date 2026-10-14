// scripts/check-social-design.ts
// Post maker logic the editor and exports rely on: the size registry, the design
// document parser, placing layers on another size (every size pair), carrying linked
// edits across sizes, the align and distribute moves, and the out-of-date hash.
// Pure logic, no database and no browser.
// Run with: npm test -- social-design

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

/** Runs every group and exits non-zero on any failure. */
function main(): void {
  checkFormats();
  checkParse();
  checkAutoPlace();
  checkPropagate();
  checkAlign();
  checkHash();
  console.log(failures === 0 ? "\nAll fixtures passed." : `\n${failures} fixture(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
