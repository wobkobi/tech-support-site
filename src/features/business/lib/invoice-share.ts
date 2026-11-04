// src/features/business/lib/invoice-share.ts
// The customer's link to an invoice or quote PDF: a short random code on the site's own
// domain, the same link in every email and text, rebuilt from the record each time it opens.

import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Invoice } from "@prisma/client";
import { randomInt } from "crypto";

const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** 62^10 codes: far too many to guess one, still short enough to sit in a text. */
const TOKEN_LENGTH = 10;
const TOKEN_RE = /^[A-Za-z0-9]{10}$/;

/**
 * A fresh random link code.
 * @returns Ten letters and digits.
 */
function newShareToken(): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)];
  }
  return token;
}

/**
 * The customer link for a link code. Quotes read /q/ and invoices /i/; both paths open
 * any code, so a quote's link keeps working after it converts to an invoice.
 * @param token - The invoice's link code.
 * @param isQuote - Whether the record is a quote.
 * @returns The full link.
 */
export function invoiceShareUrl(token: string, isQuote: boolean | null | undefined): string {
  return `${getSiteUrl()}/${isQuote ? "q" : "i"}/${token}`;
}

/**
 * The invoice's customer link, making its code on first use.
 * @param invoice - The invoice's id, current code and quote flag.
 * @returns The full link.
 */
export async function ensureInvoiceShareUrl(
  invoice: Pick<Invoice, "id" | "shareToken" | "isQuote">,
): Promise<string> {
  if (invoice.shareToken) return invoiceShareUrl(invoice.shareToken, invoice.isQuote);
  // Write only while still unset, so two sends at once can't hand out different links.
  const token = newShareToken();
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoice.id, OR: [{ shareToken: null }, { shareToken: { isSet: false } }] },
    data: { shareToken: token },
  });
  if (claimed.count === 1) return invoiceShareUrl(token, invoice.isQuote);
  const row = await prisma.invoice.findUnique({
    where: { id: invoice.id },
    select: { shareToken: true },
  });
  if (!row?.shareToken) throw new Error(`Invoice ${invoice.id} not found`);
  return invoiceShareUrl(row.shareToken, invoice.isQuote);
}

/**
 * {@link ensureInvoiceShareUrl} for emails, where a missing link line beats a failed send.
 * @param invoice - The invoice's id, current code and quote flag.
 * @returns The full link, or null when the code couldn't be saved.
 */
export async function invoiceShareUrlOrNull(
  invoice: Pick<Invoice, "id" | "shareToken" | "isQuote">,
): Promise<string | null> {
  try {
    return await ensureInvoiceShareUrl(invoice);
  } catch (err) {
    console.error(`[invoice-share] Couldn't make the link for ${invoice.id}:`, err);
    return null;
  }
}

/**
 * Answers a customer link: the PDF inline, rebuilt so later edits and the paid or voided
 * stamp show, or a short note when the code matches nothing.
 * @param token - The code from the link.
 * @returns The PDF response, or a 404 note.
 */
export async function sharedInvoiceResponse(token: string): Promise<Response> {
  const invoice = TOKEN_RE.test(token)
    ? await prisma.invoice.findFirst({ where: { shareToken: token } })
    : null;
  if (!invoice) {
    const { phone } = await getIdentity();
    return new Response(
      `This link doesn't open anything. Ring ${phone} and I'll send you a fresh copy.`,
      {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
      },
    );
  }
  const pdfBytes = await generateInvoicePdf(serialiseInvoice(invoice));
  const kind = invoice.isQuote ? "Quote" : "Invoice";
  return new Response(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${kind} ${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
