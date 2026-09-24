"use client";
// src/features/business/hooks/use-calculator-save.ts
// Save paths for the job calculator: invoice / save & send / quote via the invoices API
// (with the add-to-contacts gate and contactId backfill), and the cash income entry.

import { useToast } from "@/features/admin/components/ui/Toast";
import { validateEmail } from "@/features/booking/lib/booking";
import {
  buildIncomeDescription,
  jobToLineItems,
  type calcJobTotal,
  type JobPricing,
} from "@/features/business/lib/business";
import { clearDraft } from "@/features/business/lib/calculator-draft";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import type { ActivePromo } from "@/features/business/lib/promos";
import type {
  EventPrefill,
  JobCalculation,
  TaskLine,
  TaskTemplate,
} from "@/features/business/types/business";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Calculator state the save paths read. */
interface UseCalculatorSaveArgs {
  /** The assembled job (tasks, parts, travel, notes, client). */
  job: JobCalculation;
  /** Totals computed from {@link UseCalculatorSaveArgs.job}. */
  totals: ReturnType<typeof calcJobTotal>;
  /** Public-holiday labour uplift for the job date. */
  holidayUplift: number;
  /** Live pricing; only the travel and billable minimums feed the line items. */
  pricing: Pick<JobPricing, "minTravelCharge" | "minBillableMins">;
  activePromo: ActivePromo | null;
  skipPromo: boolean;
  /** Schedule-event prefill, or null; links the invoice back to the billed job. */
  eventPrefill: EventPrefill | null;
  /** Google id of the picked contact, for the contact check. */
  pickedContactGoogleId: string | null;
  /** Job date the income entry is recorded against. */
  jobDate: string;
  setTaskTemplates: React.Dispatch<React.SetStateAction<TaskTemplate[]>>;
  /** Called after a successful income save to reset the form. */
  onIncomeSaved: () => void;
}

/** Save state and handlers returned by {@link useCalculatorSave}. */
interface UseCalculatorSave {
  savingInvoice: boolean;
  /** True while the in-flight save is a "Save & send". */
  saveSendMode: boolean;
  /** True while the in-flight save is a "Save as quote". */
  saveQuoteMode: boolean;
  saveInvoiceError: string | null;
  /** Saved invoice awaiting the add-to-contacts modal, or null. */
  pendingInvoiceId: string | null;
  /** Name of an existing contact missing the typed email, or null. */
  pendingExistingName: string | null;
  savingIncome: boolean;
  incomeError: string | null;
  handleSaveInvoice: (send?: boolean, quote?: boolean) => Promise<void>;
  handleSaveIncome: () => Promise<void>;
  handleAddContactClose: (contactDbId?: string | null) => Promise<void>;
  /** Clears save errors and in-flight bookkeeping for a fresh form. */
  resetSaveState: () => void;
}

/**
 * Owns the calculator's save state and the invoice / income save handlers.
 * @param args - Calculator state the save paths read.
 * @param args.job - The assembled job.
 * @param args.totals - Totals for the job.
 * @param args.holidayUplift - Public-holiday labour uplift.
 * @param args.pricing - Live travel and billable minimums.
 * @param args.activePromo - Promo resolved for the job date, or null.
 * @param args.skipPromo - Whether the promo is skipped for this job.
 * @param args.eventPrefill - Schedule-event prefill, or null.
 * @param args.pickedContactGoogleId - Google id of the picked contact, or null.
 * @param args.jobDate - Job date for the income entry.
 * @param args.setTaskTemplates - Task template setter, refreshed as templates save.
 * @param args.onIncomeSaved - Resets the form after an income save.
 * @returns Save state plus the save handlers.
 */
