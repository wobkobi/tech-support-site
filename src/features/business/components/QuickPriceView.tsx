"use client";
// src/features/business/components/QuickPriceView.tsx
// On-site quick price: one Standard labour line plus auto travel via the job calculator's
// helpers, with the money taken recordable straight to income as Bank, Cash or a split.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminTimeSelect } from "@/features/admin/components/ui/AdminTimeSelect";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import { useToast } from "@/features/admin/components/ui/Toast";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { ADMIN_INPUT_CLS, ADMIN_LABEL_CLS } from "@/features/admin/components/ui/field-classes";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { QuickTodaysJobs, QuickTotalCard } from "@/features/business/components/QuickPriceCards";
import { SurchargeToggle } from "@/features/business/components/SurchargeToggle";
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
  goldCardOffText,
  timeDiffMins,
  todayISO,
} from "@/features/business/lib/business";
import { lookupAutoTravel } from "@/features/business/lib/calculator-helpers";
import { goldCardPercent } from "@/features/business/lib/gold-card";
import { buildIncomeDescription } from "@/features/business/lib/invoice-maths";
import { isBusinessModifier } from "@/features/business/lib/job-modifiers";
import {
  chosenSurcharge,
  clampBillableMins,
  surchargeOption,
  unsuccessfulShareLabel,
  type DateSurcharge,
} from "@/features/business/lib/pricing-policy";
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
import { roundCents } from "@/shared/lib/money";
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
  /** Share of the labour still charged when the problem wasn't fixed (0.5 = half price). */
  unsuccessfulFactor: number;
  /** Weekend surcharge in $/hr, which the surcharge tick can bill on any day (0 = off). */
  weekendPerHour: number;
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
  /** When the job was booked (ISO), the day its promo was judged at; null when unknown. */
  bookedAt: string | null;
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
  return Number.isFinite(n) ? roundCents(n) : 0;
}

interface Props {
  rates: RateConfig[];
  /** The job's promo (its booking's, or whichever ran when it was booked), else today's, or null. */
  promo: ActivePromo | null;
  /** The job's labour surcharge (public holiday, weekend or after hours), or null. */
  surcharge: DateSurcharge | null;
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
 * @param props.surcharge - The job's labour surcharge (public holiday, weekend or after hours), or null.
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
  surcharge: todaySurcharge,
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
  // Couldn't fix the problem: the labour bills at the unsuccessful-visit share.
  const [unfixed, setUnfixed] = useState(false);
  const [goldCard, setGoldCard] = useState(false);
  // Surcharge tick (weekend, holiday, or after hours on a weekday); null follows today's date.
  const [surchargeOn, setSurchargeOn] = useState<boolean | null>(null);
  const surcharge = chosenSurcharge(todaySurcharge, surchargeOn, pricing.weekendPerHour);
  const surchargeChoice = surchargeOption(todaySurcharge, pricing.weekendPerHour);
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
  // The shared Business predicate (trimmed, any case), so a promo skips business labour here too.
  const businessModifier =
    rates.find((r) => isBusinessModifier(r) && r.unit === "modifier") ?? null;
  const modifierIds = business && businessModifier ? [businessModifier.id] : [];
  const hourlyRate = effectiveHourlyRate(rates, standard?.id, modifierIds);
  // The Gold Card rate from Settings > Rates; null hides the box.
  const goldCardRate = goldCardPercent(rates);
  const appliedGoldCard = goldCard ? goldCardRate : null;

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
            lineTotal: roundCents((billedMins / 60) * hourlyRate),
            minutes: billedMins,
            unsuccessful: unfixed,
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
    surchargePerHour: surcharge?.perHour ?? 0,
    unsuccessfulFactor: pricing.unsuccessfulFactor,
    businessModifierId: businessModifier?.id ?? null,
    standardRate: standard?.ratePerHour ?? null,
    rates,
    goldCardPercent: appliedGoldCard ?? 0,
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
  const receivedDiff = roundCents(receivedAmount - totals.total);
  const partAmount = alreadyPaidAmount(part);
  const restMethod: AlreadyPaidMethod = part.method === "Cash" ? "Bank" : "Cash";
  const restAmount = roundCents(receivedAmount - partAmount);
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
      buildIncomeDescription(job) +
      (unfixed ? " - couldn't fix" : "") +
      (appliedGoldCard ? " - Gold Card" : "") +
      (noTravel ? " - no travel charged" : "") +
      totalNote;
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
    // Phones stack in DOM order. On lg the total is a pinned right column beside the inputs
    // and Add to income; on xl the three sit in a row: inputs, total, Add to income.
    // Today's jobs runs across the top.
    <div className="mx-auto flex max-w-xl flex-col gap-4 lg:mx-0 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:grid-cols-3">
      {events.length > 0 && (
        <div className="lg:col-span-full">
          <QuickTodaysJobs events={events} activeEventId={prefill?.eventId ?? null} />
        </div>
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
              <AdminTimeSelect
                id="quick-start"
                value={start}
                onChange={setStart}
                stepMins={5}
                className="min-w-0"
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
              <AdminTimeSelect
                id="quick-end"
                value={end}
                onChange={setEnd}
                stepMins={5}
                className="min-w-0"
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
          <AdminCheckbox
            checked={unfixed}
            onChange={setUnfixed}
            label={`Couldn't fix it (${unsuccessfulShareLabel(pricing.unsuccessfulFactor)})`}
          />
          {goldCardRate != null && (
            <AdminCheckbox
              checked={goldCard}
              onChange={setGoldCard}
              label={`Gold Card (${goldCardOffText(goldCardRate)})`}
            />
          )}
          {surchargeChoice && (
            <SurchargeToggle
              option={surchargeChoice}
              on={surcharge !== null}
              fromDate={todaySurcharge !== null}
              onChange={setSurchargeOn}
            />
          )}
        </div>
      </Card>

      <StickyRail
        className={cn(
          "lg:col-start-2 lg:row-span-2 xl:row-span-1",
          events.length > 0 ? "lg:row-start-2" : "lg:row-start-1",
        )}
      >
        <QuickTotalCard
          totals={totals}
          billedMins={billedMins}
          hourlyRate={hourlyRate}
          travel={travel}
          noTravel={noTravel}
          onToggleNoTravel={() => setNoTravel((v) => !v)}
          driveMins={driveMins}
          lookingUp={lookingUp}
          surcharge={surcharge}
          promo={promo}
          bookedAt={prefill?.bookedAt ?? null}
          goldCardPercent={appliedGoldCard}
          bankAccount={bankAccount}
          clientName={prefill?.clientName ?? null}
        />
      </StickyRail>

      <Card
        className={cn(
          "text-admin-text xl:col-start-3",
          events.length > 0 ? "xl:row-start-2" : "xl:row-start-1",
        )}
      >
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
