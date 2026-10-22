"use client";
// src/features/social/components/TagPicker.tsx
// Tags on a post: chips for the ones it has, and a box that finds a tag or adds a new one in a
// colour. The box follows the ARIA combobox pattern, so arrows, Enter and Escape work.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import {
  MAX_POST_TAGS,
  MAX_TAG_NAME,
  TAG_COLOURS,
  TAG_COLOUR_KEYS,
  nextTagColour,
  tagKey,
  tagName,
  type SocialTagRow,
  type TagColour,
} from "@/features/social/lib/tags";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useId, useRef, useState } from "react";
import { FaXmark } from "react-icons/fa6";

/** Matches shown in the list at once. */
const MAX_MATCHES = 8;

/** One row in the list: a tag to put on, or a new one to add. */
type Option = { kind: "tag"; tag: SocialTagRow } | { kind: "new"; name: string };

/**
 * A name folded for matching: tidied, lowercased and without accents, so "cafe" finds "Café".
 * @param name - Name or search text.
 * @returns The folded text.
 */
function fold(name: string): string {
  return tagKey(name).normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * One tag as a coloured chip, with a button to take it off when onRemove is given.
 * @param props - Component props.
 * @param props.tag - The tag's name and colour.
 * @param props.onRemove - Takes the tag off; leave out for a plain chip.
 * @param props.className - Extra classes.
 * @returns Chip element.
 */
export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: Pick<SocialTagRow, "name" | "colour">;
  onRemove?: () => void;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-1 rounded-full border px-2.5 text-sm font-semibold",
        TAG_COLOURS[tag.colour].chip,
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Take off ${tag.name}`}
          className="relative -mr-1 grid size-5 shrink-0 place-items-center rounded-full after:absolute after:-inset-2 after:content-[''] hover:bg-black/10"
        >
          <FaXmark aria-hidden className="size-3" />
        </button>
      )}
    </span>
  );
}

/**
 * A post's first few tags as plain chips, then "+N" for the rest. Deleted tags are skipped.
 * @param props - Component props.
 * @param props.ids - The post's tag ids.
 * @param props.tagsById - Every tag, by id.
 * @param props.max - Chips shown before "+N".
 * @returns Chip row, or null when the post has no tags.
 */
export function TagChipRow({
  ids,
  tagsById,
  max = 3,
}: {
  ids: readonly string[];
  tagsById: ReadonlyMap<string, SocialTagRow>;
  max?: number;
}): React.ReactElement | null {
  const tags = ids.map((i) => tagsById.get(i)).filter((t): t is SocialTagRow => t !== undefined);
  if (tags.length === 0) return null;
  const more = tags.length - max;
  return (
    <span className="flex max-w-full flex-wrap items-center gap-1">
      {tags.slice(0, max).map((t) => (
        <TagChip key={t.id} tag={t} className="h-6 px-2" />
      ))}
      {more > 0 && <span className="text-sm text-admin-muted">+{more}</span>}
    </span>
  );
}

/**
 * Colour swatches as a radio group.
 * @param props - Component props.
 * @param props.label - What the colours are for, read out by screen readers.
 * @param props.value - The colour picked.
 * @param props.onChange - Called with the colour clicked.
 * @param props.disabled - Greys the swatches out.
 * @returns Swatch row element.
 */
export function TagColourPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: TagColour;
  onChange: (colour: TagColour) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {TAG_COLOUR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={TAG_COLOURS[c].label}
          title={TAG_COLOURS[c].label}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={cn(
            "grid size-8 place-items-center rounded-full border-2 transition-colors disabled:opacity-50",
            value === c
              ? "border-russian-violet"
              : "border-transparent hover:border-admin-border-strong",
          )}
        >
          <span aria-hidden className={cn("size-5 rounded-full", TAG_COLOURS[c].dot)} />
        </button>
      ))}
    </div>
  );
}

/**
 * The tag picker.
 * @param props - Component props.
 * @param props.tags - Every tag there is.
 * @param props.value - Ids of the tags on the post.
 * @param props.onChange - Called with the post's new tag ids.
 * @param props.onCreate - Adds a tag (or finds the one with the name) and returns it, or null.
 * @returns Picker element.
 */
export function TagPicker({
  tags,
  value,
  onChange,
  onCreate,
}: {
  tags: SocialTagRow[];
  value: string[];
  onChange: (ids: string[]) => void;
  onCreate: (name: string, colour: TagColour) => Promise<SocialTagRow | null>;
}): React.ReactElement {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [colour, setColour] = useState<TagColour | null>(null);
  const [creating, setCreating] = useState(false);

  const byId = new Map(tags.map((t) => [t.id, t]));
  const onPost = value.map((v) => byId.get(v)).filter((t): t is SocialTagRow => t !== undefined);
  const full = onPost.length >= MAX_POST_TAGS;
  const typed = tagName(query);
  const wanted = fold(query);
  const matches = tags
    .filter((t) => !value.includes(t.id) && fold(t.name).includes(wanted))
    .slice(0, MAX_MATCHES);
  const exists = typed !== "" && tags.some((t) => tagKey(t.name) === tagKey(typed));
  const options: Option[] = [
    ...matches.map((tag): Option => ({ kind: "tag", tag })),
    ...(typed && !exists && typed.length <= MAX_TAG_NAME
      ? [{ kind: "new", name: typed } as const]
      : []),
  ];
  const shown = open && options.length > 0;
  const current = Math.min(active, options.length - 1);
  const newColour = colour ?? nextTagColour(tags.map((t) => t.colour));
  const listId = `${id}-list`;

  /**
   * Puts a tag on the post, or adds the new one first.
   * @param option - The row picked.
   */
  async function choose(option: Option): Promise<void> {
    if (option.kind === "tag") {
      onChange([...value, option.tag.id]);
    } else {
      setCreating(true);
      const tag = await onCreate(option.name, newColour);
      setCreating(false);
      if (!tag) return;
      if (!value.includes(tag.id)) onChange([...value, tag.id]);
      setColour(null);
    }
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  /**
   * Arrows move through the list, Enter picks, Escape closes it, and Backspace in an empty box
   * takes off the last tag.
   * @param e - The key event.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive(shown ? (current + 1) % options.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive(shown ? (current - 1 + options.length) % options.length : options.length - 1);
    } else if (e.key === "Enter") {
      const option = shown ? options[current] : undefined;
      if (!option) return;
      e.preventDefault();
      if (!creating) void choose(option);
    } else if (e.key === "Escape") {
      if (shown) {
        e.preventDefault();
        setOpen(false);
      } else if (query) {
        e.preventDefault();
        setQuery("");
      }
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  /**
   * Closes the list once focus leaves the picker, but not when it moves to a swatch.
   * @param e - The blur event.
   */
  function onBlur(e: React.FocusEvent<HTMLDivElement>): void {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }

  return (
    <div className="flex flex-col gap-2" onBlur={onBlur}>
      <label htmlFor={`${id}-input`} className={cn(ADMIN_LABEL_CLS, "mb-0")}>
        Tags (only you see these)
      </label>
      {onPost.length > 0 && (
        <ul aria-label="Tags on this post" className="flex flex-wrap gap-1.5">
          {onPost.map((t) => (
            <li key={t.id} className="max-w-full">
              <TagChip tag={t} onRemove={() => onChange(value.filter((v) => v !== t.id))} />
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <AdminInput
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={shown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown ? `${listId}-${current}` : undefined}
          aria-busy={creating || undefined}
          value={query}
          maxLength={MAX_TAG_NAME + 1}
          disabled={full}
          placeholder={full ? `${MAX_POST_TAGS} tags is the most` : "Find or add a tag"}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="sm:w-80"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Tags"
          hidden={!shown}
          className="absolute top-full left-0 z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-admin-border bg-admin-surface py-1 shadow-lg sm:w-80"
        >
          {options.map((o, i) => (
            <li
              key={o.kind === "tag" ? o.tag.id : "new"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              // Keep focus in the box, so the list stays open and typing carries on.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                if (!creating) void choose(o);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-2 px-3 py-2 text-base text-admin-text",
                i === current && "bg-russian-violet/10",
              )}
            >
              {o.kind === "tag" ? (
                <>
                  <span
                    aria-hidden
                    className={cn("size-3 shrink-0 rounded-full", TAG_COLOURS[o.tag.colour].dot)}
                  />
                  <span className="truncate">{o.tag.name}</span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className={cn("size-3 shrink-0 rounded-full", TAG_COLOURS[newColour].dot)}
                  />
                  <span className="truncate">
                    {creating ? "Adding" : "Add"} <strong>{o.name}</strong> as a new tag
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      {shown && options.some((o) => o.kind === "new") && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-admin-text-secondary">New tag colour</span>
          <TagColourPicker
            label="Colour for the new tag"
            value={newColour}
            onChange={setColour}
            disabled={creating}
          />
        </div>
      )}
      {typed.length > MAX_TAG_NAME && (
        <p className="text-sm text-coquelicot-700">
          Tag names can be {MAX_TAG_NAME} characters at most.
        </p>
      )}
    </div>
  );
}
