import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
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

/**
 * Formats a number as a NZD dollar string with the sign before the dollar.
 * @param n - Amount to format (positive or negative).
 * @returns Formatted string like "$12.50" or "-$12.50".
 */
function fmt(n: number): string {
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Generates a clean professional A4 PDF for the given invoice using pdf-lib.
 * Header is a small chip logo + business name; the right side carries the
 * INVOICE/TAX INVOICE title, number, status, and optional GST#. The PAID/OVERDUE
 * watermark sits underneath as a functional status indicator.
 * @param invoice - The invoice record to render.
 * @returns PDF content as a Buffer.
 */
export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // --- Parse wordmark SVG into native PDF vector paths (no rasterization, scales infinitely).
  // The source has two sections: chip body/tabs + a <g transform="translate(0 10)"> wrapper
  // around text+separator. We pull out fill + d for each path and remember which ones live
  // inside the translate group. ---
  const svgText = readFileSync(path.join(process.cwd(), "public/source/logo-wordmark.svg"), "utf8");
  const logoSvgH = 674;
  interface LogoPath {
    fill: string;
    d: string;
    ty: number;
  }
  const logoPaths: LogoPath[] = [];
  const groupRe = /<g\s+transform="translate\(0\s+(-?\d+(?:\.\d+)?)\)">([\s\S]*?)<\/g>/g;
  const groupRanges: Array<{ start: number; end: number; ty: number }> = [];
  for (const m of svgText.matchAll(groupRe)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[2]);
    groupRanges.push({ start, end: start + m[2].length, ty: parseFloat(m[1]) });
  }
  const pathRe = /<path[^>]*\sfill="(#[0-9A-Fa-f]+)"[^>]*\sd="([^"]+)"[^>]*\/>/g;
  for (const m of svgText.matchAll(pathRe)) {
    const idx = m.index ?? 0;
    const insideGroup = groupRanges.find((g) => idx >= g.start && idx < g.end);
    logoPaths.push({ fill: m[1], d: m[2], ty: insideGroup?.ty ?? 0 });
  }
  /**
   * Converts a CSS hex color (e.g. "#0B093D") into pdf-lib's rgb() colour.
   * @param hex - Hex colour with leading #.
   * @returns pdf-lib RGB colour.
   */
  const hexToRgb = (hex: string): ReturnType<typeof rgb> => {
    const n = parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
  };

  // --- Status watermark (PAID green / OVERDUE red), drawn first so it's underneath ---
  const dueDate = new Date(invoice.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = invoice.status === "SENT" && dueDate < today;
  const watermarkText = invoice.status === "PAID" ? "PAID" : isOverdue ? "OVERDUE" : null;
  if (watermarkText) {
    const wmColor = invoice.status === "PAID" ? PAID_COLOR : OVERDUE_COLOR;
    const wmSize = 140;
    const wmWidth = bold.widthOfTextAtSize(watermarkText, wmSize);
    page.drawText(watermarkText, {
      x: PAGE_W / 2 - (wmWidth / 2) * 0.87, // adjust for rotation pivot
      y: PAGE_H / 2 - 80,
      size: wmSize,
      font: bold,
      color: wmColor,
      opacity: 0.12,
      rotate: degrees(-25),
    });
  }

  // --- Header: full wordmark (left), invoice block (right) ---
  const HEADER_TOP = PAGE_H - MARGIN;
  const LOGO_H = 90;
  const logoScale = LOGO_H / logoSvgH;
  // Each SVG path is drawn as a native PDF vector. Scale via `scale`, position the
  // origin at the wordmark's top-left, and flip the Y axis (SVG is Y-down, PDF is Y-up).
  const logoOriginX = MARGIN;
  const logoOriginY = HEADER_TOP;
  for (const p of logoPaths) {
    page.drawSvgPath(p.d, {
      x: logoOriginX,
      y: logoOriginY + p.ty * logoScale,
      scale: logoScale,
      color: hexToRgb(p.fill),
      borderWidth: 0,
    });
  }

  let y = HEADER_TOP - LOGO_H - 28;

  // --- Invoice number + status block (right-aligned, aligned with the header) ---
  const statusColor =
    invoice.status === "PAID" ? PAID_COLOR : invoice.status === "SENT" ? rgb(0.1, 0.35, 0.75) : MID;

  const rightX = MARGIN + CONTENT_W;

  // NZ IRD requires "Tax invoice" wording when GST-registered. GST# env presence = registered.
  const invTitle = BUSINESS_GST_NUMBER ? "TAX INVOICE" : "INVOICE";
  let rightY = HEADER_TOP - 20;
  page.drawText(invTitle, {
    x: rightX - bold.widthOfTextAtSize(invTitle, 20),
    y: rightY,
    size: 20,
    font: bold,
    color: BRAND,
  });
  rightY -= 18;

  page.drawText(invoice.number, {
    x: rightX - font.widthOfTextAtSize(invoice.number, 12),
    y: rightY,
    size: 12,
    font,
    color: DARK,
  });
  rightY -= 16;

  page.drawText(invoice.status, {
    x: rightX - bold.widthOfTextAtSize(invoice.status, 11),
    y: rightY,
    size: 11,
    font: bold,
    color: statusColor,
  });

  // GST# below the status pill for IRD validation.
  if (BUSINESS_GST_NUMBER) {
    rightY -= 15;
    const gstLine = `GST# ${BUSINESS_GST_NUMBER}`;
    page.drawText(gstLine, {
      x: rightX - font.widthOfTextAtSize(gstLine, 10),
      y: rightY,
      size: 10,
      font,
      color: MID,
    });
  }

  // --- Bill to + dates block (2 cols), positioned below the header row ---
  const infoY = y;
  page.drawText("BILL TO", {
    x: MARGIN,
    y: infoY,
    size: 9,
    font: bold,
    color: LIGHT,
  });
  page.drawText(invoice.clientName, {
    x: MARGIN,
    y: infoY - 16,
    size: 14,
    font: bold,
    color: DARK,
  });
  page.drawText(invoice.clientEmail, {
    x: MARGIN,
    y: infoY - 32,
    size: 12,
    font,
    color: MID,
  });

  /**
   * Draws a right-aligned label/value pair in the dates column at the given vertical offset.
   * @param label - Field label text
   * @param val - Field value text
   * @param dy - Vertical offset from the base infoY position
   */
  const dateLabel = (label: string, val: string, dy: number): void => {
    page.drawText(label, {
      x: MARGIN + CONTENT_W * 0.55,
      y: infoY + dy,
      size: 12,
      font,
      color: MID,
    });
    page.drawText(val, {
      x: MARGIN + CONTENT_W * 0.72,
      y: infoY + dy,
      size: 12,
      font: bold,
      color: DARK,
    });
  };
  dateLabel("Issued:", formatDateShort(invoice.issueDate), 0);
  dateLabel("Due:", formatDateShort(invoice.dueDate), -18);

  y = infoY - 48;

  // --- Separator ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 2;

  // --- Table header ---
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
    const headerWidth = bold.widthOfTextAtSize(h, HEADER_SIZE);
    let x: number;
    if (i === 0) {
      x = cols[i] + 4;
    } else {
      const colLeft = cols[i];
      const colRight = i + 1 < cols.length ? cols[i + 1] : MARGIN + CONTENT_W;
      x = (colLeft + colRight) / 2 - headerWidth / 2;
    }
    page.drawText(h, { x, y: y - ROW_H + 9, size: HEADER_SIZE, font: bold, color: DARK });
  });
  page.drawLine({
    start: { x: MARGIN, y: y - ROW_H },
    end: { x: MARGIN + CONTENT_W, y: y - ROW_H },
    thickness: 1.5,
    color: BRAND,
  });
  y -= ROW_H;

  // --- Line item rows (descriptions wrap to multiple lines as needed) ---
  const descMaxW = COL.qty - COL.desc - 8;
  const LINE_GAP = 14;
  /**
   * Greedy word-wrap: packs words into lines that fit within maxW at fontSize.
   * @param text - Source string to wrap.
   * @param maxW - Maximum line width in PDF points.
   * @param size - Font size in PDF points.
   * @returns Array of line strings (always at least one element).
   */
  const wrapText = (text: string, maxW: number, size: number): string[] => {
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
  };

  invoice.lineItems.forEach((item, idx) => {
    const lines = wrapText(item.description, descMaxW, CELL_SIZE);
    const rowH = ROW_H + (lines.length - 1) * LINE_GAP;
    const bg = idx % 2 === 1 ? ROW_ALT : WHITE;
    page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: bg });

    // Top-aligned: first description line baseline matches qty/price/total baseline.
    // Baseline at y - 10 puts the text cap height ~2pt below the row top (tight top align).
    const firstBaselineY = y - 10;
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: COL.desc + 4,
        y: firstBaselineY - i * LINE_GAP,
        size: CELL_SIZE,
        font,
        color: DARK,
      });
    });

    const qtyStr = String(item.qty);
    page.drawText(qtyStr, {
      x: COL.price - font.widthOfTextAtSize(qtyStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font,
      color: DARK,
    });

    const priceStr = fmt(item.unitPrice);
    page.drawText(priceStr, {
      x: COL.total - font.widthOfTextAtSize(priceStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font,
      color: DARK,
    });

    const totalStr = fmt(item.lineTotal);
    page.drawText(totalStr, {
      x: MARGIN + CONTENT_W - font.widthOfTextAtSize(totalStr, CELL_SIZE) - 4,
      y: firstBaselineY,
      size: CELL_SIZE,
      font: bold,
      color: DARK,
    });

    y -= rowH;
  });

  // --- Bottom table border ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 40;

  // --- Totals block (right-aligned) ---
  // Label area widened (0.4 → 0.6 of CONTENT_W) so long promo titles fit.
  const totalsLabelX = MARGIN + CONTENT_W * 0.4;
  const totalsValueX = MARGIN + CONTENT_W;

  /**
   * Draws a totals row with label on the left and right-aligned value.
   * Truncates the label with an ellipsis if it would otherwise overlap the value.
   * @param label - Row label (e.g. "Subtotal")
   * @param value - Formatted value string (e.g. "$120.00")
   * @param opts - Variant flags object.
   * @param opts.isBold - When true, renders in bold brand-violet (used for the final Total row).
   * @param opts.isPromo - When true, renders in amber to match the web promo styling.
   */
  const drawTotalRow = (
    label: string,
    value: string,
    opts: { isBold?: boolean; isPromo?: boolean } = {},
  ): void => {
    const isBold = opts.isBold ?? false;
    const isPromo = opts.isPromo ?? false;
    const f = isBold ? bold : font;
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
    page.drawText(lbl, { x: totalsLabelX, y, size: labelSize, font: f, color: labelColor });
    page.drawText(value, { x: valueX, y, size: valueSize, font: f, color: valueColor });
    y -= isBold ? 26 : 19;
  };

  drawTotalRow("Subtotal", fmt(invoice.subtotal));
  // Promo discount line (snapshot fields keep historical totals stable; amber matches web).
  if (invoice.promoDiscount && invoice.promoDiscount > 0) {
    // Label suffix clarifies the discount only applies to labor lines, never
    // travel or parts - matches how computeJobPromoDiscount actually works.
    const label = invoice.promoTitle
      ? `Promo (labor only): ${invoice.promoTitle}`
      : "Promo discount (labor only)";
    drawTotalRow(label, `-${fmt(invoice.promoDiscount)}`, { isPromo: true });
  }
  if (invoice.gst) drawTotalRow("GST (15%)", fmt(invoice.gstAmount));
  page.drawLine({
    start: { x: totalsLabelX, y: y + 6 },
    end: { x: totalsValueX, y: y + 6 },
    thickness: 0.5,
    color: LIGHT,
  });
  // Push Total below the divider — bold 14pt text would otherwise overlap the line.
  y -= 12;
  drawTotalRow("Total", fmt(invoice.total), { isBold: true });

  y -= 12;

  // --- Bank transfer call-out (tinted box so it reads as the actual CTA) ---
  y -= 8;
  const boxTop = y;
  const BOX_PAD_X = 14;
  const BOX_PAD_Y = 14;
  const lineH = 16;
  const boxLines = 5; // heading + payee + account + reference + due-by
  const BOX_H = BOX_PAD_Y * 2 + 22 + (boxLines - 1) * lineH; // heading taller than rows
  const BOX_TINT = rgb(0.97, 0.97, 0.99); // very pale violet wash
  page.drawRectangle({
    x: MARGIN,
    y: boxTop - BOX_H,
    width: CONTENT_W,
    height: BOX_H,
    color: BOX_TINT,
    borderColor: rgb(0.85, 0.85, 0.93),
    borderWidth: 0.6,
  });

  let by = boxTop - BOX_PAD_Y - 2;
  page.drawText("Bank transfer", {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 14,
    font: bold,
    color: BRAND,
  });
  by -= 22;
  page.drawText(`Payee: ${BUSINESS.name}`, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 12,
    font,
    color: DARK,
  });
  by -= lineH;
  page.drawText(`Account: ${BUSINESS_BANK_ACCOUNT}`, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 13,
    font: bold,
    color: DARK,
  });
  by -= lineH;
  page.drawText(`Reference: ${invoice.number}`, {
    x: MARGIN + BOX_PAD_X,
    y: by,
    size: 12,
    font: bold,
    color: DARK,
  });
  by -= lineH;
  page.drawText(
    `Due within ${BUSINESS_PAYMENT_TERMS_DAYS} days of issue (by ${formatDateShort(invoice.dueDate)}).`,
    {
      x: MARGIN + BOX_PAD_X,
      y: by,
      size: 12,
      font,
      color: MID,
    },
  );
  y = boxTop - BOX_H - 14;

  // --- Notes ---
  if (invoice.notes) {
    page.drawText(invoice.notes, { x: MARGIN, y, size: 11, font, color: MID, maxWidth: CONTENT_W });
  }

  // --- Sender contact footer (anchored to page bottom, page-wide thin top border) ---
  const FOOTER_Y = MARGIN + 14;
  page.drawLine({
    start: { x: MARGIN, y: FOOTER_Y + 14 },
    end: { x: MARGIN + CONTENT_W, y: FOOTER_Y + 14 },
    thickness: 0.5,
    color: LIGHT,
  });
  const footerLine = `${BUSINESS.email}  ·  ${BUSINESS.phone}  ·  ${BUSINESS.website}  ·  ${BUSINESS.location}`;
  const footerSize = 9;
  const footerW = font.widthOfTextAtSize(footerLine, footerSize);
  page.drawText(footerLine, {
    x: MARGIN + (CONTENT_W - footerW) / 2,
    y: FOOTER_Y,
    size: footerSize,
    font,
    color: MID,
  });

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
