// src/shared/components/NavBar.tsx
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
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";

interface NavItem {
  label: string;
  href: string;
  activePrefix: string;
}

const HIDDEN_PATHS: ReadonlyArray<string> = ["/poster"];
/** Path prefixes that hide the public nav entirely (e.g. admin has its own sidebar). */
const HIDDEN_PREFIXES: ReadonlyArray<string> = ["/admin"];
const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { label: "Services", href: "/services", activePrefix: "/services" },
  { label: "Pricing", href: "/pricing", activePrefix: "/pricing" },
  { label: "About", href: "/about", activePrefix: "/about" },
  { label: "FAQ", href: "/faq", activePrefix: "/faq" },
  { label: "Reviews", href: "/reviews", activePrefix: "/reviews" },
];

const SCROLL_THRESHOLD = 90;
const TOP_SCROLL_ZONE_MAX = 260; // Near top: hide faster even on gentle scrolling
const DEEP_SCROLL_ZONE_MIN = 560; // Deeper scroll: require more intent to hide
const TOP_MIN_SCROLL_DELTA = 1;
const DEEP_MIN_SCROLL_DELTA = 1;
const TOP_HIDE_SCROLL_DISTANCE = 72;
const MID_HIDE_SCROLL_DISTANCE = 120;
const DEEP_HIDE_SCROLL_DISTANCE = 170;
const FULL_HIDE_TRANSLATE = "120%"; // Vertical translate percentage when navbar is fully hidden
const TOP_IDLE_HIDE_DELAY_MS = 900;
const MID_IDLE_HIDE_DELAY_MS = 1200;
const DEEP_IDLE_HIDE_DELAY_MS = 2300;
const HOVER_REVEAL_ZONE = 100; // Reveal hidden navbar when cursor is near top

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
 * Get scroll-based hide tuning values.
 * @param scrollY - Current vertical scroll position.
 * @returns Thresholds for hide distance, idle delay, and minimum delta.
 */
