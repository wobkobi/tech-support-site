"use client";
// src/features/admin/components/MobileQuickActions.tsx
// Round + button pinned bottom-right below lg, opening a short list of shortcuts from
// QUICK_ACTIONS (shared with the desktop top bar and the phone tab bar). It shows only on
// pages with their own phone action bar, which hides AdminTabBar (globals.css). It rides above a
// phone action bar through --phone-bar-h (globals.css), the same variable that lifts the
// toast stack; that height already includes the home indicator, so the larger of the two
// is used rather than their sum.

import { QUICK_ACTIONS, quickActionHref } from "@/features/admin/lib/quick-actions";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";
import { useEffect, useState } from "react";
import { FaPlus } from "react-icons/fa6";

/**
 * Mobile shortcut button and its menu.
 * @returns Quick actions element (hidden at lg and up).
 */
export function MobileQuickActions(): React.ReactElement {
  const [open, setOpen] = useState(false);
  // Set when the menu opens, not at render, so it differs on every tap.
  const [stamp, setStamp] = useState("");

  useEffect(() => {
    if (!open) return;
    /**
     * Closes the menu on Escape.
     * @param e - Key event.
     */
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /** Opens or closes the menu, minting a fresh stamp on open. */
  function toggle(): void {
    if (!open) setStamp(String(Date.now()));
    setOpen((o) => !o);
  }

  return (
    <div className="admin-quick-actions lg:hidden print:hidden">
      {/* Tap-away layer; transparent so the page stays visible behind the menu. */}
      {open && <div aria-hidden className="fixed inset-0 z-25" onClick={() => setOpen(false)} />}
      <div className="fixed right-4 bottom-[calc(1rem+max(env(safe-area-inset-bottom),var(--phone-bar-h,0px)))] z-25 flex flex-col items-end gap-3">
        {open && (
          <nav aria-label="Quick actions">
            <ul className="flex flex-col-reverse gap-2">
              {QUICK_ACTIONS.map((a) => (
                <li key={a.label}>
                  <Link
                    href={quickActionHref(a, stamp)}
                    onClick={() => setOpen(false)}
                    className="flex h-12 items-center gap-3 rounded-full border border-admin-border bg-admin-surface pr-5 pl-4 text-base font-semibold text-russian-violet shadow-lg"
                  >
                    <span className="text-lg">
                      <a.icon aria-hidden />
                    </span>
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? "Close quick actions" : "Quick actions"}
          aria-expanded={open}
          className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-russian-violet text-white shadow-lg"
        >
          <FaPlus
            aria-hidden
            className={cn("text-xl transition-[rotate] duration-200", open && "rotate-45")}
          />
        </button>
      </div>
    </div>
  );
}
