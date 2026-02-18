// src/app/admin/reviews/page.tsx
/**
 * @file page.tsx
 * @description Admin review approval page. Protected by ADMIN_SECRET token in the URL.
 * Access via: /admin/reviews?token=<ADMIN_SECRET>
 */

import { timingSafeEqual } from "crypto";
import type { Metadata } from "next";
import { FrostedSection, PageShell, CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import { ReviewApprovalList } from "@/components/admin/ReviewApprovalList";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Reviews",
  robots: { index: false, follow: false },
};

/**
 * Validates the URL token against ADMIN_SECRET using constant-time comparison.
 * @param token - Token from the URL search params.
 * @returns True if valid.
 */
function isValidToken(token: string | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Admin reviews page — renders access-denied or the approval UI depending on token validity.
 * @param props - Page props.
 * @param props.searchParams - URL search parameters (contains token).
 * @returns Admin page element.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;

  if (!isValidToken(token ?? null)) {
    return (
      <PageShell>
        <FrostedSection maxWidth="40rem">
          <div className="py-12 text-center">
            <p className="text-2xl font-bold text-russian-violet">Access Denied</p>
            <p className="text-seasalt-300 mt-2 text-sm">Invalid or missing token.</p>
          </div>
        </FrostedSection>
      </PageShell>
    );
  }

  const reviews = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      text: true,
      firstName: true,
      lastName: true,
      isAnonymous: true,
      verified: true,
      approved: true,
      createdAt: true,
    },
  });

  const pending = reviews.filter((r) => !r.approved);
  const approved = reviews.filter((r) => r.approved);

  return (
    <PageShell>
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "animate-fade-in")}>
            <h1 className={cn("text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl")}>
              Review Approval
            </h1>
            <div className="flex gap-2">
              <span className="bg-coquelicot-500/20 text-coquelicot-400 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {pending.length} pending
              </span>
              <span className="bg-moonstone-600/20 text-moonstone-600 rounded-full px-2.5 py-0.5 text-xs font-medium">
                {approved.length} approved
              </span>
            </div>
          </section>

          <section className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}>
            <ReviewApprovalList
              pending={pending}
              approved={approved}
              token={token!}
            />
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
