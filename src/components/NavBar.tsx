// src/components/NavBar.tsx
/**
 * @file NavBar.tsx
 * @description Modern navigation bar with mobile menu, frosted glass effect, and smooth animations.
 */

"use client";

import type React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useState, useEffect } from "react";

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
 * Modern navigation bar with mobile menu support.
 * @returns The NavBar element, or null on hidden paths.
 */
export function NavBar(): React.ReactElement | null {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Close mobile menu when route changes (state-based comparison avoids effect)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  }

  const HIDDEN_PATHS: ReadonlyArray<string> = ["/poster"];
  const hidden = HIDDEN_PATHS.includes(pathname);

  const items: ReadonlyArray<NavItem> = [
    { label: "Services", href: "/services", activePrefix: "/services" },
    { label: "Pricing", href: "/pricing", activePrefix: "/pricing" },
    { label: "About", href: "/about", activePrefix: "/about" },
    { label: "FAQ", href: "/faq", activePrefix: "/faq" },
  ];

  const bookingActive = isActivePrefix(pathname, "/booking");
  const contactActive = isActivePrefix(pathname, "/contact");

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [mobileMenuOpen]);

  if (hidden) {
    return null;
  }

  return (
    <>
      <header
        className={cn(
          "sticky top-4 z-50 mx-auto w-full px-4",
          "max-w-[min(100vw-2rem,90rem)]",
          "animate-slide-down",
        )}
      >
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/90 flex h-16 w-full items-center justify-between rounded-2xl border px-4 shadow-lg backdrop-blur-lg",
          )}
        >
          {/* Logo */}
          <Link
            href="/"
            className={cn("flex items-center gap-2.5 transition-transform hover:scale-105")}
          >
            <Image
              src="/source/logo.svg"
              alt="To The Point Tech"
              width={32}
              height={32}
              priority
              className={cn("select-none")}
            />
            <span className={cn("text-russian-violet hidden text-base font-bold sm:inline")}>
              To The Point Tech
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className={cn("hidden items-center gap-1 md:flex")} aria-label="Primary navigation">
            {items.map((item) => {
              const active = isActivePrefix(pathname, item.activePrefix);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-lg px-3.5 py-2 text-sm font-semibold transition-all",
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
          <div className={cn("flex items-center gap-2")}>
            <Link
              href="/booking"
              className={cn(
                "hidden rounded-lg px-4 py-2 text-sm font-bold transition-all sm:block",
                bookingActive
                  ? "bg-coquelicot-600 text-seasalt shadow-md"
                  : "bg-coquelicot-500 hover:bg-coquelicot-600 text-seasalt hover:shadow-md",
              )}
              aria-current={bookingActive ? "page" : undefined}
            >
              Book now
            </Link>

            <Link
              href="/contact"
              className={cn(
                "hidden rounded-lg px-4 py-2 text-sm font-bold transition-all sm:block",
                contactActive
                  ? "bg-moonstone-600/30 text-russian-violet shadow-sm"
                  : "bg-moonstone-600/20 text-russian-violet hover:bg-moonstone-600/30",
              )}
              aria-current={contactActive ? "page" : undefined}
            >
              Contact
            </Link>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={cn(
                "bg-seasalt-900/20 hover:bg-seasalt-900/30 flex h-10 w-10 items-center justify-center rounded-lg transition-all md:hidden",
              )}
              aria-label="Toggle mobile menu"
              aria-expanded={mobileMenuOpen}
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
            "bg-rich-black/50 fixed inset-0 z-40 backdrop-blur-sm md:hidden",
            "animate-in fade-in duration-200",
          )}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Menu Slide-out */}
      <nav
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/95 fixed right-4 top-20 z-40 h-[calc(100vh-6rem)] w-72 rounded-2xl border shadow-2xl backdrop-blur-xl transition-transform duration-300 md:hidden",
          mobileMenuOpen ? "translate-x-0" : "translate-x-full",
        )}
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
            <Link
              href="/booking"
              className={cn(
                "rounded-lg px-4 py-3 text-center text-base font-bold transition-all",
                bookingActive
                  ? "bg-coquelicot-600 text-seasalt shadow-md"
                  : "bg-coquelicot-500 hover:bg-coquelicot-600 text-seasalt",
              )}
              aria-current={bookingActive ? "page" : undefined}
            >
              Book now
            </Link>

            <Link
              href="/contact"
              className={cn(
                "rounded-lg px-4 py-3 text-center text-base font-bold transition-all",
                contactActive
                  ? "bg-moonstone-600/30 text-russian-violet shadow-sm"
                  : "bg-moonstone-600/20 text-russian-violet hover:bg-moonstone-600/30",
              )}
              aria-current={contactActive ? "page" : undefined}
            >
              Contact
            </Link>
          </div>
        </div>
      </nav>
    </>
  );
}