export function useCalculatorSave({
  job,
  totals,
  holidayUplift,
  pricing,
  activePromo,
  skipPromo,
  eventPrefill,
  pickedContactGoogleId,
  jobDate,
  setTaskTemplates,
  onIncomeSaved,
}: UseCalculatorSaveArgs): UseCalculatorSave {
  const router = useRouter();
  const { toast } = useToast();
  const { tasks, clientName, clientEmail, notes } = job;

  // Direct-save (Save invoice) state. pendingInvoiceId is set after a
  // successful POST so handleAddContactClose can PATCH `contactId` once the
  // modal returns the new Contact's id, then navigate to the detail page.
  const [savingInvoice, setSavingInvoice] = useState(false);
  // True while the in-flight save is a "Save & send" (routes to ?send=1 and
  // skips the calculator's add-to-contacts gate); drives the two button labels.
  const [saveSendMode, setSaveSendMode] = useState(false);
  // True while the in-flight save is a "Save as quote"; drives its busy label.
  const [saveQuoteMode, setSaveQuoteMode] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState<string | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  // Name of an existing contact (matched by Google link) that lacks the typed email,
  // so the add-to-contacts popup offers to add the email instead of a new contact.
  const [pendingExistingName, setPendingExistingName] = useState<string | null>(null);
  // That contact's id, so the invoice still links to it when the operator declines.
  const [pendingExistingId, setPendingExistingId] = useState<string | null>(null);
  const [savingIncome, setSavingIncome] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);

  /**
   * Saves custom task descriptions to the template library for future reuse.
   * @param taskList - Tasks from the current job to persist as templates
   */
  async function saveTaskTemplates(taskList: TaskLine[]): Promise<void> {
    // Only save tasks that have BOTH device + action populated. Description-only
    // rows (e.g. flat-rate travel lines) skip templating.
    const tagged = taskList.filter((t) => t.rateConfigId == null && t.device && t.action);
    // One request per distinct tag pair. The endpoint upserts by looking the row
    // up and then creating it, so two line items sharing a pair would both miss
    // the lookup in this parallel batch and insert a duplicate template - which
    // is how a second "Software repair" row appeared at a different price. The
    // last occurrence wins, matching the sequential upsert's final state.
    const byPair = new Map<string, TaskLine>();
    for (const t of tagged) {
      byPair.set(`${t.device?.toLowerCase()}|${t.action?.toLowerCase()}`, t);
    }
    await Promise.all(
      [...byPair.values()].map((t) =>
        fetch("/api/business/task-templates", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            defaultPrice: t.unitPrice,
            device: t.device,
            action: t.action,
            // Description fallback for the server's composeDescription() in case
            // either tag accidentally drops out before persist.
            description: t.description.trim(),
          }),
        })
          .then((r) => r.json())
          .then((d: { ok: boolean; template: TaskTemplate }) => {
            if (d.ok) {
              setTaskTemplates((prev) => {
                const exists = prev.find((p) => p.id === d.template.id);
                return exists
                  ? prev.map((p) => (p.id === d.template.id ? d.template : p))
                  : [...prev, d.template].sort((a, b) => b.usageCount - a.usageCount);
              });
            }
          }),
      ),
    );
  }

  /**
   * Attaches a saved invoice to a Contact. Best-effort: the invoice still
   * stands without the FK, but losing it costs the review link and the
   * contact's invoice history.
   * @param invoiceId - The saved invoice.
   * @param contactDbId - Contact to attach it to.
   * @returns Promise that resolves once the write has been attempted.
   */
  async function linkInvoiceToContact(invoiceId: string, contactDbId: string): Promise<void> {
    try {
      await fetch(`/api/business/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contactDbId }),
      });
    } catch {
      // Best-effort backfill; the invoice still saves without the FK.
    }
  }

  /**
   * Closes the add-to-contacts modal after a direct save. If the modal
   * created a Contact, PATCH the just-saved invoice with that contact's id
   * before navigating to the detail page. Best-effort backfill - the invoice
   * still navigates without the FK if PATCH fails.
   * @param contactDbId - DB id returned by the modal when the operator
   *   confirmed and a Contact was created or updated. Null on dismiss / failure,
   *   in which case an already-known contact missing the email is linked instead.
   */
  async function handleAddContactClose(contactDbId?: string | null): Promise<void> {
    const invoiceId = pendingInvoiceId;
    if (!invoiceId) return;
    setPendingInvoiceId(null);
    // Declining to add the email still links the invoice to the contact it belongs to.
    const linkId = contactDbId ?? pendingExistingId;
    if (linkId) {
      await linkInvoiceToContact(invoiceId, linkId);
    }
    clearDraft();
    router.push(`/admin/business/invoices/${invoiceId}`);
  }

  /** Clears save errors and in-flight bookkeeping for a fresh form. */
  function resetSaveState(): void {
    // Stale save errors would otherwise sit above the buttons on a blank form.
    setIncomeError(null);
    setSaveInvoiceError(null);
    // In-flight save bookkeeping. saveSendMode/saveQuoteMode are only ever set
    // when a save starts, so a failed Save & send leaves them true and puts the
    // next save's "Saving..." label on the wrong button.
    setSaveSendMode(false);
    setSaveQuoteMode(false);
    setPendingInvoiceId(null);
  }

  /**
   * Direct save: POSTs the calculator state straight to the invoices API and
   * navigates to the detail page. Backdating / custom invoice number / custom
   * due date is handled by editing a saved DRAFT after the fact.
   * @param send - When true ("Save & send"), skip the add-to-contacts gate and
   *   route to the detail page with `?send=1` so it auto-opens the send preview
   *   (which has its own add-to-contacts hook-in + contactId backfill).
   * @param quote - When true ("Save as quote"), the row saves as a QUOTE: a
   *   Q- number from the quote counter, QUOTE PDF, 30-day validity default,
   *   convertible to a real invoice from the detail page.
   */
  async function handleSaveInvoice(send = false, quote = false): Promise<void> {
    // Validate required fields
    setSaveInvoiceError(null);
    setSaveSendMode(send);
    setSaveQuoteMode(quote);
    if (!clientName.trim()) {
      setSaveInvoiceError("Client name is required.");
      return;
    }
    // Validate the email format before the POST so a malformed address blocks
    // invoice creation entirely. Otherwise the draft saves first and the bad
    // email only surfaces later when the add-to-contacts step rejects it.
    const emailCheck = validateEmail(clientEmail);
    if (emailCheck === "empty") {
      setSaveInvoiceError("Client email is required.");
      return;
    }
    if (emailCheck === "invalid") {
      setSaveInvoiceError("Enter a valid email address.");
      return;
    }
    if (emailCheck === "too-long") {
      setSaveInvoiceError("Email is too long.");
      return;
    }
    if (totals.subtotal <= 0) {
      setSaveInvoiceError("Add a task or line item with a price before saving.");
      return;
    }
    setSavingInvoice(true);
    try {
      // Build and POST the invoice
      await saveTaskTemplates(tasks);
      const lineItems = jobToLineItems(
        job,
        holidayUplift,
        pricing.minTravelCharge,
        pricing.minBillableMins,
      );
      const promoActive = activePromo && !skipPromo && totals.promoDiscount > 0;
      const res = await fetch("/api/business/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientEmail,
          lineItems,
          notes: notes || null,
          promoTitle: promoActive ? activePromo.title : null,
          promoDiscount: promoActive ? totals.promoDiscount : null,
          // The id, not just the title: the redemption this settles is keyed by
          // promo, and matching on a title would break the moment one is edited.
          promoId: promoActive ? activePromo.id : null,
          // Send the flag alongside its discount: the server stores
          // `unsuccessful === true`, so omitting it records every calculator-raised
          // invoice as successful even when the half-price reduction was applied.
          unsuccessful: totals.unsuccessfulDiscount > 0,
          unsuccessfulDiscount:
            totals.unsuccessfulDiscount > 0 ? totals.unsuccessfulDiscount : null,
          // Match back to the billed job when the session came from the schedule's
          // "Bill in calculator" action. calendarEventId stays the earliest event for
          // existing readers; the full set lets every merged event find this invoice.
          bookingId: eventPrefill?.bookingId ?? null,
          calendarEventId: eventPrefill?.calendarEventId ?? null,
          calendarEventIds: eventPrefill?.slots.map((slot) => slot.calendarEventId) ?? [],
          // Quote mode: server allocates a Q- number + 30-day validity.
          isQuote: quote || undefined,
          // issueDate, dueDate, number all defaulted server-side.
        }),
      });
      const d = (await res.json()) as
        | {
            ok: true;
            invoice: { id: string };
            sheetSyncWarning?: boolean;
          }
        | { error: string };
      if ("error" in d) throw new Error(d.error);
      if (d.sheetSyncWarning) {
        toast(
          quote
            ? "Quote saved - sheet counter sync failed. Update SETTINGS!B12."
            : "Invoice saved - sheet counter sync failed. Update SETTINGS!B19.",
          { tone: "warning" },
        );
      }
      const invoiceId = d.invoice.id;
      // Add-to-contacts gate: defer nav until the modal closes so
      // handleAddContactClose can backfill contactId via PATCH. "Save & send"
      // skips this - the detail send flow runs its own add-to-contacts hook-in.
      // Only the "new contact" path ever set contactId, via the prompt below,
      // so an invoice for a customer already on file was never linked to them.
      // That link is what the review-link check and the contact's invoice
      // history read, so resolve it here whether or not the prompt fires.
      if (clientEmail.trim()) {
        try {
          const checkParams = new URLSearchParams({ email: clientEmail.trim() });
          if (pickedContactGoogleId) checkParams.set("googleContactId", pickedContactGoogleId);
          const checkRes = await fetch(`/api/admin/contacts/check?${checkParams.toString()}`);
          const checkData = (await checkRes.json()) as {
            exists?: boolean;
            contactId?: string | null;
            existingContactId?: string | null;
            existingContactName?: string | null;
          };
          if (checkRes.ok) {
            const existingId = checkData.existingContactId ?? null;
            if (checkData.contactId) {
              await linkInvoiceToContact(invoiceId, checkData.contactId);
            } else if (existingId && send) {
              // Client picked from Google is already a contact, just without this
              // email. Link now so the send page finds the contact instead of
              // offering to add a duplicate.
              await linkInvoiceToContact(invoiceId, existingId);
            } else if (checkData.exists === false && !send) {
              // Unknown email (or a known contact missing it): defer nav so
              // handleAddContactClose can create or update the contact and link
              // it. "Save & send" skips the prompt - the detail send flow runs
              // its own add-to-contacts hook-in.
              setPendingExistingId(existingId);
              setPendingExistingName(checkData.existingContactName ?? null);
              setPendingInvoiceId(invoiceId);
              setSavingInvoice(false);
              return;
            }
          }
        } catch {
          // Fall through to navigate.
        }
      }
      // Drop the saved draft so the calculator starts blank next time the
      // operator opens it (mirrors the AddToContactsModal-gated path: the
      // backfill handler in handleAddContactClose ALSO clears the draft).
      clearDraft();
      router.push(`/admin/business/invoices/${invoiceId}${send ? "?send=1" : ""}`);
    } catch (err) {
      setSaveInvoiceError(err instanceof Error ? err.message : "Could not save invoice");
      setSavingInvoice(false);
    }
  }

  /**
   * Posts the current job to the income API to record it as an income entry, then resets the
   * calculator state and shows a confirmation toast on success.
   */
  async function handleSaveIncome(): Promise<void> {
    setSavingIncome(true);
    setIncomeError(null);
    try {
      await saveTaskTemplates(tasks);
      const res = await fetch("/api/business/income", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // Record against the selected job date (NZ-local), not UTC "now",
          // and store the discounted total the customer actually pays.
          date: jobDate,
          customer: clientName || "Walk-in",
          description: buildIncomeDescription(job),
          amount: totals.total,
          // Not a literal: this is income, and "Business Account" is an expense
          // method that INCOME_METHODS does not contain.
          method: INCOME_METHODS[0],
        }),
      });
      const d = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sheetSyncWarning?: boolean;
      };
      if (d.ok) {
        // Surface a failed Cashbook append, as IncomeView and ExpensesView do.
        // recordIncome swallows the sheet error so the entry still saves, so a
        // plain success toast here hid money that never reached the sheet.
        if (d.sheetSyncWarning) {
          toast("Income saved, but the Cashbook sheet update didn't go through.", {
            tone: "warning",
          });
        } else {
          toast("Income entry saved.", { tone: "success" });
        }
        onIncomeSaved();
      } else {
        setIncomeError(d.error || "Could not save income entry.");
      }
    } catch {
      setIncomeError("Could not save income entry. Please try again.");
    } finally {
      setSavingIncome(false);
    }
  }

  return {
    savingInvoice,
    saveSendMode,
    saveQuoteMode,
    saveInvoiceError,
    pendingInvoiceId,
    pendingExistingName,
    savingIncome,
    incomeError,
    handleSaveInvoice,
    handleSaveIncome,
    handleAddContactClose,
    resetSaveState,
  };
}
