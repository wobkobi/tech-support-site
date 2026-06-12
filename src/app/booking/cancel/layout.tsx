// src/app/booking/cancel/layout.tsx
/**
 * @file layout.tsx
 * @description Metadata holder for the cancel page. The page itself is a
 * client component ("use client"), which cannot export metadata, so the
 * noindex rule lives here.
 */

import type { Metadata } from "next";
import type React from "react";

// Token-gated cancellation flow reached from booking emails: keep it out of
// search results.
export const metadata: Metadata = {
  title: "Cancel booking",
  robots: { index: false, follow: false },
};

/**
 * Pass-through layout; exists only to carry the metadata above.
 * @param props - Layout props.
 * @param props.children - The cancel page.
 * @returns The children unchanged.
 */
export default function CancelBookingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return children;
}
