// src/features/social-design/lib/new-layer.ts
// New layers from the Add menu, already in house style, with a starting size and shape.

import {
  LOGOS,
  TEXT_PRESETS,
  type LogoVariant,
  type TextPreset,
} from "@/features/social-design/lib/brand";
import {
  newLayerId,
  type BackdropLayer,
  type ContactField,
  type Layer,
  type PromoField,
  type ShapeLayer,
} from "@/features/social-design/lib/doc";
import { ICON_CHOICES } from "@/features/social-design/lib/icons";

/** A new layer and how it starts out on the picture. */
export interface NewLayer {
  layer: Layer;
  /** Width as a share of the picture's shorter side. */
  share: number;
  /** Width over height. */
  ratio: number;
}

/** What the Add menu can add. */
export type AddKind =
  | { kind: "text"; preset: TextPreset }
  | { kind: "image"; src: string; naturalWidth: number; naturalHeight: number }
  | { kind: "photo-frame" }
  | { kind: "logo"; variant: LogoVariant }
  | { kind: "backdrop"; source: BackdropLayer["source"]; src?: string }
  | { kind: "frosted" }
  | { kind: "shape"; shape: ShapeLayer["shape"] }
  | { kind: "bullets" }
  | { kind: "stars" }
  | { kind: "quote-mark" }
  | { kind: "qr"; url: string }
  | { kind: "icon"; icon: string }
  | { kind: "contact"; fields: ContactField[] }
  | { kind: "promo"; field: PromoField };

const BASE = {
  locked: false,
  opacity: 1,
  role: null,
  groupId: null,
  flipX: false,
  flipY: false,
  shadow: false,
} as const;

const SAMPLE_TEXT: Record<TextPreset, string> = {
  headline: "Your headline here",
  support: "A short line that says a bit more.",
  small: "Small print or a detail",
  accent: "ACCENT LINE",
};

const SHAPE_NAME: Record<ShapeLayer["shape"], string> = {
  rect: "Rectangle",
  circle: "Circle",
  line: "Line",
  arrow: "Arrow",
};

const PROMO_NAME: Record<PromoField, string> = {
  offer: "Promo offer",
  ends: "Promo end date",
  summary: "Promo summary",
};

/**
 * Builds a new layer for the Add menu.
 * @param add - What to add.
 * @returns The layer with its starting size and shape.
 */
export function makeLayer(add: AddKind): NewLayer {
  const id = newLayerId();
  switch (add.kind) {
    case "text": {
      const p = TEXT_PRESETS[add.preset];
      return {
        layer: {
          ...BASE,
          id,
          name: p.label,
          type: "text",
          text: SAMPLE_TEXT[add.preset],
          preset: add.preset,
          weight: p.weight,
          colour: p.colour,
          align: "center",
          lineHeight: p.lineHeight,
          letterSpacing: p.letterSpacing,
          italic: false,
          highlight: null,
          shrinkToFit: false,
          role:
            add.preset === "headline" ? "headline" : add.preset === "support" ? "support" : null,
        },
        share: 0.8,
        ratio: add.preset === "headline" ? 4 : 8,
      };
    }
    case "image":
      return {
        layer: {
          ...BASE,
          id,
          name: "Photo",
          type: "image",
          src: add.src,
          naturalWidth: add.naturalWidth,
          naturalHeight: add.naturalHeight,
          fit: "cover",
          focusX: 0.5,
          focusY: 0.5,
          zoom: 1,
          radius: 24,
          mask: "none",
          brightness: 0,
          contrast: 0,
          greyscale: false,
          role: "photo",
        },
        share: 0.6,
        ratio: add.naturalWidth / add.naturalHeight,
      };
    case "photo-frame":
      return {
        layer: {
          ...BASE,
          id,
          name: "Photo frame",
          type: "image",
          src: "",
          // Shape of the frame until a photo arrives and brings its own.
          naturalWidth: 1200,
          naturalHeight: 1200,
          fit: "cover",
          focusX: 0.5,
          focusY: 0.5,
          zoom: 1,
          radius: 24,
          mask: "none",
          brightness: 0,
          contrast: 0,
          greyscale: false,
          role: "photo",
        },
        share: 0.5,
        ratio: 1,
      };
    case "logo":
      return {
        layer: {
          ...BASE,
          id,
          name: `Logo (${LOGOS[add.variant].label.toLowerCase()})`,
          type: "logo",
          variant: add.variant,
        },
        share: LOGOS[add.variant].ratio > 1 ? 0.45 : 0.18,
        ratio: LOGOS[add.variant].ratio,
      };
    case "backdrop":
      return {
        layer: {
          ...BASE,
          id,
          name: "Backdrop",
          type: "backdrop",
          locked: true,
          source: add.source,
          src: add.source === "photo" ? (add.src ?? null) : null,
          colour: add.source === "gradient" ? "moonstone-100" : "seasalt",
          colour2: "white",
          blur: add.source === "photo" ? 24 : 0,
          wash: add.source === "brand" || add.source === "photo" ? 0.35 : 0,
        },
        // Replaced by a full-bleed place by the editor.
        share: 1,
        ratio: 1,
      };
    case "frosted":
      return {
        layer: { ...BASE, id, name: "Frosted card", type: "frosted", radius: 32, shadow: true },
        share: 0.85,
        ratio: 1.2,
      };
    case "shape": {
      const line = add.shape === "line" || add.shape === "arrow";
      return {
        layer: {
          ...BASE,
          id,
          name: SHAPE_NAME[add.shape],
          type: "shape",
          shape: add.shape,
          fill: line ? null : "moonstone",
          stroke: line ? "russian-violet" : null,
          strokeWidth: line ? 8 : 0,
          radius: add.shape === "rect" ? 16 : 0,
        },
        share: line ? 0.5 : 0.3,
        ratio: line ? 10 : 1,
      };
    }
    case "bullets":
      return {
        layer: {
          ...BASE,
          id,
          name: "Bullet list",
          type: "bullets",
          items: ["First point", "Second point", "Third point"],
          colour: "russian-violet",
          tick: "moonstone-600",
          role: "bullets",
        },
        share: 0.75,
        ratio: 3,
      };
    case "stars":
      return {
        layer: { ...BASE, id, name: "Stars", type: "stars", count: 5, colour: "mustard" },
        share: 0.4,
        ratio: 5,
      };
    case "quote-mark":
      return {
        layer: { ...BASE, id, name: "Quote mark", type: "quote-mark", colour: "moonstone" },
        share: 0.14,
        ratio: 1.2,
      };
    case "qr":
      return {
        layer: { ...BASE, id, name: "QR code", type: "qr", url: add.url, colour: "russian-violet" },
        share: 0.3,
        ratio: 1,
      };
    case "icon":
      return {
        layer: {
          ...BASE,
          id,
          name: `Icon (${ICON_CHOICES.find((c) => c.name === add.icon)?.label.toLowerCase() ?? "icon"})`,
          type: "icon",
          icon: add.icon,
          colour: "moonstone-600",
        },
        share: 0.16,
        ratio: 1,
      };
    case "contact":
      return {
        layer: {
          ...BASE,
          id,
          name: "Contact details",
          type: "contact",
          fields: add.fields,
          colour: "russian-violet",
        },
        share: 0.6,
        ratio: 6,
      };
    case "promo":
      return {
        layer: {
          ...BASE,
          id,
          name: PROMO_NAME[add.field],
          type: "promo",
          field: add.field,
          colour: "coquelicot",
          weight: 700,
          role: add.field === "offer" ? "price" : null,
        },
        share: 0.7,
        ratio: 6,
      };
  }
}
