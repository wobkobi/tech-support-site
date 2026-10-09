"use client";
// src/features/business/components/trips/TripsView.tsx
// Trips page body for one financial year: km claim cards, the jobs still waiting for a
// trip, and the trip log with add, edit and delete. Totals recompute from the rows on
// screen with the year's IRD tier rates, so they move as soon as a trip is saved. Only
// trips dated inside a km-rate vehicle's service period count, the same split the Tax
// page's computeTaxYear makes, so both pages show one claim.

import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatCard } from "@/features/admin/components/ui/StatCard";
import { useToast } from "@/features/admin/components/ui/Toast";
import { FiledYearWarning } from "@/features/business/components/tax/FiledYearWarning";
import { TripFormModal } from "@/features/business/components/trips/TripFormModal";
import { TripLog } from "@/features/business/components/trips/TripLog";
import { TripSuggestions } from "@/features/business/components/trips/TripSuggestions";
import { formatNZD, todayISO } from "@/features/business/lib/business-format";
import type { FiledYearRef } from "@/features/business/lib/tax/snapshot";
import type { KmVehiclePeriod } from "@/features/business/lib/tax/types";
import {
  inKmVehiclePeriod,
  KM_TIER1_LIMIT,
  kmClaim,
  splitTripKm,
} from "@/features/business/lib/tax/vehicle";
import {
  defaultTripDate,
  formatKm,
  isInWindow,
  kmDraftsFor,
  MAX_TRIP_KM,
  parseKm,
  sortTrips,
  type SuggestApiResponse,
  type TripApiResponse,
  type TripListApiResponse,
  type TripRow,
  type TripSuggestion,
} from "@/features/business/lib/trips";
import { Notice } from "@/shared/components/Notice";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import type React from "react";
import { useState } from "react";

/** What happened when one job's trip was posted. */
type AddOutcome = "added" | "linked" | "failed";

/** JSON request headers for the trips API. */
const JSON_HEADERS = { "content-type": "application/json" };

/** Props for {@link TripsView}. */
interface TripsViewProps {
  /** Selected FY key, e.g. "2026-27". */
  fyKey: string;
  /** FY display label, e.g. "FY 2026-27". */
  fyLabel: string;
  /** True when the selected FY is the one today falls in. */
  fyCurrent: boolean;
  /** FY start on the ledger scale (inclusive ISO). */
  startISO: string;
  /** FY end on the ledger scale (exclusive ISO). */
  endISO: string;
  /** Trips logged in the FY, newest first. */
  initialTrips: TripRow[];
  /** Jobs in the FY with no trip yet. */
  initialSuggestions: TripSuggestion[];
  /** The FY's IRD km rates for the configured fuel type. */
  rates: { tier1: number; tier2: number };
  /**
   * Every km the car travelled in the FY (business and private) from the Tax page, or
   * null when not entered. Over {@link KM_TIER1_LIMIT} it scales Tier 1 down to the business share.
   */
  totalVehicleKm: number | null;
  /** Service periods of every km-rate vehicle on the asset register. */
  kmPeriods: KmVehiclePeriod[];
  /** Vehicle fuel type in sentence case, e.g. "petrol hybrid". */
  fuelLabel: string;
  /** Filed years the edit forms warn about, oldest first. */
  filedYears: readonly FiledYearRef[];
  /** The km claim saved when the FY was filed, or null when it isn't filed. */
  filedClaim: number | null;
}

/**
 * Trips page body.
 * @param props - Component props.
 * @param props.fyKey - Selected FY key.
 * @param props.fyLabel - FY display label.
 * @param props.fyCurrent - Whether the selected FY is the current one.
 * @param props.startISO - FY start (inclusive ISO).
 * @param props.endISO - FY end (exclusive ISO).
 * @param props.initialTrips - Trips logged in the FY.
 * @param props.initialSuggestions - Jobs with no trip yet.
 * @param props.rates - Tier 1 and tier 2 rates per km.
 * @param props.totalVehicleKm - The car's total km for the FY, or null when not entered.
 * @param props.kmPeriods - km-rate vehicle service periods; trips outside them earn nothing.
 * @param props.fuelLabel - Vehicle fuel type for the rates note.
 * @param props.filedYears - Filed years the edit forms warn about.
 * @param props.filedClaim - Saved km claim of a filed FY, shown beside the live figures.
 * @returns The page body.
 */
