"use client";
// src/features/social-design/components/SimpleEditor.tsx
// The post maker on a phone: a preview of each size, the words in plain boxes, and a
// button per photo to swap it. Nothing moves or resizes here, since dragging handles
// on a small touch screen goes wrong more often than right; the full editor is a tap
// away for when it's needed.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { DesignPreview } from "@/features/social-design/components/canvas/DesignPreview";
import { SizeTabs } from "@/features/social-design/components/SizeTabs";
import type { BoundValues, DesignDoc, Layer } from "@/features/social-design/lib/doc";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FaCamera, FaUpDownLeftRight } from "react-icons/fa6";

/**
 * Layers in reading order on a size: top to bottom, then left to right. A layer hidden
 * there still lists, so its words can be changed for the sizes that show it.
 * @param doc - Design.
 * @param format - Size.
 * @param keep - Which layers to list.
 * @returns The layers.
 */
function inReadingOrder(doc: DesignDoc, format: FormatKey, keep: (l: Layer) => boolean): Layer[] {
  const layout = doc.layouts[format] ?? {};
  return doc.layers.filter(keep).toSorted((a, b) => {
    const ga = layout[a.id];
    const gb = layout[b.id];
    return (ga?.y ?? 0) - (gb?.y ?? 0) || (ga?.x ?? 0) - (gb?.x ?? 0);
  });
}

/**
 * Box for a ticked list, one point per line. It holds what's typed itself, so a new
 * line just started (still empty) stays in the box while the list leaves blanks out;
 * an undo that changes the points from outside replaces it.
 * @param props - Component props.
 * @param props.id - Textarea id.
 * @param props.items - The list's points.
 * @param props.onChange - Called with what's typed.
 * @returns Textarea element.
 */
function PointsBox({
  id,
  items,
  onChange,
}: {
  id: string;
  items: string[];
  onChange: (text: string) => void;
}): React.ReactElement {
  const outside = items.join("\n");
  const [text, setText] = useState(outside);
  const [seen, setSeen] = useState(outside);
  // Points changed from outside the box (undo, redo, an AI draft): show those, unless
  // they're just what was typed with the blank lines left out.
  if (outside !== seen) {
    setSeen(outside);
    const typed = text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n");
    if (typed !== outside) setText(outside);
  }
  return (
    <AdminTextarea
      id={id}
      rows={Math.min(6, Math.max(2, text.split("\n").length + 1))}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/**
 * The phone editor.
 * @param props - Component props.
 * @param props.doc - Design.
 * @param props.tabDoc - Design for the size tabs, a beat behind typing.
 * @param props.format - Size shown.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.family - Exo's font-family list, or null while it loads.
 * @param props.onPick - Shows one size.
 * @param props.onAddSize - Adds a size.
 * @param props.onRemoveSize - Removes a size.
 * @param props.onWords - Changes a text layer's words, or a list's points (one per line).
 * @param props.onPhoto - Opens the photo picker for a photo layer or photo backdrop.
 * @param props.onFullEditor - Switches to the full editor.
 * @returns Editor element.
 */
export function SimpleEditor({
  doc,
  tabDoc,
  format,
  bound,
  family,
  onPick,
  onAddSize,
  onRemoveSize,
  onWords,
  onPhoto,
  onFullEditor,
}: {
  doc: DesignDoc;
  tabDoc: DesignDoc;
  format: FormatKey;
  bound: BoundValues;
  family: string | null;
  onPick: (format: FormatKey) => void;
  onAddSize: (format: FormatKey) => void;
  onRemoveSize: (format: FormatKey) => void;
  onWords: (id: string, words: string) => void;
  onPhoto: (id: string) => void;
  onFullEditor: () => void;
}): React.ReactElement {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const f = FORMATS[format];
  // As wide as the phone, but never so tall that the words below drop out of reach.
  const previewH = Math.min((boxWidth * f.height) / f.width, window.innerHeight * 0.55);
  const words = inReadingOrder(doc, format, (l) => l.type === "text" || l.type === "bullets");
  const photos = inReadingOrder(
    doc,
    format,
    (l) => l.type === "image" || (l.type === "backdrop" && l.source === "photo"),
  );
  const live = doc.layers.some((l) => l.type === "contact" || l.type === "promo");

  return (
    <div className="flex flex-col gap-4">
      <SizeTabs
        doc={tabDoc}
        format={format}
        allSizes={false}
        bound={bound}
        family={family}
        onPick={onPick}
        onAdd={onAddSize}
        onRemove={onRemoveSize}
      />
      <div
        ref={boxRef}
        className="flex justify-center rounded-lg border border-admin-border bg-seasalt-200/60 p-2"
      >
        {family && boxWidth > 0 ? (
          <DesignPreview
            doc={doc}
            format={format}
            bound={bound}
            family={family}
            height={Math.round(previewH)}
          />
        ) : (
          <p className="py-16 text-sm text-admin-muted">Loading fonts...</p>
        )}
      </div>

      {words.length > 0 && (
        <section aria-labelledby={`${id}-words`} className="flex flex-col gap-3">
          <h2 id={`${id}-words`} className="text-lg font-semibold text-admin-text">
            Words
          </h2>
          {words.map((l) => (
            <AdminField
              key={l.id}
              label={l.name}
              htmlFor={`${id}-${l.id}`}
              hint={l.type === "bullets" ? "One point per line." : undefined}
            >
              {l.type === "bullets" ? (
                <PointsBox
                  id={`${id}-${l.id}`}
                  items={l.items}
                  onChange={(text) => onWords(l.id, text)}
                />
              ) : (
                <AdminTextarea
                  id={`${id}-${l.id}`}
                  rows={Math.min(
                    6,
                    Math.max(2, (l.type === "text" ? l.text : "").split("\n").length + 1),
                  )}
                  value={l.type === "text" ? l.text : ""}
                  onChange={(e) => onWords(l.id, e.target.value)}
                />
              )}
            </AdminField>
          ))}
          {live && (
            <p className="text-sm text-admin-text-secondary">
              Contact details and the promo fill in by themselves from Settings and the running
              promo.
            </p>
          )}
        </section>
      )}

      {photos.length > 0 && (
        <section aria-labelledby={`${id}-photos`} className="flex flex-col gap-2">
          <h2 id={`${id}-photos`} className="text-lg font-semibold text-admin-text">
            Photos
          </h2>
          <ul className="flex flex-col gap-2">
            {photos.map((l) => {
              const src = l.type === "image" ? l.src : l.type === "backdrop" ? l.src : null;
              return (
                <li
                  key={l.id}
                  className="flex items-center gap-3 rounded-lg border border-admin-border bg-admin-surface p-2"
                >
                  <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-seasalt-100">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Blob photo shown small; next/image adds nothing here.
                      <img src={src} alt="" className="size-full object-cover" />
                    ) : (
                      <FaCamera aria-hidden className="size-5 text-admin-muted" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-admin-text">{l.name}</span>
                  <AdminButton size="sm" variant="outline" onClick={() => onPhoto(l.id)}>
                    {src ? "Change photo" : "Add a photo"}
                  </AdminButton>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-admin-border bg-admin-surface p-3 text-sm text-admin-text-secondary">
        <span className="min-w-0 flex-1">
          Moving and resizing things works best on a bigger screen.
        </span>
        <AdminButton size="sm" variant="outline" onClick={onFullEditor}>
          <FaUpDownLeftRight aria-hidden className="size-3" /> Full editor
        </AdminButton>
      </div>
    </div>
  );
}
