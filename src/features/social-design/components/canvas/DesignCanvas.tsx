"use client";
// src/features/social-design/components/canvas/DesignCanvas.tsx
// The post maker's Konva artboard for one size: selection, handles, snapping, zoom, rulers and
// in-place text editing. Reports finished moves back to the editor as new geometry.

import { LayerVisual, layerTransform } from "@/features/social-design/components/canvas/LayerNode";
import type { AppCrop } from "@/features/social-design/lib/app-crops";
import { hexOf } from "@/features/social-design/lib/brand";
import {
  TEXT_LIKE,
  type BoundValues,
  type DesignDoc,
  type Geometry,
  type Layer,
} from "@/features/social-design/lib/doc";
import { unionBox, type Box } from "@/features/social-design/lib/editor-ops";
import { FORMATS, safeRect, type FormatKey } from "@/features/social-design/lib/formats";
import { TextArea } from "@/shared/components/TextArea";
import type Konva from "konva";
import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  Layer as KLayer,
  Label,
  Line,
  Rect,
  Stage,
  Tag,
  Text,
  Transformer,
} from "react-konva";

/** How far the editor is zoomed: fit to the space, or a fixed scale (1 = 100%). */
export type Zoom = "fit" | number;

/** One snapping guide line, in picture pixels. */
interface Guide {
  axis: "x" | "y";
  pos: number;
}

// Snap distance and ruler size in screen pixels.
const SNAP_PX = 6;
const RULER = 20;
// Space kept around the picture when zoomed to fit; less in the all-sizes grid.
const FIT_PAD = 48;
const COMPACT_PAD = 12;
// Margin guides sit this share of the shorter side in from each edge.
const MARGIN_SHARE = 0.06;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const SIDE_ANCHORS = new Set(["middle-left", "middle-right"]);
// Every 15 degrees, for Shift-rotate.
const FINE_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

/**
 * Text field placement over a layer being edited, in screen pixels.
 * @param g - Layer geometry.
 * @param scale - Current zoom.
 * @param pan - Picture's top-left on screen.
 * @param pan.x - Left.
 * @param pan.y - Top.
 * @returns CSS position and size.
 */
function overlayBox(
  g: Geometry,
  scale: number,
  pan: { x: number; y: number },
): React.CSSProperties {
  return {
    left: pan.x + g.x * scale,
    top: pan.y + g.y * scale,
    width: g.w * scale,
    minHeight: g.h * scale,
    transform: g.rotation ? `rotate(${g.rotation}deg)` : undefined,
  };
}

/**
 * Picks the smallest round ruler step leaving at least 50 screen pixels between labels.
 * @param scale - Current zoom.
 * @returns Step in picture pixels.
 */
function rulerStep(scale: number): number {
  return [10, 20, 50, 100, 200, 250, 500, 1000].find((s) => s * scale >= 50) ?? 1000;
}

/**
 * The design canvas.
 * @param props - Component props.
 * @param props.doc - Design.
 * @param props.format - Size on screen.
 * @param props.selected - Selected layer ids.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.family - Exo's font-family list.
 * @param props.zoom - Zoom setting.
 * @param props.lockRatio - Whether corner handles keep a layer's shape.
 * @param props.showGrid - Whether to draw the grid.
 * @param props.showGuides - Whether to draw margins and the safe area.
 * @param props.showRulers - Whether to draw rulers.
 * @param props.crops - App-crop boxes to outline, or none.
 * @param props.compact - Small all-sizes cell: less padding, wheel scrolls the page.
 * @param props.onSelect - Picks layers; `additive` toggles them into the selection.
 * @param props.onGeometry - A move, resize or rotate finished.
 * @param props.onText - In-place text editing finished with new words.
 * @param props.onZoom - Zoom changed by Ctrl+scroll, or the fit scale was worked out.
 * @returns Canvas element.
 */
