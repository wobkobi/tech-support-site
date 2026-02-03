// src/components/NavBar.tsx
"use client";
/**
 * Top navigation bar with logo, primary links, and booking/contact CTAs.
 * @returns React element for the site navigation bar.
 */

import type React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * One navigation entry shown in the primary nav.
 */
interface NavItem {
  /**
   * Label displayed to the user.
   */
  label: string;
  /**
   * Destination path.
   */
  href: string;
  /**
   * Route prefix used to determine active state.
   */
  activePrefix: string;
}

/**
 * Determine whether a path is active for a given prefix route.
 * @param pathname Current pathname.
 * @param prefix Route prefix such as "/services".
 * @returns True if pathname matches the prefix.
 */
function isActivePrefix(pathname: string, prefix: string): boolean {
  if (prefix === "/") {
    return pathname === "/";
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Navigation bar rendered at the top of most pages.
 * Hides itself on specific routes (eg, printable poster).
 * @returns Navigation bar React element, or null if hidden on this route.
 */
export function NavBar(): React.ReactElement | null {
  const pathname: string = usePathname();

  const HIDDEN_PATHS: ReadonlyArray<string> = ["/poster"];

  if (HIDDEN_PATHS.includes(pathname)) {
    return null;
  }

  const items: ReadonlyArray<NavItem> = [
    { label: "Services", href: "/services", activePrefix: "/services" },
    { label: "Pricing", href: "/pricing", activePrefix: "/pricing" },
    { label: "FAQ", href: "/faq", activePrefix: "/faq" },
    { label: "Reviews", href: "/review", activePrefix: "/review" },
  ];

  const bookingActive = isActivePrefix(pathname, "/booking");
  const contactActive = isActivePrefix(pathname, "/contact");

  return (
    <header
      className={cn(
        "border-seasalt-400/40 sticky top-0 z-20 border-b",
        "bg-seasalt/80 backdrop-blur-md",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-14 w-full items-center justify-between",
          "max-w-[min(100vw-1rem,80rem)]",
        )}
      >
        <Link href="/" className={cn("flex items-center gap-3 px-2")}>
          <Image
            src="/logo.svg"
            alt="To The Point Tech"
            width={28}
            height={28}
            priority
            className={cn("select-none")}
          />
          <span className={cn("text-russian-violet text-base font-bold")}>To The Point Tech</span>
        </Link>

        <nav className={cn("hidden items-center gap-1.5 sm:flex")} aria-label="Primary navigation">
          {items.map((item) => {
            const active = isActivePrefix(pathname, item.activePrefix);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-semibold",
                  active
                    ? "text-russian-violet bg-moonstone-600/15"
                    : "text-rich-black hover:bg-moonstone-600/10 hover:text-russian-violet",
                )}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={cn("flex items-center gap-2 pr-2")}>
          <Link
            href="/booking"
            className={cn(
              "rounded-md px-3 py-2 text-sm font-bold",
              bookingActive
                ? "bg-coquelicot-600 text-rich-black"
                : "bg-coquelicot-500 hover:bg-coquelicot-600 text-rich-black",
            )}
            aria-current={bookingActive ? "page" : undefined}
          >
            Book now
          </Link>

          <Link
            href="/contact"
            className={cn(
              "rounded-md px-3 py-2 text-sm font-bold",
              contactActive
                ? "bg-moonstone-600/30 text-russian-violet"
                : "bg-moonstone-600/20 text-russian-violet hover:bg-moonstone-600/30",
            )}
            aria-current={contactActive ? "page" : undefined}
          >
            Contact
          </Link>
        </div>
      </div>
    </header>
  );
}
