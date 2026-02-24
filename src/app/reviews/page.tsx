// src/app/reviews/page.tsx
/**
 * @file page.tsx
 * @description Public reviews page showing all approved client reviews.
 */

import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell, CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import { FaCircleCheck } from "react-icons/fa6";

// Enable ISR: revalidate every 5 minutes for approved reviews
export const revalidate = 300;

/**
 * Formats a reviewer's display name.
 * @param r - Review fields.
 * @param r.firstName - First name or null.
 * @param r.lastName - Last name or null.
 * @param r.isAnonymous - Whether the review is posted anonymously.
 * @returns Formatted name string.
 */
function formatName(r: {
  firstName: string | null;
  lastName: string | null;
  isAnonymous: boolean;
}): string {
  if (r.isAnonymous) return "Anonymous";
  const f = (r.firstName ?? "").trim();
  const l = (r.lastName ?? "").trim();
  if (!f && !l) return "Anonymous";
  const initial = f ? `${f[0].toUpperCase()}. ` : "";
  const last = l ? `${l[0].toUpperCase()}${l.slice(1).toLowerCase()}` : "";
  const out = `${initial}${last}`.trim();
  return out ? `${out}.` : "Anonymous";
}

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

/**
 * Reviews page component.
 * @returns Reviews page element.
 */
export default async function ReviewsPage(): Promise<React.ReactElement> {
  const rows = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      text: true,
      firstName: true,
      lastName: true,
      isAnonymous: true,
      verified: true,
    },
    where: { status: "approved" },
  });

  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="reviews-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="reviews-heading"
              className={cn(
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              What clients say
            </h1>
            <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
              Real feedback from people I&apos;ve helped in Point Chevalier and nearby suburbs.
            </p>
          </section>

          {rows.length === 0 ? (
            <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
              <p className={cn("text-rich-black/70 text-base sm:text-lg")}>
                No reviews yet — be the first!{" "}
                <Link href="/booking" className={linkStyle}>
                  Book an appointment
                </Link>{" "}
                and you&apos;ll get a review link after your visit.
              </p>
            </section>
          ) : (
            <section
              aria-label="Client reviews"
              className={cn("animate-slide-up animate-fill-both animate-delay-100")}
            >
              <ul className={cn("grid gap-4 sm:grid-cols-2")}>
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className={cn(
                      "border-seasalt-400/60 bg-seasalt-800 flex flex-col rounded-xl border p-5 shadow-sm sm:p-6",
                    )}
                  >
                    <p
                      className={cn("text-rich-black flex-1 text-sm leading-relaxed sm:text-base")}
                    >
                      {r.text}
                    </p>
                    <div className={cn("mt-4 flex items-center justify-between gap-2")}>
                      <p className={cn("text-russian-violet text-sm font-semibold")}>
                        — {formatName(r)}
                      </p>
                      {r.verified && (
                        <span
                          className={cn(
                            "bg-moonstone-600/15 border-moonstone-500/30 text-moonstone-600 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          )}
                        >
                          <FaCircleCheck className={cn("h-3 w-3")} aria-hidden />
                          Verified
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-label="Leave a review"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              Had an appointment? You&apos;ll receive a review link by email after your visit. Or{" "}
              <Link href="/booking" className={linkStyle}>
                book now
              </Link>{" "}
              to get started.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
