// scripts/check-invoice-text.ts
// The text-message version of an invoice or quote reads right for each state, asks for the
// balance on a part-paid invoice, and keeps the customer link on a line of its own.
// Needs --conditions=react-server for the `server-only` import. Run: npm test -- invoice-text

import { buildInvoiceText, type InvoiceEmailData } from "@/features/reviews/lib/email-invoice";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";
import { expect, expectEqual, finish } from "./lib/harness.js";

const LINK = "https://www.tothepoint.co.nz/i/Ab3dE5gH7k";

/**
 * An open invoice with sensible defaults, overridden per case.
 * @param over - Fields to change.
 * @returns Invoice email fields.
 */
function invoice(over: Partial<InvoiceEmailData> = {}): InvoiceEmailData {
  return {
    number: "TTP-202627-0100",
    clientName: "Mary Smith",
    clientEmail: "mary@example.com",
    issueDate: new Date("2026-11-05T00:00:00Z"),
    dueDate: new Date("2026-11-12T00:00:00Z"),
    total: 176.67,
    viewUrl: LINK,
    ...over,
  };
}

const identity = DEFAULT_SETTINGS.identity;

expectEqual(
  "open invoice: what's owed, when, the link alone on its line, then the sign-off",
  buildInvoiceText(invoice(), "open", identity),
  `Hi Mary, here's your invoice from To the Point Tech. $176.67 is due by 12 Nov 2026, and the bank details are on it.\n\n${LINK}\n\nThanks, Harrison`,
);
expect(
  "part-paid invoice asks for the balance",
  buildInvoiceText(invoice({ alreadyPaid: 100 }), "open", identity).includes(
    "$76.67 is due by 12 Nov 2026",
  ),
);
expect(
  "overdue invoice says when it was due",
  buildInvoiceText(invoice(), "overdue", identity).includes("$176.67 was due on 12 Nov 2026"),
);
expect(
  "paid invoice is a receipt",
  buildInvoiceText(invoice(), "paid", identity).startsWith(
    "Hi Mary, here's your receipt from To the Point Tech for $176.67 - it's all paid.",
  ),
);
expect(
  "replacement says corrected",
  buildInvoiceText(invoice({ replacesNumber: "TTP-202627-0099" }), "open", identity).includes(
    "here's your corrected invoice",
  ),
);
expectEqual(
  "quote: the total and how to go ahead",
  buildInvoiceText(invoice({ isQuote: true }), "open", identity).split("\n\n")[0],
  "Hi Mary, here's your quote from To the Point Tech for $176.67. If you're happy with it, just reply or give me a ring and I'll get it booked in.",
);
expectEqual(
  "the person behind a company invoice is greeted",
  buildInvoiceText(
    invoice({ clientName: "68 Ltd", defaultGreeting: "Michael" }),
    "open",
    identity,
  ).slice(0, 9),
  "Hi Michae",
);
expectEqual(
  "no link leaves no empty gap",
  buildInvoiceText(invoice({ viewUrl: null }), "open", identity).split("\n\n").length,
  2,
);

finish();
