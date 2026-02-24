"use client";
// src/components/admin/SendReviewLinkForm.tsx
/**
 * @file SendReviewLinkForm.tsx
 * @description Form for sending a review link to a past client via email or SMS.
 */

import { useState } from "react";
import { SOFT_CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import type React from "react";

/**
 * Props for SendReviewLinkForm component.
 */
interface SendReviewLinkFormProps {
  /** Admin token for API calls */
  token: string;
}

/**
 * Form for sending a review link to a past client via email or generating SMS text.
 * @param props - Component props.
 * @param props.token - Admin token for API calls.
 * @returns Send review link form element.
 */
export function SendReviewLinkForm({ token }: SendReviewLinkFormProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"email" | "sms">("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [smsText, setSmsText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Handles form submission to send a review link or generate an SMS message.
   * @param e - Form submit event.
   * @returns Promise resolving when the submit completes.
   */
  async function handleSubmit(e: React.SubmitEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    setSmsText(null);
    try {
      const res = await fetch("/api/admin/send-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email, mode }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; reviewUrl?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");

      if (mode === "sms" && data.reviewUrl) {
        const firstName = name.trim().split(" ")[0];
        setSmsText(
          `Hi ${firstName}, it's Harrison from To The Point Tech. Hope everything is still working well! If you have a spare moment, I'd really appreciate a quick review - it makes a big difference for a small local business: ${data.reviewUrl}`,
        );
        setName("");
      } else {
        setSuccess(true);
        setName("");
        setEmail("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Copies the SMS text to the clipboard.
   * @returns Promise resolving when the copy completes.
   */
  async function handleCopy(): Promise<void> {
    if (!smsText) return;
    await navigator.clipboard.writeText(smsText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn(SOFT_CARD)}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          setSuccess(false);
          setError(null);
          setSmsText(null);
        }}
        className={cn("text-russian-violet w-full text-left text-sm font-semibold hover:underline")}
      >
        {open ? "▲ Cancel" : "+ Send review link to past client"}
      </button>

      {open && (
        <div className={cn("mt-4 flex flex-col gap-3")}>
          {/* Mode toggle */}
          <div className={cn("flex gap-2")}>
            {(["email", "sms"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setSuccess(false);
                  setSmsText(null);
                  setError(null);
                }}
                className={cn(
                  "rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors",
                  mode === m
                    ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                    : "border-seasalt-400/60 bg-seasalt text-rich-black/60 hover:border-russian-violet/40",
                )}
              >
                {m === "email" ? "📧 Email" : "💬 SMS"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className={cn("flex flex-col gap-3")}>
            <div className={cn("flex gap-3")}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 text-rich-black flex-1 rounded-lg border p-3 text-sm focus:outline-none",
                )}
              />
              {mode === "email" && (
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 text-rich-black flex-1 rounded-lg border p-3 text-sm focus:outline-none",
                  )}
                />
              )}
            </div>

            {error && <p className={cn("text-coquelicot-400 text-xs")}>{error}</p>}
            {success && (
              <p className={cn("text-moonstone-600 text-xs")}>Review link sent successfully.</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "bg-moonstone-600 hover:bg-moonstone-700 self-start rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {loading ? "Generating…" : mode === "sms" ? "Generate text" : "Send link"}
            </button>
          </form>

          {/* SMS copy box */}
          {smsText && (
            <div className={cn("border-seasalt-400/60 bg-seasalt rounded-lg border p-3")}>
              <p
                className={cn(
                  "text-rich-black/60 mb-2 text-xs font-semibold uppercase tracking-wide",
                )}
              >
                Copy and send from your phone
              </p>
              <p className={cn("text-rich-black mb-3 text-sm leading-relaxed")}>{smsText}</p>
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "bg-moonstone-600 hover:bg-moonstone-700 rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-colors",
                )}
              >
                {copied ? "Copied!" : "Copy message"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
