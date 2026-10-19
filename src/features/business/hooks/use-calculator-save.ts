"use client";
// src/features/business/hooks/use-calculator-save.ts
// Save paths for the job calculator: invoice / save & send / quote (with the add-to-contacts
// gate and contactId backfill), mark-paid, trip logging, and the direct income entry.

import { useToast } from "@/features/admin/components/ui/Toast";
import { validateEmail } from "@/features/booking/lib/booking";
import {
  alreadyPaidAmount,
  type AlreadyPaidState,
} from "@/features/business/lib/already-paid-input";
import {
  buildIncomeDescription,
  formatNZD,
  jobToLineItems,
  type calcJobTotal,
  type JobPricing,
  type LabourSurcharge,
} from "@/features/business/lib/business";
import { clearDraft } from "@/features/business/lib/calculator-draft";
import { INCOME_METHODS } from "@/features/business/lib/constants";
import type { ActivePromo } from "@/features/business/lib/promos";
import type { AutoTripResult } from "@/features/business/lib/trips";
import type {
  EventPrefill,
  JobCalculation,
  TaskLine,
  TaskTemplate,
} from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** The income method a cash job records under. */
const CASH: (typeof INCOME_METHODS)[number] = "Cash";

/** Calculator state the save paths read. */
interface UseCalculatorSaveArgs {
  /** The assembled job (tasks, parts, travel, notes, client). */
  job: JobCalculation;
  /** Totals computed from {@link UseCalculatorSaveArgs.job}. */
  totals: ReturnType<typeof calcJobTotal>;
  /** Labour surcharge for the job date (public holiday or weekend), or null. */
  surcharge: LabourSurcharge | null;
  /** Live pricing; only the travel and billable minimums feed the line items. */
  pricing: Pick<JobPricing, "minTravelCharge" | "minBillableMins">;
  activePromo: ActivePromo | null;
  skipPromo: boolean;
  /** Schedule-event prefill, or null; links the invoice back to the billed job. */
  eventPrefill: EventPrefill | null;
  /** Google id of the picked contact, for the contact check. */
  pickedContactGoogleId: string | null;
  /** New name for the picked contact, set when the operator edited it and kept the box ticked. */
  renameContactTo: string | null;
  /** Job date the income entry is recorded against, and the logged trip's date. */
  jobDate: string;
  /**
   * Where you drove for this job, or null when you didn't. Set, an invoice save logs the trip.
   */
  tripAddress: string | null;
  /** "Paid in cash" ticked: an invoice saves as paid, an income entry records Cash. */
  paidCash: boolean;
  /** Already paid box: part of the bill handed over on the day. */
  alreadyPaid: AlreadyPaidState;
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
 * @param args.surcharge - Labour surcharge for the job date, or null.
 * @param args.pricing - Live travel and billable minimums.
 * @param args.activePromo - Promo resolved for the job date, or null.
 * @param args.skipPromo - Whether the promo is skipped for this job.
 * @param args.eventPrefill - Schedule-event prefill, or null.
 * @param args.pickedContactGoogleId - Google id of the picked contact, or null.
 * @param args.renameContactTo - New name for the picked contact on invoice save, or null.
 * @param args.jobDate - Job date for the income entry and the logged trip.
 * @param args.tripAddress - Where you drove for the job, or null for no trip.
 * @param args.paidCash - Whether the client paid in cash on the day.
 * @param args.alreadyPaid - Amount and method handed over on the day, if any.
 * @param args.setTaskTemplates - Task template setter, refreshed as templates save.
 * @param args.onIncomeSaved - Resets the form after an income save.
 * @returns Save state plus the save handlers.
 */
export function useCalculatorSave({
  job,
  totals,
  surcharge,
  pricing,
  activePromo,
  skipPromo,
  eventPrefill,
  pickedContactGoogleId,
  renameContactTo,
  jobDate,
  tripAddress,
  paidCash,
  alreadyPaid,
  setTaskTemplates,
  onIncomeSaved,
}: UseCalculatorSaveArgs): UseCalculatorSave {
  const router = useRouter();
  const { toast } = useToast();
  const { tasks, clientName, clientEmail, notes } = job;

  // Set after a successful POST so handleAddContactClose can PATCH `contactId` once the
  // modal returns the new Contact's id.
  const [savingInvoice, setSavingInvoice] = useState(false);
  // True while the in-flight save is a "Save & send"; drives the two button labels.
  const [saveSendMode, setSaveSendMode] = useState(false);
  // True while the in-flight save is a "Save as quote"; drives its busy label.
  const [saveQuoteMode, setSaveQuoteMode] = useState(false);
  const [saveInvoiceError, setSaveInvoiceError] = useState<string | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  // Existing contact (matched by Google link) lacking the typed email, so the popup
  // offers to add the email.
  const [pendingExistingName, setPendingExistingName] = useState<string | null>(null);
  // That contact's id, so the invoice still links to it when the operator declines.
  const [pendingExistingId, setPendingExistingId] = useState<string | null>(null);
  const [savingIncome, setSavingIncome] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  // Income rows already in, so a retry after a half-saved split posts only the missing one.
  const [savedIncomeRows, setSavedIncomeRows] = useState<string[]>([]);

  /**
   * Saves custom task descriptions to the template library for future reuse.
   * @param taskList - Tasks from the current job to persist as templates
   */
  async function saveTaskTemplates(taskList: TaskLine[]): Promise<void> {
    // Only tasks with both device and action become templates.
    const tagged = taskList.filter((t) => t.rateConfigId == null && t.device && t.action);
    // One request per distinct tag pair: the endpoint's look-up-then-create upsert would
    // insert duplicates in this parallel batch. The last occurrence wins.
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
            // Fallback for the server's composeDescription() if a tag drops out.
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
   * Attaches a saved invoice to a Contact. Best-effort, though the review link and the
   * contact's invoice history depend on it.
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
   * Renames the picked contact (and its Google Contact) to the invoice name; a failure only warns.
   * @param contactDbId - The picked contact's DB id.
   * @param name - The new name.
   */
  async function renameContact(contactDbId: string, name: string): Promise<void> {
    try {
      const res = await fetch(`/api/admin/contacts/${contactDbId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast(`Contact renamed to ${name}.`, { tone: "success" });
    } catch {
      toast("Invoice saved, but the contact's name didn't update. Change it on the contact page.", {
        tone: "warning",
      });
    }
  }

  /**
   * Closes the add-to-contacts modal after a direct save, best-effort linking the invoice
   * to the contact before navigating to the detail page.
   * @param contactDbId - Contact the modal created or updated, or null on dismiss / failure
   *   (an already-known contact missing the email is linked instead).
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

  // Paid in cash wins over the box; an amount covering the total is a full payment.
  const prepaid = paidCash ? 0 : alreadyPaidAmount(alreadyPaid);
  const prepaidCovers = prepaid > 0 && prepaid >= totals.total;

  /**
   * Marks a just-saved invoice paid on the job date via the Payment dialog's route, which
   * also records the income. A failure leaves it unpaid and says so.
   * @param invoiceId - The saved invoice.
   * @param method - How the money came in (an INCOME_METHODS value).
   */
  async function markPaid(invoiceId: string, method: string): Promise<void> {
    try {
      const res = await fetch(`/api/business/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paidAt: jobDate,
          method,
          createIncome: true,
          sendApology: false,
        }),
      });
      const d = (await res.json()) as { ok?: boolean; sheetWarning?: boolean };
      if (!res.ok || !d.ok) throw new Error("pay failed");
      if (d.sheetWarning) {
        toast("Marked paid, but the Cashbook sheet update didn't go through.", {
          tone: "warning",
        });
      }
    } catch {
      toast("Invoice saved, but it couldn't be marked paid. Mark it paid from the invoice page.", {
        tone: "warning",
      });
    }
  }

  /** Clears save errors and in-flight bookkeeping for a fresh form. */
  function resetSaveState(): void {
    // Stale save errors would otherwise sit above the buttons on a blank form.
    setIncomeError(null);
    setSaveInvoiceError(null);
    setSavedIncomeRows([]);
    // A failed Save & send would leave saveSendMode true and mislabel the next save.
    setSaveSendMode(false);
    setSaveQuoteMode(false);
    setPendingInvoiceId(null);
  }

  /**
   * Direct save: POSTs the calculator state to the invoices API and navigates to the
   * detail page. Backdating and custom numbers are done by editing the saved DRAFT.
   * @param send - "Save & send": skip the add-to-contacts gate and open `?send=1`.
   * @param quote - "Save as quote": saves as a QUOTE with a Q- number and 30-day validity.
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
    // Same rule as the invoice edit form; the buttons are disabled too, this is the backstop.
    if (!quote && Math.round((prepaid - totals.total) * 100) > 0) {
      setSaveInvoiceError("The amount already paid is more than the invoice total.");
      return;
    }
    // Check the email before the POST, or the draft saves and the bad email surfaces later.
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
        surcharge,
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
          // The id, not the title: redemptions are keyed by promo and titles can be edited.
          promoId: promoActive ? activePromo.id : null,
          // The server stores `unsuccessful === true`, so omitting it would record success.
          unsuccessful: totals.unsuccessfulDiscount > 0,
          unsuccessfulDiscount:
            totals.unsuccessfulDiscount > 0 ? totals.unsuccessfulDiscount : null,
          // Link back to the billed job from "Bill in calculator". calendarEventId is the
          // earliest event; the full set lets every merged event find this invoice.
          bookingId: eventPrefill?.bookingId ?? null,
          calendarEventId: eventPrefill?.calendarEventId ?? null,
          calendarEventIds: eventPrefill?.slots.map((slot) => slot.calendarEventId) ?? [],
          jobDate,
          // Quote mode: server allocates a Q- number + 30-day validity.
          isQuote: quote || undefined,
          // Part payment: the invoice asks for the balance and the server records this
          // amount in income on the job date. A full payment goes through markPaid instead.
          ...(!quote &&
            prepaid > 0 &&
            !prepaidCovers && {
              alreadyPaid: prepaid,
              alreadyPaidMethod: alreadyPaid.method,
              alreadyPaidDate: jobDate,
            }),
          // The server logs the trip at Google's round-trip km, charged for or not.
          ...(!quote && tripAddress && { trip: { address: tripAddress, date: jobDate } }),
          // issueDate, dueDate, number all defaulted server-side.
        }),
      });
      const d = (await res.json()) as
        | {
            ok: true;
            invoice: { id: string };
            sheetSyncWarning?: boolean;
            incomeSheetWarning?: boolean;
            trip?: AutoTripResult;
          }
        | { error: string };
      if ("error" in d) throw new Error(d.error);
      if (d.trip?.status === "logged") {
        toast(`Trip logged: ${d.trip.km} km there and back.`, { tone: "success" });
      } else if (d.trip?.status === "no_route" || d.trip?.status === "failed") {
        toast(
          d.trip.status === "no_route"
            ? "Invoice saved, but Google couldn't find a route for the trip. Add it on the Trips page."
            : "Invoice saved, but the trip didn't log. Add it on the Trips page.",
          { tone: "warning" },
        );
      }
      if (d.sheetSyncWarning) {
        toast(
          quote
            ? "Quote saved - sheet counter sync failed. Update SETTINGS!B12."
            : "Invoice saved - sheet counter sync failed. Update SETTINGS!B19.",
          { tone: "warning" },
        );
      }
      if (d.incomeSheetWarning) {
        toast("Already paid added to income, but the Cashbook sheet update didn't go through.", {
          tone: "warning",
        });
      }
      const invoiceId = d.invoice.id;
      // Before the contacts gate, which can stop here for its modal. A quote can't be paid.
      if (!quote && (paidCash || prepaidCovers)) {
        await markPaid(invoiceId, paidCash ? CASH : alreadyPaid.method);
      }
      // Add-to-contacts gate: defer nav until the modal closes so handleAddContactClose can
      // backfill contactId. Link a known contact here whether or not the prompt fires.
      if (clientEmail.trim()) {
        try {
          const checkParams = new URLSearchParams({ email: clientEmail.trim() });
          if (pickedContactGoogleId) checkParams.set("googleContactId", pickedContactGoogleId);
          const checkRes = await fetch(`/api/admin/contacts/check?${checkParams.toString()}`);
          const checkData = (await checkRes.json()) as {
            exists?: boolean;
            contactId?: string | null;
            linkedContactId?: string | null;
            existingContactId?: string | null;
            existingContactName?: string | null;
          };
          if (checkRes.ok) {
            // Found by Google link, so a changed email can't aim the rename at someone else.
            if (renameContactTo && checkData.linkedContactId) {
              await renameContact(checkData.linkedContactId, renameContactTo);
            }
            const existingId = checkData.existingContactId ?? null;
            if (checkData.contactId) {
              await linkInvoiceToContact(invoiceId, checkData.contactId);
            } else if (existingId && send) {
              // Already a contact, just without this email: link now to avoid a duplicate.
              await linkInvoiceToContact(invoiceId, existingId);
            } else if (checkData.exists === false && !send) {
              // Unknown email: defer nav so handleAddContactClose can create and link the
              // contact. "Save & send" skips this; the send flow has its own prompt.
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
      // Drop the saved draft so the calculator starts blank (handleAddContactClose does too).
      clearDraft();
      router.push(`/admin/business/invoices/${invoiceId}${send ? "?send=1" : ""}`);
    } catch (err) {
      setSaveInvoiceError(err instanceof Error ? err.message : "Could not save invoice");
      setSavingInvoice(false);
    }
  }

  /**
   * Posts the current job to the income API, then resets the calculator. A part paid in
   * Cash gets its own row; rows already in are skipped on retry.
   */
  async function handleSaveIncome(): Promise<void> {
    setSavingIncome(true);
    setIncomeError(null);
    // "Business Account" is an expense method, not in INCOME_METHODS.
    const bank = INCOME_METHODS[0];
    const split = prepaid > 0 && !prepaidCovers && alreadyPaid.method !== bank;
    const rows: { key: string; method: string; amount: number }[] = split
      ? [
          { key: "part", method: alreadyPaid.method, amount: prepaid },
          { key: "rest", method: bank, amount: roundCents(totals.total - prepaid) },
        ]
      : [
          {
            key: "whole",
            method: paidCash ? CASH : prepaidCovers ? alreadyPaid.method : bank,
            amount: totals.total,
          },
        ];
    const description =
      buildIncomeDescription(job) + (split ? ` (split, total ${formatNZD(totals.total)})` : "");
    let sheetWarning = false;
    try {
      await saveTaskTemplates(tasks);
      for (const row of rows.filter((r) => !savedIncomeRows.includes(r.key))) {
        const res = await fetch("/api/business/income", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            // NZ-local job date, and the discounted total the customer actually pays.
            date: jobDate,
            customer: clientName || "Walk-in",
            description,
            amount: row.amount,
            method: row.method,
          }),
        });
        const d = (await res.json()) as {
          ok?: boolean;
          error?: string;
          sheetSyncWarning?: boolean;
        };
        if (!d.ok) {
          setIncomeError(
            d.error ||
              (split
                ? `Could not save the ${row.method} income entry.`
                : "Could not save income entry."),
          );
          return;
        }
        // recordIncome swallows the sheet error, so surface it rather than a plain success.
        if (d.sheetSyncWarning) sheetWarning = true;
        setSavedIncomeRows((prev) => [...prev, row.key]);
      }
      if (sheetWarning) {
        toast("Income saved, but the Cashbook sheet update didn't go through.", {
          tone: "warning",
        });
      } else {
        toast(split ? "Income saved as a Cash and a Bank entry." : "Income entry saved.", {
          tone: "success",
        });
      }
      setSavedIncomeRows([]);
      onIncomeSaved();
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
