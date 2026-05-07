"use client";
// src/features/reviews/components/admin/SendReviewLinkForm.tsx
/**
 * @file SendReviewLinkForm.tsx
 * @description Form for sending a review link to a past client via email or SMS.
 */

import { useState, useRef } from "react";
import { cn } from "@/shared/lib/cn";
import { CopyLinkButton } from "./CopyLinkButton";
import { toE164NZ, formatNZPhone, isValidPhone } from "@/shared/lib/normalize-phone";
import type React from "react";

/**
 * A contact entry used to pre-fill the review link form.
 */
export interface ContactSuggestion {
  /** Contact database ID */
  id: string;
  /** Display name */
  name: string;
  /** Email address, or null */
  email: string | null;
  /** Phone number, or null */
  phone: string | null;
  /** Street address, or null */
  address: string | null;
}

/**
 * Props for SendReviewLinkForm component.
 */
interface SendReviewLinkFormProps {
  /** Admin token for API calls */
  token: string;
  /** Contacts that have never received a review link, shown in a pre-fill dropdown */
  contactSuggestions?: ContactSuggestion[];
  /** Start the form expanded without needing to click the toggle */
  defaultOpen?: boolean;
}

/**
 * Form for sending a review link to a past client via email or generating SMS text.
 * Email mode shows a rendered preview before sending.
 * @param props - Component props.
 * @param props.token - Admin token for API calls.
 * @param props.contactSuggestions - Contacts that have never received a review link, shown in a pre-fill dropdown.
 * @param props.defaultOpen - Start the form expanded. Defaults to false.
 * @returns Send review link form element.
 */
