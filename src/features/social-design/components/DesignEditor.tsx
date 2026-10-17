"use client";
// src/features/social-design/components/DesignEditor.tsx
// The post maker editor: toolbar, size tabs, layers panel, canvas (or every size side
// by side) and properties panel around one design. Holds the design with undo and
// redo, the selection, the size on screen, whether moves reach every size, and the
// view settings, autosaves, and turns keyboard shortcuts and panel actions into edits
// from editor-ops. Loaded only in the browser (Konva has no server build).

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { AddMenu } from "@/features/social-design/components/AddMenu";
import { DesignCanvas, type Zoom } from "@/features/social-design/components/canvas/DesignCanvas";
import { exoFamily, loadExo } from "@/features/social-design/components/canvas/fonts";
import { reflowText } from "@/features/social-design/components/canvas/text-layout";
import { loadImage } from "@/features/social-design/components/canvas/use-image";
import { IconButton } from "@/features/social-design/components/editor-fields";
import { HistoryMenu } from "@/features/social-design/components/HistoryMenu";
import { LayersPanel } from "@/features/social-design/components/LayersPanel";
import { PhotoPicker, type RecentPhoto } from "@/features/social-design/components/PhotoPicker";
import {
  PropertiesPanel,
  type PanelActions,
} from "@/features/social-design/components/PropertiesPanel";
import { SizeTabs } from "@/features/social-design/components/SizeTabs";
import { TipStrip } from "@/features/social-design/components/TipStrip";
import {
  useDesignAutosave,
  type SaveState,
} from "@/features/social-design/components/use-design-autosave";
import { useDocHistory } from "@/features/social-design/components/use-doc-history";
import { appCrops } from "@/features/social-design/lib/app-crops";
import type { DesignRow, DesignSummary } from "@/features/social-design/lib/design-row";
import type { BoundValues, DesignDoc, Geometry } from "@/features/social-design/lib/doc";
import {
  addFormat,
  addLayer,
  copyLayers,
  copyLayout,
  duplicateLayers,
  expandGroups,
  groupLayers,
  layerById,
  nudgeLayers,
  pasteLayers,
  pasteStyle,
  removeFormat,
  removeLayers,
  restack,
  setGeometry,
  startGeometry,
  styleOf,
  ungroupLayers,
  updateLayers,
  type Clip,
  type EditScope,
  type LayerStyle,
} from "@/features/social-design/lib/editor-ops";
import { FORMATS, type FormatKey } from "@/features/social-design/lib/formats";
import { fullBleed } from "@/features/social-design/lib/layout";
import { makeLayer, type AddKind } from "@/features/social-design/lib/new-layer";
import { cn } from "@/shared/lib/cn";
import { shrinkImage } from "@/shared/lib/resize-image";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowRotateLeft,
  FaArrowRotateRight,
  FaBookmark,
  FaBorderAll,
  FaCropSimple,
  FaLink,
  FaMagnifyingGlassMinus,
  FaMagnifyingGlassPlus,
  FaRulerCombined,
  FaVectorSquare,
} from "react-icons/fa6";

// Photos for designs keep more pixels than the composer's 1200px: a full-bleed photo
// on a 1080x1920 story needs them.
const PHOTO_EDGE = 2400;

/** What the photo picker is choosing a photo for. */
type PhotoTarget = { mode: "image" } | { mode: "backdrop" } | { mode: "replace"; id: string };

const PICKER_TITLE: Record<PhotoTarget["mode"], string> = {
  image: "Add a photo",
  backdrop: "Photo backdrop",
  replace: "Choose the photo",
};

const SCOPES: { value: EditScope; label: string; title: string }[] = [
  {
    value: "all",
    label: "Every size",
    title: "Moving or resizing a layer does the same on every size it follows",
  },
  {
    value: "this",
    label: "This size only",
    title:
      "Moving or resizing a layer changes this size only, and it stops following the others here",
  },
];

/** The all-sizes cells always fit their box, so they report nothing back. */
function ignoreZoom(): void {}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "All changes saved",
  unsaved: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
  conflict: "Not saving",
};