export function TripsView({
  fyKey,
  fyLabel,
  fyCurrent,
  startISO,
  endISO,
  initialTrips,
  initialSuggestions,
  rates,
  totalVehicleKm,
  kmPeriods,
  fuelLabel,
  filedYears,
  filedClaim,
}: TripsViewProps): React.ReactElement {
  const { toast } = useToast();
  const [trips, setTrips] = useState<TripRow[]>(initialTrips);
  const [suggestions, setSuggestions] = useState<TripSuggestion[]>(initialSuggestions);
  const [kmDrafts, setKmDrafts] = useState<Record<string, string>>(() =>
    kmDraftsFor(initialSuggestions, {}),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TripRow | null>(null);
  const [deleting, setDeleting] = useState<TripRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addingAll, setAddingAll] = useState(false);

  // Same rule as computeTaxYear: only trips on a day a km-rate vehicle was in service count.
  const split = splitTripKm(trips, kmPeriods);
  const claim = kmClaim(split.claimableKm, rates, totalVehicleKm);
  // Without the car's total km, the first KM_TIER1_LIMIT business km stand in for Tier 1.
  const needsTotalKm = totalVehicleKm === null && claim.businessKm > 0;
  const outsideIds = new Set(
    trips.filter((t) => !inKmVehiclePeriod(t.date, kmPeriods)).map((t) => t.id),
  );
  const claimedTrips = trips.length - outsideIds.size;

  /** Opens the dialog for a new trip. */
  function openAdd(): void {
    setEditing(null);
    setFormOpen(true);
  }

  /**
   * Opens the dialog on an existing trip.
   * @param trip - Trip to edit.
   */
  function openEdit(trip: TripRow): void {
    setEditing(trip);
    setFormOpen(true);
  }

  /** Closes the dialog. */
  function closeForm(): void {
    setFormOpen(false);
    setEditing(null);
  }

  /**
   * Puts a saved trip into the log. A trip re-dated outside this FY leaves the list and
   * the toast says where it went.
   * @param saved - The stored trip.
   */
  function handleSaved(saved: TripRow): void {
    const wasEdit = editing !== null;
    closeForm();
    const inYear = isInWindow(saved.date, startISO, endISO);
    setTrips((prev) =>
      sortTrips([...prev.filter((t) => t.id !== saved.id), ...(inYear ? [saved] : [])]),
    );
    if (inYear) {
      toast(wasEdit ? "Trip updated." : "Trip logged.", { tone: "success" });
    } else {
      toast(`Saved. It's dated outside ${fyLabel}, so it's under that year's tab now.`, {
        tone: "success",
      });
    }
  }

  /**
   * Records km typed for one job.
   * @param bookingId - The job's booking id.
   * @param value - Input value as typed.
   */
  function handleDraftChange(bookingId: string, value: string): void {
    setKmDrafts((prev) => ({ ...prev, [bookingId]: value }));
  }

  /**
   * Reloads the suggestions, keeping km already typed.
   * @returns True when the list was reloaded.
   */
  async function refreshSuggestions(): Promise<boolean> {
    try {
      const res = await fetch(`/api/business/trips/suggest?fy=${encodeURIComponent(fyKey)}`);
      const d = (await res.json()) as SuggestApiResponse;
      if (!d.ok || !d.suggestions) return false;
      const fresh = d.suggestions;
      setSuggestions(fresh);
      setKmDrafts((prev) => kmDraftsFor(fresh, prev));
      return true;
    } catch {
      // The list stays as it was; a page reload brings the job back.
      return false;
    }
  }

  /**
   * Reloads the trip log and the jobs list after a 409: the job's trip was logged
   * somewhere else (another tab), so this page is missing it. Km already typed for
   * other jobs is kept.
   * @returns True when both lists were reloaded.
   */
  async function refreshAfterConflict(): Promise<boolean> {
    let tripsOk = false;
    try {
      const res = await fetch(`/api/business/trips?fy=${encodeURIComponent(fyKey)}`);
      const d = (await res.json()) as TripListApiResponse;
      if (d.ok && d.trips) {
        setTrips(sortTrips(d.trips));
        tripsOk = true;
      }
    } catch {
      // The log stays as it was; a page reload shows the other tab's trip.
    }
    const suggestionsOk = await refreshSuggestions();
    return tripsOk && suggestionsOk;
  }

  /**
   * Toast text for a km input that didn't parse: blank asks for the km, anything else
   * states the allowed range.
   * @param s - The job.
   * @returns The warning text.
   */
  function kmProblem(s: TripSuggestion): string {
    const draft = (kmDrafts[s.bookingId] ?? "").trim();
    return draft === ""
      ? `Enter the round-trip km for ${s.name} first.`
      : `Enter the round-trip km for ${s.name} between 0.1 and ${MAX_TRIP_KM.toLocaleString("en-NZ")}.`;
  }

  /**
   * Posts one job's trip and updates both lists. A 409 means the job already has a
   * trip (logged in another tab), so the job leaves the list here and the caller
   * refreshes both lists rather than erroring.
   * @param s - The job.
   * @param km - Validated round-trip km.
   * @returns What happened.
   */
  async function postSuggestion(s: TripSuggestion, km: number): Promise<AddOutcome> {
    try {
      const res = await fetch("/api/business/trips", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ date: s.date, km, purpose: s.purpose, bookingId: s.bookingId }),
      });
      if (res.status === 409) {
        setSuggestions((prev) => prev.filter((x) => x.bookingId !== s.bookingId));
        return "linked";
      }
      const d = (await res.json()) as TripApiResponse;
      if (d.ok && d.trip) {
        const saved = d.trip;
        setTrips((prev) => sortTrips([...prev, saved]));
        setSuggestions((prev) => prev.filter((x) => x.bookingId !== s.bookingId));
        return "added";
      }
      return "failed";
    } catch {
      return "failed";
    }
  }

  /**
   * Adds one job's trip from its km input. Its Add button stays disabled until the
   * request, and any refresh after a 409, has finished.
   * @param s - The job.
   */
  async function handleAdd(s: TripSuggestion): Promise<void> {
    const km = parseKm(kmDrafts[s.bookingId] ?? "");
    if (km === null) {
      toast(kmProblem(s), { tone: "warning" });
      return;
    }
    setAddingId(s.bookingId);
    const outcome = await postSuggestion(s, km);
    const refreshed = outcome === "linked" ? await refreshAfterConflict() : false;
    setAddingId(null);
    if (outcome === "added") toast(`Trip logged for ${s.name}.`, { tone: "success" });
    else if (outcome === "linked") {
      toast(
        refreshed
          ? `${s.name} already had a trip logged, so the lists have been refreshed.`
          : `${s.name} already had a trip logged. Reload the page to see it.`,
        { tone: "info" },
      );
    } else toast(`Couldn't add the trip for ${s.name}. Try again.`, { tone: "error" });
  }

  /**
   * Adds a trip for every job with km filled in, one request at a time so each
   * success leaves the list as it lands. Jobs without km stay for later. Every Add
   * stays disabled until the run, and one refresh if any job hit a 409, has finished.
   */
  async function handleAddAll(): Promise<void> {
    const ready = suggestions.flatMap((s) => {
      const km = parseKm(kmDrafts[s.bookingId] ?? "");
      return km === null ? [] : [{ s, km }];
    });
    // Typed but unusable km (0, or over the cap) is reported apart from blank rows.
    const outOfRange = suggestions.filter(
      (s) => (kmDrafts[s.bookingId] ?? "").trim() !== "" && parseKm(kmDrafts[s.bookingId]) === null,
    ).length;
    const rangeNote = `${outOfRange} ${outOfRange === 1 ? "job needs" : "jobs need"} km between 0.1 and ${MAX_TRIP_KM.toLocaleString("en-NZ")}.`;
    if (ready.length === 0) {
      toast(outOfRange > 0 ? rangeNote : "Enter the round-trip km for at least one job first.", {
        tone: "warning",
      });
      return;
    }
    setAddingAll(true);
    let added = 0;
    let linked = 0;
    let failed = 0;
    for (const { s, km } of ready) {
      const outcome = await postSuggestion(s, km);
      if (outcome === "added") added++;
      else if (outcome === "linked") linked++;
      else failed++;
    }
    const refreshed = linked > 0 ? await refreshAfterConflict() : false;
    setAddingAll(false);
    const waiting = suggestions.length - ready.length - outOfRange;
    const parts = [`Added ${added} ${added === 1 ? "trip" : "trips"}.`];
    if (linked > 0) {
      const had = `${linked} already had ${linked === 1 ? "a trip" : "trips"}`;
      parts.push(
        refreshed
          ? `${had}, so the lists have been refreshed.`
          : `${had}. Reload the page to see them.`,
      );
    }
    if (failed > 0) parts.push(`${failed} didn't save. Try those again.`);
    if (outOfRange > 0) parts.push(rangeNote);
    if (waiting > 0) {
      parts.push(`${waiting} ${waiting === 1 ? "job still needs" : "jobs still need"} km.`);
    }
    toast(parts.join(" "), { tone: failed > 0 || outOfRange > 0 ? "warning" : "success" });
  }

  /** Deletes the trip the confirm dialog is asking about. */
  async function handleDelete(): Promise<void> {
    if (!deleting) return;
    const target = deleting;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/business/trips/${target.id}`, { method: "DELETE" });
      const d = (await res.json()) as TripApiResponse;
      if (d.ok) {
        setTrips((prev) => prev.filter((t) => t.id !== target.id));
        toast("Trip deleted.", { tone: "success" });
        // The job is free again, so it rejoins the suggestions.
        if (target.bookingId) await refreshSuggestions();
      } else {
        toast(d.error ?? "Couldn't delete the trip.", { tone: "error" });
      }
    } catch {
      toast("Couldn't delete the trip. Check your connection.", { tone: "error" });
    } finally {
      setDeleteBusy(false);
      setDeleting(null);
    }
  }

  return (
    <>
      <div className="mb-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Business km"
            value={formatKm(claim.businessKm)}
            sub={
              split.outsideKm > 0
                ? `${formatKm(split.outsideKm)} not claimed`
                : `${claimedTrips} ${claimedTrips === 1 ? "trip" : "trips"}`
            }
          />
          <StatCard
            label="Tier 1 km"
            value={formatKm(claim.tier1Km)}
            sub={`At ${formatNZD(rates.tier1)}/km`}
          />
          <StatCard
            label="Tier 2 km"
            value={formatKm(claim.tier2Km)}
            sub={`At ${formatNZD(rates.tier2)}/km`}
          />
          <StatCard label="Km claim" value={formatNZD(claim.amount)} tone="success" sub={fyLabel} />
        </div>
        {needsTotalKm && (
          <p className="mt-2 text-sm text-admin-text-secondary">
            Enter the car&apos;s total km for the year on the Tax page so the Tier 1 split is right.
          </p>
        )}
      </div>

      {split.outsideKm > 0 && (
        <Notice tone="warn" onGrey className="mb-6">
          {formatKm(split.outsideKm)} logged on days with no kilometre-rate vehicle on the asset
          register. Add the vehicle on the{" "}
          <Link
            href="/admin/business/assets"
            className="font-bold text-russian-violet underline underline-offset-2"
          >
            Assets page
          </Link>{" "}
          to claim them.
        </Notice>
      )}

      <Notice onGrey className="mb-6">
        IRD {fuelLabel} rates for {fyLabel}: {formatNZD(rates.tier1)}/km for the business share of
        the car&apos;s first {KM_TIER1_LIMIT.toLocaleString("en-NZ")} km in the year, then{" "}
        {formatNZD(rates.tier2)}
        /km. The rate covers fuel, wear and depreciation, so Fuel expenses come out of the tax
        figures for the days the car is on km rates, and only trips on those days earn the rate.
      </Notice>

      {/* Adding from the jobs list has no dialog, so warn here when this FY is filed. A
          one-day span on the FY's first day keys it to this year alone, so it shows even
          when the jobs list is empty. */}
      <FiledYearWarning
        filedYears={filedYears}
        spans={[{ from: startISO, to: startISO }]}
        variant="page"
        className={filedClaim === null ? "mb-6" : "mb-2"}
      />
      {/* The figures above stay live so late edits show; the filed claim is what the Tax
          page and the CSV carry. */}
      {filedClaim !== null && (
        <p className="mb-6 text-sm text-admin-text-secondary">
          Filed: the Tax page shows the saved claim of {formatNZD(filedClaim)}.
        </p>
      )}
      <TripSuggestions
        suggestions={suggestions}
        kmDrafts={kmDrafts}
        addingId={addingId}
        addingAll={addingAll}
        onDraftChange={handleDraftChange}
        onAdd={(s) => void handleAdd(s)}
        onAddAll={() => void handleAddAll()}
        // The key, not the label: the first year's label carries "(partial)".
        yearPhrase={fyCurrent ? "this year" : `in FY ${fyKey}`}
        className="mb-6"
      />

      <TripLog
        trips={trips}
        outsideIds={outsideIds}
        fyLabel={fyLabel}
        onAdd={openAdd}
        onEdit={openEdit}
        onDelete={setDeleting}
      />

      {formOpen && (
        <TripFormModal
          key={editing?.id ?? "new"}
          trip={editing}
          defaultDate={defaultTripDate(startISO, endISO, todayISO())}
          onSaved={handleSaved}
          onClose={closeForm}
          filedYears={filedYears}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this trip?"
        body={
          deleting ? (
            <>
              {`${formatDateShort(deleting.date)}, ${formatKm(deleting.km)}: ${deleting.purpose}.${
                deleting.bookingId ? " The job goes back on the jobs without a trip list." : ""
              }`}
              <FiledYearWarning
                filedYears={filedYears}
                spans={[{ from: deleting.date, to: deleting.date }]}
                className="mt-3"
              />
            </>
          ) : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        busy={deleteBusy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
