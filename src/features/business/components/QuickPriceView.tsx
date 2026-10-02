// src/features/business/components/QuickPriceView.tsx
// On-site quick price: an address and a start/end time priced as one Standard labour line
// plus auto travel. Runs through calcJobTotal and lookupAutoTravel, the same pair the job
// calculator uses, so the figure quoted at the door matches what a later invoice would say.
// Travel can be dropped from the total, and the price can be recorded straight to income.

"use client";

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { Card } from "@/features/admin/components/ui/Card";
import { useToast } from "@/features/admin/components/ui/Toast";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import {
  calcJobTotal,
  effectiveHourlyRate,
  formatMins,
  formatMoneyCompact,
  formatNZD,
  timeDiffMins,
  todayISO,
} from "@/features/business/lib/business";
import { lookupAutoTravel } from "@/features/business/lib/calculator-helpers";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import { buildIncomeDescription } from "@/features/business/lib/invoice-maths";
import { bankParticulars } from "@/features/business/lib/payment-fields";
import { clampBillableMins } from "@/features/business/lib/pricing-policy";
import type { ActivePromo } from "@/features/business/lib/promos";
import type {
  JobCalculation,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { nzNowTime } from "@/shared/lib/timezone-utils";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

/** Live pricing values the quick price needs, resolved server-side. */
interface QuickPricing {
  gstRegistered: boolean;
  minTravelCharge: number;
  travelRatePerHour: number;
  minBillableMins: number;
  billingIncrementMins: number;
  /** Labour uplift fraction when today is a public holiday, else 0. */
  holidayUplift: number;
}

/** One of today's booking-calendar events, with NZ-local HH:MM bounds. */
export interface QuickEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
}

/** Form seed from the matched calendar event. */
export interface QuickPrefill {
  eventId: string;
  summary: string;
  clientName: string;
  address: string;
  /** NZ-local HH:MM on-site start. */
  start: string;
  /** End time to price to: now while still on site, else the booked end. */
  end: string;
  /** The event's own end, shown when the priced end differs from it. */
  bookedEnd: string;
  /** Frozen or looked-up round trip, or null when no drive is known. */
  travel: TravelEntry | null;
}

/** How a quick-price job can be paid; Mixed is left to the full income form. */
const PAID_BY = INCOME_METHODS.filter((m) => m !== "Mixed");

interface Props {
  rates: RateConfig[];
  /** Automatic promo live right now, or null. */
  promo: ActivePromo | null;
  /** Today's public holiday name, or null. */
  holidayName: string | null;
  /** Account number shown under the total for a bank transfer. */
  bankAccount: string;
  /** NZ wall-clock HH:MM at page load; seeds the end time without a hydration mismatch. */
  initialEnd: string;
  /** Today's booking-calendar events, earliest first. */
  events: QuickEvent[];
  /** Seed from the matched event, or null for a blank form. */
  prefill: QuickPrefill | null;
  pricing: QuickPricing;
}

/**
 * Quick price form and total.
 * @param props - Component props.
 * @param props.rates - Rate rows; the default hourly row prices labour.
 * @param props.promo - Automatic promo to apply, or null.
 * @param props.holidayName - Today's public holiday name, or null.
 * @param props.bankAccount - Account number for bank transfers.
 * @param props.initialEnd - End time to start with (now, at page load).
 * @param props.events - Today's events to match against.
 * @param props.prefill - Seed from the matched event, or null.
 * @param props.pricing - Live pricing settings.
 * @returns Quick price view.
 */
