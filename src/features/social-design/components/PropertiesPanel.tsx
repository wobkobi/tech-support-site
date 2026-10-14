"use client";
// src/features/social-design/components/PropertiesPanel.tsx
// The post maker's right-hand panel: arrange tools (align, centre, spread, stack order,
// flip, group), exact position and size, the layer's look, and the controls for its
// type. Shows design-wide help when nothing is selected.

import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import {
  Check,
  IconButton,
  NumField,
  Section,
  Segmented,
  Slider,
  SwatchPicker,
} from "@/features/social-design/components/editor-fields";
import {
  LOGOS,
  TEXT_PRESET_KEYS,
  TEXT_PRESETS,
  type LogoVariant,
  type TextPreset,
} from "@/features/social-design/lib/brand";
import {
  TEXT_LIKE,
  type BackdropLayer,
  type ContactField,
  type DesignDoc,
  type Geometry,
  type Layer,
  type PromoField,
} from "@/features/social-design/lib/doc";
import {
  alignLayers,
  applyTextPreset,
  distributeLayers,
  layerById,
  restack,
  setGeometry,
  updateLayers,
  type EditScope,
  type StackMove,
} from "@/features/social-design/lib/editor-ops";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import type { AlignTo } from "@/features/social-design/lib/layout";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import {
  FaAnglesDown,
  FaAnglesUp,
  FaArrowDown,
  FaArrowUp,
  FaCopy,
  FaLock,
  FaLockOpen,
  FaObjectGroup,
  FaObjectUngroup,
  FaPaintbrush,
  FaPaste,
  FaTrash,
} from "react-icons/fa6";
import {
  MdAlignHorizontalCenter,
  MdAlignHorizontalLeft,
  MdAlignHorizontalRight,
  MdAlignVerticalBottom,
  MdAlignVerticalCenter,
  MdAlignVerticalTop,
  MdCenterFocusStrong,
  MdFlip,
  MdHorizontalDistribute,
  MdVerticalDistribute,
} from "react-icons/md";

/** What the panel can ask the editor to do beyond plain edits. */
export interface PanelActions {
  duplicate: () => void;
  remove: () => void;
  group: () => void;
  ungroup: () => void;
  copyStyle: () => void;
  pasteStyle: () => void;
  canPasteStyle: boolean;
  /** Opens the file picker to replace a photo layer's or photo backdrop's picture. */
  replacePhoto: (id: string) => void;
  canUpload: boolean;
}

const ALIGNS: { how: AlignTo; label: string; icon: React.ReactNode }[] = [
  {
    how: "left",
    label: "Align left",
    icon: <MdAlignHorizontalLeft aria-hidden className="size-4" />,
  },
  {
    how: "centre-x",
    label: "Centre across",
    icon: <MdAlignHorizontalCenter aria-hidden className="size-4" />,
  },
  {
    how: "right",
    label: "Align right",
    icon: <MdAlignHorizontalRight aria-hidden className="size-4" />,
  },
  { how: "top", label: "Align top", icon: <MdAlignVerticalTop aria-hidden className="size-4" /> },
  {
    how: "centre-y",
    label: "Centre up and down",
    icon: <MdAlignVerticalCenter aria-hidden className="size-4" />,
  },
  {
    how: "bottom",
    label: "Align bottom",
    icon: <MdAlignVerticalBottom aria-hidden className="size-4" />,
  },
];

const STACK: { how: StackMove; label: string; icon: React.ReactNode }[] = [
  {
    how: "front",
    label: "Bring to front (Ctrl+Shift+])",
    icon: <FaAnglesUp aria-hidden className="size-3.5" />,
  },
  {
    how: "forward",
    label: "Bring forward (Ctrl+])",
    icon: <FaArrowUp aria-hidden className="size-3.5" />,
  },
  {
    how: "backward",
    label: "Send backward (Ctrl+[)",
    icon: <FaArrowDown aria-hidden className="size-3.5" />,
  },
  {
    how: "back",
    label: "Send to back (Ctrl+Shift+[)",
    icon: <FaAnglesDown aria-hidden className="size-3.5" />,
  },
];

const WEIGHTS = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra bold" },
];

const CONTACT_LABEL: Record<ContactField, string> = {
  phone: "Phone number",
  email: "Email address",
  website: "Website",
};

