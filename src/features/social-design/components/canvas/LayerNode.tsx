"use client";
// src/features/social-design/components/canvas/LayerNode.tsx
// Draws one layer on the canvas. Every layer is a Konva Group centred on its box
// (offset by half its size), so rotation and flips turn about the middle as the
// handles show. Children draw in the box's own 0..w, 0..h space. A see-through
// "hit-box" rect fills the box so thin shapes and gaps between words still pick up
// clicks, and the Transformer sizes its frame from it.

import { bulletsLayout, textSpec } from "@/features/social-design/components/canvas/text-layout";
import { useImage } from "@/features/social-design/components/canvas/use-image";
import { BACKDROP_BLURRED_SRC, FROSTED, hexOf, LOGOS } from "@/features/social-design/lib/brand";
import type {
  BackdropLayer,
  BoundValues,
  Geometry,
  ImageLayer,
  Layer,
} from "@/features/social-design/lib/doc";
import Konva from "konva";
import type React from "react";
import { useEffect, useRef } from "react";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KImage,
  Line,
  Path,
  Rect,
  Star,
  Text,
} from "react-konva";

// Two slab quote marks in a 102x80 box.
const QUOTE_PATH =
  "M0 80V48C0 22 14 6 40 0l6 12C32 18 26 28 26 40h18v40H0zM56 80V48c0-26 14-42 40-48l6 12c-14 6-20 16-20 28h18v40H56z";

/** Props shared by every layer renderer. */
interface DrawProps {
  w: number;
  h: number;
  shadow: Konva.ShapeConfig;
}

/**
 * Drop-shadow attributes for a layer's main shape, scaled to the picture.
 * @param on - Whether the layer has a shadow.
 * @param unit - The picture's shorter side over 1080.
 * @returns Shadow attributes, empty when off.
 */
function shadowOf(on: boolean, unit: number): Konva.ShapeConfig {
  if (!on) return {};
  return {
    shadowColor: FROSTED.shadow,
    shadowBlur: FROSTED.shadowBlur * unit,
    shadowOffsetY: FROSTED.shadowOffsetY * unit,
    shadowOpacity: 1,
  };
}

/**
 * Part of a photo to draw so it covers (or fits inside) a box, honouring the focus
 * point and zoom.
 * @param nw - Photo width.
 * @param nh - Photo height.
 * @param w - Box width.
 * @param h - Box height.
 * @param fit - Cover or contain.
 * @param focusX - Point kept in view across, 0-1.
 * @param focusY - Point kept in view down, 0-1.
 * @param zoom - 1 = just covers or fits.
 * @returns Source crop and where the photo draws in the box.
 */
function photoPlacement(
  nw: number,
  nh: number,
  w: number,
  h: number,
  fit: "cover" | "contain",
  focusX: number,
  focusY: number,
  zoom: number,
): {
  crop: { x: number; y: number; width: number; height: number };
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (fit === "contain") {
    const s = Math.min(w / nw, h / nh) * zoom;
    const width = nw * s;
    const height = nh * s;
    return {
      crop: { x: 0, y: 0, width: nw, height: nh },
      x: (w - width) / 2,
      y: (h - height) / 2,
      width,
      height,
    };
  }
  const s = Math.max(w / nw, h / nh) * zoom;
  const cw = w / s;
  const ch = h / s;
  const cx = Math.min(Math.max(focusX * nw - cw / 2, 0), nw - cw);
  const cy = Math.min(Math.max(focusY * nh - ch / 2, 0), nh - ch);
  return { crop: { x: cx, y: cy, width: cw, height: ch }, x: 0, y: 0, width: w, height: h };
}

/**
 * Konva image node that re-caches itself when its filters change, since Konva only
 * runs filters on a cached node.
 * @param props - Component props.
 * @param props.image - Loaded image.
 * @param props.filters - Filters to run, empty for none.
 * @param props.deps - Values that change what the filters produce.
 * @param props.config - Remaining Konva image attributes.
 * @returns Image node.
 */
function FilteredImage({
  image,
  filters,
  deps,
  config,
}: {
  image: HTMLImageElement;
  filters: Konva.Filter[];
  deps: string;
  config: Omit<Konva.ImageConfig, "image">;
}): React.ReactElement {
  const ref = useRef<Konva.Image>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (filters.length > 0) node.cache({ pixelRatio: 1 });
    else node.clearCache();
    node.getLayer()?.batchDraw();
    // deps carries every value the filters read; filters itself is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the change key for the filter inputs.
  }, [image, deps]);
  return <KImage ref={ref} image={image} filters={filters} {...config} />;
}

/**
 * A photo layer: cropped into its frame, with rounded corners or a circle mask.
 * @param props - Component props.
 * @param props.layer - Image layer.
 * @param props.w - Box width.
 * @param props.h - Box height.
 * @param props.shadow - Shadow attributes.
 * @returns Photo group.
 */
