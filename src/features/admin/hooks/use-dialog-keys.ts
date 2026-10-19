"use client";
// src/features/admin/hooks/use-dialog-keys.ts
// Admin dialog keys: Escape dismisses and Tab stays inside the dialog.

import { type RefObject, useEffect, useRef } from "react";

/** Open dialogs, oldest first; only the top one answers Escape and Tab. */
const openStack: symbol[] = [];

/** Everything Tab can land on. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `open`, Escape calls `onEscape` and Tab wraps inside `ref`. `onEscape` is read
 * fresh per key press, so an inline arrow never re-subscribes.
 * @param ref - The dialog panel.
 * @param open - Whether the dialog is showing.
 * @param onEscape - Dismiss handler for the Escape key.
 */
export function useDialogKeys(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onEscape: () => void,
): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const self = Symbol("dialog");
    openStack.push(self);

    /**
     * Routes Escape and Tab for the top dialog only.
     * @param e - The keyboard event.
     */
    function onKey(e: KeyboardEvent): void {
      if (openStack.at(-1) !== self) return;
      if (e.key === "Escape") {
        onEscapeRef.current();
        return;
      }
      const panel = ref.current;
      if (e.key !== "Tab" || !panel) return;
      // Hidden controls (a collapsed section, a display:none tab) report no boxes.
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      );
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = panel.contains(active);
      if (e.shiftKey && (!inside || active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      openStack.splice(openStack.indexOf(self), 1);
    };
  }, [open, ref]);
}
