// src/app/admin/(shell)/reviews/page.tsx
// Admin reviews page, built around asking for Google reviews. Loads reviews plus every
// channel a review link goes out on - booking sends, manual contact sends, and the
// automatic invoice review ask (soft-capped at 1000 each). The main column holds the
// automatic asks, "Who you can ask" (every contact with their ask status), the send form
// and the link history; reviews left on the site sit in the side column for approval.

import { Card } from "@/features/admin/components/ui/Card";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { ReviewApprovalList } from "@/features/reviews/components/admin/ReviewApprovalList";
import {
  ReviewAskPeople,
  type AskPerson,
} from "@/features/reviews/components/admin/ReviewAskPeople";
import {
  ReviewAskQueue,
  type RecentReviewAsk,
  type UpcomingReviewAsk,
} from "@/features/reviews/components/admin/ReviewAskQueue";
import {
  ReviewLinkHistoryTable,
  type LinkHistoryEntry,
  type LinkSource,
} from "@/features/reviews/components/admin/ReviewLinkHistoryTable";
import { SendReviewLinkForm } from "@/features/reviews/components/admin/SendReviewLinkForm";
import {
  loadRecentReviewAskOutcomes,
  loadReviewAskCandidates,
} from "@/features/reviews/lib/review-ask-queue.server";
import { askPersonStatus, reviewAskNoteLabel } from "@/features/reviews/lib/review-ask-rules";
import { requireAdminAuth } from "@/shared/lib/auth";
import { formatDateShort } from "@/shared/lib/date-format";
import { toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reviews - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin reviews page for approving/revoking reviews and sending review links.
 * @param props - Page props.
 * @param props.searchParams - Optional `contactId` to prefill the send form (from a contact's detail page).
 * @returns Reviews management page element.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ contactId?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const { contactId } = await searchParams;

  // Soft caps to prevent unbounded scans as data grows. The page joins these
  // sets to build a unified link history; if the most recent 1000 ever stops
  // being enough, swap in cursor pagination per section.
  const now = new Date();
  const { reviews: reviewSettings } = await getSettings();
  const [reviews, sentBookings, sentInvoices, allContacts, optOuts, candidates, recentAsks] =
    await Promise.all([
      prisma.review.findMany({
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: {
          id: true,
          text: true,
          firstName: true,
          lastName: true,
          isAnonymous: true,
          status: true,
          customerRef: true,
          bookingId: true,
          contactId: true,
          createdAt: true,
        },
      }),
      prisma.booking.findMany({
        where: { reviewSentAt: { not: null } },
        orderBy: { reviewSentAt: "desc" },
        take: 1000,
        select: {
          id: true,
          name: true,
          email: true,
          reviewSentAt: true,
          reviewSubmittedAt: true,
          reviewToken: true,
        },
      }),
      // Invoices whose email carried the review line. That send is stamped on the
      // invoice and never on the contact, so a contact-only read cannot see it -
      // which is what used to drop these reviewers into "Legacy".
      prisma.invoice.findMany({
        where: { reviewLinkSentAt: { not: null } },
        orderBy: { reviewLinkSentAt: "desc" },
        take: 1000,
        select: { id: true, contactId: true, clientEmail: true, reviewLinkSentAt: true },
      }),
      // One read of the contact book serves the picker, the suppression sets and
      // the link history, so all three describe the same 1000 rows.
      prisma.contact.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: {
          id: true,
          name: true,
          email: true,
          altEmails: true,
          phone: true,
          address: true,
          reviewToken: true,
          altReviewTokens: true,
          reviewLinkSentAt: true,
          reviewLinkSentMode: true,
          reviewLinkSubmittedAt: true,
        },
      }),
      // Anyone who has asked not to get review asks, or unsubscribed from email, shows
      // in "Who you can ask" without a send button.
      Promise.all([
        prisma.reviewAskOptOut.findMany({ select: { email: true, contactId: true } }),
        prisma.emailOptOut.findMany({ select: { email: true, contactId: true } }),
      ]),
      reviewSettings.reviewAskEnabled
        ? loadReviewAskCandidates(now, {
            delayDays: reviewSettings.reviewAskDelayDays,
            gapDays: reviewSettings.reviewAskGapDays,
          })
        : Promise.resolve([]),
      loadRecentReviewAskOutcomes(now, 14),
    ]);

  type ContactRow = (typeof allContacts)[number];

  const contactMap = new Map(allContacts.map((c) => [c.id, c.name]));
  const contactById = new Map(allContacts.map((c) => [c.id, c]));

  // Every token and address that still reaches a live contact, tokens inherited
  // from a merged-away row included: a review stores whichever token was live
  // when the customer clicked it, and a merge must not orphan the older one.
  // Primaries are indexed first so one person's alt never shadows another's own.
  const contactByToken = new Map<string, ContactRow>();
  const contactByEmail = new Map<string, ContactRow>();
  for (const c of allContacts) {
    if (c.reviewToken && !contactByToken.has(c.reviewToken)) contactByToken.set(c.reviewToken, c);
    if (c.email && !contactByEmail.has(c.email.toLowerCase())) {
      contactByEmail.set(c.email.toLowerCase(), c);
    }
  }
  for (const c of allContacts) {
    for (const t of c.altReviewTokens) {
      if (!contactByToken.has(t)) contactByToken.set(t, c);
    }
    for (const e of c.altEmails) {
      if (!contactByEmail.has(e.toLowerCase())) contactByEmail.set(e.toLowerCase(), c);
    }
  }

  /**
   * Resolves the live contact behind a review: the stored link first, then the
   * magic-link token it was submitted under.
   * @param review - Review row to resolve.
   * @param review.contactId - Contact the review is already linked to, if any.
   * @param review.customerRef - Magic-link token the review was submitted under, if any.
   * @returns The contact, or null when nobody in the book matches.
   */
  function contactForReview(review: {
    contactId: string | null;
    customerRef: string | null;
  }): ContactRow | null {
    if (review.contactId) {
      const linked = contactById.get(review.contactId);
      if (linked) return linked;
    }
    if (review.customerRef) return contactByToken.get(review.customerRef) ?? null;
    return null;
  }

  const reviewCountByContact = new Map<string, number>();
  for (const r of reviews) {
    if (r.contactId) {
      reviewCountByContact.set(r.contactId, (reviewCountByContact.get(r.contactId) ?? 0) + 1);
    }
  }

  const reviewRows = reviews.map((r) => ({
    ...r,
    contactId: r.contactId ?? null,
    contactName: r.contactId ? (contactMap.get(r.contactId) ?? null) : null,
  }));

  const pending = reviewRows.filter((r) => r.status !== "approved");
  const approved = reviewRows.filter((r) => r.status === "approved");

  const contacts = allContacts.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    reviewCount: reviewCountByContact.get(c.id) ?? 0,
  }));

  // setDate over Date.now() arithmetic: react-hooks/purity rejects Date.now() in
  // render and does not except server components, which only render once per
  // request anyway. setDate also rolls months correctly on its own.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Everyone who has been asked, one entry per person rather than per send: a
  // manual send and an invoice review line to the same contact are one ask at
  // the later of the two dates, which is the one a cooldown cares about.
  const askByContact = new Map<string, { contact: ContactRow; sentAt: Date; source: LinkSource }>();
  for (const c of allContacts) {
    if (!c.reviewLinkSentAt) continue;
    askByContact.set(c.id, {
      contact: c,
      sentAt: c.reviewLinkSentAt,
      source: c.reviewLinkSentMode === "sms" ? "Manual SMS" : "Manual email",
    });
  }
  for (const inv of sentInvoices) {
    if (!inv.reviewLinkSentAt) continue;
    // Same resolution order the invoice email itself used: the stored link
    // first, then the billing address matched against the contact book.
    const c =
      (inv.contactId ? contactById.get(inv.contactId) : undefined) ??
      contactByEmail.get(inv.clientEmail.toLowerCase());
    if (!c) continue;
    const current = askByContact.get(c.id);
    if (current && current.sentAt >= inv.reviewLinkSentAt) continue;
    askByContact.set(c.id, { contact: c, sentAt: inv.reviewLinkSentAt, source: "Invoice" });
  }

  /**
   * True when a review is already on file for this contact - left through their
   * own link, or linked to them by the operator.
   * @param c - Contact to test.
   * @returns Whether they have already reviewed.
   */
  function hasReviewed(c: ContactRow): boolean {
    return !!c.reviewLinkSubmittedAt || (reviewCountByContact.get(c.id) ?? 0) > 0;
  }

  // "Who you can ask": every contact with their latest ask and whether they've reviewed.
  // Reviews and booking sends match on email and phone as well as by id, so a duplicate
  // pair that hasn't been merged yet still counts as the one person it is.
  const reviewedEmails = new Set<string>();
  const reviewedPhones = new Set<string>();
  const bookingAskByEmail = new Map<string, Date>();
  for (const b of sentBookings) {
    if (!b.email) continue;
    const key = b.email.toLowerCase();
    if (b.reviewSubmittedAt) reviewedEmails.add(key);
    const prev = bookingAskByEmail.get(key);
    if (b.reviewSentAt && (!prev || b.reviewSentAt > prev))
      bookingAskByEmail.set(key, b.reviewSentAt);
  }
  for (const c of allContacts) {
    if (!hasReviewed(c)) continue;
    if (c.email) reviewedEmails.add(c.email.toLowerCase());
    if (c.phone) reviewedPhones.add(toE164NZ(c.phone));
  }

  const [reviewOptOuts, mailingOptOuts] = optOuts;
  /**
   * Whether an opt-out list covers a contact, by id or by any of their addresses.
   * @param rows - Opt-out rows.
   * @param c - Contact to test.
   * @returns True when one of the rows is theirs.
   */
  function optedOut(rows: { email: string; contactId: string | null }[], c: ContactRow): boolean {
    const emails = new Set([c.email, ...c.altEmails].flatMap((e) => (e ? [e.toLowerCase()] : [])));
    return rows.some((o) => o.contactId === c.id || emails.has(o.email.toLowerCase()));
  }

  const askPeople: AskPerson[] = allContacts.map((c) => {
    const emails = [c.email, ...c.altEmails].flatMap((e) => (e ? [e.toLowerCase()] : []));
    const stamps = [
      askByContact.get(c.id)?.sentAt,
      ...emails.map((e) => bookingAskByEmail.get(e)),
    ].filter((d): d is Date => !!d);
    const lastAskedAt = stamps.length
      ? new Date(Math.max(...stamps.map((d) => d.getTime())))
      : null;
    const reviewed =
      hasReviewed(c) ||
      emails.some((e) => reviewedEmails.has(e)) ||
      (!!c.phone && reviewedPhones.has(toE164NZ(c.phone)));
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      lastAskedAt: lastAskedAt?.toISOString() ?? null,
      status: askPersonStatus(
        {
          hasEmail: !!c.email,
          hasPhone: !!c.phone,
          lastAskedAt,
          reviewed,
          reviewOptOut: optedOut(reviewOptOuts, c),
          mailingOptOut: optedOut(mailingOptOuts, c),
        },
        reviewSettings.reviewAskGapDays,
        now,
      ),
    };
  });
  const readyCount = askPeople.filter((p) => p.status === "ready").length;

  const siteUrl = getSiteUrl();

  /**
   * Builds the public review URL for a token.
   * @param token - Review token, or null when the row has none.
   * @returns Full review URL, or "" when there is no link to offer.
   */
  function reviewUrlFor(token: string | null): string {
    return token ? `${siteUrl}/review?token=${token}` : "";
  }

  const knownBookingIds = new Set(sentBookings.map((b) => b.id));

  // Reviews that no tracked send accounts for. One that still resolves to a live
  // contact is shown against that contact - the ask predates send-tracking, or the
  // operator linked it by hand - so only a review with nobody behind it is legacy.
  const looseReviews = reviews.filter((r) => {
    if (r.bookingId && knownBookingIds.has(r.bookingId)) return false;
    const c = contactForReview(r);
    return !(c && askByContact.has(c.id));
  });

  const looseBookingIds = looseReviews.map((r) => r.bookingId).filter((id): id is string => !!id);
  const looseBookings =
    looseBookingIds.length > 0
      ? await prisma.booking.findMany({
          where: { id: { in: looseBookingIds } },
          select: { id: true, reviewToken: true },
        })
      : [];

  const bookingTokenMap = new Map(looseBookings.map((b) => [b.id, b.reviewToken]));

  const linkHistory: LinkHistoryEntry[] = [
    ...sentBookings.map((b) => ({
      id: null,
      customerRef: null,
      reviewId: null,
      name: b.name,
      email: b.email,
      phone: null,
      sentAt: b.reviewSentAt!.toISOString(),
      reviewed: !!b.reviewSubmittedAt,
      source: "Auto" as const,
      reviewUrl: reviewUrlFor(b.reviewToken),
    })),
    ...[...askByContact.values()].map(({ contact: c, sentAt, source }) => ({
      id: c.id,
      customerRef: c.reviewToken,
      reviewId: null,
      name: c.name,
      email: c.email,
      phone: c.phone,
      sentAt: sentAt.toISOString(),
      reviewed: hasReviewed(c),
      source,
      reviewUrl: reviewUrlFor(c.reviewToken),
    })),
    ...looseReviews.map((r) => {
      const c = contactForReview(r);
      const tok =
        (r.customerRef || null) ??
        c?.reviewToken ??
        (r.bookingId ? (bookingTokenMap.get(r.bookingId) ?? null) : null);
      return {
        id: c?.id ?? null,
        customerRef: tok,
        reviewId: r.id,
        name:
          c?.name ??
          (r.isAnonymous
            ? "Anonymous"
            : [r.firstName, r.lastName].filter(Boolean).join(" ") || "Unknown"),
        email: c?.email ?? null,
        phone: c?.phone ?? null,
        sentAt: r.createdAt.toISOString(),
        reviewed: true,
        source: c ? ("Linked" as const) : ("Legacy" as const),
        reviewUrl: reviewUrlFor(tok),
      };
    }),
  ].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());

  // Computed over the same soft-capped sets above, so past 1000 rows these describe the
  // most recent 1000, not all time. Linked and Legacy rows carry a review date rather
  // than a send date and are reviewed by definition, so counting them as sends would
  // flatter the conversion rate.
  const trackedSends = linkHistory.filter((e) => e.source !== "Legacy" && e.source !== "Linked");
  const sentLast30 = trackedSends.filter((e) => new Date(e.sentAt) >= thirtyDaysAgo);
  const reviewedLast30 = sentLast30.filter((e) => e.reviewed).length;
  const conversion =
    sentLast30.length > 0 ? Math.round((reviewedLast30 / sentLast30.length) * 100) : null;

  // Arriving from a contact's "Send review link" - load that person to prefill
  // the send form and open it. Soft-deleted or missing ids fall through to null.
  // Review asks: what's coming and what happened lately
  const upcomingAsks: UpcomingReviewAsk[] = candidates.map((c) => {
    const d = c.decision;
    return {
      invoiceId: c.invoice.id,
      number: c.invoice.number,
      name: c.contact?.name || c.invoice.clientName,
      when: d.action === "wait" ? `Due ${formatDateShort(d.dueAt)}` : "Goes out at the next run",
      warning:
        d.action === "wait"
          ? reviewAskNoteLabel(d.forecast)
          : d.action === "skip"
            ? reviewAskNoteLabel(d.reason)
            : null,
    };
  });
  // Invoices the rollout backfill marked as sent before automatic asks began are
  // bookkeeping, not asks the job decided on, so they stay out of "Last 14 days".
  const recentAskRows: RecentReviewAsk[] = recentAsks
    .filter((r) => r.note !== "before_auto")
    .map((r) => ({
      invoiceId: r.invoiceId,
      number: r.number,
      name: r.clientName,
      outcome: r.outcome,
      detail: reviewAskNoteLabel(r.note),
      date: formatDateShort(r.decidedAt),
    }));

  const prefillContact = contactId
    ? await prisma.contact.findFirst({
        where: { id: contactId, deletedAt: null },
        select: { name: true, email: true, phone: true },
      })
    : null;

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Ask past clients for a Google review. Approve anything left on your site."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ready to ask" value={readyCount} sub="not asked lately" />
        <StatCard label="Links sent" value={sentLast30.length} sub="last 30 days" />
        <StatCard
          label="Turned into reviews"
          value={conversion === null ? "-" : `${conversion}%`}
          sub={
            conversion === null
              ? "no sends in the last 30 days"
              : `${reviewedLast30} of ${sentLast30.length} sent`
          }
          tone={conversion !== null && conversion >= 50 ? "success" : "default"}
        />
        <StatCard
          label="Site reviews to approve"
          value={pending.length}
          sub={pending.length > 0 ? "waiting on you" : "all caught up"}
          tone={pending.length > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-russian-violet">Automatic asks</h2>
            <ReviewAskQueue
              enabled={reviewSettings.reviewAskEnabled}
              upcoming={upcomingAsks}
              recent={recentAskRows}
            />
          </Card>

          <Card>
            <h2 className="mb-1 text-sm font-semibold text-russian-violet">Who you can ask</h2>
            <p className="mb-4 text-xs text-admin-muted">
              Everyone in your contacts. The ask leads with your Google review link.
            </p>
            <ReviewAskPeople people={askPeople} gapDays={reviewSettings.reviewAskGapDays} />
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-semibold text-russian-violet">Send to someone new</h2>
            <SendReviewLinkForm
              prefill={prefillContact ?? undefined}
              defaultOpen={prefillContact !== null}
            />
          </Card>

          {linkHistory.length > 0 && (
            <Card>
              <h2 className="mb-4 text-sm font-semibold text-russian-violet">Link history</h2>
              <ReviewLinkHistoryTable entries={linkHistory} />
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card flushOnPhone>
            <h2 className="mb-1 text-sm font-semibold text-russian-violet">Reviews on your site</h2>
            <p className="mb-4 text-xs text-admin-muted">
              {approved.length} approved and showing on the site.
            </p>
            <ReviewApprovalList
              pending={pending}
              approved={approved}
              contacts={contacts}
              showSendForm={false}
              initialStatus="pending"
            />
          </Card>
        </div>
      </div>
    </>
  );
}
