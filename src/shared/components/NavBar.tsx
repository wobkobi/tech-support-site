// src/shared/components/NavBar.tsx
// Sticky site header: logo, primary links, phone number and Book now. Below xl the links
// fold into a Menu panel under the header.

"use client";

import { Button } from "@/shared/components/Button";
import { CONTAINER } from "@/shared/components/Section";
import { cn } from "@/shared/lib/cn";
import { isPrintRoute } from "@/shared/lib/print-routes";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface NavItem {
  label: string;
  href: string;
}

/** Path prefixes that hide the public header (admin has its own sidebar). */
const HIDDEN_PREFIXES: ReadonlyArray<string> = ["/admin"];

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { label: "Services", href: "/services" },
  { label: "Business", href: "/business" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
  { label: "FAQ", href: "/faq" },
  { label: "Reviews", href: "/reviews" },
  { label: "Contact", href: "/contact" },
];

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether the path sits at or under a nav item's route.
 * @param pathname - Current path.
 * @param prefix - The item's href.
 * @returns True when the item is the current section.
 */
function isActivePrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Props for {@link NavBar}. */
export interface NavBarProps {
  /** Display phone number from identity settings. */
  phone: string;
  /** tel: URI from identity settings. */
  phoneTel: string;
}

/**
 * Site header.
 * @param props - Component props.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: URI for the phone link.
 * @returns The header, or null on admin and print routes.
 */
export function NavBar({ phone, phoneTel }: NavBarProps): React.ReactElement | null {
  const pathname = usePathname();
  // Keyed to the pathname so a route change closes the menu without an effect.
  const [menuState, setMenuState] = useState<{ open: boolean; pathname: string }>({
    open: false,
    pathname,
  });
  const menuOpen = menuState.open && menuState.pathname === pathname;

  const panelRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback((): void => {
    setMenuState({ open: false, pathname });
  }, [pathname]);

  const toggleMenu = useCallback((): void => {
    setMenuState({ open: !menuOpen, pathname });
  }, [menuOpen, pathname]);

  // Focus trap, Escape to close, and focus restore for the open panel.
  useEffect(() => {
    if (!menuOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const menuButton = menuButtonRef.current;
    // Fit the panel between the header's bottom edge and the bottom of the screen. The
    // header sits lower while the promo banner above it is still in view, so a fixed
    // calc would push the last links off a short phone.
    const headerBottom = panel.parentElement?.getBoundingClientRect().bottom ?? 0;
    panel.style.maxHeight = `${Math.max(0, window.innerHeight - headerBottom)}px`;
    // preventScroll keeps the page where it is; every focus move in the menu uses it.
    panel.querySelectorAll<HTMLElement>(FOCUSABLE)[0]?.focus({ preventScroll: true });

    /**
     * Panel-scoped key handler: Escape closes, Tab cycles within the panel.
     * @param e - Keyboard event from the document listener.
     */
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key !== "Tab") return;
      const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      // Return to the Menu button itself, not whatever had focus before: Safari doesn't
      // focus a button on tap, so that would be the page body.
      menuButton?.focus({ preventScroll: true });
    };
  }, [menuOpen, closeMenu]);

  // Lock page scroll while the panel is open, and flag it on <body> so the phone bar
  // (globals.css) hides instead of stacking under the panel. The lock is overflow on
  // <html>, which keeps the viewport as the scroller. Pinning <body> with position:
  // fixed would shift it up by the scroll offset and carry the sticky header (and the
  // panel inside it) off the top of the screen.
  useEffect(() => {
    if (!menuOpen) return;
    const root = document.documentElement;
    const body = document.body;
    body.setAttribute("data-nav-open", "");
    root.style.overflow = "hidden";
    // Widening to xl (a tablet turned landscape) hides the panel, so close the menu
    // too, or the page would stay locked with nothing open.
    const wide = window.matchMedia("(min-width: 80rem)");
    /** Closes the menu once the window widens to xl. */
    const closeIfWide = (): void => {
      if (wide.matches) closeMenu();
    };
    wide.addEventListener("change", closeIfWide);
    return () => {
      wide.removeEventListener("change", closeIfWide);
      body.removeAttribute("data-nav-open");
      root.style.overflow = "";
    };
  }, [menuOpen, closeMenu]);

  if (isPrintRoute(pathname)) return null;
  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const bookingActive = isActivePrefix(pathname, "/booking");

  return (
    <header className="sticky top-0 z-50 border-b border-seasalt-100 bg-white print:hidden">
      <div className={cn(CONTAINER, "flex items-center justify-between gap-6 py-3")}>
        <Link href="/" className="shrink-0">
          <Image
            src="/source/logo-wordmark.svg"
            alt="To the Point Tech - home"
            width={2000}
            height={674}
            preload
            className="h-12 w-auto sm:h-17"
          />
        </Link>

        <nav aria-label="Primary navigation" className="hidden items-center gap-6 xl:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActivePrefix(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-base font-semibold whitespace-nowrap hover:text-coquelicot-700",
                  active && "text-coquelicot-700 underline decoration-[3px] underline-offset-8",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-4">
          {/* Plain tel: anchor so GoogleTag's delegated listener records the call. */}
          <a
            href={phoneTel}
            className="hidden text-right leading-tight font-extrabold whitespace-nowrap sm:block sm:text-lg"
          >
            <span className="block text-sm font-semibold text-seasalt-700">Call or text</span>
            {phone}
          </a>
          <Button
            href="/booking"
            variant="primary"
            className="hidden sm:inline-flex"
            aria-current={bookingActive ? "page" : undefined}
          >
            Book now
          </Button>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={toggleMenu}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            className="min-h-11 rounded-md border-2 border-russian-violet px-3 font-bold text-russian-violet xl:hidden"
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {/* The panel and its backdrop hang below the header, over the page, so opening the
          menu moves nothing; tapping the dimmed page closes it. */}
      {menuOpen && (
        <div
          aria-hidden
          onClick={closeMenu}
          className="absolute inset-x-0 top-full h-dvh bg-rich-black/40 xl:hidden"
        />
      )}
      <nav
        id="site-menu"
        ref={panelRef}
        aria-label="Site menu"
        hidden={!menuOpen}
        className="absolute inset-x-0 top-full overflow-y-auto overscroll-contain border-t border-seasalt-100 bg-white shadow-lg xl:hidden"
      >
        <ul className={cn(CONTAINER, "py-2")}>
          {NAV_ITEMS.map((item) => {
            const active = isActivePrefix(pathname, item.href);
            return (
              <li key={item.href} className="border-b border-seasalt-100">
                <Link
                  href={item.href}
                  onClick={closeMenu}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block py-3.5 text-lg font-semibold",
                    active && "text-coquelicot-700",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
