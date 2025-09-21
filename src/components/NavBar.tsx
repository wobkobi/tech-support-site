// src/components/NavBar.tsx
/**
 * @file NavBar.tsx
 * @description
 * Persistent bottom navigation with four primary links and active route highlighting.
 */

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// NavBar component to display navigation links
/**
 * @returns The NavBar component with navigation links.
 */
export default function NavBar(): React.ReactElement {
  const pathname = usePathname();
  const links = [
    { href: "/", label: "Home" },
    { href: "/book", label: "Book a Session" },
    { href: "/services", label: "Services" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <nav className="navbar">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={pathname === link.href ? "active" : ""}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
