// src/components/NavBar.tsx
/**
 * @file NavBar.tsx
 * @description Navigation bar with mobile-first scroll reveal behavior.
 */

"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";

interface NavItem {
  label: string;
  href: string;
  activePrefix: string;
}

const HIDDEN_PATHS: ReadonlyArray<string> = ["/poster"];
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { label: "Services", href: "/services", activePrefix: "/services" },
  { label: "Pricing", href: "/pricing", activePrefix: "/pricing" },
  { label: "About", href: "/about", activePrefix: "/about" },
  { label: "FAQ", href: "/faq", activePrefix: "/faq" },
  { label: "Reviews", href: "/reviews", activePrefix: "/reviews" },
];

const SCROLL_THRESHOLD = 72;
const MIN_SCROLL_DELTA = 1;

/**
 * Determine whether a path is active for a given prefix route.
 * @param pathname - The current path.
 * @param prefix - The prefix to match against.
 * @returns Whether the path matches the prefix.
 */
function isActivePrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") {
    return pathname === "/";
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * NavBar component.
 * @returns The NavBar element, or null on hidden paths.
 */
export function NavBar(): React.ReactElement | null {
  const pathname = usePathname();

  const [mobileMenuState, setMobileMenuState] = useState<{ open: boolean; pathname: string }>({
    open: false,
    pathname,
  });
  const mobileMenuOpen = mobileMenuState.open && mobileMenuState.pathname === pathname;

  const [isScrolled, setIsScrolled] = useState(false);
  const [isHidden, setIsHidden] = useState(false);

  const scrollLockRef = useRef(0);
  const bodyLockedRef = useRef(false);
  const lastScrollYRef = useRef(0);

  /**
   * Set hidden state only when it changes.
   * @param nextHidden - Target hidden state.
   * @param reason - Why this transition happened.
   * @param details - Optional context for debug logs.
   */
  const setHiddenSafely = useCallback((nextHidden: boolean): void => {
    setIsHidden((previous) => (previous === nextHidden ? previous : nextHidden));
  }, []);

  /**
   * Open the mobile menu.
   */
  const openMobileMenu = useCallback((): void => {
    setMobileMenuState({ open: true, pathname });
  }, [pathname]);

  /**
   * Close the mobile menu.
   */
  const closeMobileMenu = useCallback((): void => {
    setMobileMenuState({ open: false, pathname });
  }, [pathname]);

  /**
   * Toggle the mobile menu.
   */
  const toggleMobileMenu = useCallback((): void => {
    if (mobileMenuOpen) {
      closeMobileMenu();
      return;
    }

    openMobileMenu();
  }, [mobileMenuOpen, openMobileMenu, closeMobileMenu]);

  // Lock body scroll while mobile menu is open.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const body = document.body;

    if (mobileMenuOpen) {
      scrollLockRef.current = window.scrollY;
      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.width = "100%";
      body.style.top = `-${scrollLockRef.current}px`;
      bodyLockedRef.current = true;
    } else if (bodyLockedRef.current) {
      body.style.overflow = "";
      body.style.position = "";
      body.style.width = "";
      body.style.top = "";
      window.scrollTo({ top: scrollLockRef.current });
      bodyLockedRef.current = false;
    }

    return () => {
      body.style.overflow = "";
      body.style.position = "";
      body.style.width = "";
      body.style.top = "";
    };
  }, [mobileMenuOpen]);

  // Scroll behavior: hide on downward scroll, show immediately on upward scroll.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    /**
     * Process latest scroll position.
     */
    const processScroll = (): void => {
      const currentY = Math.max(window.scrollY, 0);
      const previousY = lastScrollYRef.current;
      const delta = currentY - previousY;
      lastScrollYRef.current = currentY;

      const scrolledPastThreshold = currentY > SCROLL_THRESHOLD;
      setIsScrolled(scrolledPastThreshold);

      if (!scrolledPastThreshold || mobileMenuOpen) {
        setHiddenSafely(false);
        return;
      }

      if (Math.abs(delta) < MIN_SCROLL_DELTA) {
        return;
      }

      if (delta < 0) {
        setHiddenSafely(false);
        return;
      }

      if (delta > 0) {
        setHiddenSafely(true);
      }
    };

    lastScrollYRef.current = Math.max(window.scrollY, 0);
    processScroll();

    window.addEventListener("scroll", processScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", processScroll);
    };
  }, [mobileMenuOpen, setHiddenSafely]);

  if (HIDDEN_PATHS.includes(pathname)) {
    return null;
  }

  const bookingActive = isActivePrefix(pathname, "/booking");
  const contactActive = isActivePrefix(pathname, "/contact");

  return (
    <>
      <div aria-hidden="true" className={cn("h-24 sm:h-28")} />

      <header
        className={cn(
          "duration-400 fixed inset-x-0 top-3 z-50 mx-auto w-full px-4 transition-[transform,opacity] ease-in-out will-change-transform sm:top-4",
          "max-w-[min(100vw-2rem,90rem)]",
          isHidden && "pointer-events-none -translate-y-[120%] opacity-0",
        )}
      >
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/90 flex h-20 w-full items-center justify-between rounded-2xl border px-5 shadow-lg backdrop-blur-lg transition-all duration-300",
            isScrolled && "border-opacity-70 shadow-2xl",
          )}
        >
          <Link
            href="/"
            className={cn("flex items-center gap-2.5 transition-transform hover:scale-105")}
          >
            <Image
              src="/source/logo.svg"
              alt="Logo"
              width={40}
              height={40}
              priority
              className={cn("select-none")}
            />
            <span className={cn("text-russian-violet text-lg font-bold sm:text-xl")}>
              To The Point Tech
            </span>
          </Link>

          <nav className={cn("hidden items-center gap-1 lg:flex")} aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => {
              const active = isActivePrefix(pathname, item.activePrefix);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-lg font-semibold transition-all xl:text-xl",
                    active
                      ? "text-russian-violet bg-moonstone-600/20"
                      : "text-rich-black hover:bg-seasalt-900/30 hover:text-russian-violet",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className={cn("flex shrink-0 items-center gap-2")}>
            <Button
              href="/booking"
              variant="primary"
              size="lg"
              className={cn("hidden shrink-0 lg:inline-flex xl:text-xl")}
              aria-current={bookingActive ? "page" : undefined}
            >
              Book now
            </Button>

            <Button
              href="/contact"
              variant="ghost"
              size="lg"
              className={cn("hidden shrink-0 lg:inline-flex xl:text-xl")}
              aria-current={contactActive ? "page" : undefined}
            >
              Contact
            </Button>

            <button
              onClick={toggleMobileMenu}
              className={cn(
                "bg-seasalt-900/20 hover:bg-seasalt-900/30 flex h-11 w-11 items-center justify-center rounded-lg transition-all lg:hidden",
              )}
              aria-label="Toggle mobile menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-nav"
            >
              <div className={cn("flex h-5 w-5 flex-col justify-center gap-1")}>
                <span
                  className={cn(
                    "bg-russian-violet h-0.5 w-full rounded-full transition-all",
                    mobileMenuOpen && "translate-y-1.5 rotate-45",
                  )}
                />
                <span
                  className={cn(
                    "bg-russian-violet h-0.5 w-full rounded-full transition-all",
                    mobileMenuOpen && "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "bg-russian-violet h-0.5 w-full rounded-full transition-all",
                    mobileMenuOpen && "-translate-y-1.5 -rotate-45",
                  )}
                />
              </div>
            </button>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div
          className={cn(
            "bg-rich-black/50 fixed inset-0 z-40 backdrop-blur-sm lg:hidden",
            "animate-in fade-in duration-200",
          )}
          onClick={closeMobileMenu}
          aria-hidden="true"
        />
      )}

      <nav
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/95 sm:top-30 top-27 overscroll-behavior-contain fixed right-4 z-40 max-h-[calc(100dvh-8rem)] max-w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-2xl border shadow-2xl backdrop-blur-xl transition-transform duration-300 lg:hidden",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full",
        )}
        id="mobile-nav"
        aria-label="Mobile navigation"
      >
        <div className={cn("flex h-full flex-col gap-2 p-4")}>
          {NAV_ITEMS.map((item) => {
            const active = isActivePrefix(pathname, item.activePrefix);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg px-4 py-3 text-base font-semibold transition-all",
                  active
                    ? "text-russian-violet bg-moonstone-600/20 shadow-sm"
                    : "text-rich-black hover:bg-seasalt-900/30 hover:text-russian-violet",
                )}
                aria-current={active ? "page" : undefined}
                onClick={closeMobileMenu}
              >
                {item.label}
              </Link>
            );
          })}

          <div className={cn("border-seasalt-400/40 mt-4 flex flex-col gap-2 border-t pt-4")}>
            <Button
              href="/booking"
              variant="primary"
              size="lg"
              fullWidth
              aria-current={bookingActive ? "page" : undefined}
            >
              Book now
            </Button>

            <Button
              href="/contact"
              variant="ghost"
              size="lg"
              fullWidth
              aria-current={contactActive ? "page" : undefined}
            >
              Contact
            </Button>
          </div>
        </div>
      </nav>
    </>
  );
}
