// src/features/business/components/BusinessEnquiryForm.tsx
/**
 * @description Public business enquiry form for the /business page. Posts to
 * /api/enquiry/business; on success the form swaps for a confirmation card.
 * Follows the public BookingForm field conventions (text-base sizing, shared
 * EmailInput/PhoneInput, hidden honeypot).
 */

"use client";

import { validateEmail } from "@/features/booking/lib/booking";
import { Button } from "@/shared/components/Button";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";
import { FaCircleCheck } from "react-icons/fa6";

const INTEREST_OPTIONS = ["One-off job", "Monthly retainer", "Not sure yet"] as const;
const URGENCY_OPTIONS = ["This week", "This month", "Just exploring"] as const;

const INPUT_CLASS = cn(
  "rounded-md border border-seasalt-400/80 bg-seasalt px-4 py-3 text-base text-rich-black",
  "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30 focus:outline-none",
);

/**
 * Business enquiry form: company + contact details, what they need, and two
 * optional selects. Success replaces the form with a confirmation card.
 * @returns Enquiry form element.
 */
export function BusinessEnquiryForm(): React.ReactElement {
  // Who the help is for: a business (company required) or the person
  // themselves (company hidden - sole traders and personal jobs both fit).
  const [enquiryFor, setEnquiryFor] = useState<"business" | "personal">("business");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [needs, setNeeds] = useState("");
  const [interest, setInterest] = useState("");
  const [urgency, setUrgency] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Validates the required fields and posts the enquiry.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;

    const isBusiness = enquiryFor === "business";
    if ((isBusiness && !company.trim()) || !name.trim() || !needs.trim()) {
      setError(
        isBusiness
          ? "Please fill in your company, your name, and what you need help with."
          : "Please fill in your name and what you need help with.",
      );
      return;
    }
    if (validateEmail(email) !== "ok") {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/enquiry/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: enquiryFor,
          company: isBusiness ? company.trim() : undefined,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          needs: needs.trim(),
          interest: interest || undefined,
          urgency: urgency || undefined,
          website,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not send your enquiry. Please try again.");
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-3 rounded-lg border border-moonstone-500/40 bg-moonstone-600/10 p-6 text-center"
      >
        <FaCircleCheck className="h-10 w-10 text-moonstone-600" aria-hidden />
        <p className="text-lg font-semibold text-rich-black sm:text-xl">Enquiry sent - thanks!</p>
        <p className="max-w-xl text-base text-rich-black/80 sm:text-lg">
          I'll come back to you within one business day, usually sooner. A confirmation is on its
          way to your inbox.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5" autoComplete="off">
      {/* Honeypot: visually hidden + off-screen + tab-skipped + aria-hidden.
          Real users never see or focus this; the server fakes success when a
          bot fills it. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}
      >
        <label htmlFor="enquiry-website">Website (leave blank)</label>
        <input
          id="enquiry-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {/* Business vs personal: gates whether the company field shows. */}
      <div className="flex flex-col gap-2">
        <span className="text-base font-semibold text-rich-black">
          Who's this for? <span className="text-coquelicot-500">*</span>
        </span>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
          <button
            type="button"
            aria-pressed={enquiryFor === "business"}
            onClick={() => setEnquiryFor("business")}
            className={cn(
              "rounded-lg border px-5 py-2.5 text-base font-medium whitespace-nowrap transition-colors",
              enquiryFor === "business"
                ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
            )}
          >
            A business
          </button>
          <button
            type="button"
            aria-pressed={enquiryFor === "personal"}
            onClick={() => setEnquiryFor("personal")}
            className={cn(
              "rounded-lg border px-5 py-2.5 text-base font-medium whitespace-nowrap transition-colors",
              enquiryFor === "personal"
                ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                : "border-seasalt-400/60 bg-seasalt text-rich-black hover:border-russian-violet/40",
            )}
          >
            Me personally
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {enquiryFor === "business" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="enquiry-company" className="text-base font-semibold text-rich-black">
              Company <span className="text-coquelicot-500">*</span>
            </label>
            <input
              id="enquiry-company"
              type="text"
              autoComplete="organization"
              required
              aria-required
              maxLength={200}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="enquiry-name" className="text-base font-semibold text-rich-black">
            Your name <span className="text-coquelicot-500">*</span>
          </label>
          <input
            id="enquiry-name"
            type="text"
            autoComplete="name"
            required
            aria-required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="enquiry-email" className="text-base font-semibold text-rich-black">
            Email <span className="text-coquelicot-500">*</span>
          </label>
          <EmailInput
            id="enquiry-email"
            value={email}
            onChange={setEmail}
            required
            errorMessages={{ invalid: "Please enter a valid email address." }}
            className={cn(
              "border border-seasalt-400/80 bg-seasalt px-4 py-3 text-base text-rich-black",
              "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30",
            )}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="enquiry-phone" className="text-base font-semibold text-rich-black">
            Phone <span className="text-base text-rich-black/70">(optional)</span>
          </label>
          <PhoneInput
            id="enquiry-phone"
            value={phone}
            onChange={setPhone}
            errorMessages={{ invalid: "Please enter a valid phone number." }}
            className={cn(
              "border border-seasalt-400/80 bg-seasalt px-4 py-3 text-base text-rich-black",
              "focus:border-russian-violet focus:ring-1 focus:ring-russian-violet/30",
            )}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="enquiry-needs" className="text-base font-semibold text-rich-black">
          What do you need help with? <span className="text-coquelicot-500">*</span>
        </label>
        <textarea
          id="enquiry-needs"
          required
          aria-required
          rows={4}
          maxLength={4000}
          value={needs}
          onChange={(e) => setNeeds(e.target.value)}
          placeholder="e.g. Two new staff laptops to set up, and our Wi-Fi drops out in the back office."
          className={cn(INPUT_CLASS, "resize-y")}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="enquiry-interest" className="text-base font-semibold text-rich-black">
            What are you after? <span className="text-base text-rich-black/70">(optional)</span>
          </label>
          <select
            id="enquiry-interest"
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Choose one...</option>
            {INTEREST_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="enquiry-urgency" className="text-base font-semibold text-rich-black">
            How urgent? <span className="text-base text-rich-black/70">(optional)</span>
          </label>
          <select
            id="enquiry-urgency"
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Choose one...</option>
            {URGENCY_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-base font-medium text-coquelicot-600">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" size="lg" disabled={submitting}>
          {submitting ? "Sending..." : "Send enquiry"}
        </Button>
      </div>
    </form>
  );
}