const PROMO_LABEL: Record<PromoField, string> = {
  offer: "What the deal is",
  ends: "When it ends",
  summary: "Summary (deal and end date)",
};

/**
 * Properties panel.
 * @param props - Component props.
 * @param props.doc - Design.
 * @param props.format - Size on screen.
 * @param props.selected - Selected layer ids.
 * @param props.scope - Which sizes geometry edits reach.
 * @param props.apply - Runs an edit as an undo step.
 * @param props.actions - Editor actions beyond plain edits.
 * @returns Panel element.
 */
export function PropertiesPanel({
  doc,
  format,
  selected,
  scope,
  apply,
  actions,
}: {
  doc: DesignDoc;
  format: FormatKey;
  selected: string[];
  scope: EditScope;
  apply: (edit: (doc: DesignDoc) => DesignDoc, tag?: string) => void;
  actions: PanelActions;
}): React.ReactElement {
  const layers = selected.flatMap((id) => {
    const l = layerById(doc, id);
    return l ? [l] : [];
  });
  const layer = layers.length === 1 ? layers[0] : undefined;
  const g = layer ? doc.layouts[format]?.[layer.id] : undefined;

  if (layers.length === 0) return <NothingSelected format={format} />;

  /**
   * Patches every selected layer.
   * @param fields - Fields to change.
   * @param tag - Merge key for undo, for sliders and typing.
   */
  const patch = (fields: Partial<Layer>, tag?: string): void => {
    apply((d) => updateLayers(d, selected, () => fields), tag);
  };

  /**
   * Writes new geometry for the single selected layer.
   * @param next - Fields to change.
   * @param tag - Merge key for undo.
   */
  const setG = (next: Partial<Geometry>, tag: string): void => {
    if (!layer || !g) return;
    apply((d) => setGeometry(d, format, { [layer.id]: { ...g, ...next } }, scope), tag);
  };

  const grouped = layers.some((l) => l.groupId);
  const allLocked = layers.every((l) => l.locked);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-3">
        <p className="min-w-0 truncate font-semibold text-admin-text">
          {layer ? layer.name : `${layers.length} layers`}
        </p>
        <div className="flex shrink-0 gap-1">
          <IconButton
            label={allLocked ? "Unlock" : "Lock"}
            active={allLocked}
            onClick={() => patch({ locked: !allLocked })}
          >
            {allLocked ? (
              <FaLock aria-hidden className="size-3.5" />
            ) : (
              <FaLockOpen aria-hidden className="size-3.5" />
            )}
          </IconButton>
          <IconButton label="Duplicate (Ctrl+D)" onClick={actions.duplicate}>
            <FaCopy aria-hidden className="size-3.5" />
          </IconButton>
          <IconButton label="Delete (Delete key)" onClick={actions.remove}>
            <FaTrash aria-hidden className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <Section title={layers.length > 1 ? "Arrange (to each other)" : "Arrange (on the picture)"}>
        <div className="flex flex-wrap gap-1">
          {ALIGNS.map((a) => (
            <IconButton
              key={a.how}
              label={a.label}
              disabled={allLocked}
              onClick={() => apply((d) => alignLayers(d, format, selected, a.how, scope))}
            >
              {a.icon}
            </IconButton>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            disabled={allLocked}
            onClick={() => apply((d) => alignLayers(d, format, selected, "centre", scope, true))}
            className="flex h-8 items-center gap-1.5 rounded-md border border-admin-border bg-admin-surface px-2 text-sm text-admin-text hover:bg-admin-bg disabled:opacity-40"
          >
            <MdCenterFocusStrong aria-hidden className="size-4" />
            Centre on picture
          </button>
          {layers.length >= 3 && (
            <>
              <IconButton
                label="Space evenly across"
                onClick={() => apply((d) => distributeLayers(d, format, selected, "x", scope))}
              >
                <MdHorizontalDistribute aria-hidden className="size-4" />
              </IconButton>
              <IconButton
                label="Space evenly up and down"
                onClick={() => apply((d) => distributeLayers(d, format, selected, "y", scope))}
              >
                <MdVerticalDistribute aria-hidden className="size-4" />
              </IconButton>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {STACK.map((s) => (
            <IconButton
              key={s.how}
              label={s.label}
              onClick={() => apply((d) => restack(d, selected, s.how))}
            >
              {s.icon}
            </IconButton>
          ))}
          <IconButton
            label="Flip across"
            active={layer?.flipX}
            onClick={() => apply((d) => updateLayers(d, selected, (l) => ({ flipX: !l.flipX })))}
          >
            <MdFlip aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            label="Flip upside down"
            active={layer?.flipY}
            onClick={() => apply((d) => updateLayers(d, selected, (l) => ({ flipY: !l.flipY })))}
          >
            <MdFlip aria-hidden className="size-4 rotate-90" />
          </IconButton>
          {layers.length > 1 && (
            <IconButton label="Group (Ctrl+G)" onClick={actions.group}>
              <FaObjectGroup aria-hidden className="size-3.5" />
            </IconButton>
          )}
          {grouped && (
            <IconButton label="Ungroup (Ctrl+Shift+G)" onClick={actions.ungroup}>
              <FaObjectUngroup aria-hidden className="size-3.5" />
            </IconButton>
          )}
        </div>
      </Section>

      {layer && g && (
        <Section title={`Position on ${FORMATS[format].label}`}>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={g.x} onChange={(x) => setG({ x }, "geo-x")} />
            <NumField label="Y" value={g.y} onChange={(y) => setG({ y }, "geo-y")} />
            <NumField label="Width" value={g.w} min={1} onChange={(w) => setG({ w }, "geo-w")} />
            {TEXT_LIKE.has(layer.type) && !(layer.type === "text" && layer.shrinkToFit) ? (
              <NumField
                label="Text size"
                value={g.fontSize ?? 40}
                min={4}
                max={1000}
                onChange={(fontSize) => setG({ fontSize }, "geo-font")}
              />
            ) : (
              <NumField label="Height" value={g.h} min={1} onChange={(h) => setG({ h }, "geo-h")} />
            )}
            <NumField
              label="Turn (degrees)"
              value={g.rotation}
              min={-180}
              max={180}
              onChange={(rotation) => setG({ rotation }, "geo-rot")}
            />
          </div>
        </Section>
      )}

      <Section title="Look">
        <Slider
          label="Opacity"
          value={layer?.opacity ?? 1}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(opacity) => patch({ opacity }, "opacity")}
        />
        <Check
          label="Drop shadow"
          checked={layers.every((l) => l.shadow)}
          onChange={(shadow) => patch({ shadow })}
        />
        {layer && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={actions.copyStyle}
              className="flex h-8 items-center gap-1.5 rounded-md border border-admin-border bg-admin-surface px-2 text-sm hover:bg-admin-bg"
            >
              <FaPaintbrush aria-hidden className="size-3" /> Copy style
            </button>
            <button
              type="button"
              onClick={actions.pasteStyle}
              disabled={!actions.canPasteStyle}
              className="flex h-8 items-center gap-1.5 rounded-md border border-admin-border bg-admin-surface px-2 text-sm hover:bg-admin-bg disabled:opacity-40"
            >
              <FaPaste aria-hidden className="size-3" /> Paste style
            </button>
          </div>
        )}
      </Section>

      {layer && g && (
        <TypeFields
          layer={layer}
          g={g}
          format={format}
          apply={apply}
          patch={patch}
          actions={actions}
        />
      )}
    </div>
  );
}

/**
 * Help shown with nothing selected.
 * @param props - Component props.
 * @param props.format - Size on screen.
 * @returns Help element.
 */
function NothingSelected({ format }: { format: FormatKey }): React.ReactElement {
  const f = FORMATS[format];
  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-sm text-admin-text-secondary">
      <p className="font-semibold text-admin-text">
        {f.label} · {f.width} × {f.height}
      </p>
      <p>{f.usedFor}.</p>
      <p>
        Click something on the picture to change it, or drag across the picture to pick several.
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-4">
        <li>Double-click words to type straight onto the picture.</li>
        <li>Hold Shift while turning to snap to 15° steps.</li>
        <li>Hold Space and drag to move around; Ctrl and scroll to zoom.</li>
        <li>Arrow keys nudge by 1px, with Shift by 10px.</li>
      </ul>
    </div>
  );
}

/**
 * Controls for one layer's type.
 * @param props - Component props.
 * @param props.layer - The layer.
 * @param props.g - Its geometry on the size on screen.
 * @param props.format - Size on screen.
 * @param props.apply - Runs an edit as an undo step.
 * @param props.patch - Patches the layer.
 * @param props.actions - Editor actions.
 * @returns Type section, or null for types with nothing extra.
 */
function TypeFields({
  layer,
  g,
  format,
  apply,
  patch,
  actions,
}: {
  layer: Layer;
  g: Geometry;
  format: FormatKey;
  apply: (edit: (doc: DesignDoc) => DesignDoc, tag?: string) => void;
  patch: (fields: Partial<Layer>, tag?: string) => void;
  actions: PanelActions;
}): React.ReactElement | null {
  switch (layer.type) {
    case "text":
      return (
        <Section title="Text">
          <textarea
            aria-label="Words"
            rows={3}
            value={layer.text}
            onChange={(e) => patch({ text: e.target.value }, `text-${layer.id}`)}
            className={cn(ADMIN_INPUT_CLS, "resize-y")}
          />
          <label className="flex flex-col gap-0.5 text-sm text-admin-text-secondary">
            Style
            <select
              value={layer.preset}
              onChange={(e) =>
                apply((d) => applyTextPreset(d, layer.id, e.target.value as TextPreset))
              }
              className={cn(ADMIN_INPUT_CLS, "py-1")}
            >
              {TEXT_PRESET_KEYS.map((k) => (
                <option key={k} value={k}>
                  {TEXT_PRESETS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-sm text-admin-text-secondary">
            Weight
            <select
              value={String(layer.weight)}
              onChange={(e) => patch({ weight: Number(e.target.value) })}
              className={cn(ADMIN_INPUT_CLS, "py-1")}
            >
              {WEIGHTS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <Segmented
            label="Line up"
            value={layer.align}
            onChange={(align) => patch({ align })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Centre" },
              { value: "right", label: "Right" },
            ]}
          />
          <SwatchPicker
            label="Colour"
            value={layer.colour}
            onChange={(c) => c && patch({ colour: c })}
          />
          <SwatchPicker
            label="Highlight behind"
            allowNone
            value={layer.highlight}
            onChange={(highlight) => patch({ highlight })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Line spacing"
              value={layer.lineHeight}
              min={0.6}
              max={3}
              step={0.05}
              decimals={2}
              onChange={(lineHeight) => patch({ lineHeight }, "line-height")}
            />
            <NumField
              label="Letter spacing"
              value={layer.letterSpacing}
              min={-20}
              max={40}
              step={0.5}
              decimals={1}
              onChange={(letterSpacing) => patch({ letterSpacing }, "tracking")}
            />
          </div>
          <Check label="Italic" checked={layer.italic} onChange={(italic) => patch({ italic })} />
          <Check
            label="Shrink to fit the box"
            checked={layer.shrinkToFit}
            onChange={(shrinkToFit) => patch({ shrinkToFit })}
          />
        </Section>
      );
    case "bullets":
      return (
        <Section title="Bullet list">
          <label className="flex flex-col gap-0.5 text-sm text-admin-text-secondary">
            Points, one per line (up to 8)
            <textarea
              rows={4}
              value={layer.items.join("\n")}
              onChange={(e) =>
                patch({ items: e.target.value.split("\n").slice(0, 8) }, `items-${layer.id}`)
              }
              className={cn(ADMIN_INPUT_CLS, "resize-y")}
            />
          </label>
          <SwatchPicker
            label="Words"
            value={layer.colour}
            onChange={(c) => c && patch({ colour: c })}
          />
          <SwatchPicker
            label="Tick badges"
            value={layer.tick}
            onChange={(c) => c && patch({ tick: c })}
          />
        </Section>
      );
    case "image":
      return (
        <Section title="Photo">
          <button
            type="button"
            disabled={!actions.canUpload}
            onClick={() => actions.replacePhoto(layer.id)}
            className="h-8 rounded-md border border-admin-border bg-admin-surface px-2 text-sm hover:bg-admin-bg disabled:opacity-40"
          >
            Replace photo
          </button>
          <Segmented
            label="Fill the frame"
            value={layer.fit}
            onChange={(fit) => patch({ fit })}
            options={[
              { value: "cover", label: "Fill (crop)" },
              { value: "contain", label: "Fit (whole photo)" },
            ]}
          />
          <Slider
            label="Zoom"
            value={layer.zoom}
            min={1}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(zoom) => patch({ zoom }, "zoom")}
          />
          {layer.fit === "cover" && (
            <>
              <Slider
                label="Show more of: left / right"
                value={layer.focusX}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(focusX) => patch({ focusX }, "focus-x")}
              />
              <Slider
                label="Show more of: top / bottom"
                value={layer.focusY}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(focusY) => patch({ focusY }, "focus-y")}
              />
            </>
          )}
          <Segmented
            label="Shape"
            value={layer.mask}
            onChange={(mask) => patch({ mask })}
            options={[
              { value: "none", label: "Rectangle" },
              { value: "circle", label: "Circle" },
            ]}
          />
          {layer.mask === "none" && (
            <Slider
              label="Corner rounding"
              value={layer.radius}
              min={0}
              max={200}
              step={2}
              onChange={(radius) => patch({ radius }, "radius")}
            />
          )}
          <Slider
            label="Brightness"
            value={layer.brightness}
            min={-0.5}
            max={0.5}
            step={0.02}
            format={(v) => `${Math.round(v * 100)}`}
            onChange={(brightness) => patch({ brightness }, "brightness")}
          />
          <Slider
            label="Contrast"
            value={layer.contrast}
            min={-0.5}
            max={0.5}
            step={0.02}
            format={(v) => `${Math.round(v * 100)}`}
            onChange={(contrast) => patch({ contrast }, "contrast")}
          />
          <Check
            label="Black and white"
            checked={layer.greyscale}
            onChange={(greyscale) => patch({ greyscale })}
          />
        </Section>
      );
    case "logo":
      return (
        <Section title="Logo">
          <label className="flex flex-col gap-0.5 text-sm text-admin-text-secondary">
            Version
            <select
              value={layer.variant}
              onChange={(e) => {
                const variant = e.target.value as LogoVariant;
                // Keep the width and fix the height to the new artwork's shape.
                apply((d) => {
                  const next = updateLayers(d, [layer.id], () => ({ variant }));
                  return setGeometry(
                    next,
                    format,
                    { [layer.id]: { ...g, h: g.w / LOGOS[variant].ratio } },
                    "all",
                  );
                });
              }}
              className={cn(ADMIN_INPUT_CLS, "py-1")}
            >
              {(Object.keys(LOGOS) as LogoVariant[]).map((k) => (
                <option key={k} value={k}>
                  {LOGOS[k].label}
                </option>
              ))}
            </select>
          </label>
        </Section>
      );
    case "backdrop":
      return <BackdropFields layer={layer} patch={patch} actions={actions} />;
    case "frosted":
      return (
        <Section title="Frosted card">
          <Slider
            label="Corner rounding"
            value={layer.radius}
            min={0}
            max={200}
            step={2}
            onChange={(radius) => patch({ radius }, "radius")}
          />
        </Section>
      );
    case "shape":
      return (
        <Section title="Shape">
          {(layer.shape === "rect" || layer.shape === "circle") && (
            <SwatchPicker
              label="Fill"
              allowNone
              value={layer.fill}
              onChange={(fill) => patch({ fill })}
            />
          )}
          <SwatchPicker
            label={layer.shape === "line" || layer.shape === "arrow" ? "Colour" : "Outline"}
            allowNone={layer.shape === "rect" || layer.shape === "circle"}
            value={layer.stroke}
            onChange={(stroke) => patch({ stroke })}
          />
          <Slider
            label="Line thickness"
            value={layer.strokeWidth}
            min={0}
            max={60}
            step={1}
            onChange={(strokeWidth) => patch({ strokeWidth }, "stroke")}
          />
          {layer.shape === "rect" && (
            <Slider
              label="Corner rounding"
              value={layer.radius}
              min={0}
              max={200}
              step={2}
              onChange={(radius) => patch({ radius }, "radius")}
            />
          )}
        </Section>
      );
    case "stars":
      return (
        <Section title="Stars">
          <Slider
            label="How many"
            value={layer.count}
            min={1}
            max={5}
            step={1}
            onChange={(count) => patch({ count })}
          />
          <SwatchPicker
            label="Colour"
            value={layer.colour}
            onChange={(c) => c && patch({ colour: c })}
          />
        </Section>
      );
    case "quote-mark":
      return (
        <Section title="Quote mark">
          <SwatchPicker
            label="Colour"
            value={layer.colour}
            onChange={(c) => c && patch({ colour: c })}
          />
        </Section>
      );
    case "contact":
      return (
        <Section title="Contact details">
          <p className="text-sm text-admin-text-secondary">
            Read from Settings each time, so a changed number shows here too.
          </p>
          {(Object.keys(CONTACT_LABEL) as ContactField[]).map((f) => (
            <Check
              key={f}
              label={CONTACT_LABEL[f]}
              checked={layer.fields.includes(f)}
              onChange={(on) => {
                const fields = on ? [...layer.fields, f] : layer.fields.filter((x) => x !== f);
                if (fields.length > 0) patch({ fields });
              }}
            />
          ))}
          <SwatchPicker
            label="Colour"
            value={layer.colour}
            onChange={(c) => c && patch({ colour: c })}
          />
        </Section>
      );
    case "promo":
      return (
        <Section title="Promo">
          <p className="text-sm text-admin-text-secondary">
            Shows the running promo&apos;s wording, so it changes when the promo does.
          </p>
          <label className="flex flex-col gap-0.5 text-sm text-admin-text-secondary">
            Shows
            <select
              value={layer.field}
              onChange={(e) => patch({ field: e.target.value as PromoField })}
              className={cn(ADMIN_INPUT_CLS, "py-1")}
            >
              {(Object.keys(PROMO_LABEL) as PromoField[]).map((f) => (
                <option key={f} value={f}>
                  {PROMO_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-sm text-admin-text-secondary">
            Weight
            <select
              value={String(layer.weight)}
              onChange={(e) => patch({ weight: Number(e.target.value) })}
              className={cn(ADMIN_INPUT_CLS, "py-1")}
            >
              {WEIGHTS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <SwatchPicker
            label="Colour"
            value={layer.colour}
            onChange={(c) => c && patch({ colour: c })}
          />
        </Section>
      );
    case "qr":
    case "icon":
      return null;
  }
}

/**
 * Backdrop controls.
 * @param props - Component props.
 * @param props.layer - Backdrop layer.
 * @param props.patch - Patches the layer.
 * @param props.actions - Editor actions.
 * @returns Section element.
 */
function BackdropFields({
  layer,
  patch,
  actions,
}: {
  layer: BackdropLayer;
  patch: (patch: Partial<Layer>, tag?: string) => void;
  actions: PanelActions;
}): React.ReactElement {
  return (
    <Section title="Backdrop">
      <Segmented
        label="Kind"
        value={layer.source}
        onChange={(source) => {
          if (source === "photo" && !layer.src) {
            actions.replacePhoto(layer.id);
            return;
          }
          patch({ source });
        }}
        options={[
          { value: "brand", label: "Brand" },
          { value: "solid", label: "Colour" },
          { value: "gradient", label: "Fade" },
          { value: "photo", label: "Photo" },
        ]}
      />
      {(layer.source === "solid" || layer.source === "gradient") && (
        <SwatchPicker
          label={layer.source === "gradient" ? "Top colour" : "Colour"}
          value={layer.colour}
          onChange={(c) => c && patch({ colour: c })}
        />
      )}
      {layer.source === "gradient" && (
        <SwatchPicker
          label="Bottom colour"
          value={layer.colour2}
          onChange={(c) => c && patch({ colour2: c })}
        />
      )}
      {layer.source === "photo" && (
        <>
          <button
            type="button"
            disabled={!actions.canUpload}
            onClick={() => actions.replacePhoto(layer.id)}
            className="h-8 rounded-md border border-admin-border bg-admin-surface px-2 text-sm hover:bg-admin-bg disabled:opacity-40"
          >
            Replace photo
          </button>
          <Slider
            label="Blur"
            value={layer.blur}
            min={0}
            max={80}
            step={1}
            onChange={(blur) => patch({ blur }, "blur")}
          />
        </>
      )}
      <Slider
        label="Light wash over it"
        value={layer.wash}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(wash) => patch({ wash }, "wash")}
      />
    </Section>
  );
}
