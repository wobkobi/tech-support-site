"use client";
// src/features/admin/components/ui/InsertMenu.tsx
// "Add" dropdown for editors: a searchable, grouped list of things to drop into a text
// box at the cursor. Each item says what it inserts, so the list doubles as the help text.

import { cn } from "@/shared/lib/cn";
import React, { useEffect, useId, useRef, useState } from "react";
import { FaChevronDown, FaMagnifyingGlass, FaPlus } from "react-icons/fa6";

/** One thing the menu can add. */
export interface InsertItem {
  label: string;
  /** Shown under the label (or as the tooltip in a compact group): an example of it. */
  hint?: string;
  /** The text that goes in. */
  text: string;
  /** Start on a fresh line. */
  line?: boolean;
}

/** A titled section of the menu. */
export interface InsertGroup {
  label: string;
  items: InsertItem[];
  /** Lay the items out as a row of small buttons, for single characters like emoji. */
  compact?: boolean;
}

/**
 * Narrows the groups to items matching every word of a search. A word can match the
 * item's label, its hint or its group's name, so "symbol" lists every symbol and
 * "phone" finds both the number and the phone emoji.
 * @param groups - All groups.
 * @param query - What was typed.
 * @returns Groups with only matching items; empty groups are dropped.
 */
function filterGroups(groups: InsertGroup[], query: string): InsertGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        const haystack = `${item.label} ${item.hint ?? ""} ${g.label}`.toLowerCase();
        return words.every((w) => haystack.includes(w));
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Dropdown of insertable items with a search box. Closes on a pick, Escape or a click
 * outside. Enter in the search adds the first match; arrow keys move between the
 * search and the items.
 * @param props - Component props.
 * @param props.groups - Sections and their items.
 * @param props.onInsert - Puts a picked item's text into the text box.
 * @param props.label - Button text.
 * @param props.disabled - Disables the whole menu.
 * @param props.align - Which edge of the button the list lines up with; "right" opens leftwards.
 * @returns Menu element.
 */
export function InsertMenu({
  groups,
  onInsert,
  label = "Add",
  disabled = false,
  align = "left",
}: {
  groups: InsertGroup[];
  onInsert: (text: string, line: boolean) => void;
  label?: string;
  disabled?: boolean;
  align?: "left" | "right";
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const shown = filterGroups(groups, query);

  /** Closes the menu and clears the search for next time. */
  function close(): void {
    setOpen(false);
    setQuery("");
  }

  // Focus the search on open, so typing filters straight away.
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    /**
     * Closes the menu when a click lands outside it.
     * @param e - The pointer event.
     */
    const onPointer = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  /**
   * Keyboard handling for the open menu. Escape closes and returns focus to the
   * button. In the search box, Enter adds the first match and Down moves into the
   * list (Home and End stay with the text). In the list, the arrows step through the
   * items, and Up from the first one goes back to the search.
   * @param e - The key event.
   */
  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      buttonRef.current?.focus();
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [],
    );
    if (e.target === searchRef.current) {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = shown[0]?.items[0];
        if (first) pick(first);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        items[0]?.focus();
      }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowUp" && at <= 0) {
      searchRef.current?.focus();
      return;
    }
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : Math.min(items.length - 1, at + (e.key === "ArrowDown" ? 1 : -1));
    items[next]?.focus();
  }

  /**
   * Inserts an item and closes the menu.
   * @param item - The picked item.
   */
  function pick(item: InsertItem): void {
    close();
    onInsert(item.text, item.line ?? false);
  }

  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-admin-border-strong bg-admin-surface px-3 text-sm font-semibold text-admin-text transition-colors hover:bg-admin-bg disabled:opacity-60 pointer-coarse:min-h-11"
      >
        <FaPlus aria-hidden className="size-3" />
        {label}
        <FaChevronDown
          aria-hidden
          className={cn("size-3 transition-[rotate]", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full z-30 mt-1 flex max-h-112 w-80 max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-admin-border bg-admin-surface shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="relative border-b border-admin-border p-1.5">
            <FaMagnifyingGlass
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-admin-muted"
            />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search what to add"
              aria-controls={menuId}
              className="h-9 w-full rounded-lg bg-admin-bg pr-2.5 pl-8 text-sm text-admin-text placeholder:text-admin-muted focus:ring-2 focus:ring-russian-violet/30 focus:outline-none pointer-coarse:h-11"
            />
          </div>
          <div ref={menuRef} id={menuId} role="menu" className="overflow-y-auto p-1.5">
            {shown.length === 0 && (
              <p className="px-2.5 py-2 text-sm text-admin-muted">
                Nothing matches &quot;{query}&quot;.
              </p>
            )}
            {shown.map((g) => (
              <div key={g.label} role="group" aria-label={g.label} className="py-1">
                <p className="px-2.5 pb-1 text-sm font-semibold text-admin-muted">{g.label}</p>
                <div className={cn(g.compact ? "flex flex-wrap gap-1 px-1.5" : "flex flex-col")}>
                  {g.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      title={g.compact ? item.hint : undefined}
                      onClick={() => pick(item)}
                      className={cn(
                        "rounded-lg text-left text-admin-text transition-colors hover:bg-admin-bg focus-visible:bg-admin-bg focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                        g.compact
                          ? "size-9 text-center text-lg pointer-coarse:size-11"
                          : "px-2.5 py-1.5 text-sm pointer-coarse:min-h-11",
                      )}
                    >
                      {g.compact ? (
                        <span aria-label={item.hint ?? item.label}>{item.label}</span>
                      ) : (
                        <>
                          <span className="block font-medium">{item.label}</span>
                          {item.hint && (
                            <span className="block truncate text-admin-muted">{item.hint}</span>
                          )}
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