export function DesignCanvas({
  doc,
  format,
  selected,
  bound,
  family,
  zoom,
  lockRatio,
  showGrid,
  showGuides,
  showRulers,
  crops = [],
  compact = false,
  onSelect,
  onGeometry,
  onText,
  onZoom,
}: {
  doc: DesignDoc;
  format: FormatKey;
  selected: string[];
  bound: BoundValues;
  family: string;
  zoom: Zoom;
  lockRatio: boolean;
  showGrid: boolean;
  showGuides: boolean;
  showRulers: boolean;
  crops?: AppCrop[];
  compact?: boolean;
  onSelect: (ids: string[], additive: boolean) => void;
  onGeometry: (changes: Record<string, Geometry>) => void;
  onText: (id: string, text: string) => void;
  onZoom: (scale: number, fit: boolean) => void;
}): React.ReactElement {
  const fmt = FORMATS[format];
  const W = fmt.width;
  const H = fmt.height;
  const unit = Math.min(W, H) / 1080;
  const layout = useMemo(() => doc.layouts[format] ?? {}, [doc.layouts, format]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [spaceDown, setSpaceDown] = useState(false);
  const [shiftDown, setShiftDown] = useState(false);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const panning = useRef<{ x: number; y: number } | null>(null);
  // Mirrors `panning` for the cursor, since a ref can't drive a render.
  const [grabbing, setGrabbing] = useState(false);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Keep the stage the size of its box.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (size.w === 0 || size.h === 0) return 0.3;
    const pad = (compact ? COMPACT_PAD : FIT_PAD) + (showRulers ? RULER : 0);
    return Math.max(MIN_ZOOM, Math.min((size.w - pad * 2) / W, (size.h - pad * 2) / H));
  }, [size, W, H, showRulers, compact]);
  const scale = zoom === "fit" ? fitScale : zoom;

  // Centre the picture whenever the zoom is set from the toolbar, the size changes or
  // the box resizes. Ctrl+scroll zoom moves the pan itself, keeping the pointer still.
  const zoomFromWheel = useRef(false);
  useLayoutEffect(() => {
    if (zoomFromWheel.current) {
      zoomFromWheel.current = false;
      return;
    }
    const off = showRulers ? RULER / 2 : 0;
    setPan({ x: (size.w - W * scale) / 2 + off, y: (size.h - H * scale) / 2 + off });
  }, [scale, size, W, H, showRulers]);

  useEffect(() => {
    if (zoom === "fit") onZoom(fitScale, true);
  }, [zoom, fitScale, onZoom]);

  // Space held = hand tool; Shift held = 15-degree rotation steps.
  useEffect(() => {
    /**
     * Tracks Space and Shift.
     * @param e - Keyboard event.
     */
    const handler = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable=true]");
      if (e.key === "Shift") setShiftDown(e.type === "keydown");
      if (e.code === "Space" && !typing) {
        if (e.type === "keydown") e.preventDefault();
        setSpaceDown(e.type === "keydown");
      }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", handler);
    };
  }, []);

  const layerMap = useMemo(() => new Map(doc.layers.map((l) => [l.id, l])), [doc.layers]);
  const movable = useMemo(
    () =>
      selected.filter((id) => {
        const l = layerMap.get(id);
        return l && !l.locked && layout[id] && !layout[id].hidden;
      }),
    [selected, layerMap, layout],
  );

  // Attach the handles to the selected, movable layers.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const attached = movable
      .filter((id) => id !== editing)
      .map((id) => nodes.current.get(id))
      .filter((n): n is Konva.Group => !!n);
    tr.nodes(attached);
    tr.getLayer()?.batchDraw();
  }, [movable, editing, doc]);

  const single = movable.length === 1 ? layerMap.get(movable[0] ?? "") : undefined;
  const singleText = single ? TEXT_LIKE.has(single.type) : false;
  const anchors = singleText
    ? ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right"]
    : single?.type === "logo" || single?.type === "stars"
      ? ["top-left", "top-right", "bottom-left", "bottom-right"]
      : undefined;
  const keepRatio =
    lockRatio ||
    movable.some((id) => {
      const t = layerMap.get(id)?.type;
      return t === "logo" || (t !== undefined && TEXT_LIKE.has(t));
    });

  /**
   * Turns a screen point into picture pixels.
   * @param p - Point on the stage.
   * @param p.x - Across.
   * @param p.y - Down.
   * @returns Point in picture pixels.
   */
  const toDesign = useCallback(
    (p: { x: number; y: number }) => ({ x: (p.x - pan.x) / scale, y: (p.y - pan.y) / scale }),
    [pan, scale],
  );

  /**
   * The layer id a canvas click landed on, or null for the background and locked layers.
   * @param target - Clicked Konva node.
   * @returns Layer id or null.
   */
  function layerAt(target: Konva.Node): string | null {
    const group = target.findAncestor(".layer", true) as Konva.Node | undefined;
    const id = group?.id();
    if (!id) return null;
    return layerMap.get(id)?.locked ? null : id;
  }

  /**
   * Press on the stage: start a pan, a marquee or pick a layer.
   * @param e - Konva pointer event.
   */
  function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!stage || !p) return;
    const button = "button" in e.evt ? e.evt.button : 0;
    if (spaceDown || button === 1) {
      panning.current = { x: p.x - pan.x, y: p.y - pan.y };
      setGrabbing(true);
      return;
    }
    if (e.target.findAncestor("Transformer", true)) return;
    const id = layerAt(e.target);
    const additive = e.evt.shiftKey;
    if (id) {
      if (additive || !selected.includes(id)) onSelect([id], additive);
      return;
    }
    if (!additive) onSelect([], false);
    marqueeStart.current = toDesign(p);
    setMarquee({ ...toDesign(p), w: 0, h: 0 });
  }

  /**
   * Pointer moves on the stage: pan or grow the marquee.
   * @param e - Konva pointer event.
   */
  function onPointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    const p = e.target.getStage()?.getPointerPosition();
    if (!p) return;
    if (panning.current) {
      setPan({ x: p.x - panning.current.x, y: p.y - panning.current.y });
      return;
    }
    const start = marqueeStart.current;
    if (!start) return;
    const q = toDesign(p);
    setMarquee({
      x: Math.min(start.x, q.x),
      y: Math.min(start.y, q.y),
      w: Math.abs(q.x - start.x),
      h: Math.abs(q.y - start.y),
    });
  }

  /**
   * Pointer released: finish a pan or select what the marquee touches.
   * @param e - Konva pointer event.
   */
  function onPointerUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    panning.current = null;
    setGrabbing(false);
    const box = marquee;
    marqueeStart.current = null;
    setMarquee(null);
    // A marquee smaller than a few screen pixels was a click on the background.
    if (!box || box.w * scale < 4 || box.h * scale < 4) return;
    const hits = doc.layers
      .filter((l) => {
        const g = layout[l.id];
        if (!g || g.hidden || l.locked) return false;
        return g.x < box.x + box.w && g.x + g.w > box.x && g.y < box.y + box.h && g.y + g.h > box.y;
      })
      .map((l) => l.id);
    if (hits.length > 0) onSelect(hits, e.evt.shiftKey);
  }

  /**
   * Ctrl+scroll zooms about the pointer; plain scroll pans.
   * @param e - Konva wheel event.
   */
  function onWheel(e: Konva.KonvaEventObject<WheelEvent>): void {
    if (compact) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    if (!p) return;
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, scale * (e.evt.deltaY < 0 ? 1.1 : 1 / 1.1)),
      );
      const at = toDesign(p);
      zoomFromWheel.current = true;
      setPan({ x: p.x - at.x * next, y: p.y - at.y * next });
      onZoom(next, false);
      return;
    }
    setPan((prev) => ({ x: prev.x - e.evt.deltaX, y: prev.y - e.evt.deltaY }));
  }

  /**
   * Snaps a dragged layer to the nearest edge, centre, margin, safe-area or layer line within
   * a few screen pixels, and records the lines hit for drawing.
   * @param e - Konva drag event.
   */
  function onDragMove(e: Konva.KonvaEventObject<DragEvent>): void {
    if (movable.length !== 1) return;
    const node = e.target;
    const id = node.id();
    const g = layout[id];
    if (!g) return;
    const x = node.x() - g.w / 2;
    const y = node.y() - g.h / 2;
    const m = Math.round(Math.min(W, H) * MARGIN_SHARE);
    const s = safeRect(format);
    const xs = [0, W / 2, W, m, W - m, s.x1, s.x2];
    const ys = [0, H / 2, H, m, H - m, s.y1, s.y2];
    for (const l of doc.layers) {
      const o = layout[l.id];
      if (l.id === id || !o || o.hidden || l.type === "backdrop") continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w);
      ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    const limit = SNAP_PX / scale;
    /**
     * Nearest guide to any of a box's three lines on one axis.
     * @param edges - The box's start, middle and end.
     * @param lines - Guide positions.
     * @returns Shift to apply and the guide hit, or null.
     */
    const best = (edges: number[], lines: number[]): { shift: number; pos: number } | null => {
      let hit: { shift: number; pos: number } | null = null;
      for (const edge of edges) {
        for (const line of lines) {
          const d = line - edge;
          if (Math.abs(d) <= limit && (!hit || Math.abs(d) < Math.abs(hit.shift))) {
            hit = { shift: d, pos: line };
          }
        }
      }
      return hit;
    };
    const bx = best([x, x + g.w / 2, x + g.w], xs);
    const by = best([y, y + g.h / 2, y + g.h], ys);
    if (bx) node.x(node.x() + bx.shift);
    if (by) node.y(node.y() + by.shift);
    const next: Guide[] = [];
    if (bx) next.push({ axis: "x", pos: bx.pos });
    if (by) next.push({ axis: "y", pos: by.pos });
    setGuides(next);
  }

  /** A drag finished: report every moved layer's new place. */
  function onDragEnd(): void {
    setGuides([]);
    const changes: Record<string, Geometry> = {};
    for (const id of movable) {
      const node = nodes.current.get(id);
      const g = layout[id];
      if (!node || !g) continue;
      changes[id] = { ...g, x: node.x() - g.w / 2, y: node.y() - g.h / 2 };
    }
    onGeometry(changes);
  }

  /**
   * Re-wraps a text box dragged by a side handle at the new width instead of stretching it.
   */
  function onTransform(): void {
    const tr = trRef.current;
    if (!tr || !singleText || !SIDE_ANCHORS.has(tr.getActiveAnchor() ?? "")) return;
    const node = tr.nodes()[0] as Konva.Group | undefined;
    if (!node) return;
    const sx = node.scaleX();
    const w = Math.max(20, node.offsetX() * 2 * Math.abs(sx));
    node.offsetX(w / 2);
    node.scaleX(Math.sign(sx) || 1);
    // Bullet rows start after their tick badge, so each keeps its own indent.
    for (const child of node.find(".text-body")) child.width(Math.max(10, w - child.x()));
    for (const child of node.find(".hit-box")) child.width(w);
  }

  /** A resize or turn finished: fold the handles' scale into each layer's size. */
  function onTransformEnd(): void {
    const tr = trRef.current;
    // Text grows its font only from a corner; a side handle just re-wraps it.
    const corner = !SIDE_ANCHORS.has(tr?.getActiveAnchor() ?? "");
    const changes: Record<string, Geometry> = {};
    for (const id of movable) {
      const node = nodes.current.get(id);
      const g = layout[id];
      const layer = layerMap.get(id);
      if (!node || !g || !layer) continue;
      const sx = Math.abs(node.scaleX());
      const sy = Math.abs(node.scaleY());
      const w = Math.max(1, node.offsetX() * 2 * sx);
      const h = Math.max(1, node.offsetY() * 2 * sy);
      let rotation = node.rotation() % 360;
      if (rotation > 180) rotation -= 360;
      if (rotation < -180) rotation += 360;
      const next: Geometry = { ...g, x: node.x() - w / 2, y: node.y() - h / 2, w, h, rotation };
      if (TEXT_LIKE.has(layer.type) && g.fontSize !== undefined && corner) {
        next.fontSize = Math.max(4, g.fontSize * sy);
      }
      node.scale({ x: layer.flipX ? -1 : 1, y: layer.flipY ? -1 : 1 });
      changes[id] = next;
    }
    onGeometry(changes);
  }

  /**
   * Opens a layer's words in the text box on a double-click.
   * @param id - Layer id.
   */
  function startEditing(id: string): void {
    const layer = layerMap.get(id);
    if (!layer || layer.locked) return;
    if (layer.type === "text") setDraft(layer.text);
    else if (layer.type === "bullets") setDraft(layer.items.join("\n"));
    else return;
    setEditing(id);
  }

  /** Closes the text box, keeping what was typed. */
  function finishEditing(): void {
    if (editing) onText(editing, draft);
    setEditing(null);
  }

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  // Grow the text box with its words.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing, scale]);

  const editLayer = editing ? layerMap.get(editing) : undefined;
  const editG = editing ? layout[editing] : undefined;
  const editStyle: React.CSSProperties | null =
    editLayer && editG
      ? editLayer.type === "text"
        ? {
            ...overlayBox(editG, scale, pan),
            fontFamily: family,
            fontSize: (editG.fontSize ?? 40) * scale,
            fontWeight: editLayer.weight,
            fontStyle: editLayer.italic ? "italic" : "normal",
            lineHeight: editLayer.lineHeight,
            textAlign: editLayer.align,
            color: hexOf(editLayer.colour),
            padding: editLayer.highlight ? (editG.fontSize ?? 40) * 0.18 * scale : 0,
          }
        : {
            ...overlayBox(editG, scale, pan),
            fontFamily: family,
            fontSize: (editG.fontSize ?? 40) * scale,
            fontWeight: 500,
            lineHeight: 1.6,
            color: hexOf("russian-violet"),
            background: "rgba(255,255,255,0.92)",
          }
      : null;

  const safe = safeRect(format);
  const step = rulerStep(scale);
  const gridStep = Math.round(Math.min(W, H) / 12);
  const margin = Math.round(Math.min(W, H) * MARGIN_SHARE);

  return (
    <div
      ref={wrapRef}
      className="relative size-full overflow-hidden"
      style={{ cursor: spaceDown ? (grabbing ? "grabbing" : "grab") : "default" }}
    >
      {size.w > 0 && (
        <Stage
          width={size.w}
          height={size.h}
          onMouseDown={onPointerDown}
          onTouchStart={onPointerDown}
          onMouseMove={onPointerMove}
          onTouchMove={onPointerMove}
          onMouseUp={onPointerUp}
          onTouchEnd={onPointerUp}
          onWheel={onWheel}
        >
          <KLayer>
            <Group x={pan.x} y={pan.y} scaleX={scale} scaleY={scale}>
              {/* The artboard: white under a transparent design, with a soft edge. */}
              <Rect
                width={W}
                height={H}
                fill="#ffffff"
                shadowColor="rgba(12,10,62,0.25)"
                shadowBlur={24 / scale}
                shadowOffsetY={4 / scale}
              />
              <Group clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
                {doc.layers.map((layer: Layer) => {
                  const g = layout[layer.id];
                  if (!g) return null;
                  return (
                    <Group
                      key={layer.id}
                      id={layer.id}
                      name="layer"
                      ref={(n) => {
                        if (n) nodes.current.set(layer.id, n);
                        else nodes.current.delete(layer.id);
                      }}
                      {...layerTransform(layer, g, doc.paidAd)}
                      draggable={!layer.locked && !spaceDown && editing !== layer.id}
                      onDragMove={onDragMove}
                      onDragEnd={onDragEnd}
                      onDblClick={() => startEditing(layer.id)}
                      onDblTap={() => startEditing(layer.id)}
                    >
                      <Rect name="hit-box" width={g.w} height={g.h} fill="rgba(0,0,0,0)" />
                      <LayerVisual
                        layer={layer}
                        g={g}
                        bound={bound}
                        family={family}
                        unit={unit}
                        editing={editing === layer.id}
                      />
                    </Group>
                  );
                })}
              </Group>
            </Group>
            <Transformer
              ref={trRef}
              rotationSnaps={shiftDown ? FINE_SNAPS : [0, 90, 180, 270]}
              rotationSnapTolerance={shiftDown ? 7.5 : 4}
              keepRatio={keepRatio}
              enabledAnchors={anchors}
              flipEnabled={false}
              borderStroke={hexOf("moonstone-600")}
              anchorStroke={hexOf("moonstone-600")}
              anchorFill="#ffffff"
              anchorSize={10}
              anchorCornerRadius={5}
              rotateAnchorOffset={28}
              boundBoxFunc={(oldBox, newBox) =>
                Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox
              }
              onTransform={onTransform}
              onTransformEnd={onTransformEnd}
            />
          </KLayer>

          <KLayer listening={false}>
            <Group x={pan.x} y={pan.y} scaleX={scale} scaleY={scale}>
              {showGrid && (
                <>
                  {Array.from({ length: Math.floor(W / gridStep) }, (_, i) => (
                    <Line
                      key={`gx${i}`}
                      points={[(i + 1) * gridStep, 0, (i + 1) * gridStep, H]}
                      stroke={hexOf("moonstone")}
                      opacity={0.35}
                      strokeWidth={1 / scale}
                    />
                  ))}
                  {Array.from({ length: Math.floor(H / gridStep) }, (_, i) => (
                    <Line
                      key={`gy${i}`}
                      points={[0, (i + 1) * gridStep, W, (i + 1) * gridStep]}
                      stroke={hexOf("moonstone")}
                      opacity={0.35}
                      strokeWidth={1 / scale}
                    />
                  ))}
                </>
              )}
              {showGuides && (
                <>
                  <Rect
                    x={margin}
                    y={margin}
                    width={W - margin * 2}
                    height={H - margin * 2}
                    stroke={hexOf("moonstone-600")}
                    strokeWidth={1 / scale}
                    dash={[6 / scale, 4 / scale]}
                  />
                  {(safe.x1 > 0 || safe.y1 > 0 || safe.x2 < W || safe.y2 < H) && (
                    <Rect
                      x={safe.x1}
                      y={safe.y1}
                      width={safe.x2 - safe.x1}
                      height={safe.y2 - safe.y1}
                      stroke={hexOf("coquelicot")}
                      strokeWidth={2 / scale}
                      dash={[10 / scale, 6 / scale]}
                    />
                  )}
                  {fmt.safeZone?.circle && (
                    <Rect
                      width={W}
                      height={H}
                      cornerRadius={W / 2}
                      stroke={hexOf("coquelicot")}
                      strokeWidth={2 / scale}
                      dash={[10 / scale, 6 / scale]}
                    />
                  )}
                </>
              )}
              {crops.map((c) => (
                <Group key={c.label}>
                  <Rect
                    x={c.x}
                    y={c.y}
                    width={c.w}
                    height={c.h}
                    stroke={hexOf("russian-violet")}
                    strokeWidth={2 / scale}
                    dash={[4 / scale, 4 / scale]}
                  />
                  <Label x={c.x + 6 / scale} y={c.y + 6 / scale}>
                    <Tag fill={hexOf("russian-violet")} cornerRadius={3 / scale} />
                    <Text
                      text={`${c.label} shows this`}
                      fontSize={12 / scale}
                      fontStyle="bold"
                      padding={4 / scale}
                      fill="#ffffff"
                    />
                  </Label>
                </Group>
              ))}
              {guides.map((gd, i) =>
                gd.axis === "x" ? (
                  <Line
                    key={i}
                    points={[gd.pos, -H, gd.pos, H * 2]}
                    stroke={hexOf("coquelicot")}
                    strokeWidth={1 / scale}
                  />
                ) : (
                  <Line
                    key={i}
                    points={[-W, gd.pos, W * 2, gd.pos]}
                    stroke={hexOf("coquelicot")}
                    strokeWidth={1 / scale}
                  />
                ),
              )}
              {marquee && (
                <Rect
                  {...{ x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h }}
                  fill="rgba(67,188,205,0.12)"
                  stroke={hexOf("moonstone-600")}
                  strokeWidth={1 / scale}
                />
              )}
              {/* Faint outline of every selected locked layer, which has no handles. */}
              {(() => {
                const locked = selected.filter((id) => layerMap.get(id)?.locked && layout[id]);
                const box = unionBox(locked.flatMap((id) => (layout[id] ? [layout[id]] : [])));
                return box ? (
                  <Rect
                    x={box.x}
                    y={box.y}
                    width={box.w}
                    height={box.h}
                    stroke={hexOf("seasalt-600")}
                    strokeWidth={2 / scale}
                    dash={[8 / scale, 6 / scale]}
                  />
                ) : null;
              })()}
            </Group>
            {showRulers && (
              <>
                <Rect width={size.w} height={RULER} fill="rgba(246,247,248,0.95)" />
                <Rect width={RULER} height={size.h} fill="rgba(246,247,248,0.95)" />
                {Array.from({ length: Math.ceil(W / step) + 1 }, (_, i) => {
                  const x = pan.x + i * step * scale;
                  return (
                    <Group key={`rx${i}`}>
                      <Line
                        points={[x, RULER - 6, x, RULER]}
                        stroke={hexOf("seasalt-600")}
                        strokeWidth={1}
                      />
                      <Text
                        x={x + 2}
                        y={3}
                        text={String(i * step)}
                        fontSize={10}
                        fill={hexOf("seasalt-600")}
                      />
                    </Group>
                  );
                })}
                {Array.from({ length: Math.ceil(H / step) + 1 }, (_, i) => {
                  const y = pan.y + i * step * scale;
                  return (
                    <Group key={`ry${i}`}>
                      <Line
                        points={[RULER - 6, y, RULER, y]}
                        stroke={hexOf("seasalt-600")}
                        strokeWidth={1}
                      />
                      <Text
                        x={3}
                        y={y + 12}
                        rotation={-90}
                        text={String(i * step)}
                        fontSize={10}
                        fill={hexOf("seasalt-600")}
                      />
                    </Group>
                  );
                })}
                <Rect width={RULER} height={RULER} fill={hexOf("seasalt-200")} />
              </>
            )}
          </KLayer>
        </Stage>
      )}

      {editing && editStyle && (
        <TextArea
          ref={textRef}
          aria-label={editLayer?.type === "bullets" ? "Bullet points, one per line" : "Text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finishEditing}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              finishEditing();
            }
          }}
          className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-2 outline-moonstone-600 outline-dashed"
          style={{ ...editStyle, transformOrigin: "50% 50%" }}
        />
      )}
    </div>
  );
}