function getHideTuning(scrollY: number): {
  hideDistance: number;
  idleDelayMs: number;
  minScrollDelta: number;
} {
  if (scrollY <= TOP_SCROLL_ZONE_MAX) {
    return {
      hideDistance: TOP_HIDE_SCROLL_DISTANCE,
      idleDelayMs: TOP_IDLE_HIDE_DELAY_MS,
      minScrollDelta: TOP_MIN_SCROLL_DELTA,
    };
  }

  if (scrollY >= DEEP_SCROLL_ZONE_MIN) {
    return {
      hideDistance: DEEP_HIDE_SCROLL_DISTANCE,
      idleDelayMs: DEEP_IDLE_HIDE_DELAY_MS,
      minScrollDelta: DEEP_MIN_SCROLL_DELTA,
    };
  }

  return {
    hideDistance: MID_HIDE_SCROLL_DISTANCE,
    idleDelayMs: MID_IDLE_HIDE_DELAY_MS,
    minScrollDelta: TOP_MIN_SCROLL_DELTA,
  };
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const [isHoveringTop, setIsHoveringTop] = useState(false);

  const scrollLockRef = useRef(0);
  const bodyLockedRef = useRef(false);
  const lastScrollYRef = useRef(0);
  const scrollDownDistanceRef = useRef(0);
  const isScrolledRef = useRef(false);
  const idleHideTimerRef = useRef<number | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

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
   * Clear scheduled idle hide timer.
   */
  const clearIdleHideTimer = useCallback((): void => {
    if (idleHideTimerRef.current !== null) {
      window.clearTimeout(idleHideTimerRef.current);
      idleHideTimerRef.current = null;
    }
  }, []);

  /**
   * Schedule idle hide only when user is scrolled away from page top.
   */
  const scheduleIdleHide = useCallback((): void => {
    if (typeof window === "undefined" || mobileMenuOpen) {
      return;
    }

    clearIdleHideTimer();

    const { hideDistance, idleDelayMs } = getHideTuning(Math.max(window.scrollY, 0));

    idleHideTimerRef.current = window.setTimeout(() => {
      if (!isScrolledRef.current || mobileMenuOpen) {
        return;
      }

      setHiddenSafely(true);
      setScrollOffset(hideDistance);
    }, idleDelayMs);
  }, [clearIdleHideTimer, mobileMenuOpen, setHiddenSafely]);

  /**
   * Keep navbar visible while it is being interacted with.
   */
  const handleNavInteractionStart = useCallback((): void => {
    clearIdleHideTimer();
    setHiddenSafely(false);
    setScrollOffset(0);
    scrollDownDistanceRef.current = 0;
  }, [clearIdleHideTimer, setHiddenSafely]);

  /**
   * Restart inactivity countdown when interaction stops.
   */
  const handleNavInteractionEnd = useCallback((): void => {
    scheduleIdleHide();
  }, [scheduleIdleHide]);

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
      const { hideDistance, minScrollDelta } = getHideTuning(currentY);
      lastScrollYRef.current = currentY;

      const scrolledPastThreshold = currentY > SCROLL_THRESHOLD;
      isScrolledRef.current = scrolledPastThreshold;
      setIsScrolled(scrolledPastThreshold);

      if (!scrolledPastThreshold || mobileMenuOpen) {
        clearIdleHideTimer();
        setHiddenSafely(false);
        setScrollOffset(0);
        scrollDownDistanceRef.current = 0;
        return;
      }

      scheduleIdleHide();

      if (Math.abs(delta) < minScrollDelta) {
        return;
      }

      if (delta < 0) {
        // Scrolling up - reset and show immediately
        setHiddenSafely(false);
        setScrollOffset(0);
        scrollDownDistanceRef.current = 0;
        return;
      }

      if (delta > 0) {
        // Scrolling down - accumulate distance and gradually translate (like sticky that scrolls away)
        scrollDownDistanceRef.current += delta;

        if (scrollDownDistanceRef.current >= hideDistance) {
          // Fully hide after threshold (unless hovering at top)
          setHiddenSafely(true);
          setScrollOffset(hideDistance);
        } else {
          // Gradually translate up with scroll
          setHiddenSafely(false);
          setScrollOffset(scrollDownDistanceRef.current);
        }
      }
    };

    lastScrollYRef.current = Math.max(window.scrollY, 0);
    processScroll();

    window.addEventListener("scroll", processScroll, { passive: true });

    return () => {
      clearIdleHideTimer();
      window.removeEventListener("scroll", processScroll);
    };
  }, [mobileMenuOpen, clearIdleHideTimer, scheduleIdleHide, setHiddenSafely]);

  // Hovering near the top edge should reveal a hidden navbar on pointer devices.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let hoverTimeout: number | null = null;

    /**
     * Track whether the cursor is near the top viewport edge.
     * @param event - The latest mouse move event.
     */
    const handleMouseMove = (event: MouseEvent): void => {
      if (event.clientY <= HOVER_REVEAL_ZONE) {
        if (hoverTimeout) {
          window.clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }
        setIsHoveringTop(true);
      } else if (isHoveringTop) {
        // Start a short timeout before hiding
        if (!hoverTimeout) {
          hoverTimeout = window.setTimeout(() => {
            setIsHoveringTop(false);
            hoverTimeout = null;
          }, 350); // 350ms linger, animation unchanged
        }
      }
    };

    /**
     * Reset top-hover state when pointer leaves the document.
     */
    const handleMouseLeave = (): void => {
      setIsHoveringTop(false);
      if (hoverTimeout) {
        window.clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
      if (hoverTimeout) {
        window.clearTimeout(hoverTimeout);
      }
    };
  }, [isHoveringTop]);

  if (HIDDEN_PATHS.includes(pathname)) {
    return null;
  }
  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  const bookingActive = isActivePrefix(pathname, "/booking");
  const contactActive = isActivePrefix(pathname, "/contact");

  /**
   * Calculate the transform value based on current scroll state
   * @returns The translateY transform string
   */
  const getTransform = (): string => {
    if (!isHidden && scrollOffset > 0) {
      return `translateY(-${scrollOffset}px)`;
    }
    if (isHidden && !isHoveringTop) {
      return `translateY(-${FULL_HIDE_TRANSLATE})`;
    }
    return "translateY(0)";
  };

  return (
    <>
      {/* Spacer for fixed nav - grows via --promo-h when banner is shown. */}
      <div aria-hidden="true" className={cn("app-nav-spacer")} />

      <header
        ref={headerRef}
        className={cn(
          "fixed inset-x-0 z-50 mx-auto w-full px-4 will-change-transform",
          // `.app-nav-header` (globals.css) - top driven by --promo-h.
          "app-nav-header",
          "max-w-[min(100vw-2rem,90rem)]",
          isHidden && !isHoveringTop && "pointer-events-none opacity-0",
        )}
        onMouseEnter={handleNavInteractionStart}
        onMouseLeave={handleNavInteractionEnd}
        onTouchStart={handleNavInteractionStart}
        onTouchEnd={handleNavInteractionEnd}
        onFocusCapture={handleNavInteractionStart}
        onBlurCapture={(event) => {
          const nextFocused = event.relatedTarget;
          if (nextFocused instanceof Node && headerRef.current?.contains(nextFocused)) {
            return;
          }
          handleNavInteractionEnd();
        }}
        style={{
          transform: getTransform(),
        }}
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
                    "shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-lg font-semibold transition-all duration-200 xl:text-xl",
                    active
                      ? "text-russian-violet bg-moonstone-600/20 shadow-sm"
                      : "text-rich-black hover:bg-moonstone-600/15 hover:text-russian-violet hover:scale-105 hover:shadow-md",
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
          "border-seasalt-400/40 bg-seasalt-800/95 overscroll-behavior-contain fixed right-4 z-40 max-h-[calc(100dvh-8rem)] max-w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-2xl border shadow-2xl backdrop-blur-xl lg:hidden",
          // `.app-mobile-drawer` (globals.css) owns top + translate transition.
          "app-mobile-drawer",
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
                  "rounded-lg px-4 py-3 text-base font-semibold transition-all duration-200",
                  active
                    ? "text-russian-violet bg-moonstone-600/20 shadow-sm"
                    : "text-rich-black hover:bg-moonstone-600/15 hover:text-russian-violet hover:scale-[1.02] hover:shadow-md",
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
