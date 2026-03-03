// src/components/NavBar.tsx
/**
 * @file NavBar.tsx
 * @description Navigation bar, always in document flow at the top of the page.
 */

"use client";

import type React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/Button";
import { cn } from "@/lib/cn";
import { useState, useEffect, useRef } from "react";

interface NavItem {
  label: string;
  href: string;
  activePrefix: string;
}

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
 * Navigation bar, always rendered in normal document flow.
 * @returns The NavBar element, or null on hidden paths.
 */
export function NavBar(): React.ReactElement | null {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [isScrolled, setIsScrolled] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const scrollLockRef = useRef(0);
  const bodyLockedRef = useRef(false);

  // Close mobile menu when route changes
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }

  // Prevent body scroll when mobile menu is open without jumping to top on close
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

  // Track viewport shape to tailor scroll behavior
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const aspectQuery = window.matchMedia("(min-aspect-ratio: 3/2)");
    const widthQuery = window.matchMedia("(min-width: 1024px)");

    /**
     * Update desktop detection by combining width and aspect ratio checks.
     */
    const updateDesktopFlag = (): void => {
      setIsDesktop(widthQuery.matches && aspectQuery.matches);
    };

    updateDesktopFlag();
    aspectQuery.addEventListener("change", updateDesktopFlag);
    widthQuery.addEventListener("change", updateDesktopFlag);
    return () => {
      aspectQuery.removeEventListener("change", updateDesktopFlag);
      widthQuery.removeEventListener("change", updateDesktopFlag);
    };
  }, []);

  // Hide/reveal navbar based on scroll direction
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let lastScrollY = window.scrollY;

    /**
     * Toggle navbar visibility according to scroll direction and viewport shape.
     */
    const handleScroll = (): void => {
      const current = window.scrollY;
      const scrolledPastThreshold = current > 72;
      setIsScrolled(scrolledPastThreshold);

      if (!scrolledPastThreshold || mobileMenuOpen) {
        setNavHidden(false);
        lastScrollY = current;
        return;
      }

      if (!isDesktop) {
        const doc = document.documentElement;
        const remainingScroll = doc.scrollHeight - (current + window.innerHeight);
        const progress = (current + window.innerHeight) / doc.scrollHeight;
        const narrowThreshold = Math.max(360, window.innerHeight * 0.5);
        if (remainingScroll <= narrowThreshold || progress >= 0.6) {
          setNavHidden(false);
          lastScrollY = current;
          return;
        }
      }

      const delta = current - lastScrollY;
      const hideThreshold = isDesktop ? 6 : 2;
      const showThreshold = isDesktop ? -6 : -1;

      if (delta > hideThreshold) {
        setNavHidden(true);
      } else if (delta < showThreshold) {
        setNavHidden(false);
      }

      lastScrollY = current;
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [mobileMenuOpen, isDesktop]);

  const HIDDEN_PATHS: ReadonlyArray<string> = ["/poster"];
  if (HIDDEN_PATHS.includes(pathname)) {
    return null;
  }

  const items: ReadonlyArray<NavItem> = [
    { label: "Services", href: "/services", activePrefix: "/services" },
    { label: "Pricing", href: "/pricing", activePrefix: "/pricing" },
    { label: "About", href: "/about", activePrefix: "/about" },
    { label: "FAQ", href: "/faq", activePrefix: "/faq" },
    { label: "Reviews", href: "/reviews", activePrefix: "/reviews" },
  ];

  const bookingActive = isActivePrefix(pathname, "/booking");
  const contactActive = isActivePrefix(pathname, "/contact");

  return (
    <>
      <header
        className={cn(
          "sticky top-3 z-50 mx-auto mt-4 w-full px-4 transition-all duration-300 sm:top-4",
          "max-w-[min(100vw-2rem,90rem)]",
          navHidden && "pointer-events-none -translate-y-[130%] opacity-0",
        )}
      >
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/90 flex h-20 w-full items-center justify-between rounded-2xl border px-5 shadow-lg backdrop-blur-lg transition-all duration-300",
            isScrolled && "border-opacity-70 shadow-2xl",
          )}
        >
          {/* Logo */}
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

          {/* Desktop Navigation */}
          <nav className={cn("hidden items-center gap-1 lg:flex")} aria-label="Primary navigation">
            {items.map((item) => {
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

          {/* CTA Buttons */}
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

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
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

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className={cn(
            "bg-rich-black/50 fixed inset-0 z-40 backdrop-blur-sm lg:hidden",
            "animate-in fade-in duration-200",
          )}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Menu Slide-out */}
      <nav
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/95 sm:top-30 top-27 fixed right-4 z-40 max-h-[calc(100vh-7rem)] max-w-[min(calc(100vw-2rem),18rem)] overflow-y-auto rounded-2xl border shadow-2xl backdrop-blur-xl transition-transform duration-300 lg:hidden",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full",
        )}
        id="mobile-nav"
        aria-label="Mobile navigation"
      >
        <div className={cn("flex h-full flex-col gap-2 p-4")}>
          {/* Mobile Nav Links */}
          {items.map((item) => {
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
              >
                {item.label}
              </Link>
            );
          })}

          {/* Mobile CTA Buttons */}
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