export function SendReviewLinkForm({
  token,
  contactSuggestions = [],
  defaultOpen = false,
}: SendReviewLinkFormProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<"email" | "sms">("email");
  const [contactSearch, setContactSearch] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [smsText, setSmsText] = useState<string | null>(null);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Rendered HTML preview returned from the preview API (email mode only). */
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  /** Resets transient result state (errors, previews, success banners). Does NOT clear form fields. */
  function resetState(): void {
    setSuccess(false);
    setError(null);
    setSmsText(null);
    setExistingUrl(null);
    setPreviewHtml(null);
  }

  /** Clears all form fields after a successful send. */
  function clearFields(): void {
    setName("");
    setEmail("");
    setPhoneInput("");
  }

  /**
   * Fetches the email preview HTML from the server and stores it in state.
   * @param e - Form submit event.
   * @returns Promise resolving when the preview is loaded.
   */
  async function handlePreview(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/preview-review-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name }),
      });
      const data = (await res.json()) as { ok?: boolean; html?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setPreviewHtml(data.html ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sends the review link email (called after the admin confirms the preview).
   * @returns Promise resolving when the send completes.
   */
  async function handleSend(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/send-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, email, mode: "email" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reviewUrl?: string;
        existing?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Request failed");

      setPreviewHtml(null);
      if (data.existing && data.reviewUrl) {
        setExistingUrl(data.reviewUrl);
      } else {
        setSuccess(true);
        clearFields();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Handles SMS form submission to generate the SMS copy text.
   * @param e - Form submit event.
   * @returns Promise resolving when the submit completes.
   */
  async function handleSmsSubmit(e: React.SyntheticEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSmsText(null);
    setExistingUrl(null);
    try {
      const res = await fetch("/api/admin/send-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, phone: phoneInput, mode: "sms" }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        reviewUrl?: string;
        existing?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? "Request failed");

      if (data.existing && data.reviewUrl) {
        setExistingUrl(data.reviewUrl);
      } else if (data.reviewUrl) {
        const firstName = name.trim().split(" ")[0];
        setSmsText(
          `Hi ${firstName}, it's Harrison from To The Point Tech. Thanks for letting me help you out! I'm updating my website and a quick review would be greatly appreciated - it really helps: ${data.reviewUrl}`,
        );
        clearFields();
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

  const phoneE164 = toE164NZ(phoneInput);
  const phoneValid = isValidPhone(phoneE164);

  /**
   * Pre-fills the form fields from a selected contact suggestion.
   * @param id - The contact id to look up, or empty string to clear.
   */
  function applyContact(id: string): void {
    const c = contactSuggestions.find((s) => s.id === id);
    if (!c) return;
    resetState();
    setName(c.name);
    setEmail(c.email ?? "");
    setPhoneInput(c.phone ? formatNZPhone(c.phone) : "");
  }

  return (
    <div>
      {!defaultOpen && (
        <button
          onClick={() => {
            setOpen((v) => !v);
            resetState();
            clearFields();
          }}
          className={cn(
            "text-russian-violet w-full text-left text-sm font-semibold hover:underline",
          )}
        >
          {open ? "Hide form" : "+ Send review link to past client"}
        </button>
      )}

      {open && (
        <div className={cn("mt-4 flex flex-col gap-3")}>
          {/* Contact picker - only shown when there are suggestions */}
          {contactSuggestions.length > 0 && (
            <div
              ref={pickerRef}
              className={cn("relative flex flex-col gap-1")}
              onBlur={(e) => {
                if (!pickerRef.current?.contains(e.relatedTarget as Node)) setListOpen(false);
              }}
            >
              <label className={cn("text-xs font-medium text-slate-500")}>
                Pick an existing contact
              </label>
              <input
                type="search"
                placeholder="Search by name, address or email…"
                value={contactSearch}
                onFocus={() => setListOpen(true)}
                onChange={(e) => {
                  setContactSearch(e.target.value);
                  setListOpen(true);
                }}
                className={cn(
                  "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                )}
              />
              {listOpen && (
                <div
                  className={cn(
                    "absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg",
                  )}
                >
                  {contactSuggestions
                    .filter((c) => {
                      const q = contactSearch.toLowerCase();
                      return (
                        !q ||
                        c.name.toLowerCase().includes(q) ||
                        c.email?.toLowerCase().includes(q) ||
                        c.address?.toLowerCase().includes(q) ||
                        c.phone?.includes(q)
                      );
                    })
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        tabIndex={0}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          applyContact(c.id);
                          setContactSearch("");
                          setListOpen(false);
                        }}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-slate-50",
                        )}
                      >
                        <span className={cn("text-sm font-medium text-slate-800")}>{c.name}</span>
                        {c.address && (
                          <span className={cn("text-xs text-slate-500")}>{c.address}</span>
                        )}
                        <span className={cn("text-xs text-slate-400")}>
                          {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact info"}
                        </span>
                      </button>
                    ))}
                  {contactSuggestions.filter((c) => {
                    const q = contactSearch.toLowerCase();
                    return (
                      !q ||
                      c.name.toLowerCase().includes(q) ||
                      c.email?.toLowerCase().includes(q) ||
                      c.address?.toLowerCase().includes(q) ||
                      c.phone?.includes(q)
                    );
                  }).length === 0 && (
                    <p className={cn("px-3 py-2.5 text-xs text-slate-400")}>No contacts found</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mode toggle */}
          <div className={cn("flex gap-2")}>
            {(["email", "sms"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  resetState();
                }}
                className={cn(
                  "rounded-lg border px-4 py-1.5 text-xs font-semibold transition-colors",
                  mode === m
                    ? "border-russian-violet bg-russian-violet/10 text-russian-violet"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                )}
              >
                {m === "email" ? "📧 Email" : "💬 SMS"}
              </button>
            ))}
          </div>

          {/* Email mode: form → preview → confirm send */}
          {mode === "email" && !previewHtml && (
            <form onSubmit={handlePreview} className={cn("flex flex-col gap-3")}>
              <div className={cn("flex flex-col gap-2")}>
                <input
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  required
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                  )}
                />
                <input
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                  )}
                />
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
                {loading ? "Loading preview..." : "Preview email"}
              </button>
            </form>
          )}

          {/* Email preview */}
          {mode === "email" && previewHtml && (
            <div className={cn("flex flex-col gap-3")}>
              <p className={cn("text-xs font-semibold uppercase tracking-wide text-slate-500")}>
                Preview - sending to {email}
              </p>
              <iframe
                srcDoc={previewHtml}
                title="Email preview"
                className={cn("w-full rounded-lg border border-slate-200")}
                style={{ height: "480px" }}
                sandbox="allow-same-origin"
              />
              {error && <p className={cn("text-coquelicot-400 text-xs")}>{error}</p>}
              <div className={cn("flex gap-2")}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleSend()}
                  className={cn(
                    "bg-moonstone-600 hover:bg-moonstone-700 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {loading ? "Sending..." : "Send email"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewHtml(null);
                    setError(null);
                  }}
                  className={cn(
                    "rounded-lg border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-400",
                  )}
                >
                  ← Back
                </button>
              </div>
            </div>
          )}

          {/* SMS mode */}
          {mode === "sms" && (
            <form onSubmit={handleSmsSubmit} className={cn("flex flex-col gap-3")}>
              <div className={cn("flex flex-col gap-2")}>
                <input
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  required
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                  )}
                />
                <input
                  type="tel"
                  autoComplete="off"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  onBlur={(e) => setPhoneInput(formatNZPhone(e.target.value))}
                  placeholder="021 123 1234"
                  className={cn(
                    "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-1",
                    phoneInput && !phoneValid ? "border-coquelicot-500/60" : "",
                  )}
                />
              </div>
              {phoneInput && (
                <p
                  className={cn(
                    "-mt-1 text-xs",
                    phoneValid ? "text-slate-400" : "text-coquelicot-400",
                  )}
                >
                  {phoneValid ? `Stored as: ${phoneE164}` : "Invalid phone number"}
                </p>
              )}
              {error && <p className={cn("text-coquelicot-400 text-xs")}>{error}</p>}
              <button
                type="submit"
                disabled={loading || (!!phoneInput && !phoneValid)}
                className={cn(
                  "bg-moonstone-600 hover:bg-moonstone-700 self-start rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {loading ? "Generating..." : "Generate text"}
              </button>
            </form>
          )}

          {/* Existing link - already sent to this client before */}
          {existingUrl && (
            <div className={cn("rounded-lg border border-slate-200 bg-slate-50 p-3")}>
              <p
                className={cn(
                  "text-coquelicot-500 mb-2 text-xs font-semibold uppercase tracking-wide",
                )}
              >
                Already sent - here is their existing link
              </p>
              <p className={cn("mb-3 break-all text-xs text-slate-500")}>{existingUrl}</p>
              <CopyLinkButton url={existingUrl} />
            </div>
          )}

          {/* SMS copy box */}
          {smsText && (
            <div className={cn("rounded-lg border border-slate-200 bg-slate-50 p-3")}>
              <p
                className={cn("mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500")}
              >
                Copy and send from your phone
              </p>
              <p className={cn("mb-3 text-sm leading-relaxed text-slate-700")}>{smsText}</p>
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
