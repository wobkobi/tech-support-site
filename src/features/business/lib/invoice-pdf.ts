import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts, degrees } from "pdf-lib";
import path from "path";
import { readFileSync } from "fs";
import type { Invoice } from "@/features/business/types/business";
import {
  BUSINESS,
  BUSINESS_BANK_ACCOUNT,
  BUSINESS_GST_NUMBER,
  BUSINESS_PAYMENT_TERMS_DAYS,
} from "@/shared/lib/business-identity";
import { formatDateShort } from "@/shared/lib/date-format";

// Colours mirror the web's Tailwind palette so the PDF reads as the same document.
const BRAND = rgb(12 / 255, 10 / 255, 62 / 255); // russian-violet #0c0a3e
const DARK = rgb(30 / 255, 41 / 255, 59 / 255); // slate-800 #1e293b
const MID = rgb(100 / 255, 116 / 255, 139 / 255); // slate-500 #64748b
const LIGHT = rgb(203 / 255, 213 / 255, 225 / 255); // slate-300 #cbd5e1
const ROW_ALT = rgb(248 / 255, 250 / 255, 252 / 255); // slate-50 #f8fafc
const AMBER = rgb(180 / 255, 83 / 255, 9 / 255); // amber-700 #b45309 (matches web promo)
const WHITE = rgb(1, 1, 1);
const PAID_COLOR = rgb(0.1, 0.55, 0.25);
const OVERDUE_COLOR = rgb(0.78, 0.16, 0.16);

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

const LOGO_SVG_H = 674;
const LOGO_H = 90;
const HEADER_TOP = PAGE_H - MARGIN;

interface PdfCtx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

interface LogoPath {
  fill: string;
  d: string;
  ty: number;
}

/**
 * Formats a number as a NZD dollar string with the sign before the dollar.
 * @param n - Amount to format (positive or negative).
 * @returns Formatted string like "$12.50" or "-$12.50".
 */
function fmt(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Converts a CSS hex color (e.g. "#0B093D") into pdf-lib's rgb() colour.
 * @param hex - Hex colour with leading #.
 * @returns pdf-lib RGB colour.
 */
function hexToRgb(hex: string): ReturnType<typeof rgb> {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/**
 * Greedy word-wrap: packs words into lines that fit within maxW at fontSize.
 * @param text - Source string to wrap.
 * @param maxW - Maximum line width in PDF points.
 * @param size - Font size in PDF points.
 * @param font - Font used to measure widths.
 * @returns Array of line strings (always at least one element).
 */
function wrapText(text: string, maxW: number, size: number, font: PDFFont): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * Parses the wordmark SVG into a list of native PDF vector paths. The source
 * has two sections: chip body/tabs and a `<g transform="translate(0 10)">`
 * wrapper around text+separator. Each path tracks the Y offset its enclosing
 * group applied so the orchestrator can re-apply it after scaling.
 * @returns Parsed paths in source order.
 */
function parseWordmarkPaths(): LogoPath[] {
  const svgText = readFileSync(path.join(process.cwd(), "public/source/logo-wordmark.svg"), "utf8");
  const groupRe = /<g\s+transform="translate\(0\s+(-?\d+(?:\.\d+)?)\)">([\s\S]*?)<\/g>/g;
  const groupRanges: Array<{ start: number; end: number; ty: number }> = [];
  for (const m of svgText.matchAll(groupRe)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[2]);
    groupRanges.push({ start, end: start + m[2].length, ty: parseFloat(m[1]) });
  }
  const pathRe = /<path[^>]*\sfill="(#[0-9A-Fa-f]+)"[^>]*\sd="([^"]+)"[^>]*\/>/g;
  const paths: LogoPath[] = [];
  for (const m of svgText.matchAll(pathRe)) {
    const idx = m.index ?? 0;
    const insideGroup = groupRanges.find((g) => idx >= g.start && idx < g.end);
    paths.push({ fill: m[1], d: m[2], ty: insideGroup?.ty ?? 0 });
  }
  return paths;
}

/**
 * Draws the diagonal PAID / OVERDUE watermark. Painted first so subsequent
 * sections sit on top of it. No-op when the invoice is in a neutral state.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 */
function drawStatusWatermark(ctx: PdfCtx, invoice: Invoice): void {
  const dueDate = new Date(invoice.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = invoice.status === "SENT" && dueDate < today;
  const text = invoice.status === "PAID" ? "PAID" : isOverdue ? "OVERDUE" : null;
  if (!text) return;
  const color = invoice.status === "PAID" ? PAID_COLOR : OVERDUE_COLOR;
  const size = 140;
  const width = ctx.bold.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, {
    x: PAGE_W / 2 - (width / 2) * 0.87, // adjust for rotation pivot
    y: PAGE_H / 2 - 80,
    size,
    font: ctx.bold,
    color,
    opacity: 0.12,
    rotate: degrees(-25),
  });
}

