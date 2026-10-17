"use client";
// src/features/social-design/components/canvas/DesignPreview.tsx
// A still drawing of one size of a design, with nothing to click: small for the size
// tabs, and at full size off screen for the exported pictures. Same renderers as the
// canvas, so a picture matches what the editor showed.

import { LayerVisual, layerTransform } from "@/features/social-design/components/canvas/LayerNode";
import type { BoundValues, DesignDoc } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import type Konva from "konva";
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
 * @param props.transparent - Leave out the white ground, for a PNG with see-through gaps.
 * @param props.stageRef - Receives the Konva stage, for exporting.
 * @returns Preview element.
 */
export function DesignPreview({
  doc,
  format,
  bound,
  family,
  height,
  transparent = false,
  stageRef,
}: {
  doc: DesignDoc;
  format: FormatKey;
  bound: BoundValues;
  family: string;
  height: number;
  transparent?: boolean;
  stageRef?: React.Ref<Konva.Stage>;
}): React.ReactElement {
  const { width: W, height: H } = FORMATS[format];
  const scale = height / H;
  const unit = Math.min(W, H) / 1080;
  const layout = doc.layouts[format] ?? {};
  return (
    <Stage ref={stageRef} width={Math.round(W * scale)} height={height} listening={false}>
      <KLayer listening={false}>
        <Group scaleX={scale} scaleY={scale} clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
          {!transparent && <Rect width={W} height={H} fill="#ffffff" />}
          {doc.layers.map((layer) => {
            const g = layout[layer.id];
            if (!g || g.hidden) return null;
            return (
              <Group key={layer.id} {...layerTransform(layer, g, doc.paidAd)}>
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
