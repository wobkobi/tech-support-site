"use client";
// src/features/business/components/PromoCodeField.tsx
// Promo code entry shared by every surface, so they agree on "applied" and rejection wording.

import { FIELD_INPUT, FIELD_LABEL } from "@/features/booking/lib/form-styles";
import type { ActivePromo } from "@/features/business/lib/promos";
import { normalisePromoCode } from "@/features/business/lib/promos";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";

/** What the field is currently telling the customer. */
type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "valid"; description: string }
  | { kind: "invalid" }
  | { kind: "error" };

/** Props for {@link PromoCodeField}. */
interface PromoCodeFieldProps {
  /** The code as typed, owned by the parent so it can be submitted with the job. */
  value: string;
  /** Called on every keystroke with the uppercased code. */
  onChange: (code: string) => void;
  /** Called with the promo an accepted code unlocked, or null when cleared or rejected. */
  onApplied: (promo: ActivePromo | null) => void;
  /** Field label. Defaults to the customer-facing wording. */
  label?: string;
  /** Check a prefilled code on mount without a second Apply. */
  applyOnMount?: boolean;
  /** The chosen appointment start, for day- or hour-restricted codes. */
  startAt?: Date | null;
  /** The booking email, for new-customer or once-per-customer codes. */
  email?: string | null;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Lets someone enter a promo code and see whether it is accepted. Checked on Apply, not
 * blur, so tabbing through doesn't spend the rate limit.
 * @param props - Component props.
 * @param props.value - The code as typed.
 * @param props.onChange - Called on every keystroke with the uppercased code.
 * @param props.onApplied - Called with the unlocked promo, or null.
 * @param props.label - Field label; defaults to the customer-facing wording.
 * @param props.applyOnMount - Check a pre-filled code once on mount.
 * @param props.startAt - The chosen appointment start, when there is one.
 * @param props.email - The email being booked with, when entered.
 * @param props.className - Extra classes for the wrapper.
 * @returns The rendered field.
 */
export function PromoCodeField({
  value,
  onChange,
  onApplied,
  label = "Have a promo code?",
  applyOnMount = false,
  startAt = null,
  email = null,
  className,
}: PromoCodeFieldProps): React.ReactElement {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Unique per instance, as several can be mounted at once.
  const fieldId = useId();
  const statusId = `${fieldId}-status`;

  /** Checks the entered code and reports the promo it unlocked to the parent. */
  async function apply(): Promise<void> {
    const code = normalisePromoCode(value);
    if (!code) {
      setStatus({ kind: "idle" });
      onApplied(null);
      return;
    }
    setStatus({ kind: "checking" });
    try {
      const res = await fetch("/api/promos/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          startAt: startAt?.toISOString() ?? null,
          email: email?.trim() || null,
        }),
      });
      // A 429 lands here too, reading as a failed check rather than a rejected code.
      const data = (await res.json()) as {
        ok?: boolean;
        valid?: boolean;
        description?: string | null;
        promo?: ActivePromo | null;
      };
      if (!res.ok || !data.ok) {
        setStatus({ kind: "error" });
        onApplied(null);
        return;
      }
      if (data.valid && data.promo) {
        setStatus({ kind: "valid", description: data.description ?? "" });
        onApplied(data.promo);
        return;
      }
      setStatus({ kind: "invalid" });
      onApplied(null);
    } catch {
      setStatus({ kind: "error" });
      onApplied(null);
    }
  }

  // Ref, since apply() is redefined every render.
  const applied = useRef(false);
  useEffect(() => {
    if (!applyOnMount || applied.current || !value.trim()) return;
    applied.current = true;
    void apply();
    // Mount-only by design; a later edit goes through the Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyOnMount]);

  /**
   * Records a keystroke (uppercased) and drops the previous verdict.
   * @param next - The raw input value.
   */
  function handleChange(next: string): void {
    onChange(next.toUpperCase());
    if (status.kind !== "idle") {
      setStatus({ kind: "idle" });
      onApplied(null);
    }
  }

  const isValid = status.kind === "valid";

  return (
    <div className={cn("text-base", className)}>
      <label htmlFor={fieldId} className={cn("block", FIELD_LABEL)}>
        {label}
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id={fieldId}
          name="promo-code"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter inside a booking form would submit the whole booking.
            if (e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
          autoComplete="off"
          autoCapitalize="characters"
          // Enter applies the code, so label the phone keyboard's action key to match.
          enterKeyHint="done"
          spellCheck={false}
          maxLength={32}
          placeholder="Enter code"
          aria-describedby={statusId}
          className={cn(
            FIELD_INPUT,
            "min-h-11 min-w-0 flex-1 py-2 tracking-wider uppercase",
            isValid && "border-2 border-green-700",
          )}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void apply()}
          disabled={status.kind === "checking" || !value.trim()}
          className="h-auto min-h-11"
        >
          {status.kind === "checking" ? "Checking..." : "Apply"}
        </Button>
      </div>
      {/* Always rendered so a verdict is announced rather than appearing as a
          new region a screen reader never visits. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={cn(
          "mt-1.5 min-h-6 font-medium",
          status.kind === "valid" ? "text-green-700" : "text-error",
        )}
      >
        {status.kind === "valid" &&
          (status.description ? `Code applied - ${status.description}.` : "Code applied.")}
        {status.kind === "invalid" && "That code isn't valid right now."}
        {status.kind === "error" && "Couldn't check that code just now - try again shortly."}
      </p>
    </div>
  );
}
