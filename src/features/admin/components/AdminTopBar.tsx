"use client";
// src/features/admin/components/AdminTopBar.tsx
// Sticky bar above every admin page: the drawer button (below lg) or the sidebar collapse
// toggle (lg+), the GlobalSearch trigger, and at lg+ the Quick actions menu and Sign out.

import {
  GlobalSearch,
  isApplePlatform,
  useGlobalSearchShortcut,
} from "@/features/admin/components/GlobalSearch";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { adminButtonClass } from "@/features/admin/components/ui/button-classes";
import { ADMIN_CONTROL_CLS } from "@/features/admin/components/ui/field-classes";
import { QUICK_ACTIONS, quickActionHref } from "@/features/admin/lib/quick-actions";
import { signOut } from "@/features/admin/lib/sign-out";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  FaAnglesLeft,
  FaAnglesRight,
  FaArrowRightFromBracket,
  FaBars,
  FaMagnifyingGlass,
  FaPlus,
} from "react-icons/fa6";

/**
 * No-op store subscription: the platform never changes while the page is open.
 * @returns An unsubscribe function that does nothing.
 */
function subscribeNever(): () => void {
  return () => {};
}

/** Props for {@link AdminTopBar}. */
interface AdminTopBarProps {
  /** Whether the desktop sidebar is collapsed to icons. */
  collapsed: boolean;
  /** Flips the desktop sidebar between full and collapsed. */
  onToggleCollapsed: () => void;
  /** Whether the phone drawer is open. */
  drawerOpen: boolean;
  /** Opens the phone drawer. */
  onOpenDrawer: () => void;
  /** The menu button, which gets focus back when the drawer is dismissed. */
  menuButtonRef: React.Ref<HTMLButtonElement>;
}

/**
 * Admin top bar. Sticks to the top of the content column at every width; the
 * drawer backdrop and drawer (z-30/z-40), modals and toasts all sit above it.
 * @param props - Component props.
 * @param props.collapsed - Whether the desktop sidebar is collapsed.
 * @param props.onToggleCollapsed - Collapse toggle handler.
 * @param props.drawerOpen - Whether the phone drawer is open.
 * @param props.onOpenDrawer - Opens the phone drawer.
 * @param props.menuButtonRef - Ref for the phone menu button.
 * @returns The bar element plus the search dialog.
 */
export function AdminTopBar({
  collapsed,
  onToggleCollapsed,
  drawerOpen,
  onOpenDrawer,
  menuButtonRef,
}: AdminTopBarProps): React.ReactElement {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  useGlobalSearchShortcut(() => setSearchOpen(true));

  // Server snapshot is "not Apple", so the first client render matches the HTML and
  // the hint switches to the Cmd glyph straight after hydration.
  const isApple = useSyncExternalStore(subscribeNever, isApplePlatform, () => false);

  const [menuOpen, setMenuOpen] = useState(false);
  // Minted when the menu opens, not at render, so a repeat pick reopens the form.
  const [stamp, setStamp] = useState("");
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const quickButtonRef = useRef<HTMLButtonElement>(null);
  const quickButtonId = useId();
  const menuId = useId();

  /** Opens the Quick actions menu with a fresh stamp. */
  function openMenu(): void {
    setStamp(String(Date.now()));
    setMenuOpen(true);
  }

  /**
   * Closes the Quick actions menu.
   * @param returnFocus - Send focus back to the menu button (Escape).
   */
  function closeMenu(returnFocus: boolean): void {
    setMenuOpen(false);
    if (returnFocus) quickButtonRef.current?.focus();
  }

  // While open: land focus on the first item, and close on a press anywhere outside.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    /**
     * Closes the menu when a press lands outside the button and menu.
     * @param e - The pointer event.
     */
    function onPointerDown(e: PointerEvent): void {
      if (!menuWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  /**
   * Menu keyboard: Escape closes and refocuses the button, ArrowUp/ArrowDown
   * (wrapping) and Home/End move between items, Tab closes and moves on, and
   * ArrowDown on the closed button opens the menu.
   * @param e - The key event, from the button or an item.
   */
  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!menuOpen) {
      if (e.key === "ArrowDown" && e.target === quickButtonRef.current) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    if (e.key === "Tab") {
      setMenuOpen(false);
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const count = items.length;
    if (count === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (at + 1) % count;
    else if (e.key === "ArrowUp") next = at <= 0 ? count - 1 : at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  }

  return (
    <>
      <header className="sticky top-0 z-25 flex h-14 items-center gap-3 border-b border-admin-border bg-admin-surface px-4 sm:px-6 print:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onOpenDrawer}
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          aria-controls="admin-sidebar"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-russian-violet text-white lg:hidden"
        >
          <FaBars aria-hidden className="text-base" />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="admin-sidebar"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-md text-admin-text-secondary transition-colors hover:bg-admin-bg hover:text-admin-text lg:inline-flex pointer-coarse:size-11"
        >
          {collapsed ? <FaAnglesRight aria-hidden /> : <FaAnglesLeft aria-hidden />}
        </button>

        {/* Styled as a field so it reads as "type here", but it opens the search dialog. */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-haspopup="dialog"
          aria-label="Search"
          aria-keyshortcuts={isApple ? "Meta+K /" : "Control+K /"}
          className={cn(
            ADMIN_CONTROL_CLS,
            "flex min-w-0 flex-1 items-center gap-2 text-left text-admin-muted hover:border-russian-violet lg:max-w-md pointer-coarse:min-h-11",
          )}
        >
          <FaMagnifyingGlass aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search</span>
          <kbd className="hidden shrink-0 rounded border border-admin-border bg-admin-bg px-1.5 font-sans text-sm text-admin-muted sm:inline">
            {isApple ? "⌘ K" : "Ctrl K"}
          </kbd>
        </button>

        {/* Phones get the same shortcuts from the + button instead. */}
        <div className="ml-auto hidden shrink-0 items-center gap-2 lg:flex">
          <div ref={menuWrapRef} className="relative" onKeyDown={onMenuKeyDown}>
            {/* AdminButton's primary look on a native button, since AdminButton has no way to take the menu-button ARIA or a ref. */}
            <button
              ref={quickButtonRef}
              id={quickButtonId}
              type="button"
              onClick={() => (menuOpen ? closeMenu(false) : openMenu())}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              className={adminButtonClass({ variant: "primary" })}
            >
              <FaPlus aria-hidden className="text-sm" />
              Quick actions
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-labelledby={quickButtonId}
                className="absolute top-full right-0 mt-2 w-56 rounded-lg border border-admin-border bg-admin-surface p-1 shadow-lg"
              >
                {QUICK_ACTIONS.map((a) => (
                  <Link
                    key={a.label}
                    href={quickActionHref(a, stamp)}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-[0.9375rem] font-semibold text-admin-text transition-colors hover:bg-admin-bg focus:bg-admin-bg pointer-coarse:min-h-11"
                  >
                    <a.icon aria-hidden className="shrink-0 text-russian-violet" />
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <AdminButton variant="ghost" size="sm" onClick={() => void signOut(router)}>
            <FaArrowRightFromBracket aria-hidden />
            Sign out
          </AdminButton>
        </div>
      </header>

      {/* Outside the header, whose z-index would otherwise cap the dialog's. */}
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
