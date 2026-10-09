"use client";
// src/features/business/components/QuickPriceCards.tsx
// Display cards for the quick price page: today's jobs to pick from, and the total to pay
// with its breakdown and bank details. The figures are worked out in QuickPriceView.

import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import type { QuickEvent } from "@/features/business/components/QuickPriceView";
import { type calcJobTotal, formatMins, formatNZD } from "@/features/business/lib/business";
import { bankParticulars } from "@/features/business/lib/payment-fields";
import type { ActivePromo } from "@/features/business/lib/promos";
import type { TravelEntry } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import Link from "next/link";
import type React from "react";

interface TodaysJobsProps {
  events: QuickEvent[];
  activeEventId: string | null;
}

/**
 * Today's booking-calendar events as links that reload the quick price seeded from one.
 * @param props - Component props.
 * @param props.events - Today's events, earliest first.
 * @param props.activeEventId - The event the form is seeded from, or null for a blank form.
 * @returns Today's jobs card element.
 */
export function QuickTodaysJobs({ events, activeEventId }: TodaysJobsProps): React.ReactElement {
  return (
    <Card>
      <CardHeader
        title="Today's jobs"
        className="mb-2 items-center"
        actions={
          activeEventId !== null && (
            <Link
              href="/admin/business/quick?eventId=none"
              className="text-sm font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
            >
              Clear
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-1">
        {events.map((ev) => {
          const active = ev.id === activeEventId;
          return (
            <Link
              key={ev.id}
              href={`/admin/business/quick?eventId=${encodeURIComponent(ev.id)}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-base text-admin-text",
                active
                  ? "border-russian-violet/40 bg-russian-violet/5 font-medium"
                  : "border-admin-border hover:bg-admin-bg",
              )}
            >
              <span className="min-w-0 truncate">{ev.summary}</span>
              <span className="shrink-0 text-sm text-admin-text-secondary">
                {ev.start}-{ev.end}
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

interface TotalCardProps {
  totals: ReturnType<typeof calcJobTotal>;
  billedMins: number;
  hourlyRate: number;
  travel: TravelEntry | null;
  noTravel: boolean;
  onToggleNoTravel: () => void;
  driveMins: number;
  lookingUp: boolean;
  holidayName: string | null;
  promo: ActivePromo | null;
  bankAccount: string;
  clientName: string | null;
}

/**
 * The total to pay, its time/travel/surcharge/promo/GST lines, and the bank details.
 * @param props - Component props.
 * @param props.totals - Job totals from calcJobTotal.
 * @param props.billedMins - Billed minutes after the snap and minimum; 0 before a start time.
 * @param props.hourlyRate - Effective hourly rate for the labour line.
 * @param props.travel - Looked-up round trip, or null.
 * @param props.noTravel - Whether travel is dropped from the total.
 * @param props.onToggleNoTravel - Drops travel from the total or adds it back.
 * @param props.driveMins - Round-trip drive minutes.
 * @param props.lookingUp - True while a travel lookup is in flight.
 * @param props.holidayName - Today's public holiday name, or null.
 * @param props.promo - Automatic promo applied, or null.
 * @param props.bankAccount - Account number for bank transfers; empty hides the section.
 * @param props.clientName - Seeded client name for the bank particulars, or null.
 * @returns Total card element.
 */
export function QuickTotalCard({
  totals,
  billedMins,
  hourlyRate,
  travel,
  noTravel,
  onToggleNoTravel,
  driveMins,
  lookingUp,
  holidayName,
  promo,
  bankAccount,
  clientName,
}: TotalCardProps): React.ReactElement {
  return (
    <Card className="text-admin-text">
      <p className="text-sm text-admin-text-secondary">Total to pay</p>
      <p className="mt-1 text-5xl font-bold tracking-tight text-russian-violet">
        {formatNZD(totals.total)}
      </p>

      <dl className="mt-4 flex flex-col gap-2 border-t border-admin-border pt-4 text-base">
        <div className="flex justify-between gap-3">
          <dt>
            Time
            {billedMins > 0 && (
              <span className="text-admin-text-secondary">
                {" "}
                - {formatMins(billedMins)} at {formatNZD(hourlyRate)}/hr
              </span>
            )}
          </dt>
          <dd>{billedMins > 0 ? formatNZD(totals.tasksTotal) : "Enter a start time"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="min-w-0">
            Travel
            {noTravel ? (
              <span className="text-admin-text-secondary"> - not charged</span>
            ) : (
              driveMins > 0 && (
                <span className="text-admin-text-secondary"> - {driveMins} min round trip</span>
              )
            )}
            {(travel || noTravel) && (
              <button
                type="button"
                onClick={onToggleNoTravel}
                className="ml-2 text-sm font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
              >
                {noTravel ? "Add back" : "No travel"}
              </button>
            )}
          </dt>
          <dd className="shrink-0">
            {noTravel
              ? formatNZD(0)
              : travel
                ? formatNZD(totals.travelTotal)
                : lookingUp
                  ? "Looking up..."
                  : "-"}
          </dd>
        </div>
        {totals.holidaySurcharge > 0 && (
          <div className="flex justify-between gap-3">
            <dt>{holidayName ?? "Public holiday"} surcharge</dt>
            <dd>{formatNZD(totals.holidaySurcharge)}</dd>
          </div>
        )}
        {totals.promoDiscount > 0 && promo && (
          <div className="flex justify-between gap-3 text-moonstone-700">
            <dt>{promo.title}</dt>
            <dd>-{formatNZD(totals.promoDiscount)}</dd>
          </div>
        )}
        {totals.gstAmount > 0 && (
          <div className="flex justify-between gap-3 text-admin-text-secondary">
            <dt>Includes GST</dt>
            <dd>{formatNZD(totals.gstAmount)}</dd>
          </div>
        )}
      </dl>

      {bankAccount && (
        <div className="mt-4 border-t border-admin-border pt-4">
          <p className="text-sm text-admin-text-secondary">Bank transfer to</p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-wide select-all">
            {bankAccount}
          </p>
          {clientName && (
            <p className="mt-1 text-sm text-admin-text-secondary">
              Particulars:{" "}
              <span className="font-mono font-semibold text-admin-text select-all">
                {bankParticulars(clientName)}
              </span>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
