// src/features/business/lib/invoice-pdf.ts
// Generates the A4 invoice PDF with pdf-lib. Must match the on-screen InvoicePreviewPanel
// layout and palette.

import {
  formatNZD,
  goldCardLineLabel,
  lineItemQtyLabel,
  promoLineLabel,
  settledCallout,
  settlementRows,
  UNSUCCESSFUL_LINE_LABEL,
} from "@/features/business/lib/business";
import { nzFinancialYearCode } from "@/features/business/lib/financial-year";
import { isInvoiceOverdue } from "@/features/business/lib/invoice-status";
import { bankCode, bankParticulars } from "@/features/business/lib/payment-fields";
import type { Invoice } from "@/features/business/types/business";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateShort } from "@/shared/lib/date-format";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import fontkit from "@pdf-lib/fontkit";
import type { Invoice as PrismaInvoice } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";
import { degrees, PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib";

// Colours mirror the web's Tailwind palette so the PDF reads as the same document.
const BRAND = rgb(12 / 255, 10 / 255, 62 / 255); // russian-violet #0c0a3e
const DARK = rgb(30 / 255, 41 / 255, 59 / 255); // slate-800 #1e293b
const MID = rgb(100 / 255, 116 / 255, 139 / 255); // slate-500 #64748b
const LIGHT = rgb(203 / 255, 213 / 255, 225 / 255); // slate-300 #cbd5e1
const AMBER = rgb(180 / 255, 83 / 255, 9 / 255); // amber-700 #b45309 (matches web promo)
const PAID_COLOUR = rgb(0.1, 0.55, 0.25);
const OVERDUE_COLOUR = rgb(0.78, 0.16, 0.16);
// Purple distinguishes VOID from PAID (green) and OVERDUE (red).
const VOID_COLOUR = rgb(90 / 255, 42 / 255, 130 / 255);

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

const LOGO_SVG_H = 674;
const LOGO_H = 90;
const HEADER_TOP = PAGE_H - MARGIN;
// Lowest point body content may reach; the footer and its rule sit below it.
const CONTENT_BOTTOM = MARGIN + 44;
// Where a continuation page's content starts, under its "continued" line.
const CONTINUED_TOP = PAGE_H - MARGIN - 34;

interface PdfCtx {
  doc: PDFDocument;
  /** The page being drawn on; {@link ensureSpace} moves it to a new page. */
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  identity: IdentitySettings;
  invoice: Invoice;
}

let fontBytes: { regular: Buffer; bold: Buffer } | null = null;

/**
 * Arimo, read once per instance. Its letters are as wide as Helvetica's, so the layout
 * matches, and unlike the built-in Helvetica it can print a macron ("Hēmi"). The files are
 * trimmed to Latin, macrons, punctuation and currency (about 26 KB each) and embedded whole,
 * since pdf-lib's own subsetting drops letters from Arimo. A character outside that set
 * prints blank rather than failing the PDF.
 * @returns The regular and bold font files.
 */
function loadFontBytes(): { regular: Buffer; bold: Buffer } {
  fontBytes ??= {
    regular: readFileSync(
      path.join(process.cwd(), "src/features/business/assets/fonts/Arimo-Regular.ttf"),
    ),
    bold: readFileSync(
      path.join(process.cwd(), "src/features/business/assets/fonts/Arimo-Bold.ttf"),
    ),
  };
  return fontBytes;
}

/**
 * Starts a new page when the next `needed` points won't fit above the footer. The new page
 * gets the watermark and a "continued" line, and drawing carries on under it.
 * @param ctx - PDF drawing context; its page moves on a break.
 * @param y - Where the next block would start.
 * @param needed - Height the next block takes.
 * @returns Where to draw the block: `y`, or the top of the new page.
 */
function ensureSpace(ctx: PdfCtx, y: number, needed: number): number {
  if (y - needed >= CONTENT_BOTTOM) return y;
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  drawStatusWatermark(ctx, ctx.invoice);
  const label = `${ctx.invoice.number} continued`;
  ctx.page.drawText(label, {
    x: MARGIN + CONTENT_W - ctx.font.widthOfTextAtSize(label, 10),
    y: PAGE_H - MARGIN - 10,
    size: 10,
    font: ctx.font,
    color: MID,
  });
  return CONTINUED_TOP;
}

interface LogoPath {
  fill: string;
  d: string;
  ty: number;
}

/**
 * Converts a CSS hex colour (e.g. "#0c0a3e") into pdf-lib's rgb() colour.
 * @param hex - Hex colour with leading #.
 * @returns pdf-lib RGB colour.
 */
function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/**
 * Greedy word-wrap: packs words into lines that fit within maxW at fontSize. A typed line
 * break starts a new line.
 * @param text - Source string to wrap.
 * @param maxW - Maximum line width in PDF points.
 * @param size - Font size in PDF points.
 * @param font - Font used to measure widths.
 * @returns Array of line strings (always at least one element).
 */
function wrapText(text: string, maxW: number, size: number, font: PDFFont): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let cur = "";
    for (const w of paragraph.split(/\s+/).filter(Boolean)) {
      const test = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= maxW) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [""];
}

