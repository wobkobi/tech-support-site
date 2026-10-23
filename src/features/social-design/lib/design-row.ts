// src/features/social-design/lib/design-row.ts
// Plain-data design shapes for the server > client boundary and the designs API, and
// the blank document a new design starts from.

import {
  DOC_VERSION,
  newLayerId,
  parseDesignDoc,
  type BackdropLayer,
  type DesignDoc,
} from "@/features/social-design/lib/doc";
import { CORE_FORMATS, isFormatKey, type FormatKey } from "@/features/social-design/lib/formats";
import { fullBleed } from "@/features/social-design/lib/layout";
import type { SocialDesign } from "@prisma/client";

/** Kinds a design can be, matching the starter templates. */
export const DESIGN_KINDS = ["announcement", "review", "tip", "promo", "blank"] as const;
export type DesignKind = (typeof DESIGN_KINDS)[number];

export const KIND_LABEL: Record<DesignKind, string> = {
  announcement: "Announcement",
  review: "Review",
  tip: "Tip",
  promo: "Promo",
  blank: "Blank",
};

/** One exported size as the client sees it. */
export interface RenderRow {
  format: FormatKey;
  url: string;
  width: number;
  height: number;
  docHash: string;
  renderedAt: string;
}

/** A design in the list: no document, just enough to show a card. */
export interface DesignSummary {
  id: string;
  name: string;
  kind: DesignKind;
  isTemplate: boolean;
  /** First exported picture, for the card thumbnail. */
  thumbnailUrl: string | null;
  formatCount: number;
  postId: string | null;
  updatedAt: string;
  /** Its pictures went out in a post or email, so it opens locked. Set by the Post maker page. */
  goneOut?: boolean;
}

/** A design opened in the editor. */
export interface DesignRow extends Omit<DesignSummary, "thumbnailUrl" | "formatCount"> {
  doc: DesignDoc;
  renders: RenderRow[];
}

/**
 * Narrows a stored kind, treating anything unknown as blank.
 * @param kind - Stored kind.
 * @returns A known kind.
 */
export function toKind(kind: string): DesignKind {
  return (DESIGN_KINDS as readonly string[]).includes(kind) ? (kind as DesignKind) : "blank";
}

/**
 * Exported pictures as the client sees them, skipping sizes this version doesn't know.
 * @param design - Stored design.
 * @returns Render rows.
 */
function toRenderRows(design: SocialDesign): RenderRow[] {
  return design.renders.flatMap((r) =>
    isFormatKey(r.format)
      ? [{ ...r, format: r.format, renderedAt: r.renderedAt.toISOString() }]
      : [],
  );
}

/**
 * List-card shape of a stored design.
 * @param design - Stored design.
 * @returns Summary row.
 */
export function toDesignSummary(design: SocialDesign): DesignSummary {
  const doc = design.doc as { formats?: unknown } | null;
  return {
    id: design.id,
    name: design.name,
    kind: toKind(design.kind),
    isTemplate: design.isTemplate,
    thumbnailUrl: design.renders[0]?.url ?? null,
    formatCount: Array.isArray(doc?.formats) ? doc.formats.length : 0,
    postId: design.postId,
    updatedAt: design.updatedAt.toISOString(),
  };
}

/**
 * Editor shape of a stored design. A document failing the checks opens blank instead of
 * crashing; the bad copy stays stored until the next save.
 * @param design - Stored design.
 * @returns Editor row.
 */
export function toDesignRow(design: SocialDesign): DesignRow {
  const parsed = parseDesignDoc(design.doc);
  if ("error" in parsed)
    console.error(`[social-design] ${design.id} doc unreadable:`, parsed.error);
  return {
    id: design.id,
    name: design.name,
    kind: toKind(design.kind),
    isTemplate: design.isTemplate,
    postId: design.postId,
    updatedAt: design.updatedAt.toISOString(),
    doc: "doc" in parsed ? parsed.doc : blankDoc(),
    renders: toRenderRows(design),
  };
}

/**
 * A new design: the brand backdrop full-bleed on every core size, nothing else.
 * @returns Blank document.
 */
export function blankDoc(): DesignDoc {
  const backdrop: BackdropLayer = {
    id: newLayerId(),
    name: "Backdrop",
    type: "backdrop",
    locked: true,
    opacity: 1,
    role: null,
    groupId: null,
    flipX: false,
    flipY: false,
    shadow: false,
    source: "brand",
    src: null,
    colour: "seasalt",
    colour2: "white",
    blur: 0,
    wash: 0.35,
  };
  const layouts: DesignDoc["layouts"] = {};
  for (const f of CORE_FORMATS) layouts[f] = { [backdrop.id]: fullBleed(f) };
  return {
    version: DOC_VERSION,
    formats: [...CORE_FORMATS],
    layers: [backdrop],
    layouts,
    caption: "",
    altText: "",
    paidAd: false,
  };
}
