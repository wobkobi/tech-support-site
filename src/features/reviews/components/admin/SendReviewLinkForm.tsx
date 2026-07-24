"use client";
// src/features/reviews/components/admin/SendReviewLinkForm.tsx
/**
 * @description Form for sending a review link to a past client via email or SMS.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Modal } from "@/features/admin/components/ui/Modal";
import { useToast } from "@/features/admin/components/ui/Toast";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { formatNZPhone, validatePhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useRef, useState } from "react";
import { CopyLinkButton } from "./CopyLinkButton";

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
 * Props for the {@link SendReviewLinkForm} component.
 */
interface SendReviewLinkFormProps {
  /** Contacts worth asking - not already reviewed, and not sent a link recently. Shown in a pre-fill dropdown. */
  contactSuggestions?: ContactSuggestion[];
  /** Start the form expanded without needing to click the toggle */
  defaultOpen?: boolean;
  /** Pre-fill the fields for one person, e.g. arriving from a contact's detail page. SMS mode is chosen when they have a phone but no email. */
  prefill?: { name: string; email: string | null; phone: string | null };
}

/**
 * Form for sending a review link to a past client via email or generating SMS text.
 * Email mode shows a rendered preview before sending.
 * @param props - Component props.
 * @param props.contactSuggestions - Contacts worth asking (not already reviewed, not sent a link recently), shown in a pre-fill dropdown.
 * @param props.defaultOpen - Start the form expanded. Defaults to false.
 * @param props.prefill - Pre-fill the fields for one person (name + email/phone).
 * @returns Send review link form element.
 */
export function SendReviewLinkForm({
  contactSuggestions = [],
  defaultOpen = false,
  prefill,
}: SendReviewLinkFormProps): React.ReactElement {
  const { toast } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  // Prefer email; fall back to SMS only when there's a phone but no email.
  const [mode, setMode] = useState<"email" | "sms">(
    prefill && !prefill.email && prefill.phone ? "sms" : "email",
  );
  const [contactSearch, setContactSearch] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [phoneInput, setPhoneInput] = useState(prefill?.phone ? formatNZPhone(prefill.phone) : "");
  const [loading, setLoading] = useState(false);
  const [smsText, setSmsText] = useState<string | null>(null);
  const [existingUrl, setExistingUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Rendered HTML preview returned from the preview API (email mode only). */
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  /** Resets transient results (preview, SMS text, existing-link). Does NOT clear form fields. */
  function resetState(): void {
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
    try {
      const res = await fetch("/api/admin/preview-review-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { ok?: boolean; html?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setPreviewHtml(data.html ?? "");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "error" });
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
    try {
      const res = await fetch("/api/admin/send-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, mode: "email" }),
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
        // Already sent one: surface the existing link to copy rather than send
        // a second. Stays inline - it is a result to act on, not a notification.
        setExistingUrl(data.reviewUrl);
      } else {
        toast("Review link sent.", { tone: "success" });
        clearFields();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "error" });
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
    setSmsText(null);
    setExistingUrl(null);
    try {
      const res = await fetch("/api/admin/send-review-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone: phoneInput, mode: "sms" }),
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
          `Hi ${firstName}, it's Harrison from To the Point Tech. Thanks for letting me help you out! A quick review would be greatly appreciated - it really helps: ${data.reviewUrl}`,
        );
        clearFields();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Something went wrong.", { tone: "error" });
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

  const phoneCheck = validatePhone(phoneInput);
  const phoneE164 = phoneCheck.e164;
  const phoneValid = phoneCheck.result === "ok";

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
          className="w-full text-left text-sm font-semibold text-russian-violet hover:underline"
        >
          {open ? "Hide form" : "+ Send review link to past client"}
        </button>
      )}

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          {/* Contact picker - only shown when there are suggestions */}
          {contactSuggestions.length > 0 && (
            <div
              ref={pickerRef}
              className="relative flex flex-col gap-1"
              onBlur={(e) => {
                if (!pickerRef.current?.contains(e.relatedTarget)) setListOpen(false);
              }}
            >
              <label className="text-xs font-medium text-slate-500">Pick an existing contact</label>
              <input
                type="search"
                placeholder="Search by name, address or email…"
                value={contactSearch}
                onFocus={() => setListOpen(true)}
                onChange={(e) => {
                  setContactSearch(e.target.value);
                  setListOpen(true);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
              />
              {listOpen && (
                <div className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
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
                        className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-slate-50"
                      >
                        <span className="text-sm font-medium text-slate-800">{c.name}</span>
                        {c.address && <span className="text-xs text-slate-500">{c.address}</span>}
                        <span className="text-xs text-slate-400">
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
                    <p className="px-3 py-2.5 text-xs text-slate-400">No contacts found</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex gap-2">
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

          {/* Email mode: form, with the preview + confirm send in a dialog over
              it. The form stays mounted underneath so backing out of the preview
              returns the typed details untouched. */}
          {mode === "email" && (
            <form onSubmit={handlePreview} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
                />
                <EmailInput
                  id="srl-email"
                  value={email}
                  onChange={setEmail}
                  placeholder="Email address"
                  autoComplete="off"
                  required
                  className="rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="self-start rounded-lg bg-moonstone-400 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-moonstone-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Loading preview..." : "Preview email"}
              </button>
            </form>
          )}

          {/* Email preview - exactly what the client receives, so the send is a
              confirmation of something seen rather than a leap of faith. */}
          <Modal
            open={mode === "email" && previewHtml !== null}
            onClose={() => setPreviewHtml(null)}
            title="Preview review link email"
            description={email ? `Sending to ${email}` : undefined}
            size="lg"
            footer={
              <>
                <AdminButton variant="secondary" onClick={() => setPreviewHtml(null)}>
                  Back
                </AdminButton>
                <AdminButton onClick={() => void handleSend()} busy={loading}>
                  {loading ? "Sending..." : "Send email"}
                </AdminButton>
              </>
            }
          >
            <iframe
              srcDoc={previewHtml ?? ""}
              title="Email preview"
              className="h-[60vh] w-full rounded-lg border border-slate-200"
              sandbox="allow-same-origin"
            />
          </Modal>

          {/* SMS mode */}
          {mode === "sms" && (
            <form onSubmit={handleSmsSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:ring-1 focus:ring-russian-violet/30 focus:outline-none"
                />
                <PhoneInput
                  id="srl-phone"
                  value={phoneInput}
                  onChange={setPhoneInput}
                  autoComplete="off"
                  required
                  hideError
                  className="rounded-lg"
                />
              </div>
              {phoneInput && (
                <p
                  className={cn(
                    "-mt-1 text-xs",
                    phoneValid ? "text-slate-400" : "text-coquelicot-600",
                  )}
                >
                  {phoneValid ? `Stored as: ${phoneE164}` : "Invalid phone number"}
                </p>
              )}
              <button
                type="submit"
                disabled={loading || (!!phoneInput && !phoneValid)}
                className="self-start rounded-lg bg-moonstone-400 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-moonstone-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Generating..." : "Generate text"}
              </button>
            </form>
          )}

          {/* Existing link - already sent to this client before */}
          {existingUrl && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-coquelicot-500 uppercase">
                Already sent - here is their existing link
              </p>
              <p className="mb-3 text-xs break-all text-slate-500">{existingUrl}</p>
              <CopyLinkButton url={existingUrl} />
            </div>
          )}

          {/* SMS copy box */}
          {smsText && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Copy and send from your phone
              </p>
              <p className="mb-3 text-sm leading-relaxed text-slate-700">{smsText}</p>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-lg bg-moonstone-400 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-moonstone-300"
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
