"use client";
// src/features/mailing/components/blocks/BlockFields.tsx
// The controls inside each block card, one component per block type. Each reports a
// partial change; BlockEditor merges it into the block list and records the undo step.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { ADMIN_CHECKBOX_CLS } from "@/features/admin/components/ui/field-classes";
import { InsertMenu, type InsertGroup } from "@/features/admin/components/ui/InsertMenu";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { DesignPicker, type PickedDesign } from "@/features/mailing/components/blocks/DesignPicker";
import { LinkPicker } from "@/features/mailing/components/blocks/LinkPicker";
import { usePictureUpload } from "@/features/mailing/components/blocks/usePictureUpload";
import type { Block } from "@/features/mailing/lib/blocks";
import type { LinkTarget } from "@/features/mailing/lib/insertables";
import type { PromoWording } from "@/features/mailing/lib/render";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useRef, useState } from "react";
import { FaArrowDown, FaArrowUp, FaPlus, FaXmark } from "react-icons/fa6";

/** A block of one type. */
type BlockOf<T extends Block["type"]> = Extract<Block, { type: T }>;

/** What every block's controls get. */
export interface FieldsProps<B extends Block> {
  block: B;
  /**
   * Reports a change.
   * @param patch - The fields that changed.
   * @param mergeKey - Field being typed in, so a run of keystrokes is one undo step.
   */
  onChange: (patch: Partial<B>, mergeKey?: string) => void;
  editable: boolean;
}

/** Button labels past this length wrap on a phone and stop reading as a button. */
const LONG_BUTTON_LABEL = 25;

/**
 * Inserts text at the cursor (or around the selection) of a textarea's value.
 * @param value - The current value.
 * @param start - Selection start.
 * @param end - Selection end.
 * @param before - Text to put before the selection.
 * @param after - Text to put after the selection.
 * @returns The new value and where the cursor should land.
 */
function insertText(
  value: string,
  start: number,
  end: number,
  before: string,
  after = "",
): { next: string; cursor: number } {
  const selected = value.slice(start, end);
  return {
    next: value.slice(0, start) + before + selected + after + value.slice(end),
    cursor: start + before.length + selected.length,
  };
}

/**
 * Heading controls.
 * @param props - Component props.
 * @param props.block - The heading.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @returns The controls.
 */
