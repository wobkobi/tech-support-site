"use client";
// src/features/social-design/components/canvas/DesignPreview.tsx
// A small still drawing of one size of a design, for the size tabs. Same renderers as
// the canvas, scaled to a fixed height, with nothing to click.

import { LayerVisual, layerTransform } from "@/features/social-design/components/canvas/LayerNode";
import type { BoundValues, DesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import type React from "react";
import { Group, Layer as KLayer, Rect, Stage } from "react-konva";

/**
 * Still preview of one size.
 * @param props - Component props.
 * @param props.doc - Design.
 * @param props.format - Size to draw.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.family - Exo's font-family list.
 * @param props.height - Height in screen pixels; the width follows the size's shape.
 * @returns Preview element.
 */
export function DesignPreview({
  doc,
  format,
  bound,
  family,
  height,
}: {
  doc: DesignDoc;
  format: FormatKey;
  bound: BoundValues;
  family: string;
  height: number;
}): React.ReactElement {
  const { width: W, height: H } = FORMATS[format];
  const scale = height / H;
  const unit = Math.min(W, H) / 1080;
  const layout = doc.layouts[format] ?? {};
  return (
    <Stage width={Math.round(W * scale)} height={height} listening={false}>
      <KLayer listening={false}>
        <Group scaleX={scale} scaleY={scale} clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
          <Rect width={W} height={H} fill="#ffffff" />
          {doc.layers.map((layer) => {
            const g = layout[layer.id];
            if (!g || g.hidden) return null;
            return (
              <Group key={layer.id} {...layerTransform(layer, g)}>
                <LayerVisual
                  layer={layer}
                  g={g}
                  bound={bound}
                  family={family}
                  unit={unit}
                  editing={false}
                />
              </Group>
            );
          })}
        </Group>
      </KLayer>
    </Stage>
  );
}
