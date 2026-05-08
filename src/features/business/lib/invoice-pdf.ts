import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import type { Invoice } from "@/features/business/types/business";

const BRAND = rgb(12 / 255, 10 / 255, 62 / 255); // russian-violet #0c0a3e
const DARK = rgb(0.15, 0.15, 0.15);
const MID = rgb(0.45, 0.45, 0.45);
const LIGHT = rgb(0.75, 0.75, 0.75);
const ROW_ALT = rgb(0.97, 0.97, 0.97);
const WHITE = rgb(1, 1, 1);

const MARGIN = 42;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BUSINESS = {
  bank: "12-3077-0191830-00",
};

/**
 * Formats a number as a NZD dollar string.
 * @param n - Amount to format
 * @returns Formatted string like "$12.50"
 */
function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Formats an ISO date string as a short NZ locale date.
 * @param iso - ISO 8601 date string
 * @returns Formatted date string like "01 Jan 2026"
 */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Generates a branded A4 PDF for the given invoice using pdf-lib.
 * The document-header-800x270.png is used as the full-width header band.
 * profile.svg is rasterized via sharp and placed in the footer.
 * @param invoice - The invoice record to render.
 * @returns PDF content as a Buffer.
 */
export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // --- Embed images ---
  const headerBytes = await fs.readFile(
    path.join(process.cwd(), "public/assets/document-header-800x270.png"),
  );
  const headerImg = await pdfDoc.embedPng(headerBytes);

  const logoBuffer = await sharp(path.join(process.cwd(), "public/source/profile.svg"))
    .resize(110)
    .png()
    .toBuffer();
  const logoImg = await pdfDoc.embedPng(logoBuffer);

  // --- Header image (full content width, no top margin) ---
  const hScale = CONTENT_W / headerImg.width;
  const hH = headerImg.height * hScale;
  page.drawImage(headerImg, { x: MARGIN, y: PAGE_H - hH, width: CONTENT_W, height: hH });

  let y = PAGE_H - hH - 18;

  // --- Invoice number + status block (right-aligned) ---
  const statusColor =
    invoice.status === "PAID"
      ? rgb(0.1, 0.55, 0.25)
      : invoice.status === "SENT"
        ? rgb(0.1, 0.35, 0.75)
        : MID;

  const rightX = MARGIN + CONTENT_W;

  const invTitle = "INVOICE";
  page.drawText(invTitle, {
    x: rightX - bold.widthOfTextAtSize(invTitle, 18),
    y,
    size: 18,
    font: bold,
    color: BRAND,
  });
  y -= 16;

  page.drawText(invoice.number, {
    x: rightX - font.widthOfTextAtSize(invoice.number, 10),
    y,
    size: 10,
    font,
    color: DARK,
  });
  y -= 13;

  page.drawText(invoice.status, {
    x: rightX - bold.widthOfTextAtSize(invoice.status, 9),
    y,
    size: 9,
    font: bold,
    color: statusColor,
  });

  // --- Bill to + dates block (2 cols) ---
  const infoY = PAGE_H - hH - 18;
  page.drawText("Bill to", {
    x: MARGIN,
    y: infoY,
    size: 7.5,
    font: bold,
    color: LIGHT,
  });
  page.drawText(invoice.clientName, {
    x: MARGIN,
    y: infoY - 13,
    size: 10,
    font: bold,
    color: DARK,
  });
  page.drawText(invoice.clientEmail, {
    x: MARGIN,
    y: infoY - 25,
    size: 9,
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
      size: 8,
      font,
      color: MID,
    });
    page.drawText(val, {
      x: MARGIN + CONTENT_W * 0.72,
      y: infoY + dy,
      size: 8,
      font: bold,
      color: DARK,
    });
  };
  dateLabel("Issued:", fmtDate(invoice.issueDate), 0);
  dateLabel("Due:", fmtDate(invoice.dueDate), -13);

  y = infoY - 40;

  // --- Separator ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 2;

  // --- Table header ---
  const COL = {
    desc: MARGIN,
    qty: MARGIN + CONTENT_W * 0.55,
    price: MARGIN + CONTENT_W * 0.68,
    total: MARGIN + CONTENT_W * 0.82,
  };
  const ROW_H = 20;

  page.drawRectangle({
    x: MARGIN,
    y: y - ROW_H,
    width: CONTENT_W,
    height: ROW_H,
    color: BRAND,
  });
  const headers = ["Description", "Qty", "Unit price", "Total"];
  const cols = [COL.desc, COL.qty, COL.price, COL.total];
  headers.forEach((h, i) => {
    const x =
      i === 0
        ? cols[i] + 4
        : cols[i + 1]
          ? cols[i + 1] - bold.widthOfTextAtSize(h, 8) - 4
          : MARGIN + CONTENT_W - bold.widthOfTextAtSize(h, 8) - 4;
    page.drawText(h, { x, y: y - ROW_H + 6, size: 8, font: bold, color: WHITE });
  });
  y -= ROW_H;

  // --- Line item rows ---
  invoice.lineItems.forEach((item, idx) => {
    const bg = idx % 2 === 1 ? ROW_ALT : WHITE;
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: CONTENT_W, height: ROW_H, color: bg });

    const descMaxW = COL.qty - COL.desc - 6;
    let desc = item.description;
    while (desc.length > 2 && font.widthOfTextAtSize(desc, 8.5) > descMaxW) {
      desc = desc.slice(0, -1);
    }
    if (desc !== item.description) desc = desc.slice(0, -1) + "…";

    page.drawText(desc, { x: COL.desc + 4, y: y - ROW_H + 6, size: 8.5, font, color: DARK });

    const qtyStr = String(item.qty);
    page.drawText(qtyStr, {
      x: COL.price - font.widthOfTextAtSize(qtyStr, 8.5) - 4,
      y: y - ROW_H + 6,
      size: 8.5,
      font,
      color: DARK,
    });

    const priceStr = fmt(item.unitPrice);
    page.drawText(priceStr, {
      x: COL.total - font.widthOfTextAtSize(priceStr, 8.5) - 4,
      y: y - ROW_H + 6,
      size: 8.5,
      font,
      color: DARK,
    });

    const totalStr = fmt(item.lineTotal);
    page.drawText(totalStr, {
      x: MARGIN + CONTENT_W - font.widthOfTextAtSize(totalStr, 8.5) - 4,
      y: y - ROW_H + 6,
      size: 8.5,
      font: bold,
      color: DARK,
    });

    y -= ROW_H;
  });

  // --- Bottom table border ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 16;

  // --- Totals block (right-aligned) ---
  const totalsLabelX = MARGIN + CONTENT_W * 0.6;
  const totalsValueX = MARGIN + CONTENT_W;

  /**
   * Draws a totals row with label on the left and right-aligned value.
   * @param label - Row label (e.g. "Subtotal")
   * @param value - Formatted value string (e.g. "$120.00")
   * @param isBold - Whether to render in bold brand colour (used for the final total)
   */
  const drawTotalRow = (label: string, value: string, isBold = false): void => {
    const f = isBold ? bold : font;
    const c = isBold ? BRAND : MID;
    page.drawText(label, { x: totalsLabelX, y, size: 9, font: f, color: c });
    page.drawText(value, {
      x: totalsValueX - f.widthOfTextAtSize(value, isBold ? 11 : 9),
      y,
      size: isBold ? 11 : 9,
      font: f,
      color: isBold ? BRAND : DARK,
    });
    y -= isBold ? 18 : 14;
  };

  drawTotalRow("Subtotal", fmt(invoice.subtotal));
  if (invoice.gst) drawTotalRow("GST (15%)", fmt(invoice.gstAmount));
  page.drawLine({
    start: { x: totalsLabelX, y: y + 6 },
    end: { x: totalsValueX, y: y + 6 },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 4;
  drawTotalRow("Total", fmt(invoice.total), true);

  y -= 12;

  // --- Bank transfer footer ---
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + CONTENT_W, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 14;
  page.drawText("Bank transfer", { x: MARGIN, y, size: 8, font: bold, color: DARK });
  y -= 12;
  page.drawText(`Account: ${BUSINESS.bank}`, { x: MARGIN, y, size: 8, font, color: MID });
  y -= 11;
  page.drawText(`Reference: ${invoice.number}`, { x: MARGIN, y, size: 8, font, color: MID });

  // --- Notes ---
  if (invoice.notes) {
    y -= 14;
    page.drawText(invoice.notes, { x: MARGIN, y, size: 8, font, color: MID, maxWidth: CONTENT_W });
  }

  // --- Footer logo (bottom-left) ---
  const logoScale = 70 / logoImg.width;
  const logoW = logoImg.width * logoScale;
  const logoH = logoImg.height * logoScale;
  page.drawImage(logoImg, { x: MARGIN, y: MARGIN, width: logoW, height: logoH });

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
