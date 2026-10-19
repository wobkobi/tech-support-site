"use client";
// src/features/admin/components/GlobalSearch.tsx
// Admin-wide search dialog (ARIA combobox over /api/admin/search) and its keyboard shortcut.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { Modal } from "@/features/admin/components/ui/Modal";
import type { SearchGroups, SearchHit } from "@/features/admin/lib/global-search";
import { apiFetch } from "@/shared/lib/api-client";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";

/** Mirrors global-search.ts, which is server-only; the route enforces both again. */
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;

/** Pause after the last keystroke before a request goes out. */
const DEBOUNCE_MS = 200;

/** Result groups in display order. Empty groups are skipped. */
const GROUPS: readonly { key: keyof SearchGroups; label: string }[] = [
  { key: "contacts", label: "Contacts" },
  { key: "bookings", label: "Bookings" },
  { key: "invoices", label: "Invoices" },
  { key: "reviews", label: "Reviews" },
];

/** The answer for one query: its groups, or the error it failed with. */
interface SearchResponse {
  /** The trimmed query this answers. */
  q: string;
  groups?: SearchGroups;
  error?: string;
}

/** Props for {@link GlobalSearch}. */
interface GlobalSearchProps {
  /** Whether the dialog is shown. */
  open: boolean;
  /** Closes the dialog (Escape, backdrop, close button, or after opening a hit). */
  onClose: () => void;
}

/**
 * Stable key for a hit, unique across groups.
 * @param hit - The search hit.
 * @returns "type-id".
 */
function hitKey(hit: SearchHit): string {
  return `${hit.type}-${hit.id}`;
}

/**
 * Whether a key press lands in a text field, where "/" must type a slash.
 * @param target - The keydown event's target.
 * @returns True for inputs, textareas, selects and editable content.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/**
 * Whether a visible dialog is showing; a mounted but hidden one doesn't count.
 * @returns True when an open dialog is on screen.
 */