function Photo({ layer, w, h, shadow }: DrawProps & { layer: ImageLayer }): React.ReactElement {
  const img = useImage(layer.src);
  const radius = Math.min(layer.radius, w / 2, h / 2);
  /**
   * Draws the frame's outline for clipping.
   * @param ctx - Konva context.
   */
  const clip = (ctx: Konva.Context): void => {
    ctx.beginPath();
    if (layer.mask === "circle") ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(0, 0, w, h, radius);
    ctx.closePath();
  };
  const filters: Konva.Filter[] = [];
  if (layer.brightness !== 0) filters.push(Konva.Filters.Brighten);
  if (layer.contrast !== 0) filters.push(Konva.Filters.Contrast);
  if (layer.greyscale) filters.push(Konva.Filters.Grayscale);
  const place = img
    ? photoPlacement(
        img.naturalWidth,
        img.naturalHeight,
        w,
        h,
        layer.fit,
        layer.focusX,
        layer.focusY,
        layer.zoom,
      )
    : null;
  return (
    <>
      {/* A clip drops shadows, so the shadow comes from a shape behind the frame. */}
      {shadow.shadowColor &&
        (layer.mask === "circle" ? (
          <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} fill="#ffffff" {...shadow} />
        ) : (
          <Rect width={w} height={h} cornerRadius={radius} fill="#ffffff" {...shadow} />
        ))}
      <Group clipFunc={clip}>
        {img && place ? (
          <FilteredImage
            image={img}
            filters={filters}
            deps={`${layer.brightness}|${layer.contrast}|${layer.greyscale}|${w}|${h}|${layer.fit}|${layer.focusX}|${layer.focusY}|${layer.zoom}`}
            config={{
              ...place,
              brightness: layer.brightness,
              contrast: layer.contrast * 100,
            }}
          />
        ) : (
          <Rect width={w} height={h} fill={hexOf("seasalt-200")} />
        )}
      </Group>
    </>
  );
}

/**
 * A backdrop layer: the brand's pre-blurred backdrop, a blurred photo, a flat colour
 * or a two-colour gradient, with an optional light wash over it.
 * @param props - Component props.
 * @param props.layer - Backdrop layer.
 * @param props.w - Box width.
 * @param props.h - Box height.
 * @returns Backdrop shapes.
 */
function Backdrop({
  layer,
  w,
  h,
}: Omit<DrawProps, "shadow"> & { layer: BackdropLayer }): React.ReactElement {
  const src =
    layer.source === "brand" ? BACKDROP_BLURRED_SRC : layer.source === "photo" ? layer.src : null;
  const img = useImage(src);
  const place = img
    ? photoPlacement(img.naturalWidth, img.naturalHeight, w, h, "cover", 0.5, 0.5, 1)
    : null;
  const blur = layer.source === "photo" ? layer.blur * (w / 1080) : 0;
  return (
    <>
      {layer.source === "solid" && <Rect width={w} height={h} fill={hexOf(layer.colour)} />}
      {layer.source === "gradient" && (
        <Rect
          width={w}
          height={h}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: 0, y: h }}
          fillLinearGradientColorStops={[0, hexOf(layer.colour), 1, hexOf(layer.colour2)]}
        />
      )}
      {src &&
        (img && place ? (
          <FilteredImage
            image={img}
            filters={blur > 0 ? [Konva.Filters.Blur] : []}
            deps={`${blur}|${w}|${h}`}
            config={{ ...place, blurRadius: blur }}
          />
        ) : (
          <Rect width={w} height={h} fill={hexOf("seasalt")} />
        ))}
      {layer.wash > 0 && <Rect width={w} height={h} fill={hexOf("seasalt")} opacity={layer.wash} />}
    </>
  );
}

/**
 * A logo layer, drawn from the SVG in public/source.
 * @param props - Component props.
 * @param props.src - Logo file.
 * @param props.w - Box width.
 * @param props.h - Box height.
 * @param props.shadow - Shadow attributes.
 * @returns Logo image.
 */
function Logo({ src, w, h, shadow }: DrawProps & { src: string }): React.ReactElement | null {
  const img = useImage(src);
  return img ? <KImage image={img} width={w} height={h} {...shadow} /> : null;
}

/**
 * Placement of a layer's Group: centred on its box and offset by half its size, so
 * turns and flips happen about the middle.
 * @param layer - The layer.
 * @param g - Its geometry on the size drawn.
 * @returns Konva Group attributes.
 */
export function layerTransform(
  layer: Layer,
  g: Geometry,
): {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
} {
  return {
    x: g.x + g.w / 2,
    y: g.y + g.h / 2,
    offsetX: g.w / 2,
    offsetY: g.h / 2,
    rotation: g.rotation,
    scaleX: layer.flipX ? -1 : 1,
    scaleY: layer.flipY ? -1 : 1,
    opacity: layer.opacity,
    visible: !g.hidden,
  };
}

/**
 * The visual part of one layer, in its box's own space.
 * @param props - Component props.
 * @param props.layer - Layer to draw.
 * @param props.g - Its geometry on the size drawn.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.family - Font-family list.
 * @param props.unit - The picture's shorter side over 1080.
 * @param props.editing - Whether its words are open in the text box, so they hide here.
 * @returns Konva nodes.
 */
