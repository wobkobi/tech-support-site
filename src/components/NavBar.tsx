// src/components/NavBar.tsx
/**
 * @file NavBar.tsx
 * @description Themed bottom navigation. Frosted pill container, active highlight, responsive sizing.
 */

"use client";

import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  name: string;
  href: string;
}

const navItems: NavItem[] = [
  { name: "Home", href: "/" },
  { name: "Booking", href: "/booking" },
  { name: "About", href: "/about" },
  { name: "Contact", href: "/contact" },
];

/**
 * Navigation bar with active route styles.
 * @returns Themed NavBar element.
 */
export default function NavBar(): React.ReactElement {
  const pathname = usePathname();

  /**
   * Match active route (exact for "/", prefix for others).
   * @param href Item href.
   * @returns Whether item is active.
   */
  const isActive = (href: string): boolean =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className={cn("mx-auto w-fit max-w-[calc(100vw-2rem)]")}>
      <div
        className={cn(
          "border-seasalt-400/40 bg-seasalt-800/70",
          "rounded-lg border p-2 shadow-sm backdrop-blur-md"
        )}>
        <ul className={cn("flex items-center gap-1 sm:gap-2")}>
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-semibold sm:text-base",
                    active
                      ? // active pill
                        "border-moonstone-500/30 bg-moonstone-600/15 text-moonstone-600 border"
                      : // inactive
                        "text-russian-violet hover:text-coquelicot-500"
                  )}>
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