export function HeadingFields({
  block,
  onChange,
  editable,
}: FieldsProps<BlockOf<"heading">>): React.ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <AdminInput
        id={id}
        aria-label="Heading"
        placeholder="Your heading"
        value={block.text}
        disabled={!editable}
        maxLength={150}
        onChange={(e) => onChange({ text: e.target.value }, `${block.id}:text`)}
        className="text-lg font-bold"
      />
      <div className={SEGMENTED_GROUP_CLS} role="group" aria-label="Heading size">
        {(["big", "small"] as const).map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={block.size === size}
            disabled={!editable}
            onClick={() => onChange({ size })}
            className={segmentedButtonClass(block.size === size)}
          >
            {size === "big" ? "Big" : "Small"}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Text paragraph controls: bold, a link dialog and the Add menu for placeholders,
 * contact details and symbols.
 * @param props - Component props.
 * @param props.block - The text block.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @param props.insertGroups - The Add menu, without its button items (buttons are blocks here).
 * @param props.linkTargets - Pages a link can go to.
 * @returns The controls.
 */
export function TextFields({
  block,
  onChange,
  editable,
  insertGroups,
  linkTargets,
}: FieldsProps<BlockOf<"text">> & {
  insertGroups: InsertGroup[];
  linkTargets: LinkTarget[];
}): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState<{ start: number; end: number; text: string } | null>(null);

  /**
   * Inserts at the cursor and puts the cursor after it.
   * @param before - Text before the selection.
   * @param after - Text after the selection.
   * @param range - Selection to use instead of the live one (the link dialog took focus).
   * @param range.start - Selection start.
   * @param range.end - Selection end.
   */
  function insert(before: string, after = "", range?: { start: number; end: number }): void {
    const el = ref.current;
    const start = range?.start ?? el?.selectionStart ?? block.text.length;
    const end = range?.end ?? el?.selectionEnd ?? block.text.length;
    const { next, cursor } = insertText(block.text, start, end, before, after);
    onChange({ text: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

  /** Opens the link dialog, remembering the selection and using it as the link's words. */
  function openLink(): void {
    const el = ref.current;
    const start = el?.selectionStart ?? block.text.length;
    const end = el?.selectionEnd ?? block.text.length;
    setLink({ start, end, text: block.text.slice(start, end) });
  }

  // Rough height so a paragraph shows whole without scrolling: each line counts once per
  // ~40 characters, about a phone-width row. Wider screens just get a little spare room.
  const rows = block.text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 1);
  return (
    <div className="flex flex-col gap-2">
      {editable && (
        <div className="flex flex-wrap items-center gap-1.5">
          <AdminButton
            size="xs"
            variant="secondary"
            title="Bold text"
            onClick={() => insert("**", "**")}
          >
            Bold
          </AdminButton>
          <AdminButton
            size="xs"
            variant="secondary"
            title="Link inside a sentence"
            onClick={openLink}
          >
            Link
          </AdminButton>
          <div className="ml-auto">
            <InsertMenu groups={insertGroups} onInsert={(text) => insert(text)} align="right" />
          </div>
        </div>
      )}
      <AdminTextarea
        ref={ref}
        aria-label="Text"
        placeholder="Write a paragraph. Press Enter for a new line, or Enter twice for a new paragraph."
        value={block.text}
        disabled={!editable}
        rows={Math.min(14, Math.max(3, rows))}
        onChange={(e) => onChange({ text: e.target.value }, `${block.id}:text`)}
        className="leading-relaxed"
      />
      {link && (
        <LinkDialog
          initialText={link.text}
          targets={linkTargets}
          onClose={() => setLink(null)}
          onAdd={(text, url) => {
            insert(`[${text}](${url})`, "", { start: link.start, end: link.end });
            setLink(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Dialog for a link inside a sentence: the words to show and where they go.
 * @param props - Component props.
 * @param props.initialText - Words selected when it opened.
 * @param props.targets - Pages to offer.
 * @param props.onClose - Dismisses it.
 * @param props.onAdd - Called with the words and the link.
 * @returns The dialog.
 */
function LinkDialog({
  initialText,
  targets,
  onClose,
  onAdd,
}: {
  initialText: string;
  targets: LinkTarget[];
  onClose: () => void;
  onAdd: (text: string, url: string) => void;
}): React.ReactElement {
  const id = useId();
  const [text, setText] = useState(initialText.replace(/[\]\n]/g, " ").trim());
  const [url, setUrl] = useState("");
  const ready = text.trim() !== "" && /^https?:\/\/\S+\.\S+/.test(url);
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a link"
      dirty={text !== initialText || url !== ""}
      footer={
        <>
          <AdminButton variant="secondary" onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton
            disabled={!ready}
            onClick={() => onAdd(text.replace(/[\]\n]/g, " ").trim(), url)}
          >
            Add link
          </AdminButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AdminField label="Words to show" htmlFor={`${id}-text`}>
          <AdminInput
            id={`${id}-text`}
            value={text}
            placeholder="our prices page"
            onChange={(e) => setText(e.target.value)}
          />
        </AdminField>
        <AdminField label="Where it goes" htmlFor={`${id}-url`}>
          <LinkPicker id={`${id}-url`} value={url} onChange={setUrl} targets={targets} />
        </AdminField>
      </div>
    </Modal>
  );
}

/**
 * Bullet list controls: one box per point, each with move and remove buttons.
 * Enter in a point adds the next one.
 * @param props - Component props.
 * @param props.block - The list.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @returns The controls.
 */
export function ListFields({
  block,
  onChange,
  editable,
}: FieldsProps<BlockOf<"list">>): React.ReactElement {
  const listRef = useRef<HTMLOListElement>(null);

  /**
   * Replaces the items, then focuses one.
   * @param items - New items.
   * @param focus - Index to focus afterwards, if any.
   */
  function setItems(items: string[], focus?: number): void {
    onChange({ items });
    if (focus === undefined) return;
    requestAnimationFrame(() => {
      listRef.current?.querySelectorAll("input")[focus]?.focus();
    });
  }

  /**
   * Swaps an item with its neighbour.
   * @param index - Item to move.
   * @param by - -1 for up, 1 for down.
   */
  function move(index: number, by: -1 | 1): void {
    const to = index + by;
    if (to < 0 || to >= block.items.length) return;
    const items = [...block.items];
    [items[index], items[to]] = [items[to]!, items[index]!];
    setItems(items, to);
  }

  return (
    <div className="flex flex-col gap-2">
      <ol ref={listRef} className="flex flex-col gap-1.5">
        {block.items.map((item, i) => (
          // Index keys: the items are plain strings with no identity of their own.
          <li key={i} className="flex items-center gap-1.5">
            <span aria-hidden className="text-admin-muted">
              •
            </span>
            <AdminInput
              aria-label={`Point ${i + 1}`}
              placeholder="A point"
              value={item}
              disabled={!editable}
              onChange={(e) => {
                const items = [...block.items];
                items[i] = e.target.value;
                onChange({ items }, `${block.id}:item${i}`);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setItems(
                    [...block.items.slice(0, i + 1), "", ...block.items.slice(i + 1)],
                    i + 1,
                  );
                } else if (e.key === "Backspace" && item === "" && block.items.length > 1) {
                  e.preventDefault();
                  setItems(
                    block.items.filter((_, j) => j !== i),
                    Math.max(0, i - 1),
                  );
                }
              }}
            />
            {editable && (
              <>
                <IconButton
                  label={`Move point ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <FaArrowUp />
                </IconButton>
                <IconButton
                  label={`Move point ${i + 1} down`}
                  disabled={i === block.items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <FaArrowDown />
                </IconButton>
                <IconButton
                  label={`Remove point ${i + 1}`}
                  disabled={block.items.length === 1}
                  onClick={() =>
                    setItems(
                      block.items.filter((_, j) => j !== i),
                      Math.max(0, i - 1),
                    )
                  }
                >
                  <FaXmark />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ol>
      {editable && (
        <div>
          <AdminButton
            size="xs"
            variant="secondary"
            onClick={() => setItems([...block.items, ""], block.items.length)}
          >
            <FaPlus aria-hidden /> Add a point
          </AdminButton>
        </div>
      )}
    </div>
  );
}

/**
 * Small square icon button.
 * @param props - Component props.
 * @param props.label - Accessible name and tooltip.
 * @param props.onClick - Click handler.
 * @param props.disabled - Disables it.
 * @param props.children - The icon.
 * @returns The button.
 */
export function IconButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-admin-text-secondary hover:bg-admin-bg hover:text-russian-violet disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:size-11"
    >
      {children}
    </button>
  );
}

/**
 * Button controls: the words on it and where it goes.
 * @param props - Component props.
 * @param props.block - The button.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @param props.linkTargets - Pages it can go to.
 * @returns The controls.
 */
export function ButtonFields({
  block,
  onChange,
  editable,
  linkTargets,
}: FieldsProps<BlockOf<"button">> & { linkTargets: LinkTarget[] }): React.ReactElement {
  const id = useId();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <AdminField label="Words on the button" htmlFor={`${id}-label`}>
        <AdminInput
          id={`${id}-label`}
          placeholder="Book a time"
          value={block.label}
          disabled={!editable}
          maxLength={60}
          onChange={(e) => onChange({ label: e.target.value }, `${block.id}:label`)}
        />
        {editable && block.label.trim().length > LONG_BUTTON_LABEL && (
          <p className="mt-1 text-sm text-amber-700">
            Short is better: a long button wraps onto two lines on a phone.
          </p>
        )}
      </AdminField>
      <AdminField label="Where it goes" htmlFor={`${id}-url`}>
        <LinkPicker
          id={`${id}-url`}
          value={block.url}
          onChange={(url) => onChange({ url })}
          targets={linkTargets}
          disabled={!editable}
        />
      </AdminField>
    </div>
  );
}

/**
 * Picture controls: upload or replace, or use a Post maker design's picture; describe it,
 * pick its size and an optional link.
 * @param props - Component props.
 * @param props.block - The picture.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @param props.canUpload - Whether picture uploads are set up.
 * @param props.linkTargets - Pages tapping it can open.
 * @returns The controls.
 */
export function PictureFields({
  block,
  onChange,
  editable,
  canUpload,
  linkTargets,
}: FieldsProps<BlockOf<"picture">> & {
  canUpload: boolean;
  linkTargets: LinkTarget[];
}): React.ReactElement {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, busy } = usePictureUpload();
  const [designsOpen, setDesignsOpen] = useState(false);

  /**
   * Points the block at a design's picture. The design's own description replaces the
   * old one, since it describes this picture; without one, the same rule as an upload.
   * @param picked - The size picked.
   */
  function pickDesign(picked: PickedDesign): void {
    setDesignsOpen(false);
    onChange({ url: picked.url, alt: picked.alt || (block.url ? block.alt : "") });
  }

  /**
   * Uploads a picked file and points the block at it.
   * @param file - The picked image.
   */
  async function pick(file: File): Promise<void> {
    const url = await upload(file);
    if (fileRef.current) fileRef.current.value = "";
    // A template's placeholder words describe the picture wanted, not the one uploaded,
    // so a first upload clears them and the hint asks for a real description.
    if (url) onChange(block.url ? { url } : { url, alt: "" });
  }

  const chooser = editable && (
    <>
      <AdminButton
        size="sm"
        variant="secondary"
        busy={busy}
        disabled={!canUpload}
        title={canUpload ? undefined : "Picture uploads need BLOB_READ_WRITE_TOKEN set"}
        onClick={() => fileRef.current?.click()}
      >
        {block.url ? "Replace picture" : "Choose a picture"}
      </AdminButton>
      <AdminButton size="sm" variant="outline" onClick={() => setDesignsOpen(true)}>
        Use a design
      </AdminButton>
      <DesignPicker open={designsOpen} onPick={pickDesign} onClose={() => setDesignsOpen(false)} />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
        }}
      />
    </>
  );

  if (!block.url) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border-2 border-dashed border-admin-border p-4">
        <div className="flex flex-wrap gap-2">{chooser}</div>
        {block.alt.trim() && (
          <p className="text-sm text-admin-text-secondary">
            Wanted here: {block.alt}. It&apos;s left out of the email until you choose one.
          </p>
        )}
        {!canUpload && (
          <p className="text-sm text-admin-muted">
            Picture uploads aren&apos;t set up yet (BLOB_READ_WRITE_TOKEN). A design&apos;s picture
            still works.
          </p>
        )}
      </div>
    );
  }

  const altMissing = !block.alt.trim() || block.alt.trim().toLowerCase() === "picture";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-start gap-2">
        {/* Blob-hosted and already shrunk, so next/image would add nothing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={block.url}
          alt={block.alt}
          className="max-h-36 w-auto max-w-full rounded-md border border-admin-border sm:max-w-48"
        />
        <div className="flex flex-wrap gap-2">{chooser}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <AdminField label="Describe the picture" htmlFor={`${id}-alt`}>
          <AdminInput
            id={`${id}-alt`}
            placeholder="Harrison fixing a laptop at a kitchen table"
            value={block.alt}
            disabled={!editable}
            maxLength={200}
            onChange={(e) => onChange({ alt: e.target.value }, `${block.id}:alt`)}
          />
          {editable && altMissing && (
            <p className="mt-1 text-sm text-amber-700">
              Add a few words: they show when an email app hides pictures, and screen readers read
              them out.
            </p>
          )}
        </AdminField>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-admin-text">Size</span>
          <div className={SEGMENTED_GROUP_CLS} role="group" aria-label="Picture size">
            {([false, true] as const).map((small) => (
              <button
                key={String(small)}
                type="button"
                aria-pressed={block.small === small}
                disabled={!editable}
                onClick={() => onChange({ small })}
                className={segmentedButtonClass(block.small === small)}
              >
                {small ? "Small, centred" : "Full width"}
              </button>
            ))}
          </div>
        </div>
        <AdminField label="Tapping it opens" htmlFor={`${id}-link`}>
          <LinkPicker
            id={`${id}-link`}
            value={block.link}
            onChange={(link) => onChange({ link })}
            targets={linkTargets}
            noneLabel="Nothing"
            disabled={!editable}
          />
        </AdminField>
      </div>
    </div>
  );
}

/**
 * Review quote controls: stars, the words (or the reader's own review) and who said it.
 * @param props - Component props.
 * @param props.block - The quote.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @returns The controls.
 */
export function QuoteFields({
  block,
  onChange,
  editable,
}: FieldsProps<BlockOf<"quote">>): React.ReactElement {
  const id = useId();
  const ownReview = block.text.trim() === "{reviewText}";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold text-admin-text">Stars</span>
        <div className={SEGMENTED_GROUP_CLS} role="group" aria-label="Stars">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={block.stars === n}
              aria-label={n === 0 ? "No stars" : `${n} stars`}
              disabled={!editable}
              onClick={() => onChange({ stars: n })}
              className={segmentedButtonClass(block.stars === n)}
            >
              {n === 0 ? "None" : n}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className={ADMIN_CHECKBOX_CLS}
          checked={ownReview}
          disabled={!editable}
          onChange={(e) => onChange({ text: e.target.checked ? "{reviewText}" : "", name: "" })}
        />
        <span>
          Quote each person&apos;s own review. Only works when the email goes to people who left a
          review on the site; anyone without one gets no quote.
        </span>
      </label>
      {!ownReview && (
        <>
          <AdminField label="What they said" htmlFor={`${id}-text`}>
            <AdminTextarea
              id={`${id}-text`}
              rows={3}
              placeholder="Sorted my printer and showed me how to back up my photos."
              value={block.text}
              disabled={!editable}
              onChange={(e) => onChange({ text: e.target.value }, `${block.id}:text`)}
            />
          </AdminField>
          <AdminField label="Who said it (optional)" htmlFor={`${id}-name`}>
            <AdminInput
              id={`${id}-name`}
              placeholder="Pat, Avondale"
              value={block.name}
              disabled={!editable}
              maxLength={80}
              onChange={(e) => onChange({ name: e.target.value }, `${block.id}:name`)}
            />
          </AdminField>
        </>
      )}
    </div>
  );
}

/** Opacity of the navy wash on a big box photo: dark enough for white words on any photo. */
const BOX_PHOTO_SHADE = 0.55;

/** The operator's own photo, the one on the About page, for "Use my photo". */
const OWN_PHOTO_PATH = "/source/harrison-2026.jpg";

/** A big box headline past this length wraps onto three lines on a phone. */
const LONG_BOX_HEADLINE = 40;

/** Shadow under the box's white words, matching the email's. */
const BOX_SHADOW_CLS = "[text-shadow:0_1px_3px_rgba(0,0,0,.45)]";

/**
 * Big box controls: a small copy of the box, the photo behind it (uploaded, the
 * operator's own, or none for the plain colour), the headline, smaller lines and an
 * optional button. Photos are darkened as they upload, so white words read on them.
 * @param props - Component props.
 * @param props.block - The box.
 * @param props.onChange - Reports a change.
 * @param props.editable - Whether it can be changed.
 * @param props.canUpload - Whether picture uploads are set up.
 * @param props.linkTargets - Pages the button can go to.
 * @returns The controls.
 */
export function BoxFields({
  block,
  onChange,
  editable,
  canUpload,
  linkTargets,
}: FieldsProps<BlockOf<"box">> & {
  canUpload: boolean;
  linkTargets: LinkTarget[];
}): React.ReactElement {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, busy } = usePictureUpload();
  const { toast } = useToast();

  /**
   * Darkens and uploads a photo, then puts it behind the box.
   * @param file - The photo.
   */
  async function setPhoto(file: File): Promise<void> {
    const url = await upload(file, BOX_PHOTO_SHADE);
    if (fileRef.current) fileRef.current.value = "";
    if (url) onChange({ photo: url });
  }

  /** Fetches the operator's own photo from the site and uses it. */
  async function setOwnPhoto(): Promise<void> {
    const res = await fetch(OWN_PHOTO_PATH).catch(() => null);
    if (!res?.ok) {
      toast("Couldn't load your photo.", { tone: "error" });
      return;
    }
    const blob = await res.blob();
    await setPhoto(new File([blob], "harrison.jpg", { type: blob.type || "image/jpeg" }));
  }

  const uploadTitle = canUpload ? undefined : "Picture uploads need BLOB_READ_WRITE_TOKEN set";
  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-xl bg-moonstone-700 bg-cover bg-center px-4 py-6 text-center text-white"
        style={block.photo ? { backgroundImage: `url("${block.photo}")` } : undefined}
      >
        <p className={cn("text-2xl leading-tight font-extrabold", BOX_SHADOW_CLS)}>
          {block.headline.trim() || "Your headline"}
        </p>
        {block.line.trim() && (
          <p className={cn("mt-2 text-base whitespace-pre-line", BOX_SHADOW_CLS)}>
            {block.line.trim()}
          </p>
        )}
        {block.label.trim() && (
          <span className="mt-4 inline-block rounded-lg bg-white px-5 py-2 font-bold text-russian-violet">
            {block.label.trim()}
          </span>
        )}
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-admin-text">Behind it</span>
          <AdminButton
            size="sm"
            variant="secondary"
            busy={busy}
            disabled={!canUpload}
            title={uploadTitle}
            onClick={() => fileRef.current?.click()}
          >
            Upload a photo
          </AdminButton>
          <AdminButton
            size="sm"
            variant="secondary"
            disabled={!canUpload || busy}
            title={uploadTitle}
            onClick={() => void setOwnPhoto()}
          >
            Use my photo
          </AdminButton>
          {block.photo && (
            <AdminButton size="sm" variant="secondary" onClick={() => onChange({ photo: "" })}>
              No photo
            </AdminButton>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void setPhoto(file);
            }}
          />
        </div>
      )}
      <AdminField label="Headline" htmlFor={`${id}-headline`}>
        <AdminInput
          id={`${id}-headline`}
          placeholder="Lock in today's rate"
          value={block.headline}
          disabled={!editable}
          maxLength={100}
          onChange={(e) => onChange({ headline: e.target.value }, `${block.id}:headline`)}
        />
        {editable && block.headline.trim().length > LONG_BOX_HEADLINE && (
          <p className="mt-1 text-sm text-amber-700">
            Short is better: big words wrap onto several lines on a phone.
          </p>
        )}
      </AdminField>
      <AdminField label="Smaller words under it (optional)" htmlFor={`${id}-line`}>
        <AdminTextarea
          id={`${id}-line`}
          rows={2}
          placeholder="Book before the end of the month"
          value={block.line}
          disabled={!editable}
          maxLength={300}
          onChange={(e) => onChange({ line: e.target.value }, `${block.id}:line`)}
        />
      </AdminField>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminField label="Button words (optional)" htmlFor={`${id}-label`}>
          <AdminInput
            id={`${id}-label`}
            placeholder="Book a time"
            value={block.label}
            disabled={!editable}
            maxLength={60}
            onChange={(e) => onChange({ label: e.target.value }, `${block.id}:label`)}
          />
        </AdminField>
        <AdminField label="Where the button goes" htmlFor={`${id}-url`}>
          <LinkPicker
            id={`${id}-url`}
            value={block.url}
            onChange={(url) => onChange({ url })}
            targets={linkTargets}
            disabled={!editable}
          />
        </AdminField>
      </div>
    </div>
  );
}

/**
 * The promo card's live wording, or a note that it's left out while no promo runs.
 * @param props - Component props.
 * @param props.promo - Today's promo wording, or null.
 * @returns The preview.
 */
export function PromoFields({ promo }: { promo: PromoWording | null }): React.ReactElement {
  if (!promo) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        No promo is running, so this card is left out of the email until one is.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-moonstone-500 bg-moonstone-50 px-4 py-3 text-center">
      <p className="text-lg font-bold text-russian-violet">{promo.offer}</p>
      <p className="text-sm text-admin-text-secondary">
        Ends {promo.ends}
        {promo.restriction ? `, ${promo.restriction} only` : ""}
      </p>
      <p className="mt-1 text-sm text-admin-muted">Filled in from the live promo when it sends.</p>
    </div>
  );
}

/** What the blocks with no settings look like, in the card. */
export const STATIC_BLOCK_NOTES = {
  divider: "A thin line across the email.",
  spacer: "An empty gap, to give the next part some room.",
  social: "Find us on Google · Facebook · Instagram",
} as const;
