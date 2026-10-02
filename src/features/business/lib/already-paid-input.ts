// src/features/business/lib/already-paid-input.ts
// Form state for the "Already paid" box on the calculator and the invoice edit page:
// the amount as typed, and whether it came in as Cash or Bank. Client-safe (no Prisma).

import type { INCOME_METHODS } from "@/features/business/lib/constants";

/** The ways money can come in on the day; Mixed is left to the full Payment dialog. */
export const ALREADY_PAID_METHODS = [
  "Cash",
  "Bank",
] as const satisfies readonly (typeof INCOME_METHODS)[number][];

/** One of {@link ALREADY_PAID_METHODS}. */
export type AlreadyPaidMethod = (typeof ALREADY_PAID_METHODS)[number];

/** The box's state. The amount stays a string so "47." can be typed without snapping back. */
export interface AlreadyPaidState {
  amount: string;
  method: AlreadyPaidMethod;
}

/** A cleared box. */
export const EMPTY_ALREADY_PAID: AlreadyPaidState = { amount: "", method: "Cash" };

/**
 * The typed amount as dollars, rounded to cents.
 * @param state - The box's state.
 * @returns The amount, or 0 when blank, invalid or not positive.
 */
export function alreadyPaidAmount(state: AlreadyPaidState): number {
  const n = Number(state.amount.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/**
 * Narrows a stored method to one the box offers, so an old "Mixed" row still loads.
 * @param method - Stored method, or null.
 * @returns The method, or Cash when it isn't one the box offers.
 */
export function toAlreadyPaidMethod(method: string | null | undefined): AlreadyPaidMethod {
  return (ALREADY_PAID_METHODS as readonly string[]).includes(method ?? "")
    ? (method as AlreadyPaidMethod)
    : "Cash";
}
