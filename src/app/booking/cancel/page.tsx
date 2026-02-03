// src/app/booking/cancel/page.tsx
/**
 * @file page.tsx
 * @description Booking cancel page.
 */

import type React from "react";
import BookingCancelClient from "./ui";

/**
 * Cancel page that reads token from search params.
 * @param root0 - Page props.
 * @param root0.searchParams - Query params promise.
 * @returns Cancel page element.
 */
export default async function BookingCancelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const tokenValue = params.token;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  return <BookingCancelClient token={token} />;
}