/**
 * Parses the wordmark SVG into PDF vector paths, each with its enclosing
 * `<g transform="translate(0 Y)">` offset to re-apply after scaling.
 * @returns Parsed paths in source order.
 */
function parseWordmarkPaths(): LogoPath[] {
  const svgText = readFileSync(path.join(process.cwd(), "public/source/logo-wordmark.svg"), "utf8");
  const groupRe = /<g\s+transform="translate\(0\s+(-?\d+(?:\.\d+)?)\)">([\s\S]*?)<\/g>/g;
  const groupRanges: Array<{ start: number; end: number; ty: number }> = [];
  for (const m of svgText.matchAll(groupRe)) {
    const body = m[2] ?? "";
    const start = (m.index ?? 0) + m[0].indexOf(body);
    groupRanges.push({ start, end: start + body.length, ty: parseFloat(m[1] ?? "") });
  }
  const pathRe = /<path[^>]*\sfill="(#[0-9A-Fa-f]+)"[^>]*\sd="([^"]+)"[^>]*\/>/g;
  const paths: LogoPath[] = [];
  for (const m of svgText.matchAll(pathRe)) {
    const idx = m.index ?? 0;
    const insideGroup = groupRanges.find((g) => idx >= g.start && idx < g.end);
    paths.push({ fill: m[1] ?? "", d: m[2] ?? "", ty: insideGroup?.ty ?? 0 });
  }
  return paths;
}

/**
 * Serialises a Prisma Invoice row into the string-dated {@link Invoice} DTO. Fields are
 * mapped explicitly so a new schema column can't leak in unconverted.
 * @param inv - Prisma Invoice row.
 * @returns The Invoice DTO with ISO-string dates.
 */
