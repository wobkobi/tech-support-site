"use client";
// src/features/areas/components/TravelCheck.tsx
// "What travel costs to you": a suburb or address goes to the public travel-time endpoint,
// and the answer is priced with the same maths as invoices and the /pricing estimator.

import { travelFigure, type TravelFigure } from "@/features/areas/lib/areas";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { FIELD_INPUT, FIELD_LABEL } from "@/features/booking/lib/form-styles";
import { formatMoneyCompact } from "@/features/business/lib/business-format";
import { Button } from "@/shared/components/Button";
import { PromoPrice } from "@/shared/components/PromoPrice";
import { TEXT_LINK } from "@/shared/components/Section";
import type React from "react";
import { useState } from "react";

/** Props for {@link TravelCheck}. */
interface TravelCheckProps {
  /** Live travel rate per hour. */
  travelRatePerHour: number;
  /** Live travel minimum. */
  minTravelCharge: number;
  /** Gated promo travel factor (1 = no promo). */
  travelFactor: number;
  /** Display phone number, for the fallback messages. */
  phone: string;
  /** tel: link for the phone number. */
  phoneTel: string;
}

/** Where the check is up to. */
type CheckState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; place: string; figure: TravelFigure }
  | { kind: "not_found" }
  | { kind: "busy" }
  | { kind: "error" };

/**
 * Suburb travel check: type a suburb or address, get the drive time and round-trip charge.
 * @param props - Component props.
 * @param props.travelRatePerHour - Live travel rate per hour.
 * @param props.minTravelCharge - Live travel minimum.
 * @param props.travelFactor - Gated promo travel factor.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - tel: link for the phone number.
 * @returns The check form and its result.
 */
export function TravelCheck({
  travelRatePerHour,
  minTravelCharge,
  travelFactor,
  phone,
  phoneTel,
}: TravelCheckProps): React.ReactElement {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  /**
   * Looks up both drive legs and prices them.
   * @param e - Form submit event.
   */
  async function check(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    // The endpoint appends ", New Zealand" itself, so strip a copy from a picked suggestion.
    const destination = address
      .trim()
      .replace(/,?\s*New Zealand$/i, "")
      .trim();
    if (!destination) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/pricing/travel-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      });
      if (res.status === 429) {
        setState({ kind: "busy" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = (await res.json()) as { durationMinsThere?: number; durationMinsBack?: number };
      const there = data.durationMinsThere ?? 0;
      const back = data.durationMinsBack ?? there;
      const figure = travelFigure(there, back, travelRatePerHour, minTravelCharge, travelFactor);
      // Zero minutes means Google couldn't place it, not that travel is free.
      setState(figure ? { kind: "found", place: destination, figure } : { kind: "not_found" });
    } catch {
      setState({ kind: "error" });
    }
  }

  const callLink = (
    <a href={phoneTel} className={TEXT_LINK}>
      {phone}
    </a>
  );

  return (
    <div className="max-w-180">
      <form onSubmit={check} className="grid gap-2">
        <label htmlFor="travel-check-address" className={FIELD_LABEL}>
          Your suburb or address
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <AddressAutocomplete
              id="travel-check-address"
              value={address}
              onChange={setAddress}
              placeholder="e.g. Howick"
              maxLength={100}
              inputClassName={FIELD_INPUT}
            />
          </div>
          <Button type="submit" disabled={state.kind === "loading" || !address.trim()}>
            {state.kind === "loading" ? "Checking..." : "Check travel"}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="mt-4 text-lg">
        {state.kind === "found" && (
          <p className="rounded-md border-l-4 border-moonstone-500 bg-white p-4">
            {state.place} is about <strong>{state.figure.eachWayMins} minutes</strong> each way from
            me, so travel is about{" "}
            <PromoPrice discounted={state.figure.charged < state.figure.full}>
              <strong>{formatMoneyCompact(state.figure.charged)}</strong>
            </PromoPrice>{" "}
            for the round trip
            {state.figure.charged < state.figure.full &&
              ` (normally ${formatMoneyCompact(state.figure.full)})`}
            .
          </p>
        )}
        {state.kind === "not_found" && (
          <p>I couldn&apos;t find that one. Try just your suburb name, or call me on {callLink}.</p>
        )}
        {state.kind === "busy" && (
          <p>That&apos;s a lot of checks at once. Give it a minute and try again.</p>
        )}
        {state.kind === "error" && (
          <p>
            The travel check isn&apos;t working right now. Call me on {callLink} and I&apos;ll tell
            you.
          </p>
        )}
      </div>
    </div>
  );
}
