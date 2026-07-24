"use client";
// src/app/booking/manage/ManageLookupForm.tsx
/**
 * @description Email box for the find-my-booking page. Posts to
 * /api/booking/manage-lookup, which replies identically whether or not the
 * address matched - so this form must not imply a match either way.
 */

import { Button } from "@/shared/components/Button";
import type React from "react";
import { useState } from "react";

/** What the form is currently doing. */
type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; message: string }
  | { kind: "error"; message: string };

/** Props for {@link ManageLookupForm}. */
interface ManageLookupFormProps {
  /** Display phone number, e.g. "021 297 1237". */
  phone: string;
  /** Dialable form for the tel: link. */
  phoneTel: string;
}

/**
 * Find-my-booking email form.
 * @param props - Component props.
 * @param props.phone - Display phone number.
 * @param props.phoneTel - Dialable phone number.
 * @returns The form element.
 */
export function ManageLookupForm({ phone, phoneTel }: ManageLookupFormProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  /**
   * Submits the lookup.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/booking/manage-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setState({
          kind: "error",
          message: data.error ?? "Something went wrong. Please try again.",
        });
        return;
      }
      setState({ kind: "sent", message: data.message ?? "Check your inbox." });
    } catch {
      setState({ kind: "error", message: "Couldn't reach the server. Please try again." });
    }
  }

  if (state.kind === "sent") {
    return (
      <div>
        <p className="text-base text-rich-black/80 sm:text-lg">{state.message}</p>
        {/* They're here because they couldn't find an email, so pointing them
            back at their inbox is a dead end - give them the phone number. */}
        <p className="mt-4 text-base text-rich-black/80 sm:text-lg">
          Nothing arrives, or not sure which address you used? Call or text me on{" "}
          <a
            href={`tel:${phoneTel}`}
            className="font-semibold text-russian-violet underline underline-offset-2 hover:opacity-80"
          >
            {phone}
          </a>{" "}
          and I'll sort it out.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="manage-email"
          className="mb-1 block text-base font-semibold text-russian-violet sm:text-lg"
        >
          Your email address
        </label>
        <input
          id="manage-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg border border-seasalt-200 bg-white px-4 py-3 text-base focus:border-russian-violet focus:ring-2 focus:ring-russian-violet/30 focus:outline-none sm:text-lg"
        />
        <p className="mt-1 text-sm text-rich-black/60 sm:text-base">
          Use the same address you booked with.
        </p>
      </div>

      {state.kind === "error" && (
        <p role="alert" className="text-base text-coquelicot-500">
          {state.message}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Sending..." : "Email me my booking links"}
        </Button>
      </div>
    </form>
  );
}