/**
 * Draws the page header: wordmark vector logo on the left and the
 * invoice-number / status / GST# block on the right.
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
  // NZ IRD requires "Tax invoice" wording when GST-registered. GST# env presence = registered.
  const invTitle = BUSINESS_GST_NUMBER ? "TAX INVOICE" : "INVOICE";
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
  rightY -= 16;
  const statusColor =
    invoice.status === "PAID" ? PAID_COLOR : invoice.status === "SENT" ? rgb(0.1, 0.35, 0.75) : MID;
  ctx.page.drawText(invoice.status, {
    x: rightX - ctx.bold.widthOfTextAtSize(invoice.status, 11),
    y: rightY,
    size: 11,
    font: ctx.bold,
    color: statusColor,
  });
  if (BUSINESS_GST_NUMBER) {
    rightY -= 15;
    const gstLine = `GST# ${BUSINESS_GST_NUMBER}`;
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
 * Draws the Bill-to column on the left and the Issued/Due dates column on the
 * right, followed by a thin separator line.
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
   * Draws one label/value row in the dates column, right-aligned to a fixed
   * x position so issued/due rows line up.
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
  drawDateRow("Issued:", formatDateShort(invoice.issueDate), 0);
  drawDateRow("Due:", formatDateShort(invoice.dueDate), -18);

  const sepY = infoY - 48;
  ctx.page.drawLine({
    start: { x: MARGIN, y: sepY },
    end: { x: MARGIN + CONTENT_W, y: sepY },
    thickness: 0.5,
    color: LIGHT,
  });
  return sepY - 2;
}

/**
 * Draws the line-items table: header row, body rows with word-wrapped
 * descriptions and right-aligned numeric columns, then a thin bottom border.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the table.
 * @returns Y coordinate below the bottom border, including the totals gap.
 */
