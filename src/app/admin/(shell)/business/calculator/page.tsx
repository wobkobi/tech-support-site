// src/app/admin/(shell)/business/calculator/page.tsx
// Job calculator page: loads pricing context server-side for CalculatorView. `?eventId=` /
// `?eventIds=` prefill from calendar events (gaps unbilled); `?reissue=` rebuilds a voided invoice.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { CalculatorView } from "@/features/business/components/CalculatorView";
import { buildEventPrefill } from "@/features/business/lib/event-prefill.server";
import {
  type ReissuePrefill,
  reissueEventIds,
  reissuePrefill,
} from "@/features/business/lib/invoice-reissue";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { getActivePromo } from "@/features/business/lib/promos";
import type { RateConfig, TaskTemplate } from "@/features/business/types/business";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calculator - Business",
  robots: { index: false, follow: false },
};

/**
 * Parses the event deep-link params into a de-duplicated id list.
 * @param params - Resolved search params.
 * @param params.eventId - Single event id from the schedule action.
 * @param params.eventIds - Comma-separated ids from the calculator's merge picker.
 * @returns Event ids to prefill from, empty when neither param is present.
 */
function parseEventIds(params: { eventId?: string; eventIds?: string }): string[] {
  const raw = [...(params.eventIds?.split(",") ?? []), ...(params.eventId ? [params.eventId] : [])];
  return Array.from(new Set(raw.map((id) => id.trim()).filter(Boolean)));
}

/**
 * Loads a voided invoice to re-issue; anything else gives null.
 * @param id - The `reissue` param.
 * @returns The prefill plus the invoice's billed events, or null.
 */
async function loadReissue(
  id: string | undefined,
): Promise<{ prefill: ReissuePrefill; eventIds: string[] } | null> {
  if (!id || !/^[a-f\d]{24}$/i.test(id)) return null;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice || invoice.status !== "VOIDED" || invoice.isQuote === true) return null;
  return { prefill: reissuePrefill(invoice), eventIds: reissueEventIds(invoice) };
}

/**
 * Job calculator page with AI parsing, time tracking, and rate management.
 * @param props - Page props.
 * @param props.searchParams - Optional `eventId` (schedule's "Bill in calculator"), `eventIds` (merged job), `reissue` (a voided invoice's id) or `quote=1` (the "New quote" shortcut).
 * @returns Calculator page element
 */
export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; eventIds?: string; reissue?: string; quote?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const params = await searchParams;
  const reissue = await loadReissue(params.reissue);
  // A re-issue bills the voided invoice's own events; it ignores any event params.
  const eventIds = reissue ? reissue.eventIds : parseEventIds(params);
  // A re-issue replaces a voided invoice, so it is never a quote.
  const quoteMode = params.quote === "1" && !reissue;
  const [identity, policy, rateRows, templateRows, promo, eventPrefill] = await Promise.all([
    getIdentity(),
    getPolicy(),
    // Full rows with ids: tasks pick modifiers by id.
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    prisma.taskTemplate.findMany({ orderBy: [{ usageCount: "desc" }, { description: "asc" }] }),
    getActivePromo(),
    // Bad/stale ids degrade to a normal calculator load.
    eventIds.length > 0 ? buildEventPrefill(eventIds) : Promise.resolve(null),
  ]);
  const pricing = {
    gstRegistered: policy.GST_REGISTERED,
    minTravelCharge: policy.MIN_TRAVEL_CHARGE,
    travelRatePerHour: policy.TRAVEL_RATE_PER_HOUR,
    minBillableMins: policy.MIN_BILLABLE_MINS,
    unsuccessfulFactor: policy.UNSUCCESSFUL_WORK_FACTOR,
    mergeSuggestGapMins: policy.MERGE_SUGGEST_GAP_MINS,
    taskTiming: {
      snapMins: policy.BILLING_INCREMENT_MINS,
      shortTaskMins: policy.SHORT_TASK_MINS,
      minTaskMins: policy.MIN_TASK_MINS,
    },
  };

  // Flatten Dates to ISO strings for the client types.
  const initialRates: RateConfig[] = rateRows.map((r) => ({
    id: r.id,
    label: r.label,
    ratePerHour: r.ratePerHour,
    flatRate: r.flatRate,
    hourlyDelta: r.hourlyDelta,
    percentDelta: r.percentDelta,
    unit: r.unit,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));
  const initialTaskTemplates: TaskTemplate[] = templateRows.map((t) => ({
    id: t.id,
    description: t.description,
    defaultPrice: t.defaultPrice,
    usageCount: t.usageCount,
    device: t.device,
    action: t.action,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title={quoteMode ? "New quote" : "Job calculator"}
        description={
          quoteMode
            ? "Parse the job with AI or build it by hand, then save it as a quote for the client."
            : "Parse a job with AI or build it by hand, then save it as an invoice or income."
        }
      />
      <Suspense>
        {/* Keyed by the event set to remount, since the prefill uses useState initialisers. */}
        <CalculatorView
          key={
            reissue
              ? `reissue:${params.reissue}`
              : `${eventIds.length > 0 ? eventIds.join(",") : "blank"}${quoteMode ? ":quote" : ""}`
          }
          identity={identity}
          pricing={pricing}
          cancellation={policy.CANCELLATION}
          initialRates={initialRates}
          initialTaskTemplates={initialTaskTemplates}
          initialPromo={promo}
          eventPrefill={eventPrefill}
          reissue={reissue?.prefill ?? null}
          quoteMode={quoteMode}
        />
      </Suspense>
    </>
  );
}
