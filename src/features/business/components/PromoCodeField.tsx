"use client";
// src/features/business/components/PromoCodeField.tsx
/**
 * @description Promo code entry, shared by the pricing wizard, the booking form
 * and the calculator. One control rather than three, because the surfaces have
 * to agree on what "applied" means and on the wording of a rejection.
 */

import type { ActivePromo } from "@/features/business/lib/promos";
import { normalisePromoCode } from "@/features/business/lib/promos";
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
  /**
   * Called with the promo an accepted code unlocked, or null when the code was
   * cleared or rejected. The parent reprices from this.
   */
  onApplied: (promo: ActivePromo | null) => void;
  /** Field label. Defaults to the customer-facing wording. */
  label?: string;
  /**
   * Check a code that arrived already filled in (from the pricing wizard's
   * link) without making the customer press Apply a second time.
   */
  applyOnMount?: boolean;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Lets someone enter a promo code and see straight away whether it is accepted.
 *
 * Checked on an explicit Apply rather than on blur: the endpoint is public and
 * rate limited, and a blur handler fires every time the field is tabbed
 * through, which would spend the customer's allowance on nothing.
 * @param props - Component props.
 * @param props.value - The code as typed.
 * @param props.onChange - Called on every keystroke with the uppercased code.
 * @param props.onApplied - Called with the unlocked promo, or null.
 * @param props.label - Field label; defaults to the customer-facing wording.
 * @param props.applyOnMount - Check a pre-filled code once on mount.
 * @param props.className - Extra classes for the wrapper.
 * @returns The rendered field.
 */
export function PromoCodeField({
  value,
  onChange,
  onApplied,
  label = "Have a promo code?",
  applyOnMount = false,
  className,
}: PromoCodeFieldProps): React.ReactElement {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Unique per instance: the booking form and the wizard can both be mounted
  // during a session, and a duplicated id breaks the label association.
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
        body: JSON.stringify({ code }),
      });
      // A 429 lands here too: the body is not the success shape, so it reads as
      // a failure to check rather than as a rejected code. Saying "not valid"
      // for a code that was never checked is the worse of the two errors.
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

  // Ref rather than state: apply() is redefined every render, so depending on
  // it would re-run this on every keystroke.
  const applied = useRef(false);
  useEffect(() => {
    if (!applyOnMount || applied.current || !value.trim()) return;
    applied.current = true;
    void apply();
    // Mount-only by design; a later edit goes through the Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyOnMount]);

  /**
   * Records a keystroke, uppercasing so what is shown is what gets stored, and
   * drops any previous verdict since it no longer describes what is in the box.
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
      <label htmlFor={fieldId} className="block font-medium text-slate-700">
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
          spellCheck={false}
          maxLength={32}
          placeholder="Enter code"
          aria-describedby={statusId}
          className={cn(
            "min-w-0 flex-1 rounded-xl border px-3 py-2 tracking-wider uppercase",
            isValid ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white",
          )}
        />
        <button
          type="button"
          onClick={() => void apply()}
          disabled={status.kind === "checking" || !value.trim()}
          className={cn(
            "rounded-xl px-4 py-2 font-semibold text-white",
            status.kind === "checking" || !value.trim()
              ? "cursor-not-allowed bg-slate-300"
              : "bg-russian-violet hover:bg-russian-violet/90",
          )}
        >
          {status.kind === "checking" ? "Checking..." : "Apply"}
        </button>
      </div>
      {/* Always rendered so a verdict is announced rather than appearing as a
          new region a screen reader never visits. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={cn(
          "mt-1.5 min-h-6 font-medium",
          status.kind === "valid" ? "text-emerald-700" : "text-coquelicot-500",
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
