"use client";
// src/features/business/components/QuickPriceView.tsx
// On-site quick price: an address and a start/end time priced as one Standard labour line
// plus auto travel. Runs through calcJobTotal and lookupAutoTravel, the same pair the job
// calculator uses, so the figure quoted at the door matches what a later invoice would say.
// Travel can be dropped from the total, and the money taken can be recorded straight to
// income: the amount received (which can differ from the total) by Bank, Cash, or split
// across both as two rows, the same way an invoice's already-paid part and its balance are.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { ADMIN_INPUT_CLS, ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { QuickTodaysJobs, QuickTotalCard } from "@/features/business/components/QuickPriceCards";
import { AlreadyPaidField } from "@/features/business/components/invoice/AlreadyPaidField";
import {
  EMPTY_ALREADY_PAID,
  alreadyPaidAmount,
  type AlreadyPaidMethod,
  type AlreadyPaidState,
} from "@/features/business/lib/already-paid-input";
import {
  calcJobTotal,
  effectiveHourlyRate,
  formatMoneyCompact,
  formatNZD,
  timeDiffMins,
  todayISO,
} from "@/features/business/lib/business";
import { lookupAutoTravel } from "@/features/business/lib/calculator-helpers";
import { buildIncomeDescription } from "@/features/business/lib/invoice-maths";
import { clampBillableMins } from "@/features/business/lib/pricing-policy";
import type { ActivePromo } from "@/features/business/lib/promos";
import type {
  JobCalculation,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import {
  ContactNameInput,
  useGoogleContacts,
} from "@/features/contacts/components/ContactNameInput";
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

/** How a quick-price job can be paid. Split records a Cash row and a Bank row, not "Mixed". */
const PAID_BY = ["Bank", "Cash", "Split"] as const;

/** One income row to record. */
interface IncomeRow {
  method: AlreadyPaidMethod;
  amount: number;
}

/**
 * Typed dollars to a number, rounded to cents.
 * @param raw - The box's text, with or without "$" and commas.
 * @returns The amount, or 0 when blank or not a number.
 */
function parseDollars(raw: string): number {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

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
  const contacts = useGoogleContacts();
  const [paidBy, setPaidBy] = useState<(typeof PAID_BY)[number]>("Bank");
  // Null follows the total; text once the operator types a different amount.
  const [received, setReceived] = useState<string | null>(null);
  // The split's first part, in the same shape as an invoice's "Already paid" box.
  const [part, setPart] = useState<AlreadyPaidState>(EMPTY_ALREADY_PAID);
  // Methods already recorded, so a retry after a half-saved split posts only the missing row.
  const [savedMethods, setSavedMethods] = useState<AlreadyPaidMethod[]>([]);
  const [saving, setSaving] = useState(false);
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

  const receivedAmount = received === null ? totals.total : parseDollars(received);
  const receivedDiff = Math.round((receivedAmount - totals.total) * 100) / 100;
  const partAmount = alreadyPaidAmount(part);
  const restMethod: AlreadyPaidMethod = part.method === "Cash" ? "Bank" : "Cash";
  const restAmount = Math.round((receivedAmount - partAmount) * 100) / 100;
  const isSplit = paidBy === "Split";
  const rows: IncomeRow[] = isSplit
    ? [
        { method: part.method, amount: partAmount },
        { method: restMethod, amount: restAmount },
      ]
    : [{ method: paidBy, amount: receivedAmount }];
  // A split needs money on both sides; all of it one way is just Cash or Bank.
  const canSave = receivedAmount > 0 && (!isSplit || (partAmount > 0 && restAmount > 0));
  const pendingRows = rows.filter((r) => !savedMethods.includes(r.method));
  const added = savedMethods.length > 0 && pendingRows.length === 0;
  // Once a row is in, the figures stay put so the retry posts what the first row assumed.
  const locked = saving || savedMethods.length > 0;
  // Names the method on split rows, so a retry says which half is still to go in.
  const saveLabel = `Add ${pendingRows
    .map((r) => `${formatNZD(r.amount)}${isSplit ? ` ${r.method.toLowerCase()}` : ""}`)
    .join(" + ")} to income`;

  /**
   * Records the money taken as today's income: one row, or a Cash row and a Bank row for a
   * split. Rows already in are skipped, so a retry after a partial failure never doubles one.
   */
  async function addToIncome(): Promise<void> {
    setSaving(true);
    setIncomeError(null);
    // The note keeps the quoted total when the money taken differs from it, or is split.
    const totalNote = isSplit
      ? ` (split, total ${formatNZD(totals.total)})`
      : receivedDiff !== 0
        ? ` (total ${formatNZD(totals.total)})`
        : "";
    const description =
      buildIncomeDescription(job) + (noTravel ? " - no travel charged" : "") + totalNote;
    let sheetWarning = false;
    for (const row of pendingRows) {
      try {
        const res = await fetch("/api/business/income", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            date: todayISO(),
            customer: customer.trim() || "Walk-in",
            description,
            amount: row.amount,
            method: row.method,
          }),
        });
        const d = (await res.json()) as {
          ok?: boolean;
          error?: string;
          sheetSyncWarning?: boolean;
        };
        if (!d.ok) {
          setIncomeError(d.error || `Could not add the ${row.method} payment to income.`);
          setSaving(false);
          return;
        }
        // recordIncome keeps the entry even when the Cashbook append fails, so say so.
        if (d.sheetSyncWarning) sheetWarning = true;
        setSavedMethods((prev) => [...prev, row.method]);
      } catch {
        setIncomeError(`Could not add the ${row.method} payment to income. Please try again.`);
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    if (sheetWarning) {
      toast("Added to income, but the Cashbook sheet update didn't go through.", {
        tone: "warning",
      });
    } else {
      toast("Added to income.", { tone: "success" });
    }
  }

  const driveMins = travel
    ? (travel.durationMinsOneWay ?? 0) + (travel.durationMinsBack ?? travel.durationMinsOneWay ?? 0)
    : 0;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      {events.length > 0 && (
        <QuickTodaysJobs events={events} activeEventId={prefill?.eventId ?? null} />
      )}

      <Card className="text-admin-text">
        <div className="flex flex-col gap-4">
          <AdminField label="Address" htmlFor="quick-address">
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
          </AdminField>

          <div className="grid grid-cols-2 gap-3">
            <AdminField label="Start" htmlFor="quick-start">
              {/* min-w-0 + appearance-none: iOS Safari gives time inputs an intrinsic
                  width wider than a phone's half column, so they spill out of the card. */}
              <AdminInput
                id="quick-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="block min-w-0 appearance-none"
              />
            </AdminField>
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <label htmlFor="quick-end" className={cn(ADMIN_LABEL_CLS, "mb-0")}>
                  End
                </label>
                <button
                  type="button"
                  onClick={() => setEnd(nzNowTime())}
                  className="text-sm font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
                >
                  Now
                </button>
              </div>
              <AdminInput
                id="quick-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="block min-w-0 appearance-none"
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

      <QuickTotalCard
        totals={totals}
        billedMins={billedMins}
        hourlyRate={hourlyRate}
        travel={travel}
        noTravel={noTravel}
        onToggleNoTravel={() => setNoTravel((v) => !v)}
        driveMins={driveMins}
        lookingUp={lookingUp}
        holidayName={holidayName}
        promo={promo}
        bankAccount={bankAccount}
        clientName={prefill?.clientName ?? null}
      />

      <Card className="text-admin-text">
        <CardHeader title="Add to income" className="mb-3" />
        <div className="flex flex-col gap-3">
          <AdminField label="Customer" htmlFor="quick-customer">
            <ContactNameInput
              id="quick-customer"
              value={customer}
              onChange={setCustomer}
              contacts={contacts}
              placeholder="Walk-in"
              disabled={locked}
              className={ADMIN_INPUT_CLS}
            />
          </AdminField>
          <AdminField label="Amount received" htmlFor="quick-received">
            <AdminInput
              id="quick-received"
              type="text"
              inputMode="decimal"
              value={received ?? totals.total.toFixed(2)}
              onChange={(e) => setReceived(e.target.value)}
              disabled={locked}
              className="w-32"
            />
            {received !== null && (
              <p className="mt-1 text-sm text-admin-text-secondary">
                {receivedDiff > 0
                  ? `${formatNZD(receivedDiff)} more than the total. `
                  : receivedDiff < 0
                    ? `${formatNZD(-receivedDiff)} less than the total. `
                    : ""}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => setReceived(null)}
                    className="font-medium text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
                  >
                    Use total
                  </button>
                )}
              </p>
            )}
          </AdminField>
          <div>
            <span className={ADMIN_LABEL_CLS}>Paid by</span>
            {/* Segmented toggle, the same look as the schedule's Short/Long switch. */}
            <div className={SEGMENTED_GROUP_CLS}>
              {PAID_BY.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-label={paidBy === m ? `Paid by ${m} (selected)` : `Paid by ${m}`}
                  aria-pressed={paidBy === m}
                  disabled={locked}
                  onClick={() => setPaidBy(m)}
                  className={segmentedButtonClass(paidBy === m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {isSplit && (
            <AlreadyPaidField
              value={part}
              onChange={setPart}
              total={receivedAmount}
              disabled={locked}
              inputClassName={ADMIN_INPUT_CLS}
              label="Part paid"
              balanceLabel={`Rest by ${restMethod}:`}
              totalName="the amount received"
              coversNote="That's all of it - pick Cash or Bank above instead."
            />
          )}
          {added ? (
            <Link
              href="/admin/business/income"
              className="text-base font-semibold text-moonstone-700 underline underline-offset-2"
            >
              Added to income - view
            </Link>
          ) : (
            <AdminButton onClick={() => void addToIncome()} busy={saving} disabled={!canSave}>
              {saveLabel}
            </AdminButton>
          )}
          {incomeError && <p className="text-sm text-coquelicot-700">{incomeError}</p>}
        </div>
      </Card>
    </div>
  );
}
