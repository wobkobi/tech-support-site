"use client";
// src/features/business/hooks/use-job-context.ts
// Resolves the calculator's job date to its surcharge and the promo that applied then,
// via /api/business/job-context.

import type { DateSurcharge } from "@/features/business/lib/pricing-policy";
import type { ActivePromo } from "@/features/business/lib/promos";
import { useEffect, useState } from "react";

/** Inputs the job-context lookup is keyed on. */
interface UseJobContextArgs {
  /** Job date (YYYY-MM-DD). */
  jobDate: string;
  /** Earliest start (HH:MM), or "" for the lookup's midday default. */
  jobStartTime: string;
  /** Applied promo code, or "". */
  promoCode: string;
  /** Typed client email, so per-customer promo limits bind. */
  clientEmail: string;
  /** Booking the job was billed from, or null. */
  prefillBookingId: string | null;
  /** When the billed job was booked (ISO), so promo dates are judged then; null for a blank job. */
  prefillBookedAt: string | null;
  /** Server-resolved promo shown until the first lookup lands. */
  initialPromo: ActivePromo | null;
}

/** Surcharge + promo context for the selected job date. */
interface JobContext {
  /** Labour surcharge for the date (public holiday or weekend), or null when neither applies. */
  surcharge: DateSurcharge | null;
  /** Promo resolved for the job date, or null. */
  activePromo: ActivePromo | null;
}

/**
 * Resolves the job date > { surcharge, promo } so a past job is priced by what applied
 * then. Failures leave the prior context in place.
 * @param args - Lookup inputs.
 * @param args.jobDate - Job date (YYYY-MM-DD).
 * @param args.jobStartTime - Earliest start (HH:MM), or "".
 * @param args.promoCode - Applied promo code, or "".
 * @param args.clientEmail - Typed client email.
 * @param args.prefillBookingId - Booking the job was billed from, or null.
 * @param args.prefillBookedAt - When the billed job was booked (ISO), or null.
 * @param args.initialPromo - Server-resolved promo for the first render.
 * @returns The date's surcharge and active promo.
 */
export function useJobContext({
  jobDate,
  jobStartTime,
  promoCode,
  clientEmail,
  prefillBookingId,
  prefillBookedAt,
  initialPromo,
}: UseJobContextArgs): JobContext {
  // Promo for the selected job date, refined by the lookup below.
  const [activePromo, setActivePromo] = useState<ActivePromo | null>(initialPromo);
  // Labour surcharge for the selected date, with its reason for the UI.
  const [surcharge, setSurcharge] = useState<DateSurcharge | null>(null);

  // Overwrites activePromo with the date-resolved promo; failures keep the prior one.
  useEffect(() => {
    if (!jobDate) return;
    let cancelled = false;
    const query = new URLSearchParams({ date: jobDate });
    if (jobStartTime) query.set("time", jobStartTime);
    if (promoCode) query.set("code", promoCode);
    // Sent so per-customer limits bind here as on a public booking; debounced below.
    if (clientEmail.trim()) query.set("email", clientEmail.trim());
    // A booked job keeps its promo, and its own redemption doesn't count against limits.
    if (prefillBookingId) query.set("bookingId", prefillBookingId);
    // A phone-made job keeps the promo running the day its event was put in.
    if (prefillBookedAt) query.set("bookedAt", prefillBookedAt);
    /** Fetches the surcharge + promo context for the current date, code and customer. */
    const run = (): void => {
      fetch(`/api/business/job-context?${query.toString()}`)
        .then((r) => r.json())
        .then(
          (d: { ok?: boolean; surcharge?: DateSurcharge | null; promo?: ActivePromo | null }) => {
            if (cancelled || !d?.ok) return;
            setSurcharge(d.surcharge ?? null);
            setActivePromo(d.promo ?? null);
          },
        )
        .catch(() => {
          /* leave the prior context in place */
        });
    };
    // 400ms: typing an email is one request without the promo chip visibly lagging.
    const timer = setTimeout(run, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobDate, jobStartTime, promoCode, clientEmail, prefillBookingId, prefillBookedAt]);

  return { surcharge, activePromo };
}
