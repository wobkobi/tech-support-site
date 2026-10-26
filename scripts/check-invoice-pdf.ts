// scripts/check-invoice-pdf.ts
// The invoice PDF renders macrons, multi-line notes and long invoices (onto a second page),
// and the paid, voided and couldn't-fix wording it prints reads right.
// Run with: npm test -- invoice-pdf
// Set INVOICE_PDF_OUT=<dir> to also write the rendered PDFs there for a look.

import {
  settledCallout,
  settlementRows,
  unsuccessfulNote,
} from "@/features/business/lib/business-format";
import { generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import type { Invoice, LineItem } from "@/features/business/types/business";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { expect, expectEqual, finish } from "./lib/harness.js";

/**
 * A sent invoice with sensible defaults, overridden per fixture.
 * @param over - Fields to change.
 * @returns Invoice DTO ready to render.
 */
function invoice(over: Partial<Invoice> = {}): Invoice {
  const lineItems: LineItem[] = over.lineItems ?? [
    { description: "Laptop repair", qty: 1, unitPrice: 65, lineTotal: 65, minutes: 60 },
  ];
  const subtotal = lineItems.reduce((s, l) => s + l.lineTotal, 0);
  return {
    id: "fixture",
    number: "TTP-202627-0100",
    clientName: "Hēmi Pōhatu",
    clientEmail: "hemi@example.com",
    issueDate: "2026-10-20",
    dueDate: "2026-10-27",
    jobDate: "2026-10-18",
    lineItems,
    gst: false,
    subtotal,
    gstAmount: 0,
    total: subtotal,
    status: "SENT",
    notes: null,
    contactId: null,
    driveFileId: null,
    driveWebUrl: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

/**
 * Renders one fixture, counts its pages and optionally saves it.
 * @param name - Fixture name, also the saved file's name.
 * @param inv - Invoice to render.
 * @returns Page count, or null when rendering threw.
 */
async function render(name: string, inv: Invoice): Promise<number | null> {
  try {
    const bytes = await generateInvoicePdf(inv, DEFAULT_SETTINGS.identity);
    const out = process.env.INVOICE_PDF_OUT;
    if (out) fs.writeFileSync(path.join(out, `${name}.pdf`), bytes);
    return (await PDFDocument.load(bytes)).getPageCount();
  } catch (err) {
    console.error(`        ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Runs every fixture and exits non-zero when any fail.
 */
async function main(): Promise<void> {
  // Rendering: Helvetica's WinAnsi encoding can't hold a macron, so these crashed it.
  expectEqual(
    "macrons in name, address line and notes render on one page",
    await render(
      "macrons",
      invoice({
        lineItems: [
          {
            description: "Wi-Fi set-up at Ōrākei",
            qty: 1,
            unitPrice: 65,
            lineTotal: 65,
            minutes: 60,
          },
        ],
        notes: "Kia ora Hēmi, thanks for having me.\nThe router is in the hallway now.",
      }),
    ),
    1,
  );
  expectEqual(
    "characters outside the font print blank instead of failing",
    await render("outside-font", invoice({ clientName: "Wei 王伟 👍", notes: "Thanks ✔" })),
    1,
  );
  const many: LineItem[] = Array.from({ length: 34 }, (_, i) => ({
    description: `Task ${i + 1}: set up the new printer and check the scanner`,
    qty: 1,
    unitPrice: 10,
    lineTotal: 10,
  }));
  const long = await render(
    "long",
    invoice({
      lineItems: many,
      promoTitle: "Spring offer",
      promoDiscount: 20,
      promoNote: "1 hr at $45/hr instead of $65/hr",
      total: 320,
      notes: Array.from({ length: 12 }, (_, i) => `Note line ${i + 1}`).join("\n"),
    }),
  );
  expect("34 lines run onto a second page", long !== null && long > 1, `pages: ${long}`);
  expectEqual(
    "paid invoice renders",
    await render("paid", invoice({ status: "PAID", paidAt: "2026-10-22T02:00:00.000Z" })),
    1,
  );
  expectEqual(
    "voided invoice renders",
    await render("voided", invoice({ status: "VOIDED", voidedAt: "2026-10-21T02:00:00.000Z" })),
    1,
  );
  expectEqual(
    "replacement with couldn't-fix discount renders",
    await render(
      "replacement",
      invoice({
        number: "TTP-202627-0101",
        replacesNumber: "TTP-202627-0100",
        unsuccessful: true,
        unsuccessfulDiscount: 32.5,
        unsuccessfulNote: unsuccessfulNote(["Laptop repair"], 65, 0.5),
        total: 32.5,
      }),
    ),
    1,
  );
  expectEqual(
    "quote renders",
    await render(
      "quote",
      invoice({ number: "Q-202627-0004", isQuote: true, quoteValidUntil: "2026-11-20" }),
    ),
    1,
  );

  // Settlement rows: a paid invoice must never ask for money.
  expectEqual("sent, nothing paid: no rows", settlementRows({ status: "SENT", total: 100 }), []);
  expectEqual(
    "sent, part paid: already paid and the balance",
    settlementRows({ status: "SENT", total: 100.5, alreadyPaid: 50 }),
    [
      { label: "Already paid", value: "-$50.00" },
      { label: "Balance due", value: "$50.50", bold: true },
    ],
  );
  expectEqual(
    "paid after a part payment: balance is zero",
    settlementRows({
      status: "PAID",
      total: 100.5,
      alreadyPaid: 50,
      paidAt: "2026-10-22T02:00:00.000Z",
    }),
    [
      { label: "Already paid", value: "-$50.00" },
      { label: "Paid 22 Oct 2026", value: "-$50.50" },
      { label: "Balance due", value: "$0.00", bold: true },
    ],
  );
  expectEqual("voided: no rows", settlementRows({ status: "VOIDED", total: 100 }), []);
  expectEqual("sent: no settled box", settledCallout({ status: "SENT", total: 100 }), null);
  expectEqual(
    "voided box names the date",
    settledCallout({ status: "VOIDED", total: 100, voidedAt: "2026-10-21T02:00:00.000Z" })?.text,
    "This invoice was voided on 21 Oct 2026, so there's nothing to pay.",
  );

  // Couldn't-fix note: names the task and the labour it came off.
  expectEqual(
    "one task at half price",
    unsuccessfulNote(["Laptop repair"], 25, 0.5),
    "Couldn't be fixed: Laptop repair, so $25.00 of labour is half price.",
  );
  expectEqual(
    "two tasks, not charged",
    unsuccessfulNote(["Printer", "Scanner", "Printer"], 40, 0),
    "Couldn't be fixed: Printer and Scanner, so $40.00 of labour isn't charged.",
  );
  expectEqual(
    "no task names, other factor",
    unsuccessfulNote([], 30, 0.25),
    "The problem couldn't be fixed, so $30.00 of labour is charged at 25%.",
  );
  expectEqual("no base: no note", unsuccessfulNote(["Laptop"], 0, 0.5), null);

  finish();
}

void main();