/**
 * Whether a key press came from a field the operator is typing in.
 * @param e - Keyboard event.
 * @returns True inside inputs, text areas, selects and editable text.
 */
function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el?.closest("input, textarea, select, [contenteditable=true]");
}

/**
 * The post maker editor.
 * @param props - Component props.
 * @param props.initial - Design as loaded.
 * @param props.bound - Live values for contact and promo layers.
 * @param props.canUpload - Whether photo uploads are set up.
 * @param props.bookingUrl - Booking page address, where a new QR code points.
 * @returns Editor element.
 */
export function DesignEditor({
  initial,
  bound,
  canUpload,
  bookingUrl,
}: {
  initial: DesignRow;
  bound: BoundValues;
  canUpload: boolean;
  bookingUrl: string;
}): React.ReactElement {
  const { toast } = useToast();
  const router = useRouter();
  const [family, setFamily] = useState<string | null>(null);
  const normalise = useCallback(
    (d: DesignDoc) => (family ? reflowText(d, bound, family) : d),
    [family, bound],
  );
  const history = useDocHistory(initial.doc, normalise);
  const { doc, apply, current } = history;
  const [name, setName] = useState(initial.name);
  const [selectedRaw, setSelected] = useState<string[]>([]);
  const [formatRaw, setFormat] = useState<FormatKey>(initial.doc.formats[0] ?? "feed-4x5");
  // An undo can take away the size on screen; fall back to the first one left.
  const format = doc.formats.includes(formatRaw) ? formatRaw : (doc.formats[0] ?? formatRaw);
  const [allSizes, setAllSizes] = useState(false);
  const [scope, setScope] = useState<EditScope>("all");
  const [showCrops, setShowCrops] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [shownZoom, setShownZoom] = useState(0.3);
  const [lockRatio, setLockRatio] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [showRulers, setShowRulers] = useState(true);
  const [styleClip, setStyleClip] = useState<LayerStyle | null>(null);
  const [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<PhotoTarget | null>(null);
  const [copying, setCopying] = useState(false);
  const clip = useRef<Clip | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoFor = useRef<PhotoTarget>({ mode: "image" });
  // The tab thumbnails redraw a beat behind edits, so dragging and typing stay smooth.
  const tabDoc = useDeferredValue(doc);

  // Drop ids of layers that no longer exist (deleted, or undone away).
  const selected = useMemo(
    () => selectedRaw.filter((id) => layerById(doc, id)),
    [selectedRaw, doc],
  );

  // Load Exo (every weight, with macrons) before drawing, then measure every text box.
  const replace = history.replace;
  useEffect(() => {
    let live = true;
    const fam = exoFamily();
    void loadExo(fam)
      .catch(() => undefined)
      .then(() => {
        if (!live) return;
        setFamily(fam);
        replace((d) => reflowText(d, bound, fam));
      });
    return () => {
      live = false;
    };
  }, [bound, replace]);

  const onSaveError = useCallback((message: string) => toast(message, { tone: "error" }), [toast]);
  const fields = useMemo(() => ({ name, kind: initial.kind, doc }), [name, initial.kind, doc]);
  const save = useDesignAutosave(initial.id, initial.updatedAt, fields, onSaveError);

  /**
   * Changes the selection. Picking one member of a group picks the whole group;
   * `additive` (Shift) toggles the picked layers in or out.
   * @param ids - Picked layer ids.
   * @param additive - Whether to toggle rather than replace.
   */
  const select = useCallback(
    (ids: string[], additive: boolean) => {
      const picked = expandGroups(current(), ids);
      if (!additive) {
        setSelected(picked);
        return;
      }
      setSelected((prev) => {
        const all = picked.every((id) => prev.includes(id));
        return all
          ? prev.filter((id) => !picked.includes(id))
          : [...prev, ...picked.filter((id) => !prev.includes(id))];
      });
    },
    [current],
  );

  /**
   * Adds an element from the Add menu, centred on the size on screen. A backdrop
   * covers the whole picture and goes to the bottom of the stack.
   * @param add - What to add.
   */
  const addElement = useCallback(
    (add: AddKind) => {
      const { layer, share, ratio } = makeLayer(add);
      const g: Geometry =
        layer.type === "backdrop" ? fullBleed(format) : startGeometry(layer, format, share, ratio);
      apply((d) => {
        const next = addLayer(d, layer, format, g);
        return layer.type === "backdrop" ? restack(next, [layer.id], "back") : next;
      });
      setSelected([layer.id]);
    },
    [apply, format],
  );

  /**
   * Opens the photo picker.
   * @param target - What the photo is for.
   */
  function pickPhoto(target: PhotoTarget): void {
    setPicker(target);
  }

  /** Swaps the photo picker for the file picker, for a new upload. */
  function uploadPhoto(): void {
    if (picker) photoFor.current = picker;
    setPicker(null);
    fileRef.current?.click();
  }

  /**
   * Places a photo: as a new photo layer, a new photo backdrop, or in place of an
   * existing layer's photo (filling an empty frame keeps the frame).
   * @param target - What the photo is for.
   * @param url - Photo address.
   * @param size - The photo's pixel size.
   * @param size.naturalWidth - Width.
   * @param size.naturalHeight - Height.
   */
  function placePhoto(
    target: PhotoTarget,
    url: string,
    size: { naturalWidth: number; naturalHeight: number },
  ): void {
    if (target.mode === "image") {
      addElement({ kind: "image", src: url, ...size });
    } else if (target.mode === "backdrop") {
      addElement({ kind: "backdrop", source: "photo", src: url });
    } else {
      apply((d) =>
        updateLayers(d, [target.id], (l) =>
          l.type === "image"
            ? { src: url, ...size, focusX: 0.5, focusY: 0.5, zoom: 1 }
            : l.type === "backdrop"
              ? { source: "photo", src: url, blur: l.blur || 24 }
              : {},
        ),
      );
    }
  }

  /**
   * Uses a photo already in a design, loading it first when its size wasn't recorded.
   * @param photo - Picked photo.
   */
  async function reusePhoto(photo: RecentPhoto): Promise<void> {
    const target = picker;
    setPicker(null);
    if (!target) return;
    try {
      const img = await loadImage(photo.url);
      placePhoto(target, photo.url, {
        naturalWidth: photo.width ?? img.naturalWidth,
        naturalHeight: photo.height ?? img.naturalHeight,
      });
    } catch {
      toast("That photo couldn't be loaded.", { tone: "error" });
    }
  }

  /**
   * Copies this design into a new template, or starts a new design from this template.
   * Waiting changes are saved first so the copy has them.
   */
  async function copyAs(): Promise<void> {
    setCopying(true);
    const saved = await save.saveNow();
    if (!saved) {
      setCopying(false);
      toast("Couldn't save the latest changes, so nothing was copied.", { tone: "error" });
      return;
    }
    const res = await callApi<{ design: DesignSummary }>("/api/admin/social/designs", "POST", {
      source: "copy",
      sourceId: initial.id,
      asTemplate: !initial.isTemplate,
    });
    setCopying(false);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    if (initial.isTemplate) router.push(`/admin/social/design/${res.design.id}`);
    else toast("Saved as a template. It's under Start a design on the Post maker page.");
  }

  /**
   * Shrinks, uploads and places a picked file.
   * @param file - Picked file.
   */
  async function onPhoto(file: File): Promise<void> {
    const target = photoFor.current;
    setUploading(true);
    try {
      const small = await shrinkImage(file, PHOTO_EDGE);
      const form = new FormData();
      form.append("file", small.file);
      const res = await callApi<{ url: string }>("/api/admin/social/designs/upload", "POST", form);
      if (!res.ok) {
        toast(res.error, { tone: "error" });
        return;
      }
      // Warm the image cache so the canvas draws it straight away.
      await loadImage(res.url).catch(() => undefined);
      placePhoto(target, res.url, { naturalWidth: small.width, naturalHeight: small.height });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't add the photo.", { tone: "error" });
    } finally {
      setUploading(false);
    }
  }

  const duplicate = useCallback(() => {
    if (selected.length === 0) return;
    const out = duplicateLayers(current(), selected, format);
    apply(() => out.doc);
    setSelected(out.ids);
  }, [apply, current, format, selected]);

  const remove = useCallback(() => {
    if (selected.length === 0) return;
    apply((d) => removeLayers(d, selected));
    setSelected([]);
  }, [apply, selected]);

  const copy = useCallback(() => {
    if (selected.length > 0) clip.current = copyLayers(current(), selected);
  }, [current, selected]);

  const paste = useCallback(() => {
    if (!clip.current) return;
    const out = pasteLayers(current(), clip.current, format);
    apply(() => out.doc);
    setSelected(out.ids);
  }, [apply, current, format]);

  /**
   * Restores a saved copy from the History menu as one undoable edit.
   * @param versionId - Saved copy id.
   */
  async function restoreVersion(versionId: string): Promise<void> {
    const res = await callApi<{ name: string; doc: DesignDoc }>(
      `/api/admin/social/designs/${initial.id}/versions/${versionId}`,
    );
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    apply(() => res.doc);
    setSelected([]);
    if (!res.doc.formats.includes(format)) setFormat(res.doc.formats[0] ?? "feed-4x5");
    toast("Restored. Undo takes it back.");
  }

  // Keyboard shortcuts. Ignored while typing in a field, including the on-canvas text box.
  useEffect(() => {
    /**
     * Runs the shortcut for a key press.
     * @param e - Keyboard event.
     */
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        history.redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod && key === "c") {
        copy();
      } else if (mod && key === "x") {
        copy();
        remove();
      } else if (mod && key === "v") {
        e.preventDefault();
        paste();
      } else if (mod && key === "a") {
        e.preventDefault();
        setSelected(
          current()
            .layers.filter((l) => !l.locked)
            .map((l) => l.id),
        );
      } else if (mod && key === "g") {
        e.preventDefault();
        apply((d) => (e.shiftKey ? ungroupLayers(d, selected) : groupLayers(d, selected)));
      } else if (mod && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        const up = e.code === "BracketRight";
        apply((d) =>
          restack(
            d,
            selected,
            up ? (e.shiftKey ? "front" : "forward") : e.shiftKey ? "back" : "backward",
          ),
        );
      } else if (mod && key === "0") {
        e.preventDefault();
        setZoom("fit");
      } else if (mod && key === "1") {
        e.preventDefault();
        setZoom(1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.length > 0) {
          e.preventDefault();
          remove();
        }
      } else if (e.key === "Escape") {
        setSelected([]);
      } else if (e.key.startsWith("Arrow") && selected.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        apply((d) => nudgeLayers(d, format, selected, dx, dy, scope), "nudge");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply, copy, current, duplicate, format, history, paste, remove, scope, selected]);

  const onGeometry = useCallback(
    (changes: Record<string, Geometry>) => apply((d) => setGeometry(d, format, changes, scope)),
    [apply, format, scope],
  );

  /**
   * Shows one size on its own, zoomed to fit.
   * @param f - Size to show.
   */
  function openSize(f: FormatKey): void {
    setFormat(f);
    setAllSizes(false);
    setZoom("fit");
  }

  /**
   * Adds a size and shows it.
   * @param f - Size to add.
   */
  function addSize(f: FormatKey): void {
    apply((d) => addFormat(d, f));
    openSize(f);
    toast(`${FORMATS[f].label} added, laid out from the closest shape.`);
  }

  /**
   * Removes a size; undo brings it back with its layout.
   * @param f - Size to remove.
   */
  function removeSize(f: FormatKey): void {
    apply((d) => removeFormat(d, f));
    toast(`${FORMATS[f].label} removed. Undo brings it back.`);
  }

  const onText = useCallback(
    (id: string, text: string) =>
      apply((d) =>
        updateLayers(d, [id], (l) =>
          l.type === "text"
            ? { text }
            : l.type === "bullets"
              ? {
                  items: text
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 8),
                }
              : {},
        ),
      ),
    [apply],
  );

  const onZoom = useCallback((scale: number, fit: boolean) => {
    setShownZoom(scale);
    if (!fit) setZoom(scale);
  }, []);

  const one = selected.length === 1 ? layerById(doc, selected[0] ?? "") : undefined;
  const actions: PanelActions = {
    duplicate,
    remove,
    /** Groups the selection. */
    group: () => {
      apply((d) => groupLayers(d, selected));
    },
    /** Ungroups the selection. */
    ungroup: () => {
      apply((d) => ungroupLayers(d, selected));
    },
    /** Copies the one selected layer's look. */
    copyStyle: () => {
      if (one) {
        setStyleClip(styleOf(one));
        toast("Style copied. Pick other layers and paste it.");
      }
    },
    /** Pastes the copied look onto the selection. */
    pasteStyle: () => {
      if (styleClip) apply((d) => pasteStyle(d, selected, styleClip));
    },
    canPasteStyle: styleClip !== null,
    /**
     * Opens the file picker to swap a photo layer's picture.
     * @param id - Photo layer.
     */
    replacePhoto: (id) => {
      pickPhoto({ mode: "replace", id });
    },
    qrLinks: [
      { label: "Booking page", url: bookingUrl },
      { label: "Home page", url: new URL(bookingUrl).origin },
    ],
  };

  /**
   * Steps the zoom in or out from where it is.
   * @param factor - Multiplier.
   */
  function stepZoom(factor: number): void {
    setZoom(Math.min(4, Math.max(0.05, shownZoom * factor)));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="design-name">
          Design name
        </label>
        <input
          id="design-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (!name.trim()) setName(initial.name);
          }}
          className={cn(ADMIN_INPUT_CLS, "h-9 w-56 py-1 font-semibold")}
        />
        <span
          role="status"
          className={cn(
            "text-sm",
            save.state === "error" || save.state === "conflict"
              ? "text-coquelicot-700"
              : "text-admin-muted",
          )}
        >
          {SAVE_LABEL[save.state]}
        </span>
        {save.state === "error" && (
          <AdminButton size="xs" variant="outline" onClick={() => void save.saveNow()}>
            Try again
          </AdminButton>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <IconButton label="Undo (Ctrl+Z)" onClick={history.undo} disabled={!history.canUndo}>
              <FaArrowRotateLeft aria-hidden className="size-3.5" />
            </IconButton>
            <IconButton label="Redo (Ctrl+Y)" onClick={history.redo} disabled={!history.canRedo}>
              <FaArrowRotateRight aria-hidden className="size-3.5" />
            </IconButton>
          </div>
          <AddMenu
            photosBusy={uploading}
            bookingUrl={bookingUrl}
            onAdd={addElement}
            onPickPhoto={(t) => pickPhoto({ mode: t })}
          />
          <HistoryMenu designId={initial.id} onRestore={restoreVersion} />
          <AdminButton
            variant="outline"
            busy={copying}
            onClick={() => void copyAs()}
            title={
              initial.isTemplate
                ? "Start a new design from this template"
                : "Keep a copy of this design as a starting point for new ones"
            }
          >
            <FaBookmark aria-hidden className="size-3" />
            {initial.isTemplate ? "New design from this" : "Save as template"}
          </AdminButton>
        </div>
      </div>

      {save.state === "conflict" && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-coquelicot-300 bg-coquelicot-50 px-3 py-2 text-sm text-admin-text"
        >
          This design changed in another tab, so this tab has stopped saving to keep that work.
          <AdminButton size="xs" variant="outline" onClick={() => window.location.reload()}>
            Reload to see the latest
          </AdminButton>
        </div>
      )}
      <TipStrip />

      {/* 15rem covers the admin top bar, page header and toolbar, so at Fit the whole
          picture shows without scrolling once the tips are dismissed. */}
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:h-[calc(100dvh-15rem)] lg:min-h-136 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside className="order-2 max-h-80 overflow-y-auto rounded-lg border border-admin-border bg-admin-surface lg:order-0 lg:max-h-none">
          <LayersPanel
            doc={doc}
            format={format}
            selected={selected}
            apply={apply}
            onSelect={select}
          />
        </aside>

        <div className="order-1 flex min-h-0 flex-col gap-2 lg:order-0">
          <SizeTabs
            doc={tabDoc}
            format={format}
            allSizes={allSizes}
            bound={bound}
            family={family}
            onPick={openSize}
            onAllSizes={() => setAllSizes(true)}
            onAdd={addSize}
            onRemove={removeSize}
          />
          <div className="flex flex-wrap items-center gap-2">
            {doc.formats.length > 1 && (
              <div
                role="group"
                aria-label="Which sizes moves and resizes reach"
                className="flex items-center gap-2 text-sm text-admin-text-secondary"
              >
                Moves reach
                <div className="flex overflow-hidden rounded-md border border-admin-border-strong">
                  {SCOPES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      title={s.title}
                      aria-pressed={scope === s.value}
                      onClick={() => setScope(s.value)}
                      className={cn(
                        "h-8 px-2.5 text-sm transition-colors not-first:border-l not-first:border-admin-border",
                        scope === s.value
                          ? "bg-russian-violet text-seasalt"
                          : "bg-admin-surface text-admin-text hover:bg-admin-bg",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!allSizes && doc.formats.length > 1 && (
              <select
                aria-label="Copy the layout of another size onto this one"
                value=""
                onChange={(e) => {
                  const from = e.target.value as FormatKey;
                  if (!from) return;
                  apply((d) => copyLayout(d, from, format));
                  toast(
                    `${FORMATS[format].label} now follows the ${FORMATS[from].label} layout. Undo takes it back.`,
                  );
                }}
                className={cn(ADMIN_INPUT_CLS, "h-8 w-auto py-0")}
              >
                <option value="">Copy layout from...</option>
                {doc.formats
                  .filter((f) => f !== format)
                  .map((f) => (
                    <option key={f} value={f}>
                      {FORMATS[f].label}
                    </option>
                  ))}
              </select>
            )}
            <div className="ml-auto flex items-center gap-1">
              {!allSizes && (
                <>
                  <IconButton label="Zoom out" onClick={() => stepZoom(1 / 1.25)}>
                    <FaMagnifyingGlassMinus aria-hidden className="size-3.5" />
                  </IconButton>
                  <select
                    aria-label="Zoom"
                    value={zoom === "fit" ? "fit" : String(zoom)}
                    onChange={(e) =>
                      setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))
                    }
                    className={cn(ADMIN_INPUT_CLS, "h-8 w-auto py-0")}
                  >
                    <option value="fit">Fit ({Math.round(shownZoom * 100)}%)</option>
                    {[0.25, 0.5, 1, 2].map((z) => (
                      <option key={z} value={String(z)}>
                        {z * 100}%
                      </option>
                    ))}
                    {zoom !== "fit" && ![0.25, 0.5, 1, 2].includes(zoom) && (
                      <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
                    )}
                  </select>
                  <IconButton label="Zoom in" onClick={() => stepZoom(1.25)}>
                    <FaMagnifyingGlassPlus aria-hidden className="size-3.5" />
                  </IconButton>
                  <span className="mx-1 h-6 w-px bg-admin-border" aria-hidden />
                </>
              )}
              <IconButton label="Grid" active={showGrid} onClick={() => setShowGrid((v) => !v)}>
                <FaBorderAll aria-hidden className="size-3.5" />
              </IconButton>
              <IconButton
                label="Margins and safe area"
                active={showGuides}
                onClick={() => setShowGuides((v) => !v)}
              >
                <FaVectorSquare aria-hidden className="size-3.5" />
              </IconButton>
              <IconButton
                label="What each app shows when this goes up as a post"
                active={showCrops}
                onClick={() => setShowCrops((v) => !v)}
              >
                <FaCropSimple aria-hidden className="size-3.5" />
              </IconButton>
              {!allSizes && (
                <IconButton
                  label="Rulers"
                  active={showRulers}
                  onClick={() => setShowRulers((v) => !v)}
                >
                  <FaRulerCombined aria-hidden className="size-3.5" />
                </IconButton>
              )}
              <IconButton
                label="Keep shape when resizing from a corner"
                active={lockRatio}
                onClick={() => setLockRatio((v) => !v)}
              >
                <FaLink aria-hidden className="size-3.5" />
              </IconButton>
            </div>
          </div>
          {showCrops && !allSizes && <CropNote format={format} />}
          <div className="h-[60vh] min-h-80 overflow-hidden rounded-lg border border-admin-border bg-seasalt-200/60 lg:h-auto lg:flex-1">
            {family && allSizes ? (
              <div className="grid size-full auto-rows-[minmax(16rem,1fr)] grid-cols-1 gap-2 overflow-y-auto p-2 sm:grid-cols-2 xl:grid-cols-3">
                {doc.formats.map((f) => (
                  <section
                    key={f}
                    aria-label={FORMATS[f].label}
                    className={cn(
                      "flex min-h-0 flex-col overflow-hidden rounded-md border bg-admin-surface",
                      f === format ? "border-moonstone-600" : "border-admin-border",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openSize(f)}
                      title="Open this size on its own"
                      className="flex items-baseline gap-2 border-b border-admin-border px-2 py-1 text-left text-sm hover:bg-admin-bg"
                    >
                      <span className="font-semibold text-admin-text">{FORMATS[f].label}</span>
                      <span className="text-admin-muted">
                        {FORMATS[f].width} × {FORMATS[f].height}
                      </span>
                    </button>
                    <div className="min-h-0 flex-1">
                      <DesignCanvas
                        compact
                        doc={doc}
                        format={f}
                        selected={selected}
                        bound={bound}
                        family={family}
                        zoom="fit"
                        lockRatio={lockRatio}
                        showGrid={showGrid}
                        showGuides={showGuides}
                        showRulers={false}
                        crops={showCrops ? appCrops(f).crops : []}
                        onSelect={(ids, additive) => {
                          setFormat(f);
                          select(ids, additive);
                        }}
                        onGeometry={(changes) => {
                          setFormat(f);
                          apply((d) => setGeometry(d, f, changes, scope));
                        }}
                        onText={onText}
                        onZoom={ignoreZoom}
                      />
                    </div>
                  </section>
                ))}
              </div>
            ) : family ? (
              <DesignCanvas
                doc={doc}
                format={format}
                selected={selected}
                bound={bound}
                family={family}
                zoom={zoom}
                lockRatio={lockRatio}
                showGrid={showGrid}
                showGuides={showGuides}
                showRulers={showRulers}
                crops={showCrops ? appCrops(format).crops : []}
                onSelect={select}
                onGeometry={onGeometry}
                onText={onText}
                onZoom={onZoom}
              />
            ) : (
              <p className="flex size-full items-center justify-center text-sm text-admin-muted">
                Loading fonts...
              </p>
            )}
          </div>
        </div>

        <aside className="order-3 overflow-y-auto rounded-lg border border-admin-border bg-admin-surface lg:order-0">
          <PropertiesPanel
            doc={doc}
            format={format}
            selected={selected}
            scope={scope}
            apply={apply}
            actions={actions}
          />
        </aside>
      </div>

      <PhotoPicker
        open={picker !== null}
        title={picker ? PICKER_TITLE[picker.mode] : ""}
        canUpload={canUpload}
        onUpload={uploadPhoto}
        onPick={(p) => void reusePhoto(p)}
        onClose={() => setPicker(null)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onPhoto(file);
        }}
      />
    </div>
  );
}

/**
 * One line under the toolbar saying how the apps treat this size as a post picture,
 * shown with the app-crop boxes.
 * @param props - Component props.
 * @param props.format - Size on screen.
 * @returns Note element.
 */
function CropNote({ format }: { format: FormatKey }): React.ReactElement {
  const { crops, refusedBy } = appCrops(format);
  const parts: string[] = [];
  if (crops.length === 0 && refusedBy.length === 0) {
    parts.push("Facebook, Instagram and Google all show this size whole.");
  }
  if (crops.length > 0) {
    parts.push(
      `${crops.map((c) => c.label).join(" and ")} cut this size; the boxes show what stays.`,
    );
  }
  if (refusedBy.length > 0) {
    parts.push(`${refusedBy.join(" and ")} won't take this shape as a post picture.`);
  }
  return <p className="text-sm text-admin-text-secondary">{parts.join(" ")}</p>;
}