export function serialiseInvoice(inv: PrismaInvoice): Invoice {
  return {
    id: inv.id,
    number: inv.number,
    clientName: inv.clientName,
    clientEmail: inv.clientEmail,
    issueDate: inv.issueDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    jobDate: inv.jobDate,
    replacesNumber: inv.replacesNumber,
    lineItems: inv.lineItems,
    gst: inv.gst,
    subtotal: inv.subtotal,
    gstAmount: inv.gstAmount,
    total: inv.total,
    promoTitle: inv.promoTitle,
    promoDiscount: inv.promoDiscount,
    promoNote: inv.promoNote,
    unsuccessful: inv.unsuccessful,
    unsuccessfulDiscount: inv.unsuccessfulDiscount,
    unsuccessfulNote: inv.unsuccessfulNote,
    goldCardPercent: inv.goldCardPercent,
    goldCardDiscount: inv.goldCardDiscount,
    status: inv.status,
    notes: inv.notes,
    contactId: inv.contactId,
    sentAt: inv.sentAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    voidedAt: inv.voidedAt?.toISOString() ?? null,
    paymentMethod: inv.paymentMethod,
    paymentReference: inv.paymentReference,
    alreadyPaid: inv.alreadyPaid,
    alreadyPaidMethod: inv.alreadyPaidMethod,
    isQuote: inv.isQuote,
    quoteValidUntil: inv.quoteValidUntil?.toISOString() ?? null,
    driveFileId: inv.driveFileId,
    driveWebUrl: inv.driveWebUrl,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

/**
 * Draws the diagonal QUOTE / PAID / VOID / OVERDUE watermark, first so everything sits on top.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 */
function drawStatusWatermark(ctx: PdfCtx, invoice: Invoice): void {
  // A quote always watermarks QUOTE, even voided (the status line says VOID).
  const isOverdue = !invoice.isQuote && isInvoiceOverdue(invoice);
  const text = invoice.isQuote
    ? "QUOTE"
    : invoice.status === "PAID"
      ? "PAID"
      : invoice.status === "VOIDED"
        ? "VOID"
        : isOverdue
          ? "OVERDUE"
          : null;
  if (!text) return;
  const colour = invoice.isQuote
    ? BRAND
    : invoice.status === "PAID"
      ? PAID_COLOUR
      : invoice.status === "VOIDED"
        ? VOID_COLOUR
        : OVERDUE_COLOUR;
  const size = 140;
  const width = ctx.bold.widthOfTextAtSize(text, size);
  // Offset the baseline-left anchor so the rotated text centres on the page.
  const angle = (-25 * Math.PI) / 180;
  const cx = width / 2;
  const cy = size * 0.35;
  const rx = cx * Math.cos(angle) - cy * Math.sin(angle);
  const ry = cx * Math.sin(angle) + cy * Math.cos(angle);
  ctx.page.drawText(text, {
    x: PAGE_W / 2 - rx,
    y: PAGE_H / 2 - ry,
    size,
    font: ctx.bold,
    color: colour,
    opacity: 0.12,
    rotate: degrees(-25),
  });
}

/**
 * Draws the header: wordmark on the left, title / number / status / GST# on the right.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param logoPaths - Pre-parsed wordmark vector paths.
 * @returns Y coordinate where the next section should start.
 */
function drawHeader(ctx: PdfCtx, invoice: Invoice, logoPaths: LogoPath[]): number {
  const logoScale = LOGO_H / LOGO_SVG_H;
  for (const p of logoPaths) {
    ctx.page.drawSvgPath(p.d, {
      x: MARGIN,
      y: HEADER_TOP + p.ty * logoScale,
      scale: logoScale,
      color: hexToRgb(p.fill),
      borderWidth: 0,
    });
  }

  const rightX = MARGIN + CONTENT_W;
  // IRD requires "Tax invoice" when GST-registered; a quote is never a tax document.
  const invTitle = invoice.isQuote ? "QUOTE" : ctx.identity.gstNumber ? "TAX INVOICE" : "INVOICE";
  let rightY = HEADER_TOP - 20;
  ctx.page.drawText(invTitle, {
    x: rightX - ctx.bold.widthOfTextAtSize(invTitle, 20),
    y: rightY,
    size: 20,
    font: ctx.bold,
    color: BRAND,
  });
  rightY -= 18;
  ctx.page.drawText(invoice.number, {
    x: rightX - ctx.font.widthOfTextAtSize(invoice.number, 12),
    y: rightY,
    size: 12,
    font: ctx.font,
    color: DARK,
  });
  if (invoice.replacesNumber) {
    rightY -= 14;
    const replaces = `Replaces ${invoice.replacesNumber}`;
    ctx.page.drawText(replaces, {
      x: rightX - ctx.font.widthOfTextAtSize(replaces, 10),
      y: rightY,
      size: 10,
      font: ctx.font,
      color: MID,
    });
  }
  // DRAFT/SENT are internal and never printed; only PAID, OVERDUE and VOID change what the
  // reader should do. Quotes show their validity date instead.
  const statusText = invoice.isQuote
    ? invoice.status === "VOIDED"
      ? "VOID"
      : invoice.quoteValidUntil
        ? `Valid until ${formatDateShort(invoice.quoteValidUntil)}`
        : "QUOTE"
    : invoice.status === "PAID"
      ? "PAID"
      : invoice.status === "VOIDED"
        ? "VOID"
        : isInvoiceOverdue(invoice)
          ? "OVERDUE"
          : null;
  const statusColour =
    invoice.status === "PAID"
      ? PAID_COLOUR
      : invoice.status === "VOIDED"
        ? VOID_COLOUR
        : invoice.isQuote
          ? BRAND
          : OVERDUE_COLOUR;
  // Skip the line when empty so the GST number moves up.
  if (statusText) {
    rightY -= 16;
    ctx.page.drawText(statusText, {
      x: rightX - ctx.bold.widthOfTextAtSize(statusText, 11),
      y: rightY,
      size: 11,
      font: ctx.bold,
      color: statusColour,
    });
  }
  if (ctx.identity.gstNumber) {
    rightY -= 15;
    const gstLine = `GST# ${ctx.identity.gstNumber}`;
    ctx.page.drawText(gstLine, {
      x: rightX - ctx.font.widthOfTextAtSize(gstLine, 10),
      y: rightY,
      size: 10,
      font: ctx.font,
      color: MID,
    });
  }

  return HEADER_TOP - LOGO_H - 28;
}

/**
 * Draws Bill-to on the left, Issued/Due dates on the right, then a separator line.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the block.
 * @returns Y coordinate for the next section.
 */
function drawBillToBlock(ctx: PdfCtx, invoice: Invoice, y: number): number {
  const infoY = y;
  ctx.page.drawText("BILL TO", {
    x: MARGIN,
    y: infoY,
    size: 9,
    font: ctx.bold,
    color: LIGHT,
  });
  ctx.page.drawText(invoice.clientName, {
    x: MARGIN,
    y: infoY - 16,
    size: 14,
    font: ctx.bold,
    color: DARK,
  });
  ctx.page.drawText(invoice.clientEmail, {
    x: MARGIN,
    y: infoY - 32,
    size: 12,
    font: ctx.font,
    color: MID,
  });

  /**
   * Draws one label/value row in the dates column at fixed x positions.
   * @param label - Field label (e.g. "Issued:").
   * @param val - Pre-formatted value.
   * @param dy - Vertical offset from infoY (negative = lower).
   */
  const drawDateRow = (label: string, val: string, dy: number): void => {
    ctx.page.drawText(label, {
      x: MARGIN + CONTENT_W * 0.55,
      y: infoY + dy,
      size: 12,
      font: ctx.font,
      color: MID,
    });
    ctx.page.drawText(val, {
      x: MARGIN + CONTENT_W * 0.72,
      y: infoY + dy,
      size: 12,
      font: ctx.bold,
      color: DARK,
    });
  };
  // The work date leads, so the invoice can be matched to the visit and its weekend or
  // holiday rates checked. A quote's work hasn't happened.
  let dy = 0;
  if (invoice.jobDate && !invoice.isQuote) {
    drawDateRow("Work done:", formatDateShort(invoice.jobDate), dy);
    dy -= 18;
  }
  drawDateRow("Issued:", formatDateShort(invoice.issueDate), dy);
  dy -= 18;
  if (invoice.isQuote) {
    // A quote has no due date; show how long its prices hold.
    if (invoice.quoteValidUntil) {
      drawDateRow("Valid to:", formatDateShort(invoice.quoteValidUntil), dy);
    }
  } else {
    drawDateRow("Due:", formatDateShort(invoice.dueDate), dy);
  }

  const sepY = infoY + Math.min(-48, dy - 18);
  ctx.page.drawLine({
    start: { x: MARGIN, y: sepY },
    end: { x: MARGIN + CONTENT_W, y: sepY },
    thickness: 0.5,
    color: LIGHT,
  });
  return sepY - 2;
}

/**
 * Draws the line-items table with wrapped descriptions and right-aligned numbers.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the table.
 * @returns Y coordinate below the bottom border, including the totals gap.
 */
function drawLineItemsTable(ctx: PdfCtx, invoice: Invoice, y: number): number {
  // Description 61%, Qty 15%, Unit price 11%, Total 13%. Qty fits "10 hr 55 min" at 11pt.
  const COL = {
    desc: MARGIN,
    qty: MARGIN + CONTENT_W * 0.61,
    price: MARGIN + CONTENT_W * 0.76,
    total: MARGIN + CONTENT_W * 0.87,
  };
  const ROW_H = 28;
  const HEADER_SIZE = 11;
  const CELL_SIZE = 11;

  /**
   * Draws the column headings and their brand rule; again at the top of a continuation page.
   * @param top - Top of the heading row.
   * @returns Where the first row starts.
   */
  const drawHeadings = (top: number): number => {
    // Description left-aligns; numeric headers centre over their right-aligned values.
    const headers = ["Description", "Qty", "Price", "Total"];
    const cols = [COL.desc, COL.qty, COL.price, COL.total];
    headers.forEach((h, i) => {
      const headerWidth = ctx.bold.widthOfTextAtSize(h, HEADER_SIZE);
      let x: number;
      if (i === 0) {
        x = cols[i]! + 4;
      } else {
        const colLeft = cols[i]!;
        const colRight = i + 1 < cols.length ? cols[i + 1]! : MARGIN + CONTENT_W;
        x = (colLeft + colRight) / 2 - headerWidth / 2;
      }
      ctx.page.drawText(h, {
        x,
        y: top - ROW_H + 9,
        size: HEADER_SIZE,
        font: ctx.bold,
        color: DARK,
      });
    });
    ctx.page.drawLine({
      start: { x: MARGIN, y: top - ROW_H },
      end: { x: MARGIN + CONTENT_W, y: top - ROW_H },
      thickness: 1.5,
      color: BRAND,
    });
    // Breather between the brand-coloured header line and the first row.
    return top - ROW_H - 6;
  };
  y = drawHeadings(y);

  const descMaxW = COL.qty - COL.desc - 8;
  const LINE_GAP = 14;
  invoice.lineItems.forEach((item, idx) => {
    const lines = wrapText(item.description, descMaxW, CELL_SIZE, ctx.font);
    const rowH = ROW_H + (lines.length - 1) * LINE_GAP;
    const page = ctx.page;
    y = ensureSpace(ctx, y, rowH);
    if (ctx.page !== page) y = drawHeadings(y);

    // Top-aligned: first description line baseline matches the numeric columns.
    const firstBaselineY = y - 10;
    lines.forEach((line, i) => {
      ctx.page.drawText(line, {
        x: COL.desc + 4,
        y: firstBaselineY - i * LINE_GAP,
        size: CELL_SIZE,
        font: ctx.font,
        color: DARK,
      });
    });

    const qtyStr = lineItemQtyLabel(item);
    ctx.page.drawText(qtyStr, {
      x: COL.price - ctx.font.widthOfTextAtSize(qtyStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: ctx.font,
      color: DARK,
    });

    const priceStr = formatNZD(item.unitPrice);
    ctx.page.drawText(priceStr, {
      x: COL.total - ctx.font.widthOfTextAtSize(priceStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: ctx.font,
      color: DARK,
    });

    const totalStr = formatNZD(item.lineTotal);
    ctx.page.drawText(totalStr, {
      x: MARGIN + CONTENT_W - ctx.font.widthOfTextAtSize(totalStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: ctx.bold,
      color: DARK,
    });

    y -= rowH;

    // Skip after the last row - the closing border handles that line.
    if (idx < invoice.lineItems.length - 1) {
      ctx.page.drawLine({
        start: { x: MARGIN, y },
        end: { x: MARGIN + CONTENT_W, y },
        thickness: 0.3,
        color: LIGHT,
      });
    }
  });

  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  return y - 40;
}

/** One step of the totals block, measured before drawing so the block never splits. */
type TotalsStep =
  | { kind: "row"; label: string; value: string; style?: "bold" | "promo" }
  | { kind: "note"; lines: string[] }
  | { kind: "rule" }
  | { kind: "lift" };

/**
 * Height a totals step moves the pen down by.
 * @param step - The step.
 * @returns Points; the lift before the paid rows is negative.
 */
function totalsStepHeight(step: TotalsStep): number {
  switch (step.kind) {
    case "row":
      return step.style === "bold" ? 26 : 19;
    case "note":
      return step.lines.length * 14;
    case "rule":
      return 12;
    case "lift":
      return -6;
  }
}

/**
 * Draws Subtotal, the discount and GST rows, a bold Total, then what's been paid.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the block.
 * @returns Y coordinate below the last row.
 */
function drawTotalsBlock(ctx: PdfCtx, invoice: Invoice, y: number): number {
  // Label area widened (0.4 > 0.6 of CONTENT_W) so long promo titles fit.
  const totalsLabelX = MARGIN + CONTENT_W * 0.4;
  const totalsValueX = MARGIN + CONTENT_W;
  const NOTE_SIZE = 10;
  /**
   * Wraps a note to the totals column.
   * @param text - The note.
   * @returns Its lines.
   */
  const noteLines = (text: string): string[] =>
    wrapText(text, totalsValueX - totalsLabelX, NOTE_SIZE, ctx.font);

  const steps: TotalsStep[] = [
    { kind: "row", label: "Subtotal", value: formatNZD(invoice.subtotal) },
  ];
  if (invoice.promoDiscount && invoice.promoDiscount > 0) {
    steps.push({
      kind: "row",
      label: promoLineLabel(invoice.promoTitle),
      value: `-${formatNZD(invoice.promoDiscount)}`,
      style: "promo",
    });
    if (invoice.promoNote) steps.push({ kind: "note", lines: noteLines(invoice.promoNote) });
  }
  // Promo, Gold Card, then unsuccessful: the order calcJobTotal takes them off.
  if (invoice.goldCardDiscount && invoice.goldCardDiscount > 0) {
    steps.push({
      kind: "row",
      label: goldCardLineLabel(invoice.goldCardPercent),
      value: `-${formatNZD(invoice.goldCardDiscount)}`,
      style: "promo",
    });
  }
  if (invoice.unsuccessfulDiscount && invoice.unsuccessfulDiscount > 0) {
    steps.push({
      kind: "row",
      label: UNSUCCESSFUL_LINE_LABEL,
      value: `-${formatNZD(invoice.unsuccessfulDiscount)}`,
      style: "promo",
    });
    if (invoice.unsuccessfulNote) {
      steps.push({ kind: "note", lines: noteLines(invoice.unsuccessfulNote) });
    }
  }
  // Gate on gstAmount, not the `gst` boolean, so the row appears once GST_REGISTERED flips.
  if (invoice.gstAmount > 0) {
    steps.push({ kind: "row", label: "Includes GST", value: formatNZD(invoice.gstAmount) });
    // IRD requires a GST number on the header when an invoice carries GST.
    if (!ctx.identity.gstNumber) {
      console.warn(
        "[invoice-pdf] Invoice has GST but no GST number is set in settings; the header will read 'INVOICE' instead of 'TAX INVOICE'.",
      );
    }
  }
  steps.push({ kind: "rule" });
  steps.push({ kind: "row", label: "Total", value: formatNZD(invoice.total), style: "bold" });
  // Money handed over on the day, the payment that cleared it, then what's left.
  const settled = settlementRows(invoice);
  if (settled.length > 0) {
    steps.push({ kind: "lift" });
    for (const row of settled) {
      if (row.bold) steps.push({ kind: "rule" });
      steps.push({
        kind: "row",
        label: row.label,
        value: row.value,
        style: row.bold ? "bold" : undefined,
      });
    }
  }

  y = ensureSpace(
    ctx,
    y,
    steps.reduce((h, s) => h + totalsStepHeight(s), 12),
  );
  for (const step of steps) {
    if (step.kind === "row") {
      // Truncate the label with an ellipsis before it runs into the value.
      const isBold = step.style === "bold";
      const isPromo = step.style === "promo";
      const f = isBold ? ctx.bold : ctx.font;
      const labelColour = isBold ? BRAND : isPromo ? AMBER : MID;
      const valueColour = isBold ? BRAND : isPromo ? AMBER : DARK;
      const labelSize = isBold ? 14 : 12;
      const valueSize = isBold ? 16 : 12;
      const valueX = totalsValueX - f.widthOfTextAtSize(step.value, valueSize);
      const labelMaxW = valueX - totalsLabelX - 12;
      let lbl = step.label;
      while (lbl.length > 1 && f.widthOfTextAtSize(lbl, labelSize) > labelMaxW) {
        lbl = lbl.slice(0, -1);
      }
      if (lbl !== step.label) lbl = lbl.slice(0, -1) + "…";
      ctx.page.drawText(lbl, { x: totalsLabelX, y, size: labelSize, font: f, color: labelColour });
      ctx.page.drawText(step.value, { x: valueX, y, size: valueSize, font: f, color: valueColour });
    } else if (step.kind === "note") {
      // The row already stepped 19pt down, so y + 4 sits 15pt below the row's baseline.
      step.lines.forEach((line, i) => {
        ctx.page.drawText(line, {
          x: totalsLabelX,
          y: y + 4 - i * 14,
          size: NOTE_SIZE,
          font: ctx.font,
          color: AMBER,
        });
      });
    } else if (step.kind === "rule") {
      ctx.page.drawLine({
        start: { x: totalsLabelX, y: y + 6 },
        end: { x: totalsValueX, y: y + 6 },
        thickness: 0.5,
        color: LIGHT,
      });
    }
    y -= totalsStepHeight(step);
  }

  return y - 12;
}

/** One line in a call-out box. */
interface CalloutLine {
  text: string;
  /** Point size; 12 when unset. */
  size?: number;
  bold?: boolean;
  /** Text colour; DARK when unset. */
  colour?: ReturnType<typeof rgb>;
}

/**
 * Draws a bordered call-out box: a heading, then its lines, wrapped to the box. Border-only
 * so the diagonal status watermark shows through cleanly.
 * @param ctx - PDF drawing context.
 * @param y - Top of the block.
 * @param heading - The box's heading.
 * @param lines - The lines under it.
 * @returns Y coordinate below the box, including the gap before notes.
 */
function drawCallout(ctx: PdfCtx, y: number, heading: string, lines: CalloutLine[]): number {
  const BOX_PAD_X = 14;
  const BOX_PAD_Y = 14;
  const lineH = 16;
  const wrapped = lines.flatMap((l) =>
    wrapText(l.text, CONTENT_W - BOX_PAD_X * 2, l.size ?? 12, l.bold ? ctx.bold : ctx.font).map(
      (text) => ({ ...l, text }),
    ),
  );
  // Heading cap height (10) and its taller step (22), the lines, and a descender (3), so the
  // padding reads the same above the heading and below the last line.
  const BOX_H = BOX_PAD_Y * 2 + 10 + 22 + (wrapped.length - 1) * lineH + 3;
  const boxTop = ensureSpace(ctx, y, BOX_H + 8) - 8;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: boxTop - BOX_H,
    width: CONTENT_W,
    height: BOX_H,
    borderColor: LIGHT,
    borderWidth: 0.8,
  });

  let by = boxTop - BOX_PAD_Y - 10;
  ctx.page.drawText(heading, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 14,
    font: ctx.bold,
    color: BRAND,
  });
  by -= 22;
  for (const line of wrapped) {
    ctx.page.drawText(line.text, {
      x: MARGIN + BOX_PAD_X,
      y: by,
      size: line.size ?? 12,
      font: line.bold ? ctx.bold : ctx.font,
      color: line.colour ?? DARK,
    });
    by -= lineH;
  }
  return boxTop - BOX_H - 14;
}

/**
 * Draws the "Bank transfer" box: payee, account, Particulars, Code and due date.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the block.
 * @returns Y coordinate below the box, including the gap before notes.
 */
function drawPaymentCallout(ctx: PdfCtx, invoice: Invoice, y: number): number {
  return drawCallout(ctx, y, "Bank transfer", [
    { text: `Payee: ${ctx.identity.name}` },
    { text: `Account: ${ctx.identity.bankAccount}`, size: 13, bold: true },
    // Particulars then Code, each inside the payer's 12-character field
    { text: `Particulars: ${bankParticulars(invoice.clientName)}`, bold: true },
    { text: `Code: ${bankCode(invoice.number)}`, bold: true },
    {
      text: `Due within ${ctx.identity.paymentTermsDays} days of issue (by ${formatDateShort(invoice.dueDate)}).`,
      colour: MID,
    },
  ]);
}

/**
 * Quote variant of the call-out box: how to accept, plus the validity line.
 * No bank details - payment comes with the invoice after acceptance.
 * @param ctx - PDF drawing context.
 * @param invoice - Quote being rendered.
 * @param y - Top of the block.
 * @returns Y coordinate below the box, including the gap before notes.
 */
function drawQuoteCallout(ctx: PdfCtx, invoice: Invoice, y: number): number {
  return drawCallout(ctx, y, "Accepting this quote", [
    { text: `Reply to the email or ring ${ctx.identity.phone} to go ahead.` },
    {
      text: invoice.quoteValidUntil
        ? `Prices are held until ${formatDateShort(invoice.quoteValidUntil)}.`
        : "Prices may change if the scope does - anything extra is agreed first.",
      colour: MID,
    },
  ]);
}

/**
 * Draws the operator-supplied notes, wrapped to the page width, onto further pages if long.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Baseline for the first line.
 */
function drawNotes(ctx: PdfCtx, invoice: Invoice, y: number): void {
  if (!invoice.notes) return;
  for (const line of wrapText(invoice.notes, CONTENT_W, 11, ctx.font)) {
    // A baseline only needs room for its descenders above the footer.
    y = ensureSpace(ctx, y, 4);
    ctx.page.drawText(line, { x: MARGIN, y, size: 11, font: ctx.font, color: MID });
    y -= 14;
  }
}

/**
 * Draws the sender-contact footer at a page's bottom under a thin border, with the page
 * number when the invoice runs past one page.
 * @param ctx - PDF drawing context.
 * @param page - The page to draw on.
 * @param pageNo - This page's number, from 1.
 * @param pageCount - Pages in the invoice.
 */
function drawFooter(ctx: PdfCtx, page: PDFPage, pageNo: number, pageCount: number): void {
  const FOOTER_Y = MARGIN + 14;
  page.drawLine({
    start: { x: MARGIN, y: FOOTER_Y + 14 },
    end: { x: MARGIN + CONTENT_W, y: FOOTER_Y + 14 },
    thickness: 0.5,
    color: LIGHT,
  });
  const footerLine = `${ctx.identity.email}  ·  ${ctx.identity.phone}  ·  ${ctx.identity.website}  ·  ${ctx.identity.location}`;
  const footerSize = 9;
  const footerW = ctx.font.widthOfTextAtSize(footerLine, footerSize);
  page.drawText(footerLine, {
    x: MARGIN + (CONTENT_W - footerW) / 2,
    y: FOOTER_Y,
    size: footerSize,
    font: ctx.font,
    color: MID,
  });
  if (pageCount > 1) {
    const label = `Page ${pageNo} of ${pageCount}`;
    page.drawText(label, {
      x: MARGIN + CONTENT_W - ctx.font.widthOfTextAtSize(label, footerSize),
      y: FOOTER_Y - 13,
      size: footerSize,
      font: ctx.font,
      color: MID,
    });
  }
}

/**
 * Generates the A4 PDF for an invoice or quote.
 * @param invoice - The invoice record to render.
 * @param identity - Business identity to print; the live settings when omitted. The fixture
 *   check passes the defaults, since live settings need a request.
 * @returns PDF content as a Buffer.
 */
export async function generateInvoicePdf(
  invoice: Invoice,
  identity?: IdentitySettings,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const fonts = loadFontBytes();
  const font = await doc.embedFont(fonts.regular);
  const bold = await doc.embedFont(fonts.bold);
  const ctx: PdfCtx = {
    doc,
    page,
    font,
    bold,
    identity: identity ?? (await getIdentity()),
    invoice,
  };
  const logoPaths = parseWordmarkPaths();

  drawStatusWatermark(ctx, invoice);
  let y = drawHeader(ctx, invoice, logoPaths);
  y = drawBillToBlock(ctx, invoice, y);
  y = drawLineItemsTable(ctx, invoice, y);
  y = drawTotalsBlock(ctx, invoice, y);
  // A paid or voided invoice asks for nothing, so its box says so instead of the bank details.
  const settled = settledCallout(invoice);
  if (invoice.isQuote) y = drawQuoteCallout(ctx, invoice, y);
  else if (settled) y = drawCallout(ctx, y, settled.heading, [{ text: settled.text }]);
  else y = drawPaymentCallout(ctx, invoice, y);
  drawNotes(ctx, invoice, y);
  const pages = doc.getPages();
  pages.forEach((p, i) => drawFooter(ctx, p, i + 1, pages.length));

  return Buffer.from(await doc.save());
}

/**
 * Extracts the fiscal year code from an invoice number ("TTP-2627-0042" > "2627"), falling
 * back to the current fiscal year.
 * @param invoiceNumber - Invoice number string.
 * @returns Two-digit fiscal year code (e.g. "2627").
 */
export function extractYearCode(invoiceNumber: string): string {
  const m = invoiceNumber.match(/^[A-Z]+-(\d{4,6})-/);
  if (m?.[1]) return m[1];
  return nzFinancialYearCode();
}