export function LayerVisual({
  layer,
  g,
  bound,
  family,
  unit,
  editing,
}: {
  layer: Layer;
  g: Geometry;
  bound: BoundValues;
  family: string;
  unit: number;
  editing: boolean;
}): React.ReactElement | null {
  const { w, h } = g;
  const shadow = shadowOf(layer.shadow, unit);
  switch (layer.type) {
    case "text":
    case "contact":
    case "promo": {
      const spec = textSpec(layer, g, bound, family);
      const fixedH = layer.type === "text" && layer.shrinkToFit;
      return (
        <>
          {layer.type === "text" && layer.highlight && (
            <Rect
              width={w}
              height={h}
              fill={hexOf(layer.highlight)}
              cornerRadius={spec.fontSize * 0.2}
              {...shadow}
            />
          )}
          <Text
            name="text-body"
            {...spec}
            fontFamily={family}
            wrap="word"
            height={fixedH ? h : undefined}
            verticalAlign={fixedH ? "middle" : "top"}
            opacity={editing ? 0 : 1}
            {...(layer.type === "text" && layer.highlight ? {} : shadow)}
          />
        </>
      );
    }
    case "bullets": {
      const lay = bulletsLayout(layer, g, family);
      const tick = lay.badge;
      return (
        <Group opacity={editing ? 0 : 1}>
          {lay.rows.map((row, i) => (
            <Group key={i} y={row.y}>
              <Circle
                x={tick / 2}
                y={row.badgeY + tick / 2}
                radius={tick / 2}
                fill={hexOf(layer.tick)}
                {...shadow}
              />
              <Line
                points={[
                  tick * 0.28,
                  row.badgeY + tick * 0.52,
                  tick * 0.44,
                  row.badgeY + tick * 0.68,
                  tick * 0.74,
                  row.badgeY + tick * 0.36,
                ]}
                stroke="#ffffff"
                strokeWidth={tick * 0.12}
                lineCap="round"
                lineJoin="round"
              />
              <Text name="text-body" x={lay.indent} {...row.spec} fontFamily={family} wrap="word" />
            </Group>
          ))}
        </Group>
      );
    }
    case "image":
      return <Photo layer={layer} w={w} h={h} shadow={shadow} />;
    case "logo":
      return <Logo src={LOGOS[layer.variant].src} w={w} h={h} shadow={shadow} />;
    case "backdrop":
      return <Backdrop layer={layer} w={w} h={h} />;
    case "frosted":
      return (
        <Rect
          width={w}
          height={h}
          cornerRadius={Math.min(layer.radius, w / 2, h / 2)}
          fill={FROSTED.fill}
          stroke={FROSTED.stroke}
          strokeWidth={FROSTED.strokeWidth * unit}
          {...shadow}
        />
      );
    case "shape": {
      const fill = layer.fill ? hexOf(layer.fill) : undefined;
      const stroke = layer.stroke ? hexOf(layer.stroke) : undefined;
      const sw = layer.strokeWidth;
      if (layer.shape === "rect") {
        return (
          <Rect
            width={w}
            height={h}
            cornerRadius={Math.min(layer.radius, w / 2, h / 2)}
            fill={fill}
            stroke={stroke}
            strokeWidth={stroke ? sw : 0}
            {...shadow}
          />
        );
      }
      if (layer.shape === "circle") {
        return (
          <Ellipse
            x={w / 2}
            y={h / 2}
            radiusX={w / 2}
            radiusY={h / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={stroke ? sw : 0}
            {...shadow}
          />
        );
      }
      const colour = stroke ?? fill ?? hexOf("russian-violet");
      const points = [sw, h / 2, w - sw, h / 2];
      return layer.shape === "arrow" ? (
        <Arrow
          points={points}
          stroke={colour}
          fill={colour}
          strokeWidth={sw}
          pointerLength={sw * 3}
          pointerWidth={sw * 3}
          lineCap="round"
          {...shadow}
        />
      ) : (
        <Line points={points} stroke={colour} strokeWidth={sw} lineCap="round" {...shadow} />
      );
    }
    case "stars": {
      const step = w / layer.count;
      const r = Math.min(h / 2, step / 2.2);
      return (
        <>
          {Array.from({ length: layer.count }, (_, i) => (
            <Star
              key={i}
              x={step * i + step / 2}
              y={h / 2}
              numPoints={5}
              innerRadius={r * 0.48}
              outerRadius={r}
              fill={hexOf(layer.colour)}
              lineJoin="round"
              {...shadow}
            />
          ))}
        </>
      );
    }
    case "quote-mark":
      return (
        <Path
          data={QUOTE_PATH}
          scaleX={w / 102}
          scaleY={h / 80}
          fill={hexOf(layer.colour)}
          {...shadow}
        />
      );
    case "qr":
    case "icon":
      // Drawn properly once the brand elements land; until then a marked placeholder.
      return (
        <Rect
          width={w}
          height={h}
          stroke={hexOf("seasalt-600")}
          strokeWidth={2 * unit}
          dash={[8 * unit, 6 * unit]}
        />
      );
  }
}
