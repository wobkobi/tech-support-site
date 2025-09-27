// src/components/NavBar.tsx
/**
 * @file NavBar.tsx
 * @description
 * Persistent bottom navigation with four primary links and active route highlighting.
 */

"use client";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { JSX } from "react";

// No props are expected for NavBar

const navItems = [
  { name: "Home", href: "/" },
  { name: "Booking", href: "/booking" },
  { name: "About", href: "/about" },
  { name: "Contact", href: "/contact" },
];

// NavBar component to display navigation links
/**
 * @returns The NavBar component with navigation links.
 */
export default function NavBar(): JSX.Element {
  const pathname = usePathname();
  const isActive = (href: string): boolean => pathname === href;

  return (
    <nav className={cn("bg-russian-violet py-5 md:py-6")}>
      <ul className={cn("mx-auto flex max-w-4xl justify-around")}>
        {navItems.map((item) => (
          <li key={item.href} className={cn("flex-1 text-center")}>
            <Link
              href={item.href}
              className={cn(
                "block px-5 py-3 text-2xl tracking-tight md:text-3xl",
                isActive(item.href)
                  ? "text-coquelicot-500 font-bold"
                  : "text-seasalt-900 hover:text-coquelicot-400 dark:text-seasalt-600 dark:hover:text-coquelicot-400"
              )}>
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