function isDialogOpen(): boolean {
  return [...document.querySelectorAll('[role="dialog"], dialog[open]')].some(
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Whether the browser runs on an Apple platform (shortcut is Cmd+K). iPadOS reports "Macintosh".
 * @returns True on macOS and iOS.
 */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

/**
 * Opens search on Cmd+K (Apple) or Ctrl+K (elsewhere), or "/" outside text fields;
 * both are swallowed while a dialog is open. Shift is allowed since some layouts need it for "/".
 * @param onOpen - Opens the search dialog.
 */
export function useGlobalSearchShortcut(onOpen: () => void): void {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });

  useEffect(() => {
    /**
     * Matches the two shortcuts.
     * @param e - The keyboard event.
     */
    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.isComposing) return;
      const mod = isApplePlatform() ? e.metaKey : e.ctrlKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!isDialogOpen()) onOpenRef.current();
        return;
      }
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e.target) &&
        !isDialogOpen()
      ) {
        e.preventDefault();
        onOpenRef.current();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Admin search dialog: debounced, each request aborts the last, old results stay dimmed
 * while loading. Hits stay real links so Tab and the {@link Modal} focus trap still work.
 * @param props - Component props.
 * @param props.open - Whether the dialog is shown.
 * @param props.onClose - Closes the dialog.
 * @returns The search dialog.
 */
export function GlobalSearch({ open, onClose }: GlobalSearchProps): React.ReactElement {
  const router = useRouter();
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  // Tracked by key rather than index so the highlight follows a hit when the list changes.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the same query.
  const [attempt, setAttempt] = useState(0);

  // Closing wipes the query and results so the next open starts clean.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setQuery("");
      setResponse(null);
      setActiveKey(null);
    }
  }

  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  const tooShort = trimmed.length < MIN_QUERY_LENGTH;
  const current = !tooShort && response?.q === trimmed ? response : null;
  const loading = !tooShort && current === null;
  const error = current?.error ?? null;
  // While the next query loads, the previous results stay up so the list doesn't flash empty.
  const shown = tooShort || error ? null : (current?.groups ?? response?.groups ?? null);

  const sections = shown
    ? GROUPS.map((g) => ({ ...g, hits: shown[g.key] })).filter((s) => s.hits.length > 0)
    : [];
  const flat = sections.flatMap((s) => s.hits);
  const found = flat.findIndex((h) => hitKey(h) === activeKey);
  const activeIndex = flat.length === 0 ? -1 : Math.max(found, 0);
  const activeHit = flat[activeIndex] ?? null;
  const activeOptionId = activeHit ? `${baseId}-opt-${hitKey(activeHit)}` : undefined;

  // Runs after Modal's open effect (children first), moving focus on into the box.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || trimmed.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void apiFetch<{ groups: SearchGroups }>(
        `/api/admin/search?q=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal, credentials: "same-origin" },
      ).then((res) => {
        // An aborted request resolves as a network error; a newer query owns the state now.
        if (controller.signal.aborted) return;
        setResponse(
          res.ok ? { q: trimmed, groups: res.data.groups } : { q: trimmed, error: res.error },
        );
      });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, trimmed, attempt]);

  useEffect(() => {
    if (activeOptionId)
      document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  /**
   * Stores the typed query; dropping under the minimum clears stale results.
   * @param e - The input change event.
   */
  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = e.target.value;
    setQuery(next);
    if (next.trim().length < MIN_QUERY_LENGTH) setResponse(null);
  }

  /**
   * Navigates to a hit and closes the dialog.
   * @param hit - The hit to open.
   */
  function openHit(hit: SearchHit): void {
    router.push(hit.href);
    onClose();
  }

  /**
   * Combobox keys: arrows move the active hit (wrapping); Enter opens it once loaded,
   * never a stale hit. Escape and Tab are left to {@link Modal}.
   * @param e - The keyboard event.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (flat.length === 0) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = flat[(activeIndex + step + flat.length) % flat.length];
      if (next) setActiveKey(hitKey(next));
    } else if (e.key === "Enter" && activeHit && !loading) {
      e.preventDefault();
      openHit(activeHit);
    }
  }

  /**
   * Re-runs the failed query, refocusing the box since the button disappears.
   */
  function retry(): void {
    setResponse(null);
    setAttempt((n) => n + 1);
    inputRef.current?.focus();
  }

  const hitCount = flat.length;
  // Screen-reader summary; empty when idle or on error (the alert announces itself).
  let liveText = "";
  if (loading) liveText = "Searching";
  else if (current && !error) {
    liveText =
      hitCount === 0 ? "No matches" : `${hitCount} ${hitCount === 1 ? "result" : "results"}`;
  }

  return (
    <Modal open={open} onClose={onClose} title="Search" size="lg" placement="top">
      {/* Pinned while results scroll; negative margins cover the body padding. */}
      <div className="sticky top-0 z-10 -mx-5 -mt-4 bg-admin-surface px-5 pt-4 pb-3">
        <AdminInput
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-label="Search contacts, bookings, invoices and reviews"
          aria-autocomplete="list"
          aria-expanded={hitCount > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          placeholder="Search contacts, bookings, invoices, reviews"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={MAX_QUERY_LENGTH}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
        />
      </div>

      <p role="status" className="sr-only">
        {liveText}
      </p>

      {tooShort && (
        <p className="py-2 text-[0.9375rem] text-admin-text-secondary">
          Type at least {MIN_QUERY_LENGTH} characters. Search by name, email, phone number, address,
          company or invoice number.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-l-4 border-admin-border border-l-coquelicot-600 bg-coquelicot-50 px-4 py-3"
        >
          <p className="text-[0.9375rem] font-bold text-coquelicot-800">{error}</p>
          <AdminButton variant="secondary" size="sm" onClick={retry}>
            Try again
          </AdminButton>
        </div>
      )}

      {loading && !shown && (
        <p className="py-2 text-[0.9375rem] text-admin-text-secondary">Searching...</p>
      )}

      {current && !error && hitCount === 0 && (
        <EmptyState
          title={`No matches for "${trimmed}"`}
          body="Try part of a name, an email, a phone number or an invoice number."
        />
      )}

      <div
        role="listbox"
        id={listboxId}
        aria-label="Search results"
        aria-busy={loading}
        hidden={hitCount === 0}
        className={cn("space-y-4 transition-opacity", loading && "opacity-60")}
      >
        {sections.map((section) => {
          const headingId = `${baseId}-${section.key}`;
          return (
            <div key={section.key} role="group" aria-labelledby={headingId}>
              <p id={headingId} role="presentation" className={cn(ADMIN_EYEBROW_CLS, "mb-1 px-3")}>
                {section.label}
              </p>
              {section.hits.map((hit) => {
                const key = hitKey(hit);
                const selected = hit === activeHit;
                return (
                  <Link
                    key={key}
                    id={`${baseId}-opt-${key}`}
                    href={hit.href}
                    prefetch={false}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => {
                      if (!selected) setActiveKey(key);
                    }}
                    onClick={(e) => {
                      // A modified click opens a new tab; leave the dialog up for the next one.
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
                        return;
                      }
                      onClose();
                    }}
                    className={cn(
                      "flex min-w-0 scroll-mt-20 scroll-mb-2 flex-col justify-center rounded-md px-3 py-2 pointer-coarse:min-h-11",
                      selected ? "bg-moonstone-50 ring-2 ring-moonstone-600 ring-inset" : "",
                    )}
                  >
                    <span className="truncate text-[0.9375rem] font-bold text-admin-text">
                      {hit.title}
                    </span>
                    {hit.sub && (
                      <span className="truncate text-sm text-admin-muted">{hit.sub}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>

      {hitCount > 0 && (
        <p className="mt-4 hidden text-sm text-admin-muted pointer-fine:block">
          Use the arrow keys to move through results and Enter to open one.
        </p>
      )}
    </Modal>
  );
}