export function QuickPriceView({
  rates,
  promo,
  holidayName,
  bankAccount,
  initialEnd,
  events,
  prefill,
  pricing,
}: Props): React.ReactElement {
  const [address, setAddress] = useState(prefill?.address ?? "");
  const [start, setStart] = useState(prefill?.start ?? "");
  const [end, setEnd] = useState(prefill?.end ?? initialEnd);
  const [business, setBusiness] = useState(false);
  const [travel, setTravel] = useState<TravelEntry | null>(prefill?.travel ?? null);
  const [lookingUp, setLookingUp] = useState(false);
  const [travelNote, setTravelNote] = useState<string | null>(null);
  // Kept apart from travel so the looked-up drive survives switching the charge back on.
  const [noTravel, setNoTravel] = useState(false);
  const { toast } = useToast();
  const [customer, setCustomer] = useState(prefill?.clientName ?? "");
  const [paidBy, setPaidBy] = useState<(typeof PAID_BY)[number]>("Bank");
  const [income, setIncome] = useState<"idle" | "saving" | "added">("idle");
  const [incomeError, setIncomeError] = useState<string | null>(null);

  const standard =
    rates.find((r) => r.ratePerHour !== null && r.isDefault) ??
    rates.find((r) => r.ratePerHour !== null) ??
    null;
  // Same predicate the calculator uses, so a promo skips business labour here too.
  const businessModifier =
    rates.find((r) => r.label === "Business" && r.unit === "modifier") ?? null;
  const modifierIds = business && businessModifier ? [businessModifier.id] : [];
  const hourlyRate = effectiveHourlyRate(rates, standard?.id, modifierIds);

  const rawMins = timeDiffMins(start, end);
  // Snap + minimum floor up front so the time shown is the time billed.
  const billedMins =
    rawMins > 0
      ? clampBillableMins(rawMins, pricing.minBillableMins, pricing.billingIncrementMins)
      : 0;

  const tasks: TaskLine[] =
    billedMins > 0
      ? [
          {
            rateConfigId: null,
            baseRateId: standard?.id ?? null,
            modifierIds,
            description: "Labour",
            qty: billedMins / 60,
            unitPrice: hourlyRate,
            lineTotal: Math.round((billedMins / 60) * hourlyRate * 100) / 100,
            minutes: billedMins,
          },
        ]
      : [];
  const job: JobCalculation = {
    durationMins: billedMins,
    tasks,
    parts: [],
    travelEntries: travel && !noTravel ? [travel] : [],
    notes: "",
    clientName: "",
    clientEmail: "",
  };
  const totals = calcJobTotal(job, promo, {
    gstRegistered: pricing.gstRegistered,
    minTravelCharge: pricing.minTravelCharge,
    minBillableMins: pricing.minBillableMins,
    holidayUplift: pricing.holidayUplift,
    businessModifierId: businessModifier?.id ?? null,
    standardRate: standard?.ratePerHour ?? null,
    rates,
  });

  /**
   * Looks up the round-trip travel for an address at the entered times.
   * @param target - Address to price the drive to.
   */
  async function lookUpTravel(target: string): Promise<void> {
    if (!target.trim()) return;
    setLookingUp(true);
    setTravelNote(null);
    try {
      const entry = await lookupAutoTravel({
        jobAddress: target,
        aggregateStart: start,
        aggregateEnd: end,
        jobDate: todayISO(),
        durationMins: billedMins,
        travelRatePerHour: pricing.travelRatePerHour,
        minTravelCharge: pricing.minTravelCharge,
      });
      setTravel(entry);
      if (!entry) setTravelNote("Couldn't find a drive to that address - check the spelling.");
    } catch {
      setTravel(null);
      setTravelNote("Travel lookup failed. Try again.");
    } finally {
      setLookingUp(false);
    }
  }

  /** Records the total on screen as today's income; locks once it has gone in. */
  async function addToIncome(): Promise<void> {
    setIncome("saving");
    setIncomeError(null);
    try {
      const res = await fetch("/api/business/income", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: todayISO(),
          customer: customer.trim() || "Walk-in",
          description: buildIncomeDescription(job) + (noTravel ? " - no travel charged" : ""),
          amount: totals.total,
          method: paidBy,
        }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string; sheetSyncWarning?: boolean };
      if (!d.ok) {
        setIncome("idle");
        setIncomeError(d.error || "Could not add to income.");
        return;
      }
      setIncome("added");
      // recordIncome keeps the entry even when the Cashbook append fails, so say so.
      if (d.sheetSyncWarning) {
        toast("Added to income, but the Cashbook sheet update didn't go through.", {
          tone: "warning",
        });
      } else {
        toast("Added to income.", { tone: "success" });
      }
    } catch {
      setIncome("idle");
      setIncomeError("Could not add to income. Please try again.");
    }
  }

  const driveMins = travel
    ? (travel.durationMinsOneWay ?? 0) + (travel.durationMinsBack ?? travel.durationMinsOneWay ?? 0)
    : 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {events.length > 0 && (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-russian-violet">Today&apos;s jobs</h2>
            {prefill && (
              <Link
                href="/admin/business/quick?eventId=none"
                className="text-sm font-medium text-admin-text-secondary underline underline-offset-2"
              >
                Clear
              </Link>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {events.map((ev) => {
              const active = ev.id === prefill?.eventId;
              return (
                <Link
                  key={ev.id}
                  href={`/admin/business/quick?eventId=${encodeURIComponent(ev.id)}`}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-base",
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
      )}

      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="quick-address" className="mb-1 block text-sm font-medium">
              Address
            </label>
            <div className="flex gap-2">
              <div className="flex-1">
                <AddressAutocomplete
                  id="quick-address"
                  value={address}
                  onChange={(v) => {
                    setAddress(v);
                    // A changed address makes the looked-up drive wrong, so drop it.
                    setTravel(null);
                    setTravelNote(null);
                  }}
                  onPlaceSelected={(p) => {
                    setAddress(p.formattedAddress);
                    void lookUpTravel(p.formattedAddress);
                  }}
                  placeholder="Client address or suburb"
                  aria-label="Client address or suburb"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void lookUpTravel(address);
                    }
                  }}
                  inputClassName={ADMIN_INPUT_CLS}
                />
              </div>
              <AdminButton
                variant="secondary"
                onClick={() => void lookUpTravel(address)}
                busy={lookingUp}
                disabled={!address.trim()}
              >
                {travel ? "Recheck" : "Travel"}
              </AdminButton>
            </div>
            {travelNote && <p className="mt-1 text-sm text-coquelicot-700">{travelNote}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quick-start" className="mb-1 block text-sm font-medium">
                Start
              </label>
              <input
                id="quick-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={ADMIN_INPUT_CLS}
              />
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label htmlFor="quick-end" className="text-sm font-medium">
                  End
                </label>
                <button
                  type="button"
                  onClick={() => setEnd(nzNowTime())}
                  className="text-sm font-medium text-russian-violet underline underline-offset-2"
                >
                  Now
                </button>
              </div>
              <input
                id="quick-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={ADMIN_INPUT_CLS}
              />
              {prefill && end !== prefill.bookedEnd && (
                <p className="mt-1 text-sm text-admin-text-secondary">
                  Booked until {prefill.bookedEnd}
                </p>
              )}
            </div>
          </div>

          {businessModifier && (
            <AdminCheckbox
              checked={business}
              onChange={setBusiness}
              label={`Business rate (+${formatMoneyCompact(businessModifier.hourlyDelta ?? 0)}/hr)`}
            />
          )}
        </div>
      </Card>

      <Card>
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
            <dt>
              Travel
              {noTravel ? (
                <span className="text-admin-text-secondary"> - not charged</span>
              ) : (
                driveMins > 0 && (
                  <span className="text-admin-text-secondary"> - {driveMins} min round trip</span>
                )
              )}
            </dt>
            <dd className="flex items-center gap-2">
              {noTravel
                ? formatNZD(0)
                : travel
                  ? formatNZD(totals.travelTotal)
                  : lookingUp
                    ? "Looking up..."
                    : "-"}
              {(travel || noTravel) && (
                <AdminButton size="xs" variant="secondary" onClick={() => setNoTravel((v) => !v)}>
                  {noTravel ? "Add back" : "No travel"}
                </AdminButton>
              )}
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
            {prefill?.clientName && (
              <p className="mt-1 text-sm text-admin-text-secondary">
                Particulars:{" "}
                <span className="font-mono font-semibold text-admin-text select-all">
                  {bankParticulars(prefill.clientName)}
                </span>
              </p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-russian-violet">Add to income</h2>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label htmlFor="quick-customer" className="mb-1 block text-sm font-medium">
              Customer
            </label>
            <input
              id="quick-customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Walk-in"
              disabled={income === "added"}
              className={ADMIN_INPUT_CLS}
            />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium">Paid by</span>
            <div className="flex gap-2">
              {PAID_BY.map((m) => (
                <AdminButton
                  key={m}
                  aria-label={paidBy === m ? `Paid by ${m} (selected)` : `Paid by ${m}`}
                  variant={paidBy === m ? "primary" : "secondary"}
                  disabled={income === "added"}
                  onClick={() => setPaidBy(m)}
                >
                  {m}
                </AdminButton>
              ))}
            </div>
          </div>
          {income === "added" ? (
            <Link
              href="/admin/business/income"
              className="text-base font-semibold text-moonstone-700 underline underline-offset-2"
            >
              Added to income - view
            </Link>
          ) : (
            <AdminButton
              onClick={() => void addToIncome()}
              busy={income === "saving"}
              disabled={totals.total <= 0}
            >
              Add {formatNZD(totals.total)} to income
            </AdminButton>
          )}
          {incomeError && <p className="text-sm text-coquelicot-700">{incomeError}</p>}
        </div>
      </Card>
    </div>
  );
}