function drawLineItemsTable(ctx: PdfCtx, invoice: Invoice, y: number): number {
  // Description 67%, Qty 9%, Unit price 11%, Total 13%.
  const COL = {
    desc: MARGIN,
    qty: MARGIN + CONTENT_W * 0.67,
    price: MARGIN + CONTENT_W * 0.76,
    total: MARGIN + CONTENT_W * 0.87,
  };
  const ROW_H = 28;
  const HEADER_SIZE = 11;
  const CELL_SIZE = 11;

  // Clean header (no coloured bar): bold dark text on white with a 1.5pt brand-coloured
  // bottom border. Description left-aligns; numeric headers centre in their column so they
  // sit as a label above the right-aligned values without left-edge mismatch.
  const headers = ["Description", "Qty", "Price", "Total"];
  const cols = [COL.desc, COL.qty, COL.price, COL.total];
  headers.forEach((h, i) => {
    const headerWidth = ctx.bold.widthOfTextAtSize(h, HEADER_SIZE);
    let x: number;
    if (i === 0) {
      x = cols[i] + 4;
    } else {
      const colLeft = cols[i];
      const colRight = i + 1 < cols.length ? cols[i + 1] : MARGIN + CONTENT_W;
      x = (colLeft + colRight) / 2 - headerWidth / 2;
    }
    ctx.page.drawText(h, { x, y: y - ROW_H + 9, size: HEADER_SIZE, font: ctx.bold, color: DARK });
  });
  ctx.page.drawLine({
    start: { x: MARGIN, y: y - ROW_H },
    end: { x: MARGIN + CONTENT_W, y: y - ROW_H },
    thickness: 1.5,
    color: BRAND,
  });
  y -= ROW_H;

  const descMaxW = COL.qty - COL.desc - 8;
  const LINE_GAP = 14;
  invoice.lineItems.forEach((item, idx) => {
    const lines = wrapText(item.description, descMaxW, CELL_SIZE, ctx.font);
    const rowH = ROW_H + (lines.length - 1) * LINE_GAP;
    const bg = idx % 2 === 1 ? ROW_ALT : WHITE;
    ctx.page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: bg });

    // Top-aligned: first description line baseline matches qty/price/total baseline.
    // Baseline at y - 10 puts the text cap height ~2pt below the row top (tight top align).
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

    const qtyStr = String(item.qty);
    ctx.page.drawText(qtyStr, {
      x: COL.price - ctx.font.widthOfTextAtSize(qtyStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: ctx.font,
      color: DARK,
    });

    const priceStr = fmt(item.unitPrice);
    ctx.page.drawText(priceStr, {
      x: COL.total - ctx.font.widthOfTextAtSize(priceStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: ctx.font,
      color: DARK,
    });

    const totalStr = fmt(item.lineTotal);
    ctx.page.drawText(totalStr, {
      x: MARGIN + CONTENT_W - ctx.font.widthOfTextAtSize(totalStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: ctx.bold,
      color: DARK,
    });

    y -= rowH;
  });

  ctx.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  return y - 40;
}

/**
 * Draws the totals block: Subtotal, optional promo line, optional GST, and a
 * bold final Total. Long labels are auto-truncated so they never overlap the
 * right-aligned value column.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the block.
 * @returns Y coordinate below the Total row.
 */
function drawTotalsBlock(ctx: PdfCtx, invoice: Invoice, y: number): number {
  // Label area widened (0.4 → 0.6 of CONTENT_W) so long promo titles fit.
  const totalsLabelX = MARGIN + CONTENT_W * 0.4;
  const totalsValueX = MARGIN + CONTENT_W;

  /**
   * Draws one totals row, label on the left and right-aligned value on the
   * right. Truncates the label with an ellipsis if it would otherwise overlap
   * the value column.
   * @param label - Row label (e.g. "Subtotal").
   * @param value - Pre-formatted value string (e.g. "$120.00").
   * @param opts - Variant flags.
   * @param opts.isBold - Renders in bold brand-violet (used for the final Total).
   * @param opts.isPromo - Renders in amber to match the web promo styling.
   */
  const drawRow = (
    label: string,
    value: string,
    opts: { isBold?: boolean; isPromo?: boolean } = {},
  ): void => {
    const isBold = opts.isBold ?? false;
    const isPromo = opts.isPromo ?? false;
    const f = isBold ? ctx.bold : ctx.font;
    const labelColor = isBold ? BRAND : isPromo ? AMBER : MID;
    const valueColor = isBold ? BRAND : isPromo ? AMBER : DARK;
    const labelSize = isBold ? 14 : 12;
    const valueSize = isBold ? 16 : 12;
    const valueWidth = f.widthOfTextAtSize(value, valueSize);
    const valueX = totalsValueX - valueWidth;
    const labelMaxW = valueX - totalsLabelX - 12;
    let lbl = label;
    while (lbl.length > 1 && f.widthOfTextAtSize(lbl, labelSize) > labelMaxW) {
      lbl = lbl.slice(0, -1);
    }
    if (lbl !== label) lbl = lbl.slice(0, -1) + "…";
    ctx.page.drawText(lbl, { x: totalsLabelX, y, size: labelSize, font: f, color: labelColor });
    ctx.page.drawText(value, { x: valueX, y, size: valueSize, font: f, color: valueColor });
    y -= isBold ? 26 : 19;
  };

  drawRow("Subtotal", fmt(invoice.subtotal));
  // Promo discount line (snapshot fields keep historical totals stable; amber matches web).
  if (invoice.promoDiscount && invoice.promoDiscount > 0) {
    // Label suffix clarifies the discount only applies to labor lines, never
    // travel or parts - matches how computeJobPromoDiscount actually works.
    const label = invoice.promoTitle
      ? `Promo (labor only): ${invoice.promoTitle}`
      : "Promo discount (labor only)";
    drawRow(label, `-${fmt(invoice.promoDiscount)}`, { isPromo: true });
  }
  if (invoice.gst) drawRow("GST (15%)", fmt(invoice.gstAmount));
  ctx.page.drawLine({
    start: { x: totalsLabelX, y: y + 6 },
    end: { x: totalsValueX, y: y + 6 },
    thickness: 0.5,
    color: LIGHT,
  });
  // Push Total below the divider - bold 14pt text would otherwise overlap the line.
  y -= 12;
  drawRow("Total", fmt(invoice.total), { isBold: true });

  return y - 12;
}

/**
 * Draws the tinted "Bank transfer" call-out box with payee, account, reference,
 * and due date. Sized to its fixed 5-line content so callers don't need to know
 * its height up-front.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Top of the block.
 * @returns Y coordinate below the box, including the gap before notes.
 */
function drawPaymentCallout(ctx: PdfCtx, invoice: Invoice, y: number): number {
  const boxTop = y - 8;
  const BOX_PAD_X = 14;
  const BOX_PAD_Y = 14;
  const lineH = 16;
  const boxLines = 5; // heading + payee + account + reference + due-by
  const BOX_H = BOX_PAD_Y * 2 + 22 + (boxLines - 1) * lineH; // heading taller than rows
  const BOX_TINT = rgb(0.97, 0.97, 0.99); // very pale violet wash
  ctx.page.drawRectangle({
    x: MARGIN,
    y: boxTop - BOX_H,
    width: CONTENT_W,
    height: BOX_H,
    color: BOX_TINT,
    borderColor: rgb(0.85, 0.85, 0.93),
    borderWidth: 0.6,
  });

  let by = boxTop - BOX_PAD_Y - 2;
  ctx.page.drawText("Bank transfer", {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 14,
    font: ctx.bold,
    color: BRAND,
  });
  by -= 22;
  ctx.page.drawText(`Payee: ${BUSINESS.name}`, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 12,
    font: ctx.font,
    color: DARK,
  });
  by -= lineH;
  ctx.page.drawText(`Account: ${BUSINESS_BANK_ACCOUNT}`, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 13,
    font: ctx.bold,
    color: DARK,
  });
  by -= lineH;
  ctx.page.drawText(`Reference: ${invoice.number}`, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 12,
    font: ctx.bold,
    color: DARK,
  });
  by -= lineH;
  ctx.page.drawText(
    `Due within ${BUSINESS_PAYMENT_TERMS_DAYS} days of issue (by ${formatDateShort(invoice.dueDate)}).`,
    {
      x: MARGIN + BOX_PAD_X,
      y: by,
      size: 12,
      font: ctx.font,
      color: MID,
    },
  );
  return boxTop - BOX_H - 14;
}

/**
 * Draws the operator-supplied notes line, if any. Wraps to the page width.
 * @param ctx - PDF drawing context.
 * @param invoice - Invoice being rendered.
 * @param y - Baseline for the notes text.
 */
function drawNotes(ctx: PdfCtx, invoice: Invoice, y: number): void {
  if (!invoice.notes) return;
  ctx.page.drawText(invoice.notes, {
    x: MARGIN,
    y,
    size: 11,
    font: ctx.font,
    color: MID,
    maxWidth: CONTENT_W,
  });
}

/**
 * Draws the sender-contact footer anchored to the page bottom with a page-wide
 * thin top border above it.
 * @param ctx - PDF drawing context.
 */
function drawFooter(ctx: PdfCtx): void {
  const FOOTER_Y = MARGIN + 14;
  ctx.page.drawLine({
    start: { x: MARGIN, y: FOOTER_Y + 14 },
    end: { x: MARGIN + CONTENT_W, y: FOOTER_Y + 14 },
    thickness: 0.5,
    color: LIGHT,
  });
  const footerLine = `${BUSINESS.email}  ·  ${BUSINESS.phone}  ·  ${BUSINESS.website}  ·  ${BUSINESS.location}`;
  const footerSize = 9;
  const footerW = ctx.font.widthOfTextAtSize(footerLine, footerSize);
  ctx.page.drawText(footerLine, {
    x: MARGIN + (CONTENT_W - footerW) / 2,
    y: FOOTER_Y,
    size: footerSize,
    font: ctx.font,
    color: MID,
  });
}

/**
 * Generates a clean professional A4 PDF for the given invoice using pdf-lib.
 * Header is the wordmark logo on the left and the INVOICE/TAX INVOICE title,
 * number, status, and optional GST# on the right. The PAID/OVERDUE watermark
 * sits underneath as a functional status indicator.
 * @param invoice - The invoice record to render.
 * @returns PDF content as a Buffer.
 */
export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const ctx: PdfCtx = { page, font, bold };
  const logoPaths = parseWordmarkPaths();

  drawStatusWatermark(ctx, invoice);
  let y = drawHeader(ctx, invoice, logoPaths);
  y = drawBillToBlock(ctx, invoice, y);
  y = drawLineItemsTable(ctx, invoice, y);
  y = drawTotalsBlock(ctx, invoice, y);
  y = drawPaymentCallout(ctx, invoice, y);
  drawNotes(ctx, invoice, y);
  drawFooter(ctx);

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

/**
 * Extracts the fiscal year code from an invoice number (e.g. "TTP-2627-0042" -> "2627").
 * Falls back to deriving the current fiscal year if the number doesn't match.
 * @param invoiceNumber - Invoice number string.
 * @returns Two-digit fiscal year code (e.g. "2627").
 */
export function extractYearCode(invoiceNumber: string): string {
  const m = invoiceNumber.match(/^[A-Z]+-(\d{4,6})-/);
  if (m) return m[1];
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return String(fy) + String(fy + 1).slice(2);
}
